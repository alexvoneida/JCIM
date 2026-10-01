import { useEffect, useState } from 'react'
import { Student } from '../../shared/student'

export default function App() {
  const [appVersion, setAppVersion] = useState('…')
  const { electron } = window.api.versions

  useEffect(() => {
    window.api
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('unknown'))
  }, [])

  async function handleClick() {
    const students: {[key: string] : Student} = await window.api.parseSheet();
    console.log(students);
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
        <button
            onClick={() => {void handleClick()}}
        >Parse Excel Sheet</button>
      </dl>
    </main>
  )
}
