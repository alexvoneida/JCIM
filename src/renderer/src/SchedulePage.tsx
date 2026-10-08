import { useState, type FormEvent, type CSSProperties } from 'react'
import type {
  Employer,
  EmployerScheduling,
  ScheduledInterview,
  ScheduleSettings,
  Workspace
} from '../../shared/workspace'
import type { Student } from '../../shared/student'
import { InterviewResult } from '../../shared/interviewResult'
import {
  clockTime,
  employerSchedule,
  employerSettingsError,
  interviewDuration,
  minutes,
  scheduleConflict,
  scheduleIssues,
  scheduleSettings,
  settingsError,
  timeLabel
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
function optionalNumber(form: FormData, name: string) {
  const value = field(form, name)
  return value ? Number(value) : undefined
}

type InterviewDraft = { interview?: ScheduledInterview; employer?: string; time?: string }

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
  const [settingsEditor, setSettingsEditor] = useState<'overall' | Employer | null>(null)
  const [interviewEditor, setInterviewEditor] = useState<InterviewDraft | null>(null)
  const [error, setError] = useState('')
  const global = scheduleSettings(data)
  const employers = data.employers.filter((e) => e.active)
  const students = Object.values(data.students)
  const issues = scheduleIssues(data)
  const dateLabel = data.interviewDate
    ? new Date(`${data.interviewDate}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      })
    : 'Choose an interview date'
  const minuteMarks = new Set<number>([minutes(global.start), minutes(global.end)])
  for (
    let time = minutes(global.start);
    time < minutes(global.end);
    time += Math.max(1, global.durationMinutes)
  )
    minuteMarks.add(time)
  for (const employer of employers) {
    const config = employerSchedule(data, employer)
    minuteMarks.add(minutes(config.start))
    minuteMarks.add(minutes(config.end))
  }
  for (const i of data.schedule) {
    minuteMarks.add(minutes(i.time))
    minuteMarks.add(minutes(i.time) + interviewDuration(data, i))
  }
  const marks = [...minuteMarks].filter(Number.isFinite).sort((a, b) => a - b)
  const smallestDuration = Math.min(
    global.durationMinutes,
    ...data.schedule.map((i) => interviewDuration(data, i))
  )
  const pixelsPerMinute = Math.max(4, Math.min(20, 120 / Math.max(1, smallestDuration)))
  const layout = employers.map((employer) => {
    const ends: number[] = []
    const interviews = data.schedule
      .filter((i) => i.employer === employer.name)
      .sort((a, b) => minutes(a.time) - minutes(b.time))
    const positioned = interviews.map((interview) => {
      let lane = ends.findIndex((end) => end <= minutes(interview.time))
      if (lane === -1) lane = ends.length
      ends[lane] = minutes(interview.time) + interviewDuration(data, interview)
      return { interview, lane }
    })
    return { employer, positioned, lanes: Math.max(1, ends.length) }
  })
  const gridStyle: CSSProperties = {
    minWidth: 96 + layout.reduce((total, item) => total + Math.max(230, item.lanes * 160), 0),
    gridTemplateColumns: `96px ${layout.map((item) => `minmax(${Math.max(230, item.lanes * 160)}px, 1fr)`).join(' ')}`,
    gridTemplateRows: `112px ${marks
      .slice(0, -1)
      .map((time, index) => `${Math.max(24, (marks[index + 1] - time) * pixelsPerMinute)}px`)
      .join(' ')} 32px`
  }
  function openSettings(value: 'overall' | Employer) {
    setSettingsEditor(value)
    setError('')
  }
  function openInterview(value: InterviewDraft) {
    setInterviewEditor(value)
    setError('')
  }
  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settingsEditor) return
    const form = new FormData(event.currentTarget)
    if (settingsEditor === 'overall') {
      const settings: ScheduleSettings = {
        start: field(form, 'start'),
        end: field(form, 'end'),
        durationMinutes: Number(field(form, 'duration'))
      }
      const invalid = settingsError(settings)
      if (invalid) {
        setError(invalid)
        return
      }
      onChange({ ...data, scheduleSettings: settings, scheduleApproved: false })
    } else {
      const scheduling: EmployerScheduling = {
        start: field(form, 'start') || undefined,
        end: field(form, 'end') || undefined,
        durationMinutes: optionalNumber(form, 'duration'),
        parallelInterviews: optionalNumber(form, 'parallel')
      }
      const employer = { ...settingsEditor, scheduling }
      const invalid = employerSettingsError(data, employer)
      if (invalid) {
        setError(invalid)
        return
      }
      onChange({
        ...data,
        employers: data.employers.map((e) => (e.name === employer.name ? employer : e)),
        scheduleApproved: false
      })
    }
    setSettingsEditor(null)
  }
  function saveInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!interviewEditor) return
    const form = new FormData(event.currentTarget)
    const student = field(form, 'student'),
      employer = field(form, 'employer')
    const round = Number(field(form, 'round'))
    if (!Number.isSafeInteger(round) || round < 1) {
      setError('Round must be a whole number of 1 or more.')
      return
    }
    const durationValue = field(form, 'duration')
    const interview: ScheduledInterview = {
      id: interviewEditor.interview?.id ?? crypto.randomUUID(),
      student,
      employer,
      time: field(form, 'time'),
      round,
      durationMinutes: durationValue ? Number(durationValue) : undefined
    }
    if (
      data.schedule.some(
        (i) =>
          i.id !== interview.id &&
          i.student === student &&
          i.employer === employer &&
          i.round === round
      )
    ) {
      setError(
        `${student} already has round ${round} with ${employer}. Edit that interview, or choose a different round.`
      )
      return
    }
    const invalid = scheduleConflict(data.schedule, interview, data)
    if (invalid) {
      setError(invalid)
      return
    }
    const original = data.students[student]
    const updated = original.interviewResults.some((i) => i.business === employer)
      ? original
      : ({
          ...original,
          interviewResults: [
            ...original.interviewResults,
            new InterviewResult(student, String(round), employer, '', '', '', '', '0')
          ]
        } as Student)
    onChange({
      ...data,
      students: { ...data.students, [student]: updated },
      schedule: interviewEditor.interview
        ? data.schedule.map((i) => (i.id === interview.id ? interview : i))
        : [...data.schedule, interview],
      scheduleApproved: false
    })
    setInterviewEditor(null)
  }
  const editorEmployer = settingsEditor && settingsEditor !== 'overall' ? settingsEditor : null
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
        </div>
        <button
          className="schedule-settings-button"
          onClick={() => openSettings('overall')}
          aria-label="Edit schedule window and interview length"
        >
          <div>
            <span>Schedule window</span>
            <strong>
              {timeLabel(global.start)} – {timeLabel(global.end)}
            </strong>
          </div>
          <div>
            <span>Default interview length</span>
            <strong>{global.durationMinutes} minutes</strong>
          </div>
          <EditIcon />
        </button>
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
            onClick={() => openInterview({})}
            disabled={!students.length || !employers.length}
          >
            ＋ Add interview
          </button>
        )}
      </div>
      {!!issues.length && (
        <section className="notice error schedule-issues" role="alert">
          <div>
            <strong>
              {issues.length} scheduling issue{issues.length === 1 ? '' : 's'} need attention
            </strong>
            <p>
              Your interviews were kept. Edit the highlighted interviews or the settings before
              approving or exporting.
            </p>
            <details open>
              <summary>Show scheduling issues</summary>
              <ul>
                {issues.map((issue, index) => (
                  <li key={`${issue.id ?? 'settings'}-${index}`}>{issue.detail}</li>
                ))}
              </ul>
            </details>
          </div>
        </section>
      )}
      <section className="board schedule-board">
        <div className="board-heading">
          <strong>INTERVIEW TIMETABLE · {dateLabel}</strong>
          <span className={`status-dot ${data.scheduleApproved ? 'approved' : ''}`}>
            {data.scheduleApproved ? 'Approved' : 'Awaiting approval'}
          </span>
        </div>
        <div className="schedule-grid-hint">
          <span>
            Employers across the top · Times down the left · Interviews sharing a time line up
          </span>
          <span>
            {editSchedule
              ? 'Use a slot’s + button to add an interview, or the pencil to edit one.'
              : 'Use the pencil next to an employer for interview settings.'}
          </span>
        </div>
        {!employers.length ? (
          <div className="empty">
            <h2>No active employers</h2>
            <p>Import a workbook or turn on employers on the Employers page.</p>
          </div>
        ) : (
          <div className="timetable-scroll" tabIndex={0} aria-label="Interview timetable">
            <div className="schedule-grid" style={gridStyle}>
              <div className="time-corner" style={{ gridRow: 1, gridColumn: 1 }}>
                TIME
              </div>
              {layout.map(({ employer }, col) => {
                const config = employerSchedule(data, employer)
                return (
                  <div
                    className="timetable-employer"
                    key={employer.name}
                    style={{ gridRow: 1, gridColumn: col + 2 }}
                  >
                    <div className="timetable-employer-name">
                      <h2>{employer.name}</h2>
                      <button
                        className="icon-button"
                        aria-label={`Edit interview settings for ${employer.name}`}
                        onClick={() => openSettings(employer)}
                      >
                        <EditIcon />
                      </button>
                    </div>
                    <p>
                      {timeLabel(config.start)} – {timeLabel(config.end)}
                    </p>
                    <div className="timetable-employer-settings">
                      <span>{config.durationMinutes} min</span>
                      <span>
                        {config.parallelInterviews} student
                        {config.parallelInterviews === 1 ? '' : 's'} at once
                      </span>
                    </div>
                  </div>
                )
              })}
              {marks.map((time, row) => (
                <div className="time-label" key={time} style={{ gridRow: row + 2, gridColumn: 1 }}>
                  {timeLabel(clockTime(time))}
                </div>
              ))}
              {marks.slice(0, -1).flatMap((time, row) =>
                layout.map(({ employer }, col) => {
                  const config = employerSchedule(data, employer)
                  const available =
                    time >= minutes(config.start) && marks[row + 1] <= minutes(config.end)
                  return (
                    <div
                      key={`${time}-${employer.name}`}
                      className={`timetable-slot ${available ? '' : 'unavailable'}`}
                      style={{ gridRow: row + 2, gridColumn: col + 2 }}
                      data-time={clockTime(time)}
                      data-employer={employer.name}
                    >
                      {editSchedule && available && (
                        <button
                          className="slot-add"
                          aria-label={`Add interview at ${timeLabel(clockTime(time))} with ${employer.name}`}
                          onClick={() =>
                            openInterview({ employer: employer.name, time: clockTime(time) })
                          }
                        >
                          ＋
                        </button>
                      )}
                    </div>
                  )
                })
              )}
              {layout.flatMap(({ employer, positioned, lanes }, col) =>
                positioned.map(({ interview, lane }) => {
                  const duration = interviewDuration(data, interview)
                  const end = minutes(interview.time) + duration
                  const invalid = issues.some((i) => i.id === interview.id)
                  return (
                    <article
                      className={`timetable-interview ${invalid ? 'has-conflict' : ''}`}
                      key={interview.id}
                      data-interview-id={interview.id}
                      data-start={interview.time}
                      data-employer={employer.name}
                      style={{
                        gridColumn: col + 2,
                        gridRow: `${marks.indexOf(minutes(interview.time)) + 2} / ${marks.indexOf(end) + 2}`,
                        marginLeft: `calc(${(lane * 100) / lanes}% + 7px)`,
                        marginRight: `calc(${((lanes - lane - 1) * 100) / lanes}% + 7px)`
                      }}
                    >
                      <div className="timetable-interview-heading">
                        <h3>{interview.student}</h3>
                        {editSchedule && (
                          <button
                            className="icon-button"
                            aria-label={`Edit interview for ${interview.student} at ${employer.name}, round ${interview.round}`}
                            onClick={() => openInterview({ interview })}
                          >
                            <EditIcon />
                          </button>
                        )}
                      </div>
                      <p>
                        {timeLabel(interview.time)} – {timeLabel(clockTime(end))}
                      </p>
                      <div className="timetable-interview-footer">
                        <span className="tag">Round {interview.round}</span>
                        <span>
                          {duration} min
                          {interview.durationMinutes !== undefined ? ' · override' : ''}
                        </span>
                      </div>
                      {invalid && (
                        <span className="interview-conflict-label">Scheduling conflict</span>
                      )}
                    </article>
                  )
                })
              )}
            </div>
          </div>
        )}
        {!data.schedule.length && !!employers.length && (
          <div className="schedule-empty-bar">
            <span>
              Generate interviews from your imported records or add them with Edit schedule.
            </span>
            <button onClick={onGenerate}>Generate schedule</button>
          </div>
        )}
      </section>
      {settingsEditor && (
        <Modal
          title={
            editorEmployer
              ? `Interview settings for ${editorEmployer.name}`
              : 'Schedule window and interview length'
          }
          onClose={() => setSettingsEditor(null)}
        >
          <form onSubmit={saveSettings} noValidate>
            <p className="small muted">
              {editorEmployer
                ? 'Leave a field blank to use the overall schedule setting. Employer hours must fit inside the overall window.'
                : 'Set the overall interview hours and default length. Employers can override their own hours and interview length.'}
            </p>
            <div className="schedule-form-grid">
              <label>
                {editorEmployer ? 'Employer start time' : 'Schedule start time'}
                <input
                  type="time"
                  name="start"
                  defaultValue={
                    editorEmployer ? (editorEmployer.scheduling?.start ?? '') : global.start
                  }
                />
              </label>
              <label>
                {editorEmployer ? 'Employer end time' : 'Schedule end time'}
                <input
                  type="time"
                  name="end"
                  defaultValue={
                    editorEmployer ? (editorEmployer.scheduling?.end ?? '') : global.end
                  }
                />
              </label>
            </div>
            <label>
              {editorEmployer
                ? 'Employer interview length (minutes)'
                : 'Default interview length (minutes)'}
              <input
                type="number"
                min="1"
                max="1440"
                step="1"
                name="duration"
                defaultValue={
                  editorEmployer
                    ? (editorEmployer.scheduling?.durationMinutes ?? '')
                    : global.durationMinutes
                }
                placeholder={String(global.durationMinutes)}
              />
            </label>
            {editorEmployer && (
              <label>
                Students at once
                <input
                  type="number"
                  min="1"
                  step="1"
                  name="parallel"
                  aria-label="Students at once"
                  aria-describedby="parallel-interviews-help"
                  defaultValue={editorEmployer.scheduling?.parallelInterviews ?? 1}
                />
                <span className="field-help" id="parallel-interviews-help">
                  Enter 2 or more for simultaneous interviews. This does not change the employer’s
                  internship places.
                </span>
              </label>
            )}
            <p className="small muted">
              Saving keeps the current interview times and resets schedule approval. Conflicts will
              be highlighted for you to fix.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setSettingsEditor(null)}>
                Cancel
              </button>
              <button className="primary" type="submit">
                {editorEmployer ? 'Save employer settings' : 'Save schedule settings'}
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
              <select name="student" defaultValue={interviewEditor.interview?.student}>
                {students.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Active employer
              <select
                name="employer"
                defaultValue={interviewEditor.interview?.employer ?? interviewEditor.employer}
              >
                {employers.map((e) => (
                  <option key={e.name}>{e.name}</option>
                ))}
              </select>
            </label>
            <div className="schedule-form-grid">
              <label>
                Start time
                <input
                  type="time"
                  name="time"
                  defaultValue={
                    interviewEditor.interview?.time ?? interviewEditor.time ?? global.start
                  }
                />
              </label>
              <label>
                Round
                <input
                  type="number"
                  name="round"
                  min="1"
                  step="1"
                  defaultValue={interviewEditor.interview?.round ?? 1}
                />
              </label>
            </div>
            <label>
              Interview length override (minutes)
              <input
                type="number"
                name="duration"
                aria-label="Interview length override (minutes)"
                aria-describedby="duration-override-help"
                min="1"
                max="1440"
                step="1"
                defaultValue={interviewEditor.interview?.durationMinutes ?? ''}
              />
              <span className="field-help" id="duration-override-help">
                Leave blank to follow this employer’s interview length, or the overall default.
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <p className="small muted">
              Students cannot be in two interviews at the same time. Simultaneous interviews must
              fit the employer’s Students at once limit.
            </p>
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
