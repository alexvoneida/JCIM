import { useEffect, useRef, useState } from 'react'

// Electron has no built-in find bar, so Ctrl/Cmd+F searches the visible text and marks matches with CSS highlights.
export default function FindBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setOpen(true)
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function search(text: string, index: number) {
    const needle = text.toLowerCase()
    const ranges: Range[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); needle && node; node = walker.nextNode()) {
      const parent = node.parentElement
      // Skip hidden views, closed details, dropdown options and the find bar itself.
      if (!parent || !parent.checkVisibility() || parent.closest('select, .find-bar')) continue
      const haystack = (node.textContent ?? '').toLowerCase()
      for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
        const range = new Range()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        ranges.push(range)
      }
    }
    const i = ranges.length ? (index + ranges.length) % ranges.length : 0
    CSS.highlights.set('find', new Highlight(...ranges))
    CSS.highlights.set('find-current', new Highlight(...ranges.slice(i, i + 1)))
    ranges[i]?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
    setCount(ranges.length)
    setCurrent(i)
  }

  function close() {
    CSS.highlights.clear()
    setOpen(false)
  }

  if (!open) return null
  return (
    <div className="find-bar" role="search">
      <input
        ref={input}
        autoFocus
        aria-label="Find in page"
        placeholder="Find in page"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          search(e.target.value, 0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search(query, current + (e.shiftKey ? -1 : 1))
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
      />
      <span className="find-count">
        {query && (count ? `${current + 1} of ${count}` : 'No matches')}
      </span>
      <button aria-label="Previous match" onClick={() => search(query, current - 1)}>
        ↑
      </button>
      <button aria-label="Next match" onClick={() => search(query, current + 1)}>
        ↓
      </button>
      <button aria-label="Close find" onClick={close}>
        ✕
      </button>
    </div>
  )
}
