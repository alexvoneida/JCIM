import type { Workspace } from '../../shared/workspace'
import type { InterviewResult } from '../../shared/interviewResult'
import { latestInterviews } from '../../shared/feedback'
import type { JobRole, MatchingInput, Rating } from './matching-types'
import { employerRoles } from '../../shared/roles'

export function preference(result: Pick<InterviewResult, 'rank'>): Rating | undefined {
  return Number.isInteger(result.rank) && result.rank >= 1 && result.rank <= 5
    ? (result.rank as Rating)
    : undefined
}

export function latestFeedback(data: Workspace) {
  return Object.values(data.students).flatMap((s) =>
    latestInterviews(s).map(({ interview, index }) => ({ ...interview, index, student: s.name }))
  )
}

export function matchingInput(data: Workspace): MatchingInput {
  const active = data.employers.filter((e) => e.active)
  const feedback = latestFeedback(data)
  const eligible = feedback.filter(
    (i) =>
      // Both sides must want the match: the employer approved and the student did not decline.
      i.employerAccept === true &&
      i.acceptance !== false &&
      preference(i) !== undefined &&
      active.some((e) => e.name === i.business)
  )
  const roles: JobRole[] = active.flatMap((e) =>
    employerRoles(e).map((r, i) => ({
      id: JSON.stringify([e.name, i]),
      company: e.name,
      title: r.title,
      tags: r.tags,
      capacity: r.capacity
    }))
  )
  return {
    roles,
    companyLikes: new Map(
      active.map((e) => [
        e.name,
        eligible.filter((i) => i.business === e.name).map((i) => i.student)
      ])
    ),
    studentRatings: new Map(
      Object.values(data.students).map((s) => [
        s.name,
        new Map(
          eligible.filter((i) => i.student === s.name).map((i) => [i.business, preference(i)!])
        )
      ])
    ),
    studentInterests: new Map(Object.values(data.students).map((s) => [s.name, s.interests ?? []]))
  }
}

export { generateSchedule, scheduleConflict, minutes, timeLabel } from '../../shared/scheduling'
