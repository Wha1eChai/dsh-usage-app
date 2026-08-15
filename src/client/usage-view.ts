import type { BalanceCard } from '../balances.js'
import type { DayDetail, DayRow, UsageRender } from '../fold.js'
import type { SubscriptionCard } from '../subscriptions.js'

export interface HeatmapCell {
  readonly date: string
  readonly tokens: number
  readonly level: 0 | 1 | 2 | 3 | 4
  readonly inMonth: boolean
}

export interface UsagePanelData {
  readonly summary: UsageRender
  readonly balances: readonly BalanceCard[]
  readonly subscriptions: readonly SubscriptionCard[]
}

export interface MonthGrid {
  readonly year: number
  readonly month: number
  readonly label: string
  readonly cells: readonly HeatmapCell[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value: string): boolean {
  return DATE.test(value)
}

export function shiftMonth(date: string, delta: number): string {
  const [year, month] = date.split('-').map(Number)
  const next = new Date(year!, month! - 1 + delta, 1)
  const mm = String(next.getMonth() + 1).padStart(2, '0')
  return `${next.getFullYear()}-${mm}-01`
}

export function monthLabel(date: string): string {
  return date.slice(0, 7)
}

export function tokensByDate(days: readonly DayRow[]): Map<string, number> {
  return new Map(days.map(day => [day.date, day.tokens]))
}

export function heatLevel(tokens: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (tokens <= 0 || max <= 0) return 0
  const ratio = tokens / max
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

/** Sunday-first month grid including leading/trailing days. */
export function monthGrid(cursor: string, days: readonly DayRow[]): MonthGrid {
  const year = Number(cursor.slice(0, 4))
  const month = Number(cursor.slice(5, 7))
  const first = new Date(year, month - 1, 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  const byDate = tokensByDate(days)
  const monthPrefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  const inMonthTokens = days.filter(day => day.date.startsWith(monthPrefix)).map(day => day.tokens)
  const max = inMonthTokens.reduce((highest, tokens) => Math.max(highest, tokens), 0)
  const cells: HeatmapCell[] = []
  for (let index = 0; index < 42; index += 1) {
    const current = new Date(start)
    current.setDate(start.getDate() + index)
    const date = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
    const tokens = byDate.get(date) ?? 0
    cells.push({
      date,
      tokens,
      level: heatLevel(tokens, max),
      inMonth: current.getMonth() === month - 1,
    })
  }
  return { year, month, label: monthPrefix, cells }
}

export async function fetchJson<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(path, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json() as { ok?: boolean; error?: string } & T
  if (body.ok === false) throw new Error(body.error ?? 'request-failed')
  return body
}

export async function loadUsagePanel(fetchImpl: typeof fetch = fetch): Promise<UsagePanelData> {
  const [summary, balances, subscriptions] = await Promise.all([
    fetchJson<UsageRender & { ok: true }>('/api/wha1echai-usage/summary', fetchImpl),
    fetchJson<{ ok: true; balances: BalanceCard[] }>('/api/wha1echai-usage/balances', fetchImpl),
    fetchJson<{ ok: true; subscriptions: SubscriptionCard[] }>('/api/wha1echai-usage/subscriptions', fetchImpl),
  ])
  return { summary, balances: balances.balances, subscriptions: subscriptions.subscriptions }
}

export async function loadDay(date: string, fetchImpl: typeof fetch = fetch): Promise<DayDetail> {
  return fetchJson<DayDetail & { ok: true }>(`/api/wha1echai-usage/day?date=${date}`, fetchImpl)
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

/** Shorten a session id for a 300px panel; the full id stays on the row title. */
export function formatSessionId(id: string): string {
  const prefixed = /^session-([0-9a-f]{8})/i.exec(id)
  if (prefixed !== null) return `session-${prefixed[1]}`
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id.slice(0, 8)
  if (id.length > 18) return `${id.slice(0, 8)}…`
  return id
}
