// @vitest-environment node
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { emptyWorkspace } from '../shared/workspace'
import { Student } from '../shared/student'
import { InterviewResult } from '../shared/interviewResult'
import { fileError, readWorkbook, writeWorkspace, WorkbookIssue } from './workbook'

function fixture() {
  const data = emptyWorkspace()
  const student = new Student()
  student.name = 'Alice'
  student.school = 'Lakewood High School'
  student.interests = ['Engineering', 'Finance']
  const interview = new InterviewResult('Alice', '1', 'Aero', 'Engineer', 'Yes', 'Yes', 'Yes', '5')
  interview.setEmployerData('Yes', 'Yes', 'Yes', 'Engineer', 'Excellent interview')
  student.interviewResults.push(interview)
  data.students.Alice = student
  data.employers = [
    { name: 'Aero', industry: 'Aerospace', capacity: 1, active: true },
    { name: 'Paused', industry: 'Software', capacity: 2, active: false }
  ]
  data.schedule = [{ id: 'one', student: 'Alice', employer: 'Aero', time: '09:00', round: 1 }]
  data.placements = [{ student: 'Alice', company: 'Aero', rating: 5 }]
  data.interviewDate = '2026-10-15'
  data.scheduleApproved = true
  data.matchingApproved = true
  return data
}

function legacy() {
  const workbook = new ExcelJS.Workbook()
  const students = workbook.addWorksheet('Student Good Fit')
  students.addRow([
    '',
    'Business',
    'Position',
    'Location',
    'Excitement',
    'Acceptance',
    'Overall Rank'
  ])
  students.addRow(Array(7).fill('Wave #1'))
  students.addRow(['Alice'])
  students.addRow([1, 'Aero', 'Engineer', 'Yes', 'Yes', 'Yes', 5])
  const employers = workbook.addWorksheet('Employer Good Fit')
  employers.addRow(['All Waves'])
  employers.addRow([
    'Student Names',
    'Aero',
    'Transportation',
    'Notes',
    'Skills',
    'Positions',
    'Student Names',
    'Paused',
    'Skills',
    'Positions',
    'Transportation'
  ])
  employers.addRow(['Alice', 'Yes', 'Yes', 'Great fit', 'Yes', 'Engineer'])
  return workbook
}

