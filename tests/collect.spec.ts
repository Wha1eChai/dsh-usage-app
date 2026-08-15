import { afterEach, describe, expect, it } from 'vitest'
import { cachePath, collectDay, collectUsage, loadCache, resetCollectCache, saveCache } from '../src/collect.js'

const day = Date.parse('2026-08-15T00:00:00Z')

function usageEvent(seq: number, tokens: number) {
  return {
    type: 'assistant/message',
    seq,
    time: day,
    data: { turn: 1, step: seq, usage: { inputTokens: tokens }, message: { source: { model: 'v3', provider: 'deepseek' } } },
  }
}

afterEach(() => {
  resetCollectCache()
})

describe('collect', () => {
  it('folds live sessions incrementally and drops vanished ones', async () => {
    const memory = new Map<string, string>()
    const deps = {
      cachePath: '/tmp/wha1echai-usage-cache.json',
      now: () => 1,
      readFile: async (path: string) => {
        const hit = memory.get(String(path))
        if (hit === undefined) throw new Error('missing')
        return hit
      },
      writeFile: async (path: string, body: string) => { memory.set(String(path), String(body)) },
      mkdir: async () => undefined,
      rename: async (from: string, to: string) => {
        const value = memory.get(String(from))
        if (value !== undefined) {
          memory.set(String(to), value)
          memory.delete(String(from))
        }
      },
    }
    const live = {
      list: () => [{ id: 'live-1', events: [usageEvent(1, 4), usageEvent(2, 6)] }],
    }
    const first = await collectUsage({ get: name => name === 'sessions' ? live : undefined }, deps)
    expect(first.total.tokens).toBe(10)
    live.list = () => [{ id: 'live-1', events: [usageEvent(1, 4), usageEvent(2, 6), usageEvent(3, 1)] }]
    const second = await collectUsage({ get: name => name === 'sessions' ? live : undefined }, deps)
    expect(second.total.tokens).toBe(11)
    const empty = await collectUsage({ get: () => undefined }, deps)
    expect(empty.days).toEqual([])
  })

  it('uses snapshots, refolds gaps, and falls back when listSnapshots fails', async () => {
    const warns: string[] = []
    const persistence = {
      listSnapshots: async () => [{ header: { id: 'p1' }, revision: 'r1' }],
      list: async () => [{ id: 'p1' }],
      readFrom: async (_id: string, fromSeq: number) => ({
        events: fromSeq > 1 ? [usageEvent(9, 1)] : [usageEvent(1, 2), usageEvent(2, 3)],
      }),
    }
    const ctx = {
      logger: { warn: (message: string) => { warns.push(message) } },
      get: (name: string) => name === 'sessionPersistence' ? persistence : undefined,
    }
    const first = await collectUsage(ctx, { cachePath: ':memory:', now: () => 1, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined })
    expect(first.total.tokens).toBe(5)
    persistence.listSnapshots = async () => [{ header: { id: 'p1' }, revision: 'r2' }]
    const gapped = await collectUsage(ctx, { cachePath: ':memory:', now: () => 2, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined })
    expect(gapped.total.tokens).toBe(5)
    persistence.listSnapshots = async () => { throw new Error('snap') }
    persistence.readFrom = async () => { throw new Error('read') }
    await collectUsage(ctx, { cachePath: ':memory:', now: () => 3, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined })
    expect(warns.some(message => message.includes('listSnapshots'))).toBe(true)
    expect(warns.some(message => message.includes('reading persisted'))).toBe(true)
  })

  it('refolds when a persisted session becomes live and shares in-flight collects', async () => {
    const persistence = {
      list: async () => [{ id: 'swap' }],
      readFrom: async () => ({ events: [usageEvent(1, 2)] }),
    }
    await collectUsage({
      get: name => name === 'sessionPersistence' ? persistence : undefined,
    }, { cachePath: ':memory:', now: () => 1, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined })
    const live = { list: () => [{ id: 'swap', events: [usageEvent(1, 2), usageEvent(2, 8)] }] }
    const ctx = { get: (name: string) => name === 'sessions' ? live : name === 'sessionPersistence' ? persistence : undefined }
    const deps = { cachePath: ':memory:', now: () => 2, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined }
    const [left, right] = await Promise.all([collectUsage(ctx, deps), collectUsage(ctx, deps)])
    expect(left.total.tokens).toBe(right.total.tokens)
    const detail = await collectDay(ctx, left.days[0]!.date, deps)
    expect(detail.sessions[0]?.id).toBe('swap')
  })

  it('loads a valid cache, ignores a bad one, and warns when save fails', async () => {
    const valid = JSON.stringify({
      version: 1,
      sessions: {
        s1: {
          kind: 'persisted',
          consumed: 1,
          revision: 'r',
          days: { '2026-08-15': { totals: { inputTokens: 1 }, models: { 'deepseek/v3': { inputTokens: 1 } } } },
          lastSample: { key: '1:1', day: '2026-08-15', buckets: { inputTokens: 1 } },
          currentModel: 'deepseek/v3',
        },
        '': { kind: 'live' },
      },
    })
    const loaded = await loadCache({ cachePath: 'ok.json', readFile: async () => valid })
    expect(loaded.sessions.s1?.consumed).toBe(1)
    resetCollectCache()
    const fresh = await loadCache({ cachePath: 'bad.json', readFile: async () => '{"version":2}' })
    expect(fresh.sessions).toEqual({})
    const warns: string[] = []
    await saveCache({ logger: { warn: message => { warns.push(message) } } }, { version: 1, sessions: loaded.sessions }, {
      cachePath: 'x.json',
      mkdir: async () => { throw new Error('disk') },
    })
    expect(warns[0]).toMatch(/saving usage cache failed/)
    const listed = { list: () => { throw new Error('live-down') } }
    const warns2: string[] = []
    await collectUsage({
      logger: { warn: message => { warns2.push(message) } },
      get: name => name === 'sessions' ? listed : undefined,
    }, { cachePath: ':memory:', now: () => 1, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined })
    expect(warns2.some(message => message.includes('sessions.list'))).toBe(true)
  })

  it('parses messy cache rows without throwing', async () => {
    const raw = JSON.stringify({
      version: 1,
      sessions: {
        messy: {
          kind: 'nope',
          consumed: 'x',
          days: { skip: null, '2026-08-01': { totals: { inputTokens: 'x' }, models: { a: null, b: { outputTokens: 2 } } } },
          lastSample: { key: 'k', day: '2026-08-01', model: 1, buckets: { outputTokens: 2 } },
        },
      },
    })
    const loaded = await loadCache({ cachePath: 'messy.json', readFile: async () => raw })
    expect(loaded.sessions.messy?.days.get('2026-08-01')?.models.get('b')?.outputTokens).toBe(2)
    resetCollectCache()
    const extras = JSON.stringify({
      version: 1,
      sessions: {
        live: { kind: 'live', days: 1, lastSample: 'x' },
        none: null,
        partial: { lastSample: { key: 'only' }, days: { '2026-08-02': { totals: null, models: { c: { cacheReadTokens: 1, cacheWriteTokens: 1 } } } } },
      },
    })
    const parsed = await loadCache({ cachePath: 'extra.json', readFile: async () => extras })
    expect(parsed.sessions.live?.kind).toBe('live')
    expect(parsed.sessions.partial?.lastSample).toBeNull()
    expect(cachePath()).toMatch(/wha1echai-usage-cache\.json$/)
  })

  it('skips unchanged revisions and applies a contiguous tail', async () => {
    let reads = 0
    const persistence = {
      listSnapshots: async () => [{ header: { id: 'p2' }, revision: 'same' }],
      list: async () => [{ id: 'p2' }],
      readFrom: async (_id: string, fromSeq: number) => {
        reads += 1
        if (fromSeq === 0) return { events: [usageEvent(1, 2), usageEvent(2, 3)] }
        return { events: [usageEvent(3, 4)] }
      },
    }
    const ctx = { get: (name: string) => name === 'sessionPersistence' ? persistence : undefined }
    const deps = { cachePath: ':memory-rev:', now: () => 1, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined }
    await collectUsage(ctx, deps)
    const before = reads
    await collectUsage(ctx, deps)
    expect(reads).toBe(before)
    persistence.listSnapshots = async () => [{ header: { id: 'p2' }, revision: 'next' }]
    const next = await collectUsage(ctx, deps)
    expect(next.total.tokens).toBe(9)
  })

  it('folds events without seq and uses Date.now when now is omitted', async () => {
    const persistence = {
      list: async () => [{ id: 'noseq' }],
      readFrom: async () => ({
        events: [{
          type: 'assistant/message',
          seq: 1,
          time: day,
          data: { usage: { inputTokens: 2 }, message: { source: { model: 'v3' } } },
        }],
      }),
    }
    const result = await collectUsage({
      get: name => name === 'sessionPersistence' ? persistence : undefined,
    }, { cachePath: ':memory-now:', readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined })
    expect(result.total.tokens).toBe(2)
    expect(result.updatedAt).toBeGreaterThan(0)
  })
})
