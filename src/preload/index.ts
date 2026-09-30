import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type DesktopApi } from '../shared/api'

const api: DesktopApi = {
  versions: {
    electron: process.versions.electron
  },
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.getAppVersion),
  parseSheet: () => ipcRenderer.invoke(IpcChannel.parseSheet)
}

contextBridge.exposeInMainWorld('api', api)
