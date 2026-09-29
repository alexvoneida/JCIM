export const IpcChannel = {
  getAppVersion: 'app:get-version'
} as const

export interface DesktopApi {
  versions: {
    electron: string
  }
  getAppVersion: () => Promise<string>
}
