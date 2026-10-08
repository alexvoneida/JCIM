import { expect, it } from 'vitest'
import { Student } from './student'
import { InterviewResult } from './interviewResult'
import { emptyWorkspace, type ScheduledInterview } from './workspace'
import {
  generateSchedule,
  scheduleConflict,
  scheduleIssues,
  scheduleSettings,
  settingsError
} from './scheduling'

function fixture() {
  const data = emptyWorkspace()
  data.scheduleSettings = { start: '09:00', end: '11:00', durationMinutes: 20 }
  data.employers = ['Aero', 'Software'].map((name) => ({
    name,
    industry: '',
    capacity: 1,
    active: true
  }))
  for (const name of ['Alice', 'Bob', 'Cara', 'Dave']) {
    data.students[name] = Object.assign(new Student(), { name })
    data.students[name].interviewResults.push(
      new InterviewResult(name, '1', 'Aero', '', '', '', '', '0')
    )
  }
  return data
}
function interview(
  student: string,
  time: string,
  durationMinutes?: number,
  employer = 'Aero'
): ScheduledInterview {
  return { id: student + employer, student, employer, time, durationMinutes, round: 1 }
}

it('generates simultaneous interviews using company hours, duration, and concurrency rather than internship capacity', () => {
  const data = fixture()
  data.employers[0].scheduling = {
    start: '09:15',
    end: '10:00',
    durationMinutes: 15,
    parallelInterviews: 2
  }
  const schedule = generateSchedule(data)
  expect(schedule.map((i) => i.time)).toEqual(['09:15', '09:15', '09:30', '09:30'])
  expect(schedule.map((i) => scheduleConflict(schedule, i, data))).toEqual(Array(4).fill(undefined))
})

it('still rejects a student in two companies at once when employers allow parallel interviews', () => {
  const data = fixture()
  data.employers[0].scheduling = { parallelInterviews: 3 }
  expect(
    scheduleConflict(
      [interview('Alice', '09:00')],
      interview('Alice', '09:10', 20, 'Software'),
      data
    )
  ).toContain('Alice is booked twice')
  expect(
    scheduleConflict([interview('Alice', '09:00')], interview('Bob', '09:00'), data)
  ).toBeUndefined()
})

it('uses actual simultaneous occupancy for a long interview spanning back-to-back shorter interviews', () => {
  const data = fixture()
  data.employers[0].scheduling = { parallelInterviews: 2 }
  const others = [
    interview('Bob', '09:00', 15),
    interview('Cara', '09:15', 15),
    interview('Dave', '09:30', 15)
  ]
  expect(scheduleConflict(others, interview('Alice', '09:00', 45), data)).toBeUndefined()
  others[1].time = '09:10'
  expect(scheduleConflict(others, interview('Alice', '09:00', 45), data)).toContain(
    'limit of 2 students at once'
  )
})

it('respects individual duration overrides and allows back-to-back interviews exactly at the end boundary', () => {
  const data = fixture()
  data.employers[0].scheduling = { end: '09:45', durationMinutes: 15 }
  const first = interview('Alice', '09:00', 30)
  expect(scheduleConflict([first], interview('Bob', '09:15'), data)).toContain('limit of 1 student')
  expect(scheduleConflict([first], interview('Bob', '09:30'), data)).toBeUndefined()
  expect(scheduleConflict([first], interview('Bob', '09:31'), data)).toContain(
    'outside this employer'
  )
})

it('fills mixed-length company interviews immediately after the student becomes free', () => {
  const data = fixture()
  data.students = { Alice: data.students.Alice }
  data.employers[1].scheduling = { durationMinutes: 30, end: '09:50' }
  data.students.Alice.interviewResults.push(
    new InterviewResult('Alice', '1', 'Software', '', '', '', '', '0')
  )
  expect(generateSchedule(data).map((i) => i.time)).toEqual(['09:00', '09:20'])
})

it('does not mutate the existing schedule when not all interviews fit', () => {
  const data = fixture()
  data.schedule = [interview('Alice', '09:00')]
  data.scheduleSettings!.end = '09:20'
  expect(() => generateSchedule(data)).toThrow(
    /Bob.*cannot fit.*existing schedule has not been changed/
  )
  expect(data.schedule).toEqual([interview('Alice', '09:00')])
})

it('flags kept interviews after hours, concurrency, or default lengths are changed', () => {
  const data = fixture()
  data.schedule = [interview('Alice', '09:00'), interview('Bob', '09:20')]
  data.scheduleSettings!.durationMinutes = 30
  expect(scheduleIssues(data)).toHaveLength(2)
  data.employers[0].scheduling = { parallelInterviews: 2 }
  expect(scheduleIssues(data)).toEqual([])
  data.employers[0].scheduling.start = '09:10'
  expect(scheduleIssues(data)[0].id).toBe('AliceAero')
  expect(scheduleIssues(data)[0].detail).toContain('outside this employer')
})

it('migrates old schedules without losing late interviews and rejects invalid windows or durations', () => {
  const data = fixture()
  delete data.scheduleSettings
  data.schedule = [interview('Alice', '18:00')]
  expect(scheduleSettings(data)).toEqual({ start: '09:00', end: '18:30', durationMinutes: 30 })
  expect(settingsError({ start: '11:00', end: '09:00', durationMinutes: 30 })).toContain(
    'later than the start'
  )
  expect(settingsError({ start: '09:00', end: '10:00', durationMinutes: 0 })).toContain(
    'whole number'
  )
  expect(settingsError({ start: '09:00', end: '09:15', durationMinutes: 30 })).toContain(
    'longer than the schedule window'
  )
})
