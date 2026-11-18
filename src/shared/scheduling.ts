import type { Employer, ScheduledInterview, Wave, Workspace } from './workspace'
import type { Student } from './student'
import { InterviewResult } from './interviewResult'

export const defaultRounds = 3
export const defaultStudentsPerRound = 3
// Every student interviews this many times in their wave, one interview per round.
export const interviewsPerStudent = 3

export function newWave(name: string, rounds = defaultRounds): Wave {
  return { name, rounds, schools: [], students: [] }
}

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
export const sameName = (a: string, b: string) => normalize(a) === normalize(b)

export function studentsPerRound(employer: Employer): number {
  return employer.scheduling?.studentsPerRound ?? defaultStudentsPerRound
}

export function findWave(data: Workspace, name: string): Wave | undefined {
  return data.waves.find((w) => w.name === name)
}

// The wave the coordinator placed a student in. A student's own entry wins over their school's.
export function assignedWave(
  data: Workspace,
  student: string
): { wave: Wave; by: 'student' | 'school' } | undefined {
  const own = data.waves.find((w) => w.students.includes(student))
  if (own) return { wave: own, by: 'student' }
  const school = data.students[student]?.school
  const bySchool = school
    ? data.waves.find((w) => w.schools.some((s) => sameName(s, school)))
    : undefined
  return bySchool ? { wave: bySchool, by: 'school' } : undefined
}

export function waveError(wave: Wave): string | undefined {
  if (!wave.name.trim()) return 'Give the wave a name.'
  if (!Number.isSafeInteger(wave.rounds) || wave.rounds < 1 || wave.rounds > 50)
    return `${wave.name}: Rounds must be a whole number from 1 to 50.`
}

export function employerSettingsError(employer: Employer): string | undefined {
  const limit = studentsPerRound(employer)
  if (!Number.isSafeInteger(limit) || limit < 1)
    return `${employer.name}: Students per round must be a whole number of 1 or more.`
}

