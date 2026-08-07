const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function isBrokenPipeError(err) {
  return err && err.code === 'EPIPE';
}

// Electron can be launched from a parent shell that exits while the app stays alive.
// In that case writing logs to stdout/stderr can throw EPIPE and crash the main process.
process.stdout.on('error', (err) => {
  if (!isBrokenPipeError(err)) throw err;
});
process.stderr.on('error', (err) => {
  if (!isBrokenPipeError(err)) throw err;
});

const rawConsoleLog = console.log.bind(console);
const rawConsoleError = console.error.bind(console);
console.log = (...args) => {
  try {
    rawConsoleLog(...args);
  } catch (err) {
    if (!isBrokenPipeError(err)) throw err;
  }
};
console.error = (...args) => {
  try {
    rawConsoleError(...args);
  } catch (err) {
    if (!isBrokenPipeError(err)) throw err;
  }
};

// Generate a local auth token for this session
const LOCAL_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
process.env.LOCAL_AUTH_TOKEN = LOCAL_AUTH_TOKEN;

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

let PORT = getPort();
const HOST = '127.0.0.1';

function getPort() {
  try {
    const configPath = path.join(app.getPath('userData'), 'data', 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return cfg.port || 18080;
    }
  } catch (e) {}
  return 18080;
}

function getTheme() {
  try {
    const configPath = path.join(app.getPath('userData'), 'data', 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return cfg.theme || 'dark';
    }
  } catch (e) {}
  return 'dark';
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const bundlePath = path.join(__dirname, '..', 'dist', 'bundle.js');
    if (!fs.existsSync(bundlePath)) {
      reject(new Error('bundle.js not found at: ' + bundlePath));
      return;
    }

    // For packaged app, extract bundle to temp dir (asar files can't be forked)
    let serverScript = bundlePath;
    const isAsar = __dirname.includes('app.asar');
    if (isAsar) {
      const tmpDir = path.join(app.getPath('userData'), 'server');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tmpBundle = path.join(tmpDir, 'bundle.js');
      fs.copyFileSync(bundlePath, tmpBundle);
      
      // Also copy public directory to userData/public
      const tmpPublic = path.join(app.getPath('userData'), 'public');
      const srcPublic = path.join(__dirname, '..', 'resources', 'public');
      
      function copyFolderRecursiveSync(from, to) {
        if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
        const items = fs.readdirSync(from);
        for (const item of items) {
          const srcPath = path.join(from, item);
          const dstPath = path.join(to, item);
          const stat = fs.statSync(srcPath);
          if (stat.isFile()) {
            fs.copyFileSync(srcPath, dstPath);
          } else if (stat.isDirectory()) {
            copyFolderRecursiveSync(srcPath, dstPath);
          }
        }
      }

      if (fs.existsSync(srcPublic)) {
        try {
          copyFolderRecursiveSync(srcPublic, tmpPublic);
        } catch (e) {
          console.error('[Main] Failed to copy public folder:', e);
        }
      }
      serverScript = tmpBundle;
    }

    // Set environment for the server
    process.env.ORCA_BASE_DIR = app.getPath('userData');

    const appPath = app.getAppPath();
    const isAppAsar = appPath.includes('app.asar');
    const skillsSrcDir = isAppAsar 
      ? path.join(appPath, '..', 'app.asar.unpacked', 'resources', 'skills') 
      : path.join(appPath, 'resources', 'skills');

    // Fork the server process
    const { fork } = require('child_process');
    serverProcess = fork(serverScript, [], {
      env: { 
        ...process.env, 
        ORCA_BASE_DIR: app.getPath('userData'), 
        LOCAL_AUTH_TOKEN,
        ORCA_PORT: String(PORT),
        ORCA_SKILLS_SRC_DIR: skillsSrcDir
      },
      silent: true
    });

    let resolved = false;

    serverProcess.on('message', (msg) => {
      console.log('[Main] IPC Message from server:', msg);
      if (msg && msg.type === 'theme' && mainWindow) {
        console.log('[Main] Applying theme overlay:', msg.theme);
        try {
          if (msg.theme === 'dark') {
            mainWindow.setTitleBarOverlay({
              color: '#0b0d14',
              symbolColor: '#6b7094',
              height: 38
            });
          } else {
            mainWindow.setTitleBarOverlay({
              color: '#f8fafc',
              symbolColor: '#475569',
              height: 38
            });
          }
          console.log('[Main] Theme overlay updated successfully.');
        } catch (e) {
          console.error('[Main] Failed to update title bar overlay:', e);
        }
      } else if (msg && msg.type === 'choose-directory' && mainWindow) {
        dialog.showOpenDialog(mainWindow, {
          title: '选择项目文件夹 / Select Project Folder',
          properties: ['openDirectory', 'createDirectory']
        }).then(result => {
          serverProcess.send({
            type: 'choose-directory-response',
            requestId: msg.requestId,
            path: result.canceled ? undefined : result.filePaths[0],
            cancelled: result.canceled
          });
        }).catch(err => {
          serverProcess.send({
            type: 'choose-directory-response',
            requestId: msg.requestId,
            cancelled: true,
            error: err.message
          });
        });
      } else if (msg && msg.type === 'choose-file' && mainWindow) {
        dialog.showOpenDialog(mainWindow, {
          title: '选择技能的 README.md 或 SKILL.md 文件 / Select Skill README File',
          filters: [
            { name: 'Markdown 技能声明文件', extensions: ['md'] }
          ],
          properties: ['openFile']
        }).then(result => {
          serverProcess.send({
            type: 'choose-file-response',
            requestId: msg.requestId,
            path: result.canceled ? undefined : result.filePaths[0],
            cancelled: result.canceled
          });
        }).catch(err => {
          serverProcess.send({
            type: 'choose-file-response',
            requestId: msg.requestId,
            cancelled: true,
            error: err.message
          });
        });
      } else if (msg && msg.type === 'choose-custom-file' && mainWindow) {
        dialog.showOpenDialog(mainWindow, {
          title: msg.title || '选择文件 / Select File',
          filters: msg.filters || [{ name: 'All Files', extensions: ['*'] }],
          properties: ['openFile']
        }).then(result => {
          serverProcess.send({
            type: 'choose-custom-file-response',
            requestId: msg.requestId,
            path: result.canceled ? undefined : result.filePaths[0],
            cancelled: result.canceled
          });
        }).catch(err => {
          serverProcess.send({
            type: 'choose-custom-file-response',
            requestId: msg.requestId,
            cancelled: true,
            error: err.message
          });
        });
      }
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      console.log('[Server]', msg);
      if (msg.includes('Listening on') && !resolved) {
        resolved = true;
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString());
    });

    serverProcess.on('error', (err) => {
      console.error('Server process error:', err);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    serverProcess.on('exit', (code) => {
      console.log('Server process exited with code:', code);
      serverProcess = null;
      if (!isQuitting) {
        // Auto-restart on unexpected exit
        setTimeout(() => startServer().catch(console.error), 2000);
      }
    });

    // Timeout fallback - increase to 10 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log('[Main] Server startup timeout, proceeding anyway...');
        resolve();
      }
    }, 10000);
  });
}

