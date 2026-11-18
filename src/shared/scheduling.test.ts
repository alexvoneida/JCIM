import { expect, it } from 'vitest'
import { Student } from './student'
import { InterviewResult } from './interviewResult'
import { emptyWorkspace, type ScheduledInterview } from './workspace'
import {
  convertTimedSchedule,
  generateSchedule,
  interestScore,
  newWave,
  scheduleConflict,
  scheduleIssues,
  scheduleWarnings
} from './scheduling'

function fixture() {
  const data = emptyWorkspace()
  data.employers = [
    { name: 'Aero', industry: 'Aerospace', capacity: 1, active: true },
    {
      name: 'Software',
      industry: 'Enterprise software',
      capacity: 1,
      active: true,
      roles: [{ title: 'Web', capacity: 1, tags: ['Software', 'Design'] }]
    },
    { name: 'Finance', industry: 'Finance', capacity: 1, active: true },
    { name: 'Farm', industry: 'Agriculture', capacity: 1, active: true }
  ]
  const details: [string, string, string[]][] = [
    ['Alice', 'Lakewood High', ['Software', 'Finance']],
    ['Bob', 'Lakewood High', ['Aerospace']],
    ['Cara', 'Golden High', []],
    ['Dave', 'Golden High', ['Agriculture', 'Design']]
  ]
  for (const [name, school, interests] of details)
    data.students[name] = Object.assign(new Student(), { name, school, interests })
  data.students.Alice.interviewResults.push(
    new InterviewResult('Alice', '1', 'Aero', '', '', '', '', '0')
  )
  return data
}
function interview(
  student: string,
  round: number,
  employer = 'Aero',
  wave = 'Wave 1'
): ScheduledInterview {
  return { id: student + employer + round, student, employer, wave, round }
}
const employersOf = (schedule: ScheduledInterview[], student: string) =>
  schedule.filter((i) => i.student === student).map((i) => i.employer)

it('scores employers by exact interest matches first, then shared words', () => {
  const data = fixture()
  const [aero, software, finance, farm] = data.employers
  expect(interestScore(data.students.Alice, software)).toBe(2)
  expect(interestScore(data.students.Alice, finance)).toBe(2)
  expect(interestScore(data.students.Alice, aero)).toBe(0)
  expect(interestScore(data.students.Dave, farm)).toBe(2)
  expect(interestScore(data.students.Dave, software)).toBe(2)
  data.students.Dave.interests = ['Software engineering']
  expect(interestScore(data.students.Dave, software)).toBe(1)
})

it('gives every student three interviews in Wave 1, best matches first, one per round', () => {
  const data = fixture()
  const { schedule, waves, students } = generateSchedule(data)
  expect(waves).toEqual([newWave('Wave 1')])
  for (const name of Object.keys(data.students)) {
    const own = schedule.filter((i) => i.student === name)
    expect(own).toHaveLength(3)
    expect(new Set(own.map((i) => i.round)).size).toBe(3)
    expect(new Set(own.map((i) => i.employer)).size).toBe(3)
  }
  expect(employersOf(schedule, 'Alice')).toEqual(expect.arrayContaining(['Software', 'Finance']))
  expect(employersOf(schedule, 'Bob')).toContain('Aero')
  expect(employersOf(schedule, 'Dave')).toEqual(expect.arrayContaining(['Farm', 'Software']))
  expect(scheduleIssues({ ...data, waves, schedule })).toEqual([])
  // Each scheduled pair gets a feedback row, without duplicating one the tracker already had.
  const recorded = students.Alice.interviewResults.map((i) => i.business)
  expect(recorded).toEqual([...new Set(['Aero', ...employersOf(schedule, 'Alice')])])
  expect(data.students.Alice.interviewResults).toHaveLength(1)
})

it('spreads students evenly and never exceeds an employer’s students per round', () => {
  const data = fixture()
  data.employers[3].active = false
  for (const name of ['Eve', 'Finn']) data.students[name] = Object.assign(new Student(), { name })
  for (const employer of data.employers) employer.scheduling = { studentsPerRound: 2 }
  const { schedule, waves } = generateSchedule(data)
  expect(schedule).toHaveLength(18)
  expect(schedule.filter((i) => i.employer === 'Farm')).toEqual([])
  for (const employer of ['Aero', 'Software', 'Finance'])
    for (const round of [1, 2, 3])
      expect(schedule.filter((i) => i.employer === employer && i.round === round)).toHaveLength(2)
  expect(scheduleIssues({ ...data, waves, schedule })).toEqual([])
  for (const employer of data.employers) employer.scheduling = { studentsPerRound: 1 }
  expect(() => generateSchedule(data)).toThrow(
    /Wave 1 has room for 9 interviews, but its 6 students need 18/
  )
})

