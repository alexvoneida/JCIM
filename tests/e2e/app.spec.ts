import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { createTracker } from './workbook-fixture'
import { validateXlsxPackage } from '../../src/main/xlsx-package'
import { version } from '../../package.json'

// Set JCIM_EXECUTABLE to test a packaged or installed build; otherwise the
// compiled app in out/ is launched with the local Electron.
const executablePath = process.env['JCIM_EXECUTABLE']

// These steps share one workspace and build on the prior import/export flow.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let scratch: string

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false
  )

// Drag and drop through the page's HTML5 handlers, as Playwright documents for drag and drop.
// A real mouse drag is fragile here: scrolling while the mouse is down shifts the grid under
// the pointer and Chromium then drags a different chip.
async function drag(source: Locator, target: Locator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await source.dispatchEvent('dragstart', { dataTransfer })
  await target.dispatchEvent('dragover', { dataTransfer })
  await target.dispatchEvent('drop', { dataTransfer })
}

test.beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'jcim-e2e-'))
  // Older versions left a copy of every imported tracker here. Startup must clean it up.
  await mkdir(join(scratch, 'imported-workbooks'))
  await writeFile(join(scratch, 'imported-workbooks', 'old-copy.xlsx'), 'stale tracker copy')
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
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No students yet' })).toBeVisible()
  await expect(page.getByText(/student workbook/i)).toHaveCount(0)
})

