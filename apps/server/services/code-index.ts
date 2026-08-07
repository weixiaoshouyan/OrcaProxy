// ============================================================
// src/services/code-index.ts
// Lightweight Workspace RAG: code indexing + semantic-ish search
// No external ML deps. Uses keyword BM25 + simple embeddings via
// provider API when available, falling back to keyword overlap.
// ============================================================

import fs from "fs";
import path from "path";
import { resolveBaseDir } from "../utils/base-dir";
import { log } from "../utils/log";
import { embedTexts, cosineSimilarity } from "./embeddings";

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
  type: "function" | "class" | "section" | "file";
  name?: string;
}

export interface CodeIndex {
  workspacePath: string;
  updatedAt: number;
  chunks: CodeChunk[];
  termFreq: Record<string, Record<string, number>>; // term -> chunkId -> freq
  docFreq: Record<string, number>; // term -> num docs
  embeddings?: Record<string, number[]>; // chunkId -> vector
}

const INDEX_DIR = path.join(resolveBaseDir(__dirname, 2), "data", "code-indexes");
if (!fs.existsSync(INDEX_DIR)) fs.mkdirSync(INDEX_DIR, { recursive: true });

function indexPath(workspacePath: string): string {
  const safeName = Buffer.from(workspacePath).toString("base64").replace(/[^a-zA-Z0-9]/g, "_");
  return path.join(INDEX_DIR, `${safeName}.json`);
}

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".turbo",
  "__pycache__", ".venv", "venv", "target", ".idea", ".vscode", "public", "assets",
]);
const IGNORE_EXTS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico",
  ".svg", ".webp", ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".woff", ".woff2",
  ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac", ".class",
  ".pyc", ".pyd", ".obj", ".o", ".a", ".lib", ".db", ".sqlite", ".sqlite3", ".bin",
  ".dat", ".lock", ".map",
]);
const CODE_EXTS: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
  ".rb": "ruby", ".php": "php", ".cs": "csharp", ".swift": "swift",
  ".kt": "kotlin", ".scala": "scala", ".sh": "shell", ".ps1": "powershell",
  ".md": "markdown", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".html": "html", ".css": "css", ".scss": "scss", ".less": "less",
};

function isIgnoredDir(name: string): boolean {
  return IGNORE_DIRS.has(name);
}

function isIgnoredFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (IGNORE_EXTS.has(ext)) return true;
  const name = path.basename(filePath);
  if (name === ".DS_Store" || name.endsWith(".min.js") || name.endsWith(".min.css")) return true;
  return false;
}

function detectLanguage(filePath: string): string {
  return CODE_EXTS[path.extname(filePath).toLowerCase()] || "text";
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !/^[0-9]+$/.test(t));
}

function splitIdentifier(id: string): string[] {
  // camelCase / PascalCase / snake_case / kebab-case
  return id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function parseChunks(filePath: string, content: string, language: string): CodeChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: CodeChunk[] = [];

  const patterns: { type: CodeChunk["type"]; regex: RegExp }[] = [];
  if (["typescript", "tsx", "javascript", "jsx", "c", "cpp", "csharp", "java", "kotlin", "swift", "go", "rust", "php", "ruby"].includes(language)) {
    patterns.push({ type: "function", regex: /^(?:\s*(?:export\s+|async\s+|static\s+|private\s+|protected\s+|public\s*)*)\s*(?:function\s+([A-Za-z0-9_]+)|([A-Za-z0-9_]+)\s*[:=]\s*(?:async\s*)?\(|([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?:=>|:|{))/ });
    patterns.push({ type: "class", regex: /^(?:\s*(?:export\s+)*)\s*(?:class|interface|enum)\s+([A-Za-z0-9_]+)/ });
  }
  if (["python", "ruby"].includes(language)) {
    patterns.push({ type: "function", regex: /^\s*def\s+([A-Za-z0-9_]+)/ });
    patterns.push({ type: "class", regex: /^\s*class\s+([A-Za-z0-9_]+)/ });
  }

  let current: { type: CodeChunk["type"]; name: string; start: number; indent: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.match(/^(\s*)/)?.[1].length || 0;

    for (const p of patterns) {
      const m = line.match(p.regex);
      if (m) {
        if (current) {
          const end = Math.max(current.start, i - 1);
          chunks.push({
            id: `${filePath}::${current.start}-${end}`,
            filePath,
            startLine: current.start,
            endLine: end,
            content: lines.slice(current.start, end + 1).join("\n"),
            language,
            type: current.type,
            name: current.name,
          });
        }
        current = { type: p.type, name: m[1] || m[2] || m[3] || "", start: i, indent };
        break;
      }
    }
  }

  if (current) {
    chunks.push({
      id: `${filePath}::${current.start}-${lines.length - 1}`,
      filePath,
      startLine: current.start,
      endLine: lines.length - 1,
      content: lines.slice(current.start).join("\n"),
      language,
      type: current.type,
      name: current.name,
    });
  }

  // If no structural chunks found, create a single file chunk
  if (chunks.length === 0) {
    chunks.push({
      id: `${filePath}::0-${lines.length - 1}`,
      filePath,
      startLine: 0,
      endLine: Math.max(0, lines.length - 1),
      content,
      language,
      type: "file",
    });
  }

  return chunks;
}

function walk(dir: string, callback: (filePath: string) => void): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!isIgnoredDir(entry.name)) walk(path.join(dir, entry.name), callback);
    } else {
      const full = path.join(dir, entry.name);
      if (!isIgnoredFile(full)) callback(full);
    }
  }
}

