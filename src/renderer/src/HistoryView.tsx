import type { HistoryEntry } from '../../shared/workspace'

const when = (time: string) =>
  new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })

// Like `git log -p`: each approval closes a group of changes. Newest first throughout.
export default function HistoryView({ history }: { history: HistoryEntry[] }) {
  const groups: { approved?: HistoryEntry; changes: HistoryEntry[] }[] = [{ changes: [] }]
  for (const entry of history) {
    if (entry.kind === 'approve') {
      groups[0].approved = entry
      groups.unshift({ changes: [] })
    } else groups[0].changes.unshift(entry)
  }
  const shown = groups.filter((g) => g.approved || g.changes.length)
  if (!shown.length)
    return <p className="history-empty">No matching changes yet. Generate matching to start.</p>
  return (
    <section className="history">
      {shown.map((group) => (
        <div className="history-group" key={group.approved?.time ?? 'pending'}>
          <h3>
            {group.approved ? `Approved ${when(group.approved.time)}` : 'Not approved yet'}
            <span>
              {group.changes.length} change{group.changes.length === 1 ? '' : 's'}
            </span>
          </h3>
          {group.changes.map((entry, i) => (
            <div className="history-entry" key={i}>
              <time>{when(entry.time)}</time>
              <div>
                <span>{entry.summary}</span>
                {entry.before && <p className="diff-removed">− {entry.before}</p>}
                {entry.after && <p className="diff-added">+ {entry.after}</p>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
