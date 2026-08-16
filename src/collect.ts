import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import {
  applyUsageDelta,
  createUsageState,
  mergeInto,
  renderDayDetail,
  renderUsage,
  resetUsageState,
  type DayDetail,
  type FoldEvent,
  type LastSample,
  type TokenBuckets,
  type UsageRender,
  type UsageState,
} from './fold.js'

export interface LiveSession {
  readonly id: string
  readonly events: readonly FoldEvent[]
}

export interface PersistenceFace {
  list(): Promise<ReadonlyArray<{ readonly id: string }>>
  listSnapshots?(): Promise<ReadonlyArray<{ readonly header: { readonly id: string }; readonly revision: string }>>
  readFrom(id: string, fromSeq: number): Promise<{ events: readonly FoldEvent[] }>
}

export interface CollectContext {
  get?(name: string): unknown
  logger?: { warn(message: string): void }
}

export interface CollectDeps {
  readonly cachePath?: string
  readonly now?: () => number
  readonly readFile?: typeof readFile
  readonly writeFile?: typeof writeFile
  readonly mkdir?: typeof mkdir
  readonly rename?: typeof rename
}

export interface UsageCache {
  version: number
  sessions: Record<string, UsageState>
}

const CACHE_VERSION = 1

let loadedCache: UsageCache | null = null
let loadPromise: Promise<UsageCache> | null = null
let inflight: Promise<UsageRender> | null = null

function warn(ctx: CollectContext, message: string): void {
  ctx.logger?.warn(message)
}

export function cachePath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'dshapps-usage-cache.json')
}

function serializeSession(state: UsageState): Record<string, unknown> {
  const days: Record<string, { totals: TokenBuckets; models: Record<string, TokenBuckets> }> = {}
  for (const [date, entry] of state.days) {
    const models: Record<string, TokenBuckets> = {}
    for (const [model, buckets] of entry.models) models[model] = { ...buckets }
    days[date] = { totals: { ...entry.totals }, models }
  }
  return {
    kind: state.kind,
    consumed: state.consumed,
    ...(state.revision === undefined ? {} : { revision: state.revision }),
    days,
    lastSample: state.lastSample === null
      ? null
      : { key: state.lastSample.key, day: state.lastSample.day, model: state.lastSample.model, buckets: { ...state.lastSample.buckets } },
    currentModel: state.currentModel,
  }
}

