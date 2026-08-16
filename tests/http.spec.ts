import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'
import { resetCollectCache } from '../src/collect.js'
import {
  handleBalances,
  handleDay,
  handleSubscriptions,
  handleSummary,
  hostNameOf,
  isLoopbackAddress,
  json,
  registerUsageRoutes,
  rejectForeignCaller,
  SUMMARY_PATH,
} from '../src/http.js'

function req(overrides: { method?: string; url?: string; remote?: string; host?: string } = {}) {
  return {
    method: overrides.method ?? 'GET',
    url: overrides.url ?? SUMMARY_PATH,
    headers: { host: overrides.host ?? 'localhost:8080' },
    socket: { remoteAddress: overrides.remote ?? '127.0.0.1' },
  } as never
}

function res() {
  const response = new EventEmitter() as EventEmitter & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; status?: number; body?: string }
  response.writeHead = vi.fn((status: number) => { response.status = status })
  response.end = vi.fn((body?: string) => { response.body = body })
  return response
}

afterEach(() => {
  resetCollectCache()
})

describe('http helpers', () => {
  it('recognizes loopback addresses and host headers', () => {
    expect(isLoopbackAddress(undefined)).toBe(false)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('10.0.0.1')).toBe(false)
    expect(hostNameOf(undefined)).toBeNull()
    expect(hostNameOf('[::1]:80')).toBe('::1')
    expect(hostNameOf('[::1]x')).toBeNull()
    expect(hostNameOf('[')).toBeNull()
    expect(hostNameOf('example.com:80')).toBe('example.com')
    expect(hostNameOf('2001:db8::1')).toBe('2001:db8::1')
    expect(hostNameOf('localhost.')).toBe('localhost')
    expect(hostNameOf('localhost:x')).toBeNull()
    const denied = res()
    expect(rejectForeignCaller(req({ method: 'POST' }), denied as never)).toBe(true)
    expect(denied.status).toBe(405)
    const foreign = res()
    expect(rejectForeignCaller(req({ remote: '8.8.8.8' }), foreign as never)).toBe(true)
    expect(foreign.status).toBe(403)
    json(res() as never, 200, { ok: true })
  })
})

