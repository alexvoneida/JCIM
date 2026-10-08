import { useState, type FormEvent, type ReactNode } from 'react'
import {
  emptyWorkspace,
  type Workspace,
  type Employer,
  type SheetError
} from '../../shared/workspace'
import { industryBank, industryName, rememberIndustries } from '../../shared/industries'
import SchedulePage from './SchedulePage'
import Modal from './Modal'
import { scheduleSettings, scheduleIssues, settingsError } from '../../shared/scheduling'
import IndustryPicker, { OTHER_INDUSTRY } from './IndustryPicker'
import type { Student } from '../../shared/student'
import { InterviewResult } from '../../shared/interviewResult'
import { generateSchedule, latestFeedback, matchingInput, preference } from './workspace-flow'
import { matchInternships } from './matching'
import { explainAlternative } from './placement-explanation'

type Page = 'overview' | 'schedule' | 'matching' | 'employers'
type Notice = {
  kind: 'success' | 'error' | 'info'
  title: string
  detail: string
  fix?: string
  warnings?: string[]
}
type IconName =
  | 'grid'
  | 'calendar'
  | 'link'
  | 'building'
  | 'import'
  | 'export'
  | 'search'
  | 'plus'
  | 'arrow'
  | 'check'
  | 'file'
  | 'close'
  | 'clock'
