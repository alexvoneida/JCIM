import ExcelJS from 'exceljs'
import {
  convertTimedSchedule,
  findWave,
  sameName,
  scheduleIssues,
  type TimedInterview
} from '../shared/scheduling'
import { rememberIndustries } from '../shared/industries'
import { latestInterviews } from '../shared/feedback'
import { Student } from '../shared/student'
import { canFillRole, employerRoles, formatRoles, parseRoles, sameRole } from '../shared/roles'
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
  waves: 'JCIM Waves',
  feedback: 'JCIM Feedback',
  schedule: 'JCIM Schedule',
  matches: 'JCIM Matches',
  settings: 'JCIM Settings'
}
const headers = {
  students: ['Student', 'School', 'Grade', 'Interests'],
  employers: ['Employer', 'Industry', 'Capacity', 'Active'],
  waves: ['Wave', 'Rounds', 'Schools', 'Students'],
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
  schedule: ['ID', 'Student', 'Employer'],
  matches: ['Student', 'Employer', 'Student rating'],
  settings: ['Key', 'Value']
}

// Columns after the required ones are found by heading, so older layouts still import.
const exportHeaders = {
  ...headers,
  employers: [...headers.employers, 'Students per round', 'Roles'],
  schedule: [...headers.schedule, 'Wave', 'Round'],
  matches: [...headers.matches, 'Role']
}
// Headings written before waves existed. They are read for conversion and never written.
const legacyHeaders: Partial<Record<keyof typeof names, string[]>> = {
  employers: ['Interview start', 'Interview end', 'Interview minutes', 'Students at once'],
  schedule: ['Time', 'Round', 'Interview minutes']
}

interface SheetColumns {
  sheet: ExcelJS.Worksheet
  // 1-based index of an optional column, when its heading is present.
  column: (heading: string) => number | undefined
}

function readSheet(workbook: ExcelJS.Workbook, key: keyof typeof names): SheetColumns {
  const sheet = workbook.getWorksheet(names[key])
  if (!sheet)
    fail(
      `Required tab “${names[key]}” is missing.`,
      'Import a complete JCIM export. Keep all JCIM tabs in the workbook.'
    )
  headers[key].forEach((header, i) => {
    if (text(sheet, 1, i + 1) !== header)
      fail(
        `“${sheet.name}”, cell ${sheet.getCell(1, i + 1).address}, must have the heading “${header}”.`,
        'Restore the original column headings from a JCIM export and try again.'
      )
  })
  const known = [...exportHeaders[key], ...(legacyHeaders[key] ?? [])]
  const columns = new Map<string, number>()
  const last = Math.max(sheet.columnCount, known.length)
  for (let index = headers[key].length + 1; index <= last; index++) {
    const heading = text(sheet, 1, index)
    const hasValues = sheet
      .getColumn(index)
      .values.some((value, row) => row > 1 && value !== null && value !== undefined && value !== '')
    if (!heading && !hasValues) continue
    if (!known.includes(heading) || columns.has(heading))
      fail(
        `“${sheet.name}”, cell ${sheet.getCell(1, index).address}, has the heading “${heading || '(blank)'}”. Expected one of ${known
          .slice(headers[key].length)
          .map((h) => `“${h}”`)
          .join(', ')}.`,
        'Restore the column headings from a JCIM export.'
      )
    columns.set(heading, index)
  }
  return { sheet, column: (heading) => columns.get(heading) }
}

function nonemptyRows(sheet: ExcelJS.Worksheet, visit: (row: number) => void) {
  sheet.eachRow((row, index) => {
    if (index > 1 && row.actualCellCount > 0) visit(index)
  })
}