export async function buildIndex(workspacePath: string): Promise<CodeIndex> {
  const chunks: CodeChunk[] = [];
  const filePaths: string[] = [];
  walk(workspacePath, (fp) => filePaths.push(fp));

  for (const fp of filePaths.slice(0, 2000)) {
    try {
      const rel = path.relative(workspacePath, fp).replace(/\\/g, "/");
      const stat = fs.statSync(fp);
      if (stat.size > 2 * 1024 * 1024) continue;
      const header = Buffer.alloc(512);
      const fd = fs.openSync(fp, "r");
      const n = fs.readSync(fd, header, 0, 512, 0);
      fs.closeSync(fd);
      if (header.subarray(0, n).includes(0)) continue;
      const content = fs.readFileSync(fp, "utf-8");
      if (content.length > 500 * 1024) continue;
      const language = detectLanguage(fp);
      const fileChunks = parseChunks(rel, content, language);
      chunks.push(...fileChunks);
    } catch (e) {
      log("warn", `[CodeIndex] Failed to index ${fp}:`, e);
    }
  }

  const index: CodeIndex = {
    workspacePath,
    updatedAt: Date.now(),
    chunks,
    termFreq: {},
    docFreq: {},
  };

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.content);
    const nameTokens = chunk.name ? splitIdentifier(chunk.name) : [];
    const allTerms = [...tokens, ...nameTokens];
    const freqs: Record<string, number> = {};
    for (const t of allTerms) freqs[t] = (freqs[t] || 0) + 1;
    for (const t of Object.keys(freqs)) {
      if (!index.termFreq[t]) index.termFreq[t] = {};
      index.termFreq[t][chunk.id] = freqs[t];
      index.docFreq[t] = (index.docFreq[t] || 0) + 1;
    }
  }

  // Optional provider-backed embeddings
  try {
    const texts = chunks.map((c) => `${c.filePath} ${c.name || ""} ${c.content.slice(0, 1000)}`);
    const embeddings = await embedTexts(texts);
    if (embeddings && embeddings.length === chunks.length) {
      index.embeddings = {};
      for (let i = 0; i < chunks.length; i++) {
        index.embeddings[chunks[i].id] = embeddings[i];
      }
      log("info", `[CodeIndex] Indexed ${chunks.length} chunks with embeddings from ${workspacePath}`);
    } else {
      log("info", `[CodeIndex] Indexed ${chunks.length} chunks (keyword only) from ${workspacePath}`);
    }
  } catch (e: any) {
    log("info", `[CodeIndex] Indexed ${chunks.length} chunks (keyword only, embedding failed: ${e.message})`);
  }

  return index;
}

export function saveIndex(index: CodeIndex): void {
  try {
    fs.writeFileSync(indexPath(index.workspacePath), JSON.stringify(index), "utf-8");
  } catch (e) {
    log("error", `[CodeIndex] Failed to save index:`, e);
  }
}

