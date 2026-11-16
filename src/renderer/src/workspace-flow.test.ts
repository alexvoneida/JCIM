import { expect, it } from 'vitest'
import { emptyWorkspace } from '../../shared/workspace'
import { Student } from '../../shared/student'
import { InterviewResult } from '../../shared/interviewResult'
import { generateSchedule, matchingInput, scheduleConflict } from './workspace-flow'
import { matchInternships } from './matching'

function fixture() {
  const data = emptyWorkspace()
  data.employers = ['Active', 'Paused', 'Second', 'Third'].map((name) => ({
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
  const scheduled = generateSchedule(data).schedule
  expect(scheduled).toHaveLength(6)
  expect(scheduled.map((i) => i.employer)).not.toContain('Paused')
  expect(matchInternships(matchingInput(data)).assignments.map((i) => i.company)).toEqual([
    'Active',
    'Active'
  ])
  expect(data.employers).toHaveLength(4)
  expect(data.students.Alice.interviewResults).toHaveLength(2)
})
it('uses the latest round and never reuses earlier approval after an employer decline', () => {
  const data = fixture()
  const later = new InterviewResult('Alice', '2', 'Active', '', '', '', '', '5')
  later.employerAccept = false
  data.students.Alice.interviewResults.push(later)
  expect(matchInternships(matchingInput(data)).unmatchedStudents).toContain('Alice')
})
it('never places a student with an employer they declined', () => {
  const data = fixture()
  data.students.Alice.interviewResults[0].acceptance = false
  expect(matchInternships(matchingInput(data)).unmatchedStudents).toEqual(['Alice'])
})
it('places every student within capacity and detects schedule overlaps', () => {
  const data = fixture()
  data.employers[1].active = true
  data.employers[0].capacity = 1
  const { schedule: scheduled, waves } = generateSchedule(data)
  data.waves = waves
  for (const interview of scheduled)
    expect(scheduleConflict(scheduled, interview, data)).toBeUndefined()
  // Every student interviews in each round, so moving to another round double-books them.
  const changed = { ...scheduled[0], round: (scheduled[0].round % 3) + 1 }
  expect(scheduleConflict(scheduled, changed, data)).toContain('Alice is booked twice')
  const result = matchInternships(matchingInput(data))
  expect(result.assignments.filter((a) => a.company === 'Active')).toHaveLength(1)
  expect(new Set(result.assignments.map((a) => a.student)).size).toBe(result.assignments.length)
})
it('matches approved students to roles by interest, ignoring interview positions', () => {
  const data = fixture()
  data.employers[0].roles = [
    { title: 'Engineering', capacity: 1 },
    { title: 'HR', capacity: 1, tags: ['Human Resources'] }
  ]
  data.students.Alice.interests = ['Engineering']
  data.students.Bob.interests = ['Engineering']
  // Positions and the employer's positions list no longer decide the role.
  data.students.Bob.interviewResults[0].employerPositions = 'HR'
  let result = matchInternships(matchingInput(data))
  expect(result.assignments).toEqual([
    { student: 'Alice', company: 'Active', role: 'Engineering', rating: 5 }
  ])
  expect(result.unmatchedStudents).toEqual(['Bob'])
  data.students.Bob.interests = ['Human Resources']
  result = matchInternships(matchingInput(data))
  expect(result.assignments.map((a) => a.role)).toEqual(['Engineering', 'HR'])
})
