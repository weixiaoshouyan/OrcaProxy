import fs from "fs";
import path from "path";
import { runSkillScript, executeTerminalCommand, SKILLS_DIR, parseFrontmatter } from "./skills";
import { log } from "./helpers";
import { executeMCPTool } from "../mcp";

export async function handleAgentToolCall(tc: any, workspacePath: string): Promise<string> {
  const toolName = tc.function.name;
  let args: any = {};

  try {
    const argsStr = tc.function.arguments || "{}";

    try {
      args = JSON.parse(argsStr);
    } catch (parseError) {
      // Try to fix truncated JSON
      let fixedStr = argsStr;

      // Quick repair: close incomplete strings and objects
      const lastQuoteIndex = fixedStr.lastIndexOf('"');
      const lastBraceIndex = fixedStr.lastIndexOf('}');

      if (lastQuoteIndex > lastBraceIndex) {
        fixedStr += '"';
      }

      const openBraces = (fixedStr.match(/{/g) || []).length;
      const closeBraces = (fixedStr.match(/}/g) || []).length;
      for (let i = 0; i < openBraces - closeBraces; i++) {
        fixedStr += '}';
      }

      try {
        args = JSON.parse(fixedStr);
      } catch (repairError) {
        if (toolName === "write_workspace_file") {
          // Do NOT silently overwrite with empty content �� return error
          return `Error: Failed to parse arguments for ${toolName}. File content was truncated and could not be recovered. Please retry with a smaller content block.`;
        } else {
          return `Error: Failed to parse arguments for ${toolName}`;
        }
      }
    }
  } catch (e: any) {
    return `Error: Failed to parse arguments: ${e.message}`;
  }

  // --- Shared path validation helper ---
  const validateFilePath = (relativePath: string): string | null => {
    if (!relativePath || typeof relativePath !== "string") {
      return "Error: Invalid or missing file path.";
    }
    // Reject null byte injection
    if (relativePath.includes("\u0000")) {
      return "Error: File path contains invalid null bytes.";
    }
    // Reject absolute paths
    if (path.isAbsolute(relativePath)) {
      return "Error: Absolute paths are not allowed. Provide a path relative to the workspace.";
    }
    // Reject path traversal via ".." segments (cross-platform safe approach)
    const normalized = path.normalize(relativePath);
    if (normalized.startsWith("..") || normalized.includes("..\\") || normalized.includes("../")) {
      return "Error: Path traversal detected via '..' segments. Access denied.";
    }
    // Reject paths that resolve to root or contain illegal characters
    const resolved = path.resolve("/", normalized);
    // On Windows, path.resolve("/", "x") gives "C:\\x" �?check that it doesn't escape
    // the intended "/" root by checking that resolved path minus the drive letter stays under /
    const resolvedParts = resolved.replace(/^[A-Za-z]:\\/, "/").replace(/\\/g, "/");
    if (!resolvedParts.startsWith("/")) {
      return "Error: Path traversal detected. Access denied.";
    }
    return null; // valid
  };

  const resolveSafePath = (relativePath: string): { fullPath: string; error: string | null } => {
    const validationError = validateFilePath(relativePath);
    if (validationError) return { fullPath: "", error: validationError };

    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { fullPath: "", error: "Error: No active workspace directory selected." };
    }
    const fullPath = path.resolve(workspacePath, relativePath);
    try {
      // Normalize both paths for comparison (handle drive letter case, separators)
      const normalizedFull = path.resolve(fullPath);
      const normalizedWorkspace = path.resolve(workspacePath);
      const sep = path.sep;
      
      // Check: resolved path must be inside workspace
      if (!normalizedFull.startsWith(normalizedWorkspace + sep) && normalizedFull !== normalizedWorkspace) {
        return { fullPath: "", error: "Error: Path traversal violation. Access denied." };
      }
      
      // Additional symlink check if file exists
      if (fs.existsSync(fullPath)) {
        const realFullPath = fs.realpathSync(fullPath);
        const realWorkspacePath = fs.realpathSync(workspacePath);
        if (!realFullPath.startsWith(realWorkspacePath + sep) && realFullPath !== realWorkspacePath) {
          return { fullPath: "", error: "Error: Symlink traversal violation. Access denied." };
        }
      }
      
      return { fullPath, error: null };
    } catch (e: any) {
      return { fullPath: "", error: `Error: Path resolution failed: ${e.message}` };
    }
  };
  // --- End shared validation ---

  if (toolName === "run_skill_script") {
    try {
      return await runSkillScript(args.skillId, args.scriptName, args.arguments, workspacePath);
    } catch (e: any) {
      return `Error running script: ${e.message}`;
    }
  }

  if (toolName === "run_terminal_command") {
    const cwdPath = (workspacePath && fs.existsSync(workspacePath)) ? workspacePath : process.cwd();
    try {
      return await executeTerminalCommand(args.command, cwdPath);
    } catch (e: any) {
      return `Error executing command: ${e.message}`;
    }
  }

  if (toolName === "list_workspace_files") {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return "Error: No active workspace directory selected in the UI. Please ask the user to select a workspace directory.";
    }
    try {
      const walk = (dir: string, depth = 0): string[] => {
        if (depth > 3) return [];
        let results: string[] = [];
        const list = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of list) {
          const resPath = path.join(dir, item.name);
          const relPath = path.relative(workspacePath, resPath);
          if (item.isDirectory()) {
            if (item.name === "node_modules" || item.name === ".git" || item.name === "dist") continue;
            results.push(relPath + "/");
            results.push(...walk(resPath, depth + 1));
          } else {
            results.push(relPath);
          }
        }
        return results;
      };
      const files = walk(workspacePath);
      if (files.length === 0) return "Workspace directory is empty.";
      const fileListStr = files.map(f => `- ${f}`).join("\n");
      const limit = 30 * 1024;
      if (fileListStr.length > limit) {
        return `Workspace files in ${workspacePath} (Truncated):\n${fileListStr.substring(0, limit)}\n... [List truncated. Too many files inside workspace directory.]`;
      }
      return `Workspace files in ${workspacePath}:\n${fileListStr}`;
    } catch (e: any) {
      return `Error listing files: ${e.message}`;
    }
  }

  if (toolName === "read_workspace_file") {
    const { fullPath, error } = resolveSafePath(args.relativeFilePath);
    if (error) return error;
    try {
      if (!fs.existsSync(fullPath)) {
        return `Error: File not found at ${args.relativeFilePath}`;
      }
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) {
        return `Error: Target ${args.relativeFilePath} is not a file.`;
      }
      const BINARY_EXTS = new Set(['.exe','.dll','.so','.dylib','.png','.jpg','.jpeg','.gif','.bmp','.ico','.svg','.webp','.pdf','.zip','.gz','.tar','.rar','.7z','.woff','.woff2','.ttf','.otf','.eot','.mp3','.mp4','.avi','.mov','.wav','.flac','.class','.pyc','.pyd','.obj','.o','.a','.lib','.db','.sqlite','.sqlite3','.bin','.dat','.lock']);
      const ext = path.extname(fullPath).toLowerCase();
      if (BINARY_EXTS.has(ext)) {
        return `Error: Cannot read binary file (${ext}). This tool only supports text-based files. File size: ${Math.round(stat.size / 1024)}KB`;
      }
      const MAX_READ_SIZE = 5 * 1024 * 1024;
      if (stat.size > MAX_READ_SIZE) {
        return `Error: File too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum readable size is 5MB. Please use search_grep or glob_files to find specific content.`;
      }
      const headerBuf = Buffer.alloc(512);
      const fd = fs.openSync(fullPath, 'r');
      const bytesRead = fs.readSync(fd, headerBuf, 0, 512, 0);
      fs.closeSync(fd);
      const header = headerBuf.subarray(0, bytesRead);
      if (header.includes(0)) {
        return `Error: File appears to be binary (contains null bytes). This tool only supports text-based files.`;
      }
      const content = fs.readFileSync(fullPath, "utf-8");
      
      // Line selection logic if requested
      if (args.startLine !== undefined || args.endLine !== undefined) {
        const lines = content.split(/\r?\n/);
        const start = args.startLine !== undefined ? Math.max(1, parseInt(args.startLine)) : 1;
        const end = args.endLine !== undefined ? Math.min(lines.length, parseInt(args.endLine)) : lines.length;
        if (start > lines.length) {
          return `Error: startLine (${start}) exceeds total line count (${lines.length}).`;
        }
        if (start > end) {
          return `Error: startLine (${start}) is greater than endLine (${end}).`;
        }
        const slice = lines.slice(start - 1, end);
        return `[Showing lines ${start} to ${end} of ${lines.length} in ${args.relativeFilePath}]\n` + slice.join("\n");
      }

      const limit = 50 * 1024;
      if (content.length > limit) {
        return content.substring(0, limit) + `\n\n[File content truncated. Only the first 50KB is shown. You can use startLine and endLine parameters to read other parts of this file.]`;
      }
      return content;
    } catch (e: any) {
      return `Error reading file: ${e.message}`;
    }
  }

  if (toolName === "list_directory") {
    const relativeDirPath = args.relativeDirPath || ".";
    const { fullPath, error } = resolveSafePath(relativeDirPath);
    if (error) return error;
    try {
      if (!fs.existsSync(fullPath)) {
        return `Error: Directory not found at ${relativeDirPath}`;
      }
      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) {
        return `Error: Path ${relativeDirPath} is not a directory.`;
      }
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      if (entries.length === 0) return `Directory ${relativeDirPath} is empty.`;
      const resultLines = entries.map(entry => {
        const itemPath = path.join(fullPath, entry.name);
        try {
          const s = fs.statSync(itemPath);
          const typeStr = entry.isDirectory() ? "DIR " : "FILE";
          const sizeStr = entry.isDirectory() ? "" : ` (${Math.round(s.size / 102.4) / 10}KB)`;
          return `- [${typeStr}] ${entry.name}${sizeStr}`;
        } catch {
          return `- [UNKNOWN] ${entry.name}`;
        }
      });
      return `Contents of directory "${relativeDirPath}":\n` + resultLines.join("\n");
    } catch (e: any) {
      return `Error listing directory: ${e.message}`;
    }
  }

  if (toolName === "write_workspace_file") {
    const { fullPath, error } = resolveSafePath(args.relativeFilePath);
    if (error) return error;
    try {
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(fullPath, args.content || "", "utf-8");
      return `Success: File written successfully to ${args.relativeFilePath}`;
    } catch (e: any) {
      return `Error writing file: ${e.message}`;
    }
  }

  if (toolName === "patch_workspace_file") {
    const { fullPath, error } = resolveSafePath(args.relativeFilePath);
    if (error) return error;
    try {
      if (!fs.existsSync(fullPath)) {
        return `Error: File not found at ${args.relativeFilePath}`;
      }
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) {
        return `Error: Target ${args.relativeFilePath} is not a file.`;
      }
      const content = fs.readFileSync(fullPath, "utf-8");
      const searchContent = args.searchContent;
      const replacementContent = args.replacementContent;

      if (!searchContent) {
        return "Error: searchContent parameter is empty.";
      }

      const occurrences = content.split(searchContent).length - 1;
      if (occurrences === 0) {
        return `Error: The searchContent was not found in the file. Please ensure the spacing, indentation, and newlines match the file content exactly. File contents around relevant code block should be verified.`;
      }
      if (occurrences > 1) {
        return `Error: The searchContent was found ${occurrences} times in the file. To avoid incorrect replacements, please provide a unique searchContent block with more surrounding context lines (e.g. adjacent lines of code).`;
      }

      const newContent = content.replace(searchContent, replacementContent);
      fs.writeFileSync(fullPath, newContent, "utf-8");
      return `Success: File ${args.relativeFilePath} patched successfully.`;
    } catch (e: any) {
      return `Error patching file: ${e.message}`;
    }
  }

  if (toolName === "search_grep") {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return "Error: No active workspace directory selected.";
    }
    try {
      const query = args.query;
      const filePattern = args.filePattern;
      const caseSensitive = args.caseSensitive === true;
      if (!query) return "Error: query parameter is required.";
      
      const results: string[] = [];
      const queryMatch = caseSensitive ? query : query.toLowerCase();
      let patternRegex: RegExp | null = null;
      if (filePattern) {
        const cleanPattern = filePattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        patternRegex = new RegExp(`^${cleanPattern}$`, 'i');
      }

      const searchStartTime = Date.now();
      const searchDir = (dir: string) => {
        if (Date.now() - searchStartTime > 10000) {
          throw new Error("Search timeout (exceeded 10s limit). Please use a more specific file pattern or query.");
        }
        if (results.length > 50) return;
        try {
          const list = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of list) {
            const resPath = path.join(dir, item.name);
            const relPath = path.relative(workspacePath, resPath).replace(/\\/g, '/');
            if (item.isDirectory()) {
              if (item.name === "node_modules" || item.name === ".git" || item.name === "dist") continue;
              searchDir(resPath);
            } else {
              if (patternRegex && !patternRegex.test(item.name) && !patternRegex.test(relPath)) {
                continue;
              }
              const stat = fs.statSync(resPath);
              if (stat.size > 2 * 1024 * 1024) continue;
              // Skip binary files
              const ext = path.extname(resPath).toLowerCase();
              const BINARY_EXTS = new Set(['.exe','.dll','.so','.dylib','.png','.jpg','.jpeg','.gif','.bmp','.ico','.webp','.pdf','.zip','.gz','.tar','.rar','.7z','.woff','.woff2','.ttf','.otf','.eot','.mp3','.mp4','.avi','.mov','.wav','.flac','.class','.pyc','.pyd','.obj','.o','.a','.lib','.db','.sqlite','.sqlite3','.bin','.dat','.lock']);
              if (BINARY_EXTS.has(ext)) continue;
              try {
                const headerBuf = Buffer.alloc(512);
                const fd = fs.openSync(resPath, 'r');
                const bytesRead = fs.readSync(fd, headerBuf, 0, 512, 0);
                fs.closeSync(fd);
                if (headerBuf.subarray(0, bytesRead).includes(0)) continue;
              } catch { continue; }
              const content = fs.readFileSync(resPath, "utf-8");
              const contentMatch = caseSensitive ? content : content.toLowerCase();
              if (contentMatch.includes(queryMatch)) {
                const lines = content.split("\n");
                lines.forEach((line, idx) => {
                  const lineMatch = caseSensitive ? line : line.toLowerCase();
                  if (lineMatch.includes(queryMatch)) {
                    results.push(`${relPath}:${idx + 1}: ${line.trim()}`);
                  }
                });
              }
            }
          }
        } catch (e) { log("error", "Error searching directory:", e); }
      };

      searchDir(workspacePath);
      if (results.length === 0) return `No matches found for query: "${query}"`;
      const limit = 30;
      const sliced = results.slice(0, limit);
      const truncatedText = results.length > limit ? `\n... [Truncated: showing first ${limit} matches out of ${results.length} total matches.]` : '';
      return `Search Results for query: "${query}":\n\n${sliced.join("\n")}${truncatedText}`;
    } catch (e: any) {
      return `Error in search_grep: ${e.message}`;
    }
  }

  if (toolName === "glob_files") {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return "Error: No active workspace directory selected.";
    }
    try {
      const pattern = args.pattern;
      if (!pattern) return "Error: pattern parameter is required.";
      const matchedFiles: string[] = [];
      let cleanPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      cleanPattern = cleanPattern.replace(/\*\*/g, '@@ANY@@');
      cleanPattern = cleanPattern.replace(/\*/g, '[^/]*');
      cleanPattern = cleanPattern.replace(/@@ANY@@/g, '.*');
      const regex = new RegExp(`^${cleanPattern}$`, 'i');

      const walkStartTime = Date.now();
      const walk = (dir: string) => {
        if (Date.now() - walkStartTime > 10000) {
          throw new Error("Glob search timeout (exceeded 10s limit). Please use a more specific pattern.");
        }
        if (matchedFiles.length > 200) return;
        try {
          const list = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of list) {
            const resPath = path.join(dir, item.name);
            const relPath = path.relative(workspacePath, resPath).replace(/\\/g, '/');
            if (item.isDirectory()) {
              if (item.name === "node_modules" || item.name === ".git" || item.name === "dist") continue;
              walk(resPath);
            } else {
              if (regex.test(relPath) || regex.test(item.name)) {
                matchedFiles.push(relPath);
              }
            }
          }
        } catch (e) { log("error", "Error walking directory:", e); }
      };

      walk(workspacePath);
      if (matchedFiles.length === 0) return `No files matched the pattern: "${pattern}"`;
      const resultStr = matchedFiles.map(f => `- ${f}`).join("\n");
      const limit = 100;
      const truncatedText = matchedFiles.length > limit ? `\n... [List truncated. Too many matched files.]` : '';
      return `Matched files for pattern "${pattern}":\n\n${resultStr.substring(0, 30 * 1024)}${truncatedText}`;
    } catch (e: any) {
      return `Error in glob_files: ${e.message}`;
    }
  }

  if (toolName === "list_available_skills") {
    try {
      if (!fs.existsSync(SKILLS_DIR)) {
        return `Error: Skills folder not found at ${SKILLS_DIR}`;
      }
      const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
      const skillDirs = dirs.filter(d => d.isDirectory());
      const list: string[] = [];
      for (const d of skillDirs) {
        const skillPath = path.join(SKILLS_DIR, d.name);
        const mdFile = path.join(skillPath, "SKILL.md");
        let name = d.name;
        let desc = "No description available.";
        if (fs.existsSync(mdFile)) {
          const text = fs.readFileSync(mdFile, "utf-8");
          const fm = parseFrontmatter(text);
          if (fm.name) name = fm.name;
          if (fm.description) desc = fm.description;
        }
        list.push(`- skillId: "${d.name}"\n  name: "${name}"\n  description: "${desc}"`);
      }
      return `Available agent skills in ${SKILLS_DIR}:\n\n${list.join("\n\n")}`;
    } catch (e: any) {
      return `Error listing skills: ${e.message}`;
    }
  }

  if (toolName === "get_skill_details") {
    try {
      const skillId = args.skillId;
      const skillPath = path.join(SKILLS_DIR, skillId);
      if (!fs.existsSync(skillPath)) {
        return `Error: Skill "${skillId}" not found.`;
      }
      const mdFile = path.join(skillPath, "SKILL.md");
      let documentation = "No SKILL.md documentation found.";
      if (fs.existsSync(mdFile)) {
        documentation = fs.readFileSync(mdFile, "utf-8");
      }
      let scriptsList: string[] = [];
      const scriptsDir = path.join(skillPath, "scripts");
      if (fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory()) {
        const files = fs.readdirSync(scriptsDir);
        scriptsList = files.filter(f => f.endsWith(".py") || f.endsWith(".js") || f.endsWith(".ps1") || f.endsWith(".sh"));
      }
      return `Skill Details for "${skillId}":\n\n[Documentation (SKILL.md)]:\n${documentation}\n\n[Executable scripts in scripts/ folder]:\n${scriptsList.length > 0 ? scriptsList.map(s => `- ${s}`).join("\n") : "None"}`;
    } catch (e: any) {
      return `Error loading skill details: ${e.message}`;
    }
  }

  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    if (parts.length >= 3) {
      const serverName = parts[1];
      const actualToolName = parts.slice(2).join("__");
      try {
        const result = await executeMCPTool(serverName, actualToolName, args);
        return JSON.stringify(result);
      } catch (e: any) {
        return `Error executing MCP tool: ${e.message}`;
      }
    }
  }

  return `Error: Unknown tool: ${toolName}`;
}