const storageKey = 'jcim-workspace-v1'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 11h18" />
      </>
    ),
    link: (
      <>
        <path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
      </>
    ),
    building: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6" />
      </>
    ),
    import: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" />
      </>
    ),
    export: (
      <>
        <path d="M12 15V3m-4 4 4-4 4 4M4 15v5h16v-5" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M7 17 17 7M7 7h10v10" />,
    check: <path d="m5 12 4 4L19 6" />,
    file: (
      <>
        <path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h8" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

function interestTone(interest: string) {
  if (/finance|business|marketing/i.test(interest)) return 2
  if (/aerospace|art|design/i.test(interest)) return 3
  if (/manufactur|construction|hospitality/i.test(interest)) return 1
  return 0
}

function formValue(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

function industrySelection(
  form: FormData,
  name: string,
  bank: string[]
): { values: string[]; error?: string } {
  const selected = form
    .getAll(name)
    .filter((value): value is string => typeof value === 'string' && !!value)
  let custom = ''
  if (selected.includes(OTHER_INDUSTRY)) {
    custom = industryName(formValue(form, `${name}-other`))
    if (!custom)
      return {
        values: [],
        error: 'Enter a new industry name, or choose an existing industry instead of Other.'
      }
    if (custom.includes(','))
      return {
        values: [],
        error:
          'Enter one industry name without commas. For students, select each industry separately.'
      }
  }
  if (selected.some((value) => value !== OTHER_INDUSTRY && !bank.includes(value)))
    return {
      values: [],
      error: 'Choose an industry from the shared options, or use Other to add a new one.'
    }
  return {
    values: [
      ...new Set(
        selected.map((value) =>
          value === OTHER_INDUSTRY
            ? (bank.find((i) => i.toLowerCase() === custom.toLowerCase()) ?? custom)
            : value
        )
      )
    ]
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}
function Avatar({ name, square = false }: { name: string; square?: boolean }) {
  return <span className={`avatar ${square ? 'square' : ''}`}>{initials(name)}</span>
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="file" />
      </span>
      <h2>{title}</h2>
      {children}
    </div>
  )
}
function Stats({ values }: { values: [string, ReactNode][] }) {
  return (
    <div className="stats">
      {values.map(([label, value]) => (
        <div className="stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function restore(): { workspace: Workspace; notice: Notice | null } {
  try {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return { workspace: emptyWorkspace(), notice: null }
    const value = JSON.parse(saved) as Workspace
    if (
      !value ||
      !value.students ||
      (value.industries !== undefined &&
        (!Array.isArray(value.industries) ||
          !value.industries.every((i) => typeof i === 'string'))) ||
      !Array.isArray(value.employers) ||
      !Array.isArray(value.schedule) ||
      !Array.isArray(value.placements) ||
      typeof value.interviewDate !== 'string' ||
      typeof value.scheduleApproved !== 'boolean' ||
      (value.scheduleSettings !== undefined && !!settingsError(value.scheduleSettings)) ||
      typeof value.matchingApproved !== 'boolean' ||
      !value.employers.every(
        (e) =>
          e &&
          typeof e.name === 'string' &&
          typeof e.industry === 'string' &&
          typeof e.active === 'boolean' &&
          Number.isSafeInteger(e.capacity) &&
          e.capacity >= 0 &&
          (!e.scheduling ||
            ((e.scheduling.start === undefined || typeof e.scheduling.start === 'string') &&
              (e.scheduling.end === undefined || typeof e.scheduling.end === 'string') &&
              (e.scheduling.durationMinutes === undefined ||
                (Number.isSafeInteger(e.scheduling.durationMinutes) &&
                  e.scheduling.durationMinutes > 0)) &&
              (e.scheduling.parallelInterviews === undefined ||
                (Number.isSafeInteger(e.scheduling.parallelInterviews) &&
                  e.scheduling.parallelInterviews > 0))))
      ) ||
      !Object.entries(value.students).every(
        ([name, student]) =>
          student &&
          student.name === name &&
          Array.isArray(student.interviewResults) &&
          (student.school === undefined || typeof student.school === 'string') &&
          (student.grade === undefined || typeof student.grade === 'string') &&
          (student.interests === undefined ||
            (Array.isArray(student.interests) &&
              student.interests.every((i) => typeof i === 'string'))) &&
          student.interviewResults.every(
            (i) =>
              i &&
              typeof i.business === 'string' &&
              Number.isSafeInteger(i.rank) &&
              i.rank >= 0 &&
              i.rank <= 5 &&
              Number.isSafeInteger(i.wave) &&
              i.wave >= 1
          )
      ) ||
      !value.schedule.every(
        (i) =>
          i &&
          typeof i.id === 'string' &&
          typeof i.time === 'string' &&
          (i.durationMinutes === undefined ||
            (Number.isSafeInteger(i.durationMinutes) && i.durationMinutes > 0)) &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(i.time) &&
          Object.hasOwn(value.students, i.student) &&
          value.employers.some((e) => e.name === i.employer && e.active)
      ) ||
      !value.placements.every(
        (p) =>
          p &&
          Object.hasOwn(value.students, p.student) &&
          value.employers.some((e) => e.name === p.company && e.active) &&
          Number.isSafeInteger(p.rating) &&
          p.rating >= 1 &&
          p.rating <= 5
      )
    )
      throw new Error('The saved workspace has an unsupported or damaged format.')
    return {
      workspace: rememberIndustries({ ...value, scheduleSettings: scheduleSettings(value) }),
      notice: null
    }
  } catch (error) {
    return {
      workspace: emptyWorkspace(),
      notice: {
        kind: 'error',
        title: 'The saved workspace could not be opened',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Import your latest exported workbook to restore your data.'
      }
    }
  }
}

export default function App() {
  const [initial] = useState(restore)
  const [data, setData] = useState(initial.workspace)
  const [notice, setNotice] = useState<Notice | null>(initial.notice)
  const [page, setPage] = useState<Page>('overview')
  const [savedLocally, setSavedLocally] = useState(!initial.notice)
  const [busy, setBusy] = useState<'import' | 'export' | null>(null)
  const [query, setQuery] = useState('')
  const [interest, setInterest] = useState('')
  const [employerStatus, setEmployerStatus] = useState('all')
  const [employerForm, setEmployerForm] = useState<Employer | 'new' | null>(null)
  const [studentDetail, setStudentDetail] = useState<Student | null>(null)
  const [confirmImport, setConfirmImport] = useState(false)
  const [editSchedule, setEditSchedule] = useState(false)
  const [editMatching, setEditMatching] = useState(false)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [formError, setFormError] = useState('')
  const students = Object.values(data.students)
  const industries = industryBank(data)
  const active = data.employers.filter((e) => e.active)
  const input = matchingInput(data)
  const matchingFeedback = latestFeedback(data)
  const result = {
    assignments: data.placements,
    unmatchedStudents: students
      .map((s) => s.name)
      .filter((name) => !data.placements.some((p) => p.student === name)),
    totalRating: data.placements.reduce((sum, p) => sum + p.rating, 0)
  }
  const feedback = students.flatMap((s) =>
    s.interviewResults.map((i, index) => ({ ...i, index, student: s.name }))
  )

  function commit(next: Workspace) {
    next = rememberIndustries({
      ...next,
      scheduleSettings: next.scheduleSettings ?? scheduleSettings(next)
    })
    setData(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setSavedLocally(true)
      return true
    } catch (error) {
      setSavedLocally(false)
      setNotice({
        kind: 'error',
        title: 'Changes could not be saved on this computer',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Your changes are still open. Export a workbook now to keep them before closing the app.'
      })
      return false
    }
  }
  function showError(error: SheetError) {
    setNotice({ kind: 'error', ...error })
  }
  function changePage(next: Page) {
    setPage(next)
    setQuery('')
    setFormError('')
    setEditSchedule(false)
    setEditMatching(false)
  }
  async function importSheet() {
    setConfirmImport(false)
    setBusy('import')
    setNotice(null)
    try {
      const response = await window.api.parseSheet()
      if (response.status === 'error') showError(response.error)
      if (response.status === 'success') {
        setNotice({
          kind: 'success',
          title: 'Workbook imported',
          detail: `${Object.keys(response.data.students).length} students and ${response.data.employers.length} employers loaded from ${response.data.sourceName ?? 'your workbook'}.`,
          warnings: response.warnings
        })
        commit(response.data)
        changePage('overview')
      }
    } catch (error) {
      showError({
        title: 'Import could not start',
        detail: `The app could not read the workbook. ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Reopen JCIM and try importing an .xlsx workbook again. Your current workspace is unchanged.'
      })
    } finally {
      setBusy(null)
    }
  }
  async function exportSheet() {
    setBusy('export')
    setNotice(null)
    try {
      const response = await window.api.exportSheet(data)
      if (response.status === 'error') showError(response.error)
      if (response.status === 'success')
        setNotice({
          kind: 'success',
          title: 'Workbook exported',
          detail: `Saved to ${response.data.path}. Includes all students, active and inactive employers, feedback, schedule, and final matches.`,
          warnings: response.warnings
        })
    } catch (error) {
      showError({
        title: 'Export could not finish',
        detail: `The workbook could not be saved. ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Close the destination file in Excel, choose a writable folder, and try again. Your workspace is still open.'
      })
    } finally {
      setBusy(null)
    }
  }
  function requestImport() {
    if (students.length || data.employers.length) setConfirmImport(true)
    else void importSheet()
  }
  function toggleEmployer(employer: Employer) {
    setNotice({
      kind: 'info',
      title: `${employer.name} is now ${employer.active ? 'inactive' : 'active'}`,
      detail: `${employer.active ? 'Its interviews were removed from the timetable. The employer and all feedback remain in your workbook; other interviews and their edits were kept.' : 'Available for interviews and matching again. Add interviews or generate a new schedule to include it.'} Generate matching again to use the updated employer list.`
    })
    commit({
      ...data,
      employers: data.employers.map((e) =>
        e.name === employer.name ? { ...e, active: !e.active } : e
      ),
      schedule: employer.active
        ? data.schedule.filter((i) => i.employer !== employer.name)
        : data.schedule,
      placements: [],
      scheduleApproved: false,
      matchingApproved: false
    })
  }
  function saveEmployer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = formValue(form, 'name').trim()
    const capacityValue = formValue(form, 'capacity')
    const capacity = Number(capacityValue)
    if (!name) {
      setFormError('Enter an employer name.')
      return
    }
    if (
      data.employers.some(
        (e) =>
          e.name.toLowerCase() === name.toLowerCase() &&
          (employerForm === 'new' || e.name !== employerForm?.name)
      )
    ) {
      setFormError(
        `“${name}” already exists. Find the employer in the list and turn it on again if it is inactive.`
      )
      return
    }
    if (!capacityValue || !Number.isSafeInteger(capacity) || capacity < 0) {
      setFormError(
        'Internship places must be a whole number of 0 or more. Enter 0 if capacity has not been confirmed.'
      )
      return
    }
    const selectedIndustry = industrySelection(form, 'industry', industries)
    if (selectedIndustry.error) {
      setFormError(selectedIndustry.error)
      return
    }
    const employer = {
      name,
      industry: selectedIndustry.values[0] ?? '',
      capacity,
      active: employerForm === 'new' ? true : employerForm!.active,
      scheduling: employerForm === 'new' ? undefined : employerForm!.scheduling
    }
    const saved = commit({
      ...data,
      employers:
        employerForm === 'new'
          ? [...data.employers, employer]
          : data.employers.map((e) => (e.name === name ? employer : e)),
      placements: [],
      matchingApproved: false
    })
    setEmployerForm(null)
    if (saved)
      setNotice({
        kind: 'success',
        title: `Employer ${employerForm === 'new' ? 'added' : 'updated'}`,
        detail: `${name} has ${capacity} internship places. Generate matching again to use this capacity.`
      })
  }
  function saveStudentIndustries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!studentDetail) return
    const selected = industrySelection(new FormData(event.currentTarget), 'interests', industries)
    if (selected.error) {
      setFormError(selected.error)
      return
    }
    const student = { ...data.students[studentDetail.name], interests: selected.values } as Student
    const saved = commit({ ...data, students: { ...data.students, [student.name]: student } })
    setStudentDetail(student)
    setFormError('')
    if (saved)
      setNotice({
        kind: 'success',
        title: 'Student industries updated',
        detail: `${student.name} now uses the shared industry options.`
      })
  }

  function schedule() {
    if (data.schedule.length) {
      setConfirmRegenerate(true)
      return
    }
    generateInterviews()
  }
  function generateInterviews() {
    setConfirmRegenerate(false)
    try {
      const interviews = generateSchedule(data)
      if (!interviews.length) {
        showError({
          title: 'No interviews to schedule',
          detail: 'There are no student interviews linked to active employers.',
          fix: 'Import a tracker with interview rows, turn employers on, or use Edit schedule → Add interview.'
        })
        return
      }
      const saved = commit({ ...data, schedule: interviews, scheduleApproved: false })
      if (saved)
        setNotice({
          kind: 'success',
          title: 'Schedule generated',
          detail: `${interviews.length} interviews scheduled using the configured hours, interview lengths, and employer limits, with no student overlaps. Set the interview date and review before approving.`
        })
    } catch (error) {
      showError({
        title: 'Schedule could not be generated',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Edit the overall schedule window or use the employer’s edit icon to adjust hours, interview length, or Students at once. Your existing schedule is unchanged.'
      })
    }
  }
  function generateMatches() {
    if (!active.some((e) => e.capacity > 0)) {
      showError({
        title: 'Matching needs internship capacity',
        detail: 'No active employer has internship places available.',
        fix: 'On Employers, turn on the participating employers and enter their confirmed internship places.'
      })
      return
    }
    const matched = matchInternships(input)
    const saved = commit({ ...data, placements: matched.assignments, matchingApproved: false })
    if (saved)
      setNotice({
        kind: matched.assignments.length ? 'success' : 'info',
        title: matched.assignments.length ? 'Matching generated' : 'No eligible placements found',
        detail: `${matched.assignments.length} students matched; ${matched.unmatchedStudents.length} remain unmatched. A placement requires employer approval, a student preference from 1–5, and available employer capacity. A student who declined an employer cannot be placed there.`,
        fix: matched.assignments.length
          ? undefined
          : 'Use Edit matching to review the feedback, and check capacity on Employers.'
      })
  }
  function updateFeedback(student: string, index: number, patch: Partial<InterviewResult>) {
    const original = data.students[student]
    commit({
      ...data,
      students: {
        ...data.students,
        [student]: {
          ...original,
          interviewResults: original.interviewResults.map((i, n) =>
            n === index ? { ...i, ...patch } : i
          )
        } as Student
      },
      placements: [],
      matchingApproved: false
    })
  }
  function choosePlacement(student: string, employer: string) {
    const remaining = data.placements.filter((p) => p.student !== student)
    if (!employer) {
      commit({ ...data, placements: remaining, matchingApproved: false })
      return
    }
    const rating = input.studentRatings.get(student)?.get(employer)
    if (!rating || !input.companyLikes.get(employer)?.includes(student)) {
      showError({
        title: 'This placement is not eligible',
        detail: `${student} does not have approved, rated feedback for ${employer}.`,
        fix: 'Record employer approval and a student rating, and check that the student has not declined.'
      })
      return
    }
    if (
      remaining.filter((p) => p.company === employer).length >=
      (input.companyCapacities.get(employer) ?? 0)
    ) {
      showError({
        title: 'This employer has no places left',
        detail: `${employer} has reached its internship capacity.`,
        fix: 'Choose another employer or correct its confirmed capacity on Employers.'
      })
      return
    }
    commit({
      ...data,
      placements: [...remaining, { student, company: employer, rating }],
      matchingApproved: false
    })
  }
  const titles: Record<Page, [string, string]> = {
    overview: ['Student Overview', 'View students, their interests, and interview feedback.'],
    schedule: ['Interview Schedule', 'Review and manage the proposed interview schedule.'],
    matching: ['Final Matching', 'Review employer feedback and create final student matches.'],
    employers: ['Employers', 'Manage internship places and choose which employers participate.']
  }
  const nav: [Page, IconName, string][] = [
    ['overview', 'grid', 'Overview'],
    ['schedule', 'calendar', 'Interview Schedule'],
    ['matching', 'link', 'Final Matching'],
    ['employers', 'building', 'Employers']
  ]
  const filteredStudents = students.filter(
    (s) =>
      `${s.name} ${s.school ?? ''}`.toLowerCase().includes(query.toLowerCase()) &&
      (!interest || s.interests?.includes(interest))
  )
  const interests = industries

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">J</span>
          <div>
            <strong>Jeffco Internship</strong>
            <span>MATCHING PLATFORM</span>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace pages">
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              aria-label={label}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => changePage(id)}
            >
              <Icon name={icon} />
              {label}
              {id === 'employers' && (
                <span className="nav-count" aria-hidden="true">
                  {data.employers.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-sheet">
          <Icon name="file" />
          <strong>Workbook workspace</strong>
          <p>Import a tracker to get started. Export to share or keep a backup.</p>
          <span className="local-indicator">
            <span />
            {savedLocally ? 'Changes saved on this computer' : 'Export to keep your changes'}
          </span>
        </div>
        <div className="profile">
          <span className="profile-avatar">JU</span>
          <div>
            <strong>Jeffco User</strong>
            <span>Program Coordinator</span>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <div className="workbook-toolbar">
          <div className="source">
            <Icon name="file" />
            <div>
              <strong>{data.sourceName ?? 'No workbook imported'}</strong>
              <span>
                {data.importedAt
                  ? `Imported ${new Date(data.importedAt).toLocaleString()}`
                  : 'Excel workbooks (.xlsx)'}
              </span>
            </div>
          </div>
          <div className="toolbar-actions">
            <button onClick={requestImport} disabled={!!busy}>
              <Icon name="import" />
              {busy === 'import' ? 'Importing…' : 'Import sheet'}
            </button>
            <button
              className="primary"
              onClick={() => {
                void exportSheet()
              }}
              disabled={!!busy || (!students.length && !data.employers.length)}
            >
              <Icon name="export" />
              {busy === 'export' ? 'Exporting…' : 'Export sheet'}
            </button>
          </div>
        </div>
        {notice && (
          <section
            className={`notice ${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            <div>
              <strong>{notice.title}</strong>
              <p>{notice.detail}</p>
              {notice.fix && (
                <p>
                  <b>How to fix it:</b> {notice.fix}
                </p>
              )}
              {!!notice.warnings?.length && (
                <details>
                  <summary>{notice.warnings.length} import notes — review before matching</summary>
                  <ul>
                    {notice.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setNotice(null)}
            >
              <Icon name="close" />
            </button>
          </section>
        )}
        <header className="page-header">
          <div>
            <h1>{titles[page][0]}</h1>
            <p>{titles[page][1]}</p>
          </div>
          <div className="page-actions">
            {page === 'employers' && (
              <button
                className="primary"
                onClick={() => {
                  setEmployerForm('new')
                  setFormError('')
                }}
              >
                <Icon name="plus" />
                New employer
              </button>
            )}
            {page === 'schedule' && (
              <>
                <button onClick={schedule} disabled={!!busy}>
                  Generate schedule
                </button>
                <button
                  className={editSchedule ? 'editing' : ''}
                  onClick={() => setEditSchedule(!editSchedule)}
                >
                  {editSchedule ? 'Done editing' : 'Edit schedule'}
                </button>
                <button
                  className="primary"
                  disabled={!data.schedule.length || data.scheduleApproved}
                  onClick={() => {
                    if (!data.interviewDate) {
                      showError({
                        title: 'Choose an interview date first',
                        detail: 'The schedule has times but no calendar date.',
                        fix: 'Set the interview date above the schedule, then approve it.'
                      })
                      return
                    }
                    const issue = scheduleIssues(data)[0]
                    if (issue) {
                      showError({
                        title: 'Schedule needs corrections before approval',
                        detail: issue.detail,
                        fix: 'Resolve the highlighted interviews or edit the schedule settings, then approve again.'
                      })
                      return
                    }
                    commit({ ...data, scheduleApproved: true })
                  }}
                >
                  {data.scheduleApproved ? 'Schedule approved' : 'Approve schedule'}
                </button>
              </>
            )}
            {page === 'matching' && (
              <>
                <button onClick={generateMatches}>
                  {data.placements.length ? 'Re-run matching' : 'Generate matching'}
                </button>
                <button
                  className={editMatching ? 'editing' : ''}
                  onClick={() => setEditMatching(!editMatching)}
                >
                  {editMatching ? 'Done editing' : 'Edit matching'}
                </button>
                <button
                  className="primary"
                  disabled={!data.placements.length || data.matchingApproved}
                  onClick={() => commit({ ...data, matchingApproved: true })}
                >
                  {data.matchingApproved ? 'Matching approved' : 'Approve matching'}
                </button>
              </>
            )}
          </div>
        </header>
        {page === 'overview' && (
          <>
            <div className="section-toolbar">
              <div>
                <strong>{students.length} students</strong>
                <span className="muted">{feedback.length} interview records</span>
              </div>
              <div className="filters">
                <label className="search">
                  <Icon name="search" />
                  <input
                    aria-label="Search students"
                    placeholder="Search students or schools"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter interests"
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                >
                  <option value="">All interests</option>
                  {interests.map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
              </div>
            </div>
            {!students.length ? (
              <Empty title="Start with your workbook">
                <p>
                  Import the internship tracker to see your students, employer feedback, and
                  preferences in one place.
                </p>
                <button className="primary" onClick={requestImport}>
                  <Icon name="import" />
                  Import Excel sheet
                </button>
                <p className="small">
                  Supports the Student Good Fit + Employer Good Fit tracker and JCIM exports.
                </p>
              </Empty>
            ) : !filteredStudents.length ? (
              <Empty title="No students found">
                <p>Try another search or select All interests.</p>
              </Empty>
            ) : (
              <div className="student-grid">
                {filteredStudents.map((s) => (
                  <button
                    className="student-card"
                    key={s.name}
                    onClick={() => {
                      setStudentDetail(s)
                      setFormError('')
                    }}
                  >
                    <div className="card-heading">
                      <Avatar name={s.name} />
                      <div>
                        <h2>{s.name}</h2>
                        <p>
                          {[s.grade, s.school].filter(Boolean).join(' · ') || 'School not provided'}
                        </p>
                      </div>
                      <span className="card-arrow">
                        <Icon name="arrow" />
                      </span>
                    </div>
                    <div className="eyebrow">AREAS OF INTEREST</div>
                    <div className="tags">
                      {s.interests?.length ? (
                        s.interests.map((i) => (
                          <span key={i} className={`tag tone-${interestTone(i)}`}>
                            {i}
                          </span>
                        ))
                      ) : (
                        <span className="muted small">Interests not provided in this sheet</span>
                      )}
                    </div>
                    <div className="card-footer">
                      <span>{s.interviewResults.length} interviews</span>
                      <span>
                        {data.placements.some((p) => p.student === s.name)
                          ? 'Matched'
                          : 'View student'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {page === 'employers' && (
          <>
            <Stats
              values={[
                ['Employers', data.employers.length],
                ['Active', active.length],
                ['Inactive', data.employers.length - active.length],
                ['Available internship places', active.reduce((n, e) => n + e.capacity, 0)]
              ]}
            />
            <div className="info-strip">
              <Icon name="building" />
              <p>
                <strong>Turn participation on or off.</strong> Inactive employers stay in your sheet
                with their feedback. They are excluded from interviews and final matching.
              </p>
            </div>
            <div className="section-toolbar">
              <strong>{data.employers.length} employers</strong>
              <div className="filters">
                <label className="search">
                  <Icon name="search" />
                  <input
                    aria-label="Search employers"
                    placeholder="Search employers"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter employer status"
                  value={employerStatus}
                  onChange={(e) => setEmployerStatus(e.target.value)}
                >
                  <option value="all">All employers</option>
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                </select>
              </div>
            </div>
            {!data.employers.length ? (
              <Empty title="Add your participating employers">
                <p>Import employers from your tracker or create a new employer here.</p>
                <button
                  className="primary"
                  onClick={() => {
                    setEmployerForm('new')
                    setFormError('')
                  }}
                >
                  <Icon name="plus" />
                  New employer
                </button>
              </Empty>
            ) : (
              <div className="employer-grid">
                {data.employers
                  .filter(
                    (e) =>
                      `${e.name} ${e.industry}`.toLowerCase().includes(query.toLowerCase()) &&
                      (employerStatus === 'all' || e.active === (employerStatus === 'active'))
                  )
                  .map((e) => (
                    <article
                      className={`employer-card ${!e.active ? 'inactive-employer' : ''}`}
                      key={e.name}
                    >
                      <div className="card-heading">
                        <Avatar name={e.name} square />
                        <div>
                          <h2>{e.name}</h2>
                          <p>{e.industry || 'Industry not provided'}</p>
                        </div>
                        <span className={`badge ${e.active ? 'green' : 'neutral'}`}>
                          {e.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="employer-numbers">
                        <div>
                          <strong>{e.capacity}</strong>
                          <span>Internship places</span>
                        </div>
                        <div>
                          <strong>{feedback.filter((i) => i.business === e.name).length}</strong>
                          <span>Interview records</span>
                        </div>
                      </div>
                      {e.capacity === 0 && e.active && (
                        <p className="capacity-note">Set capacity before matching</p>
                      )}
                      <div className="employer-bottom">
                        <button
                          onClick={() => {
                            setEmployerForm(e)
                            setFormError('')
                          }}
                        >
                          Edit employer
                        </button>
                        <label className="switch-label">
                          <span>{e.active ? 'Turn off' : 'Turn on'}</span>
                          <button
                            className="switch"
                            role="switch"
                            aria-checked={e.active}
                            aria-label={`Participation for ${e.name}`}
                            onClick={() => toggleEmployer(e)}
                          >
                            <span />
                          </button>
                        </label>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </>
        )}
        {page === 'schedule' && (
          <SchedulePage
            data={data}
            onChange={commit}
            editSchedule={editSchedule}
            onGenerate={schedule}
          />
        )}
        {page === 'matching' && (
          <>
            <Stats
              values={[
                [
                  'Employer approvals',
                  matchingFeedback.filter(
                    (i) => i.employerAccept === true && active.some((e) => e.name === i.business)
                  ).length
                ],
                [
                  '5-star student ratings',
                  matchingFeedback.filter(
                    (i) => i.rank === 5 && active.some((e) => e.name === i.business)
                  ).length
                ],
                ['Final matches', `${data.placements.length} of ${students.length}`]
              ]}
            />
            <details className="matching-rules">
              <summary>How placements are decided</summary>
              <p>
                Each student receives at most one placement with an active employer, within its
                confirmed capacity. Matching first places as many eligible students as possible,
                then maximizes total student preference (1–5, higher is better). The employer must
                approve the student, and the student must not have declined. Employer approval is a
                yes/no answer; the stars below are student preferences.
              </p>
            </details>
            {editMatching && (
              <div className="info-strip">
                <Icon name="link" />
                <p>
                  Update feedback below, then generate matching again. To adjust a placement
                  manually, use the student assignments at the bottom. Changes require approval
                  again.
                </p>
              </div>
            )}
            <section className="board">
              <div className="board-heading">
                <strong>EMPLOYER FEEDBACK · SORTED BY STUDENT PREFERENCE</strong>
                <span className={`status-dot ${data.matchingApproved ? 'approved' : ''}`}>
                  {data.matchingApproved ? 'Approved' : 'Awaiting approval'}
                </span>
              </div>
              {!active.length ? (
                <Empty title="No active employers">
                  <p>Import a workbook or turn on employers on the Employers page.</p>
                  <button onClick={() => changePage('employers')}>Manage employers</button>
                </Empty>
              ) : (
                <div className="company-columns">
                  {active.map((e) => (
                    <section className="company-column" key={e.name}>
                      <div className="company-heading">
                        <Avatar name={e.name} square />
                        <div>
                          <h2>{e.name}</h2>
                          <p>
                            {data.placements.filter((p) => p.company === e.name).length} /{' '}
                            {e.capacity} places filled
                          </p>
                        </div>
                      </div>
                      {matchingFeedback
                        .filter((i) => i.business === e.name)
                        .sort((a, b) => b.rank - a.rank)
                        .map((i) => {
                          const selected = data.placements.some(
                            (p) => p.student === i.student && p.company === e.name
                          )
                          return (
                            <article
                              className={`feedback-card ${selected ? 'selected' : ''}`}
                              key={`${i.student}-${i.index}`}
                            >
                              <div className="feedback-heading">
                                <h3>{i.student}</h3>
                                <span
                                  className="rating"
                                  aria-label={`Student preference ${preference(i) ?? 'not rated'}`}
                                >
                                  {preference(i) ?? '—'} <span>☆</span>
                                  <small>/ 5</small>
                                </span>
                              </div>
                              <div className="feedback-status">
                                <span
                                  className={`tag ${i.employerAccept ? 'tone-2' : i.employerAccept === false ? 'tone-1' : 'neutral'}`}
                                >
                                  {i.employerAccept
                                    ? 'Employer approved'
                                    : i.employerAccept === false
                                      ? 'Employer declined'
                                      : 'Feedback pending'}
                                </span>
                                {selected && (
                                  <span className="matched-label">
                                    <Icon name="check" />
                                    Matched
                                  </span>
                                )}
                              </div>
                              {i.acceptance === false && (
                                <p className="small danger">Student declined this employer</p>
                              )}
                              {editMatching && (
                                <div className="feedback-edit">
                                  <label>
                                    Student preference
                                    <select
                                      aria-label={`Student preference for ${i.student} at ${e.name}`}
                                      value={preference(i) ?? ''}
                                      onChange={(event) =>
                                        updateFeedback(i.student, i.index, {
                                          rank: Number(event.target.value)
                                        })
                                      }
                                    >
                                      <option value="">Not rated</option>
                                      {[1, 2, 3, 4, 5].map((n) => (
                                        <option key={n} value={n}>
                                          {n} / 5
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label>
                                    Employer response
                                    <select
                                      aria-label={`Employer response for ${i.student} at ${e.name}`}
                                      value={
                                        i.employerAccept === undefined
                                          ? ''
                                          : i.employerAccept
                                            ? 'yes'
                                            : 'no'
                                      }
                                      onChange={(event) =>
                                        updateFeedback(i.student, i.index, {
                                          employerAccept:
                                            event.target.value === ''
                                              ? undefined
                                              : event.target.value === 'yes'
                                        })
                                      }
                                    >
                                      <option value="">Pending</option>
                                      <option value="yes">Approved</option>
                                      <option value="no">Declined</option>
                                    </select>
                                  </label>
                                  <label>
                                    Student acceptance
                                    <select
                                      aria-label={`Student acceptance for ${i.student} at ${e.name}`}
                                      value={
                                        i.acceptance === undefined
                                          ? ''
                                          : i.acceptance
                                            ? 'yes'
                                            : 'no'
                                      }
                                      onChange={(event) =>
                                        updateFeedback(i.student, i.index, {
                                          acceptance:
                                            event.target.value === ''
                                              ? undefined
                                              : event.target.value === 'yes'
                                        })
                                      }
                                    >
                                      <option value="">Not recorded</option>
                                      <option value="yes">Yes</option>
                                      <option value="no">No</option>
                                    </select>
                                  </label>
                                </div>
                              )}
                              {selected && (
                                <details className="placement-explanation">
                                  <summary>Why this placement?</summary>
                                  <p>
                                    {i.student} rated {e.name} {i.rank}/5 and was approved by the
                                    employer. The placement fits within {e.capacity} internship
                                    places.
                                  </p>
                                  {[...(input.studentRatings.get(i.student) ?? [])]
                                    .filter(([name]) => name !== e.name)
                                    .map(([name]) => (
                                      <p key={name}>
                                        <strong>{name}:</strong>{' '}
                                        {explainAlternative(input, result, i.student, name)}
                                      </p>
                                    ))}
                                </details>
                              )}
                              {i.employerNotes && (
                                <details className="placement-explanation">
                                  <summary>Employer notes</summary>
                                  <p>{i.employerNotes}</p>
                                </details>
                              )}
                            </article>
                          )
                        })}
                      {!matchingFeedback.some((i) => i.business === e.name) && (
                        <p className="column-empty">
                          No feedback yet. Add an interview for this employer on Interview Schedule.
                        </p>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </section>
            {!!students.length && (editMatching || result.unmatchedStudents.length > 0) && (
              <section className="assignment-panel">
                <h2>{editMatching ? 'Student assignments' : 'Unmatched students'}</h2>
                {(editMatching ? students.map((s) => s.name) : result.unmatchedStudents).map(
                  (name) => (
                    <div className="assignment-row" key={name}>
                      <span>{name}</span>
                      {editMatching ? (
                        <select
                          aria-label={`Placement for ${name}`}
                          value={data.placements.find((p) => p.student === name)?.company ?? ''}
                          onChange={(e) => choosePlacement(name, e.target.value)}
                        >
                          <option value="">Unmatched</option>
                          {[...(input.studentRatings.get(name) ?? [])].map(([company]) => (
                            <option key={company} value={company}>
                              {company}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <details>
                          <summary>Why unmatched?</summary>
                          <p>
                            {!input.studentRatings.get(name)?.size
                              ? 'No active employer has approved, rated feedback for this student. Review feedback and employer participation.'
                              : 'This student has no placement in the current matching. Review employer capacity and feedback, or generate matching again.'}
                          </p>
                          {[...(input.studentRatings.get(name) ?? [])].map(([company]) => (
                            <p key={company}>
                              <strong>{company}:</strong>{' '}
                              {explainAlternative(input, result, name, company)}
                            </p>
                          ))}
                        </details>
                      )}
                    </div>
                  )
                )}
              </section>
            )}
          </>
        )}
        <footer className="workspace-footer">
          <span>Jefferson County internship workspace</span>
          <span>Inactive employers are always included in exports</span>
        </footer>
      </main>
      {confirmImport && (
        <Modal title="Import a different workbook" onClose={() => setConfirmImport(false)}>
          <p>
            A successful import replaces the current workspace, including employer status, feedback
            edits, schedules, and placements. Export first if you want to keep a copy.
          </p>
          <p>If import fails or you cancel the file picker, your workspace stays unchanged.</p>
          <div className="modal-actions">
            <button onClick={() => setConfirmImport(false)}>Keep current workspace</button>
            <button
              className="primary"
              onClick={() => {
                void importSheet()
              }}
            >
              Choose workbook
            </button>
          </div>
        </Modal>
      )}
      {employerForm && (
        <Modal
          title={employerForm === 'new' ? 'New employer' : 'Edit employer'}
          onClose={() => setEmployerForm(null)}
        >
          <form onSubmit={saveEmployer} noValidate>
            <label>
              Employer name
              <input
                autoFocus
                name="name"
                defaultValue={employerForm === 'new' ? '' : employerForm.name}
                readOnly={employerForm !== 'new'}
                placeholder="e.g. Frontier Aero"
              />
            </label>
            <IndustryPicker
              bank={industries}
              initial={
                employerForm === 'new' || !employerForm.industry ? [] : [employerForm.industry]
              }
              name="industry"
            />
            <label>
              Internship places
              <input
                name="capacity"
                aria-label="Internship places"
                type="number"
                min="0"
                step="1"
                defaultValue={employerForm === 'new' ? '0' : employerForm.capacity}
              />
              <span className="field-help">
                Use confirmed capacity. 0 means no places available for matching.
              </span>
            </label>
            <p className="small muted">
              Employers are kept in exports even when participation is turned off.
            </p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setEmployerForm(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save employer
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirmRegenerate && (
        <Modal title="Generate a new schedule" onClose={() => setConfirmRegenerate(false)}>
          <p>
            This replaces the current interview times and individual duration overrides. Your
            overall window and employer interview settings are kept.
          </p>
          <div className="modal-actions">
            <button onClick={() => setConfirmRegenerate(false)}>Keep current schedule</button>
            <button className="primary" onClick={generateInterviews}>
              Generate new schedule
            </button>
          </div>
        </Modal>
      )}
      {studentDetail && (
        <Modal title={studentDetail.name} onClose={() => setStudentDetail(null)}>
          <div className="student-detail-heading">
            <Avatar name={studentDetail.name} />
            <div>
              <strong>{studentDetail.school || 'School not provided'}</strong>
              <p>{studentDetail.interests?.join(', ') || 'Interests not provided'}</p>
            </div>
          </div>
          <form className="student-industry-form" onSubmit={saveStudentIndustries} noValidate>
            <IndustryPicker
              key={JSON.stringify(studentDetail.interests ?? [])}
              bank={industries}
              initial={studentDetail.interests ?? []}
              name="interests"
              multiple
            />
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button type="submit">Save industries</button>
          </form>
          <h3>Interview feedback</h3>
          {studentDetail.interviewResults.length ? (
            studentDetail.interviewResults.map((i, n) => (
              <div className="detail-interview" key={n}>
                <strong>{i.business}</strong>
                <span className="tag">
                  {preference(i) ? `${i.rank} / 5 student preference` : 'Not rated'}
                </span>
                <p>
                  {i.position || 'Position not provided'} · Round {i.wave}
                </p>
                <p>
                  Employer:{' '}
                  {i.employerAccept === undefined
                    ? 'Feedback pending'
                    : i.employerAccept
                      ? 'Approved'
                      : 'Declined'}{' '}
                  · Participation:{' '}
                  {data.employers.find((e) => e.name === i.business)?.active
                    ? 'Active'
                    : 'Inactive'}
                </p>
              </div>
            ))
          ) : (
            <p className="muted">No interviews recorded.</p>
          )}
          <div className="modal-actions">
            <button
              onClick={() => {
                setStudentDetail(null)
                changePage('matching')
              }}
            >
              Review matching
            </button>
            <button className="primary" onClick={() => setStudentDetail(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
