import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type DesktopApi } from '../shared/api'

import { Student } from '../shared/student'

const api: DesktopApi = {
  versions: {
    electron: process.versions.electron
  },
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.getAppVersion),
  parseSheet: () => ipcRenderer.invoke(IpcChannel.parseSheet),
  exportSheet: (students: { [key: string]: Student }) =>
    ipcRenderer.invoke(IpcChannel.exportSheet, students)
}

contextBridge.exposeInMainWorld('api', api)
