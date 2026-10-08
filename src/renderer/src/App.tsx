import { useState } from 'react'
import InternshipMatching from './InternshipMatching'
import type { Student } from '../../shared/student'

export default function App() {
  const [students, setStudents] = useState<Record<string, Student>>({})
  const [page, setPage] = useState('home')

  if (page === 'matching') {
    return <InternshipMatching onBack={() => setPage('home')} />
  }

  async function parseSheet() {
    const result = await window.api.parseSheet()
    if (result == null) return
    setStudents(result)
  }

  function renderStudents() {
    const studentViews = []
    for (const [studentName, student] of Object.entries(students)) {
      const numInterviews = student.interviewResults.length
      studentViews.push(
        <p key={studentName}>
          {studentName}: {numInterviews} interviews.
        </p>
      )
    }
    return <div>{studentViews}</div>
  }

  return (
    <main>
      <h1 className="home-title">Jefferson County</h1>
      <button onClick={() => setPage('matching')}>Internship Matching</button>
      <button
        onClick={() => {
          void parseSheet()
        }}
      >
        Parse Excel Sheet
      </button>
      <button
        onClick={() => {
          void window.api.exportSheet(students)
        }}
      >
        Save New Sheet
      </button>
      {renderStudents()}
    </main>
  )
}
