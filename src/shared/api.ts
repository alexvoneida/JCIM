import { Student } from '../shared/student';

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
  parseSheet: () => Promise<{[key: string] : Student}>
  exportSheet: (students: {[key: string] : Student}) => Promise<void>
}