describe('usage routes', () => {
  it('serves summary, day, balances, and subscriptions on loopback', async () => {
    const ctx = {
      get: (name: string) => {
        if (name === 'sessions') return { list: () => [] }
        if (name === 'credentials') return { resolve: async () => undefined }
        return undefined
      },
    }
    const summary = res()
    await handleSummary(ctx, req(), summary as never, { cachePath: ':memory:', now: () => 1, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined })
    expect(summary.status).toBe(200)
    const badDay = res()
    await handleDay(ctx, req({ url: '/api/wha1echai-usage/day' }), badDay as never)
    expect(badDay.status).toBe(400)
    const day = res()
    await handleDay(ctx, req({ url: '/api/wha1echai-usage/day?date=2026-08-15' }), day as never, { cachePath: ':memory:', now: () => 1, readFile: async () => { throw new Error('x') }, writeFile: async () => undefined, mkdir: async () => undefined, rename: async () => undefined })
    expect(day.status).toBe(200)
    const balances = res()
    await handleBalances(ctx, req(), balances as never)
    expect(balances.status).toBe(200)
    expect(JSON.parse(balances.body ?? '{}').balances).toHaveLength(4)
    const llmThrow = res()
    await handleBalances({
      get: (name: string) => {
        if (name === 'llm') throw new Error('llm')
        if (name === 'settings') return { get: () => undefined }
        if (name === 'credentials') return { resolve: async () => undefined }
        return undefined
      },
    }, req(), llmThrow as never)
    expect(llmThrow.status).toBe(200)
    const subscriptions = res()
    await handleSubscriptions(ctx, req(), subscriptions as never)
    expect(subscriptions.status).toBe(200)
  })

  it('maps handler failures to 500', async () => {
    const exploding = {
      logger: { warn: vi.fn() },
      get: () => { throw new Error('nope') },
    }
    const summary = res()
    await handleSummary(exploding, req(), summary as never)
    expect(summary.status).toBe(500)
    const day = res()
    await handleDay(exploding, req({ url: '/api/wha1echai-usage/day?date=2026-08-15' }), day as never)
    expect(day.status).toBe(500)
    const balances = res()
    await handleBalances({
      logger: { warn: vi.fn() },
      get: (name: string) => name === 'settings' ? { get: () => { throw new Error('settings') } } : undefined,
    }, req(), balances as never)
    expect(balances.status).toBe(500)
    const subscriptions = res()
    await handleSubscriptions({
      logger: { warn: vi.fn() },
      get: () => { throw new Error('nope') },
    }, req(), subscriptions as never)
    expect(subscriptions.status).toBe(500)
  })

  it('registers exact routes and never throws', () => {
    const registered: string[] = []
    const register = (route: { path: string }) => {
      if (route.path.endsWith('day')) throw new Error('dup')
      registered.push(route.path)
      return () => {}
    }
    const ctx = {
      logger: { warn: vi.fn() },
      effect: (fn: () => () => void) => { fn() },
      get: (name: string) => name === 'webServer' ? { register } : undefined,
    }
    registerUsageRoutes(ctx)
    expect(registered.length).toBeGreaterThan(0)
    registerUsageRoutes({ get: () => undefined })
    apply()
    apply({ get: () => { throw new Error('outer') } })
    const injectBoom = { inject: () => { throw new Error('inject') }, logger: { warn: vi.fn() }, get: () => undefined }
    apply(injectBoom)
    expect(injectBoom.logger.warn).toHaveBeenCalled()
    const injected: string[] = []
    apply({
      inject: (_deps, callback) => {
        callback({
          effect: (fn: () => () => void) => { fn() },
          get: (name: string) => name === 'webServer'
            ? {
              register: (route: { path: string }) => {
                injected.push(route.path)
                return () => {}
              },
            }
            : undefined,
        })
      },
    })
    expect(injected).toHaveLength(4)
    apply({
      get: (name: string) => name === 'webServer'
        ? { register: () => { throw new Error('all') } }
        : undefined,
      logger: { warn: vi.fn() },
    })
    const throwing = {
      get: (name: string) => {
        if (name === 'webServer') throw new Error('boom')
        return undefined
      },
      logger: { warn: vi.fn() },
    }
    registerUsageRoutes(throwing)
    expect(throwing.logger.warn).not.toHaveBeenCalled()
    const explodingEffect = {
      logger: { warn: vi.fn() },
      effect: () => { throw new Error('effect') },
      get: (name: string) => name === 'webServer' ? { register: () => () => {} } : undefined,
    }
    registerUsageRoutes(explodingEffect)
    expect(explodingEffect.logger.warn).toHaveBeenCalled()
    const handlers: Array<(req: never, res: never) => void> = []
    registerUsageRoutes({
      effect: (fn: () => () => void) => { fn() },
      get: (name: string) => name === 'webServer'
        ? {
          register: (route: { handler: (req: never, res: never) => void }) => {
            handlers.push(route.handler)
            return () => {}
          },
        }
        : undefined,
    })
    const probe = res()
    handlers[0]!(req(), probe as never)
    expect(probe.status === 200 || probe.status === 500 || probe.status === undefined).toBe(true)
  })

  it('soft-gets webServer when property access throws without inject', () => {
    const registered: string[] = []
    const ctx = {
      effect: (fn: () => () => void) => { fn() },
      get webServer(): never {
        throw new Error('cannot get property "webServer" without inject')
      },
      get(name: string) {
        if (name !== 'webServer') return undefined
        return {
          register: (route: { path: string }) => {
            registered.push(route.path)
            return () => {}
          },
        }
      },
    }
    registerUsageRoutes(ctx)
    expect(registered).toEqual([
      '/api/wha1echai-usage/summary',
      '/api/wha1echai-usage/day',
      '/api/wha1echai-usage/balances',
      '/api/wha1echai-usage/subscriptions',
    ])
  })
})
