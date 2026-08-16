// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../src/client/locales.js'
import { formatTokens, type PeriodTotals } from '../src/client/usage-view.js'
import { UsagePeriodHero, type LedgerPeriod } from '../src/client/UsagePeriodHero.js'

const tMap: Record<string, string> = { ...en }

function t(key: string): string {
  return tMap[key] ?? en[key as keyof typeof en] ?? key
}

function sampleTotals(): PeriodTotals {
  return {
    today: {
      tokens: 42,
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      cacheHitRate: null,
    },
    month: {
      tokens: 1500,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
      cacheHitRate: 25,
    },
    all: {
      tokens: 2_000_000,
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheWriteTokens: 400,
      cacheHitRate: 50,
    },
  }
}

function renderHero(period: LedgerPeriod, onPeriod = vi.fn()) {
  const totals = sampleTotals()
  render(<UsagePeriodHero totals={totals} period={period} onPeriod={onPeriod} t={t} />)
  return { totals, onPeriod }
}

function fieldValue(field: string): string {
  return document.querySelector(`[data-field="${field}"] dd`)?.textContent ?? ''
}

afterEach(cleanup)

describe('UsagePeriodHero', () => {
  it('renders today tokens as the primary value when period is today', () => {
    const { totals } = renderHero('today')
    expect(fieldValue('tokens')).toBe(formatTokens(totals.today.tokens))
    expect(screen.queryByText(formatTokens(totals.month.tokens))).toBeNull()
    expect(screen.queryByText(formatTokens(totals.all.tokens))).toBeNull()
    expect(fieldValue('cache')).toBe('—')
  })

  it('calls onPeriod with month when This month is clicked', () => {
    const onPeriod = vi.fn()
    renderHero('today', onPeriod)
    fireEvent.click(screen.getByRole('button', { name: 'This month' }))
    expect(onPeriod).toHaveBeenCalledWith('month')
  })

  it('uses month bucket totals when period is month, not all-time', () => {
    const { totals } = renderHero('month')
    expect(fieldValue('input')).toBe(formatTokens(totals.month.inputTokens))
    expect(fieldValue('output')).toBe(formatTokens(totals.month.outputTokens))
    expect(fieldValue('cache-read')).toBe(formatTokens(totals.month.cacheReadTokens))
    expect(fieldValue('cache-write')).toBe(formatTokens(totals.month.cacheWriteTokens))
    expect(fieldValue('cache')).toBe(`${totals.month.cacheHitRate}%`)
    expect(fieldValue('input')).not.toBe(formatTokens(totals.all.inputTokens))
    expect(fieldValue('output')).not.toBe(formatTokens(totals.all.outputTokens))
    expect(fieldValue('cache-read')).not.toBe(formatTokens(totals.all.cacheReadTokens))
    expect(fieldValue('cache-write')).not.toBe(formatTokens(totals.all.cacheWriteTokens))
  })
})
