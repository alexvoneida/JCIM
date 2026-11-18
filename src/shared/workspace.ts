import type { Student } from './student'

export interface EmployerRole {
  title: string
  capacity: number
  // Student interests that fit this role. When empty, the title is the only tag.
  tags?: string[]
}

export interface Employer {
  name: string
  industry: string
  capacity: number
  active: boolean
  roles?: EmployerRole[]
  scheduling?: EmployerScheduling
}

// Interviews happen in waves (one group of schools at a time, usually by distance), and each
// wave runs a fixed number of rounds. A student interviews with one employer per round.
export interface Wave {
  name: string
  rounds: number
  // Schools and students the coordinator placed in this wave. A student entry overrides
  // the student's school.
  schools: string[]
  students: string[]
}

export interface EmployerScheduling {
  studentsPerRound?: number
}

export interface ScheduledInterview {
  id: string
  student: string
  employer: string
  wave: string
  round: number
}

export interface Placement {
  student: string
  company: string
  role?: string | null
  rating: 1 | 2 | 3 | 4 | 5
}

// One change to the matching, as a before/after pair. Approvals group the changes before them,
// like commits.
export interface HistoryEntry {
  time: string
  kind: 'generate' | 'placement' | 'feedback' | 'cleared' | 'approve'
  summary: string
  before?: string
  after?: string
}

export interface Workspace {
  students: Record<string, Student>
  employers: Employer[]
  industries?: string[]
  waves: Wave[]
  schedule: ScheduledInterview[]
  placements: Placement[]
  // The last generated matching, so manual edits can be told apart. Emptied with placements;
  // missing for imported workspaces, where the origin of placements is unknown.
  autoPlacements?: Placement[]
  history?: HistoryEntry[]
  scheduleApproved: boolean
  matchingApproved: boolean
  interviewDate: string
  sourcePath?: string
  sourceName?: string
  importedAt?: string
}

export const emptyWorkspace = (): Workspace => ({
  students: {},
  employers: [],
  waves: [],
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