describe('workbook import and export', () => {
  it('round trips feedback, inactive employers, schedules, placements, and approval through xlsx bytes', async () => {
    const source = new ExcelJS.Workbook()
    const original = source.addWorksheet('Original Tracker')
    original.getCell('A1').value = 'Keep this employer'
    original.getCell('B2').value = { formula: '1+2', result: 3 }
    original.getCell('A1').font = { bold: true }
    writeWorkspace(source, fixture())
    const loaded = new ExcelJS.Workbook()
    await loaded.xlsx.load(await source.xlsx.writeBuffer())
    const { workspace } = readWorkbook(loaded)
    expect(workspace).toMatchObject(fixture())
    expect(loaded.getWorksheet('Original Tracker')!.getCell('A1').value).toBe('Keep this employer')
    expect(loaded.getWorksheet('Original Tracker')!.getCell('A1').font.bold).toBe(true)
    expect(loaded.getWorksheet('Original Tracker')!.getCell('B2').value).toEqual({
      formula: '1+2',
      result: 3
    })
    writeWorkspace(loaded, workspace)
    expect(loaded.worksheets.filter((s) => s.name === 'JCIM Employers')).toHaveLength(1)
  })
  it('reads variable employer groups and preserves employers without feedback', () => {
    const { workspace, warnings } = readWorkbook(legacy())
    expect(workspace.students.Alice.interviewResults[0]).toMatchObject({
      employerAccept: true,
      employerNotes: 'Great fit',
      employerPositions: 'Engineer',
      rank: 5
    })
    expect(workspace.employers).toHaveLength(2)
    expect(workspace.employers.every((e) => e.capacity === 0)).toBe(true)
    expect(warnings[0]).toContain('no confirmed capacity')
  })
  it('gives the exact missing tab and repair instruction', () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Other Data')
    try {
      readWorkbook(workbook)
      expect.fail('Expected import to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkbookIssue)
      expect((error as WorkbookIssue).issue.detail).toContain('Student Good Fit')
      expect((error as WorkbookIssue).issue.detail).toContain('Other Data')
      expect((error as WorkbookIssue).issue.fix).toContain('full internship tracker')
    }
  })
  it('rejects invalid ratings with sheet and cell instead of silently making placements', () => {
    const workbook = legacy()
    workbook.getWorksheet('Student Good Fit')!.getCell('G4').value = 9
    expect(() => readWorkbook(workbook)).toThrow(/Student Good Fit.*G4.*9/)
  })
  it('reports orphan feedback with row and employer', () => {
    const workbook = legacy()
    workbook.getWorksheet('Employer Good Fit')!.getCell('A3').value = 'Missing Student'
    const { warnings } = readWorkbook(workbook)
    expect(warnings.some((w) => /row 3.*Missing Student.*Aero/.test(w))).toBe(true)
  })
  it('rejects an inactive employer in a final match and keeps all employer rows in export', () => {
    const workbook = writeWorkspace(new ExcelJS.Workbook(), fixture())
    workbook.getWorksheet('JCIM Employers')!.getCell('D2').value = 'No'
    expect(() => readWorkbook(workbook)).toThrow(/schedules inactive employer/)
    workbook.getWorksheet('JCIM Schedule')!.spliceRows(2, 1)
    expect(() => readWorkbook(workbook)).toThrow(/placement.*not valid/)
  })
  it('rejects missing native tabs and invalid employer capacity', () => {
    const workbook = writeWorkspace(new ExcelJS.Workbook(), fixture())
    workbook.getWorksheet('JCIM Employers')!.getCell('C2').value = -1
    expect(() => readWorkbook(workbook)).toThrow(/JCIM Employers.*C2.*capacity/)
    workbook.removeWorksheet('JCIM Employers')
    expect(() => readWorkbook(workbook)).toThrow(/Required tab.*JCIM Employers/)
  })
  it('rejects overlapping interviews beyond the company limit even when start times differ', () => {
    const data = fixture()
    data.students.Bob = Object.assign(new Student(), { name: 'Bob' })
    const workbook = writeWorkspace(new ExcelJS.Workbook(), data)
    workbook.getWorksheet('JCIM Schedule')!.addRow(['two', 'Bob', 'Aero', '09:15', 1])
    expect(() => readWorkbook(workbook)).toThrow(/booked twice/)
  })
  it('describes filesystem failures with specific next steps', () => {
    expect(fileError(new Error('ENOSPC: no space left'), 'export', '/backup.xlsx').fix).toContain(
      'disk space'
    )
    expect(fileError(new Error('ENOENT: source missing'), 'export', '/backup.xlsx').fix).toContain(
      'saved source workbook'
    )
    expect(fileError(new Error('EPERM: file locked'), 'export', '/backup.xlsx').fix).toContain(
      'Close the file'
    )
  })
})

it('round trips parallel interviews, company hours and lengths, and individual duration overrides', async () => {
  const data = fixture()
  data.scheduleSettings = { start: '08:00', end: '12:00', durationMinutes: 20 }
  data.employers[0].scheduling = {
    start: '09:00',
    end: '11:00',
    durationMinutes: 15,
    parallelInterviews: 2
  }
  data.students.Bob = Object.assign(new Student(), { name: 'Bob', school: '', interests: [] })
  data.schedule.push({
    id: 'two',
    student: 'Bob',
    employer: 'Aero',
    time: '09:00',
    round: 1,
    durationMinutes: 10
  })
  const exported = writeWorkspace(new ExcelJS.Workbook(), data)
  const loaded = new ExcelJS.Workbook()
  await loaded.xlsx.load(await exported.xlsx.writeBuffer())
  expect(readWorkbook(loaded).workspace).toMatchObject(data)
  expect(loaded.getWorksheet('JCIM Employers')!.getCell('H2').value).toBe(2)
  expect(loaded.getWorksheet('JCIM Schedule')!.getCell('F3').value).toBe(10)
  // Parallel capacity never permits a student to interview at two companies at once.
  loaded.getWorksheet('JCIM Employers')!.getCell('D3').value = 'Yes'
  loaded.getWorksheet('JCIM Schedule')!.addRow(['three', 'Alice', 'Paused', '09:00', 1, 10])
  expect(() => readWorkbook(loaded)).toThrow(/JCIM Schedule.*row 2.*Alice is booked twice/)
})

