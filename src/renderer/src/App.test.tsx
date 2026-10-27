import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { emptyWorkspace, type Workspace } from '../../shared/workspace'
import { Student } from '../../shared/student'
import { InterviewResult } from '../../shared/interviewResult'

function fixture() {
  const data = emptyWorkspace()
  const student = Object.assign(new Student(), {
    name: 'Alice',
    school: 'Lakewood High',
    interests: ['Engineering']
  })
  const interview = new InterviewResult('Alice', '1', 'Aero', 'Engineer', 'Yes', 'Yes', 'Yes', '5')
  interview.employerAccept = true
  student.interviewResults.push(interview)
  data.students.Alice = student
  data.employers = [{ name: 'Aero', industry: 'Aerospace', capacity: 1, active: true }]
  data.sourceName = 'tracker.xlsx'
  return data
}

beforeEach(() => {
  localStorage.clear()
  window.api = {
    versions: { electron: '1.0.0' },
    getAppVersion: vi.fn().mockResolvedValue('9.9.9'),
    parseSheet: vi
      .fn()
      .mockResolvedValue({ status: 'success', data: fixture(), warnings: ['Review capacity'] }),
    exportSheet: vi.fn().mockResolvedValue({
      status: 'success',
      data: { path: '/Documents/JCIM.xlsx' },
      warnings: []
    })
  }
})
// Picks a placement option by its visible label, like a coordinator would.
function choosePlacement(student: string, label: string) {
  const select = screen.getByLabelText(`Placement for ${student}`)
  const option = within(select).getByRole<HTMLOptionElement>('option', { name: label })
  fireEvent.change(select, { target: { value: option.value } })
}

async function importData() {
  fireEvent.click(screen.getByRole('button', { name: 'Import workbook' }))
  await screen.findByRole('heading', { name: 'Alice' })
}

function savedWorkspace(): Workspace {
  return JSON.parse(localStorage.getItem('jcim-workspace-v1')!) as Workspace
}

it('shows the redesigned flow and explicit sheet actions', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Students' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No students yet' })).toBeInTheDocument()
  expect(screen.queryByText(/student workbook/i)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export workbook' })).toBeDisabled()
  const nav = screen.getByRole('navigation', { name: 'Workspace pages' })
  for (const name of ['Students', 'Interview Schedule', 'Matching', 'Employers'])
    expect(within(nav).getByRole('button', { name })).toBeInTheDocument()
})
it('imports real workspace data, shows import notes, and exports the complete workspace', async () => {
  render(<App />)
  await importData()
  expect(screen.getByText('Lakewood High')).toBeInTheDocument()
  expect(screen.getByText('Review capacity')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }))
  await waitFor(() => expect(window.api.exportSheet).toHaveBeenCalled())
  const exported = vi.mocked(window.api.exportSheet).mock.calls[0][0]
  expect(exported.employers).toEqual(fixture().employers)
  expect(exported.students.Alice.name).toBe('Alice')
})
it('turns employers off, preserves feedback and export rows, and restores the status after reopening', async () => {
  const app = render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  expect(screen.getByText('Matched')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Employers' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Participation for Aero' }))
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }))
  await waitFor(() => expect(window.api.exportSheet).toHaveBeenCalled())
  const exported = vi.mocked(window.api.exportSheet).mock.calls[0][0]
  expect(exported.employers).toEqual([{ ...fixture().employers[0], active: false }])
  expect(exported.placements).toEqual([])
  expect(exported.students.Alice.interviewResults[0].business).toBe('Aero')
  app.unmount()
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Employers' }))
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
})
it('requires a schedule date before approval and invalidates approval on edits', async () => {
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Interview Schedule' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Generate schedule' })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Approve schedule' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Choose an interview date first')
  fireEvent.change(screen.getByLabelText('Interview date'), { target: { value: '2026-10-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Approve schedule' }))
  expect(screen.getByRole('button', { name: 'Schedule approved' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Interview date'), { target: { value: '2026-10-16' } })
  expect(screen.getByRole('button', { name: 'Approve schedule' })).toBeEnabled()
})
it('edits overall and employer settings, aligns simultaneous students, and persists interview overrides', async () => {
  const data = fixture()
  data.students.Bob = Object.assign(new Student(), { name: 'Bob' })
  data.students.Bob.interviewResults.push(
    new InterviewResult('Bob', '1', 'Aero', '', '', '', '', '0')
  )
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'success', data, warnings: [] })
  const app = render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Interview Schedule' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit schedule window and interview length' }))
  fireEvent.change(screen.getByLabelText('Schedule end time'), { target: { value: '12:00' } })
  fireEvent.change(screen.getByLabelText('Default interview length (minutes)'), {
    target: { value: '20' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit interview settings for Aero' }))
  fireEvent.change(screen.getByLabelText('Employer start time'), { target: { value: '09:15' } })
  fireEvent.change(screen.getByLabelText('Employer end time'), { target: { value: '11:00' } })
  fireEvent.change(screen.getByLabelText('Employer interview length (minutes)'), {
    target: { value: '15' }
  })
  fireEvent.change(screen.getByLabelText(/Students at once/), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer settings' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Generate schedule' })[0])
  const cards = app.container.querySelectorAll<HTMLElement>('.timetable-interview')
  expect(cards).toHaveLength(2)
  expect(cards[0].dataset.start).toBe('09:15')
  expect(cards[1].dataset.start).toBe('09:15')
  expect(cards[0].style.gridRow).toBe(cards[1].style.gridRow)
  expect(cards[0].style.marginLeft).not.toBe(cards[1].style.marginLeft)
  fireEvent.change(screen.getByLabelText('Interview date'), { target: { value: '2026-10-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Approve schedule' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit schedule' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit interview for Bob at Aero, round 1' }))
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } })
  fireEvent.change(screen.getByLabelText(/Interview length override/), { target: { value: '10' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save interview' }))
  expect(screen.getByRole('button', { name: 'Approve schedule' })).toBeEnabled()
  expect(screen.getByText('10 min · override')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }))
  await waitFor(() => expect(window.api.exportSheet).toHaveBeenCalled())
  const saved = vi.mocked(window.api.exportSheet).mock.calls[0][0]
  expect(saved.scheduleSettings).toEqual({ start: '09:00', end: '12:00', durationMinutes: 20 })
  expect(saved.employers[0].scheduling).toEqual({
    start: '09:15',
    end: '11:00',
    durationMinutes: 15,
    parallelInterviews: 2
  })
  expect(saved.schedule.find((i) => i.student === 'Bob')).toMatchObject({
    time: '10:00',
    durationMinutes: 10
  })
  app.unmount()
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Interview Schedule' }))
  expect(screen.getByText('10 min · override')).toBeInTheDocument()
})

