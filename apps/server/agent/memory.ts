// ============================================================
// src/agent/memory.ts
// Agent Memory System - persistent rules and context
// Supports: ORCA.md, .orcarules, user preferences
// Inspired by: Claude Code's CLAUDE.md, Cursor's .cursorrules
// ============================================================

import fs from "fs";
import path from "path";
import { log } from "../utils/log";

export interface AgentMemory {
  projectRules: string;
  userPreferences: string;
  historySummary: string;
  lastUpdated: number;
}

const MEMORY_FILES = ["ORCA.md", ".orcarules", ".orca/rules.md", "orca.md"];
const USER_PREF_FILE = "preferences.md";

/**
 * Find and load project-level rules from workspace
 */
export function loadProjectRules(workspacePath: string): string {
  if (!workspacePath) return "";

  for (const file of MEMORY_FILES) {
    const filePath = path.join(workspacePath, file);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        log("info", `[Memory] Loaded project rules from ${file}`);
        return content;
      }
    } catch { /* ignore */ }
  }

  return "";
}

/**
 * Find and load user preferences
 */
export function loadUserPreferences(workspacePath: string): string {
  if (!workspacePath) return "";
  const prefPath = path.join(workspacePath, ".orca", USER_PREF_FILE);

  try {
    if (fs.existsSync(prefPath)) {
      return fs.readFileSync(prefPath, "utf-8");
    }
  } catch { /* ignore */ }

  return "";
}

/**
 * Save or update project rules
 */
export function saveProjectRules(workspacePath: string, rules: string): { ok: boolean; path: string } {
  if (!workspacePath) return { ok: false, path: "" };

  const filePath = path.join(workspacePath, "ORCA.md");
  try {
    fs.writeFileSync(filePath, rules, "utf-8");
    return { ok: true, path: filePath };
  } catch (e: any) {
    log("error", `[Memory] Failed to save rules: ${e.message}`);
    return { ok: false, path: filePath };
  }
}

/**
 * Save user preferences
 */
export function saveUserPreferences(workspacePath: string, prefs: string): { ok: boolean; path: string } {
  if (!workspacePath) return { ok: false, path: "" };

  const prefDir = path.join(workspacePath, ".orca");
  const prefPath = path.join(prefDir, USER_PREF_FILE);

  try {
    if (!fs.existsSync(prefDir)) fs.mkdirSync(prefDir, { recursive: true });
    fs.writeFileSync(prefPath, prefs, "utf-8");
    return { ok: true, path: prefPath };
  } catch (e: any) {
    log("error", `[Memory] Failed to save preferences: ${e.message}`);
    return { ok: false, path: prefPath };
  }
}

/**
 * Build the memory context to inject into system prompt
 */
export function buildMemoryContext(workspacePath: string): string {
  const rules = loadProjectRules(workspacePath);
  const prefs = loadUserPreferences(workspacePath);

  const parts: string[] = [];

  if (rules) {
    parts.push(`[Project Rules (ORCA.md)]\nThe following project-specific rules have been defined by the user. Follow them at all times:\n\n${rules}`);
  }

  if (prefs) {
    parts.push(`[User Preferences]\nThe following user preferences have been saved:\n\n${prefs}`);
  }

  return parts.join("\n\n");
}

/**
 * Check if a file is a memory/rules file
 */
export function isMemoryFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return ["orca.md", ".orcarules", "orca.rules"].includes(basename) ||
    filePath.includes(".orca/");
}

/**
 * List all memory files in workspace
 */
export function listMemoryFiles(workspacePath: string): string[] {
  if (!workspacePath) return [];
  const files: string[] = [];

  for (const file of MEMORY_FILES) {
    const filePath = path.join(workspacePath, file);
    if (fs.existsSync(filePath)) files.push(file);
  }

  const orcaDir = path.join(workspacePath, ".orca");
  try {
    if (fs.existsSync(orcaDir) && fs.statSync(orcaDir).isDirectory()) {
      const dirFiles = fs.readdirSync(orcaDir);
      for (const f of dirFiles) {
        files.push(`.orca/${f}`);
      }
    }
  } catch { /* ignore */ }

  return files;
}
