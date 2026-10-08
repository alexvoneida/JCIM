import type { Student } from './student'

export interface Employer {
  name: string
  industry: string
  capacity: number
  active: boolean
  scheduling?: EmployerScheduling
}

export interface ScheduleSettings {
  start: string
  end: string
  durationMinutes: number
}

export interface EmployerScheduling {
  start?: string
  end?: string
  durationMinutes?: number
  parallelInterviews?: number
}

export interface ScheduledInterview {
  id: string
  student: string
  employer: string
  time: string
  round: number
  durationMinutes?: number
}

export interface Placement {
  student: string
  company: string
  rating: 1 | 2 | 3 | 4 | 5
}

export interface Workspace {
  students: Record<string, Student>
  employers: Employer[]
  industries?: string[]
  schedule: ScheduledInterview[]
  scheduleSettings?: ScheduleSettings
  placements: Placement[]
  scheduleApproved: boolean
  matchingApproved: boolean
  interviewDate: string
  sourcePath?: string
  sourceSnapshotPath?: string
  sourceName?: string
  importedAt?: string
}

export const emptyWorkspace = (): Workspace => ({
  students: {},
  employers: [],
  schedule: [],
  placements: [],
  scheduleApproved: false,
  matchingApproved: false,
  interviewDate: ''
})

export interface SheetError {
  title: string
  detail: string
  fix: string
}

export type SheetResult<T> =
  | { status: 'success'; data: T; warnings: string[] }
  | { status: 'cancelled' }
  | { status: 'error'; error: SheetError }