const count = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`

// Why one interview cannot be where it is. `schedule` holds the other interviews.
export function scheduleConflict(
  schedule: ScheduledInterview[],
  interview: ScheduledInterview,
  data: Workspace
): string | undefined {
  const employer = data.employers.find((e) => e.name === interview.employer)
  if (!employer?.active)
    return `${interview.employer} is inactive or missing. Choose an active employer.`
  if (!Object.hasOwn(data.students, interview.student))
    return `Student “${interview.student}” is missing from the workspace.`
  const wave = findWave(data, interview.wave)
  if (!wave)
    return `${interview.student} at ${interview.employer} is in “${interview.wave}”, which is not a wave. Move the interview to a wave.`
  const configError = employerSettingsError(employer) ?? waveError(wave)
  if (configError) return configError
  if (
    !Number.isSafeInteger(interview.round) ||
    interview.round < 1 ||
    interview.round > wave.rounds
  )
    return `${interview.student} at ${interview.employer} is in round ${interview.round}, but ${wave.name} has ${count(wave.rounds, 'round')}. Move the interview or add rounds to the wave.`
  const sameSlot = schedule.filter(
    (i) => i.id !== interview.id && i.wave === interview.wave && i.round === interview.round
  )
  const clash = sameSlot.find((i) => i.student === interview.student)
  if (clash)
    return `${interview.student} is booked twice in ${wave.name} round ${interview.round}: with ${clash.employer} and ${interview.employer}. Move one interview to another round.`
  const limit = studentsPerRound(employer)
  if (sameSlot.filter((i) => i.employer === interview.employer).length >= limit)
    return `${interview.employer} already has ${count(limit, 'student')} in ${wave.name} round ${interview.round}. Move an interview, or raise Students per round using the edit icon next to the employer name.`
}

// An interview outside the wave its student was placed in. Shown, but it does not block approval.
export function scheduleWarning(
  data: Workspace,
  interview: ScheduledInterview
): string | undefined {
  const assigned = assignedWave(data, interview.student)
  if (!assigned || assigned.wave.name === interview.wave) return undefined
  return assigned.by === 'student'
    ? `${interview.student} is assigned to ${assigned.wave.name} but interviews with ${interview.employer} in ${interview.wave}.`
    : `${interview.student}’s school, ${data.students[interview.student]?.school}, is assigned to ${assigned.wave.name}, but ${interview.student} interviews with ${interview.employer} in ${interview.wave}.`
}

export interface ScheduleIssue {
  id?: string
  employer?: string
  wave?: string
  detail: string
}

export function scheduleIssues(data: Workspace): ScheduleIssue[] {
  const issues: ScheduleIssue[] = []
  data.waves.forEach((wave, index) => {
    const detail =
      waveError(wave) ??
      (data.waves.slice(0, index).some((w) => sameName(w.name, wave.name))
        ? `Two waves are named “${wave.name}”. Give each wave a different name.`
        : undefined)
    if (detail) issues.push({ wave: wave.name, detail })
  })
  for (const employer of data.employers.filter((e) => e.active)) {
    const detail = employerSettingsError(employer)
    if (detail) issues.push({ employer: employer.name, detail })
  }
  for (const interview of data.schedule) {
    const detail = scheduleConflict(data.schedule, interview, data)
    if (detail) issues.push({ id: interview.id, detail })
  }
  return issues
}

export function scheduleWarnings(data: Workspace): { id: string; detail: string }[] {
  return data.schedule.flatMap((interview) => {
    const detail = scheduleWarning(data, interview)
    return detail ? [{ id: interview.id, detail }] : []
  })
}

const words = (value: string) => value.split(/[^a-z0-9]+/).filter((word) => word.length >= 3)

// How well an employer fits a student's interests: 2 for each interest that names one of the
// employer's keywords (industry, role titles, role tags), 1 for each that only shares a word.
export function interestScore(student: Student, employer: Employer): number {
  const keywords = [
    employer.industry,
    ...(employer.roles ?? []).flatMap((role) => [role.title, ...(role.tags ?? [])])
  ]
    .filter(Boolean)
    .map(normalize)
  const keywordWords = new Set(keywords.flatMap(words))
  return (student.interests ?? []).reduce((total, interest) => {
    const wanted = normalize(interest)
    if (keywords.includes(wanted)) return total + 2
    return total + (words(wanted).some((word) => keywordWords.has(word)) ? 1 : 0)
  }, 0)
}

// Every scheduled pair gets a feedback row, so the employer's response can be recorded later.
export function withFeedbackRows(
  data: Workspace,
  schedule: ScheduledInterview[],
  waves: Wave[]
): Workspace['students'] {
  const students = { ...data.students }
  for (const interview of schedule) {
    const student = students[interview.student]
    if (!student || student.interviewResults.some((i) => i.business === interview.employer))
      continue
    const waveNumber = Math.max(1, waves.findIndex((w) => w.name === interview.wave) + 1)
    students[interview.student] = {
      ...student,
      interviewResults: [
        ...student.interviewResults,
        new InterviewResult(
          interview.student,
          String(waveNumber),
          interview.employer,
          '',
          '',
          '',
          '',
          '0'
        )
      ]
    } as Student
  }
  return students
}

// Rounds for a wave's student/employer pairs: one interview per student per round, and at most
// the employer's limit per round. Each employer is split into copies holding at most `rounds`
// pairs, which gives a bipartite graph of maximum degree `rounds`. Such a graph can always be
// edge-colored with `rounds` colors (König), so this never fails when no employer holds more
// than rounds × limit pairs, and it spreads each employer's interviews evenly over the rounds.
function assignRounds(pairs: { student: string; employer: string }[], rounds: number): number[] {
  const copies = new Map<string, number>()
  const ends = pairs.map((pair) => {
    const seen = copies.get(pair.employer) ?? 0
    copies.set(pair.employer, seen + 1)
    return [`student:${pair.student}`, `employer:${pair.employer}#${Math.floor(seen / rounds)}`]
  })
  const edgesAt = new Map<string, number[]>()
  ends.forEach(([u, v], edge) => {
    edgesAt.set(u, [...(edgesAt.get(u) ?? []), edge])
    edgesAt.set(v, [...(edgesAt.get(v) ?? []), edge])
  })
  const round = Array<number>(pairs.length).fill(0)
  const edgeWith = (vertex: string, color: number) =>
    edgesAt.get(vertex)!.find((edge) => round[edge] === color)
  const freeColor = (vertex: string) => {
    for (let color = 1; color <= rounds; color++)
      if (edgeWith(vertex, color) === undefined) return color
    throw new Error(`${vertex} has more interviews than rounds.`)
  }
  ends.forEach(([u, v], edge) => {
    const a = freeColor(u)
    const b = freeColor(v)
    if (a !== b) {
      // Swap a and b along the alternating path that starts at v, which frees a at v. The path
      // cannot reach u, because u has no edge colored a.
      const path: number[] = []
      let vertex = v
      let color = a
      for (let next = edgeWith(vertex, color); next !== undefined; next = edgeWith(vertex, color)) {
        path.push(next)
        const [x, y] = ends[next]
        vertex = x === vertex ? y : x
        color = color === a ? b : a
      }
      for (const swapped of path) round[swapped] = round[swapped] === a ? b : a
    }
    round[edge] = a
  })
  return round
}

