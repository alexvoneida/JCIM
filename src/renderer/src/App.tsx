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
import { canFill, matchInternships } from './matching'
import {
  canFillRole,
  employerCapacity,
  employerRoles,
  formatRoles,
  parseRoles,
  sameRole,
  sharedTags
} from '../../shared/roles'
import { explainAlternative } from './placement-explanation'

type Page = 'overview' | 'schedule' | 'matching' | 'employers'
type Notice = {
  kind: 'error' | 'warning'
  title: string
  detail?: string
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
  | 'check'
  | 'file'
  | 'close'
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
    check: <path d="m5 12 4 4L19 6" />,
    file: (
      <>
        <path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h8" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />
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

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
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
          (e.roles === undefined ||
            (Array.isArray(e.roles) &&
              e.roles.every(
                (r) =>
                  r &&
                  typeof r.title === 'string' &&
                  (r.tags === undefined ||
                    (Array.isArray(r.tags) && r.tags.every((t) => typeof t === 'string'))) &&
                  Number.isSafeInteger(r.capacity) &&
                  r.capacity >= 0
              ))) &&
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
          p.rating <= 5 &&
          (p.role === undefined || p.role === null || typeof p.role === 'string')
      )
    )
      throw new Error('The saved data is damaged or in an unsupported format.')
    return {
      workspace: rememberIndustries({ ...value, scheduleSettings: scheduleSettings(value) }),
      notice: null
    }
  } catch (error) {
    return {
      workspace: emptyWorkspace(),
      notice: {
        kind: 'error',
        title: 'Saved data could not be opened',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Import your latest exported workbook to restore it.'
      }
    }
  }
}

