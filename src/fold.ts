/** Token buckets folded from one usage sample. */
export interface TokenBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Loose session-log event used by the incremental fold. */
export interface FoldEvent {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: {
    readonly turn?: number
    readonly step?: number
    readonly usage?: Partial<TokenBuckets>
    readonly chunk?: { readonly type?: string; readonly usage?: Partial<TokenBuckets> }
    readonly message?: { readonly source?: { readonly model?: string; readonly provider?: string } }
    readonly header?: { readonly config?: { readonly model?: string; readonly provider?: string } }
  }
}

export interface DayEntry {
  totals: TokenBuckets
  models: Map<string, TokenBuckets>
}

export interface LastSample {
  key: string
  day: string
  model: string
  buckets: TokenBuckets
}

export interface UsageState {
  kind: 'live' | 'persisted'
  days: Map<string, DayEntry>
  lastSample: LastSample | null
  currentModel: string | null
  consumed: number
  revision?: string
}

export interface ModelRow extends TokenBuckets {
  readonly model: string
  readonly tokens: number
  readonly cacheHitRate: number | null
}

export interface DayRow extends TokenBuckets {
  readonly date: string
  readonly tokens: number
  readonly cacheHitRate: number | null
  readonly models: readonly ModelRow[]
}

export interface UsageRender {
  readonly days: readonly DayRow[]
  readonly total: TokenBuckets & { readonly tokens: number; readonly cacheHitRate: number | null }
  readonly updatedAt: number
}

export interface SessionDayRow extends TokenBuckets {
  readonly id: string
  readonly title?: string
  readonly tokens: number
  readonly models: readonly ModelRow[]
}

export interface DayDetail {
  readonly date: string
  readonly totals: TokenBuckets & { readonly tokens: number; readonly cacheHitRate: number | null }
  readonly models: readonly ModelRow[]
  readonly sessions: readonly SessionDayRow[]
}

