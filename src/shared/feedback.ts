import type { Student } from './student'
import type { InterviewResult } from './interviewResult'

// The latest wave holds the current decision. Later rows break ties within a wave.
export function latestInterviews(student: Student) {
  const latest = new Map<string, { interview: InterviewResult; index: number }>()
  for (const [index, interview] of student.interviewResults.entries()) {
    const previous = latest.get(interview.business)
    if (!previous || interview.wave >= previous.interview.wave)
      latest.set(interview.business, { interview, index })
  }
  return [...latest.values()]
}
