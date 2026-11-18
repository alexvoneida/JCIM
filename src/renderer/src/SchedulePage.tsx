import { useState, type DragEvent, type FormEvent } from 'react'
import type { Employer, ScheduledInterview, Wave, Workspace } from '../../shared/workspace'
import {
  defaultRounds,
  employerSettingsError,
  sameName,
  scheduleConflict,
  scheduleIssues,
  scheduleWarnings,
  studentsPerRound,
  waveError,
  withFeedbackRows
} from '../../shared/scheduling'
import Modal from './Modal'

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z" />
    </svg>
  )
}
function field(form: FormData, name: string) {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}
function chosen(form: FormData, name: string): string[] {
  return form.getAll(name).filter((value): value is string => typeof value === 'string')
}
const count = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`

// Light fills that keep dark text readable. Schools take them in alphabetical order.
const schoolFills = [
  '#f3dfb8',
  '#dcd3ef',
  '#dbe9cf',
  '#cfe0f3',
  '#f6d2cf',
  '#fbe9b4',
  '#cde9e3',
  '#f0d4ec',
  '#d9dde3',
  '#e6f0c2',
  '#f9dcc4',
  '#d7e4f7'
]

type InterviewDraft = {
  interview?: ScheduledInterview
  employer?: string
  wave?: string
  round?: number
}
type Cell = { wave: string; round: number; employer: string }

export default function SchedulePage({
  data,
  onChange,
  editSchedule,
  onGenerate
}: {
  data: Workspace
  onChange: (next: Workspace) => boolean
  editSchedule: boolean
  onGenerate: () => void
}) {
  const [waveEditor, setWaveEditor] = useState<Wave | 'new' | null>(null)
  const [waveToRemove, setWaveToRemove] = useState<Wave | null>(null)
  const [employerEditor, setEmployerEditor] = useState<Employer | null>(null)
  const [interviewEditor, setInterviewEditor] = useState<InterviewDraft | null>(null)
  const [error, setError] = useState('')
  const [dropError, setDropError] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const employers = data.employers.filter((e) => e.active)
  const students = Object.values(data.students)
  const issues = scheduleIssues(data)
  const warnings = scheduleWarnings(data)
  const schools = [
    ...new Set(students.map((s) => s.school?.trim()).filter((s): s is string => !!s))
  ].sort((a, b) => a.localeCompare(b))
  const schoolFill = (school: string | undefined) => {
    const index = school ? schools.findIndex((s) => sameName(s, school)) : -1
    return index === -1 ? undefined : schoolFills[index % schoolFills.length]
  }
  const dateLabel = data.interviewDate
    ? new Date(`${data.interviewDate}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      })
    : 'No interview date set'
  const cellKey = (cell: Cell) => JSON.stringify([cell.wave, cell.round, cell.employer])
  const interviewsIn = (cell: Cell) =>
    data.schedule.filter(
      (i) => i.wave === cell.wave && i.round === cell.round && i.employer === cell.employer
    )

  function placeInterview(interview: ScheduledInterview, replacing: boolean): string | undefined {
    const conflict = scheduleConflict(data.schedule, interview, data)
    if (conflict) return conflict
    onChange({
      ...data,
      students: withFeedbackRows(data, [interview], data.waves),
      schedule: replacing
        ? data.schedule.map((i) => (i.id === interview.id ? interview : i))
        : [...data.schedule, interview],
      scheduleApproved: false
    })
  }
  function saveInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!interviewEditor) return
    const form = new FormData(event.currentTarget)
    const interview: ScheduledInterview = {
      id: interviewEditor.interview?.id ?? crypto.randomUUID(),
      student: field(form, 'student'),
      employer: field(form, 'employer'),
      wave: field(form, 'wave'),
      round: Number(field(form, 'round'))
    }
    const invalid = placeInterview(interview, !!interviewEditor.interview)
    if (invalid) {
      setError(invalid)
      return
    }
    setInterviewEditor(null)
  }
  function dropOn(cell: Cell, event: DragEvent<HTMLTableCellElement>) {
    event.preventDefault()
    const id = event.dataTransfer?.getData('text/plain') || dragging
    setDragging(null)
    setDragOver(null)
    const interview = id ? data.schedule.find((i) => i.id === id) : undefined
    if (!interview || !editSchedule) return
    if (
      interview.wave === cell.wave &&
      interview.round === cell.round &&
      interview.employer === cell.employer
    )
      return
    setDropError(placeInterview({ ...interview, ...cell }, true) ?? '')
  }
  function saveWave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!waveEditor) return
    const form = new FormData(event.currentTarget)
    const wave: Wave = {
      name: field(form, 'name').replace(/\s+/g, ' '),
      rounds: Number(field(form, 'rounds')),
      schools: chosen(form, 'schools'),
      students: chosen(form, 'students')
    }
    const invalid = waveError(wave)
    if (invalid) {
      setError(invalid)
      return
    }
    const previous = waveEditor === 'new' ? undefined : waveEditor.name
    if (data.waves.some((w) => w.name !== previous && sameName(w.name, wave.name))) {
      setError(`A wave named “${wave.name}” already exists.`)
      return
    }
    // A school or student belongs to one wave, so the latest placement wins.
    const strip = (other: Wave): Wave => ({
      ...other,
      schools: other.schools.filter((s) => !wave.schools.some((picked) => sameName(picked, s))),
      students: other.students.filter((s) => !wave.students.includes(s))
    })
    onChange({
      ...data,
      waves:
        waveEditor === 'new'
          ? [...data.waves.map(strip), wave]
          : data.waves.map((w) => (w.name === previous ? wave : strip(w))),
      schedule:
        previous && previous !== wave.name
          ? data.schedule.map((i) => (i.wave === previous ? { ...i, wave: wave.name } : i))
          : data.schedule,
      scheduleApproved: false
    })
    setWaveEditor(null)
  }
  function removeWave(wave: Wave) {
    onChange({
      ...data,
      waves: data.waves.filter((w) => w.name !== wave.name),
      schedule: data.schedule.filter((i) => i.wave !== wave.name),
      scheduleApproved: false
    })
    setWaveToRemove(null)
    setWaveEditor(null)
  }
  function saveEmployer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!employerEditor) return
    const form = new FormData(event.currentTarget)
    const employer: Employer = {
      ...employerEditor,
      scheduling: { studentsPerRound: Number(field(form, 'limit')) }
    }
    const invalid = employerSettingsError(employer)
    if (invalid) {
      setError(invalid)
      return
    }
    onChange({
      ...data,
      employers: data.employers.map((e) => (e.name === employer.name ? employer : e)),
      scheduleApproved: false
    })
    setEmployerEditor(null)
  }
  function open<T>(setter: (value: T) => void, value: T) {
    setter(value)
    setError('')
  }
  return (
    <>
      <div className="schedule-summary">
        <div className="stats">
          <div className="stat">
            <span>Interviews</span>
            <strong>{data.schedule.length}</strong>
          </div>
          <div className="stat">
            <span>Active employers</span>
            <strong>{employers.length}</strong>
          </div>
          <div className="stat">
            <span>Waves</span>
            <strong>{data.waves.length}</strong>
          </div>
        </div>
        <button onClick={() => open(setWaveEditor, 'new')}>New wave</button>
      </div>
      <div className="section-toolbar">
        <label className="date-field">
          Interview date
          <input
            type="date"
            aria-label="Interview date"
            value={data.interviewDate}
            onChange={(e) =>
              onChange({ ...data, interviewDate: e.target.value, scheduleApproved: false })
            }
          />
        </label>
        {editSchedule && (
          <button
            onClick={() => open(setInterviewEditor, {})}
            disabled={!students.length || !employers.length || !data.waves.length}
          >
            Add interview
          </button>
        )}
      </div>
      {!!issues.length && (
        <section className="notice error schedule-issues" role="alert">
          <div>
            <strong>{count(issues.length, 'scheduling issue')}</strong>
            <ul>
              {issues.map((issue, index) => (
                <li key={`${issue.id ?? issue.employer ?? issue.wave ?? 'settings'}-${index}`}>
                  {issue.detail}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {!!warnings.length && (
        <section className="notice warning schedule-issues" role="status">
          <div>
            <strong>{count(warnings.length, 'wave placement note')}</strong>
            <ul>
              {warnings.map((warning) => (
                <li key={warning.id}>{warning.detail}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {dropError && (
        <p className="form-error" role="alert">
          {dropError}
        </p>
      )}
      <section className="board schedule-board">
        <div className="board-heading">
          <strong>{dateLabel}</strong>
          <span className={`status-dot ${data.scheduleApproved ? 'approved' : ''}`}>
            {data.scheduleApproved ? 'Approved' : 'Awaiting approval'}
          </span>
        </div>
        {!employers.length ? (
          <div className="empty">
            <h2>No active employers</h2>
            <p>Import a workbook or activate employers on the Employers page.</p>
          </div>
        ) : !data.waves.length ? (
          <div className="empty">
            <h2>No waves yet</h2>
            <p>
              Generate schedule gives every student three interviews in Wave 1. Add a wave first to
              choose which schools and students belong to it.
            </p>
          </div>
        ) : (
          <>
            {!!schools.length && (
              <ul className="school-legend" aria-label="School colors">
                {schools.map((school) => (
                  <li key={school}>
                    <span className="school-swatch" style={{ background: schoolFill(school) }} />
                    {school}
                  </li>
                ))}
              </ul>
            )}
            <div className="wave-scroll" tabIndex={0} aria-label="Interview schedule">
              <table className="wave-grid">
                <thead>
                  <tr>
                    <th scope="col" className="round-heading">
                      Round
                    </th>
                    {employers.map((employer) => (
                      <th scope="col" key={employer.name} className="wave-employer">
                        <div className="wave-employer-name">
                          <h2>{employer.name}</h2>
                          <button
                            className="icon-button"
                            aria-label={`Edit interview settings for ${employer.name}`}
                            onClick={() => open(setEmployerEditor, employer)}
                          >
                            <EditIcon />
                          </button>
                        </div>
                        {!!employer.roles?.length && (
                          <p>{employer.roles.map((r) => r.title).join(', ')}</p>
                        )}
                        <p className="wave-employer-settings">
                          {studentsPerRound(employer)} per round
                        </p>
                      </th>
                    ))}
                  </tr>
                </thead>
                {data.waves.map((wave) => (
                  <tbody key={wave.name} data-wave={wave.name}>
                    <tr className="wave-row">
                      <th scope="rowgroup" colSpan={employers.length + 1}>
                        <div className="wave-heading">
                          <strong>{wave.name}</strong>
                          <span>
                            {count(wave.rounds, 'round')} ·{' '}
                            {wave.schools.length
                              ? `Schools: ${wave.schools.join(', ')}`
                              : 'No schools placed'}
                            {wave.students.length ? ` · Students: ${wave.students.join(', ')}` : ''}
                          </span>
                          <button
                            className="icon-button"
                            aria-label={`Edit ${wave.name}`}
                            onClick={() => open(setWaveEditor, wave)}
                          >
                            <EditIcon />
                          </button>
                        </div>
                      </th>
                    </tr>
                    {Array.from({ length: wave.rounds }, (_, index) => index + 1).map((round) => (
                      <tr key={round} className="round-row">
                        <th scope="row" className="round-label">
                          Round {round}
                        </th>
                        {employers.map((employer) => {
                          const cell = { wave: wave.name, round, employer: employer.name }
                          const key = cellKey(cell)
                          return (
                            <td
                              key={employer.name}
                              className={`schedule-cell ${dragOver === key ? 'drag-over' : ''}`}
                              data-wave={wave.name}
                              data-round={round}
                              data-employer={employer.name}
                              onDragOver={(e) => {
                                if (!editSchedule) return
                                e.preventDefault()
                                if (dragOver !== key) setDragOver(key)
                              }}
                              onDragLeave={() => {
                                if (dragOver === key) setDragOver(null)
                              }}
                              onDrop={(e) => dropOn(cell, e)}
                            >
                              {interviewsIn(cell).map((interview) => {
                                const conflict = issues.find((i) => i.id === interview.id)?.detail
                                const warning = warnings.find((w) => w.id === interview.id)?.detail
                                const school = data.students[interview.student]?.school
                                return (
                                  <div
                                    key={interview.id}
                                    className={`student-chip ${conflict ? 'has-conflict' : warning ? 'has-warning' : ''}`}
                                    data-interview-id={interview.id}
                                    data-student={interview.student}
                                    style={{ background: schoolFill(school) }}
                                    title={conflict ?? warning ?? school}
                                    draggable={editSchedule}
                                    onDragStart={(e) => {
                                      e.dataTransfer?.setData('text/plain', interview.id)
                                      setDragging(interview.id)
                                      setDropError('')
                                    }}
                                    onDragEnd={() => {
                                      setDragging(null)
                                      setDragOver(null)
                                    }}
                                  >
                                    <span>{interview.student}</span>
                                    {editSchedule && (
                                      <button
                                        className="icon-button"
                                        aria-label={`Edit interview for ${interview.student} at ${employer.name}, ${wave.name} round ${round}`}
                                        onClick={() => open(setInterviewEditor, { interview })}
                                      >
                                        <EditIcon />
                                      </button>
                                    )}
                                  </div>
                                )
                              })}
                              {editSchedule && (
                                <button
                                  className="slot-add"
                                  aria-label={`Add interview with ${employer.name} in ${wave.name} round ${round}`}
                                  onClick={() =>
                                    open(setInterviewEditor, {
                                      employer: employer.name,
                                      wave: wave.name,
                                      round
                                    })
                                  }
                                >
                                  +
                                </button>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </>
        )}
        {!data.schedule.length && !!employers.length && (
          <div className="schedule-empty-bar">
            <span>No interviews scheduled.</span>
            <button onClick={onGenerate}>Generate schedule</button>
          </div>
        )}
      </section>
      {waveEditor && (
        <Modal
          title={waveEditor === 'new' ? 'New wave' : `Edit ${waveEditor.name}`}
          onClose={() => setWaveEditor(null)}
        >
          <form onSubmit={saveWave} noValidate>
            <div className="schedule-form-grid">
              <label>
                Wave name
                <input
                  name="name"
                  defaultValue={
                    waveEditor === 'new' ? `Wave ${data.waves.length + 1}` : waveEditor.name
                  }
                />
              </label>
              <label>
                Rounds
                <input
                  type="number"
                  name="rounds"
                  min="1"
                  max="50"
                  step="1"
                  defaultValue={waveEditor === 'new' ? defaultRounds : waveEditor.rounds}
                />
              </label>
            </div>
            <fieldset className="placement-list">
              <legend>Schools in this wave</legend>
              {schools.length ? (
                schools.map((school) => (
                  <label key={school}>
                    <input
                      type="checkbox"
                      name="schools"
                      value={school}
                      defaultChecked={
                        waveEditor !== 'new' && waveEditor.schools.some((s) => sameName(s, school))
                      }
                    />
                    {school}
                  </label>
                ))
              ) : (
                <p className="field-help">No schools are recorded for students yet.</p>
              )}
            </fieldset>
            <fieldset className="placement-list">
              <legend>Students in this wave</legend>
              <p className="field-help">
                A student listed here goes in this wave whatever their school.
              </p>
              {students.map((student) => (
                <label key={student.name}>
                  <input
                    type="checkbox"
                    name="students"
                    value={student.name}
                    defaultChecked={
                      waveEditor !== 'new' && waveEditor.students.includes(student.name)
                    }
                  />
                  {student.name}
                </label>
              ))}
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              {waveEditor !== 'new' && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => setWaveToRemove(waveEditor)}
                >
                  Remove wave
                </button>
              )}
              <button type="button" onClick={() => setWaveEditor(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save wave
              </button>
            </div>
          </form>
        </Modal>
      )}
      {waveToRemove && (
        <Modal title={`Remove ${waveToRemove.name}?`} onClose={() => setWaveToRemove(null)}>
          <p>
            {count(
              data.schedule.filter((i) => i.wave === waveToRemove.name).length,
              'scheduled interview'
            )}{' '}
            in this wave will be removed, along with its school and student placements.
          </p>
          <div className="modal-actions">
            <button onClick={() => setWaveToRemove(null)}>Cancel</button>
            <button className="danger" onClick={() => removeWave(waveToRemove)}>
              Remove wave
            </button>
          </div>
        </Modal>
      )}
      {employerEditor && (
        <Modal
          title={`Interview settings for ${employerEditor.name}`}
          onClose={() => setEmployerEditor(null)}
        >
          <form onSubmit={saveEmployer} noValidate>
            <label>
              Students per round
              <input
                type="number"
                min="1"
                step="1"
                name="limit"
                aria-label="Students per round"
                aria-describedby="limit-help"
                defaultValue={studentsPerRound(employerEditor)}
              />
              <span className="field-help" id="limit-help">
                How many students {employerEditor.name} can interview in one round. This is separate
                from internship places.
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setEmployerEditor(null)}>
                Cancel
              </button>
              <button className="primary" type="submit">
                Save employer settings
              </button>
            </div>
          </form>
        </Modal>
      )}
      {interviewEditor && (
        <Modal
          title={interviewEditor.interview ? 'Edit interview' : 'Add interview'}
          onClose={() => setInterviewEditor(null)}
        >
          <form onSubmit={saveInterview} noValidate>
            <label>
              Student
              <select
                name="student"
                aria-label="Student"
                defaultValue={interviewEditor.interview?.student}
              >
                {students.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Employer
              <select
                name="employer"
                aria-label="Employer"
                defaultValue={interviewEditor.interview?.employer ?? interviewEditor.employer}
              >
                {employers.map((e) => (
                  <option key={e.name}>{e.name}</option>
                ))}
              </select>
            </label>
            <div className="schedule-form-grid">
              <label>
                Wave
                <select
                  name="wave"
                  aria-label="Wave"
                  defaultValue={interviewEditor.interview?.wave ?? interviewEditor.wave}
                >
                  {data.waves.map((w) => (
                    <option key={w.name}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Round
                <input
                  type="number"
                  name="round"
                  min="1"
                  step="1"
                  defaultValue={interviewEditor.interview?.round ?? interviewEditor.round ?? 1}
                />
              </label>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              {interviewEditor.interview && (
                <button
                  className="danger"
                  type="button"
                  onClick={() => {
                    onChange({
                      ...data,
                      schedule: data.schedule.filter((i) => i.id !== interviewEditor.interview!.id),
                      scheduleApproved: false
                    })
                    setInterviewEditor(null)
                  }}
                >
                  Remove from schedule
                </button>
              )}
              <button type="button" onClick={() => setInterviewEditor(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save interview
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
