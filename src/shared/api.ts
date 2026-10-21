import type { Workspace, SheetResult } from './workspace'

export const IpcChannel = {
  getAppVersion: 'app:get-version',
  parseSheet: 'app:parse-sheet',
  exportSheet: 'app:export-sheet'
} as const

export interface DesktopApi {
  versions: {
    electron: string
  }
  getAppVersion: () => Promise<string>
  parseSheet: () => Promise<SheetResult<Workspace>>
  exportSheet: (workspace: Workspace) => Promise<SheetResult<{ path: string }>>
}