test('removes the tracker copies that older versions saved in user data', async () => {
  await expect.poll(() => exists(join(scratch, 'imported-workbooks'))).toBe(false)
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
  await page.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Leonard Williams' })).toBeVisible()
  await page.getByRole('button', { name: 'Interview Schedule', exact: true }).click()
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).first().click()
  // Every student gets three interviews in Wave 1, best keyword matches first.
  const wave1 = page.locator('tbody[data-wave="Wave 1"]')
  const wave2 = page.locator('tbody[data-wave="Wave 2"]')
  const cell = (wave: Locator, employer: string, round: number) =>
    wave.locator(`td[data-employer="${employer}"][data-round="${round}"]`)
  const chip = (wave: Locator, employer: string, round: number, student: string) =>
    cell(wave, employer, round).locator(`.student-chip[data-student="${student}"]`)
  const chipsOf = (wave: Locator, student: string) =>
    wave.locator(`.student-chip[data-student="${student}"]`)
  const atEmployer = (wave: Locator, employer: string, student: string) =>
    wave.locator(`td[data-employer="${employer}"] .student-chip[data-student="${student}"]`)
  await expect(wave1.locator('.student-chip')).toHaveCount(27)
  // At a smaller window the page needs scrolling while the grid fits its own box. A wheel over
  // the grid must still scroll the page; the grid used to swallow it. The pointer is placed by
  // coordinates because hover() would scroll the page itself.
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(940, 740))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
    .toBeGreaterThan(100)
  await page.evaluate(() => window.scrollTo(0, 0))
  const gridBox = (await page.getByLabel('Interview schedule', { exact: true }).boundingBox())!
  await page.mouse.move(gridBox.x + gridBox.width / 2, gridBox.y + 60)
  await page.mouse.wheel(0, 300)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await app.evaluate(
    ({ BrowserWindow }, saved) => BrowserWindow.getAllWindows()[0].setBounds(saved),
    bounds
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(chipsOf(wave1, 'Leonard Williams')).toHaveCount(3)
  await expect(atEmployer(wave1, 'Mike’s Anchors', 'Leonard Williams')).toHaveCount(1)
  await expect(atEmployer(wave1, 'Red Rocks Software', 'Maya Patel')).toHaveCount(1)
  await expect(atEmployer(wave1, 'Summit Credit Union', 'Maya Patel')).toHaveCount(1)
  await expect(atEmployer(wave1, 'Frontier Aero', 'Sofia Martinez')).toHaveCount(1)
  await page.getByRole('button', { name: 'Edit interview settings for Mike’s Anchors' }).click()
  await page.getByLabel('Students per round', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Save employer settings' }).click()
  await expect(page.getByText(/^\d+ scheduling issues?$/)).toBeVisible()
  // Golden High School belongs in a second wave; its student is noted until the schedule is redone.
  await page.getByRole('button', { name: 'New wave', exact: true }).click()
  await page.getByLabel('Wave name', { exact: true }).fill('Wave 2')
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: 'Golden High School', exact: true })
    .check()
  await page.getByRole('button', { name: 'Save wave', exact: true }).click()
  await expect(page.getByText('3 wave placement notes')).toBeVisible()
  await page.getByRole('button', { name: 'Generate schedule', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Replace schedule', exact: true })
    .click()
  await expect(page.getByText(/scheduling issue/)).toHaveCount(0)
  await expect(page.getByText(/wave placement note/)).toHaveCount(0)
  await expect(chipsOf(wave2, 'Devon Witherspoon')).toHaveCount(3)
  await expect(wave1.locator('.student-chip')).toHaveCount(24)
  await expect(cell(wave1, 'Mike’s Anchors', 1).locator('.student-chip')).toHaveCount(1)
  // Chips are colored by school, so students from different schools get different fills.
  const fills = await wave1
    .locator('.student-chip')
    .evaluateAll((chips) =>
      chips.map((c) => [(c as HTMLElement).dataset.student, getComputedStyle(c).backgroundColor])
    )
  const fillOf = (student: string) => fills.find(([name]) => name === student)![1]
  expect(fillOf('Leonard Williams')).not.toBe(fillOf('Ernest Jones'))
  expect(fillOf('Leonard Williams')).not.toBe('rgba(0, 0, 0, 0)')
  await page.getByLabel('Interview date', { exact: true }).fill('2026-10-15')
  await page.getByRole('button', { name: 'Approve schedule', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Schedule approved' })).toBeDisabled()
  // Nothing can be dragged until Edit schedule is on.
  await expect(wave1.locator('.student-chip').first()).toHaveAttribute('draggable', 'false')
  await page.getByRole('button', { name: 'Edit interview settings for Mike’s Anchors' }).click()
  await page.getByLabel('Students per round', { exact: true }).fill('3')
  await page.getByRole('button', { name: 'Save employer settings' }).click()
  await page.getByRole('button', { name: 'Edit schedule', exact: true }).click()
  const mover = cell(wave1, 'Mike’s Anchors', 1).locator('.student-chip').first()
  const moverName = (await mover.getAttribute('data-student'))!
  // Every student already interviews in each round, so another round is refused.
  await drag(mover, cell(wave1, 'Mike’s Anchors', 3))
  await expect(page.getByText(`${moverName} is booked twice in Wave 1 round 3`)).toBeVisible()
  await expect(chip(wave1, 'Mike’s Anchors', 1, moverName)).toHaveCount(1)
  // Changing employer within the round works once that employer has room.
  await page.getByRole('button', { name: 'Edit interview settings for Frontier Aero' }).click()
  await page.getByLabel('Students per round', { exact: true }).fill('4')
  await page.getByRole('button', { name: 'Save employer settings' }).click()
  await drag(chip(wave1, 'Mike’s Anchors', 1, moverName), cell(wave1, 'Frontier Aero', 1))
  await expect(chip(wave1, 'Frontier Aero', 1, moverName)).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Approve schedule' })).toBeEnabled()
  // A student may be moved out of their school's wave; the move is noted, not blocked. The
  // waves are too far apart for one drag, so the dialog does it.
  await page
    .getByRole('button', { name: /^Edit interview for Devon Witherspoon at .*, Wave 2 round 1$/ })
    .click()
  await page.getByLabel('Employer', { exact: true }).selectOption('Mike’s Anchors')
  await page.getByLabel('Wave', { exact: true }).selectOption('Wave 1')
  await page.getByLabel('Round', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Save interview', exact: true }).click()
  await expect(chip(wave1, 'Mike’s Anchors', 1, 'Devon Witherspoon')).toHaveCount(1)
  await expect(page.getByText('1 wave placement note')).toBeVisible()
  // The dialog moves an interview too.
  await page
    .getByRole('button', {
      name: `Edit interview for ${moverName} at Frontier Aero, Wave 1 round 1`
    })
    .click()
  await page.getByLabel('Employer', { exact: true }).selectOption('Mike’s Anchors')
  await page.getByRole('button', { name: 'Save interview', exact: true }).click()
  await expect(chip(wave1, 'Mike’s Anchors', 1, moverName)).toHaveCount(1)
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  await page.getByRole('button', { name: 'Approve schedule', exact: true }).click()
  // Waves, limits, and manual moves must survive real IPC export and re-import.
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
  }, scheduleExport)
  await page.getByRole('button', { name: 'Export workbook', exact: true }).click()
  await expect.poll(() => exists(scheduleExport)).toBe(true)
  expect(await validateXlsxPackage(await readFile(scheduleExport))).toEqual([])
  const scheduleWorkbook = new ExcelJS.Workbook()
  await scheduleWorkbook.xlsx.readFile(scheduleExport)
  const mike = scheduleWorkbook
    .getWorksheet('JCIM Employers')!
    .getRows(2, 4)!
    .find((r) => r.getCell(1).text === 'Mike’s Anchors')!
  expect(mike.getCell(5).value).toBe(3)
  const moverRow = scheduleWorkbook
    .getWorksheet('JCIM Schedule')!
    .getRows(2, 40)!
    .find((r) => r.getCell(2).text === moverName && r.getCell(3).text === 'Mike’s Anchors')!
  expect(moverRow.getCell(4).text).toBe('Wave 1')
  expect(moverRow.getCell(5).value).toBe(1)
  const waveRow = scheduleWorkbook
    .getWorksheet('JCIM Waves')!
    .getRows(2, 2)!
    .find((r) => r.getCell(1).text === 'Wave 2')!
  expect(waveRow.getCell(3).text).toBe('Golden High School')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] })
  }, scheduleExport)
  await page.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await page.getByRole('button', { name: 'Choose workbook', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Interview Schedule', exact: true }).click()
  await expect(chip(wave1, 'Mike’s Anchors', 1, moverName)).toHaveCount(1)
  await expect(page.getByText('1 wave placement note')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Schedule approved' })).toBeDisabled()
  await page.getByRole('button', { name: 'Matching', exact: true }).click()
  await page.getByRole('button', { name: 'Generate matching', exact: true }).click()
  await expect(page.locator('.feedback-card.selected')).toHaveCount(9)
  await page.getByRole('button', { name: 'Approve matching', exact: true }).click()
  await page.getByRole('button', { name: 'Employers', exact: true }).click()
  await page.getByRole('switch', { name: 'Participation for Frontier Aero' }).click()
  await expect(
    page.getByRole('switch', { name: 'Participation for Frontier Aero' })
  ).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'Interview Schedule', exact: true }).click()
  await expect(chip(wave1, 'Mike’s Anchors', 1, moverName)).toHaveCount(1)
  await expect(page.locator('.wave-employer h2', { hasText: 'Frontier Aero' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Employers', exact: true }).click()
  await page.getByRole('button', { name: 'New employer', exact: true }).click()
  await page.getByLabel('Employer name', { exact: true }).fill('New Employer')
  await page.getByLabel('Industry', { exact: true }).selectOption('__other_industry__')
  await page.getByLabel('New industry name', { exact: true }).fill('Renewable energy')
  await page.getByLabel('Capacity', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Save employer' }).click()
  await expect(page.getByRole('heading', { name: 'New Employer' })).toBeVisible()
  await page.getByRole('button', { name: 'Students', exact: true }).click()
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
  await rm(source) // Export must not depend on the original file.
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
  }, destination)
  await page.getByRole('button', { name: 'Export workbook', exact: true }).click()
  await expect.poll(() => exists(destination)).toBe(true)
  expect(await validateXlsxPackage(await readFile(destination))).toEqual([])
  const exported = new ExcelJS.Workbook()
  await exported.xlsx.readFile(destination)
  expect(exported.getWorksheet('Read me')).toBeDefined()
  expect(exported.getWorksheet('Student Good Fit')).toBeUndefined()
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
  await page.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await page.getByRole('button', { name: 'Choose workbook' }).click()
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()
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

test('keeps student chips readable and pins employer headers and round labels while scrolling at smaller window sizes', async () => {
  await page.getByRole('button', { name: 'Interview Schedule', exact: true }).click()
  const clippedChips = await page
    .locator('.student-chip')
    .evaluateAll((chips) =>
      chips
        .filter((chip) => chip.scrollHeight > chip.clientHeight + 1)
        .map((chip) => chip.textContent)
    )
  expect(clippedChips).toEqual([])
  const originalBounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(940, 740))
    const viewport = page.getByLabel('Interview schedule', { exact: true })
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeGreaterThan(100)
    await viewport.evaluate((el) => {
      el.scrollTop = 220
      el.scrollLeft = 300
    })
    await expect
      .poll(() =>
        viewport.evaluate((el) => {
          const viewportBounds = el.getBoundingClientRect()
          const employerBounds = el.querySelector('.wave-employer')!.getBoundingClientRect()
          const roundBounds = el.querySelector('.round-label')!.getBoundingClientRect()
          return Math.max(
            Math.abs(employerBounds.top - viewportBounds.top),
            Math.abs(roundBounds.left - viewportBounds.left)
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
    await page.evaluate(() => window.scrollTo(0, 0))
  }
})

test('keeps current data and shows a repair instruction when import fails', async () => {
  await page.getByRole('button', { name: 'Students', exact: true }).click()
  const path = join(scratch, 'broken.xlsx')
  await writeFile(path, 'This is not a valid Excel workbook')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] })
  }, path)
  await page.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await page.getByRole('button', { name: 'Choose workbook' }).click()
  await expect(page.getByRole('alert')).toContainText('Import failed')
  await expect(page.getByRole('alert')).toContainText('Reason:')
  await expect(page.getByRole('alert')).toContainText('Open the file in Excel')
  await expect(page.getByRole('heading', { name: 'Leonard Williams' })).toBeVisible()
})