function createWindow() {
  const theme = getTheme();
  console.log('[Main] Initializing window with theme overlay:', theme);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Orca Universal Proxy',
    icon: getIconPath(),
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: theme === 'light' ? '#f8fafc' : '#0b0d14',
      symbolColor: theme === 'light' ? '#475569' : '#6b7094',
      height: 38
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load the server URL with auth token
  const url = `http://${HOST}:${PORT}?token=${LOCAL_AUTH_TOKEN}`;
  mainWindow.loadURL(url);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    // mainWindow.webContents.openDevTools();
  });

  // Handle external links — only http(s) to a non-local host, and strip any
  // auth token from the URL so credentials never leak to an external browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
          u.searchParams.delete('token');
          shell.openExternal(u.toString());
        }
      }
    } catch { /* ignore malformed URLs */ }
    return { action: 'deny' };
  });

  // Prevent in-window navigation away from the local server (would leak the
  // token-carrying URL via Referer). External links open in the system browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        event.preventDefault();
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          u.searchParams.delete('token');
          shell.openExternal(u.toString());
        }
      }
    } catch { /* ignore malformed URLs */ }
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getIconPath() {
  const iconPaths = [
    path.join(__dirname, '..', 'resources', 'assets', 'icon.ico'),
    path.join(__dirname, '..', 'resources', 'assets', 'icon.png'),
    path.join(__dirname, '..', 'resources', 'public', 'favicon.svg')
  ];
  for (const p of iconPaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createTray() {
  const iconPath = getIconPath();
  let trayIcon;
  if (iconPath && iconPath.endsWith('.ico')) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // Create a simple 16x16 icon
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Orca Universal Proxy v2.1.1');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: `打开 Web 界面`,
      click: () => {
        shell.openExternal(`http://${HOST}:${PORT}?token=${LOCAL_AUTH_TOKEN}`);
      }
    },
    { type: 'separator' },
    {
      label: '服务状态: 运行中',
      enabled: false
    },
    {
      label: `端口: ${PORT}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        if (serverProcess) {
          serverProcess.kill();
        }
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Copy data files to userData if needed
  copyDataFiles();

  // Check port availability — try alternatives before failing
  let currentPort = PORT;
  let portAvailable = await checkPortAvailable(currentPort);
  if (!portAvailable) {
    // Try alternative ports 18081-18085
    const altPorts = [18081, 18082, 18083, 18084, 18085];
    let foundPort = false;
    for (const alt of altPorts) {
      const altAvailable = await checkPortAvailable(alt);
      if (altAvailable) {
        currentPort = alt;
        foundPort = true;
        console.log(`Port ${PORT} is in use, switched to alternative port ${currentPort}`);
        break;
      }
    }
    if (!foundPort) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: '端口被占用 / Port In Use',
        message: '所有端口 (18080-18085) 均被占用',
        detail: '所有端口 18080-18085 均被占用。请手动关闭占用端口的程序后重试。\n\nAll ports 18080-18085 are in use. Please close the conflicting application and try again.',
        buttons: ['确定 / OK'],
        defaultId: 0
      });
      app.quit();
      return;
    }
  }
  // Update PORT to the actual port we're using
  PORT = currentPort;
  process.env.ORCA_PORT = String(PORT);

  // Start the Express server
  try {
    await startServer();
    console.log('Server started successfully');
  } catch (err) {
    console.error('Failed to start server:', err);
  }

  // Create the native window
  createWindow();

  // Create system tray
  createTray();
});

app.on('window-all-closed', () => {
  // Don't quit - keep running in tray
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});

function copyDataFiles() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Copy default config if not exists
  const configPath = path.join(dataDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      activeProviderId: 'deepseek',
      providerKeys: {},
      customProviders: [],
      modelOverrides: {},
      port: 18080,
      logLevel: 'info',
      theme: 'dark'
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  }

  // Copy .env if exists in app resources
  const envSrc = path.join(__dirname, '..', '.env');
  const envDst = path.join(userData, '.env');
  if (fs.existsSync(envSrc) && !fs.existsSync(envDst)) {
    fs.copyFileSync(envSrc, envDst);
  }
}
