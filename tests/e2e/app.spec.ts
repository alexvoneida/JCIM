import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { createTracker } from './workbook-fixture'
import { version } from '../../package.json'

// Set JCIM_EXECUTABLE to test a packaged or installed build; otherwise the
// compiled app in out/ is launched with the local Electron.
const executablePath = process.env['JCIM_EXECUTABLE']

// These steps share one workspace and build on the prior import/export flow.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let scratch: string

test.beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'jcim-e2e-'))
  app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'] }),
    env: { ...process.env, JCIM_TEST_USER_DATA_DIR: scratch, JCIM_TEST_NONINTERACTIVE: '1' }
  })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  if (page && !page.isClosed())
    await page.evaluate((testPath) => {
      const saved = localStorage.getItem('jcim-workspace-v1')
      if (saved?.includes(testPath)) localStorage.removeItem('jcim-workspace-v1')
    }, scratch)
  await app?.close()
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

test.afterEach(async ({ browserName }, testInfo) => {
  void browserName
  if (testInfo.status === testInfo.expectedStatus || !page || page.isClosed()) return
  const screenshot = await page.screenshot({
    path: testInfo.outputPath('ui-failure.png'),
    fullPage: true
  })
  await testInfo.attach('UI at failure', { body: screenshot, contentType: 'image/png' })
})

