// ============================================================
// src/utils/base-dir.ts
// Unified BASE_DIR resolution (used by all modules)
// ============================================================

import path from "path";
import fs from "fs";

const _isPkg = !!(process as any).pkg;
const _isSEA = typeof (process as any).isSea !== "undefined" && (process as any).isSea;
const _isElectron = !!process.env.ORCA_BASE_DIR;

/** Resolve the project base directory consistently across environments */
export function resolveBaseDir(moduleDirname: string, depthFromRoot: number = 2): string {
  // Build project root from current module's __dirname by going up N levels
  const projectRoot = path.resolve(moduleDirname, ...Array(depthFromRoot).fill(".."));
  const srcDir = path.dirname(projectRoot); // one more level for src/

  if (_isElectron) {
    return process.env.ORCA_BASE_DIR!;
  }
  if (_isPkg || _isSEA) {
    return path.dirname(process.execPath);
  }
  // Check if portable (public/ dir exists at src level)
  if (fs.existsSync(path.join(projectRoot, "public"))) {
    return projectRoot;
  }
  if (fs.existsSync(path.join(srcDir, "public"))) {
    return srcDir;
  }
  return projectRoot;
}

/** Get the static files directory */
export function getStaticDir(baseDir: string, moduleDirname: string): string {
  if (_isElectron) {
    return path.join(path.resolve(moduleDirname, ".."), "public");
  }
  return path.join(baseDir, "public");
}

export const IS_ELECTRON = _isElectron;
export const IS_PKG = _isPkg;