export function loadIndex(workspacePath: string): CodeIndex | undefined {
  try {
    const p = indexPath(workspacePath);
    if (!fs.existsSync(p)) return undefined;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as CodeIndex;
  } catch (e) {
    log("error", `[CodeIndex] Failed to load index:`, e);
    return undefined;
  }
}

function bm25Score(index: CodeIndex, queryTerms: string[], chunkId: string): number {
  const k1 = 1.2;
  const b = 0.75;
  const N = index.chunks.length;
  let score = 0;
  let docLen = 0;
  const tfMap = index.termFreq;
  for (const t of Object.keys(tfMap)) {
    if (tfMap[t][chunkId]) docLen += tfMap[t][chunkId];
  }
  const avgLen = Object.values(index.termFreq).reduce((sum, m) => sum + Object.values(m).reduce((a, b) => a + b, 0), 0) / Math.max(1, N);

  for (const t of queryTerms) {
    const tf = (index.termFreq[t] && index.termFreq[t][chunkId]) || 0;
    const df = index.docFreq[t] || 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const denom = tf + k1 * (1 - b + b * (docLen / Math.max(1, avgLen)));
    score += idf * (tf * (k1 + 1)) / Math.max(1, denom);
  }
  return score;
}

export interface SearchResult {
  chunk: CodeChunk;
  score: number;
}

export async function searchIndex(
  index: CodeIndex,
  query: string,
  limit = 10,
  strategy: "hybrid" | "keyword" | "embedding" = "hybrid"
): Promise<SearchResult[]> {
  const terms = tokenize(query);
  const nameTerms = query.split(/\s+/).flatMap(splitIdentifier);
  const queryTerms = [...new Set([...terms, ...nameTerms])];

  const keywordScores = new Map<string, number>();
  if ((strategy === "hybrid" || strategy === "keyword") && queryTerms.length > 0) {
    const candidates = new Set<string>();
    for (const t of queryTerms) {
      if (index.termFreq[t]) {
        for (const cid of Object.keys(index.termFreq[t])) candidates.add(cid);
      }
    }
    for (const cid of candidates) {
      const chunk = index.chunks.find((c) => c.id === cid);
      if (!chunk) continue;
      let score = bm25Score(index, queryTerms, cid);
      if (chunk.name && splitIdentifier(chunk.name).some((n) => queryTerms.includes(n))) score *= 1.5;
      keywordScores.set(cid, score);
    }
  }

  const embeddingScores = new Map<string, number>();
  if ((strategy === "hybrid" || strategy === "embedding") && index.embeddings) {
    try {
      const queryEmbeddings = await embedTexts([query]);
      if (queryEmbeddings && queryEmbeddings[0]) {
        const queryVec = queryEmbeddings[0];
        for (const chunk of index.chunks) {
          const vec = index.embeddings[chunk.id];
          if (vec) {
            embeddingScores.set(chunk.id, cosineSimilarity(queryVec, vec));
          }
        }
      }
    } catch (e: any) {
      log("warn", `[CodeIndex] Embedding search failed: ${e.message}`);
    }
  }

  const allIds = new Set<string>([...keywordScores.keys(), ...embeddingScores.keys()]);
  if (allIds.size === 0) return [];

  const maxKeyword = Math.max(0.0001, ...keywordScores.values());
  const maxEmbedding = Math.max(0.0001, ...embeddingScores.values());

  const results: SearchResult[] = [];
  for (const cid of allIds) {
    const chunk = index.chunks.find((c) => c.id === cid);
    if (!chunk) continue;
    const k = (keywordScores.get(cid) || 0) / maxKeyword;
    const e = (embeddingScores.get(cid) || 0) / maxEmbedding;
    let score = 0;
    if (strategy === "hybrid") score = k * 0.4 + e * 0.6;
    else if (strategy === "keyword") score = k;
    else score = e;
    if (score > 0) results.push({ chunk, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function ensureIndex(workspacePath: string, force = false): Promise<CodeIndex> {
  let index = loadIndex(workspacePath);
  if (!index || force || Date.now() - index.updatedAt > 10 * 60 * 1000) {
    index = await buildIndex(workspacePath);
    saveIndex(index);
  }
  return index;
}
