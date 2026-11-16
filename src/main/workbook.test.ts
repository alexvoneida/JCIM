// @vitest-environment node
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { emptyWorkspace } from '../shared/workspace'
import { Student } from '../shared/student'
import { InterviewResult } from '../shared/interviewResult'
import { fileError, readWorkbook, writeWorkspace, WorkbookIssue } from './workbook'
import { validateXlsxPackage } from './xlsx-package'

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
  data.waves = [{ name: 'Wave 1', rounds: 3, schools: ['Lakewood High School'], students: [] }]
  data.schedule = [{ id: 'one', student: 'Alice', employer: 'Aero', wave: 'Wave 1', round: 1 }]
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
    const loaded = new ExcelJS.Workbook()
    await loaded.xlsx.load(await writeWorkspace(fixture()).xlsx.writeBuffer())
    const { workspace } = readWorkbook(loaded)
    expect(workspace).toMatchObject(fixture())
  })
  it('exports a workbook that Excel opens without repairing it', async () => {
    expect(await validateXlsxPackage(await writeWorkspace(fixture()).xlsx.writeBuffer())).toEqual(
      []
    )
  })
  it('writes a Read me tab and the seven JCIM tabs, never the imported tracker’s own tabs', async () => {
    const data = {
      ...fixture(),
      sourceName: 'tracker.xlsx',
      importedAt: '2026-10-01T15:00:00.000Z'
    }
    const loaded = new ExcelJS.Workbook()
    await loaded.xlsx.load(await writeWorkspace(data).xlsx.writeBuffer())
    expect(loaded.worksheets.map((s) => s.name)).toEqual([
      'Read me',
      'JCIM Students',
      'JCIM Employers',
      'JCIM Waves',
      'JCIM Feedback',
      'JCIM Schedule',
      'JCIM Matches',
      'JCIM Settings'
    ])
    expect(loaded.getWorksheet('Read me')!.getCell('B2').text).toContain('tracker.xlsx')
    expect(readWorkbook(loaded).workspace).toMatchObject(fixture())
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
    const workbook = writeWorkspace(fixture())
    workbook.getWorksheet('JCIM Employers')!.getCell('D2').value = 'No'
    expect(() => readWorkbook(workbook)).toThrow(/schedules inactive employer/)
    workbook.getWorksheet('JCIM Schedule')!.spliceRows(2, 1)
    expect(() => readWorkbook(workbook)).toThrow(/placement.*not valid/)
  })
  it('rejects missing native tabs and invalid employer capacity', () => {
    const workbook = writeWorkspace(fixture())
    workbook.getWorksheet('JCIM Employers')!.getCell('C2').value = -1
    expect(() => readWorkbook(workbook)).toThrow(/JCIM Employers.*C2.*capacity/)
    workbook.removeWorksheet('JCIM Employers')
    expect(() => readWorkbook(workbook)).toThrow(/Required tab.*JCIM Employers/)
  })
  it('rejects an employer over its round limit and a student booked twice in one round', () => {
    const data = fixture()
    data.students.Bob = Object.assign(new Student(), { name: 'Bob' })
    data.employers[0].scheduling = { studentsPerRound: 1 }
    const workbook = writeWorkspace(data)
    const schedule = workbook.getWorksheet('JCIM Schedule')!
    schedule.addRow(['two', 'Bob', 'Aero', 'Wave 1', 1])
    expect(() => readWorkbook(workbook)).toThrow(
      /JCIM Schedule.*row 2.*Aero already has 1 student in Wave 1 round 1/
    )
    schedule.spliceRows(3, 1)
    workbook.getWorksheet('JCIM Employers')!.getCell('D3').value = 'Yes'
    schedule.addRow(['two', 'Alice', 'Paused', 'Wave 1', 1])
    expect(() => readWorkbook(workbook)).toThrow(/JCIM Schedule.*row 2.*Alice is booked twice/)
  })
  it('describes filesystem failures with specific next steps', () => {
    expect(fileError(new Error('ENOSPC: no space left'), 'export', '/backup.xlsx').fix).toContain(
      'disk space'
    )
    expect(fileError(new Error('ENOENT: folder missing'), 'export', '/backup.xlsx').fix).toContain(
      'destination folder'
    )
    expect(fileError(new Error('EPERM: file locked'), 'export', '/backup.xlsx').fix).toContain(
      'Close the file'
    )
  })
})

it('round trips students per round, wave placements, and rounds', async () => {
  const data = fixture()
  data.employers[0].scheduling = { studentsPerRound: 2 }
  data.waves = [
    { name: 'Wave 1', rounds: 4, schools: ['Lakewood High School'], students: ['Bob'] },
    { name: 'Wave 2', rounds: 2, schools: [], students: [] }
  ]
  data.students.Bob = Object.assign(new Student(), { name: 'Bob', school: '', interests: [] })
  data.schedule.push({ id: 'two', student: 'Bob', employer: 'Aero', wave: 'Wave 2', round: 2 })
  const exported = writeWorkspace(data)
  const loaded = new ExcelJS.Workbook()
  await loaded.xlsx.load(await exported.xlsx.writeBuffer())
  expect(readWorkbook(loaded).workspace).toMatchObject(data)
  expect(loaded.getWorksheet('JCIM Employers')!.getCell('E2').value).toBe(2)
  expect(loaded.getWorksheet('JCIM Waves')!.getCell('C2').value).toBe('Lakewood High School')
  expect(loaded.getWorksheet('JCIM Waves')!.getCell('D2').value).toBe('Bob')
  expect(loaded.getWorksheet('JCIM Schedule')!.getCell('D3').value).toBe('Wave 2')
  // A student cannot interview with two employers in the same round of a wave.
  loaded.getWorksheet('JCIM Employers')!.getCell('D3').value = 'Yes'
  loaded.getWorksheet('JCIM Schedule')!.addRow(['three', 'Alice', 'Paused', 'Wave 1', 1])
  expect(() => readWorkbook(loaded)).toThrow(/JCIM Schedule.*row 2.*Alice is booked twice/)
})