it('keeps existing interviews when settings change, blocks conflicting approval, and confirms regeneration', async () => {
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Interview Schedule' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Generate schedule' })[0])
  fireEvent.change(screen.getByLabelText('Interview date'), { target: { value: '2026-10-15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Edit schedule window and interview length' }))
  fireEvent.change(screen.getByLabelText('Schedule start time'), { target: { value: '10:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule settings' }))
  expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
  expect(screen.getByText(/^\d+ scheduling issues?$/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Approve schedule' }))
  expect(
    screen.getAllByRole('alert').some((a) => a.textContent?.includes('outside this employer'))
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Generate schedule' }))
  const modal = screen.getByRole('dialog', { name: 'Replace the current schedule?' })
  fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText(/^\d+ scheduling issues?$/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Generate schedule' }))
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Replace schedule' })
  )
  expect(screen.queryByText(/^\d+ scheduling issues?$/)).not.toBeInTheDocument()
})

it('explains invalid schedule settings and keeps the editor open for correction', async () => {
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Interview Schedule' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit schedule window and interview length' }))
  fireEvent.change(screen.getByLabelText('Schedule end time'), { target: { value: '08:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule settings' }))
  expect(screen.getByRole('alert')).toHaveTextContent('end must be later than the start')
  fireEvent.change(screen.getByLabelText('Schedule end time'), { target: { value: '10:00' } })
  fireEvent.change(screen.getByLabelText('Default interview length (minutes)'), {
    target: { value: '0' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule settings' }))
  expect(screen.getByRole('alert')).toHaveTextContent('whole number from 1 to 1440 minutes')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit interview settings for Aero' }))
  fireEvent.change(screen.getByLabelText('Employer start time'), { target: { value: '08:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer settings' }))
  expect(screen.getByRole('alert')).toHaveTextContent('outside the overall schedule window')
  fireEvent.change(screen.getByLabelText('Employer start time'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('Students at once'), { target: { value: '1.5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer settings' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Students at once must be a whole number')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('adds interviews from time slots, rejects student overlaps, and removes only the chosen interview', async () => {
  const data = fixture()
  data.employers.push({ name: 'Software', industry: 'Software', active: true, capacity: 1 })
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'success', data, warnings: [] })
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Interview Schedule' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Generate schedule' })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Edit schedule' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add interview at 9:00 AM with Software' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save interview' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Alice is booked twice')
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:30' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save interview' }))
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit interview for Alice at Software, round 1' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Remove from schedule' }))
  expect(
    screen.queryByRole('button', { name: 'Edit interview for Alice at Software, round 1' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Edit interview for Alice at Aero, round 1' })
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }))
  await waitFor(() => expect(window.api.exportSheet).toHaveBeenCalled())
  const saved = vi.mocked(window.api.exportSheet).mock.calls[0][0]
  expect(saved.schedule).toHaveLength(1)
  expect(saved.students.Alice.interviewResults.map((i) => i.business)).toEqual(['Aero', 'Software'])
})
it('reports understandable import/export errors and keeps the existing workspace', async () => {
  render(<App />)
  await importData()
  vi.mocked(window.api.parseSheet).mockResolvedValue({
    status: 'error',
    error: {
      title: 'Import failed',
      detail: 'Student Good Fit, G4: rating is 9.',
      fix: 'Enter a whole number from 1 to 5.'
    }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Import workbook' }))
  fireEvent.click(screen.getByRole('button', { name: 'Choose workbook' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('G4')
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 5')
  expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
  vi.mocked(window.api.exportSheet).mockRejectedValue(new Error('File locked'))
  fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('File locked'))
  expect(screen.getByRole('alert')).toHaveTextContent('Close the file in Excel')
})
it('treats cancellation as a normal outcome', async () => {
  render(<App />)
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'cancelled' })
  fireEvent.click(screen.getByRole('button', { name: 'Import workbook' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import workbook' })).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('validates new employers and prevents duplicate names', async () => {
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Employers' }))
  fireEvent.click(screen.getByRole('button', { name: 'New employer' }))
  fireEvent.change(screen.getByLabelText('Employer name'), { target: { value: 'aero' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer' }))
  expect(screen.getByRole('alert')).toHaveTextContent('already exists')
  fireEvent.change(screen.getByLabelText('Employer name'), { target: { value: 'New Company' } })
  fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer' }))
  expect(screen.getByRole('alert')).toHaveTextContent('whole number of 0 or more')
  fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'New Company' })).toBeInTheDocument()
})

it('shows storage failures without hiding them behind a success message', async () => {
  render(<App />)
  await importData()
  const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage is full')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Storage is full')
  expect(screen.getByRole('alert')).toHaveTextContent('Export a workbook before closing')
  save.mockRestore()
})
it('recovers from a damaged saved workspace with a useful error', () => {
  localStorage.setItem(
    'jcim-workspace-v1',
    JSON.stringify({ ...emptyWorkspace(), employers: [null] })
  )
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Students' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Saved data could not be opened')
  expect(screen.getByRole('alert')).toHaveTextContent('Import your latest exported workbook')
})

it('uses one industry bank for employer choices, student choices, and custom industries', async () => {
  const app = render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Employers' }))
  fireEvent.click(screen.getByRole('button', { name: 'New employer' }))
  const employerIndustry = screen.getByLabelText('Industry')
  expect(within(employerIndustry).getByRole('option', { name: 'Engineering' })).toBeInTheDocument()
  expect(within(employerIndustry).getByRole('option', { name: 'Aerospace' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Employer name'), { target: { value: 'New Company' } })
  fireEvent.change(employerIndustry, { target: { value: '__other_industry__' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a new industry name')
  fireEvent.change(screen.getByLabelText('New industry name'), {
    target: { value: ' Renewable   energy ' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Students' }))
  fireEvent.click(screen.getByRole('heading', { name: 'Alice' }))
  const studentModal = screen.getByRole('dialog', { name: 'Alice' })
  expect(within(studentModal).getByRole('checkbox', { name: 'Engineering' })).toBeChecked()
  fireEvent.click(within(studentModal).getByRole('checkbox', { name: 'Renewable energy' }))
  fireEvent.click(within(studentModal).getByRole('checkbox', { name: 'Other — add an industry' }))
  fireEvent.change(within(studentModal).getByLabelText('New industry name'), {
    target: { value: 'Architecture' }
  })
  fireEvent.click(within(studentModal).getByRole('button', { name: 'Save industries' }))
  fireEvent.click(within(studentModal).getByRole('button', { name: 'Done' }))
  expect(screen.getByText('Architecture', { selector: '.tag' })).toBeInTheDocument()
  app.unmount()
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Employers' }))
  fireEvent.click(screen.getByRole('button', { name: 'New employer' }))
  expect(
    within(screen.getByLabelText('Industry')).getByRole('option', { name: 'Architecture' })
  ).toBeInTheDocument()
  expect(
    within(screen.getByLabelText('Industry')).getByRole('option', { name: 'Renewable energy' })
  ).toBeInTheDocument()
})

it('filters students by name, school, and shared industries without changing the workspace', async () => {
  const data = fixture()
  data.students.Bob = Object.assign(new Student(), {
    name: 'Bob',
    school: 'Golden High',
    interests: ['Finance']
  })
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'success', data, warnings: [] })
  render(<App />)
  await importData()
  fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'golden' } })
  expect(screen.getByRole('heading', { name: 'Bob' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Alice' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Search students'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('Filter interests'), { target: { value: 'Engineering' } })
  expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Bob' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'missing' } })
  expect(screen.getByRole('heading', { name: 'No students found' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'ALICE' } })
  expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
})

it('invalidates matches when feedback changes and enforces internship capacity for manual assignments', async () => {
  const data = fixture()
  data.students.Bob = Object.assign(new Student(), { name: 'Bob' })
  const bobInterview = new InterviewResult('Bob', '1', 'Aero', '', '', '', 'Yes', '4')
  bobInterview.employerAccept = true
  data.students.Bob.interviewResults.push(bobInterview)
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'success', data, warnings: [] })
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve matching' }))
  expect(screen.getByRole('button', { name: 'Matching approved' })).toBeDisabled()
  fireEvent.click(screen.getByRole('tab', { name: 'View matched students (1 of 2)' }))
  expect(screen.getByText('Aero · 5/5 — Why matched?')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Edit matching' }))
  choosePlacement('Bob', 'Aero (4/5)')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Aero is full (Alice). Unassign one of them first'
  )
  expect(screen.getByLabelText('Placement for Bob')).toHaveValue('')
  fireEvent.click(screen.getByRole('tab', { name: /View employer approvals/ }))
  expect(screen.getByLabelText('Match Alice with Aero')).toBeChecked()
  fireEvent.click(screen.getByLabelText('Match Bob with Aero'))
  expect(screen.getByLabelText('Match Bob with Aero')).not.toBeChecked()
  expect(screen.getByRole('alert')).toHaveTextContent('Aero is full (Alice).')
  fireEvent.change(screen.getByLabelText('Employer response for Alice at Aero'), {
    target: { value: 'no' }
  })
  expect(screen.getByLabelText('Placement for Alice')).toHaveValue('')
  // A declined student stays listed, so the response can still be changed.
  expect(screen.getByLabelText('Employer response for Alice at Aero')).toHaveValue('no')
  expect(screen.getByText('Employer declined').closest('article')).toHaveClass('declined')
  expect(screen.getByRole('button', { name: 'Approve matching' })).toBeDisabled()
  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  choosePlacement('Bob', 'Aero (4/5)')
  expect(screen.getByLabelText('Placement for Bob')).toHaveDisplayValue('Aero (4/5)')
  expect(
    screen.getByText('Manually placed', { selector: '.assignment-info .manual-tag' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve matching' })).toBeEnabled()
})

it('keeps keyboard focus inside editors and returns focus to the control on Escape', async () => {
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Interview Schedule' }))
  const settingsButton = screen.getByRole('button', {
    name: 'Edit schedule window and interview length'
  })
  settingsButton.focus()
  fireEvent.click(settingsButton)
  const dialog = screen.getByRole('dialog')
  const first = within(dialog).getByRole('button', { name: 'Close dialog' })
  const last = within(dialog).getByRole('button', { name: 'Save schedule settings' })
  expect(screen.getByLabelText('Schedule start time')).toHaveFocus()
  last.focus()
  fireEvent.keyDown(dialog, { key: 'Tab' })
  expect(first).toHaveFocus()
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
  expect(last).toHaveFocus()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(settingsButton).toHaveFocus()
})

it('removes an industry from students, employers, filters, and the saved option list', async () => {
  const app = render(<App />)
  await importData()
  fireEvent.change(screen.getByLabelText('Filter interests'), { target: { value: 'Engineering' } })
  fireEvent.click(screen.getByRole('heading', { name: 'Alice' }))
  const studentModal = screen.getByRole('dialog', { name: 'Alice' })
  fireEvent.click(
    within(studentModal).getByRole('button', { name: 'Remove Aerospace from all industries' })
  )
  const cancelled = screen.getByRole('dialog', { name: 'Remove “Aerospace”?' })
  expect(cancelled).toHaveTextContent('0 students and 1 employer')
  fireEvent.click(within(cancelled).getByRole('button', { name: 'Cancel' }))
  expect(within(studentModal).getByRole('checkbox', { name: 'Aerospace' })).toBeInTheDocument()
  for (const industry of ['Engineering', 'Aerospace']) {
    fireEvent.click(
      within(studentModal).getByRole('button', { name: `Remove ${industry} from all industries` })
    )
    fireEvent.click(
      within(screen.getByRole('dialog', { name: `Remove “${industry}”?` })).getByRole('button', {
        name: 'Remove industry'
      })
    )
    expect(within(studentModal).queryByRole('checkbox', { name: industry })).not.toBeInTheDocument()
  }
  fireEvent.click(within(studentModal).getByRole('button', { name: 'Done' }))
  expect(screen.getByLabelText('Filter interests')).toHaveValue('')
  expect(screen.getByText('No interests listed')).toBeInTheDocument()
  app.unmount()
  render(<App />)
  expect(
    within(screen.getByLabelText('Filter interests'))
      .queryAllByRole('option')
      .map((o) => o.textContent)
  ).toEqual(['All interests'])
  fireEvent.click(screen.getByRole('button', { name: 'Employers' }))
  expect(screen.queryByText('Aerospace')).not.toBeInTheDocument()
})

it('shows a matching column for each role with the approved students who fit it', async () => {
  const data = fixture()
  data.employers[0] = {
    ...data.employers[0],
    capacity: 2,
    roles: [
      { title: 'Engineering', capacity: 1 },
      { title: 'HR', capacity: 1, tags: ['Human Resources'] }
    ]
  }
  for (const [name, interests] of [
    ['Bob', ['Human Resources']],
    ['Cara', ['Art']]
  ] as const) {
    data.students[name] = Object.assign(new Student(), { name, interests: [...interests] })
    const interview = new InterviewResult(name, '1', 'Aero', '', '', '', 'Yes', '4')
    interview.employerAccept = true
    data.students[name].interviewResults.push(interview)
  }
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'success', data, warnings: [] })
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  const column = (text: string) =>
    screen.getByText(text, { selector: '.company-heading p' }).closest('section')!
  const names = (section: HTMLElement) =>
    within(section)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
  expect(names(column('Engineering'))).toEqual(['Alice'])
  expect(names(column('HR'))).toEqual(['Bob'])
  expect(names(column('Interests match no role'))).toEqual(['Cara'])
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  expect(within(column('Engineering')).getByText('1 of 1 filled')).toBeInTheDocument()
  expect(within(column('HR')).getByText('1 of 1 filled')).toBeInTheDocument()
})

it('lists pending students so the employer response can be set', async () => {
  const data = fixture()
  data.students.Alice.interviewResults[0].employerAccept = undefined
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'success', data, warnings: [] })
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  const card = screen.getByText('Feedback pending').closest('article')!
  expect(card).toHaveClass('pending')
  fireEvent.click(screen.getByRole('button', { name: 'Edit matching' }))
  fireEvent.change(screen.getByLabelText('Employer response for Alice at Aero'), {
    target: { value: 'yes' }
  })
  expect(screen.getByText('Employer approved').closest('article')).not.toHaveClass('pending')
})

it('clears placements when a placed student’s interests change', async () => {
  const data = fixture()
  data.employers[0] = { ...data.employers[0], roles: [{ title: 'Engineering', capacity: 1 }] }
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'success', data, warnings: [] })
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  expect(screen.getByText('1 of 1 filled')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Students' }))
  fireEvent.click(screen.getByRole('heading', { name: 'Alice' }))
  const studentModal = screen.getByRole('dialog', { name: 'Alice' })
  fireEvent.click(
    within(studentModal).getByRole('button', { name: 'Remove Engineering from all industries' })
  )
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Remove “Engineering”?' })).getByRole('button', {
      name: 'Remove industry'
    })
  )
  fireEvent.click(within(studentModal).getByRole('button', { name: 'Done' }))
  fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }))
  await waitFor(() => expect(window.api.exportSheet).toHaveBeenCalled())
  expect(vi.mocked(window.api.exportSheet).mock.calls[0][0].placements).toEqual([])
})

