import ExcelJS from 'exceljs'
import { scheduleIssues, scheduleSettings } from '../shared/scheduling'
import { rememberIndustries } from '../shared/industries'
import { latestInterviews } from '../shared/feedback'
import { Student } from '../shared/student'
import { InterviewResult } from '../shared/interviewResult'
import { emptyWorkspace, type Workspace, type SheetError } from '../shared/workspace'

export class WorkbookIssue extends Error {
  constructor(public issue: SheetError) {
    super(issue.detail)
  }
}

function fail(detail: string, fix: string): never {
  throw new WorkbookIssue({ title: 'The sheet could not be imported', detail, fix })
}

function text(sheet: ExcelJS.Worksheet, row: number, column: number): string {
  const cell = sheet.getCell(row, column)
  if (
    cell.type === ExcelJS.ValueType.Error ||
    (typeof cell.result === 'object' && cell.result !== null && 'error' in cell.result) ||
    (cell.type === ExcelJS.ValueType.Formula && cell.result === undefined)
  ) {
    fail(
      `“${sheet.name}”, cell ${cell.address}, contains an Excel error or a formula without a saved result.`,
      'Fix the formula in Excel, recalculate, save the workbook, and import it again.'
    )
  }
  return cell.text.trim()
}

function number(
  sheet: ExcelJS.Worksheet,
  row: number,
  column: number,
  label: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number {
  const value = text(sheet, row, column)
  const numeric = Number(value)
  if (!value || !Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    fail(
      `“${sheet.name}”, cell ${sheet.getCell(row, column).address}: ${label} is “${value || '(blank)'}”.`,
      max === Number.MAX_SAFE_INTEGER
        ? `Enter a whole number of ${min} or more for ${label}.`
        : `Enter a whole number from ${min} to ${max} for ${label}.`
    )
  }
  return numeric
}

function bool(
  sheet: ExcelJS.Worksheet,
  row: number,
  column: number,
  warnings?: string[]
): boolean | undefined {
  const value = text(sheet, row, column).toLowerCase()
  if (!value || value === 'maybe' || value === 'unknown') return undefined
  if (['yes', 'true'].includes(value)) return true
  if (['no', 'false'].includes(value)) return false
  if (warnings) {
    warnings.push(
      `“${sheet.name}”, cell ${sheet.getCell(row, column).address}: “${value}” is not a yes/no answer. It was imported as unknown. The original value remains in the source sheet. Use Yes, No, Maybe, or blank and import again to clarify the feedback.`
    )
    return undefined
  }
  fail(
    `“${sheet.name}”, cell ${sheet.getCell(row, column).address}, contains “${value}” instead of a yes/no answer.`,
    'Use Yes, No, Maybe, or leave the cell blank.'
  )
}

const names = {
  students: 'JCIM Students',
  employers: 'JCIM Employers',
  feedback: 'JCIM Feedback',
  schedule: 'JCIM Schedule',
  matches: 'JCIM Matches',
  settings: 'JCIM Settings'
}
const headers = {
  students: ['Student', 'School', 'Grade', 'Interests'],
  employers: ['Employer', 'Industry', 'Capacity', 'Active'],
  feedback: [
    'Student',
    'Wave',
    'Employer',
    'Position',
    'Location',
    'Excitement',
    'Acceptance',
    'Student rating',
    'Employer approval',
    'Transportation',
    'Skills',
    'Employer positions',
    'Employer notes'
  ],
  schedule: ['ID', 'Student', 'Employer', 'Time', 'Round'],
  matches: ['Student', 'Employer', 'Student rating'],
  settings: ['Key', 'Value']
}

const exportHeaders = {
  ...headers,
  employers: [
    ...headers.employers,
    'Interview start',
    'Interview end',
    'Interview minutes',
    'Students at once'
  ],
  schedule: [...headers.schedule, 'Interview minutes']
}

function requiredSheet(workbook: ExcelJS.Workbook, key: keyof typeof names): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(names[key])
  if (!sheet)
    fail(
      `Required tab “${names[key]}” is missing.`,
      'Import a complete JCIM export. Keep all six JCIM tabs in the workbook.'
    )
  headers[key].forEach((header, i) => {
    if (text(sheet, 1, i + 1) !== header)
      fail(
        `“${sheet.name}”, cell ${sheet.getCell(1, i + 1).address}, must have the heading “${header}”.`,
        'Restore the original column headings from a JCIM export and try again.'
      )
  })
  const all = exportHeaders[key]
  for (let index = headers[key].length; index < all.length; index++) {
    const heading = text(sheet, 1, index + 1)
    const hasValues = sheet
      .getColumn(index + 1)
      .values.some((value, row) => row > 1 && value !== null && value !== undefined && value !== '')
    if ((heading || hasValues) && heading !== all[index])
      fail(
        `“${sheet.name}”, cell ${sheet.getCell(1, index + 1).address}, must have the heading “${all[index]}”.`,
        'Restore the scheduling column headings from a JCIM export.'
      )
  }
  return sheet
}