export default function App() {
  const [initial] = useState(restore)
  const [data, setData] = useState(initial.workspace)
  const [notice, setNotice] = useState<Notice | null>(initial.notice)
  const [page, setPage] = useState<Page>('overview')
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
  const [industryToRemove, setIndustryToRemove] = useState<string | null>(null)
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
  // One column per role. Employers without roles keep a single column. Students
  // whose interests fit none of an employer's roles get their own column.
  const matchingColumns = active.flatMap((e) => {
    const interviewed = matchingFeedback.filter((i) => i.business === e.name)
    const fits = (student: string, role: { title: string | null; tags: string[] }) =>
      canFillRole(data.students[student]?.interests, role)
    const roles = employerRoles(e)
    const columns: {
      key: string
      kind: 'role' | 'unfit'
      employer: Employer
      title: string | null
      tags: string[]
      capacity: number
      cards: typeof interviewed
    }[] = roles.map((role) => ({
      key: JSON.stringify([e.name, 'role', role.title]),
      kind: 'role',
      employer: e,
      title: role.title,
      tags: role.tags,
      capacity: role.capacity,
      cards: interviewed.filter((i) => fits(i.student, role))
    }))
    const unfit = interviewed.filter((i) => !roles.some((role) => fits(i.student, role)))
    if (unfit.length)
      columns.push({
        key: JSON.stringify([e.name, 'unfit']),
        kind: 'unfit',
        employer: e,
        title: null,
        tags: [],
        capacity: 0,
        cards: unfit
      })
    return columns
  })
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
      return true
    } catch (error) {
      setNotice({
        kind: 'error',
        title: 'Changes could not be saved',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Export a workbook before closing the app to keep your changes.'
      })
      return false
    }
  }
  function showError(error: SheetError | Omit<Notice, 'kind'>) {
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
        if (response.warnings.length)
          setNotice({
            kind: 'warning',
            title: `Imported with ${response.warnings.length} note${response.warnings.length === 1 ? '' : 's'}`,
            warnings: response.warnings
          })
        commit(response.data)
        changePage('overview')
      }
    } catch (error) {
      showError({
        title: 'Import failed',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Restart the app and try again. Your current data is unchanged.'
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
    } catch (error) {
      showError({
        title: 'Export failed',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Close the file in Excel if it is open, choose a folder you can write to, and try again.'
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
      setFormError(`An employer named “${name}” already exists.`)
      return
    }
    const parsedRoles = parseRoles(formValue(form, 'roles'))
    if (parsedRoles.error) {
      setFormError(parsedRoles.error)
      return
    }
    const roles = parsedRoles.roles
    if (!roles.length && (!capacityValue || !Number.isSafeInteger(capacity) || capacity < 0)) {
      setFormError('Capacity must be a whole number of 0 or more.')
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
      // Listed roles set the total capacity.
      capacity: roles.length ? roles.reduce((sum, r) => sum + r.capacity, 0) : capacity,
      roles: roles.length ? roles : undefined,
      active: employerForm === 'new' ? true : employerForm!.active,
      scheduling: employerForm === 'new' ? undefined : employerForm!.scheduling
    }
    commit({
      ...data,
      employers:
        employerForm === 'new'
          ? [...data.employers, employer]
          : data.employers.map((e) => (e.name === name ? employer : e)),
      placements: [],
      matchingApproved: false
    })
    setEmployerForm(null)
  }
  // Interests decide which roles a student can fill, so changing them invalidates the matching.
  function placementsAfterInterestChange(students: Workspace['students']) {
    const changed = Object.entries(students).some(
      ([name, s]) =>
        JSON.stringify(s.interests ?? []) !== JSON.stringify(data.students[name]?.interests ?? [])
    )
    return changed
      ? { placements: [], matchingApproved: false }
      : { placements: data.placements, matchingApproved: data.matchingApproved }
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
    const students = { ...data.students, [student.name]: student }
    commit({ ...data, students, ...placementsAfterInterestChange(students) })
    setStudentDetail(student)
    setFormError('')
  }
  function removeIndustry(industry: string) {
    const other = (value: string) =>
      industryName(value).toLowerCase() !== industryName(industry).toLowerCase()
    const students = Object.fromEntries(
      Object.entries(data.students).map(([name, student]) => [
        name,
        { ...student, interests: student.interests?.filter(other) } as Student
      ])
    )
    commit({
      ...data,
      industries: data.industries?.filter(other),
      employers: data.employers.map((e) => (other(e.industry) ? e : { ...e, industry: '' })),
      students,
      ...placementsAfterInterestChange(students)
    })
    if (studentDetail) setStudentDetail(students[studentDetail.name])
    if (!other(interest)) setInterest('')
    setIndustryToRemove(null)
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
          title: 'Nothing to schedule',
          detail: 'No interviews are linked to active employers.',
          fix: 'Activate employers on the Employers page, or add interviews with Edit schedule.'
        })
        return
      }
      commit({ ...data, schedule: interviews, scheduleApproved: false })
    } catch (error) {
      showError({
        title: 'Schedule could not be generated',
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Adjust the schedule window or employer interview settings and try again.'
      })
    }
  }
  function generateMatches() {
    if (!active.some((e) => employerCapacity(e) > 0)) {
      showError({
        title: 'No capacity available',
        detail: 'No active employer has capacity set.',
        fix: 'Set capacity on the Employers page.'
      })
      return
    }
    const matched = matchInternships(input)
    const saved = commit({ ...data, placements: matched.assignments, matchingApproved: false })
    if (saved && !matched.assignments.length)
      setNotice({
        kind: 'warning',
        title: 'No students could be matched',
        detail:
          'A match needs employer approval, a student rating, and open capacity at the employer.'
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
        title: 'Placement not eligible',
        detail: `${student} needs employer approval and a rating for ${employer}.`
      })
      return
    }
    // Use the first role this student fits that still has a free place.
    const fitting = input.roles.filter((r) => r.company === employer && canFill(input, student, r))
    const role = fitting.find(
      (r) =>
        remaining.filter((p) => p.company === employer && sameRole(p.role, r.title)).length <
        r.capacity
    )
    if (!role) {
      showError({
        title: 'Employer is full',
        detail: !fitting.length
          ? `${employer} has no role that matches ${student}’s interests.`
          : fitting.every((r) => r.title === null)
            ? `${employer} has reached its capacity.`
            : `${employer} has no free place in a role that fits ${student}.`
      })
      return
    }
    commit({
      ...data,
      placements: [...remaining, { student, company: employer, role: role.title, rating }],
      matchingApproved: false
    })
  }
  const nav: [Page, IconName, string][] = [
    ['overview', 'grid', 'Students'],
    ['schedule', 'calendar', 'Interview Schedule'],
    ['matching', 'link', 'Matching'],
    ['employers', 'building', 'Employers']
  ]
  const title = nav.find(([id]) => id === page)![2]
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
          <strong>Jeffco Internship Matching</strong>
        </div>
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
            </button>
          ))}
        </nav>
      </aside>
      <main className="main-content">
        <div className="workbook-toolbar">
          <div className="source">
            <Icon name="file" />
            <div>
              <strong>{data.sourceName ?? 'No workbook imported'}</strong>
              {data.importedAt && (
                <span>Imported {new Date(data.importedAt).toLocaleString()}</span>
              )}
            </div>
          </div>
          <div className="toolbar-actions">
            <button onClick={requestImport} disabled={!!busy}>
              <Icon name="import" />
              {busy === 'import' ? 'Importing…' : 'Import workbook'}
            </button>
            <button
              className="primary"
              onClick={() => {
                void exportSheet()
              }}
              disabled={!!busy || (!students.length && !data.employers.length)}
            >
              <Icon name="export" />
              {busy === 'export' ? 'Exporting…' : 'Export workbook'}
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
              {notice.detail && <p>{notice.detail}</p>}
              {notice.fix && <p>{notice.fix}</p>}
              {!!notice.warnings?.length && (
                <ul>
                  {notice.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
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
          <h1>{title}</h1>
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
                        detail: 'Set the interview date above the timetable, then approve.'
                      })
                      return
                    }
                    const issue = scheduleIssues(data)[0]
                    if (issue) {
                      showError({
                        title: 'Fix scheduling issues before approving',
                        detail: issue.detail
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
            {!!students.length && (
              <div className="section-toolbar">
                <strong>{students.length} students</strong>
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
            )}
            {!students.length ? (
              <Empty title="No students yet">
                <p>Import the internship tracker or a previous JCIM export (.xlsx).</p>
              </Empty>
            ) : !filteredStudents.length ? (
              <Empty title="No students found">
                <p>No students match the current search and filter.</p>
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
                      <h2>{s.name}</h2>
                      {[s.grade, s.school].some(Boolean) && (
                        <p>{[s.grade, s.school].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <div className="tags">
                      {s.interests?.length ? (
                        s.interests.map((i) => (
                          <span key={i} className="tag">
                            {i}
                          </span>
                        ))
                      ) : (
                        <span className="muted small">No interests listed</span>
                      )}
                    </div>
                    <div className="card-footer">
                      <span>
                        {s.interviewResults.length} interview
                        {s.interviewResults.length === 1 ? '' : 's'}
                      </span>
                      {data.placements.some((p) => p.student === s.name) && (
                        <span className="matched">Matched</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {page === 'employers' && (
          <>
            {!!data.employers.length && (
              <div className="section-toolbar">
                <div>
                  <strong>{data.employers.length} employers</strong>
                  <span className="muted">
                    {active.length} active · {active.reduce((n, e) => n + employerCapacity(e), 0)}{' '}
                    total capacity
                  </span>
                </div>
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
            )}
            {!data.employers.length ? (
              <Empty title="No employers yet">
                <p>Import a workbook or add an employer.</p>
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
                        <h2>{e.name}</h2>
                        {e.industry && <p>{e.industry}</p>}
                      </div>
                      <div className="employer-numbers">
                        <div>
                          <span>Capacity</span>
                          <strong>{employerCapacity(e)}</strong>
                        </div>
                        <div>
                          <span>Interviews</span>
                          <strong>{feedback.filter((i) => i.business === e.name).length}</strong>
                        </div>
                      </div>
                      {!!e.roles?.length && (
                        <p className="capacity-note">Roles: {formatRoles(e.roles)}</p>
                      )}
                      {employerCapacity(e) === 0 && e.active && (
                        <p className="capacity-note">No capacity set</p>
                      )}
                      <div className="employer-bottom">
                        <button
                          aria-label={`Edit ${e.name}`}
                          onClick={() => {
                            setEmployerForm(e)
                            setFormError('')
                          }}
                        >
                          Edit
                        </button>
                        <label className="switch-label">
                          <span>Active</span>
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
                ['Matched students', `${data.placements.length} of ${students.length}`]
              ]}
            />
            <details className="matching-rules">
              <summary>How matching works</summary>
              <p>
                Each student is placed with at most one active employer, within that employer’s
                capacity. A placement requires employer approval and a student rating. Students do
                not decline; a low rating (1/5) means less interest. Matching places as many
                students as possible, then maximizes the total of student ratings (1–5).
              </p>
            </details>
            <section className="board">
              <div className="board-heading">
                <strong>Employer feedback</strong>
                <span className={`status-dot ${data.matchingApproved ? 'approved' : ''}`}>
                  {data.matchingApproved ? 'Approved' : 'Awaiting approval'}
                </span>
              </div>
              {!active.length ? (
                <Empty title="No active employers">
                  <p>Import a workbook or activate employers on the Employers page.</p>
                </Empty>
              ) : (
                <div className="company-columns">
                  {matchingColumns.map(
                    ({ key, kind, employer: e, title, tags, capacity, cards }) => {
                      const unfit = kind === 'unfit'
                      // Labels name the role so a student listed under two roles stays distinct.
                      const where = `${e.name}${title ? ` (${title})` : unfit ? ' (no matching role)' : ''}`
                      return (
                        <section
                          className={`company-column ${title ? 'role-column' : ''} ${unfit ? 'unfit-column' : ''}`}
                          key={key}
                        >
                          <div className="company-heading">
                            <h2>{e.name}</h2>
                            {title && <p className="role-name">{title}</p>}
                            {unfit ? (
                              <p>Interests match no role</p>
                            ) : (
                              <p>
                                {
                                  data.placements.filter(
                                    (p) => p.company === e.name && sameRole(p.role, title)
                                  ).length
                                }{' '}
                                of {capacity} filled
                              </p>
                            )}
                          </div>
                          {[...cards]
                            .sort((a, b) => b.rank - a.rank)
                            .map((i) => {
                              const selected =
                                !unfit &&
                                data.placements.some(
                                  (p) =>
                                    p.student === i.student &&
                                    p.company === e.name &&
                                    sameRole(p.role, title)
                                )
                              return (
                                <article
                                  className={`feedback-card ${selected ? 'selected' : ''} ${i.employerAccept ? '' : i.employerAccept === false ? 'declined' : 'pending'}`}
                                  key={`${i.student}-${i.index}`}
                                >
                                  <div className="feedback-heading">
                                    <h3>{i.student}</h3>
                                    <span
                                      className="rating"
                                      aria-label={`Student rating ${preference(i) ?? 'not rated'}`}
                                    >
                                      {preference(i) ? `${preference(i)}/5` : 'Not rated'}
                                    </span>
                                  </div>
                                  <div className="feedback-status">
                                    <span
                                      className={`feedback-state ${i.employerAccept ? 'approved' : i.employerAccept === false ? 'declined' : ''}`}
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
                                  {editMatching && (
                                    <div className="feedback-edit">
                                      <label>
                                        Student rating
                                        <select
                                          aria-label={`Student rating for ${i.student} at ${where}`}
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
                                          aria-label={`Employer response for ${i.student} at ${where}`}
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
                                    </div>
                                  )}
                                  {selected && (
                                    <details className="placement-explanation">
                                      <summary>Why this placement?</summary>
                                      <p>
                                        {i.student} rated {e.name} {i.rank}/5 and was approved by
                                        the employer.
                                      </p>
                                      {title &&
                                        (() => {
                                          const shared = sharedTags(
                                            data.students[i.student]?.interests,
                                            { tags }
                                          )
                                          return (
                                            <p>
                                              {i.student} and the {title} role both share the tag
                                              {shared.length === 1 ? '' : 's'}{' '}
                                              {shared.map((t, n) => (
                                                <span key={t}>
                                                  {n > 0 &&
                                                    (n === shared.length - 1 ? ' and ' : ', ')}
                                                  <strong>{t}</strong>
                                                </span>
                                              ))}
                                              .
                                            </p>
                                          )
                                        })()}
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
                          {!cards.length && (
                            <p className="column-empty">
                              {title ? 'No students match this role yet.' : 'No students yet.'}
                            </p>
                          )}
                        </section>
                      )
                    }
                  )}
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
                              ? 'No active employer has both approved this student and been rated by them.'
                              : 'Not placed in the current matching.'}
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
      </main>
      {confirmImport && (
        <Modal title="Replace current data?" onClose={() => setConfirmImport(false)}>
          <p>
            Importing replaces all current students, employers, schedules, and matches. Export first
            to keep a copy.
          </p>
          <div className="modal-actions">
            <button onClick={() => setConfirmImport(false)}>Cancel</button>
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
              Capacity
              <input
                name="capacity"
                aria-label="Capacity"
                aria-describedby="capacity-help"
                type="number"
                min="0"
                step="1"
                defaultValue={employerForm === 'new' ? '0' : employerForm.capacity}
              />
              <span className="field-help" id="capacity-help">
                Number of interns this employer can take.
              </span>
            </label>
            <label>
              Roles (optional)
              <input
                name="roles"
                aria-label="Roles"
                aria-describedby="roles-help"
                placeholder="Engineering: 2, HR [Human Resources]: 1"
                defaultValue={employerForm === 'new' ? '' : formatRoles(employerForm.roles)}
              />
              <span className="field-help" id="roles-help">
                List roles as Title [tags]: places, e.g. “Engineering: 2, HR [Human Resources]: 1”.
                A student can only fill a role when one of their interests matches its tags (the
                title, if no tags are given). Leave blank if any approved student can fill any
                place. When roles are listed, capacity is their total.
              </span>
            </label>
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
        <Modal title="Replace the current schedule?" onClose={() => setConfirmRegenerate(false)}>
          <p>
            All interview times and per-interview length overrides will be replaced. Schedule and
            employer settings are kept.
          </p>
          <div className="modal-actions">
            <button onClick={() => setConfirmRegenerate(false)}>Cancel</button>
            <button className="primary" onClick={generateInterviews}>
              Replace schedule
            </button>
          </div>
        </Modal>
      )}
      {studentDetail && (
        <Modal title={studentDetail.name} onClose={() => setStudentDetail(null)}>
          {[studentDetail.grade, studentDetail.school].some(Boolean) && (
            <p className="student-detail-heading">
              {[studentDetail.grade, studentDetail.school].filter(Boolean).join(' · ')}
            </p>
          )}
          <form className="student-industry-form" onSubmit={saveStudentIndustries} noValidate>
            <IndustryPicker
              key={JSON.stringify(studentDetail.interests ?? [])}
              bank={industries}
              initial={studentDetail.interests ?? []}
              name="interests"
              multiple
              onRemove={setIndustryToRemove}
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
                <strong>
                  {i.business}
                  {!data.employers.find((e) => e.name === i.business)?.active && ' (inactive)'}
                </strong>
                <p>{[i.position, `Round ${i.wave}`].filter(Boolean).join(' · ')}</p>
                <p>
                  Student rating: {preference(i) ? `${i.rank}/5` : 'Not rated'} · Employer:{' '}
                  {i.employerAccept === undefined
                    ? 'Pending'
                    : i.employerAccept
                      ? 'Approved'
                      : 'Declined'}
                </p>
              </div>
            ))
          ) : (
            <p className="muted">No interviews recorded.</p>
          )}
          <div className="modal-actions">
            <button className="primary" onClick={() => setStudentDetail(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {industryToRemove && (
        <Modal title={`Remove “${industryToRemove}”?`} onClose={() => setIndustryToRemove(null)}>
          <p>
            This removes the industry from{' '}
            {countLabel(
              students.filter((s) => s.interests?.includes(industryToRemove)).length,
              'student'
            )}{' '}
            and{' '}
            {countLabel(
              data.employers.filter((e) => e.industry === industryToRemove).length,
              'employer'
            )}
            , and from the list of options.
          </p>
          <div className="modal-actions">
            <button onClick={() => setIndustryToRemove(null)}>Cancel</button>
            <button className="danger" onClick={() => removeIndustry(industryToRemove)}>
              Remove industry
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
