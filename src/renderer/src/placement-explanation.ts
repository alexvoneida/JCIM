import { canFill, matchInternships } from './matching'
import { sameRole } from '../../shared/roles'
import type { MatchingInput, MatchingResult } from './matching-types'

// Compare the actual solution with the best solution when this student is forced
// into an alternative. This explains global tradeoffs without guessing why an
// individual augmenting path happened to win.
export function explainAlternative(
  input: MatchingInput,
  result: Pick<MatchingResult, 'assignments'>,
  student: string,
  company: string,
  // Limits the alternative to one role, e.g. another role at the student's own employer.
  roleTitle?: string | null
): string {
  const rating = input.studentRatings.get(student)?.get(company)
  if (rating === undefined || !input.companyLikes.get(company)?.includes(student)) {
    return `${student} and ${company} have not both approved and rated each other.`
  }
  const where = roleTitle ? `${company}’s ${roleTitle} role` : company
  const companyRoles = input.roles.filter(
    (r) =>
      r.company === company &&
      r.capacity >= 1 &&
      (roleTitle === undefined || sameRole(r.title, roleTitle))
  )
  if (!companyRoles.length) return `${where} has no places.`
  const fitting = companyRoles.filter((r) => canFill(input, student, r))
  if (!fitting.length)
    return roleTitle
      ? `${student}’s interests don’t match ${where}.`
      : `None of ${company}’s roles match ${student}’s interests.`
  const remainingRatings = new Map(input.studentRatings)
  remainingRatings.delete(student)
  // Force the student into each fitting role and keep the best remaining allocation.
  const alternative = fitting
    .map((role) =>
      matchInternships({
        ...input,
        studentRatings: remainingRatings,
        roles: input.roles.map((r) => (r.id === role.id ? { ...r, capacity: r.capacity - 1 } : r))
      })
    )
    .reduce((best, option) =>
      option.assignments.length > best.assignments.length ||
      (option.assignments.length === best.assignments.length &&
        option.totalRating > best.totalRating)
        ? option
        : best
    )
  // Compare everyone else's best outcome with this student here against the actual matching.
  const current = result.assignments.find((a) => a.student === student)
  const others = result.assignments.filter((a) => a.student !== student)
  const lostPlaces = others.length - alternative.assignments.length
  const lostPoints = others.reduce((sum, a) => sum + a.rating, 0) - alternative.totalRating
  // An unmatched student gains a place, so one other student losing theirs keeps the count level.
  const fewerPlaced = lostPlaces - (current ? 0 : 1)
  if (fewerPlaced > 0)
    return `Placing ${student} here would leave ${lostPlaces} other student${lostPlaces === 1 ? '' : 's'} without a placement.`
  const gain = rating - (current?.rating ?? 0)
  if (fewerPlaced < 0 || lostPoints < gain)
    return `Placing ${student} here could give a better overall matching. Generate matching again to check.`
  const points = (n: number) => `${n} point${n === 1 ? '' : 's'}`
  if (!current)
    return lostPoints === gain
      ? `Placing ${student} here (${rating}/5) would take another student’s place and be equally good overall, so the app picked one.`
      : `Placing ${student} here (${rating}/5) would take another student’s place, and other students’ ratings would drop by ${points(lostPoints)} in total.`
  // Another role at the same employer: the student's rating is the same, so only others matter.
  if (current.company === company)
    return lostPoints === 0
      ? `Either role works for ${student}, so the app picked one.`
      : `Placing ${student} in this role would lower other students’ ratings by ${points(lostPoints)} in total.`
  const compared = `${rating}/5 vs ${current.rating}/5 for ${current.company}`
  if (gain === 0 && lostPoints === 0)
    return `${student} rated both ${rating}/5. Either works, so the app picked one.`
  if (lostPoints === gain)
    return `Equally good overall: ${student} rated ${company} ${gain > 0 ? 'higher' : 'lower'} (${compared}), and other students’ ratings would ${gain > 0 ? 'drop' : 'rise'} by ${points(Math.abs(gain))} in total. The app picked one.`
  if (gain < 0) return `${student} rated ${company} lower (${compared}).`
  return `${student} rated ${company} ${gain > 0 ? `higher (${compared})` : `the same (${rating}/5)`}, but placing ${student} here would lower other students’ ratings by ${points(lostPoints)} in total.`
}