// Gives every student `interviewsPerStudent` interviews in their wave, one per round. Employers
// are chosen first: each pass gives every student one more, the best match by interests that
// still has room, then the least-booked one, so matches are shared fairly and the rest spreads
// evenly. Rounds are assigned afterwards.
export function generateSchedule(data: Workspace): {
  schedule: ScheduledInterview[]
  waves: Wave[]
  students: Workspace['students']
} {
  const employers = data.employers.filter((e) => e.active)
  const students = Object.values(data.students)
  const waves = data.waves.length ? data.waves : [newWave('Wave 1')]
  if (!students.length) return { schedule: [], waves, students: data.students }
  if (employers.length < interviewsPerStudent)
    throw new Error(
      `Only ${count(employers.length, 'employer')} ${employers.length === 1 ? 'is' : 'are'} active, but every student interviews ${interviewsPerStudent} times. Turn on at least ${interviewsPerStudent} employers on the Employers page.`
    )
  for (const employer of employers) {
    const error = employerSettingsError(employer)
    if (error) throw new Error(error)
  }
  for (const wave of waves) {
    const error = waveError(wave)
    if (error) throw new Error(error)
    if (wave.rounds < interviewsPerStudent)
      throw new Error(
        `${wave.name} has ${count(wave.rounds, 'round')}, but every student interviews ${interviewsPerStudent} times, one per round. Give it at least ${interviewsPerStudent} rounds.`
      )
  }
  const draft = { ...data, waves }
  const schedule: ScheduledInterview[] = []
  for (const wave of waves) {
    const members = students.filter(
      (s) => (assignedWave(draft, s.name)?.wave ?? waves[0]).name === wave.name
    )
    const capacity = new Map(employers.map((e) => [e.name, studentsPerRound(e) * wave.rounds]))
    const slots = [...capacity.values()].reduce((sum, value) => sum + value, 0)
    if (members.length * interviewsPerStudent > slots)
      throw new Error(
        `${wave.name} has room for ${count(slots, 'interview')}, but its ${count(members.length, 'student')} need ${members.length * interviewsPerStudent}. Raise Students per round, add rounds, or place some students in another wave. The existing schedule has not been changed.`
      )
    const load = new Map(employers.map((e) => [e.name, 0]))
    const picks = new Map(members.map((s) => [s.name, [] as string[]]))
    for (let pass = 1; pass <= interviewsPerStudent; pass++)
      for (const student of members) {
        const taken = picks.get(student.name)!
        const [best] = employers
          .map((employer, index) => ({ employer, index, score: interestScore(student, employer) }))
          .filter(
            ({ employer }) =>
              !taken.includes(employer.name) &&
              load.get(employer.name)! < capacity.get(employer.name)!
          )
          .sort(
            (a, b) =>
              b.score - a.score ||
              load.get(a.employer.name)! - load.get(b.employer.name)! ||
              a.index - b.index
          )
        if (!best)
          throw new Error(
            `${student.name} could only get ${pass - 1} of ${interviewsPerStudent} interviews in ${wave.name}: every other employer is full. Raise Students per round, add rounds, or place ${student.name} in another wave. The existing schedule has not been changed.`
          )
        taken.push(best.employer.name)
        load.set(best.employer.name, load.get(best.employer.name)! + 1)
      }
    const pairs = members.flatMap((s) =>
      picks.get(s.name)!.map((employer) => ({ student: s.name, employer }))
    )
    const rounds = assignRounds(pairs, wave.rounds)
    pairs.forEach((pair, index) =>
      schedule.push({
        id: String(schedule.length + 1),
        ...pair,
        wave: wave.name,
        round: rounds[index]
      })
    )
  }
  const issue = scheduleIssues({ ...draft, schedule })[0]
  if (issue) throw new Error(issue.detail)
  return { schedule, waves, students: withFeedbackRows(data, schedule, waves) }
}

// Interviews saved before waves existed: each had a start time, and `round` held the
// tracker's wave number.
export interface TimedInterview {
  id: string
  student: string
  employer: string
  time: string
  round: number
}

export function convertTimedSchedule(
  interviews: TimedInterview[],
  waves: Wave[]
): { schedule: ScheduledInterview[]; waves: Wave[] } {
  const result = waves.map((w) => ({ ...w }))
  const schedule: ScheduledInterview[] = []
  const byWave = new Map<number, TimedInterview[]>()
  for (const interview of interviews)
    byWave.set(interview.round, [...(byWave.get(interview.round) ?? []), interview])
  for (const [number, group] of [...byWave].sort(([a], [b]) => a - b)) {
    const name = `Wave ${number}`
    let wave = result.find((w) => sameName(w.name, name))
    if (!wave) {
      wave = newWave(name)
      result.push(wave)
    }
    // Each distinct start time becomes a round, so interviews that ran at once stay together.
    const times = [...new Set(group.map((i) => i.time))].sort()
    wave.rounds = Math.max(wave.rounds, times.length)
    for (const i of group)
      schedule.push({
        id: i.id,
        student: i.student,
        employer: i.employer,
        wave: wave.name,
        round: times.indexOf(i.time) + 1
      })
  }
  return { schedule, waves: result }
}