function readNative(workbook: ExcelJS.Workbook): Workspace {
  const data = emptyWorkspace()
  const { sheet: students } = readSheet(workbook, 'students')
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
  const { sheet: employers, column: employerColumn } = readSheet(workbook, 'employers')
  const rolesColumn = employerColumn('Roles')
  const limitColumn = employerColumn('Students per round') ?? employerColumn('Students at once')
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
    const capacity = number(employers, row, 3, 'capacity', 0)
    const { roles, error } = parseRoles(rolesColumn ? text(employers, row, rolesColumn) : '')
    if (error)
      fail(
        `“${employers.name}”, cell ${employers.getCell(row, rolesColumn).address}: ${error}`,
        'List roles as “Title: places”, separated by commas, for example “Engineering: 2, HR: 1”. Leave blank for general places.'
      )
    if (roles.length && roles.reduce((sum, r) => sum + r.capacity, 0) !== capacity)
      fail(
        `“${employers.name}”, row ${row}: capacity ${capacity} does not equal the total places in Roles for “${name}”.`,
        'Set Capacity to the sum of the role places, or clear Roles.'
      )
    data.employers.push({
      name,
      industry: text(employers, row, 2),
      capacity,
      ...(roles.length ? { roles } : {}),
      active,
      ...(limitColumn && text(employers, row, limitColumn)
        ? {
            scheduling: {
              studentsPerRound: number(employers, row, limitColumn, 'students per round', 1)
            }
          }
        : {})
    })
  })
  // Exports written before waves existed have no waves tab; their schedule is converted below.
  const waves = workbook.getWorksheet(names.waves) ? readSheet(workbook, 'waves') : undefined
  if (waves)
    nonemptyRows(waves.sheet, (row) => {
      const name = text(waves.sheet, row, 1)
      if (!name || data.waves.some((w) => sameName(w.name, name)))
        fail(
          `“${waves.sheet.name}”, row ${row}: wave name is blank or duplicated (“${name}”).`,
          'Give each wave a unique name.'
        )
      const list = (column: number) =>
        text(waves.sheet, row, column)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      const members = list(4)
      const missing = members.find((student) => !Object.hasOwn(data.students, student))
      if (missing !== undefined)
        fail(
          `“${waves.sheet.name}”, row ${row}: student “${missing}” is missing from “${names.students}”.`,
          'Add the student to JCIM Students or remove them from the wave.'
        )
      data.waves.push({
        name,
        rounds: number(waves.sheet, row, 2, 'rounds', 1, 50),
        schools: list(3),
        students: members
      })
    })
  const { sheet: feedback } = readSheet(workbook, 'feedback')
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
  const { sheet: schedule, column: scheduleColumn } = readSheet(workbook, 'schedule')
  const timeColumn = scheduleColumn('Time')
  const waveColumn = scheduleColumn('Wave')
  const roundColumn = scheduleColumn('Round')
  if (!roundColumn || (!timeColumn && !waveColumn))
    fail(
      `“${schedule.name}” must have Wave and Round columns.`,
      'Restore the Wave and Round headings from a JCIM export.'
    )
  const timed: TimedInterview[] = []
  nonemptyRows(schedule, (row) => {
    const student = text(schedule, row, 2)
    const employer = text(schedule, row, 3)
    checkReferences(data, schedule.name, row, student, employer)
    const id = text(schedule, row, 1)
    if (!id || [...data.schedule, ...timed].some((i) => i.id === id))
      fail(
        `“${schedule.name}”, row ${row}: interview ID is blank or duplicated.`,
        'Give each scheduled interview a unique ID.'
      )
    if (!data.employers.find((e) => e.name === employer)?.active)
      fail(
        `“${schedule.name}”, row ${row}, schedules inactive employer “${employer}”.`,
        'Remove that schedule row or turn the employer on. Keep the employer and feedback rows.'
      )
    const round = number(schedule, row, roundColumn, 'round', 1)
    if (timeColumn) {
      const time = text(schedule, row, timeColumn)
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
        fail(
          `“${schedule.name}”, row ${row}: time “${time}” is invalid.`,
          'Enter the start time as HH:MM, for example 09:30.'
        )
      timed.push({ id, student, employer, time, round })
      return
    }
    const wave = text(schedule, row, waveColumn!)
    if (!findWave(data, wave))
      fail(
        `“${schedule.name}”, row ${row}: wave “${wave || '(blank)'}” is missing from “${names.waves}”.`,
        'Add the wave to JCIM Waves or correct the wave name in this row.'
      )
    data.schedule.push({ id, student, employer, wave, round })
  })
  if (timed.length) Object.assign(data, convertTimedSchedule(timed, data.waves))
  const { sheet: matches } = readSheet(workbook, 'matches')
  nonemptyRows(matches, (row) => {
    const student = text(matches, row, 1)
    const company = text(matches, row, 2)
    checkReferences(data, matches.name, row, student, company)
    const rating = number(matches, row, 3, 'student rating', 1, 5) as 1 | 2 | 3 | 4 | 5
    const employer = data.employers.find((e) => e.name === company)!
    const interview = latestInterviews(data.students[student]).find(
      ({ interview: i }) => i.business === company && i.employerAccept === true && i.rank === rating
    )?.interview
    const roleText = text(matches, row, 4)
    const role = employerRoles(employer).find((r) =>
      r.title === null ? !roleText : sameRole(r.title, roleText)
    )
    if (
      !employer.active ||
      !interview ||
      !role ||
      !canFillRole(data.students[student].interests, role) ||
      data.placements.some((p) => p.student === student) ||
      data.placements.filter((p) => p.company === company && sameRole(p.role, role.title)).length >=
        role.capacity
    )
      fail(
        `“${matches.name}”, row ${row}: placement of “${student}” with “${company}” is not valid.`,
        'Check employer status, role and capacity, employer approval, student rating, and duplicate placements. Then generate matching again.'
      )
    data.placements.push({ student, company, role: role.title, rating })
  })
  const { sheet: settings } = readSheet(workbook, 'settings')
  const values = new Map<string, string>()
  nonemptyRows(settings, (row) => values.set(text(settings, row, 1), text(settings, row, 2)))
  if (!['1', '2'].includes(values.get('Format version') ?? ''))
    fail(
      '“JCIM Settings”: unsupported or missing Format version.',
      'Use a complete export from this version of JCIM. Keep Format version set to 2.'
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
    const located = issue.id
      ? rowLocation(schedule, issue.id)
      : issue.employer
        ? rowLocation(employers, issue.employer)
        : issue.wave && waves
          ? rowLocation(waves.sheet, issue.wave)
          : `“${settings.name}”`
    fail(
      `${located}: ${issue.detail}`,
      'Correct the wave, round, or employer limit, then import again. A student cannot interview twice in the same round.'
    )
  }
  return rememberIndustries(data)
}

