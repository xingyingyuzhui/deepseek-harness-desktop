import { app, BrowserWindow, Menu, Tray, shell, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fixPath from 'fix-path';

// Fix GUI PATH on macOS to inherit full terminal PATH (Homebrew, Node 24, pnpm, git)
fixPath();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let tray = null;
let dshChildProcess = null;
let currentReadyUrl = null;
let isQuitting = false;
let stdoutBuffer = '';

// Strip ANSI escape codes from terminal output
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

// 1. Resolve DSH_HOME (Default to ~/.dsh)
const DSH_HOME = process.env.DSH_HOME || path.join(app.getPath('home'), '.dsh');
process.env.DSH_HOME = DSH_HOME;

// 2. Resolve Node & DSH executables
function resolveExecutables() {
  const nodeCandidates = [
    '/opt/homebrew/opt/node@24/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    'node'
  ];
  let nodeBin = 'node';
  for (const candidate of nodeCandidates) {
    if (existsSync(candidate)) {
      nodeBin = candidate;
      break;
    }
  }

  const dshCandidates = [
    '/opt/homebrew/opt/node@24/bin/dsh',
    '/opt/homebrew/bin/dsh',
    '/usr/local/bin/dsh',
    'dsh'
  ];
  let dshBin = 'dsh';
  for (const candidate of dshCandidates) {
    if (existsSync(candidate)) {
      dshBin = candidate;
      break;
    }
  }

  return { nodeBin, dshBin };
}

// Window state persistence
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (_) {}
  return { width: 1380, height: 920 };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    const isMaximized = mainWindow.isMaximized();
    writeFileSync(STATE_FILE, JSON.stringify({ ...bounds, isMaximized }), 'utf8');
  } catch (_) {}
}

// 3. Supervisor Process Management
function startDshBackend() {
  const { nodeBin, dshBin } = resolveExecutables();
  console.log(`[DSH Supervisor] Launching backend: ${nodeBin} ${dshBin} web --port 0 --no-open`);

  stdoutBuffer = '';

  // Launch DSH 0.1.2-alpha.3 with dynamic port 0 and no browser popups
  dshChildProcess = spawn(nodeBin, [dshBin, 'web', '--port', '0', '--no-open'], {
    cwd: app.getPath('home'),
    env: {
      ...process.env,
      DSH_HOME,
      PATH: process.env.PATH || ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  dshChildProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`[DSH stdout] ${text}`);

    stdoutBuffer += text;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // Retain unfinished line in buffer

    for (const rawLine of lines) {
      const cleanLine = stripAnsi(rawLine);
      // Match 0.1.2-alpha.3 ready token URL: "dsh web: http://127.0.0.1:<port>/?token=<token>"
      const match = cleanLine.match(/dsh web:\s*(https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/\?token=[^\s()]+)/);
      if (match) {
        currentReadyUrl = match[1];
        console.log(`[DSH Supervisor] Ready URL detected: ${currentReadyUrl}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(currentReadyUrl);
        }
      }
    }
  });

  dshChildProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[DSH stderr] ${chunk.toString()}`);
  });

  dshChildProcess.on('exit', (code, signal) => {
    console.log(`[DSH Supervisor] Backend exited with code: ${code}, signal: ${signal}`);
    dshChildProcess = null;
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, 'loading.html'));
    }
  });
}

async function stopDshBackend() {
  if (!dshChildProcess) return;
  const proc = dshChildProcess;
  dshChildProcess = null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_) {}
      resolve();
    }, 4000);

    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      proc.kill('SIGTERM');
    } catch (_) {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function restartDshBackend() {
  console.log('[DSH Supervisor] Restarting backend requested...');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  }
  await stopDshBackend();
  startDshBackend();
}

