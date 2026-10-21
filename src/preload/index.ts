import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type DesktopApi } from '../shared/api'

const api: DesktopApi = {
  versions: {
    electron: process.versions.electron
  },
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.getAppVersion),
  parseSheet: () => ipcRenderer.invoke(IpcChannel.parseSheet),
  exportSheet: (workspace) => ipcRenderer.invoke(IpcChannel.exportSheet, workspace)
}

contextBridge.exposeInMainWorld('api', api)
