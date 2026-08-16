// @vitest-environment jsdom

import { Suspense } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageAppBody } from '../src/client/index.js'
import { UsageApp, type UsageAppProps } from '../src/client/UsageApp.js'
import { en } from '../src/client/locales.js'
import { formatResetAt } from '../src/client/usage-view.js'

const tMap: Record<string, string> = { ...en }

function props(
  renderSlotOrExtra: UsageAppProps['renderSlot'] | Partial<UsageAppProps> = vi.fn(() => null),
  extra: Partial<UsageAppProps> = {},
): UsageAppProps {
  const overrides = typeof renderSlotOrExtra === 'function'
    ? { renderSlot: renderSlotOrExtra, ...extra }
    : { ...renderSlotOrExtra, ...extra }
  return {
    appId: 'dshapps.usage',
    appPath: '/',
    search: '',
    hash: '',
    navigate: vi.fn(),
    close: vi.fn(),
    renderSlot: vi.fn(() => null) as unknown as UsageAppProps['renderSlot'],
    t: key => tMap[key] ?? en[key as keyof typeof en] ?? key,
    ...overrides,
  } as UsageAppProps
}

function json(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

const RESET_AT = new Date(2026, 7, 23, 15, 0, 0).toISOString()

const BUCKETS = {
  inputTokens: 6,
  outputTokens: 4,
  cacheReadTokens: 2,
  cacheWriteTokens: 0,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('UsageApp', () => {
  it('renders heatmap, day detail, and provider cards', async () => {
    const navigate = vi.fn()
    const openSession = vi.fn()
    vi.stubGlobal('fetch', async (path: string) => {
      if (String(path).includes('/balances')) {
        return json({
          ok: true,
          balances: [
            {
              id: 'deepseek',
              displayName: 'DeepSeek',
              status: 'ok',
              remaining: 3,
              currency: 'CNY',
              granted: 10,
              toppedUp: 5,
              used: 12,
              limit: 20,
            },
            { id: 'zai', displayName: 'Z.ai', status: 'ok' },
            { id: 'empty-ok', displayName: 'Empty OK', status: 'ok' },
            { id: 'openrouter', displayName: 'OpenRouter', status: 'missing', message: 'OPENROUTER_API_KEY' },
            { id: 'moonshot', displayName: 'Moonshot', status: 'error', message: 'down' },
            { id: 'kimi', displayName: 'Kimi', status: 'unsupported' },
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
            windows: [{ kind: 'weekly', usedPercent: 20, remainingPercent: 80, resetsAt: RESET_AT }],
          }],
        })
      }
      if (String(path).includes('/day')) {
        return json({
          ok: true,
          date: '2026-08-15',
          totals: { tokens: 10, cacheHitRate: 10, ...BUCKETS },
          models: [{ model: 'deepseek/v3', tokens: 10, cacheHitRate: 10, ...BUCKETS }],
          sessions: [
            { id: 's1', title: 'Morning chat', tokens: 10, ...BUCKETS, models: [] },
            { id: 'session-32529ff4-b2d9-4e5e-b833-d525e048de97', tokens: 4, ...BUCKETS, models: [] },
          ],
        })
      }
      return json({
        ok: true,
        days: [{
          date: '2026-08-15',
          tokens: 10,
          cacheHitRate: 10,
          ...BUCKETS,
          models: [{ model: 'deepseek/v3', tokens: 10, cacheHitRate: 10, ...BUCKETS }],
        }],
        total: { tokens: 10, cacheHitRate: 12.5, ...BUCKETS },
        updatedAt: 1,
      })
    })
    render(<UsageApp {...props({ navigate, openSession })} />)
    expect(screen.getByText('Reading the local ledger…')).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('2026-08-15')).toBeTruthy())
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByText('This month')).toBeTruthy()
    expect(screen.getByText('All time')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByLabelText('2026-08-15'))
    expect(navigate).toHaveBeenCalledWith('/2026-08-15')
    await waitFor(() => expect(screen.getByText('deepseek/v3')).toBeTruthy())
    expect(screen.getByText('Morning chat')).toBeTruthy()
    expect(document.querySelector('[data-app-id="s1"]')).toBeTruthy()
    expect(screen.queryByText('s1')).toBeNull()
    expect(screen.getByText('session-32529ff4')).toBeTruthy()
    expect(screen.queryByText('session-32529ff4-b2d9-4e5e-b833-d525e048de97')).toBeNull()
    fireEvent.click(screen.getByText('Morning chat'))
    expect(openSession).toHaveBeenCalledWith('s1')
    expect(screen.getByText('Less')).toBeTruthy()
    expect(screen.getByText('More')).toBeTruthy()
    fireEvent.mouseEnter(screen.getByLabelText('2026-08-15'))
    expect(screen.getByRole('tooltip').textContent).toContain('2026-08-15')
    expect(screen.getByRole('tooltip').textContent).toContain('Tokens')
    expect(document.querySelector('[data-provider="deepseek"][data-status="ok"]')).toBeTruthy()
    expect(document.querySelector('[data-provider="empty-ok"]')).toBeNull()
    expect(screen.queryByText('Empty OK')).toBeNull()
    expect(document.querySelector('[data-provider="moonshot"]')).toBeNull()
    expect(document.querySelector('[data-provider="openrouter"]')).toBeNull()
    expect(document.querySelector('[data-provider="kimi"]')).toBeNull()
    expect(screen.queryByText('No balance API')).toBeNull()
    expect(screen.queryByText('No credential')).toBeNull()
    expect(screen.getByText(/Granted 10/)).toBeTruthy()
    fireEvent.click(screen.getByText('Moonshot'))
    expect(document.querySelector('[data-provider="moonshot"][data-status="error"]')).toBeTruthy()
    expect(document.querySelector('[data-provider="deepseek"]')).toBeNull()
    fireEvent.click(screen.getByText('This month'))
    expect(document.querySelector('[data-field="tokens"] dd')?.textContent).toBe('12')
    expect(screen.getByText(/Weekly 20%/)).toBeTruthy()
    expect(screen.getByText(new RegExp(formatResetAt(RESET_AT)))).toBeTruthy()
  })

  it('shows empty day copy and contributed actions', async () => {
    vi.stubGlobal('fetch', async (path: string) => {
      if (String(path).includes('/day')) {
        return json({ ok: true, date: '2026-08-01', totals: { tokens: 4, ...BUCKETS }, models: [], sessions: [] })
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

  it('replaces an invalid path, refreshes in place, and filters by provider', async () => {
    const navigate = vi.fn()
    let loads = 0
    vi.stubGlobal('fetch', async (path: string) => {
      loads += 1
      if (String(path).includes('/balances')) {
        return json({ ok: true, balances: [{ id: 'deepseek', displayName: 'DeepSeek', status: 'ok', remaining: 1 }] })
      }
      if (String(path).includes('/subscriptions')) {
        return json({
          ok: true,
          subscriptions: [{
            id: 'zai',
            displayName: 'Z.ai',
            status: 'ok',
            plan: 'GLM',
            windows: [
              { kind: 'session', usedPercent: 10, remainingPercent: 90 },
              { kind: 'monthly', usedPercent: 30, remainingPercent: 70 },
              { kind: 'billing', usedPercent: 50, remainingPercent: 50 },
            ],
          }],
        })
      }
      if (String(path).includes('/day')) {
        return json({
          ok: true,
          date: '2026-08-15',
          totals: { tokens: 12, cacheHitRate: null, inputTokens: 8, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 0 },
          models: [
            { model: 'deepseek/v3', tokens: 10, cacheHitRate: null, ...BUCKETS },
            { model: 'openrouter/gpt', tokens: 2, cacheHitRate: null, inputTokens: 2, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          ],
          sessions: [
            { id: 's1', tokens: 10, ...BUCKETS, models: [{ model: 'deepseek/v3', tokens: 10, ...BUCKETS }] },
            { id: 's2', tokens: 2, inputTokens: 2, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, models: [{ model: 'openrouter/gpt', tokens: 2, inputTokens: 2, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }] },
          ],
        })
      }
      return json({
        ok: true,
        days: [{
          date: '2026-08-15',
          tokens: 10,
          cacheHitRate: null,
          ...BUCKETS,
          models: [
            { model: 'deepseek/v3', tokens: 8, ...BUCKETS },
            { model: 'openrouter/gpt', tokens: 2, ...BUCKETS },
          ],
        }],
        total: { tokens: 10, cacheHitRate: null, ...BUCKETS },
        updatedAt: 1,
      })
    })
    render(<UsageApp {...props({ appPath: '/not-a-date', navigate })} />)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/\d{4}-\d{2}-\d{2}$/), { replace: true }))
    await waitFor(() => expect(screen.getByText('All')).toBeTruthy())
    expect(screen.getByText('Session 10%')).toBeTruthy()
    expect(screen.getByText('Monthly 30%')).toBeTruthy()
    expect(screen.getByText('Billing 50%')).toBeTruthy()
    const afterLoad = loads
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(loads).toBeGreaterThan(afterLoad))
    await waitFor(() => expect(screen.getByText('deepseek/v3')).toBeTruthy())
    expect(screen.getByText('openrouter/gpt')).toBeTruthy()
    fireEvent.click(screen.getByText('deepseek'))
    expect(screen.getByText('deepseek/v3')).toBeTruthy()
    expect(screen.queryByText('openrouter/gpt')).toBeNull()
    expect(document.querySelector('[data-field="day-tokens"] dd')?.textContent).toBe('12')
    fireEvent.click(screen.getByText('All'))
    expect(screen.getByText('openrouter/gpt')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
  })

  it('reloads the panel on the five-minute interval', async () => {
    const ticks: Array<() => void> = []
    vi.spyOn(window, 'setInterval').mockImplementation(handler => {
      ticks.push(handler as () => void)
      return 1 as unknown as ReturnType<typeof setInterval>
    })
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined)
    let loads = 0
    vi.stubGlobal('fetch', async (path: string) => {
      loads += 1
      if (String(path).includes('/balances')) return json({ ok: true, balances: [] })
      if (String(path).includes('/subscriptions')) return json({ ok: true, subscriptions: [] })
      if (String(path).includes('/day')) {
        return json({ ok: true, date: '2026-08-15', totals: { tokens: 0, cacheHitRate: null }, models: [], sessions: [] })
      }
      return json({ ok: true, days: [], total: { tokens: 0, cacheHitRate: null }, updatedAt: 1 })
    })
    render(<UsageApp {...props()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy())
    const afterLoad = loads
    expect(ticks.length).toBeGreaterThan(0)
    ticks[0]!()
    await waitFor(() => expect(loads).toBeGreaterThan(afterLoad))
  })

  it('keeps the last panel when a later refresh fails', async () => {
    let fail = false
    vi.stubGlobal('fetch', async (path: string) => {
      if (fail) return { ok: false, status: 500, json: async () => ({}) } as Response
      if (String(path).includes('/balances')) return json({ ok: true, balances: [] })
      if (String(path).includes('/subscriptions')) return json({ ok: true, subscriptions: [] })
      if (String(path).includes('/day')) {
        return json({ ok: true, date: '2026-08-15', totals: { tokens: 0, cacheHitRate: null }, models: [], sessions: [] })
      }
      return json({ ok: true, days: [], total: { tokens: 0, cacheHitRate: null }, updatedAt: 1 })
    })
    render(<UsageApp {...props()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy())
    fail = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy')).toBe('false'))
    expect(screen.getByText('Today')).toBeTruthy()
  })

  it('ignores stale panel and day responses after unmount', async () => {
    let rejectPanel!: (reason: unknown) => void
    vi.stubGlobal('fetch', async (path: string) => {
      if (String(path).includes('/summary') || String(path) === '/api/dshapps-usage/summary') {
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
