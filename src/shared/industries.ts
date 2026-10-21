import type { Workspace } from './workspace'

export function industryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function industryBank(data: Workspace): string[] {
  const names = new Map<string, string>()
  for (const value of [
    ...(data.industries ?? []),
    ...data.employers.map((e) => e.industry),
    ...Object.values(data.students).flatMap((s) => s.interests ?? [])
  ]) {
    const name = industryName(value)
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name)
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b))
}

export function rememberIndustries(data: Workspace): Workspace {
  const bank = industryBank(data)
  const canonical = (value: string) =>
    bank.find((name) => name.toLowerCase() === industryName(value).toLowerCase()) ?? ''
  return {
    ...data,
    industries: bank,
    employers: data.employers.map((e) => ({ ...e, industry: canonical(e.industry) })),
    students: Object.fromEntries(
      Object.entries(data.students).map(([key, student]) => [
        key,
        {
          ...student,
          interests: student.interests
            ? [...new Set(student.interests.map(canonical).filter(Boolean))]
            : undefined
        }
      ])
    ) as Workspace['students']
  }
}