test('shows destination errors when export fails and preserves current data', async () => {
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
    },
    join(scratch, 'missing-folder', 'export.xlsx')
  )
  await page.getByRole('button', { name: 'Export workbook', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Export failed')
  await expect(page.getByRole('alert')).toContainText('missing-folder')
  await expect(page.getByRole('alert')).toContainText('destination folder')
  await expect(page.getByRole('heading', { name: 'Leonard Williams' })).toBeVisible()
})

test('adds a student by hand, exports them, and removes a student', async () => {
  await page.getByRole('button', { name: 'Students', exact: true }).click()
  await page.getByRole('button', { name: 'New student', exact: true }).click()
  await page.getByLabel('Student name', { exact: true }).fill('Priya Natarajan')
  await page.getByLabel('School (optional)', { exact: true }).fill('Golden High School')
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Software', exact: true }).check()
  await page.getByRole('button', { name: 'Save student', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Priya Natarajan' })).toBeVisible()
  const studentExport = join(scratch, 'students-export.xlsx')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
  }, studentExport)
  await page.getByRole('button', { name: 'Export workbook', exact: true }).click()
  await expect.poll(() => exists(studentExport)).toBe(true)
  expect(await validateXlsxPackage(await readFile(studentExport))).toEqual([])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(studentExport)
  const row = workbook
    .getWorksheet('JCIM Students')!
    .getRows(2, 20)!
    .find((r) => r.getCell(1).text === 'Priya Natarajan')!
  expect(row.getCell(2).text).toBe('Golden High School')
  expect(row.getCell(4).text).toBe('Software')
  await page.getByRole('heading', { name: 'Priya Natarajan' }).click()
  await page.getByRole('button', { name: 'Remove student', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Remove Priya Natarajan?' })
    .getByRole('button', { name: 'Remove student', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Priya Natarajan' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Leonard Williams' })).toBeVisible()
})

test('clears the workspace after confirmation and starts empty on the next launch', async () => {
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Clear workspace', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'No students yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export workbook', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'No students yet' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('jcim-workspace-v1'))).toBeNull()
})
