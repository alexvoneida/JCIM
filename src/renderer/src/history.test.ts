import { expect, it } from 'vitest'
import { emptyWorkspace, type Placement, type Workspace } from '../../shared/workspace'
import { Student } from '../../shared/student'
import { InterviewResult } from '../../shared/interviewResult'
import { recordHistory } from './history'

const time = '2026-10-26T15:00:00.000Z'
const aero: Placement = { student: 'Alice', company: 'Aero', role: null, rating: 5 }
const beta: Placement = { student: 'Alice', company: 'Beta', role: null, rating: 3 }

function withFeedback(rank: string, employerAccept: boolean | undefined): Workspace {
  const data = emptyWorkspace()
  const student = Object.assign(new Student(), { name: 'Alice' })
  const interview = new InterviewResult('Alice', '1', 'Aero', '', '', '', '', rank)
  interview.employerAccept = employerAccept
  student.interviewResults.push(interview)
  data.students.Alice = student
  return data
}

it('records a generated matching with the number placed', () => {
  const prev = emptyWorkspace()
  const placements = [aero]
  const next = recordHistory(prev, { ...prev, placements, autoPlacements: placements }, time)
  expect(next.history).toEqual([
    { time, kind: 'generate', summary: 'Generated matching: 1 placed' }
  ])
})

it('shows both sides of every manual placement change, including unmatching', () => {
  const prev = { ...emptyWorkspace(), placements: [aero], autoPlacements: [aero] }
  expect(recordHistory(prev, { ...prev, placements: [beta] }, time).history).toEqual([
    {
      time,
      kind: 'placement',
      summary: 'Manual placement: Alice',
      before: 'Aero · 5/5',
      after: 'Beta · 3/5'
    }
  ])
  expect(recordHistory(prev, { ...prev, placements: [] }, time).history?.[0]).toMatchObject({
    before: 'Aero · 5/5',
    after: 'Unmatched'
  })
})

it('records rating and employer response edits, and what they cleared', () => {
  const prev = { ...withFeedback('5', true), placements: [aero], autoPlacements: [aero] }
  const next = { ...withFeedback('2', false), placements: [], autoPlacements: [] }
  expect(
    recordHistory(prev, next, time).history?.map((e) => [e.summary, e.before, e.after])
  ).toEqual([
    ['Student rating: Alice at Aero', '5/5', '2/5'],
    ['Employer response: Alice at Aero', 'Approved', 'Declined'],
    ['Matching cleared: 1 placement removed', undefined, undefined]
  ])
  // Later edits are still recorded once there is nothing left to clear.
  const again = { ...withFeedback('3', false), placements: [], autoPlacements: [] }
  expect(recordHistory(next, again, time).history?.map((e) => e.summary)).toEqual([
    'Student rating: Alice at Aero'
  ])
})

it('records approvals and cleared matchings, and ignores unrelated edits', () => {
  const prev = { ...emptyWorkspace(), placements: [aero], autoPlacements: [aero] }
  expect(recordHistory(prev, { ...prev, matchingApproved: true }, time).history).toEqual([
    { time, kind: 'approve', summary: 'Approved' }
  ])
  const employers = [{ name: 'Aero', industry: '', capacity: 2, active: true }]
  expect(
    recordHistory(prev, { ...prev, employers, placements: [], autoPlacements: [] }, time)
      .history?.[0].summary
  ).toBe('Matching cleared: 1 placement removed')
  expect(
    recordHistory(prev, { ...prev, interviewDate: '2026-11-01' }, time).history
  ).toBeUndefined()
})

it('starts fresh on import instead of recording the imported placements as changes', () => {
  const prev = { ...emptyWorkspace(), placements: [aero] }
  const imported = { ...emptyWorkspace(), placements: [beta], importedAt: time }
  expect(recordHistory(prev, imported, time)).toBe(imported)
})