it('finds text on the page with Ctrl+F', async () => {
  vi.mocked(window.api.parseSheet).mockResolvedValue({
    status: 'success',
    data: fixture(),
    warnings: []
  })
  render(<App />)
  await importData()
  fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
  fireEvent.change(screen.getByLabelText('Find in page'), { target: { value: 'alice' } })
  expect(screen.getByText(/^1 of \d+$/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Find in page'), { target: { value: 'zzz' } })
  expect(screen.getByText('No matches')).toBeInTheDocument()
  fireEvent.keyDown(screen.getByLabelText('Find in page'), { key: 'Escape' })
  expect(screen.queryByLabelText('Find in page')).not.toBeInTheDocument()
})

it('tags manual placements and drops the tag when the generated placement is restored', async () => {
  vi.mocked(window.api.parseSheet).mockResolvedValue({
    status: 'success',
    data: fixture(),
    warnings: []
  })
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit matching' }))
  expect(screen.queryByText(/^Manually/)).not.toBeInTheDocument()
  choosePlacement('Alice', 'Unmatched')
  expect(screen.queryByText('Why unmatched?')).not.toBeInTheDocument()
  // One tag in the students view and one on the employer card where Generate placed Alice.
  expect(screen.getAllByText('Manually unmatched')).toHaveLength(2)
  choosePlacement('Alice', 'Aero (5/5)')
  expect(screen.queryByText(/^Manually/)).not.toBeInTheDocument()
  expect(screen.getByText(/Why matched\?/)).toBeInTheDocument()
})

it('explains why a low-rated student took the place a higher-rated student wanted', async () => {
  const data = fixture()
  data.employers.push({ name: 'Beta', industry: '', capacity: 1, active: true })
  const beta = new InterviewResult('Alice', '1', 'Beta', '', '', '', 'Yes', '4')
  beta.employerAccept = true
  data.students.Alice.interviewResults.push(beta)
  data.students.Dan = Object.assign(new Student(), { name: 'Dan' })
  const dan = new InterviewResult('Dan', '1', 'Aero', '', '', '', 'Yes', '1')
  dan.employerAccept = true
  data.students.Dan.interviewResults.push(dan)
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'success', data, warnings: [] })
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  // Explanations are only worked out once opened.
  const open = (summary: HTMLElement) => {
    const details = summary.closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
  }
  open(screen.getByText('Why not here?'))
  expect(
    screen.getByText('Placing Alice here would leave 1 other student without a placement.')
  ).toBeInTheDocument()
  const danCard = screen.getByRole('heading', { name: 'Dan' }).closest('article')!
  open(within(danCard).getByText('Why this placement?'))
  expect(within(danCard).getByText('This was Dan’s only possible placement.')).toBeInTheDocument()
})

