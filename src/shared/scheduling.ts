import type { Employer, ScheduleSettings, ScheduledInterview, Workspace } from './workspace'

export const defaultScheduleSettings: ScheduleSettings = {
  start: '09:00',
  end: '17:00',
  durationMinutes: 30
}

export function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function clockTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h % 24 >= 12 ? 'PM' : 'AM'}`
}

export function validTime(time: string, end = false) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) || (end && time === '24:00')
}

export function scheduleSettings(data: Workspace): ScheduleSettings {
  if (data.scheduleSettings) return data.scheduleSettings
  // Older workspaces had no window. Keep every old interview inside the migrated window.
  const starts = data.schedule.map((i) => minutes(i.time)).filter(Number.isFinite)
  const ends = data.schedule
    .map((i) => minutes(i.time) + (i.durationMinutes ?? 30))
    .filter(Number.isFinite)
  return {
    start: clockTime(Math.min(minutes(defaultScheduleSettings.start), ...starts)),
    end: clockTime(Math.max(minutes(defaultScheduleSettings.end), ...ends)),
    durationMinutes: 30
  }
}

export function employerSchedule(data: Workspace, employer: Employer) {
  const global = scheduleSettings(data)
  return {
    start: employer.scheduling?.start ?? global.start,
    end: employer.scheduling?.end ?? global.end,
    durationMinutes: employer.scheduling?.durationMinutes ?? global.durationMinutes,
    parallelInterviews: employer.scheduling?.parallelInterviews ?? 1
  }
}

export function interviewDuration(data: Workspace, interview: ScheduledInterview): number {
  return (
    interview.durationMinutes ??
    data.employers.find((e) => e.name === interview.employer)?.scheduling?.durationMinutes ??
    scheduleSettings(data).durationMinutes
  )
}

export function settingsError(settings: ScheduleSettings): string | undefined {
  if (!validTime(settings.start) || !validTime(settings.end, true))
    return 'Enter start and end times as HH:MM on the same day.'
  if (minutes(settings.end) <= minutes(settings.start))
    return 'The schedule end must be later than the start. Overnight interviews are not supported.'
  if (
    !Number.isSafeInteger(settings.durationMinutes) ||
    settings.durationMinutes < 1 ||
    settings.durationMinutes > 1440
  )
    return 'Interview length must be a whole number from 1 to 1440 minutes.'
  if (settings.durationMinutes > minutes(settings.end) - minutes(settings.start))
    return 'The interview length is longer than the schedule window. Shorten interviews or extend the window.'
}

export function employerSettingsError(data: Workspace, employer: Employer): string | undefined {
  const settings = employerSchedule(data, employer)
  const error = settingsError(settings)
  if (error) return `${employer.name}: ${error}`
  const global = scheduleSettings(data)
  if (
    minutes(settings.start) < minutes(global.start) ||
    minutes(settings.end) > minutes(global.end)
  )
    return `${employer.name} has hours outside the overall schedule window. Adjust its hours or extend the overall window.`
  if (!Number.isSafeInteger(settings.parallelInterviews) || settings.parallelInterviews < 1)
    return `${employer.name}: Students at once must be a whole number of 1 or more.`
}

export function scheduleConflict(
  schedule: ScheduledInterview[],
  interview: ScheduledInterview,
  data: Workspace
): string | undefined {
  const globalError = settingsError(scheduleSettings(data))
  if (globalError) return globalError
  const employer = data.employers.find((e) => e.name === interview.employer)
  if (!employer?.active)
    return `${interview.employer} is inactive or missing. Choose an active employer.`
  if (!Object.hasOwn(data.students, interview.student))
    return `Student “${interview.student}” is missing from the workspace.`
  const configError = employerSettingsError(data, employer)
  if (configError) return configError
  const config = employerSchedule(data, employer)
  const duration = interviewDuration(data, interview)
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 1440)
    return `${interview.student}: Interview length must be a whole number from 1 to 1440 minutes.`
  if (!validTime(interview.time))
    return `${interview.student}: Choose a valid interview start time.`
  const start = minutes(interview.time),
    end = start + duration
  if (start < minutes(config.start) || end > minutes(config.end))
    return `${interview.student} at ${interview.employer} runs ${timeLabel(interview.time)}–${timeLabel(clockTime(end))}, outside this employer’s ${timeLabel(config.start)}–${timeLabel(config.end)} interview window. Move the interview, shorten it, or edit the employer’s hours.`
  const others = schedule.filter((i) => i.id !== interview.id)
  const overlaps = others.filter(
    (i) => minutes(i.time) < end && minutes(i.time) + interviewDuration(data, i) > start
  )
  const studentCollision = overlaps.find((i) => i.student === interview.student)
  if (studentCollision)
    return `${interview.student} is booked twice: an interview at ${timeLabel(studentCollision.time)} with ${studentCollision.employer} lasts ${interviewDuration(data, studentCollision)} minutes. Move one interview so their times do not overlap.`
  // Count actual simultaneous occupancy, rather than every interview that intersects a long slot.
  const events: { time: number; delta: number }[] = [
    { time: start, delta: 1 },
    { time: end, delta: -1 }
  ]
  for (const i of overlaps.filter((i) => i.employer === interview.employer)) {
    events.push(
      { time: Math.max(start, minutes(i.time)), delta: 1 },
      { time: Math.min(end, minutes(i.time) + interviewDuration(data, i)), delta: -1 }
    )
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta)
  let concurrent = 0
  for (const event of events) {
    concurrent += event.delta
    if (concurrent > config.parallelInterviews)
      return `${interview.employer} is booked twice beyond its limit of ${config.parallelInterviews} student${config.parallelInterviews === 1 ? '' : 's'} at once near ${timeLabel(clockTime(event.time))}. Move an interview or raise Students at once using the edit icon next to the employer name.`
  }
}

export function scheduleIssues(
  data: Workspace
): { id?: string; employer?: string; detail: string }[] {
  const error = settingsError(scheduleSettings(data))
  if (error) return [{ detail: error }]
  const issues: { id?: string; employer?: string; detail: string }[] = []
  for (const employer of data.employers.filter((e) => e.active)) {
    const detail = employerSettingsError(data, employer)
    if (detail) issues.push({ employer: employer.name, detail })
  }
  for (const interview of data.schedule) {
    const detail = scheduleConflict(data.schedule, interview, data)
    if (detail) issues.push({ id: interview.id, detail })
  }
  return issues
}

export function generateSchedule(data: Workspace): ScheduledInterview[] {
  const globalError = settingsError(scheduleSettings(data))
  if (globalError) throw new Error(globalError)
  const schedule: ScheduledInterview[] = []
  for (const employer of data.employers.filter((e) => e.active)) {
    const error = employerSettingsError(data, employer)
    if (error) throw new Error(error)
    const config = employerSchedule(data, employer)
    for (const student of Object.values(data.students)) {
      for (const result of student.interviewResults.filter((i) => i.business === employer.name)) {
        let placed = false
        // A slot can first become free at opening time or when another interview ends.
        // Mixed interview lengths must not force an unnecessary gap between companies.
        const possibleStarts = [
          ...new Set([
            minutes(config.start),
            ...schedule.map((i) => minutes(i.time) + interviewDuration(data, i))
          ])
        ]
          .filter(
            (start) =>
              start >= minutes(config.start) &&
              start + config.durationMinutes <= minutes(config.end)
          )
          .sort((a, b) => a - b)
        for (const start of possibleStarts) {
          const candidate: ScheduledInterview = {
            id: String(schedule.length + 1),
            student: student.name,
            employer: employer.name,
            time: clockTime(start),
            round: result.wave || 1
          }
          if (!scheduleConflict(schedule, candidate, data)) {
            schedule.push(candidate)
            placed = true
            break
          }
        }
        if (!placed)
          throw new Error(
            `${student.name} at ${employer.name} cannot fit in ${timeLabel(config.start)}–${timeLabel(config.end)} with ${config.durationMinutes}-minute interviews and ${config.parallelInterviews} student${config.parallelInterviews === 1 ? '' : 's'} at once. Extend the schedule window or employer hours, shorten interviews, or increase Students at once. The existing schedule has not been changed.`
          )
      }
    }
  }
  return schedule
}