it('reads older JCIM exports without optional columns or schedule settings', () => {
  const data = fixture()
  data.schedule[0].time = '18:00'
  const workbook = writeWorkspace(new ExcelJS.Workbook(), data)
  workbook.getWorksheet('JCIM Employers')!.spliceColumns(5, 4)
  workbook.getWorksheet('JCIM Schedule')!.spliceColumns(6, 1)
  const settings = workbook.getWorksheet('JCIM Settings')!
  for (let row = settings.rowCount; row >= 2; row--)
    if (
      ['Schedule start', 'Schedule end', 'Default interview minutes'].includes(
        settings.getCell(row, 1).text
      )
    )
      settings.spliceRows(row, 1)
  const imported = readWorkbook(workbook).workspace
  expect(imported.scheduleSettings).toEqual({ start: '09:00', end: '18:30', durationMinutes: 30 })
  expect(imported.schedule[0].time).toBe('18:00')
})

it('gives precise worksheet locations for invalid durations, employer limits, hours, and optional headings', () => {
  const workbook = writeWorkspace(new ExcelJS.Workbook(), fixture())
  const employers = workbook.getWorksheet('JCIM Employers')!
  employers.getCell('H2').value = 0
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Employers.*H2.*students at once/)
  employers.getCell('H2').value = 2
  employers.getCell('E2').value = '07:00'
  expect(() => readWorkbook(workbook)).toThrow(
    /JCIM Employers.*row 2.*outside the overall schedule window/
  )
  employers.getCell('E2').value = ''
  workbook.getWorksheet('JCIM Schedule')!.getCell('F2').value = -5
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Schedule.*F2.*interview minutes/)
  workbook.getWorksheet('JCIM Schedule')!.getCell('F2').value = ''
  employers.getCell('H1').value = ''
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Employers.*H1.*Students at once/)
})

it('imports nonstandard legacy answers as unknown with a specific cell note', () => {
  const workbook = legacy()
  workbook.getWorksheet('Student Good Fit')!.getCell('F4').value = 'Other'
  const { workspace, warnings } = readWorkbook(workbook)
  expect(workspace.students.Alice.interviewResults[0].acceptance).toBeUndefined()
  expect(warnings.some((w) => /Student Good Fit.*F4.*other.*unknown/.test(w))).toBe(true)
})
it('rejects a placement that contradicts a later interview round', () => {
  const data = fixture()
  const later = new InterviewResult('Alice', '2', 'Aero', 'Engineer', '', '', 'No', '5')
  later.employerAccept = true
  data.students.Alice.interviewResults.push(later)
  expect(() => writeWorkspace(new ExcelJS.Workbook(), data)).toThrow(/placement.*not valid/)
})

it('round trips the shared industry bank including options no longer assigned to anyone', async () => {
  const data = fixture()
  data.industries = ['Renewable energy', 'Architecture']
  const exported = writeWorkspace(new ExcelJS.Workbook(), data)
  const loaded = new ExcelJS.Workbook()
  await loaded.xlsx.load(await exported.xlsx.writeBuffer())
  const imported = readWorkbook(loaded).workspace
  expect(imported.industries).toEqual(
    ['Architecture', 'Aerospace', 'Engineering', 'Finance', 'Renewable energy', 'Software'].sort(
      (a, b) => a.localeCompare(b)
    )
  )
  loaded.getWorksheet('JCIM Settings')!.eachRow((row) => {
    if (row.getCell(1).text === 'Industry bank') row.getCell(2).value = 'not a list'
  })
  expect(() => readWorkbook(loaded)).toThrow(/Industry bank is not a valid list/)
})
it('includes industry options from unmatched survey students and potential employers', () => {
  const workbook = legacy()
  const employers = workbook.addWorksheet('Potential Employers')
  employers.addRow(['Employer', 'Contact', 'Industry'])
  employers.addRow(['Not interviewed', '', 'Architecture'])
  const survey = workbook.addWorksheet('Student Survey Responses')
  survey.addRow(['Name (First & Last)', 'Tell us which career pathways interest you most.'])
  survey.addRow(['Not interviewed', 'Public Health, Finance'])
  expect(readWorkbook(workbook).workspace.industries).toEqual([
    'Architecture',
    'Finance',
    'Public Health'
  ])
})
