import { expect, it } from 'vitest'
import { canFillRole, formatRoles, parseRoles } from './roles'

it('parses roles with optional tags and places', () => {
  expect(parseRoles('Engineering: 2, HR [Human Resources, Business]: 1, Front Desk')).toEqual({
    roles: [
      { title: 'Engineering', capacity: 2 },
      { title: 'HR', capacity: 1, tags: ['Human Resources', 'Business'] },
      { title: 'Front Desk', capacity: 1 }
    ]
  })
  expect(parseRoles('HR [ ]: 1').error).toMatch(/empty/)
  expect(parseRoles('HR: two').error).toMatch(/whole number/)
  expect(parseRoles('HR: 1, hr: 2').error).toMatch(/more than once/)
})

it('formats roles back to the same text', () => {
  const text = 'Engineering: 2, HR [Human Resources, Business]: 1'
  expect(formatRoles(parseRoles(text).roles)).toBe(text)
})

it('lets anyone fill a general place but needs a matching interest for a titled role', () => {
  const hr = { title: 'HR', tags: ['Human Resources'] }
  expect(canFillRole([], { title: null, tags: [] })).toBe(true)
  expect(canFillRole(['human  resources'], hr)).toBe(true)
  expect(canFillRole(['Engineering'], hr)).toBe(false)
  expect(canFillRole(undefined, hr)).toBe(false)
})