test('opens a window showing the landing page', async () => {
  await expect(page).toHaveTitle('JCIM')
  await expect(page.getByRole('heading', { name: 'Student Overview' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Start with your workbook' })).toBeVisible()
  await expect(page.getByText(/student workbook/i)).toHaveCount(0)
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

test('imports, manages employers, schedules, matches, and exports a re-importable workbook', async () => {
  const source = join(scratch, 'tracker.xlsx')
  const scheduleExport = join(scratch, 'schedule-export.xlsx')
  const destination = join(scratch, 'JCIM-export.xlsx')
  await createTracker(source)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] })
  }, source)
  await page.getByRole('button', { name: 'Import sheet', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Leonard Williams' })).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss message' }).click()
  await page.getByRole('button', { name: 'Interview Schedule', exact: true }).click()
  await page.getByRole('button', { name: 'Edit schedule window and interview length' }).click()
  await page.getByLabel('Schedule end time', { exact: true }).fill('11:00')
  await page.getByLabel('Default interview length (minutes)', { exact: true }).fill('20')
  await page.getByRole('button', { name: 'Save schedule settings' }).click()
  await page.getByRole('button', { name: 'Edit interview settings for Mike’s Anchors' }).click()
  await page.getByLabel('Employer end time', { exact: true }).fill('10:00')
  await page.getByLabel('Employer interview length (minutes)', { exact: true }).fill('15')
  await page.getByLabel('Students at once').fill('2')
  await page.getByRole('button', { name: 'Save employer settings' }).click()
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).first().click()
  const parallel = page.locator(
    '.timetable-interview[data-employer="Mike’s Anchors"][data-start="09:00"]'
  )
  await expect(parallel).toHaveCount(2)
  const parallelRects = await parallel.evaluateAll((cards) =>
    cards.map((c) => {
      const rect = c.getBoundingClientRect()
      return { top: rect.top, left: rect.left, right: rect.right }
    })
  )
  expect(parallelRects[0].top).toBe(parallelRects[1].top)
  expect(parallelRects[0].right).toBeLessThan(parallelRects[1].left)
  // Times also align across companies, not only within one company's column.
  const simultaneousTops = await page
    .locator('.timetable-interview[data-start="09:00"]')
    .evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect().top))
  expect(new Set(simultaneousTops).size).toBe(1)
  await page.getByLabel('Interview date', { exact: true }).fill('2026-10-15')
  await page.getByRole('button', { name: 'Approve schedule', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Schedule approved' })).toBeDisabled()
  await page.getByRole('button', { name: 'Edit schedule', exact: true }).click()
  await page
    .getByRole('button', { name: 'Edit interview for Ernest Jones at Mike’s Anchors, round 1' })
    .click()
  await page.getByLabel('Start time', { exact: true }).fill('10:30')
  await page.getByLabel('Interview length override (minutes)', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Save interview', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('outside this employer')
  await page.getByLabel('Start time', { exact: true }).fill('09:30')
  await page.getByRole('button', { name: 'Save interview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve schedule' })).toBeEnabled()
  await expect(page.getByText('10 min · override')).toBeVisible()
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  await page.getByRole('button', { name: 'Approve schedule', exact: true }).click()
  await page.getByRole('button', { name: 'Dismiss message' }).click()
  // Settings and manual overrides must survive real IPC export and re-import.
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
  }, scheduleExport)
  await page.getByRole('button', { name: 'Export sheet', exact: true }).click()
  await expect(page.getByText('Workbook exported', { exact: true })).toBeVisible()
  const scheduleWorkbook = new ExcelJS.Workbook()
  await scheduleWorkbook.xlsx.readFile(scheduleExport)
  const mike = scheduleWorkbook
    .getWorksheet('JCIM Employers')!
    .getRows(2, 4)!
    .find((r) => r.getCell(1).text === 'Mike’s Anchors')!
  expect(mike.getCell(6).text).toBe('10:00')
  expect(mike.getCell(7).value).toBe(15)
  expect(mike.getCell(8).value).toBe(2)
  const ernest = scheduleWorkbook
    .getWorksheet('JCIM Schedule')!
    .getRows(2, 20)!
    .find((r) => r.getCell(2).text === 'Ernest Jones')!
  expect(ernest.getCell(4).text).toBe('09:30')
  expect(ernest.getCell(6).value).toBe(10)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] })
  }, scheduleExport)
  await page.getByRole('button', { name: 'Import sheet', exact: true }).click()
  await page.getByRole('button', { name: 'Choose workbook', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Student Overview', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Interview Schedule', exact: true }).click()
  await expect(page.getByText('10 min · override')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Schedule approved' })).toBeDisabled()
  await page.getByRole('button', { name: 'Final Matching', exact: true }).click()
  await page.getByRole('button', { name: 'Generate matching', exact: true }).click()
  await expect(page.locator('.feedback-card.selected')).toHaveCount(9)
  await page.getByRole('button', { name: 'Approve matching', exact: true }).click()
  await page.getByRole('button', { name: 'Dismiss message' }).click()
  await page.getByRole('button', { name: 'Employers', exact: true }).click()
  await page.getByRole('switch', { name: 'Participation for Frontier Aero' }).click()
  await expect(
    page.getByRole('switch', { name: 'Participation for Frontier Aero' })
  ).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'Interview Schedule', exact: true }).click()
  await expect(page.getByText('10 min · override')).toBeVisible()
  await expect(page.locator('.timetable-employer h2', { hasText: 'Frontier Aero' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Employers', exact: true }).click()
  await page.getByRole('button', { name: 'Dismiss message' }).click()
  await page.getByRole('button', { name: 'New employer', exact: true }).click()
  await page.getByLabel('Employer name', { exact: true }).fill('New Employer')
  await page.getByLabel('Industry', { exact: true }).selectOption('__other_industry__')
  await page.getByLabel('New industry name', { exact: true }).fill('Renewable energy')
  await page.getByLabel('Internship places', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Save employer' }).click()
  await expect(page.getByRole('heading', { name: 'New Employer' })).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss message' }).click()
  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  await page.getByRole('heading', { name: 'Leonard Williams', exact: true }).click()
  const studentDialog = page.getByRole('dialog', { name: 'Leonard Williams', exact: true })
  await studentDialog.getByRole('checkbox', { name: 'Renewable energy', exact: true }).check()
  await studentDialog
    .getByRole('checkbox', { name: 'Other — add an industry', exact: true })
    .check()
  await studentDialog.getByLabel('New industry name', { exact: true }).fill('Architecture')
  await studentDialog.getByRole('button', { name: 'Save industries' }).click()
  await expect(
    studentDialog.getByRole('checkbox', { name: 'Architecture', exact: true })
  ).toBeChecked()
  await studentDialog.getByRole('button', { name: 'Done', exact: true }).click()
  await rm(source) // Export must still retain the source tabs after the original file moves.
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
  }, destination)
  await page.getByRole('button', { name: 'Export sheet', exact: true }).click()
  await expect(page.getByText('Workbook exported', { exact: true })).toBeVisible()
  const exported = new ExcelJS.Workbook()
  await exported.xlsx.readFile(destination)
  expect(exported.getWorksheet('Student Good Fit')).toBeDefined()
  const employerRows = exported.getWorksheet('JCIM Employers')!
  const inactiveRow = employerRows
    .getRows(2, 5)!
    .find((r) => r.getCell(1).text === 'Frontier Aero')!
  expect(inactiveRow.getCell(4).text).toBe('No')
  expect(exported.getWorksheet('JCIM Students')!.rowCount).toBe(10)
  expect(exported.getWorksheet('JCIM Settings')!.getColumn(2).values).toContainEqual(
    expect.stringContaining('Architecture')
  )
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] })
  }, destination)
  await page.getByRole('button', { name: 'Import sheet', exact: true }).click()
  await page.getByRole('button', { name: 'Choose workbook' }).click()
  await expect(page.getByRole('heading', { name: 'Student Overview' })).toBeVisible()
  await page.getByRole('button', { name: 'Employers', exact: true }).click()
  await expect(
    page.getByRole('switch', { name: 'Participation for Frontier Aero' })
  ).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('heading', { name: 'New Employer' })).toBeVisible()
  await page.getByRole('button', { name: 'New employer', exact: true }).click()
  await expect(
    page
      .getByLabel('Industry', { exact: true })
      .getByRole('option', { name: 'Architecture', exact: true })
  ).toBeAttached()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('keeps interview cards readable and pins employer headers and time labels while scrolling at smaller window sizes', async () => {
  await page.getByRole('button', { name: 'Interview Schedule', exact: true }).click()
  const clippedCards = await page
    .locator('.timetable-interview')
    .evaluateAll((cards) =>
      cards
        .filter((card) => card.scrollHeight > card.clientHeight + 1)
        .map((card) => card.textContent)
    )
  expect(clippedCards).toEqual([])
  const originalBounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(940, 740))
    const viewport = page.getByLabel('Interview timetable', { exact: true })
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeGreaterThan(200)
    await viewport.evaluate((el) => {
      el.scrollTop = 220
      el.scrollLeft = 300
    })
    await expect
      .poll(() =>
        viewport.evaluate((el) => {
          const viewportBounds = el.getBoundingClientRect()
          const employerBounds = el.querySelector('.timetable-employer')!.getBoundingClientRect()
          const timeBounds = el.querySelector('.time-label')!.getBoundingClientRect()
          return Math.max(
            Math.abs(employerBounds.top - viewportBounds.top),
            Math.abs(timeBounds.left - viewportBounds.left)
          )
        })
      )
      .toBeLessThan(2)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await viewport.evaluate((el) => {
      el.scrollTop = 0
      el.scrollLeft = 0
    })
    await page.getByRole('button', { name: 'Edit interview settings for Mike’s Anchors' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save employer settings' })).toBeInViewport()
    const save = page.getByRole('button', { name: 'Save employer settings' })
    const close = page.getByRole('button', { name: 'Close dialog' })
    await save.press('Tab')
    await expect(close).toBeFocused()
    await close.press('Shift+Tab')
    await expect(save).toBeFocused()
    await save.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Edit interview settings for Mike’s Anchors' })
    ).toBeFocused()
  } finally {
    await app.evaluate(
      ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds),
      originalBounds
    )
  }
})

test('keeps current data and shows a repair instruction when import fails', async () => {
  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  const path = join(scratch, 'broken.xlsx')
  await writeFile(path, 'This is not a valid Excel workbook')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] })
  }, path)
  await page.getByRole('button', { name: 'Import sheet', exact: true }).click()
  await page.getByRole('button', { name: 'Choose workbook' }).click()
  await expect(page.getByRole('alert')).toContainText('The sheet could not be imported')
  await expect(page.getByRole('alert')).toContainText('Reason:')
  await expect(page.getByRole('alert')).toContainText('How to fix it:')
  await expect(page.getByRole('heading', { name: 'Leonard Williams' })).toBeVisible()
})

test('shows destination errors when export fails and preserves current data', async () => {
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
    },
    join(scratch, 'missing-folder', 'export.xlsx')
  )
  await page.getByRole('button', { name: 'Export sheet', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The sheet could not be exported')
  await expect(page.getByRole('alert')).toContainText('missing-folder')
  await expect(page.getByRole('alert')).toContainText('How to fix it:')
  await expect(page.getByRole('heading', { name: 'Leonard Williams' })).toBeVisible()
})