it('shows generated, manual and approved changes in the edit history', async () => {
  vi.mocked(window.api.parseSheet).mockResolvedValue({
    status: 'success',
    data: fixture(),
    warnings: []
  })
  render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve matching' }))
  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit matching' }))
  choosePlacement('Alice', 'Unmatched')
  fireEvent.click(screen.getByRole('tab', { name: 'Edit history' }))
  const groups = screen.getAllByRole('heading', { level: 3 })
  expect(groups[0]).toHaveTextContent('Not approved yet1 change')
  expect(groups[1]).toHaveTextContent(/^Approved .*1 change$/)
  expect(screen.getByText('Manual placement: Alice')).toBeInTheDocument()
  expect(screen.getByText('− Aero · 5/5')).toBeInTheDocument()
  expect(screen.getByText('+ Unmatched')).toBeInTheDocument()
  expect(screen.getByText('Generated matching: 1 placed')).toBeInTheDocument()
})

// Aero has two one-place roles, Beta one general place and Zero none. Generate puts Alice in
// Design and Bob in Engineering. Cara, Dee and Eve each have a different reason they cannot go.
function edgeCases() {
  const data = emptyWorkspace()
  data.employers = [
    {
      name: 'Aero',
      industry: '',
      capacity: 0,
      active: true,
      roles: [
        { title: 'Engineering', capacity: 1 },
        { title: 'Design', capacity: 1 }
      ]
    },
    { name: 'Beta', industry: '', capacity: 1, active: true },
    { name: 'Zero', industry: '', capacity: 0, active: true }
  ]
  const interviews: [string, string[], [string, string, boolean | undefined, boolean?][]][] = [
    [
      'Alice',
      ['Engineering', 'Design'],
      [
        ['Aero', '5', true],
        ['Beta', '3', true]
      ]
    ],
    ['Bob', ['Engineering'], [['Aero', '4', true]]],
    [
      'Cara',
      [],
      [
        ['Aero', '2', true],
        ['Beta', '5', undefined],
        ['Zero', '4', true]
      ]
    ],
    ['Dee', [], [['Beta', '5', true, false]]],
    ['Eve', [], [['Beta', '', true]]]
  ]
  for (const [name, interests, results] of interviews) {
    const student = Object.assign(new Student(), { name, interests })
    for (const [business, rank, employerAccept, acceptance] of results) {
      const i = new InterviewResult(name, '1', business, '', '', '', '', rank)
      i.employerAccept = employerAccept
      i.acceptance = acceptance
      student.interviewResults.push(i)
    }
    data.students[name] = student
  }
  return data
}

