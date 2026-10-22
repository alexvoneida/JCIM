import type { Employer, EmployerRole } from './workspace'

// A role with a null title is a general place: any approved student can fill it.
// A titled role can only be filled by a student whose interests match one of its tags.
export type OpenRole = { title: string | null; tags: string[]; capacity: number }

// A role without its own tags is tagged with its title ("Engineering" -> "Engineering").
export function roleTags(role: Pick<EmployerRole, 'title' | 'tags'>): string[] {
  return role.tags?.length ? role.tags : [role.title]
}

// Employers without specific roles have one general pool sized by their capacity.
export function employerRoles(employer: Employer): OpenRole[] {
  return employer.roles?.length
    ? employer.roles.map((r) => ({ title: r.title, tags: roleTags(r), capacity: r.capacity }))
    : [{ title: null, tags: [], capacity: employer.capacity }]
}

export function employerCapacity(employer: Employer): number {
  return employerRoles(employer).reduce((sum, r) => sum + r.capacity, 0)
}

export const normalizeRole = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase()

export function sameRole(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeRole(a ?? '') === normalizeRole(b ?? '')
}

// The employer only approves or declines a student. Which role they can fill
// comes from the student's interests: general places take anyone, and a titled
// role needs an interest that matches one of its tags.
export function canFillRole(
  interests: string[] | undefined,
  role: { title: string | null; tags: string[] }
): boolean {
  if (role.title === null) return true
  return (interests ?? []).some((i) => role.tags.some((t) => sameRole(i, t)))
}

// "Engineering: 2" when the only tag is the title, otherwise "HR [Human Resources, Business]: 1".
export function formatRoles(roles: EmployerRole[] | undefined): string {
  return (roles ?? [])
    .map((r) => {
      const tags = roleTags(r)
      const showTags = !(tags.length === 1 && sameRole(tags[0], r.title))
      return `${r.title}${showTags ? ` [${tags.join(', ')}]` : ''}: ${r.capacity}`
    })
    .join(', ')
}

// Splits on commas, semicolons and new lines that are not inside [tags].
function splitRoles(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '[') depth++
    if (char === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && /[,;\n]/.test(char)) {
      parts.push(current)
      current = ''
    } else current += char
  }
  return [...parts, current].map((p) => p.trim()).filter(Boolean)
}

const clean = (text: string) => text.trim().replace(/\s+/g, ' ')

// Parses "Engineering: 2, HR [Human Resources, Business]: 1".
// A role without a number gets 1 place; a role without tags is tagged with its title.
export function parseRoles(value: string): { roles: EmployerRole[]; error?: string } {
  const roles: EmployerRole[] = []
  for (const part of splitRoles(value)) {
    const match = /^([^[\]:]*?)\s*(?:\[([^\]]*)\])?\s*(?::\s*(\S+))?$/.exec(part)
    if (!match)
      return {
        roles: [],
        error: `Role “${part}” is not in the form “Title [tags]: places”, for example “HR [Human Resources]: 1”.`
      }
    const title = clean(match[1])
    const capacity = match[3] === undefined ? 1 : Number(match[3])
    const tags = (match[2] ?? '').split(/[,;]/).map(clean).filter(Boolean)
    if (!title) return { roles: [], error: `Role “${part}” has no title.` }
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      return {
        roles: [],
        error: `Role “${title}” must have a whole number of places, for example “${title}: 2”.`
      }
    if (match[2] !== undefined && !tags.length)
      return { roles: [], error: `Role “${title}” has empty [ ] tags. Remove them or add a tag.` }
    if (roles.some((r) => sameRole(r.title, title)))
      return { roles: [], error: `Role “${title}” is listed more than once.` }
    const ownTagOnly = tags.length === 1 && sameRole(tags[0], title)
    roles.push({ title, capacity, ...(tags.length && !ownTagOnly ? { tags } : {}) })
  }
  return { roles }
}
