import { render, screen } from '@testing-library/react'
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

it('greets the user', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Hello from JCIM' })).toBeInTheDocument()
})

it('shows the Electron version from the preload bridge', () => {
  render(<App />)
  expect(screen.getByText('1.0.0')).toBeInTheDocument()
})

it('shows the app version fetched over IPC', async () => {
  render(<App />)
  expect(await screen.findByText('9.9.9')).toBeInTheDocument()
})

it('falls back when the app version request fails', async () => {
  window.api.getAppVersion = vi.fn().mockRejectedValue(new Error('IPC unavailable'))
  render(<App />)
  expect(await screen.findByText('unknown')).toBeInTheDocument()
})