/** Local-calendar `YYYY-MM-DD` for a millisecond epoch. */
export function dayKey(timeMs: number): string {
  const date = new Date(timeMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Empty token bucket. */
export function zeroBuckets(): TokenBuckets {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** Provider usage → buckets. Missing cache fields stay 0. */
export function bucketsOf(usage: Partial<TokenBuckets> | undefined): TokenBuckets {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
  }
}

/** Sum of every bucket. */
export function totalTokens(buckets: TokenBuckets): number {
  return buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** Prompt-side cache hit rate in percent, or null when no prompt tokens. */
export function cacheHitRate(buckets: TokenBuckets): number | null {
  const promptTokens = buckets.inputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  if (promptTokens <= 0) return null
  return Math.round((buckets.cacheReadTokens / promptTokens) * 1000) / 10
}

function addInto(target: TokenBuckets, source: TokenBuckets): TokenBuckets {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
  return target
}

function subtractFrom(target: TokenBuckets, source: TokenBuckets): TokenBuckets {
  target.inputTokens -= source.inputTokens
  target.outputTokens -= source.outputTokens
  target.cacheReadTokens -= source.cacheReadTokens
  target.cacheWriteTokens -= source.cacheWriteTokens
  return target
}

function sampleOf(event: FoldEvent): { key: string; usage: Partial<TokenBuckets> } | undefined {
  if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage !== undefined) {
    return { key: `${event.data.turn ?? 0}:${event.data.step ?? 0}`, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
    return { key: `${event.data.turn ?? 0}:${event.data.step ?? 0}`, usage: event.data.usage }
  }
  return undefined
}

function modelOf(event: FoldEvent): string | undefined {
  const source = event.data?.message?.source
  if (source !== undefined && typeof source.model === 'string') {
    return `${typeof source.provider === 'string' && source.provider.length > 0 ? source.provider : 'unknown'}/${source.model}`
  }
  const config = event.data?.header?.config
  if (config !== undefined && typeof config.model === 'string') {
    return `${typeof config.provider === 'string' && config.provider.length > 0 ? config.provider : 'unknown'}/${config.model}`
  }
  return undefined
}

function entryOf(byDay: Map<string, DayEntry>, day: string): DayEntry {
  let entry = byDay.get(day)
  if (entry === undefined) {
    entry = { totals: zeroBuckets(), models: new Map() }
    byDay.set(day, entry)
  }
  return entry
}

function modelRows(models: Map<string, TokenBuckets>): ModelRow[] {
  return [...models.entries()]
    .map(([model, buckets]) => ({
      model,
      ...buckets,
      tokens: totalTokens(buckets),
      cacheHitRate: cacheHitRate(buckets),
    }))
    .sort((left, right) => right.tokens - left.tokens)
}

/** Empty incremental fold state. */
export function createUsageState(kind: UsageState['kind'] = 'persisted'): UsageState {
  return { kind, days: new Map(), lastSample: null, currentModel: null, consumed: 0 }
}

/** Fold a slice of new events onto session state (mutating). */
export function applyUsageDelta(state: UsageState, events: readonly FoldEvent[]): void {
  let last = state.lastSample
  let currentModel = state.currentModel
  for (const event of events) {
    if (event.type === 'request/header') {
      const model = modelOf(event)
      if (model !== undefined) currentModel = model
    }
    const sample = sampleOf(event)
    if (sample === undefined) continue
    const buckets = bucketsOf(sample.usage)
    const model = modelOf(event) ?? currentModel ?? 'unknown/unknown'
    const day = dayKey(typeof event.time === 'number' ? event.time : 0)
    const entry = entryOf(state.days, day)
    if (last !== null && last.key === sample.key) {
      const previous = state.days.get(last.day)
      if (previous !== undefined) {
        subtractFrom(previous.totals, last.buckets)
        const previousModel = previous.models.get(last.model)
        if (previousModel !== undefined) subtractFrom(previousModel, last.buckets)
      }
    }
    addInto(entry.totals, buckets)
    let modelBucket = entry.models.get(model)
    if (modelBucket === undefined) {
      modelBucket = zeroBuckets()
      entry.models.set(model, modelBucket)
    }
    addInto(modelBucket, buckets)
    last = { key: sample.key, day, model, buckets }
  }
  state.lastSample = last
  state.currentModel = currentModel
}

/** Fold one session from scratch. */
export function foldUsage(events: readonly FoldEvent[]): Map<string, DayEntry> {
  const state = createUsageState()
  applyUsageDelta(state, events)
  return state.days
}

/** Merge one session's days into a global map. */
export function mergeInto(byDay: Map<string, DayEntry>, sessionDays: Map<string, DayEntry>): void {
  for (const [day, entry] of sessionDays) {
    const target = entryOf(byDay, day)
    addInto(target.totals, entry.totals)
    for (const [model, buckets] of entry.models) {
      let modelBucket = target.models.get(model)
      if (modelBucket === undefined) {
        modelBucket = zeroBuckets()
        target.models.set(model, modelBucket)
      }
      addInto(modelBucket, buckets)
    }
  }
}

/** Wire shape for GET /summary. */
export function renderUsage(byDay: Map<string, DayEntry>, updatedAt: number): UsageRender {
  const days = [...byDay.entries()]
    .map(([date, entry]) => ({
      date,
      ...entry.totals,
      tokens: totalTokens(entry.totals),
      cacheHitRate: cacheHitRate(entry.totals),
      models: modelRows(entry.models),
    }))
    .sort((left, right) => left.date.localeCompare(right.date))
  const total = zeroBuckets()
  for (const [, entry] of byDay) addInto(total, entry.totals)
  return {
    days,
    total: { ...total, tokens: totalTokens(total), cacheHitRate: cacheHitRate(total) },
    updatedAt,
  }
}

/** One calendar day with per-session rows. */
export function renderDayDetail(
  date: string,
  sessions: ReadonlyArray<{ readonly id: string; readonly days: Map<string, DayEntry> }>,
): DayDetail {
  const byDay = new Map<string, DayEntry>()
  const rows: SessionDayRow[] = []
  for (const session of sessions) {
    const entry = session.days.get(date)
    if (entry === undefined) continue
    rows.push({
      id: session.id,
      ...entry.totals,
      tokens: totalTokens(entry.totals),
      models: modelRows(entry.models),
    })
    mergeInto(byDay, new Map([[date, entry]]))
  }
  const totals = byDay.get(date)?.totals ?? zeroBuckets()
  return {
    date,
    totals: { ...totals, tokens: totalTokens(totals), cacheHitRate: cacheHitRate(totals) },
    models: modelRows(byDay.get(date)?.models ?? new Map()),
    sessions: rows.sort((left, right) => right.tokens - left.tokens),
  }
}

/** Reset fold buckets while keeping the object identity. */
export function resetUsageState(state: UsageState): void {
  state.days = new Map()
  state.lastSample = null
  state.currentModel = null
  state.consumed = 0
  delete state.revision
}
