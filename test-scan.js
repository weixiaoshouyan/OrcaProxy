const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findFromUninstallRegistry(appName) {
  const roots = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
  ];
  for (const root of roots) {
    try {
      const output = execSync(`reg query "${root}" /s /f "${appName}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.trim().startsWith("HKEY_")) {
          const keyPath = line.trim();
          // Query InstallLocation
          try {
            const locOut = execSync(`reg query "${keyPath}" /v "InstallLocation"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const linesL = locOut.split('\n');
            for (const lL of linesL) {
              if (lL.includes('REG_SZ')) {
                const p = lL.split('REG_SZ')[1].trim();
                if (p && fs.existsSync(p)) return p;
              }
            }
          } catch(e) {}
          // Query UninstallString
          try {
            const unOut = execSync(`reg query "${keyPath}" /v "UninstallString"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const linesU = unOut.split('\n');
            for (const lU of linesU) {
              if (lU.includes('REG_SZ')) {
                let un = lU.split('REG_SZ')[1].trim();
                if (un.startsWith('"')) {
                  const q = un.indexOf('"', 1);
                  if (q > 0) un = un.substring(1, q);
                } else {
                  const s = un.indexOf(' ');
                  if (s > 0) un = un.substring(0, s);
                }
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

console.log("OpenCode:", findFromUninstallRegistry("OpenCode"));
console.log("VS Code:", findFromUninstallRegistry("Visual Studio Code"));
console.log("Cursor:", findFromUninstallRegistry("Cursor"));
console.log("Trae:", findFromUninstallRegistry("Trae"));
console.log("Claude:", findFromUninstallRegistry("Claude"));
