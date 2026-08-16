import type { BalanceCard } from '../balances.js'
import { cacheHitRate, totalTokens, zeroBuckets } from '../fold.js'
import type { DayDetail, DayRow, TokenBuckets, UsageRender } from '../fold.js'
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

/** Cards with no credential or no public balance API stay off the panel. */
export function visibleAccountCards<T extends { readonly status: string }>(cards: readonly T[]): T[] {
  return cards.filter(card => card.status === 'ok' || card.status === 'error')
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

/** Shorten a session id for the 32rem panel; the full id stays on the row title. */
export function formatSessionId(id: string): string {
  const prefixed = /^session-([0-9a-f]{8})/i.exec(id)
  if (prefixed !== null) return `session-${prefixed[1]}`
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id.slice(0, 8)
  if (id.length > 18) return `${id.slice(0, 8)}…`
  return id
}

export interface PeriodTotals {
  readonly today: TokenBuckets & { readonly tokens: number; readonly cacheHitRate: number | null }
  readonly month: TokenBuckets & { readonly tokens: number; readonly cacheHitRate: number | null }
  readonly all: TokenBuckets & { readonly tokens: number; readonly cacheHitRate: number | null }
}

export interface ProviderTotal {
  readonly provider: string
  readonly tokens: number
}

function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const parsed = new Date(year, month - 1, day)
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
}

function addBuckets(target: TokenBuckets, source: TokenBuckets): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
}

function withTotals(buckets: TokenBuckets): TokenBuckets & { tokens: number; cacheHitRate: number | null } {
  return { ...buckets, tokens: totalTokens(buckets), cacheHitRate: cacheHitRate(buckets) }
}

/** `/` and `/today` → undefined (caller uses today). `/YYYY-MM-DD` → that date. Anything else → null (invalid). */
export function dateFromPath(appPath: string): string | undefined | null {
  if (appPath === '/' || appPath === '/today') return undefined
  if (appPath.startsWith('/') && isCalendarDate(appPath.slice(1))) return appPath.slice(1)
  return null
}

/** Always `/YYYY-MM-DD`. */
export function pathFromDate(date: string): string {
  return `/${date}`
}

/** Local calendar YYYY-MM-DD. Accept optional `now` for tests. */
export function todayKey(now?: number): string {
  const date = now === undefined ? new Date() : new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function monthPrefix(date: string): string {
  return date.slice(0, 7)
}

/** Sum days for today / current month / all. `now` optional. */
export function periodTotals(days: readonly DayRow[], now?: number): PeriodTotals {
  const today = todayKey(now)
  const month = monthPrefix(today)
  const todayBuckets = zeroBuckets()
  const monthBuckets = zeroBuckets()
  const allBuckets = zeroBuckets()
  for (const day of days) {
    addBuckets(allBuckets, day)
    if (day.date.startsWith(month)) addBuckets(monthBuckets, day)
    if (day.date === today) addBuckets(todayBuckets, day)
  }
  return {
    today: withTotals(todayBuckets),
    month: withTotals(monthBuckets),
    all: withTotals(allBuckets),
  }
}

/** First path segment of `provider/model`. `unknown` if missing. */
export function providerKey(model: string): string {
  const slash = model.indexOf('/')
  if (slash <= 0) return 'unknown'
  return model.slice(0, slash)
}

export function tokensByProvider(days: readonly DayRow[]): ProviderTotal[] {
  const totals = new Map<string, number>()
  for (const day of days) {
    for (const model of day.models) {
      const provider = providerKey(model.model)
      totals.set(provider, (totals.get(provider) ?? 0) + model.tokens)
    }
  }
  return [...totals.entries()]
    .map(([provider, tokens]) => ({ provider, tokens }))
    .sort((left, right) => right.tokens - left.tokens)
}

export function filterDaysByProvider(days: readonly DayRow[], provider: string): DayRow[] {
  if (provider === 'all') return days as DayRow[]
  const filtered: DayRow[] = []
  for (const day of days) {
    const models = day.models.filter(model => providerKey(model.model) === provider)
    if (models.length === 0) continue
    const buckets = zeroBuckets()
    for (const model of models) addBuckets(buckets, model)
    filtered.push({ date: day.date, ...withTotals(buckets), models })
  }
  return filtered
}

export function formatBucketSummary(
  buckets: TokenBuckets,
  labels: { input: string; output: string; cacheRead: string; cacheWrite: string },
): string {
  return `${labels.input} ${formatTokens(buckets.inputTokens)} · ${labels.output} ${formatTokens(buckets.outputTokens)} · ${labels.cacheRead} ${formatTokens(buckets.cacheReadTokens)} · ${labels.cacheWrite} ${formatTokens(buckets.cacheWriteTokens)}`
}

/** Local `YYYY-MM-DD HH:mm` from ISO; if invalid, return the original string. */
export function formatResetAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`
}
