import { useEffect, useState } from 'react'
import InternshipMatching from './InternshipMatching'

export default function App() {
  const [appVersion, setAppVersion] = useState('…')
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
          <button onClick={() => setPage('matching')}>
        Internship Matching
      </button>
    </main>
  )
}