// 4. Create Main Window
function createMainWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width || 1380,
    height: state.height || 920,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
    title: 'DeepSeek Harness',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#14171c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true
    }
  });

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  // Inject macOS traffic light safe area & window drag CSS
  if (process.platform === 'darwin') {
    const macChromeCss = `
      [class*="logoRow"] {
        margin-top: 28px !important;
        position: relative;
      }
      [class*="collapsed"] [class*="logoRow"] {
        margin-top: 20px !important;
      }
      [class*="logoRow"]::before {
        content: "";
        position: absolute;
        top: -28px;
        left: 0;
        right: -100px;
        height: 28px;
        -webkit-app-region: drag;
        z-index: 999;
      }
      [data-dsh-electron-center],
      [class*="centerCol"] {
        position: relative;
      }
      [data-dsh-electron-center]:not(:has(header:not([aria-hidden="true"]):not([class*="headerHidden"])))::before,
      [class*="centerCol"]:not(:has(header:not([aria-hidden="true"]):not([class*="headerHidden"])))::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 90px;
        height: 44px;
        -webkit-app-region: drag;
        z-index: 5;
      }
      [data-dsh-electron-main-header]:not([aria-hidden="true"]):not([class*="headerHidden"]),
      [class*="centerCol"] header:not([aria-hidden="true"]):not([class*="headerHidden"]) {
        -webkit-user-select: none;
        user-select: none;
        -webkit-app-region: drag;
      }
      :is(
        button,
        a,
        input,
        textarea,
        select,
        summary,
        [role="button"],
        [role="link"],
        [role="tab"],
        [contenteditable="true"]
      ) {
        -webkit-app-region: no-drag !important;
      }
      :root:has([role="dialog"][aria-modal="true"]) [class*="centerCol"]::before,
      :root:has([role="dialog"][aria-modal="true"]) header {
        -webkit-app-region: no-drag !important;
      }
    `;

    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.insertCSS(macChromeCss).catch(() => {});
    });
  }

  // Load splash screen first
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));

  if (currentReadyUrl) {
    mainWindow.loadURL(currentReadyUrl);
  }

  // Handle external link clicks
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    } else {
      saveWindowState();
    }
  });
}

// 5. Build Application Menu
function setupApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            {
              label: '偏好设置与数据 (~/.dsh)',
              accelerator: 'Cmd+,',
              click: () => shell.openPath(DSH_HOME)
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            {
              label: '退出 DeepSeek Harness',
              accelerator: 'Cmd+Q',
              click: () => {
                isQuitting = true;
                app.quit();
              }
            }
          ]
        }]
      : []),
    {
      label: '核心管控',
      submenu: [
        {
          label: '重启 DSH 核心 (优雅重载)',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => restartDshBackend()
        },
        {
          label: '刷新界面',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (currentReadyUrl && mainWindow) {
              mainWindow.loadURL(currentReadyUrl);
            } else if (mainWindow) {
              mainWindow.reload();
            }
          }
        },
        { type: 'separator' },
        {
          label: '打开插件目录 (profiles/web)',
          click: () => shell.openPath(path.join(DSH_HOME, 'profiles', 'web'))
        },
        {
          label: '打开 DSH 数据主目录 (~/.dsh)',
          click: () => shell.openPath(DSH_HOME)
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: '开发者工具 (DevTools)',
          accelerator: 'CmdOrCtrl+Alt+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ]
          : [{ role: 'close' }])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 6. System Tray setup
function setupTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'tray.png');
  if (existsSync(iconPath)) {
    try {
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        {
          label: '打开主窗口',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        },
        {
          label: '重启 DSH 核心',
          click: () => restartDshBackend()
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]);
      tray.setToolTip('DeepSeek Harness');
      tray.setContextMenu(contextMenu);
      tray.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      });
    } catch (err) {
      console.warn('[DSH Supervisor] Tray setup failed:', err.message);
    }
  }
}

// 7. App Lifecycle
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupApplicationMenu();
    createMainWindow();
    setupTray();
    startDshBackend();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });

  app.on('before-quit', async (event) => {
    if (!isQuitting) {
      isQuitting = true;
      event.preventDefault();
      saveWindowState();
      console.log('[DSH Supervisor] Shutting down DSH backend before quit...');
      await stopDshBackend();
      app.quit();
    }
  });
}
