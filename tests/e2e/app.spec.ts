import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { version } from '../../package.json'

// Set JCIM_EXECUTABLE to test a packaged or installed build; otherwise the
// compiled app in out/ is launched with the local Electron.
const executablePath = process.env['JCIM_EXECUTABLE']

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch(executablePath ? { executablePath } : { args: ['.'] })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
})

test('opens a window showing the landing page', async () => {
  await expect(page).toHaveTitle('JCIM')
  await expect(page.getByRole('heading', { name: 'Jefferson County' })).toBeVisible()
})

test('returns the app version over IPC', async () => {
  expect(await page.evaluate(() => window.api.getAppVersion())).toBe(version)
})

test('runs the renderer in an OS-level sandbox', async () => {
  test.skip(
    process.platform === 'linux',
    'Electron reports sandbox status only on macOS and Windows'
  )
  const renderers = await app.evaluate(({ app }) =>
    app.getAppMetrics().filter((metric) => metric.type === 'Tab')
  )
  expect(renderers.length).toBeGreaterThan(0)
  expect(renderers.every((renderer) => renderer.sandboxed === true)).toBe(true)
})

test('exposes only the preload API to the renderer', async () => {
  const globals = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    api: Object.keys(window.api).sort()
  }))
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    api: ['exportSheet', 'getAppVersion', 'parseSheet', 'versions']
  })
})

test('blocks the renderer from opening new windows', async () => {
  const opened = await page.evaluate(() => window.open('https://example.com') !== null)
  expect(opened).toBe(false)
  expect(app.windows()).toHaveLength(1)
})