async function editEdgeCases() {
  vi.mocked(window.api.parseSheet).mockResolvedValue({
    status: 'success',
    data: edgeCases(),
    warnings: []
  })
  const app = render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Import workbook' }))
  await screen.findByRole('heading', { name: 'Alice' })
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit matching' }))
  return app
}

it('changes nothing when a student is chosen for the place they already have', async () => {
  await editEdgeCases()
  expect(screen.getByLabelText('Match Alice with Aero (Design)')).toBeChecked()
  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  const select = screen.getByLabelText('Placement for Alice')
  expect(select).toHaveDisplayValue('Aero · Design (5/5)')
  choosePlacement('Alice', 'Aero · Design (5/5)')
  expect(select).toHaveDisplayValue('Aero · Design (5/5)')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText(/^Manually/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Matching approved' })).toBeDisabled()
  fireEvent.click(screen.getByRole('tab', { name: 'Edit history' }))
  expect(screen.queryByText(/^Manual placement/)).not.toBeInTheDocument()
})

it('moves a student in one action, freeing their old place and recording the move', async () => {
  await editEdgeCases()
  fireEvent.click(screen.getByLabelText('Match Alice with Beta'))
  expect(screen.getByLabelText('Match Alice with Beta')).toBeChecked()
  expect(screen.getByLabelText('Match Alice with Aero (Design)')).not.toBeChecked()
  expect(screen.getAllByText('0 of 1 filled')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Approve matching' })).toBeEnabled()
  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  expect(screen.getByLabelText('Placement for Alice')).toHaveDisplayValue('Beta (3/5)')
  fireEvent.click(screen.getByRole('tab', { name: 'Edit history' }))
  expect(screen.getByText('− Aero · Design · 5/5')).toBeInTheDocument()
  expect(screen.getByText('+ Beta · 3/5')).toBeInTheDocument()
})

it('moves a student between roles at the same employer only when the role has room', async () => {
  await editEdgeCases()
  fireEvent.click(screen.getByLabelText('Match Alice with Aero (Engineering)'))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Aero’s Engineering role is full (Bob). Unassign one of them first'
  )
  fireEvent.click(screen.getByLabelText('Match Bob with Aero (Engineering)'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Match Alice with Aero (Engineering)'))
  expect(screen.getByLabelText('Match Alice with Aero (Engineering)')).toBeChecked()
  expect(screen.getByLabelText('Match Alice with Aero (Design)')).not.toBeChecked()
  // The student-view dropdown lists each role, so it never picks one for the coordinator.
  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  choosePlacement('Alice', 'Aero · Design (5/5)')
  expect(screen.getByLabelText('Placement for Alice')).toHaveDisplayValue('Aero · Design (5/5)')
})

it('explains every reason a placement cannot be made, next to the box that was ticked', async () => {
  await editEdgeCases()
  const reasons: [string, string][] = [
    [
      'Match Cara with Beta',
      'Beta has not approved Cara yet. Set the employer response to Approved first.'
    ],
    ['Match Dee with Beta', 'Dee declined Beta.'],
    ['Match Eve with Beta', 'Eve has not rated Beta. Set a student rating first.'],
    ['Match Cara with Aero (no matching role)', 'Aero has no role that matches Cara’s interests.'],
    ['Match Cara with Zero', 'Zero has no places. Add places on the Employers page.']
  ]
  for (const [box, reason] of reasons) {
    fireEvent.click(screen.getByLabelText(box))
    expect(screen.getByLabelText(box)).not.toBeChecked()
    expect(screen.getByRole('alert')).toHaveTextContent(reason)
  }
})

it('asks before re-running replaces manual changes, and keeps them on cancel', async () => {
  await editEdgeCases()
  // No manual changes yet, so re-running needs no confirmation.
  fireEvent.click(screen.getByRole('button', { name: 'Re-run matching' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Match Bob with Aero (Engineering)'))
  fireEvent.click(screen.getByRole('button', { name: 'Re-run matching' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('1 student changed by hand')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByLabelText('Match Bob with Aero (Engineering)')).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Re-run matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Replace manual changes' }))
  expect(screen.getByLabelText('Match Bob with Aero (Engineering)')).toBeChecked()
  expect(screen.queryByText(/^Manually/)).not.toBeInTheDocument()
})

it('persists manual moves and unmatches across reopening and exports their history', async () => {
  const app = await editEdgeCases()
  const generated = savedWorkspace().autoPlacements
  fireEvent.click(screen.getByLabelText('Match Alice with Beta'))
  fireEvent.click(screen.getByLabelText('Match Bob with Aero (Engineering)'))
  const edited = savedWorkspace()
  expect(edited.placements).toEqual([{ student: 'Alice', company: 'Beta', role: null, rating: 3 }])
  expect(edited.autoPlacements).toEqual(generated)
  expect(edited.matchingApproved).toBe(false)
  expect(edited.history?.slice(-2)).toEqual([
    expect.objectContaining({
      kind: 'placement',
      summary: 'Manual placement: Alice',
      before: 'Aero · Design · 5/5',
      after: 'Beta · 3/5'
    }),
    expect.objectContaining({
      kind: 'placement',
      summary: 'Manual placement: Bob',
      before: 'Aero · Engineering · 4/5',
      after: 'Unmatched'
    })
  ])

  fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }))
  await waitFor(() => expect(window.api.exportSheet).toHaveBeenCalled())
  expect(vi.mocked(window.api.exportSheet).mock.calls[0][0]).toMatchObject({
    placements: edited.placements,
    autoPlacements: generated,
    history: edited.history,
    matchingApproved: false
  })

  // Reopening must retain both the edits and the generated baseline used for manual tags.
  app.unmount()
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Matching' }))
  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  const panel = screen
    .getByText('Alice', { selector: '.assignment-row > span' })
    .closest('section')!
  expect(within(panel).getByText('Manually placed')).toBeInTheDocument()
  expect(within(panel).getByText('Manually unmatched')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Edit matching' }))
  expect(screen.getByLabelText('Placement for Alice')).toHaveDisplayValue('Beta (3/5)')
  expect(screen.getByLabelText('Placement for Bob')).toHaveDisplayValue('Unmatched')
  fireEvent.click(screen.getByRole('button', { name: 'Re-run matching' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('2 students changed by hand')
})

it('preserves placements, approval and history when an attempted manual move is rejected', async () => {
  await editEdgeCases()
  const approved = savedWorkspace()
  fireEvent.click(screen.getByLabelText('Match Alice with Aero (Engineering)'))
  expect(screen.getByRole('alert')).toHaveTextContent('full (Bob)')
  expect(screen.getByLabelText('Match Alice with Aero (Design)')).toBeChecked()
  expect(screen.getByLabelText('Match Bob with Aero (Engineering)')).toBeChecked()
  expect(screen.getByRole('button', { name: 'Matching approved' })).toBeDisabled()
  expect(savedWorkspace()).toEqual(approved)

  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  choosePlacement('Alice', 'Aero · Engineering (5/5)')
  expect(screen.getByRole('alert')).toHaveTextContent('full (Bob)')
  expect(screen.getByLabelText('Placement for Alice')).toHaveDisplayValue('Aero · Design (5/5)')
  expect(savedWorkspace()).toEqual(approved)
})

it('reuses a place freed by a manual move without displacing students in other roles', async () => {
  await editEdgeCases()
  fireEvent.click(screen.getByLabelText('Match Alice with Beta'))
  fireEvent.click(screen.getByRole('tab', { name: /View matched students/ }))
  choosePlacement('Bob', 'Unmatched')
  choosePlacement('Alice', 'Aero · Engineering (5/5)')
  choosePlacement('Bob', 'Aero · Engineering (4/5)')
  expect(screen.getByRole('alert')).toHaveTextContent('full (Alice)')
  expect(screen.getByLabelText('Placement for Bob')).toHaveDisplayValue('Unmatched')
  expect(savedWorkspace().placements).toEqual([
    { student: 'Alice', company: 'Aero', role: 'Engineering', rating: 5 }
  ])
  choosePlacement('Alice', 'Aero · Design (5/5)')
  choosePlacement('Bob', 'Aero · Engineering (4/5)')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(savedWorkspace().placements).toEqual([
    { student: 'Alice', company: 'Aero', role: 'Design', rating: 5 },
    { student: 'Bob', company: 'Aero', role: 'Engineering', rating: 4 }
  ])
})

it('reruns without confirmation after all manual overrides are restored to generated assignments', async () => {
  await editEdgeCases()
  fireEvent.click(screen.getByLabelText('Match Alice with Beta'))
  fireEvent.click(screen.getByLabelText('Match Bob with Aero (Engineering)'))
  fireEvent.click(screen.getByLabelText('Match Alice with Aero (Design)'))
  fireEvent.click(screen.getByLabelText('Match Bob with Aero (Engineering)'))
  expect(screen.queryByText(/^Manually/)).not.toBeInTheDocument()
  // Restoring the assignments does not restore the coordinator's prior approval.
  expect(screen.getByRole('button', { name: 'Approve matching' })).toBeEnabled()
  expect(savedWorkspace().history?.filter((entry) => entry.kind === 'placement')).toHaveLength(4)
  fireEvent.click(screen.getByRole('button', { name: 'Re-run matching' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(savedWorkspace().placements).toEqual(savedWorkspace().autoPlacements)
})
