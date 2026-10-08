import ExcelJS from 'exceljs'

export async function createTracker(path: string) {
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
  const employers = ['Mike’s Anchors', 'Frontier Aero', 'Red Rocks Software', 'Summit Credit Union']
  const records: [string, string, string[], number[]][] = [
    ['Leonard Williams', 'Lakewood High School', ['Engineering', 'Manufacturing'], [0]],
    ['Ernest Jones', 'Arvada West High School', ['Automobiles', 'Engineering'], [0]],
    ['Devon Witherspoon', 'Golden High School', ['Manufacturing', 'Aerospace'], [0, 1]],
    ['Maya Patel', 'D’Evelyn Jr./Sr. High', ['Software', 'Finance'], [2, 3]],
    ['Sofia Martinez', 'Wheat Ridge High School', ['Aerospace', 'Engineering'], [1]],
    ['Noah Kim', 'Bear Creek High School', ['Software', 'Automobiles'], [2, 3]],
    ['Aaliyah Brooks', 'Columbine High School', ['Finance', 'Software'], [3, 2]],
    ['Ethan Reynolds', 'Ralston Valley High School', ['Automobiles', 'Manufacturing'], [0]],
    ['Grace Chen', 'Chatfield High School', ['Aerospace', 'Finance'], [1, 3, 2]]
  ]
  const feedback = workbook.addWorksheet('Employer Good Fit')
  feedback.addRow(['All Waves'])
  feedback.addRow(
    employers.flatMap((name) => ['Student Names', name, 'Transportation', 'Skills', 'Positions'])
  )
  const survey = workbook.addWorksheet('Student Interest Survey Respons')
  survey.addRow([
    'Name (First & Last)',
    'School',
    'Tell us which career pathways interest you most.'
  ])
  const potential = workbook.addWorksheet('Potential Employers')
  potential.addRow([
    'Employer',
    'Contact',
    'Industry',
    'BDR',
    'Interested?',
    'Official Employer',
    'Address',
    '# of Interns'
  ])
  employers.forEach((name, i) =>
    potential.addRow([
      name,
      '',
      ['Advanced manufacturing', 'Aerospace systems', 'Enterprise software', 'Financial services'][
        i
      ],
      '',
      'Yes',
      true,
      '',
      [3, 2, 2, 2][i]
    ])
  )
  for (const [index, [name, school, interests, companies]] of records.entries()) {
    students.addRow([name])
    companies.forEach((company, n) => {
      students.addRow([n + 1, employers[company], 'Intern', 'Yes', 'Yes', 'Yes', 5 - n])
      const start = company * 5 + 1
      feedback.getCell(index + 3, start).value = name
      feedback.getCell(index + 3, start + 1).value = 'Yes'
      feedback.getCell(index + 3, start + 2).value = 'Yes'
      feedback.getCell(index + 3, start + 3).value = 'Yes'
      feedback.getCell(index + 3, start + 4).value = 'Intern'
    })
    survey.addRow([name, school, interests.join(', ')])
  }
  await workbook.xlsx.writeFile(path)
}