it('places students in the wave of their school or their own entry', () => {
  const data = fixture()
  data.waves = [
    { ...newWave('North'), schools: ['Golden High'] },
    { ...newWave('South'), schools: ['Lakewood High'], students: ['Cara'] }
  ]
  const { schedule } = generateSchedule(data)
  const wavesOf = (student: string) =>
    new Set(schedule.filter((i) => i.student === student).map((i) => i.wave))
  expect(wavesOf('Alice')).toEqual(new Set(['South']))
  expect(wavesOf('Bob')).toEqual(new Set(['South']))
  expect(wavesOf('Cara')).toEqual(new Set(['South']))
  expect(wavesOf('Dave')).toEqual(new Set(['North']))
  expect(schedule).toHaveLength(12)
  expect(scheduleWarnings({ ...data, schedule })).toEqual([])
})

it('refuses too few rounds or employers and leaves the existing schedule alone', () => {
  const data = fixture()
  data.schedule = [interview('Alice', 1)]
  data.waves = [newWave('Wave 1', 2)]
  expect(() => generateSchedule(data)).toThrow(
    /Wave 1 has 2 rounds, but every student interviews 3 times/
  )
  data.waves = []
  data.employers[2].active = false
  data.employers[3].active = false
  expect(() => generateSchedule(data)).toThrow(/Only 2 employers are active/)
  expect(data.schedule).toEqual([interview('Alice', 1)])
  data.students = {}
  expect(generateSchedule(data).schedule).toEqual([])
})

it('explains double bookings, full rounds, missing waves, and rounds beyond the wave', () => {
  const data = fixture()
  data.waves = [newWave('Wave 1', 2)]
  data.employers[0].scheduling = { studentsPerRound: 1 }
  const others = [interview('Alice', 1), interview('Bob', 2)]
  expect(scheduleConflict(others, interview('Alice', 1, 'Software'), data)).toContain(
    'Alice is booked twice in Wave 1 round 1'
  )
  expect(scheduleConflict(others, interview('Cara', 1), data)).toContain(
    'Aero already has 1 student in Wave 1 round 1'
  )
  expect(scheduleConflict(others, interview('Cara', 2, 'Software'), data)).toBeUndefined()
  expect(scheduleConflict(others, interview('Cara', 3), data)).toContain('Wave 1 has 2 rounds')
  expect(scheduleConflict(others, interview('Cara', 1, 'Aero', 'Wave 9'), data)).toContain(
    'is not a wave'
  )
})

it('flags kept interviews after limits or rounds change, and notes students outside their wave', () => {
  const data = fixture()
  data.waves = [newWave('Wave 1'), { ...newWave('Wave 2'), schools: ['golden high'] }]
  data.schedule = [interview('Alice', 1), interview('Cara', 1), interview('Dave', 1)]
  expect(scheduleIssues(data)).toEqual([])
  expect(scheduleWarnings(data).map((w) => w.detail)).toEqual([
    expect.stringContaining('Cara’s school, Golden High, is assigned to Wave 2'),
    expect.stringContaining('Dave’s school, Golden High, is assigned to Wave 2')
  ])
  data.waves[0].students = ['Cara']
  expect(scheduleWarnings(data)).toHaveLength(1)
  data.employers[0].scheduling = { studentsPerRound: 2 }
  expect(scheduleIssues(data).map((i) => i.id)).toEqual(['AliceAero1', 'CaraAero1', 'DaveAero1'])
  data.employers[0].scheduling = { studentsPerRound: 0 }
  expect(scheduleIssues(data)[0]).toEqual({
    employer: 'Aero',
    detail: 'Aero: Students per round must be a whole number of 1 or more.'
  })
  data.employers[0].scheduling = undefined
  data.waves[0].rounds = 0
  expect(scheduleIssues(data)[0].detail).toContain('Rounds must be a whole number')
  data.waves[0].rounds = 3
  data.waves[1].name = 'wave 1'
  expect(scheduleIssues(data)[0].detail).toContain('Two waves are named')
})

it('converts timed schedules into waves and rounds, one round per distinct start time', () => {
  const converted = convertTimedSchedule(
    [
      { id: 'a', student: 'Alice', employer: 'Aero', time: '09:30', round: 1 },
      { id: 'b', student: 'Bob', employer: 'Aero', time: '09:00', round: 1 },
      { id: 'c', student: 'Cara', employer: 'Software', time: '09:00', round: 1 },
      { id: 'd', student: 'Dave', employer: 'Aero', time: '13:00', round: 2 }
    ],
    [{ ...newWave('Wave 2'), schools: ['Golden High'] }]
  )
  expect(converted.waves).toEqual([
    { ...newWave('Wave 2'), schools: ['Golden High'] },
    newWave('Wave 1')
  ])
  expect(converted.schedule).toEqual([
    { id: 'a', student: 'Alice', employer: 'Aero', wave: 'Wave 1', round: 2 },
    { id: 'b', student: 'Bob', employer: 'Aero', wave: 'Wave 1', round: 1 },
    { id: 'c', student: 'Cara', employer: 'Software', wave: 'Wave 1', round: 1 },
    { id: 'd', student: 'Dave', employer: 'Aero', wave: 'Wave 2', round: 1 }
  ])
})