// The sheet and row whose first cell holds `value`, for an error message.
function rowLocation(sheet: ExcelJS.Worksheet, value: string): string {
  let row: number | undefined
  nonemptyRows(sheet, (index) => {
    if (text(sheet, index, 1) === value) row = index
  })
  return `“${sheet.name}”${row ? `, row ${row}` : ''}`
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

const readMeName = 'Read me'

function addReadMe(workbook: ExcelJS.Workbook, data: Workspace) {
  const sheet = workbook.addWorksheet(readMeName)
  sheet.getColumn(1).width = 24
  sheet.getColumn(2).width = 110
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
  const when = (iso: string) => new Date(iso).toLocaleString()
  sheet.addRows([
    ['JCIM export', `Saved ${when(new Date().toISOString())}`],
    [
      'Imported from',
      data.sourceName
        ? `${data.sourceName}${data.importedAt ? ` on ${when(data.importedAt)}` : ''}`
        : 'No workbook was imported.'
    ],
    [],
    [
      'Re-importing',
      'Use Import workbook in JCIM to load this file again. Only the tabs whose names start with “JCIM” are read.'
    ],
    [
      'Editing in Excel',
      'Keep every JCIM tab and its heading row (row 1) exactly as exported. Rows below the headings can be edited.'
    ],
    [
      'Yes/No columns',
      'Use Yes, No, Maybe, or leave the cell blank. Active on JCIM Employers must be Yes or No.'
    ],
    [
      'Times and dates',
      'Times are 24-hour HH:MM, such as 09:30. The interview date is YYYY-MM-DD.'
    ],
    [],
    [names.students, 'One row per student: school, grade, and comma-separated interests.'],
    [
      names.employers,
      'One row per employer: industry, capacity, Active, students per round, and roles.'
    ],
    [
      names.waves,
      'One row per wave: its name, number of rounds, and the comma-separated schools and students placed in it.'
    ],
    [
      names.feedback,
      'One row per interview: the student’s answers and rating, and the employer’s response.'
    ],
    [names.schedule, 'One row per scheduled interview: student, employer, wave, and round.'],
    [names.matches, 'Final placements with the student rating and role.'],
    [names.settings, 'Interview date, approvals, and the industry bank.']
  ])
  sheet.getColumn(1).font = { bold: true }
  sheet.getCell('A1').font = { bold: true, size: 14 }
}

export function writeWorkspace(data: Workspace): ExcelJS.Workbook {
  data = rememberIndustries(data)
  // Built from scratch: copying the imported tracker's own tabs through ExcelJS produced
  // workbooks that Excel had to repair, and import never reads those tabs anyway.
  const workbook = new ExcelJS.Workbook()
  addReadMe(workbook, data)
  for (const [key, name] of Object.entries(names)) {
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
        e.scheduling?.studentsPerRound ?? '',
        formatRoles(e.roles)
      ])
  for (const w of data.waves)
    workbook
      .getWorksheet(names.waves)!
      .addRow([w.name, w.rounds, w.schools.join(', '), w.students.join(', ')])
  for (const i of data.schedule)
    workbook.getWorksheet(names.schedule)!.addRow([i.id, i.student, i.employer, i.wave, i.round])
  for (const p of data.placements)
    workbook.getWorksheet(names.matches)!.addRow([p.student, p.company, p.rating, p.role ?? ''])
  const settings = workbook.getWorksheet(names.settings)!
  settings.addRows([
    ['Format version', '2'],
    ['Interview date', data.interviewDate],
    ['Schedule approved', answer(data.scheduleApproved)],
    ['Matching approved', answer(data.matchingApproved)],
    ['Industry bank', JSON.stringify(data.industries)]
  ])
  // Validate exported data using the same strict rules as a later import.
  readNative(workbook)
  return workbook
}

export function fileError(error: unknown, action: 'import' | 'export', path: string): SheetError {
  if (error instanceof WorkbookIssue)
    return {
      ...error.issue,
      title: action === 'export' ? 'Export failed' : error.issue.title
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
        ? 'The destination folder is missing. Choose an existing folder, such as Documents.'
        : 'The selected file was moved or deleted. Choose an existing .xlsx file.'
  if (/ENOSPC/i.test(reason))
    fix = `Free some disk space or choose another drive, then ${action} again.`
  return {
    title: action === 'import' ? 'Import failed' : 'Export failed',
    detail: `${action === 'import' ? 'Reading' : 'Writing'} “${path}” failed. Reason: ${reason}`,
    fix
  }
}
