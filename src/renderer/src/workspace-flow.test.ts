import { expect, it } from 'vitest'
import { emptyWorkspace } from '../../shared/workspace'
import { Student } from '../../shared/student'
import { InterviewResult } from '../../shared/interviewResult'
import { generateSchedule, matchingInput, scheduleConflict } from './workspace-flow'
import { matchInternships } from './matching'

function fixture() {
  const data = emptyWorkspace()
  data.employers = ['Active', 'Paused'].map((name) => ({
    name,
    industry: '',
    capacity: 2,
    active: name !== 'Paused'
  }))
  for (const name of ['Alice', 'Bob']) {
    const student = Object.assign(new Student(), { name })
    for (const business of ['Active', 'Paused']) {
      const result = new InterviewResult(name, '1', business, '', '', '', 'Yes', '5')
      result.employerAccept = true
      student.interviewResults.push(result)
    }
    data.students[name] = student
  }
  return data
}

it('excludes inactive employers from both schedule and matching, without mutating their records', () => {
  const data = fixture()
  expect(generateSchedule(data).map((i) => i.employer)).toEqual(['Active', 'Active'])
  expect(matchInternships(matchingInput(data)).assignments.map((i) => i.company)).toEqual([
    'Active',
    'Active'
  ])
  expect(data.employers).toHaveLength(2)
  expect(data.students.Alice.interviewResults).toHaveLength(2)
})
it('uses the latest round and never reuses earlier approval after a decline', () => {
  const data = fixture()
  const later = new InterviewResult('Alice', '2', 'Active', '', '', '', 'No', '5')
  later.employerAccept = true
  data.students.Alice.interviewResults.push(later)
  expect(matchInternships(matchingInput(data)).unmatchedStudents).toContain('Alice')
})
it('places every student within capacity and detects schedule overlaps', () => {
  const data = fixture()
  data.employers[1].active = true
  data.employers[0].capacity = 1
  const scheduled = generateSchedule(data)
  for (const interview of scheduled)
    expect(scheduleConflict(scheduled, interview, data)).toBeUndefined()
  const changed = { ...scheduled[1], time: '09:15' }
  expect(scheduleConflict(scheduled, changed, data)).toContain('times do not overlap')
  const result = matchInternships(matchingInput(data))
  expect(result.assignments.filter((a) => a.company === 'Active')).toHaveLength(1)
  expect(new Set(result.assignments.map((a) => a.student)).size).toBe(result.assignments.length)
})
