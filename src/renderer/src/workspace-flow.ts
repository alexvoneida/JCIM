import type { Workspace } from '../../shared/workspace'
import type { InterviewResult } from '../../shared/interviewResult'
import { latestInterviews } from '../../shared/feedback'
import type { MatchingInput, Rating } from './matching-types'

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
      i.employerAccept === true &&
      i.acceptance !== false &&
      preference(i) !== undefined &&
      active.some((e) => e.name === i.business)
  )
  return {
    companyCapacities: new Map(active.map((e) => [e.name, e.capacity])),
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
    )
  }
}

export { generateSchedule, scheduleConflict, minutes, timeLabel } from '../../shared/scheduling'