function nonemptyRows(sheet: ExcelJS.Worksheet, visit: (row: number) => void) {
  sheet.eachRow((row, index) => {
    if (index > 1 && row.actualCellCount > 0) visit(index)
  })
}

function readNative(workbook: ExcelJS.Workbook): Workspace {
  const data = emptyWorkspace()
  const students = requiredSheet(workbook, 'students')
  nonemptyRows(students, (row) => {
    const name = text(students, row, 1)
    if (!name || Object.hasOwn(data.students, name))
      fail(
        `“${students.name}”, row ${row}: student name is ${name ? `a duplicate of “${name}”` : 'blank'}.`,
        'Give each student a unique, nonempty name.'
      )
    const student = new Student()
    Object.assign(student, {
      name,
      school: text(students, row, 2),
      grade: text(students, row, 3) || undefined,
      interests: text(students, row, 4)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    })
    Object.defineProperty(data.students, name, {
      value: student,
      enumerable: true,
      configurable: true,
      writable: true
    })
  })
  const employers = requiredSheet(workbook, 'employers')
  nonemptyRows(employers, (row) => {
    const name = text(employers, row, 1)
    if (!name || data.employers.some((e) => e.name.toLowerCase() === name.toLowerCase()))
      fail(
        `“${employers.name}”, row ${row}: employer name is blank or duplicated (“${name}”).`,
        'Give each employer a unique name. Keep inactive employers with Active set to No.'
      )
    const active = bool(employers, row, 4)
    if (active === undefined)
      fail(
        `“${employers.name}”, row ${row}: Active is blank or unknown for “${name}”.`,
        'Set Active to Yes or No.'
      )
    data.employers.push({
      name,
      industry: text(employers, row, 2),
      capacity: number(employers, row, 3, 'capacity', 0),
      active,
      scheduling: {
        start: text(employers, row, 5) || undefined,
        end: text(employers, row, 6) || undefined,
        durationMinutes: text(employers, row, 7)
          ? number(employers, row, 7, 'interview minutes', 1, 1440)
          : undefined,
        parallelInterviews: text(employers, row, 8)
          ? number(employers, row, 8, 'students at once', 1)
          : undefined
      }
    })
  })
  const feedback = requiredSheet(workbook, 'feedback')
  nonemptyRows(feedback, (row) => {
    const student = text(feedback, row, 1)
    const employer = text(feedback, row, 3)
    checkReferences(data, feedback.name, row, student, employer)
    const rankText = text(feedback, row, 8)
    const rank = rankText ? number(feedback, row, 8, 'student rating', 1, 5) : 0
    const result = new InterviewResult(
      student,
      String(number(feedback, row, 2, 'wave', 1)),
      employer,
      text(feedback, row, 4),
      '',
      '',
      '',
      String(rank)
    )
    result.location = bool(feedback, row, 5)
    result.excitement = bool(feedback, row, 6)
    result.acceptance = bool(feedback, row, 7)
    result.employerAccept = bool(feedback, row, 9)
    result.employerTransport = bool(feedback, row, 10)
    result.employerSkills = bool(feedback, row, 11)
    result.employerPositions = text(feedback, row, 12)
    result.employerNotes = text(feedback, row, 13)
    data.students[student].interviewResults.push(result)
  })
  const schedule = requiredSheet(workbook, 'schedule')
  nonemptyRows(schedule, (row) => {
    const student = text(schedule, row, 2)
    const employer = text(schedule, row, 3)
    checkReferences(data, schedule.name, row, student, employer)
    const time = text(schedule, row, 4)
    const id = text(schedule, row, 1)
    if (!id || data.schedule.some((i) => i.id === id))
      fail(
        `“${schedule.name}”, row ${row}: interview ID is blank or duplicated.`,
        'Give each scheduled interview a unique ID.'
      )
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      fail(
        `“${schedule.name}”, row ${row}: time “${time}” is invalid.`,
        'Enter the start time as HH:MM, for example 09:30.'
      )
    if (!data.employers.find((e) => e.name === employer)?.active)
      fail(
        `“${schedule.name}”, row ${row}, schedules inactive employer “${employer}”.`,
        'Remove that schedule row or turn the employer on. Keep the employer and feedback rows.'
      )
    data.schedule.push({
      id,
      student,
      employer,
      time,
      round: number(schedule, row, 5, 'round', 1),
      durationMinutes: text(schedule, row, 6)
        ? number(schedule, row, 6, 'interview minutes', 1, 1440)
        : undefined
    })
  })
  const matches = requiredSheet(workbook, 'matches')
  nonemptyRows(matches, (row) => {
    const student = text(matches, row, 1)
    const company = text(matches, row, 2)
    checkReferences(data, matches.name, row, student, company)
    const rating = number(matches, row, 3, 'student rating', 1, 5) as 1 | 2 | 3 | 4 | 5
    const employer = data.employers.find((e) => e.name === company)!
    const eligible = latestInterviews(data.students[student]).some(
      ({ interview: i }) =>
        i.business === company &&
        i.employerAccept === true &&
        i.acceptance !== false &&
        i.rank === rating
    )
    if (
      !employer.active ||
      !eligible ||
      data.placements.some((p) => p.student === student) ||
      data.placements.filter((p) => p.company === company).length >= employer.capacity
    )
      fail(
        `“${matches.name}”, row ${row}: placement of “${student}” with “${company}” is not valid.`,
        'Check employer status and capacity, employer approval, student acceptance/rating, and duplicate placements. Then generate matching again.'
      )
    data.placements.push({ student, company, rating })
  })
  const settings = requiredSheet(workbook, 'settings')
  const values = new Map<string, string>()
  nonemptyRows(settings, (row) => values.set(text(settings, row, 1), text(settings, row, 2)))
  if (values.get('Format version') !== '1')
    fail(
      '“JCIM Settings”: unsupported or missing Format version.',
      'Use a complete export from this version of JCIM. Keep Format version set to 1.'
    )
  const savedBank = values.get('Industry bank')
  if (savedBank) {
    let bank: unknown
    try {
      bank = JSON.parse(savedBank)
    } catch {
      fail(
        '“JCIM Settings”: Industry bank is not a valid list.',
        'Restore the Industry bank setting from a JCIM export, or remove that setting to rebuild the options from students and employers.'
      )
    }
    if (
      !Array.isArray(bank) ||
      !bank.every((name: unknown) => typeof name === 'string' && name.trim())
    )
      fail(
        '“JCIM Settings”: Industry bank must contain only nonempty industry names.',
        'Restore the Industry bank setting from a JCIM export, or remove that setting to rebuild it.'
      )
    data.industries = bank as string[]
  }
  const hasScheduleSettings = ['Schedule start', 'Schedule end', 'Default interview minutes'].some(
    (key) => values.has(key)
  )
  if (hasScheduleSettings) {
    const duration = Number(values.get('Default interview minutes'))
    data.scheduleSettings = {
      start: values.get('Schedule start') ?? '',
      end: values.get('Schedule end') ?? '',
      durationMinutes: duration
    }
  } else data.scheduleSettings = scheduleSettings(data)
  data.interviewDate = values.get('Interview date') ?? ''
  if (
    data.interviewDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(data.interviewDate) ||
      !Number.isFinite(Date.parse(data.interviewDate)) ||
      new Date(data.interviewDate).toISOString().slice(0, 10) !== data.interviewDate)
  )
    fail(
      '“JCIM Settings”: Interview date is invalid.',
      'Use a real calendar date in YYYY-MM-DD format or leave it blank.'
    )
  for (const key of ['Schedule approved', 'Matching approved']) {
    if (!['Yes', 'No'].includes(values.get(key) ?? ''))
      fail(
        `“JCIM Settings”: “${key}” must be Yes or No.`,
        'Restore the approval setting from a complete JCIM export.'
      )
  }
  data.scheduleApproved = values.get('Schedule approved') === 'Yes'
  data.matchingApproved = values.get('Matching approved') === 'Yes'
  if (data.scheduleApproved && (!data.schedule.length || !data.interviewDate))
    fail(
      '“JCIM Settings”: schedule is approved without interviews or an interview date.',
      'Set Schedule approved to No, or restore the schedule and interview date.'
    )
  if (data.matchingApproved && !data.placements.length)
    fail(
      '“JCIM Settings”: matching is approved without placements.',
      'Set Matching approved to No, or restore the placements.'
    )
  const issue = scheduleIssues(data)[0]
  if (issue) {
    let row: number | undefined
    if (issue.id)
      nonemptyRows(schedule, (index) => {
        if (text(schedule, index, 1) === issue.id) row = index
      })
    if (issue.employer)
      nonemptyRows(employers, (index) => {
        if (text(employers, index, 1) === issue.employer) row = index
      })
    fail(
      `“${issue.id ? schedule.name : issue.employer ? employers.name : settings.name}”${row ? `, row ${row}` : ''}: ${issue.detail}`,
      'Correct the interview times, duration, employer interview limits, or schedule hours, then import again. Student interviews must not overlap.'
    )
  }
  return rememberIndustries(data)
}