it('converts older exports with interview times into waves and rounds', () => {
  const data = fixture()
  data.students.Bob = Object.assign(new Student(), { name: 'Bob', school: '', interests: [] })
  const workbook = writeWorkspace(data)
  workbook.removeWorksheet(workbook.getWorksheet('JCIM Waves')!.id)
  workbook
    .getWorksheet('JCIM Employers')!
    .spliceColumns(
      5,
      2,
      ['Interview start', '09:00', ''],
      ['Interview end', '12:00', ''],
      ['Interview minutes', 30, ''],
      ['Students at once', 2, ''],
      ['Roles', '', '']
    )
  const schedule = workbook.getWorksheet('JCIM Schedule')!
  schedule.addRow(['two', 'Bob', 'Aero', 'Wave 1', 1])
  schedule.spliceColumns(
    4,
    2,
    ['Time', '09:30', '09:00'],
    ['Round', 1, 1],
    ['Interview minutes', '', 15]
  )
  const settings = workbook.getWorksheet('JCIM Settings')!
  settings.getCell('B2').value = '1'
  settings.addRows([
    ['Schedule start', '09:00'],
    ['Schedule end', '12:00'],
    ['Default interview minutes', 30]
  ])
  const imported = readWorkbook(workbook).workspace
  expect(imported.waves).toEqual([{ name: 'Wave 1', rounds: 3, schools: [], students: [] }])
  expect(imported.schedule).toEqual([
    { id: 'one', student: 'Alice', employer: 'Aero', wave: 'Wave 1', round: 2 },
    { id: 'two', student: 'Bob', employer: 'Aero', wave: 'Wave 1', round: 1 }
  ])
  expect(imported.employers[0].scheduling).toEqual({ studentsPerRound: 2 })
  expect(imported.employers[1].scheduling).toBeUndefined()
})

it('gives precise worksheet locations for invalid limits, rounds, waves, and unknown headings', () => {
  const workbook = writeWorkspace(fixture())
  const employers = workbook.getWorksheet('JCIM Employers')!
  employers.getCell('E2').value = 0
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Employers.*E2.*students per round/)
  employers.getCell('E2').value = 2
  const schedule = workbook.getWorksheet('JCIM Schedule')!
  schedule.getCell('E2').value = 5
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Schedule.*row 2.*Wave 1 has 3 rounds/)
  schedule.getCell('E2').value = 1
  schedule.getCell('D2').value = 'Wave 9'
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Schedule.*row 2.*Wave 9.*missing/)
  schedule.getCell('D2').value = 'Wave 1'
  const waves = workbook.getWorksheet('JCIM Waves')!
  waves.getCell('B2').value = 0
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Waves.*B2.*rounds/)
  waves.getCell('B2').value = 3
  waves.getCell('D2').value = 'Nobody'
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Waves.*row 2.*Nobody/)
  waves.getCell('D2').value = ''
  employers.getCell('F1').value = 'Rolls'
  expect(() => readWorkbook(workbook)).toThrow(/JCIM Employers.*F1.*Rolls/)
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
  const later = new InterviewResult('Alice', '2', 'Aero', 'Engineer', '', '', '', '5')
  later.employerAccept = false
  data.students.Alice.interviewResults.push(later)
  expect(() => writeWorkspace(data)).toThrow(/placement.*not valid/)
})

it('round trips the shared industry bank including options no longer assigned to anyone', async () => {
  const data = fixture()
  data.industries = ['Renewable energy', 'Architecture']
  const exported = writeWorkspace(data)
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

it('round trips employer roles, tags and the role of each placement', async () => {
  const data = fixture()
  data.employers[0] = {
    ...data.employers[0],
    capacity: 3,
    roles: [
      { title: 'Engineering', capacity: 2 },
      { title: 'HR', capacity: 1, tags: ['Human Resources', 'Business'] }
    ]
  }
  data.placements = [{ student: 'Alice', company: 'Aero', role: 'Engineering', rating: 5 }]
  const exported = writeWorkspace(data)
  const loaded = new ExcelJS.Workbook()
  await loaded.xlsx.load(await exported.xlsx.writeBuffer())
  expect(loaded.getWorksheet('JCIM Employers')!.getCell('F2').value).toBe(
    'Engineering: 2, HR [Human Resources, Business]: 1'
  )
  expect(readWorkbook(loaded).workspace).toMatchObject(data)
  // Alice's interests are Engineering and Finance, so an HR placement is rejected.
  loaded.getWorksheet('JCIM Matches')!.getCell('D2').value = 'HR'
  expect(() => readWorkbook(loaded)).toThrow(/JCIM Matches.*row 2.*not valid/)
  loaded.getWorksheet('JCIM Matches')!.getCell('D2').value = 'Engineering'
  loaded.getWorksheet('JCIM Employers')!.getCell('C2').value = 5
  expect(() => readWorkbook(loaded)).toThrow(/JCIM Employers.*row 2.*capacity 5/)
})