function parseSession(raw: unknown): UsageState {
  const state = createUsageState()
  if (raw === null || typeof raw !== 'object') return state
  const record = raw as Record<string, unknown>
  state.kind = record.kind === 'live' ? 'live' : 'persisted'
  state.consumed = Number.isSafeInteger(record.consumed) ? record.consumed as number : 0
  if (typeof record.revision === 'string') state.revision = record.revision
  if (record.days !== null && typeof record.days === 'object') {
    for (const [date, entry] of Object.entries(record.days as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object') continue
      const row = entry as { totals?: Partial<TokenBuckets>; models?: Record<string, Partial<TokenBuckets>> }
      const target = { totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, models: new Map<string, TokenBuckets>() }
      const totals = row.totals
      if (totals !== null && typeof totals === 'object') {
        target.totals.inputTokens = Number.isFinite(totals.inputTokens) ? totals.inputTokens as number : 0
        target.totals.outputTokens = Number.isFinite(totals.outputTokens) ? totals.outputTokens as number : 0
        target.totals.cacheReadTokens = Number.isFinite(totals.cacheReadTokens) ? totals.cacheReadTokens as number : 0
        target.totals.cacheWriteTokens = Number.isFinite(totals.cacheWriteTokens) ? totals.cacheWriteTokens as number : 0
      }
      if (row.models !== null && typeof row.models === 'object') {
        for (const [model, buckets] of Object.entries(row.models)) {
          if (buckets === null || typeof buckets !== 'object') continue
          target.models.set(model, {
            inputTokens: Number.isFinite(buckets.inputTokens) ? buckets.inputTokens as number : 0,
            outputTokens: Number.isFinite(buckets.outputTokens) ? buckets.outputTokens as number : 0,
            cacheReadTokens: Number.isFinite(buckets.cacheReadTokens) ? buckets.cacheReadTokens as number : 0,
            cacheWriteTokens: Number.isFinite(buckets.cacheWriteTokens) ? buckets.cacheWriteTokens as number : 0,
          })
        }
      }
      state.days.set(date, target)
    }
  }
  const sample = record.lastSample
  if (sample !== null && sample !== undefined && typeof sample === 'object') {
    const last = sample as LastSample
    if (typeof last.key === 'string' && typeof last.day === 'string') {
      const buckets = last.buckets ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      state.lastSample = {
        key: last.key,
        day: last.day,
        model: typeof last.model === 'string' ? last.model : 'unknown',
        buckets: {
          inputTokens: Number.isFinite(buckets.inputTokens) ? buckets.inputTokens : 0,
          outputTokens: Number.isFinite(buckets.outputTokens) ? buckets.outputTokens : 0,
          cacheReadTokens: Number.isFinite(buckets.cacheReadTokens) ? buckets.cacheReadTokens : 0,
          cacheWriteTokens: Number.isFinite(buckets.cacheWriteTokens) ? buckets.cacheWriteTokens : 0,
        },
      }
    }
  }
  if (typeof record.currentModel === 'string') state.currentModel = record.currentModel
  return state
}

export function resetCollectCache(): void {
  loadedCache = null
  loadPromise = null
  inflight = null
}

export async function loadCache(deps: CollectDeps = {}): Promise<UsageCache> {
  if (loadedCache !== null) return loadedCache
  loadPromise ??= (async () => {
    const fresh: UsageCache = { version: CACHE_VERSION, sessions: {} }
    try {
      const raw = await (deps.readFile ?? readFile)(deps.cachePath ?? cachePath(), 'utf8')
      const parsed = JSON.parse(raw) as { version?: number; sessions?: Record<string, unknown> }
      if (parsed !== null && typeof parsed === 'object' && parsed.version === CACHE_VERSION && parsed.sessions !== null && typeof parsed.sessions === 'object') {
        const sessions: Record<string, UsageState> = {}
        for (const [id, entry] of Object.entries(parsed.sessions)) {
          if (typeof id === 'string' && id.length > 0) sessions[id] = parseSession(entry)
        }
        return { version: CACHE_VERSION, sessions }
      }
    } catch {
      /* first run or corrupt cache */
    }
    return fresh
  })()
  loadedCache = await loadPromise
  return loadedCache
}

export async function saveCache(ctx: CollectContext, cache: UsageCache, deps: CollectDeps = {}): Promise<void> {
  try {
    const path = deps.cachePath ?? cachePath()
    await (deps.mkdir ?? mkdir)(dirname(path), { recursive: true })
    const serialized: { version: number; sessions: Record<string, unknown> } = { version: CACHE_VERSION, sessions: {} }
    for (const [id, state] of Object.entries(cache.sessions)) serialized.sessions[id] = serializeSession(state)
    const tmp = `${path}.tmp`
    await (deps.writeFile ?? writeFile)(tmp, JSON.stringify(serialized), 'utf8')
    await (deps.rename ?? rename)(tmp, path)
  } catch (error) {
    warn(ctx, `dshapps-usage: saving usage cache failed: ${String(error)}`)
  }
}

function liveSessions(ctx: CollectContext): LiveSession[] {
  const live = ctx.get?.('sessions') as { list?: () => LiveSession[] } | undefined
  if (live === undefined || typeof live.list !== 'function') return []
  try {
    return live.list()
  } catch (error) {
    warn(ctx, `dshapps-usage: sessions.list failed: ${String(error)}`)
    return []
  }
}

function persistenceOf(ctx: CollectContext): PersistenceFace | undefined {
  const persistence = ctx.get?.('sessionPersistence') as PersistenceFace | undefined
  return persistence !== undefined && typeof persistence.list === 'function' && typeof persistence.readFrom === 'function'
    ? persistence
    : undefined
}

async function foldPersisted(ctx: CollectContext, cache: UsageCache, attached: Set<string>): Promise<Set<string>> {
  const persistence = persistenceOf(ctx)
  const persistedIds = new Set<string>()
  if (persistence === undefined) return persistedIds
  let snapshots: Awaited<ReturnType<NonNullable<PersistenceFace['listSnapshots']>>> | null = null
  if (typeof persistence.listSnapshots === 'function') {
    try {
      snapshots = await persistence.listSnapshots()
    } catch (error) {
      warn(ctx, `dshapps-usage: listSnapshots failed, falling back to list(): ${String(error)}`)
    }
  }
  const metas = snapshots !== null ? snapshots.map(entry => entry.header) : await persistence.list()
  const revisionOf = new Map<string, string>()
  if (snapshots !== null) for (const entry of snapshots) revisionOf.set(entry.header.id, entry.revision)
  for (const meta of metas) {
    persistedIds.add(meta.id)
    if (attached.has(meta.id)) continue
    const state = cache.sessions[meta.id] ?? createUsageState()
    const revision = revisionOf.get(meta.id)
    const changed = state.kind !== 'persisted' || (revision !== undefined && revision !== state.revision) || revision === undefined
    if (changed) {
      try {
        const wasPersisted = state.kind === 'persisted'
        const fromSeq = wasPersisted ? state.consumed : 0
        const { events } = await persistence.readFrom(meta.id, fromSeq)
        if (!wasPersisted) resetUsageState(state)
        const fresh = wasPersisted ? events.filter(event => (event.seq ?? 0) > state.consumed) : events
        const contiguous = fresh.length === 0 ? state.consumed === 0 : (fresh[0]?.seq ?? 0) === state.consumed + 1
        if (!contiguous && state.consumed > 0) {
          resetUsageState(state)
          const { events: allEvents } = await persistence.readFrom(meta.id, 0)
          applyUsageDelta(state, allEvents)
          state.consumed = allEvents.length > 0 ? allEvents[allEvents.length - 1]!.seq ?? allEvents.length : 0
        } else if (fresh.length > 0) {
          applyUsageDelta(state, fresh)
          state.consumed = fresh[fresh.length - 1]!.seq ?? state.consumed + fresh.length
        }
        state.kind = 'persisted'
        if (revision !== undefined) state.revision = revision
      } catch (error) {
        warn(ctx, `dshapps-usage: reading persisted session "${meta.id}" failed: ${String(error)}`)
      }
    }
    cache.sessions[meta.id] = state
  }
  return persistedIds
}

/** Incremental collect across live + persisted sessions. */
export async function collectUsage(ctx: CollectContext, deps: CollectDeps = {}): Promise<UsageRender> {
  if (inflight !== null) return inflight
  inflight = (async () => {
    const cache = await loadCache(deps)
    const attached = new Set<string>()
    for (const session of liveSessions(ctx)) {
      attached.add(session.id)
      const state = cache.sessions[session.id] ?? createUsageState('live')
      if (state.kind !== 'live') resetUsageState(state)
      const count = session.events.length
      if (state.consumed < count) {
        applyUsageDelta(state, session.events.slice(state.consumed))
        state.consumed = count
      }
      state.kind = 'live'
      cache.sessions[session.id] = state
    }
    const persistedIds = await foldPersisted(ctx, cache, attached)
    for (const id of Object.keys(cache.sessions)) {
      if (!attached.has(id) && !persistedIds.has(id)) delete cache.sessions[id]
    }
    const byDay = new Map()
    for (const state of Object.values(cache.sessions)) mergeInto(byDay, state.days)
    await saveCache(ctx, cache, deps)
    return renderUsage(byDay, (deps.now ?? Date.now)())
  })().finally(() => {
    inflight = null
  })
  return inflight
}

interface SessionQueryFace {
  readTitleSnapshots?(ids: readonly string[]): Promise<ReadonlyArray<{
    sessionId?: string
    status: string
    value?: { title?: { title?: string } }
  }>>
}

function sessionQueryOf(ctx: CollectContext): SessionQueryFace | undefined {
  try {
    const value = ctx.get?.('sessionQuery') as SessionQueryFace | undefined
    return value !== undefined && typeof value.readTitleSnapshots === 'function' ? value : undefined
  } catch {
    return undefined
  }
}

async function attachSessionTitles(ctx: CollectContext, detail: DayDetail): Promise<DayDetail> {
  const sessionQuery = sessionQueryOf(ctx)
  if (sessionQuery?.readTitleSnapshots === undefined || detail.sessions.length === 0) return detail
  try {
    const results = await sessionQuery.readTitleSnapshots(detail.sessions.map(session => session.id))
    const titles = new Map<string, string>()
    for (const [index, result] of results.entries()) {
      if (result?.status !== 'fulfilled') continue
      const title = result.value?.title?.title
      if (typeof title !== 'string' || title === '') continue
      const id = typeof result.sessionId === 'string' && result.sessionId !== ''
        ? result.sessionId
        : detail.sessions[index]?.id
      if (id !== undefined) titles.set(id, title)
    }
    if (titles.size === 0) return detail
    return {
      ...detail,
      sessions: detail.sessions.map(session => {
        const title = titles.get(session.id)
        return title === undefined ? session : { ...session, title }
      }),
    }
  } catch (error) {
    warn(ctx, `dshapps-usage: readTitleSnapshots failed: ${String(error)}`)
    return detail
  }
}

export async function collectDay(ctx: CollectContext, date: string, deps: CollectDeps = {}): Promise<DayDetail> {
  await collectUsage(ctx, deps)
  const cache = await loadCache(deps)
  const detail = renderDayDetail(date, Object.entries(cache.sessions).map(([id, state]) => ({ id, days: state.days })))
  return attachSessionTitles(ctx, detail)
}
