import { describe, expect, it } from 'vitest'
import type { DayRow, ModelRow, TokenBuckets } from '../src/fold.js'
import {
  dateFromPath,
  fetchJson,
  filterDaysByProvider,
  formatBucketSummary,
  formatResetAt,
  formatSessionId,
  formatTokens,
  heatLevel,
  isDateKey,
  loadDay,
  loadUsagePanel,
  monthGrid,
  monthLabel,
  monthPrefix,
  pathFromDate,
  periodTotals,
  providerKey,
  shiftMonth,
  todayKey,
  tokensByDate,
  tokensByProvider,
} from '../src/client/usage-view.js'

function modelRow(model: string, buckets: TokenBuckets): ModelRow {
  return {
    model,
    ...buckets,
    tokens: buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens,
    cacheHitRate: null,
  }
}

function dayRow(date: string, buckets: TokenBuckets, models: readonly ModelRow[] = []): DayRow {
  return {
    date,
    ...buckets,
    tokens: buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens,
    cacheHitRate: null,
    models,
  }
}

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

  it('reads a date from the app path and writes it back', () => {
    expect(dateFromPath('/')).toBeUndefined()
    expect(dateFromPath('/today')).toBeUndefined()
    expect(dateFromPath('/2026-08-15')).toBe('2026-08-15')
    expect(dateFromPath('/nope')).toBeNull()
    expect(dateFromPath('/2026-13-40')).toBeNull()
    expect(pathFromDate('2026-08-15')).toBe('/2026-08-15')
  })

  it('sums today, month, and all-time buckets from a fixed now', () => {
    const now = new Date(2026, 7, 16, 12, 0, 0).getTime()
    expect(todayKey(now)).toBe('2026-08-16')
    expect(monthPrefix('2026-08-16')).toBe('2026-08')
    const openai = modelRow('openai/gpt-4', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 10, cacheWriteTokens: 0 })
    const anthropic = modelRow('anthropic/claude', { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    const days = [
      dayRow('2026-08-16', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 10, cacheWriteTokens: 0 }, [openai]),
      dayRow('2026-08-01', { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, [anthropic]),
      dayRow('2026-07-31', { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, [
        modelRow('openai/gpt-4', { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      ]),
    ]
    const totals = periodTotals(days, now)
    expect(totals.today).toMatchObject({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 10, tokens: 25, cacheHitRate: 50 })
    expect(totals.month).toMatchObject({ inputTokens: 30, outputTokens: 5, cacheReadTokens: 10, tokens: 45 })
    expect(totals.all).toMatchObject({ inputTokens: 130, outputTokens: 5, cacheReadTokens: 10, tokens: 145 })
  })

  it('groups and filters days by provider', () => {
    expect(providerKey('openai/gpt-4')).toBe('openai')
    expect(providerKey('gpt-4')).toBe('unknown')
    expect(providerKey('')).toBe('unknown')
    const days = [
      dayRow('2026-08-16', { inputTokens: 30, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }, [
        modelRow('openai/gpt-4', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }),
        modelRow('anthropic/claude', { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      ]),
      dayRow('2026-08-01', { inputTokens: 8, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, [
        modelRow('anthropic/claude', { inputTokens: 8, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      ]),
    ]
    expect(tokensByProvider(days)).toEqual([
      { provider: 'anthropic', tokens: 28 },
      { provider: 'openai', tokens: 15 },
    ])
    expect(filterDaysByProvider(days, 'all')).toBe(days)
    const openaiDays = filterDaysByProvider(days, 'openai')
    expect(openaiDays).toHaveLength(1)
    expect(openaiDays[0]).toMatchObject({
      date: '2026-08-16',
      inputTokens: 10,
      outputTokens: 5,
      tokens: 15,
      models: [{ model: 'openai/gpt-4' }],
    })
  })

  it('formats bucket summaries and reset timestamps', () => {
    expect(formatBucketSummary(
      { inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { input: '输入', output: '输出', cacheRead: '缓存读', cacheWrite: '缓存写' },
    )).toBe('输入 1.2k · 输出 3.4k · 缓存读 0 · 缓存写 0')
    const local = new Date(2026, 7, 16, 15, 4, 0)
    expect(formatResetAt(local.toISOString())).toBe('2026-08-16 15:04')
    expect(formatResetAt('not-a-date')).toBe('not-a-date')
  })
})
