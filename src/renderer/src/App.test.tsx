import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { emptyWorkspace } from '../../shared/workspace'
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
async function importData() {
  fireEvent.click(screen.getByRole('button', { name: 'Import sheet' }))
  await screen.findByRole('heading', { name: 'Alice' })
}

it('shows the redesigned flow and explicit sheet actions', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Student Overview' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Start with your workbook' })).toBeInTheDocument()
  expect(screen.queryByText(/student workbook/i)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Export sheet' })).toBeDisabled()
  const nav = screen.getByRole('navigation', { name: 'Workspace pages' })
  for (const name of ['Overview', 'Interview Schedule', 'Final Matching', 'Employers'])
    expect(within(nav).getByRole('button', { name })).toBeInTheDocument()
})
it('imports real workspace data, shows import notes, and exports the complete workspace', async () => {
  render(<App />)
  await importData()
  expect(screen.getByText('Lakewood High')).toBeInTheDocument()
  expect(screen.getByText('Review capacity')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Export sheet' }))
  await screen.findByText('Workbook exported')
  const exported = vi.mocked(window.api.exportSheet).mock.calls[0][0]
  expect(exported.employers).toEqual(fixture().employers)
  expect(exported.students.Alice.name).toBe('Alice')
})
it('turns employers off, preserves feedback and export rows, and restores the status after reopening', async () => {
  const app = render(<App />)
  await importData()
  fireEvent.click(screen.getByRole('button', { name: 'Final Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  expect(screen.getByText('Matched')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Employers' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Participation for Aero' }))
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'Export sheet' }))
  await screen.findByText('Workbook exported')
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
  fireEvent.click(screen.getByRole('button', { name: 'Export sheet' }))
  await screen.findByText('Workbook exported')
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
  expect(screen.getByText(/Your interviews were kept/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Approve schedule' }))
  expect(
    screen.getAllByRole('alert').some((a) => a.textContent?.includes('outside this employer'))
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Generate schedule' }))
  const modal = screen.getByRole('dialog', { name: 'Generate a new schedule' })
  fireEvent.click(within(modal).getByRole('button', { name: 'Keep current schedule' }))
  expect(screen.getByText(/Your interviews were kept/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Generate schedule' }))
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Generate new schedule' })
  )
  expect(screen.queryByText(/Your interviews were kept/)).not.toBeInTheDocument()
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
  fireEvent.click(screen.getByRole('button', { name: 'Export sheet' }))
  await screen.findByText('Workbook exported')
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
      title: 'The sheet could not be imported',
      detail: 'Student Good Fit, G4: rating is 9.',
      fix: 'Enter a whole number from 1 to 5.'
    }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Import sheet' }))
  fireEvent.click(screen.getByRole('button', { name: 'Choose workbook' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('G4')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'How to fix it: Enter a whole number from 1 to 5'
  )
  expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
  vi.mocked(window.api.exportSheet).mockRejectedValue(new Error('File locked'))
  fireEvent.click(screen.getByRole('button', { name: 'Export sheet' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('File locked'))
  expect(screen.getByRole('alert')).toHaveTextContent('Close the destination file in Excel')
})
it('treats cancellation as a normal outcome', async () => {
  render(<App />)
  vi.mocked(window.api.parseSheet).mockResolvedValue({ status: 'cancelled' })
  fireEvent.click(screen.getByRole('button', { name: 'Import sheet' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import sheet' })).toBeEnabled())
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
  fireEvent.change(screen.getByLabelText(/Internship places/), { target: { value: '-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save employer' }))
  expect(screen.getByRole('alert')).toHaveTextContent('whole number of 0 or more')
  fireEvent.change(screen.getByLabelText(/Internship places/), { target: { value: '2' } })
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
  fireEvent.click(screen.getByRole('button', { name: 'Final Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Storage is full')
  expect(screen.getByRole('alert')).toHaveTextContent('Export a workbook now')
  expect(screen.getByText('Export to keep your changes')).toBeInTheDocument()
  save.mockRestore()
})
it('recovers from a damaged saved workspace with a useful error', () => {
  localStorage.setItem(
    'jcim-workspace-v1',
    JSON.stringify({ ...emptyWorkspace(), employers: [null] })
  )
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Student Overview' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('saved workspace could not be opened')
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
  fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Final Matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate matching' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve matching' }))
  expect(screen.getByRole('button', { name: 'Matching approved' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Edit matching' }))
  fireEvent.change(screen.getByLabelText('Placement for Bob'), { target: { value: 'Aero' } })
  expect(screen.getByRole('alert')).toHaveTextContent('Aero has reached its internship capacity')
  expect(screen.getByLabelText('Placement for Bob')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('Employer response for Alice at Aero'), {
    target: { value: 'no' }
  })
  expect(screen.getByLabelText('Placement for Alice')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Approve matching' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Placement for Bob'), { target: { value: 'Aero' } })
  expect(screen.getByLabelText('Placement for Bob')).toHaveValue('Aero')
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
