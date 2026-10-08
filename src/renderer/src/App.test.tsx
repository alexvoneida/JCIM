import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'

beforeEach(() => {
  window.api = {
    versions: { electron: '1.0.0' },
    getAppVersion: vi.fn().mockResolvedValue('9.9.9'),
    parseSheet: vi.fn().mockResolvedValue({
      Alice: { name: 'Alice', interviewResults: [] },
      Bob: { name: 'Bob', interviewResults: [] }
    }),
    exportSheet: vi.fn().mockResolvedValue(async () => {})
  }
})

it('shows the county heading', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Jefferson County' })).toBeInTheDocument()
})

it('keeps the original matching flow and explains placements on demand', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Internship Matching' }))
  expect(screen.getByRole('heading', { name: 'Internship Matching' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: "Mike's Hardware" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Generate Matches' }))
  expect(screen.getByRole('heading', { name: 'Matched Students' })).toBeInTheDocument()
  const section = screen.getByRole('heading', { name: 'Matched Students' }).closest('section')!
  const john = within(section).getByText('John Smith').closest('.match')!
  fireEvent.click(within(john as HTMLElement).getByText('Why?'))
  expect(john.querySelector('details')).toHaveAttribute('open')
  expect(within(john as HTMLElement).getByText(/John Smith rated Target 3\/5/)).toBeInTheDocument()
  expect(
    within(john as HTMLElement).getByText(/lower the group's total preference score/)
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '← Back' }))
  expect(screen.getByRole('heading', { name: 'Jefferson County' })).toBeInTheDocument()
})
