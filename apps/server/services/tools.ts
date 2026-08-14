import fs from "fs";
import path from "path";
import { runSkillScript, executeTerminalCommand, SKILLS_DIR, parseFrontmatter, resolveSafeSkillPath } from "./skills";
import { log } from "./helpers";
import { executeMCPTool } from "../mcp";
import { beginMutation, recordFilePreimage, completeMutation, discardMutation } from "./checkpoints";
import { tryClaim, releaseClaim } from "../agent/claims";

// ---- Checkpoint context (threaded through the tool dispatch path) ----
// Snapshot preimages so rewind can restore workspace state per turn.

export interface CheckpointContext {
  conversationId: string;
  workspacePath: string;
  turn: number;
}

// ---- Pending user questions (ask tool) ----

export interface PendingAsk {
  taskId: string;
  toolCallId: string;
  question: string;
  options: string[];
  createdAt: number;
  status: "pending" | "answered" | "rejected";
  answer?: string;
}

const pendingAskStore = new Map<string, PendingAsk>();

export function getPendingAsks(): PendingAsk[] {
  return Array.from(pendingAskStore.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getPendingAsk(taskId: string): PendingAsk | undefined {
  return Array.from(pendingAskStore.values()).find((a) => a.taskId === taskId && a.status === "pending");
}

export function answerPendingAsk(taskId: string, answer: string): PendingAsk | undefined {
  const ask = getPendingAsk(taskId);
  if (!ask) return undefined;
  ask.status = "answered";
  ask.answer = answer;
  // Clean up: remove from store to prevent memory leak
  pendingAskStore.delete(ask.toolCallId);
  return ask;
}


export async function handleAgentToolCall(tc: any, workspacePath: string, cpContext?: CheckpointContext | null): Promise<string> {
  const checkpointCtx = cpContext ?? null;
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

  // --- Ask question tool: pause and ask the user ---
  if (toolName === "ask_question") {
    const question = typeof args.question === "string" ? args.question : "";
    if (!question) return "Error: question parameter is required.";
    const options = Array.isArray(args.options) ? args.options.filter((o: any) => typeof o === "string").slice(0, 8) : [];
    const pendingAsk = {
      taskId: cpContext?.conversationId || "",
      toolCallId: tc.id,
      question,
      options,
      createdAt: Date.now(),
      status: "pending" as const,
    };
    pendingAskStore.set(pendingAsk.toolCallId, pendingAsk);
    const optsText = options.length > 0 ? `\nOptions:\n${options.map((o: string, i: number) => `${i + 1}. ${o}`).join("\n")}` : "";
    return `[ASK_QUESTION] ${question}${optsText}\n\nThe task is paused waiting for your answer. Reply to this question to continue.`;
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
      
      // Symlink check: validate the deepest existing ancestor of the target path.
      // This also covers writes to not-yet-existing paths that live under a
      // symlinked (or otherwise escaped) ancestor directory.
      const realWorkspacePath = fs.realpathSync(workspacePath);
      let ancestor = normalizedFull;
      let ancestorExists = false;
      while (ancestor.length >= normalizedWorkspace.length) {
        if (fs.existsSync(ancestor)) { ancestorExists = true; break; }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      if (ancestorExists) {
        const realAncestorPath = fs.realpathSync(ancestor);
        if (!realAncestorPath.startsWith(realWorkspacePath + sep) && realAncestorPath !== realWorkspacePath) {
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
        const results: string[] = [];
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
        let start = 1;
        let end = lines.length;
        if (args.startLine !== undefined) {
          const n = Number(args.startLine);
          if (!Number.isFinite(n) || n < 1) {
            return `Error: startLine must be a positive integer (got "${args.startLine}").`;
          }
          start = Math.min(lines.length, Math.floor(n));
        }
        if (args.endLine !== undefined) {
          const n = Number(args.endLine);
          if (!Number.isFinite(n) || n < 1) {
            return `Error: endLine must be a positive integer (got "${args.endLine}").`;
          }
          end = Math.min(lines.length, Math.floor(n));
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
    if (args.content === undefined || args.content === null) {
      return `Error: content parameter is required for write_workspace_file.`;
    }
    const claimOwner = checkpointCtx?.conversationId;
    if (claimOwner) {
      const claim = tryClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (!claim.ok) {
        return `Error: Conflict — file ${args.relativeFilePath} is currently being written by another task (${claim.ownerTaskId}). Wait for it to finish, or read the file again and re-apply your change to the latest version.`;
      }
    }
    try {
      if (checkpointCtx) {
        beginMutation({ toolCallId: tc.id, conversationId: checkpointCtx.conversationId, workspacePath, turn: checkpointCtx.turn });
        recordFilePreimage(tc.id, workspacePath, args.relativeFilePath, resolveSafePath);
      }
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(fullPath, args.content, "utf-8");
      if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (checkpointCtx) completeMutation(tc.id, workspacePath, args.relativeFilePath, resolveSafePath);
      return `Success: File written successfully to ${args.relativeFilePath}`;
    } catch (e: any) {
      if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (checkpointCtx) discardMutation(tc.id);
      return `Error writing file: ${e.message}`;
    }
  }

  if (toolName === "patch_workspace_file") {
    const { fullPath, error } = resolveSafePath(args.relativeFilePath);
    if (error) return error;
    const claimOwner = checkpointCtx?.conversationId;
    if (claimOwner) {
      const claim = tryClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (!claim.ok) {
        return `Error: Conflict — file ${args.relativeFilePath} is currently being written by another task (${claim.ownerTaskId}). Wait for it to finish, or read the file again and re-apply your change to the latest version.`;
      }
    }
    try {
      if (!fs.existsSync(fullPath)) {
        if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
        return `Error: File not found at ${args.relativeFilePath}`;
      }
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) {
        if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
        return `Error: Target ${args.relativeFilePath} is not a file.`;
      }
      const content = fs.readFileSync(fullPath, "utf-8");
      const searchContent = args.searchContent;
      const replacementContent = args.replacementContent;

      if (!searchContent) {
        if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
        return "Error: searchContent parameter is empty.";
      }

      const occurrences = content.split(searchContent).length - 1;
      if (occurrences === 0) {
        if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
        return `Error: The searchContent was not found in the file. Please ensure the spacing, indentation, and newlines match the file content exactly. File contents around relevant code block should be verified.`;
      }
      if (occurrences > 1) {
        if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
        return `Error: The searchContent was found ${occurrences} times in the file. To avoid incorrect replacements, please provide a unique searchContent block with more surrounding context lines (e.g. adjacent lines of code).`;
      }

      const newContent = content.replace(searchContent, replacementContent ?? "");
      if (checkpointCtx) {
        beginMutation({ toolCallId: tc.id, conversationId: checkpointCtx.conversationId, workspacePath, turn: checkpointCtx.turn });
        recordFilePreimage(tc.id, workspacePath, args.relativeFilePath, resolveSafePath);
      }
      fs.writeFileSync(fullPath, newContent, "utf-8");
      if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (checkpointCtx) completeMutation(tc.id, workspacePath, args.relativeFilePath, resolveSafePath);
      return `Success: File ${args.relativeFilePath} patched successfully.`;
    } catch (e: any) {
      if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (checkpointCtx) discardMutation(tc.id);
      return `Error patching file: ${e.message}`;
    }
  }

  if (toolName === "multi_edit") {
    const { fullPath, error } = resolveSafePath(args.relativeFilePath);
    if (error) return error;
    const edits = Array.isArray(args.edits) ? args.edits : [];
    if (edits.length === 0) {
      return "Error: edits parameter must be a non-empty array of { searchContent, replacementContent, replaceAll? } objects.";
    }
    const claimOwner = checkpointCtx?.conversationId;
    if (claimOwner) {
      const claim = tryClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (!claim.ok) {
        return `Error: Conflict — file ${args.relativeFilePath} is currently being written by another task (${claim.ownerTaskId}). Wait for it to finish, or read the file again and re-apply your change to the latest version.`;
      }
    }
    try {
      if (!fs.existsSync(fullPath)) {
        if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
        return `Error: File not found at ${args.relativeFilePath}`;
      }
      const content = fs.readFileSync(fullPath, "utf-8");

      let work = content;
      const applied: string[] = [];
      for (let i = 0; i < edits.length; i++) {
        const ed = edits[i] || {};
        const searchContent = ed.searchContent;
        const replacementContent = ed.replacementContent ?? "";
        if (!searchContent) {
          if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
          return `Error: edit #${i + 1} is missing searchContent.`;
        }
        const replaceAll = ed.replaceAll === true;
        const occurrences = work.split(searchContent).length - 1;
        if (occurrences === 0) {
          if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
          return `Error: edit #${i + 1} searchContent not found (and the file is unchanged, so no writes were made). Provide exact context matching the file content.`;
        }
        if (occurrences > 1 && !replaceAll) {
          if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
          return `Error: edit #${i + 1} searchContent matched ${occurrences} times. Set replaceAll: true to replace all, or provide more unique surrounding context. No writes were made.`;
        }
        work = replaceAll
          ? work.split(searchContent).join(replacementContent)
          : work.replace(searchContent, replacementContent);
        applied.push(`#${i + 1}: ${replaceAll ? `replaced all ${occurrences} occurrence(s)` : "replaced 1 occurrence"}`);
      }

      if (checkpointCtx) {
        beginMutation({ toolCallId: tc.id, conversationId: checkpointCtx.conversationId, workspacePath, turn: checkpointCtx.turn });
        recordFilePreimage(tc.id, workspacePath, args.relativeFilePath, resolveSafePath);
      }
      fs.writeFileSync(fullPath, work, "utf-8");
      if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (checkpointCtx) completeMutation(tc.id, workspacePath, args.relativeFilePath, resolveSafePath);
      return `Success: ${args.relativeFilePath} edited atomically (${edits.length} edit${edits.length > 1 ? "s" : ""}).\n${applied.join("\n")}`;
    } catch (e: any) {
      if (claimOwner) releaseClaim(claimOwner, workspacePath, args.relativeFilePath);
      if (checkpointCtx) discardMutation(tc.id);
      return `Error editing file: ${e.message}`;
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
      const skillPath = resolveSafeSkillPath(skillId);
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

  if (toolName === "preview_diff") {
    const { fullPath, error } = resolveSafePath(args.relativeFilePath);
    if (error) return error;
    try {
      if (!fs.existsSync(fullPath)) {
        return `Error: File not found at ${args.relativeFilePath}`;
      }
      const currentContent = fs.readFileSync(fullPath, "utf-8");
      const newContent = args.content as string;
      if (newContent === undefined || newContent === null) {
        return `Error: content parameter is required for preview_diff.`;
      }

      const currentLines = currentContent.split("\n");
      const newLines = newContent.split("\n");
      const diff: string[] = [];
      const maxLen = Math.max(currentLines.length, newLines.length);
      let changes = 0;

      for (let i = 0; i < maxLen; i++) {
        if (currentLines[i] !== newLines[i]) {
          if (currentLines[i] !== undefined) {
            diff.push(`-${i + 1}: ${currentLines[i]}`);
          }
          if (newLines[i] !== undefined) {
            diff.push(`+${i + 1}: ${newLines[i]}`);
          }
          changes++;
        }
      }

      if (changes === 0) {
        return `No differences found. File is identical.`;
      }

      const diffOutput = diff.slice(0, 50).join("\n");
      const truncated = diff.length > 50 ? `\n... [${diff.length - 50} more changes]` : "";
      return `Diff Preview for "${args.relativeFilePath}" (${changes} line${changes > 1 ? "s" : ""} changed):\n\n${diffOutput}${truncated}`;
    } catch (e: any) {
      return `Error generating diff: ${e.message}`;
    }
  }

  if (toolName === "batch_write_files") {
    const files = args.files as Array<{ relativeFilePath: string; content: string }>;
    if (!Array.isArray(files) || files.length === 0) {
      return "Error: files array is required for batch_write_files.";
    }
    if (files.length > 20) {
      return "Error: Maximum 20 files per batch operation.";
    }

    const results: string[] = [];
    const claimOwner = checkpointCtx?.conversationId;
    for (const file of files) {
      const { fullPath, error } = resolveSafePath(file.relativeFilePath);
      if (error) { results.push(`Error: ${error}`); continue; }
      if (file.content === undefined || file.content === null) {
        results.push(`Error: content required for ${file.relativeFilePath}`);
        continue;
      }
      if (claimOwner) {
        const claim = tryClaim(claimOwner, workspacePath, file.relativeFilePath);
        if (!claim.ok) {
          results.push(`Error: Conflict — ${file.relativeFilePath} is being written by another task (${claim.ownerTaskId}). Skipped.`);
          continue;
        }
      }
      try {
        if (checkpointCtx) {
          beginMutation({ toolCallId: tc.id, conversationId: checkpointCtx.conversationId, workspacePath, turn: checkpointCtx.turn });
          recordFilePreimage(tc.id, workspacePath, file.relativeFilePath, resolveSafePath);
        }
        const parentDir = path.dirname(fullPath);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(fullPath, file.content, "utf-8");
        if (claimOwner) releaseClaim(claimOwner, workspacePath, file.relativeFilePath);
        if (checkpointCtx) completeMutation(tc.id, workspacePath, file.relativeFilePath, resolveSafePath);
        results.push(`Written: ${file.relativeFilePath}`);
      } catch (e: any) {
        if (claimOwner) releaseClaim(claimOwner, workspacePath, file.relativeFilePath);
        if (checkpointCtx) discardMutation(tc.id);
        results.push(`Error writing ${file.relativeFilePath}: ${e.message}`);
      }
    }
    return `Batch Write Results (${files.length} files):\n${results.join("\n")}`;
  }

  if (toolName === "run_lint_check") {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return "Error: No active workspace directory.";
    }
    try {
      const { runLintCheck, formatErrorsForAgent } = require("../agent/autofix");
      const { errors, rawOutput } = runLintCheck(workspacePath);
      const formatted = formatErrorsForAgent(errors);

      if (args.fix && errors.length > 0) {
        return `${formatted}\n\n[Auto-fix not yet implemented. Please fix these errors manually using patch_workspace_file.]`;
      }

      return formatted;
    } catch (e: any) {
      return `Error running lint check: ${e.message}`;
    }
  }

  if (toolName === "run_tests") {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return "Error: No active workspace directory.";
    }
    try {
      const { runTestCheck, formatTestErrorsForAgent } = require("../agent/autofix");
      const { errors, rawOutput } = runTestCheck(workspacePath);
      return formatTestErrorsForAgent(errors);
    } catch (e: any) {
      return `Error running tests: ${e.message}`;
    }
  }

  if (toolName === "git_status") {
    if (!workspacePath) return "Error: No active workspace directory.";
    try {
      const { getGitStatus, formatGitStatusForAgent } = require("../agent/git-tools");
      const status = getGitStatus(workspacePath);
      return formatGitStatusForAgent(status);
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  if (toolName === "git_diff") {
    if (!workspacePath) return "Error: No active workspace directory.";
    try {
      const { getGitDiff } = require("../agent/git-tools");
      return getGitDiff(workspacePath, {
        staged: args.staged === true,
        file: args.file,
      });
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  if (toolName === "git_log") {
    if (!workspacePath) return "Error: No active workspace directory.";
    try {
      const { getGitLog } = require("../agent/git-tools");
      return getGitLog(workspacePath, {
        count: args.count || 10,
        file: args.file,
      });
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  if (toolName === "git_commit") {
    if (!workspacePath) return "Error: No active workspace directory.";
    if (!args.message || typeof args.message !== "string") {
      return "Error: message parameter is required for git_commit.";
    }
    try {
      const { gitCommit } = require("../agent/git-tools");
      const result = gitCommit(workspacePath, args.message, { amend: args.amend === true });
      return result.ok ? `Committed: ${result.output}` : `Error: ${result.output}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  if (toolName === "git_branch") {
    if (!workspacePath) return "Error: No active workspace directory.";
    try {
      const { gitBranch, gitCreateBranch } = require("../agent/git-tools");
      if (args.create) {
        const result = gitCreateBranch(workspacePath, args.create);
        return result.ok ? `Branch created: ${result.output}` : `Error: ${result.output}`;
      }
      const { branches, current } = gitBranch(workspacePath);
      const lines = branches.map((b: string) => (b === current ? `* ${b}` : `  ${b}`));
      return `Branches:\n${lines.join("\n")}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  return `Error: Unknown tool: ${toolName}`;
}
