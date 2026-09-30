export const IpcChannel = {
  getAppVersion: 'app:get-version',
  parseSheet: 'app:parse-sheet'
} as const

export interface DesktopApi {
  versions: {
    electron: string
  }
  getAppVersion: () => Promise<string>
  parseSheet: () => Promise<string>
}
