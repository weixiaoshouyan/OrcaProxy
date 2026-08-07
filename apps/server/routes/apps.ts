// ============================================================
// src/routes/apps.ts
// App management: scan installed AI apps, launch them via proxy
// ============================================================

import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync, spawn } from "child_process";
import { loadConfig, saveConfig, getAllProviders, getProvider, getApiKey } from "../providers";
import { log } from "../utils/log";
import { IS_ELECTRON } from "../utils/base-dir";
import { pendingChooseCustomFileRequests } from "./management";

// Re-export for backwards compatibility with index.ts
export { scanApps, getCachedApps };

interface AppInfo {
  id: string;
  name: string;
  icon: string;
  installed: boolean;
  path: string;
  running: boolean;
  description: string;
  type: string;
  isCustomPath?: boolean;
}

// ---- Registry Helpers ----
function parseRegistryCmdPath(cmd: string): string {
  let cleanCmd = cmd.trim();
  if (cleanCmd.startsWith('"')) {
    const nextQuote = cleanCmd.indexOf('"', 1);
    if (nextQuote > 0) {
      cleanCmd = cleanCmd.substring(1, nextQuote);
    }
  } else {
    const exeIdx = cleanCmd.toLowerCase().indexOf(".exe");
    if (exeIdx > 0) {
      cleanCmd = cleanCmd.substring(0, exeIdx + 4);
    } else {
      const space = cleanCmd.indexOf(" ");
      if (space > 0) cleanCmd = cleanCmd.substring(0, space);
    }
  }
  return cleanCmd.replace(/\\\\/g, "\\").trim();
}

function findFromRegistry(keyPath: string): string {
  try {
    const output = execSync(`reg query "${keyPath}" /ve`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes("REG_SZ")) {
        const parts = line.split("REG_SZ");
        if (parts.length > 1) {
          const cmd = parseRegistryCmdPath(parts[1]);
          if (fs.existsSync(cmd)) return cmd;
        }
      }
    }
  } catch (e) {}
  return "";
}

