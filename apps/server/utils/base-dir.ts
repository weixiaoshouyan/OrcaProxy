// ============================================================
// apps/server/utils/base-dir.ts
// Unified BASE_DIR resolution (used by all modules)
// ============================================================

import path from "path";
import fs from "fs";

const _isPkg = !!(process as any).pkg;
const _isSEA = typeof (process as any).isSea !== "undefined" && (process as any).isSea;
const _isElectron = !!process.env.ORCA_BASE_DIR;

/**
 * Walk up from startDir until a directory containing package.json is found.
 * Works regardless of how deep the caller is nested (ts-node dev, tsc output,
 * esbuild bundle in dist/), so callers no longer need to know their depth.
 */
export function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: two levels up (legacy layout)
  return path.resolve(startDir, "..", "..");
}

/** Resolve the project base directory consistently across environments */
export function resolveBaseDir(moduleDirname: string, _depthFromRoot: number = 2): string {
  // Build project root from current module's __dirname by going up N levels
  if (_isElectron) {
    return process.env.ORCA_BASE_DIR!;
  }
  if (_isPkg || _isSEA) {
    return path.dirname(process.execPath);
  }
  return findProjectRoot(moduleDirname);
}

/** Get the static files directory (resources/public under the project root) */
export function getStaticDir(baseDir: string, moduleDirname: string): string {
  if (_isElectron) {
    // Packaged app: main.js copies resources/public into ORCA_BASE_DIR/public.
    const userDataPublic = path.join(process.env.ORCA_BASE_DIR!, "public");
    if (fs.existsSync(userDataPublic)) return userDataPublic;
    // Dev (electron .): no copy step, serve from the repo.
    return path.join(findProjectRoot(moduleDirname), "resources", "public");
  }
  return path.join(baseDir, "resources", "public");
}

export const IS_ELECTRON = _isElectron;
export const IS_PKG = _isPkg;
