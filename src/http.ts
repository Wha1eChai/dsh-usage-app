import type { IncomingMessage, ServerResponse } from 'node:http'
import { queryBalances, providersFromHost, type CredentialsFace, type LlmFace } from './balances.js'
import { collectDay, collectUsage, type CollectContext, type CollectDeps } from './collect.js'
import { querySubscriptions } from './subscriptions.js'

export const SUMMARY_PATH = '/api/dshapps-usage/summary'
export const DAY_PATH = '/api/dshapps-usage/day'
export const BALANCES_PATH = '/api/dshapps-usage/balances'
export const SUBSCRIPTIONS_PATH = '/api/dshapps-usage/subscriptions'

export const USAGE_ROUTES = [SUMMARY_PATH, DAY_PATH, BALANCES_PATH, SUBSCRIPTIONS_PATH] as const

export interface WebServerFace {
  register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
}

export interface UsageHostContext extends CollectContext {
  effect?(fn: () => () => void, label?: string): void
  inject?(deps: readonly string[], callback: (ctx: UsageHostContext) => void): void
}

function isWebServer(value: unknown): value is WebServerFace {
  return value !== null && typeof value === 'object' && typeof (value as WebServerFace).register === 'function'
}

/** Cordis property access throws without inject. Soft-get is the only safe read. */
function webServerOf(ctx: UsageHostContext): WebServerFace | undefined {
  try {
    const value = ctx.get?.('webServer')
    return isWebServer(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(body)
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

export function hostNameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  if (firstColon !== lastColon) return host
  if (lastColon === -1) return host.replace(/\.$/, '')
  if (!/^\d+$/.test(host.slice(lastColon + 1))) return null
  return host.slice(0, lastColon).replace(/\.$/, '')
}

function isLoopbackHostHeader(req: IncomingMessage): boolean {
  const name = hostNameOf(typeof req.headers.host === 'string' ? req.headers.host : undefined)
  return name === 'localhost' || isLoopbackAddress(name ?? undefined)
}

/** Refuse non-GET and non-loopback callers before any work. */
export function rejectForeignCaller(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'method-not-allowed' })
    return true
  }
  if (isLoopbackAddress(req.socket?.remoteAddress) && isLoopbackHostHeader(req)) return false
  json(res, 403, { ok: false, error: 'forbidden' })
  return true
}

function credentialsOf(ctx: CollectContext): CredentialsFace | undefined {
  const credentials = ctx.get?.('credentials') as CredentialsFace | undefined
  return credentials !== undefined && typeof credentials.resolve === 'function' ? credentials : undefined
}

function settingsOf(ctx: CollectContext): { get?(key: string): unknown } | undefined {
  const settings = ctx.get?.('settings') as { get?(key: string): unknown } | undefined
  return settings !== undefined && typeof settings.get === 'function' ? settings : undefined
}

function llmOf(ctx: CollectContext): LlmFace | undefined {
  try {
    const llm = ctx.get?.('llm') as LlmFace | undefined
    return llm !== undefined && (typeof llm.listProviders === 'function' || typeof llm.listConfigurableProviders === 'function')
      ? llm
      : undefined
  } catch {
    return undefined
  }
}

export async function handleSummary(ctx: CollectContext, req: IncomingMessage, res: ServerResponse, deps?: CollectDeps): Promise<void> {
  if (rejectForeignCaller(req, res)) return
  try {
    json(res, 200, { ok: true, ...await collectUsage(ctx, deps) })
  } catch (error) {
    ctx.logger?.warn(`dshapps-usage: summary failed: ${String(error)}`)
    json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

export async function handleDay(ctx: CollectContext, req: IncomingMessage, res: ServerResponse, deps?: CollectDeps): Promise<void> {
  if (rejectForeignCaller(req, res)) return
  const date = new URL(req.url ?? '/', 'http://x').searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    json(res, 400, { ok: false, error: 'invalid-date' })
    return
  }
  try {
    json(res, 200, { ok: true, ...await collectDay(ctx, date, deps) })
  } catch (error) {
    ctx.logger?.warn(`dshapps-usage: day failed: ${String(error)}`)
    json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

export async function handleBalances(ctx: CollectContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rejectForeignCaller(req, res)) return
  try {
    json(res, 200, { ok: true, balances: await queryBalances(providersFromHost(settingsOf(ctx), llmOf(ctx)), credentialsOf(ctx)) })
  } catch (error) {
    ctx.logger?.warn(`dshapps-usage: balances failed: ${String(error)}`)
    json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

export async function handleSubscriptions(ctx: CollectContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rejectForeignCaller(req, res)) return
  try {
    json(res, 200, { ok: true, subscriptions: await querySubscriptions(credentialsOf(ctx)) })
  } catch (error) {
    ctx.logger?.warn(`dshapps-usage: subscriptions failed: ${String(error)}`)
    json(res, 500, { ok: false, error: 'internal', message: error instanceof Error ? error.message : String(error) })
  }
}

const HANDLERS: Record<string, (ctx: CollectContext, req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
  [SUMMARY_PATH]: handleSummary,
  [DAY_PATH]: handleDay,
  [BALANCES_PATH]: handleBalances,
  [SUBSCRIPTIONS_PATH]: handleSubscriptions,
}

function track(ctx: UsageHostContext, label: string, register: () => () => void): void {
  const run = (): (() => void) => {
    try {
      return register()
    } catch (error) {
      ctx.logger?.warn(`dshapps-usage: ${label} failed: ${String(error)}`)
      return () => {}
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(run, label)
  else run()
}

/** Register the four exact routes. Missing webServer is a no-op. Never throws. */
export function registerUsageRoutes(ctx: UsageHostContext): void {
  try {
    const webServer = webServerOf(ctx)
    if (webServer === undefined) return
    for (const path of USAGE_ROUTES) {
      const handler = HANDLERS[path]!
      track(ctx, path, () => webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => { void handler(ctx, req, res) },
      }))
    }
  } catch (error) {
    ctx.logger?.warn(`dshapps-usage: register failed: ${String(error)}`)
  }
}
