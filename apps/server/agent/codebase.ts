// ============================================================
// src/agent/codebase.ts
// Codebase Intelligence - repo map, file analysis, context selection
// Inspired by: Aider's repo map, Cursor's codebase indexing
// ============================================================

import fs from "fs";
import path from "path";
import { log } from "../utils/log";

export interface FileNode {
  path: string;
  size: number;
  lines: number;
  importance: number;
  lastModified: number;
  extension: string;
}

export interface RepoMap {
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  importantFiles: FileNode[];
  structure: string;
}

const IMPORTANT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h",
  ".md", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini"
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "coverage", ".cache", "__pycache__", ".venv", "venv", "target", "bin", "obj"
]);

const CONFIG_FILES = new Set([
  "package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml",
  "go.mod", "Makefile", "Dockerfile", ".env.example", "README.md",
  "orca.md", ".orcarules"
]);

/**
 * Analyze workspace and generate a repo map
 */
export function generateRepoMap(workspacePath: string, maxFiles = 50): RepoMap {
  const key = `${workspacePath}|${maxFiles}`;
  const cached = repoMapCache.get(key);
  if (cached && Date.now() - cached.at < REPO_MAP_TTL_MS) return cached.map;

  const result: RepoMap = buildRepoMap(workspacePath, maxFiles);

  // Bound the cache: a handful of workspaces is typical; clear all once large.
  if (repoMapCache.size > 32) repoMapCache.clear();
  repoMapCache.set(key, { at: Date.now(), map: result });
  return result;
}

// TTL-cache for repo maps. Building one reads every source file in the
// workspace synchronously (event-loop blocking), and buildCodebaseContext runs
// on EVERY agent request — without a cache a large repo stalls the server for
// seconds per request. 5-minute staleness is acceptable for agent context.
const repoMapCache = new Map<string, { at: number; map: RepoMap }>();
const REPO_MAP_TTL_MS = 5 * 60 * 1000;

function buildRepoMap(workspacePath: string, maxFiles: number): RepoMap {
  const result: RepoMap = {
    totalFiles: 0,
    totalLines: 0,
    languages: {},
    importantFiles: [],
    structure: ""
  };

  if (!workspacePath || !fs.existsSync(workspacePath)) return result;

  const allFiles: FileNode[] = [];
  collectFiles(workspacePath, "", allFiles);

  result.totalFiles = allFiles.length;

  for (const file of allFiles) {
    result.totalLines += file.lines;
    const lang = file.extension || "unknown";
    result.languages[lang] = (result.languages[lang] || 0) + 1;
  }

  for (const file of allFiles) {
    file.importance = calculateImportance(file);
  }

  allFiles.sort((a, b) => b.importance - a.importance);
  result.importantFiles = allFiles.slice(0, maxFiles);
  result.structure = generateStructureTree(workspacePath, 3);

  return result;
}

function collectFiles(basePath: string, relativeDir: string, files: FileNode[]): void {
  const fullDir = path.join(basePath, relativeDir);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fullDir, { withFileTypes: true });
  } catch { return; }

  for (const entry of entries) {
    const relPath = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      collectFiles(basePath, relPath, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMPORTANT_EXTENSIONS.has(ext)) continue;

      const filePath = path.join(basePath, relPath);
      let stat: fs.Stats | null = null;
      let lines = 0;

      try {
        stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, "utf-8");
        lines = content.split("\n").length;
      } catch { continue; }

      files.push({
        path: relPath,
        size: stat?.size || 0,
        lines,
        importance: 0,
        lastModified: stat?.mtimeMs || 0,
        extension: ext
      });
    }
  }
}

function calculateImportance(file: FileNode): number {
  let score = 0;

  if (CONFIG_FILES.has(path.basename(file.path))) score += 100;

  if (file.path.includes("src/") || file.path.includes("lib/")) score += 20;
  if (file.path.includes("test/") || file.path.includes("__tests__/")) score -= 10;
  if (file.path.includes("node_modules/")) score -= 100;

  if (file.extension === ".ts" || file.extension === ".tsx") score += 15;
  if (file.extension === ".py") score += 15;
  if (file.extension === ".md") score += 5;

  score += Math.min(file.lines / 100, 10);
  score += Math.min(file.size / 10000, 5);

  const ageDays = (Date.now() - file.lastModified) / (1000 * 60 * 60 * 24);
  if (ageDays < 7) score += 10;
  else if (ageDays < 30) score += 5;

  return score;
}

function generateStructureTree(workspacePath: string, maxDepth: number): string {
  const lines: string[] = [];

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth >= maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    const dirs = entries.filter((e) => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith("."));
    const files = entries.filter((e) => e.isFile() && IMPORTANT_EXTENSIONS.has(path.extname(e.name).toLowerCase()));

    const all = [...dirs, ...files].slice(0, 30);

    for (let i = 0; i < all.length; i++) {
      const entry = all[i];
      const isLast = i === all.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";

      lines.push(`${prefix}${connector}${entry.name}`);

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix + childPrefix, depth + 1);
      }
    }

    if (dirs.length + files.length > 30) {
      lines.push(`${prefix}... (${dirs.length + files.length - 30} more)`);
    }
  }

  walk(workspacePath, "", 0);
  return lines.slice(0, 100).join("\n");
}

/**
 * Format repo map for agent context
 */
export function formatRepoMapForAgent(repoMap: RepoMap): string {
  const parts: string[] = [];

  parts.push(`Total: ${repoMap.totalFiles} files, ${repoMap.totalLines} lines`);

  const langs = Object.entries(repoMap.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang, count]) => `${lang}: ${count}`)
    .join(", ");
  parts.push(`Languages: ${langs}`);

  parts.push(`\nProject Structure:\n${repoMap.structure}`);

  const topFiles = repoMap.importantFiles.slice(0, 15);
  if (topFiles.length > 0) {
    parts.push(`\nKey Files:`);
    for (const f of topFiles) {
      parts.push(`- ${f.path} (${f.lines} lines)`);
    }
  }

  return parts.join("\n");
}

/**
 * Find files relevant to a query using simple heuristics
 */
export function findRelevantFiles(workspacePath: string, query: string, maxResults = 10): string[] {
  if (!workspacePath || !query) return [];

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);
  const scores: Array<{ path: string; score: number }> = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(path.join(dir, entry.name));
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!IMPORTANT_EXTENSIONS.has(ext)) continue;

        const relPath = path.relative(workspacePath, path.join(dir, entry.name));
        let score = 0;

        for (const term of queryTerms) {
          if (relPath.toLowerCase().includes(term)) score += 10;
          if (entry.name.toLowerCase().includes(term)) score += 5;
        }

        if (score > 0) {
          try {
            const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
            for (const term of queryTerms) {
              const regex = new RegExp(term, "gi");
              const matches = content.match(regex);
              if (matches) score += Math.min(matches.length, 5);
            }
          } catch { /* ignore */ }
          scores.push({ path: relPath, score });
        }
      }
    }
  }

  walk(workspacePath);
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, maxResults).map((s) => s.path);
}