function findFromUninstallRegistry(appName: string): string {
  const roots = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
  ];
  for (const root of roots) {
    try {
      const output = execSync(`reg query "${root}" /s /f "${appName}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.trim().startsWith("HKEY_")) {
          const keyPath = line.trim();
          try {
            const locOut = execSync(`reg query "${keyPath}" /v "InstallLocation"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const linesL = locOut.split("\n");
            for (const lL of linesL) {
              if (lL.includes("REG_SZ")) {
                const p = lL.split("REG_SZ")[1].trim().replace(/^['"]|['"]$/g, "").replace(/\\\\/g, "\\");
                if (p && fs.existsSync(p)) return p;
              }
            }
          } catch(e) {}
          try {
            const unOut = execSync(`reg query "${keyPath}" /v "UninstallString"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const linesU = unOut.split("\n");
            for (const lU of linesU) {
              if (lU.includes("REG_SZ")) {
                let un = lU.split("REG_SZ")[1].trim();
                un = parseRegistryCmdPath(un);
                const dir = path.dirname(un);
                if (dir && fs.existsSync(dir)) return dir;
              }
            }
          } catch(e) {}
        }
      }
    } catch(e) {}
  }
  return "";
}

function findExe(basePaths: string[], patterns: string[]) {
  for (const bp of basePaths) {
    for (const pat of patterns) {
      try {
        const p = bp + "\\" + pat;
        if (fs.existsSync(p)) return p;
      } catch(e) {}
    }
  }
  return "";
}

function findInFolder(baseDir: string, exeName: string, maxDepth: number = 2): string {
  if (!baseDir || !fs.existsSync(baseDir) || maxDepth < 0) return "";
  try {
    const direct = baseDir + "\\" + exeName;
    if (fs.existsSync(direct)) return direct;
    if (maxDepth === 0) return "";
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = findInFolder(baseDir + "\\" + entry.name, exeName, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch(e) {}
  return "";
}

function scanApps() {
  const apps: AppInfo[] = [];
  let procs = "";
  try { procs = execSync("tasklist /FO CSV /NH 2>nul", { encoding: "utf-8" }); } catch(e) {}

  const localApp = process.env.LOCALAPPDATA || "";
  const appData = process.env.APPDATA || "";
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const drives = ["C:", "D:", "E:", "F:"];
  const programDirs: string[] = [];
  for (const drive of drives) {
    if (fs.existsSync(drive + "\\")) {
      programDirs.push(drive + "\\Program Files");
      programDirs.push(drive + "\\Program Files (x86)");
      programDirs.push(drive + "\\Programs");
      programDirs.push(drive);
    }
  }

  // Codex CLI
  let codexCli = false; let codexPath = "";
  const codexBinPath = localApp + "\\OpenAI\\Codex\\bin\\codex.exe";
  try { codexPath = execSync("where codex 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; codexCli = true; } catch(e) {}
  if (!codexCli && fs.existsSync(codexBinPath)) { codexCli = true; codexPath = codexBinPath; }
  apps.push({ id: "codex-cli", name: "Codex CLI", icon: "terminal", installed: codexCli, path: codexPath, running: procs.toLowerCase().includes("codex"), description: "OpenAI Codex command-line interface", type: "cli" });

  // Codex Desktop — expanded search paths
  let codexDesktopPath = findFromRegistry("HKCU\\Software\\Classes\\openai-codex\\shell\\open\\command") ||
                         findFromRegistry("HKLM\\Software\\Classes\\openai-codex\\shell\\open\\command") ||
                         findFromRegistry("HKCU\\Software\\Classes\\codex\\shell\\open\\command") ||
                         findFromRegistry("HKLM\\Software\\Classes\\codex\\shell\\open\\command") ||
                         findFromUninstallRegistry("OpenAI Codex") ||
                         findFromUninstallRegistry("Codex");
  if (codexDesktopPath && fs.existsSync(path.join(codexDesktopPath, "Codex.exe"))) {
    codexDesktopPath = path.join(codexDesktopPath, "Codex.exe");
  } else if (codexDesktopPath && !codexDesktopPath.endsWith("Codex.exe") && !codexDesktopPath.endsWith("codex.exe")) {
    codexDesktopPath = "";
  }
  // Also search via MSIX/WindowsApps
  if (!codexDesktopPath) {
    const windowsApps = programFiles + "\\WindowsApps";
    try { if (fs.existsSync(windowsApps)) { const entries = fs.readdirSync(windowsApps); const codexDir = entries.find((e: string) => e.startsWith("OpenAI.Codex_")); if (codexDir) { const c = windowsApps + "\\" + codexDir + "\\app\\Codex.exe"; if (fs.existsSync(c)) codexDesktopPath = c; } } } catch(e) {}
  }
  // Search common install locations
  if (!codexDesktopPath) {
    const searchPaths = [
      ...programDirs.map(d => d + "\\codex"),
      ...programDirs.map(d => d + "\\Codex"),
      ...programDirs.map(d => d + "\\OpenAI Codex"),
      ...programDirs.map(d => d + "\\openai-codex"),
      ...programDirs.map(d => d + "\\OpenAI-Codex"),
      ...programDirs.map(d => d + "\\OpenAICodex"),
      localApp + "\\codex",
      localApp + "\\Codex",
      localApp + "\\OpenAI Codex",
      localApp + "\\openai-codex",
      localApp + "\\OpenAI-Codex",
      localApp + "\\OpenAICodex",
      localApp + "\\Programs\\codex",
      localApp + "\\Programs\\Codex",
      localApp + "\\Programs\\OpenAI Codex",
      localApp + "\\Programs\\openai-codex",
      localApp + "\\Programs\\OpenAI-Codex",
      localApp + "\\Programs\\OpenAICodex",
      os.homedir() + "\\scoop\\apps\\codex\\current",
      os.homedir() + "\\scoop\\shims",
      os.homedir() + "\\.codex",
      localApp + "\\OpenAI\\Codex",
      localApp + "\\OpenAI",
    ];
    for (const d of searchPaths) {
      const p = findInFolder(d, "Codex.exe"); if (p) { codexDesktopPath = p; break; }
    }
  }
  if (!codexDesktopPath && codexPath) {
    try {
      const deduced = path.join(path.dirname(path.dirname(codexPath)), "Codex.exe");
      if (fs.existsSync(deduced)) {
        codexDesktopPath = deduced;
      }
    } catch (e) {}
  }
  apps.push({ id: "codex-desktop", name: "Codex Desktop", icon: "monitor", installed: !!codexDesktopPath, path: codexDesktopPath, running: procs.includes("Codex") || procs.includes("codex"), description: "OpenAI Codex desktop application", type: "desktop" });

  // Claude CLI
  let claudeCli = false; let claudePath = "";
  try { claudePath = execSync("where claude 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; claudeCli = true; } catch(e) {}
  apps.push({ id: "claude-cli", name: "Claude CLI", icon: "terminal", installed: claudeCli, path: claudePath, running: procs.toLowerCase().includes("claude"), description: "Anthropic Claude command-line interface", type: "cli" });

  // Claude Desktop
  let claudeDesktopPath = findFromRegistry("HKCU\\Software\\Classes\\claude\\shell\\open\\command") ||
                          findFromRegistry("HKLM\\Software\\Classes\\claude\\shell\\open\\command");
  if (!claudeDesktopPath) {
    const windowsApps = programFiles + "\\WindowsApps";
    try { if (fs.existsSync(windowsApps)) { const entries = fs.readdirSync(windowsApps); const d = entries.find((e: string) => e.startsWith("Claude_")); if (d) { const c = windowsApps + "\\" + d + "\\app\\claude.exe"; if (fs.existsSync(c)) claudeDesktopPath = c; } } } catch(e) {}
  }
  if (!claudeDesktopPath) {
    const searchPaths = [localApp + "\\Claude\\Claude.exe", localApp + "\\Programs\\Claude\\Claude.exe", ...programDirs.map(d => d + "\\Claude\\Claude.exe")];
    for (const p of searchPaths) { if (fs.existsSync(p)) { claudeDesktopPath = p; break; } }
    if (!claudeDesktopPath) {
      for (const d of [localApp + "\\Claude", ...programDirs.map(d => d + "\\Claude")]) {
        const p = findInFolder(d, "Claude.exe"); if (p) { claudeDesktopPath = p; break; }
      }
    }
  }
  apps.push({ id: "claude-desktop", name: "Claude Desktop", icon: "message-square", installed: !!claudeDesktopPath, path: claudeDesktopPath, running: procs.includes("Claude"), description: "Anthropic Claude desktop application", type: "desktop" });

  // OpenClaw
  let openclaw = false; let openclawPath = "";
  try { openclawPath = execSync("where openclaw 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; openclaw = true; } catch(e) {}
  apps.push({ id: "openclaw", name: "OpenClaw", icon: "terminal", installed: openclaw, path: openclawPath, running: procs.toLowerCase().includes("openclaw"), description: "OpenClaw AI coding agent", type: "cli" });

  // OpenCode
  let opencode = false; let opencodePath = "";
  try { opencodePath = execSync("where opencode 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; opencode = true; } catch(e) {}
  let opencodeDesktopPath = findFromUninstallRegistry("OpenCode") || findFromUninstallRegistry("OpenCode 1.15.10");
  if (opencodeDesktopPath && fs.existsSync(path.join(opencodeDesktopPath, "OpenCode.exe"))) opencodeDesktopPath = path.join(opencodeDesktopPath, "OpenCode.exe");
  else opencodeDesktopPath = "";
  if (!opencodeDesktopPath) {
    for (const p of [localApp + "\\ai.opencode.desktop\\OpenCode.exe", ...programDirs.map(d => d + "\\OpenCode\\OpenCode.exe")]) {
      if (fs.existsSync(p)) { opencodeDesktopPath = p; break; }
    }
  }
  apps.push({ id: "opencode-cli", name: "OpenCode CLI", icon: "terminal", installed: opencode, path: opencodePath, running: procs.toLowerCase().includes("opencode"), description: "OpenCode AI coding agent CLI", type: "cli" });
  apps.push({ id: "opencode-desktop", name: "OpenCode Desktop", icon: "monitor", installed: !!opencodeDesktopPath, path: opencodeDesktopPath, running: procs.includes("OpenCode"), description: "OpenCode desktop application", type: "desktop" });

  // Cursor
  let cursorPath = findFromRegistry("HKCU\\Software\\Classes\\cursor\\shell\\open\\command") ||
                   findFromRegistry("HKLM\\Software\\Classes\\cursor\\shell\\open\\command") ||
                   findFromRegistry("HKCU\\Software\\Classes\\Applications\\Cursor.exe\\shell\\open\\command") ||
                   findFromRegistry("HKLM\\Software\\Classes\\Applications\\Cursor.exe\\shell\\open\\command") ||
                   findFromUninstallRegistry("Cursor");
  if (cursorPath && fs.existsSync(path.join(cursorPath, "Cursor.exe"))) cursorPath = path.join(cursorPath, "Cursor.exe");
  else if (cursorPath && !cursorPath.endsWith("Cursor.exe")) cursorPath = "";
  if (!cursorPath) {
    for (const p of [localApp + "\\Programs\\cursor\\Cursor.exe", ...programDirs.map(d => d + "\\Cursor\\Cursor.exe")]) {
      if (fs.existsSync(p)) { cursorPath = p; break; }
    }
  }
  apps.push({ id: "cursor", name: "Cursor", icon: "code", installed: !!cursorPath, path: cursorPath, running: procs.includes("Cursor"), description: "AI-powered code editor", type: "desktop" });

  // Trae
  let traePath = findFromRegistry("HKCU\\Software\\Classes\\trae\\shell\\open\\command") ||
                 findFromRegistry("HKLM\\Software\\Classes\\trae\\shell\\open\\command") ||
                 findFromUninstallRegistry("Trae");
  if (traePath && fs.existsSync(path.join(traePath, "Trae.exe"))) traePath = path.join(traePath, "Trae.exe");
  else if (traePath && !traePath.endsWith("Trae.exe") && !traePath.endsWith("trae.exe")) traePath = "";
  if (!traePath) {
    for (const p of [localApp + "\\Programs\\trae\\Trae.exe", ...programDirs.map(d => d + "\\Trae\\Trae.exe")]) {
      if (fs.existsSync(p)) { traePath = p; break; }
    }
  }
  apps.push({ id: "trae", name: "Trae", icon: "code", installed: !!traePath, path: traePath, running: procs.includes("Trae"), description: "ByteDance AI code editor", type: "desktop" });

  // VS Code
  let vscode = false; let vscodePath = "";
  try { vscodePath = execSync("where code 2>nul", { encoding: "utf-8" }).trim().split("\n")[0]; if (vscodePath && fs.existsSync(vscodePath)) vscode = true; } catch(e) {}
  if (!vscode) {
    vscodePath = findFromRegistry("HKCU\\Software\\Classes\\vscode\\shell\\open\\command") ||
                 findFromRegistry("HKLM\\Software\\Classes\\vscode\\shell\\open\\command") ||
                 findFromUninstallRegistry("Visual Studio Code");
    if (vscodePath && fs.existsSync(path.join(vscodePath, "Code.exe"))) { vscodePath = path.join(vscodePath, "Code.exe"); vscode = true; }
    else if (vscodePath && vscodePath.endsWith("Code.exe")) vscode = true;
    else vscodePath = "";
  }
  if (!vscode) {
    for (const p of [localApp + "\\Programs\\Microsoft VS Code\\Code.exe", ...programDirs.map(d => d + "\\Microsoft VS Code\\Code.exe")]) {
      if (fs.existsSync(p)) { vscodePath = p; vscode = true; break; }
    }
  }
  apps.push({ id: "vscode", name: "VS Code", icon: "file-code", installed: vscode, path: vscodePath, running: procs.includes("Code"), description: "Visual Studio Code editor", type: "desktop" });

  // Antigravity
  let antigravityPath = findFromUninstallRegistry("Antigravity");
  if (antigravityPath && fs.existsSync(path.join(antigravityPath, "Antigravity.exe"))) antigravityPath = path.join(antigravityPath, "Antigravity.exe");
  else antigravityPath = "";
  if (!antigravityPath) {
    for (const p of [localApp + "\\Programs\\antigravity\\Antigravity.exe", ...programDirs.map(d => d + "\\Antigravity\\Antigravity.exe")]) {
      if (fs.existsSync(p)) { antigravityPath = p; break; }
    }
  }
  apps.push({ id: "antigravity", name: "Antigravity", icon: "monitor", installed: !!antigravityPath, path: antigravityPath, running: procs.includes("Antigravity"), description: "Antigravity AI assistant", type: "desktop" });

  // Cline
  let clineInstalled = false;
  let clineConfigPath = path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "claude_dev_settings.json");
  for (const p of [
    path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "claude_dev_settings.json"),
    path.join(appData, "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "claude_dev_settings.json"),
    path.join(appData, "Code - Insiders", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "claude_dev_settings.json")
  ]) {
    if (fs.existsSync(p)) { clineInstalled = true; clineConfigPath = p; break; }
  }
  if (!clineInstalled) {
    for (const d of [path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev"), path.join(appData, "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev")]) {
      if (fs.existsSync(d)) { clineInstalled = true; clineConfigPath = path.join(d, "settings", "claude_dev_settings.json"); break; }
    }
  }
  apps.push({ id: "cline", name: "Cline", icon: "code", installed: clineInstalled, path: clineConfigPath, running: false, description: "Autonomous coding agent for VS Code", type: "desktop" });

  // Roo Code
  let rooInstalled = false;
  let rooConfigPath = path.join(appData, "Code", "User", "globalStorage", "roodev.roo-cline", "settings", "roo_cline_settings.json");
  for (const p of [
    path.join(appData, "Code", "User", "globalStorage", "roodev.roo-cline", "settings", "roo_cline_settings.json"),
    path.join(appData, "Cursor", "User", "globalStorage", "roodev.roo-cline", "settings", "roo_cline_settings.json"),
    path.join(appData, "Code - Insiders", "User", "globalStorage", "roodev.roo-cline", "settings", "roo_cline_settings.json")
  ]) {
    if (fs.existsSync(p)) { rooInstalled = true; rooConfigPath = p; break; }
  }
  if (!rooInstalled) {
    for (const d of [path.join(appData, "Code", "User", "globalStorage", "roodev.roo-cline")]) {
      if (fs.existsSync(d)) { rooInstalled = true; rooConfigPath = path.join(d, "settings", "roo_cline_settings.json"); break; }
    }
  }
  apps.push({ id: "roo-code", name: "Roo Code", icon: "code", installed: rooInstalled, path: rooConfigPath, running: false, description: "Autonomous AI coding assistant for VS Code", type: "desktop" });

  // Apply user custom app paths
  const customPaths = loadConfig().appPaths || {};
  apps.forEach(app => {
    if (customPaths[app.id] && fs.existsSync(customPaths[app.id])) {
      app.installed = true; app.path = customPaths[app.id]; app.isCustomPath = true;
    }
  });

  return apps;
}

// Cache
let _appsCache: { data: AppInfo[]; time: number } | null = null;
const APPS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache to avoid excessive registry scans

function getCachedApps(): AppInfo[] {
  const now = Date.now();
  if (_appsCache && now - _appsCache.time < APPS_CACHE_TTL) return _appsCache.data;
  const data = scanApps();
  _appsCache = { data, time: now };
  return data;
}

// Pending choose custom file requests are owned by management.ts (single source).
// apps.ts re-exports it for index.ts compatibility.
export { pendingChooseCustomFileRequests };

export function registerAppsRoutes(app: express.Application): void {
  const HOST = "127.0.0.1";
  const PORT = (() => { try { return loadConfig().port; } catch { return 3000; } })();

  app.get("/api/apps", (_req, res) => {
    try { res.json(getCachedApps()); }
    catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post("/api/apps/:id/launch", (req, res) => {
    const { id } = req.params;
    const { providerId } = req.body;
    const provider = getProvider(providerId || loadConfig().activeProviderId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const proxyUrl = "http://" + HOST + ":" + PORT;
    const envVars: Record<string, string> = {
      ...(process.env as Record<string, string>),
      OPENAI_BASE_URL: proxyUrl + "/v1",
      OPENAI_API_KEY: "sk-dummy",
      ANTHROPIC_BASE_URL: proxyUrl,
      ANTHROPIC_API_KEY: "sk-dummy",
    };
    for (const key of Object.keys(envVars)) {
      if (key.endsWith("_API_KEY") && key !== "OPENAI_API_KEY" && key !== "ANTHROPIC_API_KEY") {
        delete envVars[key];
      }
    }
    try {
      const apps = getCachedApps();
      const app = apps.find(a => a.id === id);
      if (!app) return res.status(404).json({ error: "App not found" });
      if (!app.installed) return res.status(400).json({ error: app.name + " is not installed" });

      let launchPath = app.path;
      if (app.type === "cli") {
        if (id.startsWith("codex")) updateCodexConfig(proxyUrl);
        // Escape shell metacharacters in provider.name to prevent cmd injection
        const displayName = String(provider?.name || "").replace(/["&|^<>%!]/g, "");
        const child = spawn("cmd", ["/c", "start", "cmd", "/k",
          "set OPENAI_BASE_URL=" + proxyUrl + "/v1 && set OPENAI_API_KEY=sk-dummy && echo Orca Proxy: " + proxyUrl + "/v1 && echo Provider: " + displayName
        ], { detached: true, stdio: "ignore" });
        child.unref();
        res.json({ ok: true, message: app.name + " terminal opened with " + provider.name });
      } else {
        if (id === "claude-desktop") updateClaudeConfig(proxyUrl);
        if (id.startsWith("codex")) updateCodexConfig(proxyUrl);
        if (id === "cline" || id === "roo-code") {
          updateClineRooConfig(app.path, proxyUrl, provider);
          const vscodeApp = apps.find(a => a.id === "vscode");
          if (vscodeApp && vscodeApp.installed && vscodeApp.path) launchPath = vscodeApp.path;
        }
        if (launchPath && !launchPath.endsWith(".json")) {
          const child = spawn(launchPath, [], { detached: true, stdio: "ignore", env: envVars });
          child.unref();
        }
        res.json({ ok: true, message: app.name + " launched with " + provider.name });
      }
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post("/api/apps/:id/choose-path", (req, res) => {
    const { id } = req.params;
    const getSelectedPath = (): Promise<{ path?: string; cancelled?: boolean; error?: string }> => {
      return new Promise((resolve) => {
        if (IS_ELECTRON && process.send) {
          const requestId = Math.random().toString(36).substring(2, 15);
          pendingChooseCustomFileRequests.set(requestId, (result) => resolve({ path: result.path, cancelled: result.cancelled }));
          setTimeout(() => {
            if (pendingChooseCustomFileRequests.has(requestId)) {
              const cb = pendingChooseCustomFileRequests.get(requestId);
              if (cb) cb({ cancelled: true });
              pendingChooseCustomFileRequests.delete(requestId);
            }
          }, 5 * 60 * 1000);
          process.send!({ type: "choose-custom-file", requestId, title: "选择 " + id + " 的程序文件 / Select App Path", filters: [
            id === "cline" || id === "roo-code" ? { name: "Config File (*.json)", extensions: ["json"] } : { name: "Executable (*.exe)", extensions: ["exe"] }
          ]});
        } else {
          const { exec } = require("child_process");
          exec(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'All Files (*.*)|*.*'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }"`,
            (err: any, stdout: string) => {
              if (err) return resolve({ error: err.message });
              const p = stdout.trim();
              if (!p) return resolve({ cancelled: true });
              resolve({ path: p });
            });
        }
      });
    };
    getSelectedPath().then(result => {
      if (result.error) return res.status(500).json({ error: result.error });
      if (result.cancelled || !result.path) return res.json({ cancelled: true });
      try {
        const cfg = loadConfig();
        if (!cfg.appPaths) cfg.appPaths = {};
        cfg.appPaths[id] = result.path;
        saveConfig(cfg);
        _appsCache = null;
        log("info", `[Apps] Custom path set for ${id}: ${result.path}`);
        res.json({ ok: true, path: result.path });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }).catch(e => { res.status(500).json({ error: String(e) }); });
  });

  app.delete("/api/apps/:id/path", (req, res) => {
    const { id } = req.params;
    try {
      const cfg = loadConfig();
      if (cfg.appPaths && cfg.appPaths[id]) { delete cfg.appPaths[id]; saveConfig(cfg); }
      _appsCache = null;
      log("info", `[Apps] Cleared custom path for ${id}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}

function updateCodexConfig(proxyUrl: string) {
  try {
    const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
    if (fs.existsSync(codexConfigPath)) {
      let toml = fs.readFileSync(codexConfigPath, "utf-8");
      toml = toml.replace(/(\[model_providers\.OpenAI\][\s\S]*?base_url\s*=\s*)"[^"]*"/, `$1"${proxyUrl}/v1"`);
      if (!toml.match(/^base_url\s*=\s*"http:\/\/127\.0\.0\.1/m)) {
        toml = toml.replace(/^base_url\s*=\s*"[^"]*"/m, `base_url = "${proxyUrl}/v1"`);
      }
      fs.writeFileSync(codexConfigPath, toml, "utf-8");
      log("info", "[Launch] Updated Codex config:", codexConfigPath);
    }
  } catch (e) { log("error", "[Launch] Failed to update Codex config:", e); }
}

function updateClaudeConfig(proxyUrl: string) {
  try {
    const isMac = process.platform === "darwin";
    const claudeConfigPath = isMac
      ? path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    let claudeConfig: any = {};
    try { claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf-8")); } catch {}
    claudeConfig.proxy = { url: proxyUrl };
    fs.mkdirSync(path.dirname(claudeConfigPath), { recursive: true });
    fs.writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2), "utf-8");
    log("info", "[Launch] Updated Claude Desktop config:", claudeConfigPath);
  } catch (e) { log("error", "[Launch] Failed to update Claude Desktop config:", e); }
}

function updateClineRooConfig(configPath: string, proxyUrl: string, provider: any) {
  try {
    let config: any = {};
    if (fs.existsSync(configPath)) { try { config = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch {} }
    config.apiProvider = "openai";
    config.openAiBaseUrl = proxyUrl + "/v1";
    config.openAiApiKey = "sk-dummy";
    config.openAiModelId = provider.models[0]?.id || "deepseek-chat";
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    log("info", "[Launch] Updated config:", configPath);
  } catch (e) { log("error", "[Launch] Failed to update config:", e); }
}
