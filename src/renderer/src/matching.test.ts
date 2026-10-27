import { expect, it } from 'vitest'
import { matchInternships } from './matching'
import { explainAlternative } from './placement-explanation'
import type { JobRole, MatchingInput, Rating } from './matching-types'

const general = (company: string, capacity: number): JobRole => ({
  id: company,
  company,
  title: null,
  tags: [],
  capacity
})

function setCapacity(input: MatchingInput, company: string, capacity: number) {
  input.roles = input.roles.map((r) => (r.company === company ? { ...r, capacity } : r))
}

function fixture(): MatchingInput {
  return {
    companyLikes: new Map([
      ['A', ['Flexible', 'Limited']],
      ['B', ['Flexible']]
    ]),
    roles: [general('A', 1), general('B', 1)],
    studentRatings: new Map<string, Map<string, Rating>>([
      [
        'Flexible',
        new Map([
          ['A', 5],
          ['B', 2]
        ])
      ],
      ['Limited', new Map([['A', 4]])]
    ]),
    studentInterests: new Map()
  }
}

it('prioritizes placement count over a higher individual preference and explains it', () => {
  const input = fixture()
  const result = matchInternships(input)
  expect(result.assignments).toEqual([
    { student: 'Flexible', company: 'B', role: null, rating: 2 },
    { student: 'Limited', company: 'A', role: null, rating: 4 }
  ])
  expect(result.totalRating).toBe(6)
  expect(explainAlternative(input, result, 'Flexible', 'A')).toBe(
    'Placing Flexible here would leave 1 other student without a placement.'
  )
})

it('explains the score tradeoff when the placement count stays the same', () => {
  const input = fixture()
  input.companyLikes.set('B', ['Flexible', 'Limited'])
  input.studentRatings.get('Limited')!.set('B', 1)
  input.studentRatings.get('Flexible')!.set('B', 5)
  const result = matchInternships(input)
  expect(result.totalRating).toBe(9)
  expect(explainAlternative(input, result, 'Flexible', 'A')).toBe(
    'Flexible rated A the same (5/5), but placing Flexible here would lower other students’ ratings by 3 points in total.'
  )
})

it('identifies equal solutions, zero capacity and ineligible alternatives without mutating inputs', () => {
  const input = fixture()
  setCapacity(input, 'A', 2)
  input.studentRatings.get('Flexible')!.set('B', 5)
  const result = matchInternships(input)
  expect(explainAlternative(input, result, 'Flexible', 'B')).toBe(
    'Flexible rated both 5/5. Either works, so the app picked one.'
  )
  expect(input.studentRatings.size).toBe(2)
  expect(input.roles.find((r) => r.company === 'A')!.capacity).toBe(2)
  expect(explainAlternative(input, result, 'Limited', 'B')).toContain('have not both approved')
  setCapacity(input, 'B', 0)
  expect(explainAlternative(input, result, 'Flexible', 'B')).toBe('B has no places.')
})

it('leaves students unmatched when no mutually approved option exists', () => {
  const input = fixture()
  input.companyLikes.set('A', [])
  const result = matchInternships(input)
  expect(result.unmatchedStudents).toEqual(['Limited'])
  expect(result.assignments).toEqual([{ student: 'Flexible', company: 'B', role: null, rating: 2 }])
})

// Jeffco interviews everyone together and only says yes or no.
// Roles decide who can be placed where, based on student interests.
function roleFixture(): MatchingInput {
  return {
    companyLikes: new Map([['Jeffco', ['Eng1', 'Eng2', 'People']]]),
    studentRatings: new Map<string, Map<string, Rating>>([
      ['Eng1', new Map([['Jeffco', 5]])],
      ['Eng2', new Map([['Jeffco', 4]])],
      ['People', new Map([['Jeffco', 3]])]
    ]),
    roles: [
      { id: 'eng', company: 'Jeffco', title: 'Engineering', tags: ['Engineering'], capacity: 1 },
      {
        id: 'hr',
        company: 'Jeffco',
        title: 'HR',
        tags: ['Human Resources', 'Business'],
        capacity: 1
      }
    ],
    studentInterests: new Map([
      ['Eng1', ['engineering']],
      ['Eng2', ['Engineering', 'Aerospace']],
      ['People', ['Business']]
    ])
  }
}

it('places students only in roles whose tags match their interests', () => {
  const result = matchInternships(roleFixture())
  expect(result.assignments).toEqual([
    { student: 'Eng1', company: 'Jeffco', role: 'Engineering', rating: 5 },
    { student: 'People', company: 'Jeffco', role: 'HR', rating: 3 }
  ])
  expect(result.unmatchedStudents).toEqual(['Eng2'])
})

it('never puts an approved engineer into the HR role, even when it is empty', () => {
  const input = roleFixture()
  input.studentRatings.delete('People')
  const result = matchInternships(input)
  expect(result.assignments).toEqual([
    { student: 'Eng1', company: 'Jeffco', role: 'Engineering', rating: 5 }
  ])
  expect(result.unmatchedStudents).toEqual(['Eng2'])
  expect(explainAlternative(input, result, 'Eng2', 'Jeffco')).not.toContain('None of')
})

it('lets any approved student fill general places but not roles without a matching interest', () => {
  const input = roleFixture()
  input.studentInterests.set('People', [])
  input.companyLikes.set('Beta', ['People'])
  input.studentRatings.get('People')!.set('Beta', 2)
  input.roles.push(general('Beta', 1))
  const result = matchInternships(input)
  expect(result.assignments).toContainEqual({
    student: 'People',
    company: 'Beta',
    role: null,
    rating: 2
  })
  expect(explainAlternative(input, result, 'People', 'Jeffco')).toContain(
    'None of Jeffco’s roles match'
  )
})

it('rejects duplicate role ids', () => {
  const input = roleFixture()
  input.roles[1].id = 'eng'
  expect(() => matchInternships(input)).toThrow(/unique id/)
})

it('explains other roles at the same employer', () => {
  const role = (title: string): JobRole => ({
    id: title,
    company: 'Aero',
    title,
    tags: [title],
    capacity: 1
  })
  const input: MatchingInput = {
    roles: [role('Engineering'), role('Design')],
    companyLikes: new Map([['Aero', ['Alice', 'Bob']]]),
    studentRatings: new Map([
      ['Alice', new Map([['Aero', 5]])],
      ['Bob', new Map([['Aero', 5]])]
    ]),
    studentInterests: new Map([
      ['Alice', ['Engineering', 'Design']],
      ['Bob', ['Engineering']]
    ])
  }
  let result = matchInternships(input)
  expect(explainAlternative(input, result, 'Alice', 'Aero', 'Engineering')).toBe(
    'Placing Alice here would leave 1 other student without a placement.'
  )
  expect(explainAlternative(input, result, 'Bob', 'Aero', 'Design')).toBe(
    'Bob’s interests don’t match Aero’s Design role.'
  )
  input.studentRatings.delete('Bob')
  result = matchInternships(input)
  expect(explainAlternative(input, result, 'Alice', 'Aero', 'Design')).toBe(
    'Either role works for Alice, so the app picked one.'
  )
})
