import { expect, it } from 'vitest'
import { matchInternships } from './matching'
import { explainAlternative } from './placement-explanation'
import type { MatchingInput, Rating } from './matching-types'

function fixture(): MatchingInput {
  return {
    companyLikes: new Map([
      ['A', ['Flexible', 'Limited']],
      ['B', ['Flexible']]
    ]),
    companyCapacities: new Map([
      ['A', 1],
      ['B', 1]
    ]),
    studentRatings: new Map<string, Map<string, Rating>>([
      [
        'Flexible',
        new Map([
          ['A', 5],
          ['B', 2]
        ])
      ],
      ['Limited', new Map([['A', 4]])]
    ])
  }
}

it('prioritizes placement count over a higher individual preference and explains it', () => {
  const input = fixture()
  const result = matchInternships(input)
  expect(result.assignments).toEqual([
    { student: 'Flexible', company: 'B', rating: 2 },
    { student: 'Limited', company: 'A', rating: 4 }
  ])
  expect(result.totalRating).toBe(6)
  expect(explainAlternative(input, result, 'Flexible', 'A')).toContain('1 fewer student matched')
})

it('explains the score tradeoff when the placement count stays the same', () => {
  const input = fixture()
  input.companyLikes.set('B', ['Flexible', 'Limited'])
  input.studentRatings.get('Limited')!.set('B', 1)
  input.studentRatings.get('Flexible')!.set('B', 5)
  const result = matchInternships(input)
  expect(result.totalRating).toBe(9)
  expect(explainAlternative(input, result, 'Flexible', 'A')).toContain('3 points')
})

it('identifies equal solutions, zero capacity and ineligible alternatives without mutating inputs', () => {
  const input = fixture()
  input.companyCapacities.set('A', 2)
  input.studentRatings.get('Flexible')!.set('B', 5)
  const result = matchInternships(input)
  expect(explainAlternative(input, result, 'Flexible', 'B')).toContain('equally optimal')
  expect(input.studentRatings.size).toBe(2)
  expect(input.companyCapacities.get('A')).toBe(2)
  expect(explainAlternative(input, result, 'Limited', 'B')).toContain('Not eligible')
  input.companyCapacities.set('B', 0)
  expect(explainAlternative(input, result, 'Flexible', 'B')).toContain('No places available')
})

it('leaves students unmatched when no mutually approved option exists', () => {
  const input = fixture()
  input.companyLikes.set('A', [])
  const result = matchInternships(input)
  expect(result.unmatchedStudents).toEqual(['Limited'])
  expect(result.assignments).toEqual([{ student: 'Flexible', company: 'B', rating: 2 }])
})
