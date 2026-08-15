import { describe, expect, it } from 'vitest'
import {
  applyUsageDelta,
  bucketsOf,
  cacheHitRate,
  createUsageState,
  dayKey,
  foldUsage,
  mergeInto,
  renderDayDetail,
  renderUsage,
  resetUsageState,
  totalTokens,
  zeroBuckets,
} from '../src/fold.js'

describe('fold', () => {
  it('keys a local calendar day and sums buckets', () => {
    expect(dayKey(Date.UTC(2026, 7, 15, 12))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(totalTokens(bucketsOf({ inputTokens: 1, outputTokens: 2 }))).toBe(3)
    expect(cacheHitRate(zeroBuckets())).toBeNull()
    expect(cacheHitRate({ inputTokens: 1, outputTokens: 0, cacheReadTokens: 1, cacheWriteTokens: 0 })).toBe(50)
  })

  it('replaces the same turn/step instead of double counting', () => {
    const events = [
      { type: 'request/header', time: Date.parse('2026-08-15T00:00:00Z'), data: { header: { config: { model: 'v3', provider: 'deepseek' } } } },
      { type: 'assistant/chunk', time: Date.parse('2026-08-15T00:00:01Z'), data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } } } },
      { type: 'assistant/message', time: Date.parse('2026-08-15T00:00:02Z'), data: { turn: 1, step: 1, usage: { inputTokens: 12, outputTokens: 4 }, message: { source: { model: 'v3', provider: 'deepseek' } } } },
      { type: 'noise', time: Date.parse('2026-08-15T00:00:03Z') },
    ]
    const days = foldUsage(events)
    const day = [...days.values()][0]!
    expect(day.totals.inputTokens).toBe(12)
    expect(day.totals.outputTokens).toBe(4)
    expect(day.models.get('deepseek/v3')?.inputTokens).toBe(12)
  })

  it('falls back to unknown model and header-less samples', () => {
    const state = createUsageState()
    applyUsageDelta(state, [
      { type: 'assistant/message', time: Date.parse('2026-08-01T00:00:00Z'), data: { turn: 2, step: 1, usage: { inputTokens: 3 } } },
    ])
    expect([...state.days.values()][0]!.models.has('unknown/unknown')).toBe(true)
    resetUsageState(state)
    expect(state.consumed).toBe(0)
    expect(state.lastSample).toBeNull()
  })

  it('merges sessions and renders day detail', () => {
    const first = foldUsage([
      { type: 'assistant/message', time: Date.parse('2026-08-15T00:00:00Z'), data: { usage: { inputTokens: 5 }, message: { source: { model: 'a' } } } },
    ])
    const second = foldUsage([
      { type: 'assistant/message', time: Date.parse('2026-08-15T00:00:00Z'), data: { usage: { inputTokens: 7 }, message: { source: { model: 'b' } } } },
    ])
    const byDay = new Map()
    mergeInto(byDay, first)
    mergeInto(byDay, second)
    const rendered = renderUsage(byDay, 1)
    expect(rendered.total.tokens).toBe(12)
    expect(rendered.days[0]?.models[0]?.tokens).toBeGreaterThan(0)
    const date = rendered.days[0]!.date
    const detail = renderDayDetail(date, [
      { id: 's1', days: first },
      { id: 's2', days: second },
      { id: 'empty', days: new Map() },
    ])
    expect(detail.sessions).toHaveLength(2)
    expect(detail.totals.tokens).toBe(12)
    expect(renderDayDetail('1999-01-01', [{ id: 's1', days: first }]).sessions).toEqual([])
  })

  it('attributes a later sample to the last request header model', () => {
    const days = foldUsage([
      { type: 'request/header', time: 1, data: { header: { config: { model: 'kimi' } } } },
      { type: 'assistant/chunk', time: 2, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { outputTokens: 8 } } } },
    ])
    expect([...days.values()][0]!.models.has('unknown/kimi')).toBe(true)
  })
})