function checkReferences(
  data: Workspace,
  sheet: string,
  row: number,
  student: string,
  employer: string
) {
  if (!Object.hasOwn(data.students, student))
    fail(
      `“${sheet}”, row ${row}: student “${student || '(blank)'}” is missing from “JCIM Students”.`,
      'Add the student to JCIM Students or correct the spelling in this row.'
    )
  if (!data.employers.some((e) => e.name === employer))
    fail(
      `“${sheet}”, row ${row}: employer “${employer || '(blank)'}” is missing from “JCIM Employers”.`,
      'Add the employer to JCIM Employers or correct the spelling in this row.'
    )
}

export function readWorkbook(workbook: ExcelJS.Workbook): {
  workspace: Workspace
  warnings: string[]
} {
  if (workbook.worksheets.some((s) => s.name.startsWith('JCIM ')))
    return { workspace: readNative(workbook), warnings: [] }
  const data = emptyWorkspace()
  const warnings: string[] = []
  const studentSheet = workbook.worksheets.find((s) => /student good fit/i.test(s.name))
  const employerSheet = workbook.worksheets.find((s) => /employer good fit/i.test(s.name))
  if (!studentSheet || !employerSheet)
    fail(
      `Missing ${!studentSheet ? '“Student Good Fit”' : ''}${!studentSheet && !employerSheet ? ' and ' : ''}${!employerSheet ? '“Employer Good Fit”' : ''} tabs. Found: ${workbook.worksheets.map((s) => `“${s.name}”`).join(', ') || 'no worksheets'}.`,
      'Choose the full internship tracker with both Good Fit tabs, or a complete JCIM export. CSV and older .xls files are not supported.'
    )
  const waves = new Map<number, number>()
  studentSheet.getRow(2).eachCell((cell, col) => {
    const match = /^wave\s*#\s*(\d+)$/i.exec(cell.text.trim())
    if (match && !waves.has(Number(match[1]))) waves.set(Number(match[1]), col)
  })
  if (!waves.size)
    fail(
      `“${studentSheet.name}”, row 2, has no Wave #1 / Wave #2 headings.`,
      'Restore the Wave # headings in row 2 above each group of student columns.'
    )
  for (const [wave, col] of waves) {
    if (wave < 1)
      fail(
        `“${studentSheet.name}”, row 2: wave must be at least 1.`,
        'Use Wave #1, Wave #2, and so on.'
      )
    let current: Student | undefined
    studentSheet.getColumn(col).eachCell((_cell, row) => {
      if (row < 3) return
      const value = text(studentSheet, row, col)
      if (!value) return
      if (Number.isNaN(Number(value))) {
        if (!Object.hasOwn(data.students, value)) {
          const student = new Student()
          student.name = value
          Object.defineProperty(data.students, value, {
            value: student,
            enumerable: true,
            writable: true,
            configurable: true
          })
        }
        current = data.students[value]
      } else {
        const business = text(studentSheet, row, col + 1)
        if (!business) return
        if (!current)
          fail(
            `“${studentSheet.name}”, row ${row}, has an interview with “${business}” before a student name.`,
            'Add the student name above the interview rows in this wave.'
          )
        const rankValue = text(studentSheet, row, col + 6)
        const rank = rankValue ? number(studentSheet, row, col + 6, 'student rating', 1, 5) : 0
        const result = new InterviewResult(
          current.name,
          String(wave),
          business,
          text(studentSheet, row, col + 2),
          '',
          '',
          '',
          String(rank)
        )
        result.location = bool(studentSheet, row, col + 3, warnings)
        result.excitement = bool(studentSheet, row, col + 4, warnings)
        result.acceptance = bool(studentSheet, row, col + 5, warnings)
        current.interviewResults.push(result)
      }
    })
  }
  if (!Object.keys(data.students).length)
    fail(
      `“${studentSheet.name}” contains no student names under the wave headings.`,
      'Add student names and their interview rows starting in row 3.'
    )
  const employerNames = new Set(
    Object.values(data.students).flatMap((s) => s.interviewResults.map((i) => i.business))
  )
  const groups: number[] = []
  employerSheet.getRow(2).eachCell((cell, col) => {
    if (/^student names?$/i.test(cell.text.trim())) groups.push(col)
  })
  if (!groups.length)
    fail(
      `“${employerSheet.name}”, row 2, has no “Student Names” headings.`,
      'Restore each employer group: Student Names, employer name, Transportation, Skills, Positions, and optional Notes.'
    )
  for (const [index, col] of groups.entries()) {
    const employer = text(employerSheet, 2, col + 1)
    if (!employer) {
      let hasData = false
      employerSheet.getColumn(col).eachCell((cell, row) => {
        if (row > 2 && cell.text.trim()) hasData = true
      })
      if (hasData)
        fail(
          `“${employerSheet.name}”, cell ${employerSheet.getCell(2, col + 1).address}: employer name is blank above student feedback.`,
          'Enter the employer’s name in the heading above the yes/no approval column.'
        )
      continue
    }
    employerNames.add(employer)
    const end = groups[index + 1] ?? employerSheet.columnCount + 1
    const columns = new Map<string, number>()
    for (let c = col + 2; c < end; c++) columns.set(text(employerSheet, 2, c).toLowerCase(), c)
    const missing = ['transportation', 'skills', 'positions'].filter((h) => !columns.has(h))
    if (missing.length)
      fail(
        `“${employerSheet.name}”, row 2: “${employer}” is missing ${missing.join(', ')} headings.`,
        'Restore those headings inside this employer’s group. Optional Notes may appear in any order.'
      )
    employerSheet.getColumn(col).eachCell((_cell, row) => {
      if (row < 3) return
      const name = text(employerSheet, row, col)
      if (!name) return
      const results = Object.hasOwn(data.students, name)
        ? data.students[name].interviewResults.filter((i) => i.business === employer)
        : []
      if (!results.length) {
        warnings.push(
          `“${employerSheet.name}”, row ${row}: feedback for “${name}” at “${employer}” has no matching student interview. It is retained in the source sheet but is not used for matching. Correct the names or add the interview in Student Good Fit.`
        )
        return
      }
      const notesCol = columns.get('notes') ?? columns.get('')
      for (const result of results) {
        result.employerAccept = bool(employerSheet, row, col + 1, warnings)
        result.employerTransport = bool(
          employerSheet,
          row,
          columns.get('transportation')!,
          warnings
        )
        result.employerSkills = bool(employerSheet, row, columns.get('skills')!, warnings)
        result.employerPositions = text(employerSheet, row, columns.get('positions')!)
        result.employerNotes = notesCol ? text(employerSheet, row, notesCol) : ''
      }
    })
  }
  data.employers = [...employerNames].map((name) => ({
    name,
    industry: '',
    capacity: 0,
    active: true
  }))
  const potential = workbook.getWorksheet('Potential Employers')
  if (potential) {
    potential.eachRow((_row, row) => {
      if (row < 2) return
      const name = text(potential, row, 1)
      const industry = text(potential, row, 3)
      data.industries = [...(data.industries ?? []), industry]
      const employer = data.employers.find((e) => e.name === name)
      if (!employer) return
      employer.industry = industry
      const value = potential.getCell(row, 8).value
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        employer.capacity = value
    })
  }
  for (const sheet of workbook.worksheets.filter((s) =>
    /student.*(survey|interest)/i.test(s.name)
  )) {
    let nameCol = 0,
      schoolCol = 0,
      interestCol = 0
    sheet.getRow(1).eachCell((cell, col) => {
      if (/^name\s*\(/i.test(cell.text)) nameCol = col
      if (/^school$/i.test(cell.text)) schoolCol = col
      if (/career pathways/i.test(cell.text)) interestCol = col
    })
    if (!nameCol) continue
    sheet.eachRow((_row, row) => {
      if (row < 2) return
      const name = text(sheet, row, nameCol)
      const interests = interestCol
        ? text(sheet, row, interestCol)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
      data.industries = [...(data.industries ?? []), ...interests]
      if (!Object.hasOwn(data.students, name)) return
      if (schoolCol) data.students[name].school = text(sheet, row, schoolCol)
      if (interestCol) data.students[name].interests = interests
    })
  }
  const missingCapacity = data.employers.filter((e) => e.capacity === 0)
  if (missingCapacity.length)
    warnings.unshift(
      `${missingCapacity.length} employers have no confirmed capacity. Set their internship places on the Employers page before matching. No capacity was assumed.`
    )
  return { workspace: rememberIndustries(data), warnings }
}

const answer = (value: boolean | undefined) => (value === undefined ? '' : value ? 'Yes' : 'No')

export function writeWorkspace(workbook: ExcelJS.Workbook, data: Workspace): ExcelJS.Workbook {
  data = rememberIndustries(data)
  // Only the app-owned tabs are replaced. Original tracker worksheets stay intact.
  for (const [key, name] of Object.entries(names)) {
    const existing = workbook.getWorksheet(name)
    if (existing) workbook.removeWorksheet(existing.id)
    const sheet = workbook.addWorksheet(name)
    sheet.addRow(exportHeaders[key as keyof typeof headers])
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172338' } }
    sheet.getRow(1).height = 28
    sheet.columns.forEach((column) => {
      column.width = 25
    })
    sheet.getColumn(1).width = 32
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: exportHeaders[key as keyof typeof headers].length }
    }
  }
  const students = workbook.getWorksheet(names.students)!
  const feedback = workbook.getWorksheet(names.feedback)!
  for (const student of Object.values(data.students)) {
    students.addRow([
      student.name,
      student.school ?? '',
      student.grade ?? '',
      student.interests?.join(', ') ?? ''
    ])
    for (const i of student.interviewResults)
      feedback.addRow([
        student.name,
        i.wave,
        i.business,
        i.position,
        answer(i.location),
        answer(i.excitement),
        answer(i.acceptance),
        i.rank || '',
        answer(i.employerAccept),
        answer(i.employerTransport),
        answer(i.employerSkills),
        i.employerPositions ?? '',
        i.employerNotes ?? ''
      ])
  }
  for (const e of data.employers)
    workbook
      .getWorksheet(names.employers)!
      .addRow([
        e.name,
        e.industry,
        e.capacity,
        answer(e.active),
        e.scheduling?.start ?? '',
        e.scheduling?.end ?? '',
        e.scheduling?.durationMinutes ?? '',
        e.scheduling?.parallelInterviews ?? ''
      ])
  for (const i of data.schedule)
    workbook
      .getWorksheet(names.schedule)!
      .addRow([i.id, i.student, i.employer, i.time, i.round, i.durationMinutes ?? ''])
  for (const p of data.placements)
    workbook.getWorksheet(names.matches)!.addRow([p.student, p.company, p.rating])
  const settings = workbook.getWorksheet(names.settings)!
  settings.addRows([
    ['Format version', '1'],
    ['Interview date', data.interviewDate],
    ['Schedule approved', answer(data.scheduleApproved)],
    ['Matching approved', answer(data.matchingApproved)],
    ['Industry bank', JSON.stringify(data.industries)],
    ['Schedule start', scheduleSettings(data).start],
    ['Schedule end', scheduleSettings(data).end],
    ['Default interview minutes', scheduleSettings(data).durationMinutes]
  ])
  // Validate exported data using the same strict rules as a later import.
  readNative(workbook)
  return workbook
}

