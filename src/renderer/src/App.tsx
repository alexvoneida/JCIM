import { useEffect, useState } from 'react'

export default function App() {
  const [appVersion, setAppVersion] = useState('…')
  const { electron } = window.api.versions

  useEffect(() => {
    window.api
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('unknown'))
  }, [])

  return (
    <main>
      <h1>Hello from JCIM</h1>
      <p>The desktop app is running.</p>
      <dl>
        <dt>App</dt>
        <dd>{appVersion}</dd>
        <dt>Electron</dt>
        <dd>{electron}</dd>
        <button
            onClick={async () => {console.log(await window.api.parseSheet())}}
        >Parse Excel Sheet</button>
      </dl>
    </main>
  )
}
