import { expect, it } from 'vitest'
import { emptyWorkspace } from './workspace'
import { industryBank, rememberIndustries } from './industries'
import { Student } from './student'

it('combines employer, student, and saved options without case or whitespace duplicates', () => {
  const data = emptyWorkspace()
  data.industries = ['Renewable energy', 'Finance']
  data.employers = [{ name: 'Paused', industry: ' engineering ', capacity: 0, active: false }]
  data.students.Alice = Object.assign(new Student(), {
    name: 'Alice',
    interests: ['Engineering', '  FINANCE ', 'Arts']
  })
  expect(industryBank(data)).toEqual(['Arts', 'engineering', 'Finance', 'Renewable energy'])
  const saved = rememberIndustries(data)
  expect(saved.students.Alice.interests).toEqual(['engineering', 'Finance', 'Arts'])
  expect(saved.employers[0].industry).toBe('engineering')
  saved.employers[0].industry = 'Arts'
  saved.students.Alice.interests = ['Arts']
  expect(rememberIndustries(saved).industries).toContain('engineering')
})
