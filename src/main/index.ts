import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { IpcChannel } from '../shared/api'
import { parseSheet, exportSheet } from './excel'

// Must match `appId` in electron-builder.yml, otherwise Windows won't group the
// running window with its pinned taskbar / Start Menu shortcut.
const appId = 'com.jcim.desktop'

let mainWindow: BrowserWindow | null = null

// Keep end-to-end runs separate from the coordinator's saved workspace.
if (process.env['JCIM_TEST_USER_DATA_DIR']) {
  app.setPath('userData', process.env['JCIM_TEST_USER_DATA_DIR'])
}

function exitWithError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  dialog.showErrorBox('JCIM could not start', message)
  app.exit(1)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    show: false,
    focusable: process.env['JCIM_TEST_NONINTERACTIVE'] !== '1',
    skipTaskbar: process.env['JCIM_TEST_NONINTERACTIVE'] === '1',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (process.env['JCIM_TEST_NONINTERACTIVE'] === '1') {
      mainWindow?.setIgnoreMouseEvents(true)
      mainWindow?.showInactive()
    } else mainWindow?.show()
  })
  mainWindow.on('closed', () => (mainWindow = null))

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const loading =
    !app.isPackaged && devServerUrl
      ? mainWindow.loadURL(devServerUrl)
      : mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  loading.catch(exitWithError)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app
    .whenReady()
    .then(() => {
      if (process.platform === 'win32') app.setAppUserModelId(appId)

      ipcMain.handle(IpcChannel.getAppVersion, () => app.getVersion())

      ipcMain.handle(IpcChannel.parseSheet, parseSheet)

      ipcMain.handle(IpcChannel.exportSheet, exportSheet)

      createWindow()

      // Earlier versions kept a copy of every imported tracker here so exports could carry
      // its tabs. Exports no longer do, so the copies are only wasted disk space.
      rm(join(app.getPath('userData'), 'imported-workbooks'), {
        recursive: true,
        force: true
      }).catch((error: unknown) =>
        console.error('Could not remove the imported-workbooks folder', error)
      )

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch(exitWithError)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
