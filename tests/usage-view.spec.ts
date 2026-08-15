import { describe, expect, it } from 'vitest'
import {
  fetchJson,
  formatSessionId,
  formatTokens,
  heatLevel,
  isDateKey,
  loadDay,
  loadUsagePanel,
  monthGrid,
  monthLabel,
  shiftMonth,
  tokensByDate,
} from '../src/client/usage-view.js'

describe('usage-view', () => {
  it('builds a Sunday-first month grid and formats tokens', () => {
    expect(isDateKey('2026-08-15')).toBe(true)
    expect(isDateKey('nope')).toBe(false)
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01')
    expect(monthLabel('2026-08-15')).toBe('2026-08')
    expect(heatLevel(0, 10)).toBe(0)
    expect(heatLevel(1, 0)).toBe(0)
    expect(heatLevel(1, 10)).toBe(1)
    expect(heatLevel(3, 10)).toBe(2)
    expect(heatLevel(6, 10)).toBe(3)
    expect(heatLevel(9, 10)).toBe(4)
    expect(formatTokens(12)).toBe('12')
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(2_000_000)).toBe('2.0M')
    expect(formatSessionId('session-32529ff4-b2d9-4e5e-b833-d525e048de97')).toBe('session-32529ff4')
    expect(formatSessionId('32529ff4-b2d9-4e5e-b833-d525e048de97')).toBe('32529ff4')
    expect(formatSessionId('s1')).toBe('s1')
    expect(formatSessionId('very-long-session-name')).toBe('very-lon…')
    const grid = monthGrid('2026-08-01', [{
      date: '2026-08-15',
      inputTokens: 10,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokens: 10,
      cacheHitRate: null,
      models: [],
    }])
    expect(grid.cells).toHaveLength(42)
    expect(grid.cells.some(cell => cell.date === '2026-08-15' && cell.level === 4 && cell.inMonth)).toBe(true)
    expect(tokensByDate(grid.cells.map(cell => ({
      date: cell.date,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokens: cell.tokens,
      cacheHitRate: null,
      models: [],
    }))).get('2026-08-15')).toBe(10)
  })

  it('loads panel and day JSON and rejects failed envelopes', async () => {
    const fetchImpl = async (path: string) => {
      if (path.includes('/day')) return { ok: true, json: async () => ({ ok: true, date: '2026-08-15', totals: { tokens: 1 }, models: [], sessions: [] }) } as Response
      if (path.includes('/balances')) return { ok: true, json: async () => ({ ok: true, balances: [] }) } as Response
      if (path.includes('/subscriptions')) return { ok: true, json: async () => ({ ok: true, subscriptions: [] }) } as Response
      return { ok: true, json: async () => ({ ok: true, days: [], total: { tokens: 0, cacheHitRate: null }, updatedAt: 1 }) } as Response
    }
    const panel = await loadUsagePanel(fetchImpl)
    expect(panel.summary.total.tokens).toBe(0)
    await expect(loadDay('2026-08-15', fetchImpl)).resolves.toMatchObject({ date: '2026-08-15' })
    await expect(fetchJson('/x', async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response)).rejects.toThrow(/HTTP 500/)
    await expect(fetchJson('/x', async () => ({ ok: true, json: async () => ({ ok: false, error: 'nope' }) }) as Response)).rejects.toThrow('nope')
    await expect(fetchJson('/x', async () => ({ ok: true, json: async () => ({ ok: false }) }) as Response)).rejects.toThrow('request-failed')
  })
})
