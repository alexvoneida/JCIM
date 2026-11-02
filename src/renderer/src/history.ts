import type { HistoryEntry, Placement, Workspace } from '../../shared/workspace'
import type { InterviewResult } from '../../shared/interviewResult'
import { samePlacement } from '../../shared/roles'
import { preference } from './workspace-flow'

export const placementLabel = (p: Placement) =>
  [p.company, p.role, `${p.rating}/5`].filter(Boolean).join(' · ')

const rating = (i: InterviewResult) => {
  const value = preference(i)
  return value ? `${value}/5` : 'Not rated'
}
const response = (i: InterviewResult) =>
  i.employerAccept === undefined ? 'Pending' : i.employerAccept ? 'Approved' : 'Declined'

// Every change goes through App's commit, so history is recorded by comparing the
// workspace before and after rather than at each place that edits it.
export function recordHistory(prev: Workspace, next: Workspace, time = new Date().toISOString()) {
  // An import replaces the whole workspace, including its history.
  if (next.importedAt !== prev.importedAt) return next
  const entries: HistoryEntry[] = []
  const add = (kind: HistoryEntry['kind'], summary: string, before?: string, after?: string) =>
    entries.push({ time, kind, summary, before, after })

  for (const [name, student] of Object.entries(next.students)) {
    student.interviewResults.forEach((now, index) => {
      const was = prev.students[name]?.interviewResults[index]
      if (!was) return
      const where = `${name} at ${now.business}`
      if (rating(was) !== rating(now))
        add('feedback', `Student rating: ${where}`, rating(was), rating(now))
      if (response(was) !== response(now))
        add('feedback', `Employer response: ${where}`, response(was), response(now))
    })
  }

  if (next.autoPlacements !== prev.autoPlacements && next.placements === next.autoPlacements) {
    add('generate', `Generated matching: ${next.placements.length} placed`)
  } else if (next.autoPlacements !== prev.autoPlacements) {
    // Every other change to the generated matching clears it.
    const removed = prev.placements.length
    if (removed)
      add('cleared', `Matching cleared: ${removed} placement${removed === 1 ? '' : 's'} removed`)
  } else {
    const students = new Set([...prev.placements, ...next.placements].map((p) => p.student))
    for (const student of students) {
      const from = prev.placements.find((p) => p.student === student)
      const to = next.placements.find((p) => p.student === student)
      if (!samePlacement(from, to))
        add(
          'placement',
          `Manual placement: ${student}`,
          from ? placementLabel(from) : 'Unmatched',
          to ? placementLabel(to) : 'Unmatched'
        )
    }
  }
  if (next.matchingApproved && !prev.matchingApproved) add('approve', 'Approved')
  return entries.length ? { ...next, history: [...(next.history ?? []), ...entries] } : next
}
