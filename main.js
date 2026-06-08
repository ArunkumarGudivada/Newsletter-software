// ============================================================
//  Newsletter Builder — Electron main process
//  Creates the native desktop window that hosts the editor.
// ============================================================
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#111111',
    title: 'Newsletter Builder',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  // Open external links (e.g. exported hyperlinks) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// A minimal native menu so File actions feel like real software.
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New / Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
        { type: 'separator' },
        {
          label: 'About Newsletter Builder',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Newsletter Builder',
            message: 'Newsletter Builder',
            detail: 'A spatial auto-layout newsletter design tool.\nVersion ' + app.getVersion()
          })
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
        { type: 'separator' }, { role: 'toggleDevTools' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
