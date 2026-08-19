const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const path   = require('path')
const license = require('./src/license')

Menu.setApplicationMenu(null)

let activationWin = null
let mainWin       = null

// ── Fenêtre d'activation ──────────────────────────────────────────────────────
function createActivationWindow() {
  activationWin = new BrowserWindow({
    width: 560,
    height: 680,
    resizable: false,
    center: true,
    title: 'GasyEcole – Activation',
    backgroundColor: '#074528',
    frame: false,          // fenêtre sans chrome pour look custom
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  })
  activationWin.once('ready-to-show', () => activationWin.show())
  activationWin.loadFile(path.join(__dirname, 'src', 'activation.html'))
}

// ── Fenêtre principale ────────────────────────────────────────────────────────
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'GasyEcole – Gestion Scolaire',
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true
    },
    show: false
  })
  mainWin.once('ready-to-show', () => {
    mainWin.show()
    mainWin.maximize()
  })
  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'))

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
}

// ── IPC : communication avec activation.html ──────────────────────────────────
ipcMain.handle('get-machine-id', () => {
  return license.getMachineFingerprint()
})

ipcMain.handle('request-online-activation', () => license.requestActivation(app))
ipcMain.handle('check-online-activation', () => license.checkActivation(app))

ipcMain.on('launch-app', () => {
  if (activationWin) { activationWin.close(); activationWin = null }
  createMainWindow()
})

// ── Démarrage ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (license.isActivated(app)) {
    createMainWindow()
  } else {
    createActivationWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      license.isActivated(app) ? createMainWindow() : createActivationWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
