import { matchInternships } from './matching'
import type { MatchingInput, MatchingResult } from './matching-types'

// Compare the actual solution with the best solution when this student is forced
// into an alternative. This explains global tradeoffs without guessing why an
// individual augmenting path happened to win.
export function explainAlternative(
  input: MatchingInput,
  result: MatchingResult,
  student: string,
  company: string
): string {
  const rating = input.studentRatings.get(student)?.get(company)
  if (rating === undefined || !input.companyLikes.get(company)?.includes(student)) {
    return 'Not eligible: a student rating and employer approval are both required.'
  }
  const capacity = input.companyCapacities.get(company) ?? 0
  if (capacity < 1) return 'No places available at this employer.'
  const remainingRatings = new Map(input.studentRatings)
  remainingRatings.delete(student)
  const remainingCapacities = new Map(input.companyCapacities)
  remainingCapacities.set(company, capacity - 1)
  const alternative = matchInternships({
    ...input,
    studentRatings: remainingRatings,
    companyCapacities: remainingCapacities
  })
  const lostPlaces = result.assignments.length - (alternative.assignments.length + 1)
  const lostRating = result.totalRating - (alternative.totalRating + rating)
  if (lostPlaces > 0) {
    return `Placing here would leave ${lostPlaces} fewer student${lostPlaces === 1 ? '' : 's'} matched overall.`
  }
  if (lostRating > 0) {
    return `Placing here would lower the group's total preference score by ${lostRating} point${lostRating === 1 ? '' : 's'}.`
  }
  return 'An equally optimal placement exists here. Input order breaks ties; employer list order is not a ranking.'
}