export function fileError(error: unknown, action: 'import' | 'export', path: string): SheetError {
  if (error instanceof WorkbookIssue)
    return {
      ...error.issue,
      title: action === 'export' ? 'The sheet could not be exported' : error.issue.title
    }
  const reason = error instanceof Error ? error.message : String(error)
  let fix =
    action === 'import'
      ? 'Open the file in Excel, save it as an .xlsx workbook, close it, and try again.'
      : 'Choose a writable folder, close the destination file in Excel, and try exporting again.'
  if (/EACCES|EPERM|EBUSY/i.test(reason))
    fix = 'Close the file in Excel and choose a folder you can write to, such as Documents.'
  if (/ENOENT/i.test(reason))
    fix =
      action === 'export'
        ? 'The saved source workbook or destination folder is missing. Re-import the source workbook if its saved copy is unavailable, then choose an existing destination folder.'
        : 'The selected file was moved or deleted. Choose an existing .xlsx file.'
  if (/ENOSPC/i.test(reason))
    fix = `Free some disk space or choose another drive, then ${action} again.`
  return {
    title: `The sheet could not be ${action === 'import' ? 'imported' : 'exported'}`,
    detail: `${action === 'import' ? 'Reading' : 'Writing'} “${path}” failed. Reason: ${reason}`,
    fix
  }
}
