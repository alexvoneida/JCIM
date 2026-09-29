import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type DesktopApi } from '../shared/api'

const api: DesktopApi = {
  versions: {
    electron: process.versions.electron
  },
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.getAppVersion)
}

contextBridge.exposeInMainWorld('api', api)
