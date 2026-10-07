import { useEffect, useState } from 'react'
import InternshipMatching from './InternshipMatching'
import type { Student } from '../../shared/student'

export default function App() {
  const [appVersion, setAppVersion] = useState('…')
  const [students, setStudents] = useState<Record<string, Student>>({})
  const { electron } = window.api.versions
  const [page, setPage] = useState('home')

  useEffect(() => {
    window.api
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('unknown'))
  }, [])

  if (page === 'matching') {
    return <InternshipMatching />
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
      <h1>Hello from JCIM</h1>
      <p>The desktop app is running.</p>
      <dl>
        <dt>App</dt>
        <dd>{appVersion}</dd>
        <dt>Electron</dt>
        <dd>{electron}</dd>
      </dl>
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
