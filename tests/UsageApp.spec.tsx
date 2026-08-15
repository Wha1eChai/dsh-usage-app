// @vitest-environment jsdom

import { Suspense } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageAppBody } from '../src/client/index.js'
import { UsageApp, type UsageAppProps } from '../src/client/UsageApp.js'
import { en } from '../src/client/locales.js'

function props(renderSlot = vi.fn(() => null)): UsageAppProps {
  return {
    appId: 'wha1echai.usage',
    appPath: '/',
    search: '',
    hash: '',
    navigate: vi.fn(),
    close: vi.fn(),
    renderSlot: renderSlot as unknown as UsageAppProps['renderSlot'],
    t: key => en[key],
  } as UsageAppProps
}

function json(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('UsageApp', () => {
  it('renders heatmap, day detail, and provider cards', async () => {
    vi.stubGlobal('fetch', async (path: string) => {
      if (String(path).includes('/balances')) {
        return json({
          ok: true,
          balances: [
            { id: 'deepseek', displayName: 'DeepSeek', status: 'ok', remaining: 3, currency: 'CNY' },
            { id: 'zai', displayName: 'Z.ai', status: 'ok' },
            { id: 'openrouter', displayName: 'OpenRouter', status: 'missing', message: 'OPENROUTER_API_KEY' },
            { id: 'moonshot', displayName: 'Moonshot', status: 'error', message: 'down' },
          ],
        })
      }
      if (String(path).includes('/subscriptions')) {
        return json({
          ok: true,
          subscriptions: [{
            id: 'opencode-go',
            displayName: 'OpenCode Go',
            status: 'ok',
            plan: 'Go',
            windows: [{ kind: 'weekly', usedPercent: 20, remainingPercent: 80 }],
          }],
        })
      }
      if (String(path).includes('/day')) {
        return json({
          ok: true,
          date: '2026-08-15',
          totals: { tokens: 10, cacheHitRate: 10 },
          models: [{ model: 'deepseek/v3', tokens: 10 }],
          sessions: [{ id: 's1', tokens: 10 }],
        })
      }
      return json({
        ok: true,
        days: [{ date: '2026-08-15', tokens: 10, models: [] }],
        total: { tokens: 10, cacheHitRate: 12.5 },
        updatedAt: 1,
      })
    })
    render(<UsageApp {...props()} />)
    expect(screen.getByText('Reading the local ledger…')).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('2026-08-15')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByLabelText('2026-08-15'))
    await waitFor(() => expect(screen.getByText('deepseek/v3')).toBeTruthy())
    expect(screen.getByText('s1')).toBeTruthy()
    expect(document.querySelector('[data-provider="deepseek"][data-status="ok"]')).toBeTruthy()
    expect(document.querySelector('[data-provider="openrouter"][data-status="missing"]')).toBeTruthy()
    expect(screen.getByText(/weekly 20%/)).toBeTruthy()
  })

  it('shows empty day copy and contributed actions', async () => {
    vi.stubGlobal('fetch', async (path: string) => {
      if (String(path).includes('/day')) {
        return json({ ok: true, date: '2026-08-01', totals: { tokens: 4 }, models: [], sessions: [] })
      }
      if (String(path).includes('/balances')) return json({ ok: true, balances: [] })
      if (String(path).includes('/subscriptions')) return json({ ok: true, subscriptions: [] })
      return json({ ok: true, days: [], total: { tokens: 0, cacheHitRate: null }, updatedAt: 1 })
    })
    const renderSlot = vi.fn(() => <button type="button">Kind action</button>)
    render(<UsageApp {...props(renderSlot)} />)
    await waitFor(() => expect(screen.getByText('Kind action')).toBeTruthy())
    const first = document.querySelector('[data-day]')
    if (first instanceof HTMLButtonElement) fireEvent.click(first)
    await waitFor(() => expect(screen.getByText('No model rows for this day')).toBeTruthy())
    expect(screen.getByText('No session rows for this day')).toBeTruthy()
  })

  it('clears day detail when the day route fails', async () => {
    vi.stubGlobal('fetch', async (path: string) => {
      if (String(path).includes('/day')) return { ok: false, status: 404, json: async () => ({}) } as Response
      if (String(path).includes('/balances')) return json({ ok: true, balances: [] })
      if (String(path).includes('/subscriptions')) return json({ ok: true, subscriptions: [] })
      return json({ ok: true, days: [], total: { tokens: 0, cacheHitRate: null }, updatedAt: 1 })
    })
    render(<UsageApp {...props()} />)
    await waitFor(() => expect(screen.getByText('No usage this month')).toBeTruthy())
  })

  it('shows the Host-missing empty state and lazy-loads', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response)
    render(<UsageApp {...props()} />)
    await waitFor(() => expect(screen.getByText(/Usage API unavailable/)).toBeTruthy())
    vi.stubGlobal('fetch', async () => json({ ok: true, days: [], total: { tokens: 0, cacheHitRate: null }, updatedAt: 1, balances: [], subscriptions: [] }))
    render(
      <Suspense fallback={<div>loading</div>}>
        <UsageAppBody {...props()} />
      </Suspense>,
    )
    await waitFor(() => expect(screen.getAllByText('Usage').length).toBeGreaterThan(0))
  })

  it('ignores stale panel and day responses after unmount', async () => {
    let rejectPanel!: (reason: unknown) => void
    vi.stubGlobal('fetch', async (path: string) => {
      if (String(path).includes('/summary') || String(path) === '/api/wha1echai-usage/summary') {
        return new Promise<Response>((_resolve, reject) => { rejectPanel = reject })
      }
      return json({ ok: true, date: '2026-08-15', totals: { tokens: 0 }, models: [], sessions: [], balances: [], subscriptions: [] })
    })
    const view = render(<UsageApp {...props()} />)
    view.unmount()
    rejectPanel('stale')
    await Promise.resolve()
  })
})
