import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { CredentialsFace } from './balances.js'

export interface SubscriptionWindow {
  readonly kind: 'session' | 'weekly' | 'monthly' | 'billing'
  readonly usedPercent: number
  readonly remainingPercent: number
  readonly resetsAt?: string
}

export interface SubscriptionCard {
  readonly id: string
  readonly displayName: string
  readonly status: 'ok' | 'missing' | 'error'
  readonly plan: string
  readonly windows: readonly SubscriptionWindow[]
  readonly message?: string
}

export interface SubscriptionDeps {
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  readonly now?: () => number
  readonly homedir?: () => string
  readonly readFile?: (path: string, encoding: 'utf8') => Promise<string>
}

const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const ZAI_HOSTS = {
  global: 'https://api.z.ai',
  'bigmodel-cn': 'https://open.bigmodel.cn',
} as const
const ZAI_QUOTA_PATH = '/api/monitor/usage/quota/limit'
const ZAI_SUBSCRIPTION_PATH = '/api/biz/subscription/list'

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function clampPercent(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.min(100, value))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function toIso(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 20_000_000_000 ? value * 1000 : value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

async function resolveKey(credentials: CredentialsFace | undefined, ref: string): Promise<string> {
  if (credentials === undefined) return ''
  try {
    const hit = await credentials.resolve(ref)
    return typeof hit?.value === 'string' ? hit.value.trim() : ''
  } catch {
    return ''
  }
}

function errorStatus(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'unavailable'
  if (error instanceof Error && /HTTP 401|HTTP 403/.test(error.message)) return 'unauthorized'
  if (error instanceof Error && /HTTP 429/.test(error.message)) return 'rate-limited'
  return error instanceof SyntaxError ? 'invalid-response' : 'unavailable'
}

async function requestJson(url: string, init: RequestInit, deps: SubscriptionDeps): Promise<unknown> {
  const fetchImpl = deps.fetch ?? fetch
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function goWindowFromObject(value: unknown, kind: SubscriptionWindow['kind'], now: number): SubscriptionWindow | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const percentSource = record.usagePercent ?? record.usedPercent ?? record.percentUsed ?? record.percentage ?? record.percent
  let usedPercent = clampPercent(numberOrNull(percentSource))
  if (usedPercent === null) {
    const used = numberOrNull(record.used ?? record.consumed)
    const limit = numberOrNull(record.limit ?? record.total ?? record.quota)
    if (used !== null && limit !== null && limit > 0) usedPercent = clampPercent((used / limit) * 100)
  }
  if (usedPercent === null) return undefined
  if (usedPercent <= 1 && record.percent === undefined && percentSource !== undefined) usedPercent *= 100
  const resetSeconds = numberOrNull(record.resetInSec ?? record.resetInSeconds ?? record.resetSeconds)
  const resetsAt = resetSeconds === null
    ? toIso(record.resetAt ?? record.resetsAt ?? record.nextReset)
    : new Date(now + Math.max(0, resetSeconds) * 1000).toISOString()
  return {
    kind,
    usedPercent: round1(usedPercent),
    remainingPercent: round1(100 - usedPercent),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/** Parse the OpenCode Go Bearer usage body. */
export function parseOpenCodeGoApi(body: unknown, now: number): SubscriptionWindow[] {
  const usage = asRecord(asRecord(body)?.usage) ?? asRecord(body)
  if (usage === undefined) return []
  return [
    goWindowFromObject(usage.rolling, 'session', now),
    goWindowFromObject(usage.weekly, 'weekly', now),
    goWindowFromObject(usage.monthly, 'monthly', now),
  ].filter((window): window is SubscriptionWindow => window !== undefined)
}

export async function localOpenCodeApiKey(deps: SubscriptionDeps = {}): Promise<string> {
  try {
    const home = typeof deps.homedir === 'function' ? deps.homedir() : homedir()
    const load = deps.readFile ?? readFile
    const raw = JSON.parse(await load(join(home, '.local', 'share', 'opencode', 'auth.json'), 'utf8'))
    const root = asRecord(raw)
    const entry = asRecord(root?.['opencode-go']) ?? asRecord(root?.opencode)
    return entry?.type === 'api' && typeof entry.key === 'string' ? entry.key.trim() : ''
  } catch {
    return ''
  }
}

export async function collectOpenCodeGo(
  credentials: CredentialsFace | undefined,
  deps: SubscriptionDeps = {},
): Promise<SubscriptionCard> {
  const configured = await resolveKey(credentials, 'OPENCODE_GO_API_KEY')
  const apiKey = configured || await localOpenCodeApiKey(deps)
  if (apiKey === '') {
    return { id: 'opencode-go', displayName: 'OpenCode Go', status: 'missing', plan: 'Go', windows: [], message: 'OPENCODE_GO_API_KEY' }
  }
  try {
    const windows = parseOpenCodeGoApi(
      await requestJson(OPENCODE_GO_USAGE_URL, {
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      }, deps),
      (deps.now ?? Date.now)(),
    )
    if (windows.length === 0) {
      return { id: 'opencode-go', displayName: 'OpenCode Go', status: 'error', plan: 'Go', windows: [], message: 'invalid-response' }
    }
    return { id: 'opencode-go', displayName: 'OpenCode Go', status: 'ok', plan: 'Go', windows }
  } catch (error) {
    return { id: 'opencode-go', displayName: 'OpenCode Go', status: 'error', plan: 'Go', windows: [], message: errorStatus(error) }
  }
}

function zaiUsedPercent(limit: Record<string, unknown> | undefined): number | null {
  if (limit === undefined) return null
  const total = numberOrNull(limit.usage)
  const remaining = numberOrNull(limit.remaining)
  const current = numberOrNull(limit.currentValue ?? limit.current_value)
  if (total !== null && total > 0) {
    const used = remaining === null ? current : current === null ? total - remaining : Math.max(total - remaining, current)
    if (used !== null) return clampPercent((Math.max(0, Math.min(total, used)) / total) * 100)
  }
  return clampPercent(numberOrNull(limit.percentage ?? limit.usedPercent ?? limit.used_percent))
}

function zaiWindowMinutes(limit: Record<string, unknown> | undefined): number | null {
  const unit = numberOrNull(limit?.unit)
  const number = numberOrNull(limit?.number)
  if (unit === null || number === null || number <= 0) return null
  if (unit === 5) return number
  if (unit === 3) return number * 60
  if (unit === 1) return number * 24 * 60
  if (unit === 6) return number * 7 * 24 * 60
  return null
}

function displayPlan(value: unknown): string {
  return String(value ?? '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\bglm\b/gi, 'GLM').replace(/\b\w/g, char => char.toUpperCase())
}

function zaiPlan(quota: unknown, subscription: unknown): string {
  const sub = asRecord(subscription)
  const rows = Array.isArray(sub?.data) ? sub.data : []
  const row = asRecord(rows.find(entry => asRecord(entry) !== undefined))
  const quotaData = asRecord(asRecord(quota)?.data)
  for (const source of [row, quotaData]) {
    for (const key of ['product_name', 'productName', 'plan_name', 'planName', 'package_name', 'packageName', 'plan_type', 'planType', 'level']) {
      const value = displayPlan(source?.[key])
      if (value !== '') return value
    }
  }
  return 'GLM Coding Plan'
}

function zaiWindow(limit: Record<string, unknown> | undefined, kind: SubscriptionWindow['kind'], fallbackReset?: string): SubscriptionWindow | undefined {
  const usedPercent = zaiUsedPercent(limit)
  if (usedPercent === null || limit === undefined) return undefined
  const resetsAt = toIso(limit.nextResetTime ?? limit.next_reset_time) ?? fallbackReset
  return {
    kind,
    usedPercent: round1(usedPercent),
    remainingPercent: round1(100 - usedPercent),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/** Parse Z.ai quota + optional subscription list. */
export function parseZai(quota: unknown, subscription: unknown): { plan: string; windows: SubscriptionWindow[] } {
  const limits = Array.isArray(asRecord(asRecord(quota)?.data)?.limits)
    ? (asRecord(asRecord(quota)?.data)?.limits as unknown[])
      .map(entry => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    : []
  const tokenLimits = limits
    .filter(limit => ['TOKENS_LIMIT', 'CREDIT_LIMIT'].includes(String(limit.type ?? limit.limit_type ?? '').toUpperCase()) && zaiUsedPercent(limit) !== null)
    .sort((left, right) => (zaiWindowMinutes(left) ?? Number.MAX_SAFE_INTEGER) - (zaiWindowMinutes(right) ?? Number.MAX_SAFE_INTEGER))
  const timeLimit = limits.find(limit => String(limit.type ?? limit.limit_type ?? '').toUpperCase() === 'TIME_LIMIT' && zaiUsedPercent(limit) !== null)
  const first = tokenLimits[0]
  const session = tokenLimits.length >= 2 ? first : zaiWindowMinutes(first) !== null && (zaiWindowMinutes(first) ?? 0) <= 360 ? first : undefined
  const weekly = tokenLimits.length >= 2 ? tokenLimits[tokenLimits.length - 1] : session === undefined ? first : undefined
  const subscriptionRow = Array.isArray(asRecord(subscription)?.data) ? asRecord((asRecord(subscription)?.data as unknown[])[0]) : undefined
  const renewAt = toIso(subscriptionRow?.next_renew_time ?? subscriptionRow?.nextRenewTime)
  return {
    plan: zaiPlan(quota, subscription),
    windows: [
      zaiWindow(session, 'session'),
      zaiWindow(weekly, 'weekly'),
      zaiWindow(timeLimit, 'billing', renewAt),
    ].filter((window): window is SubscriptionWindow => window !== undefined),
  }
}

export async function collectZai(
  credentials: CredentialsFace | undefined,
  deps: SubscriptionDeps = {},
): Promise<SubscriptionCard> {
  const apiKey = await resolveKey(credentials, 'ZAI_API_KEY')
  const regionRaw = await resolveKey(credentials, 'ZAI_API_REGION')
  const region = regionRaw === 'bigmodel-cn' || regionRaw === 'cn' || regionRaw.includes('bigmodel.cn') ? 'bigmodel-cn' : 'global'
  if (apiKey === '') {
    return { id: 'zai', displayName: 'Z.ai', status: 'missing', plan: 'GLM Coding Plan', windows: [], message: 'ZAI_API_KEY' }
  }
  const host = ZAI_HOSTS[region]
  const init = { headers: { authorization: apiKey, accept: 'application/json' } }
  try {
    const quota = await requestJson(`${host}${ZAI_QUOTA_PATH}`, init, deps)
    let subscription: unknown
    try {
      subscription = await requestJson(`${host}${ZAI_SUBSCRIPTION_PATH}`, init, deps)
    } catch {
      subscription = null
    }
    const parsed = parseZai(quota, subscription)
    if (parsed.windows.length === 0) {
      return { id: 'zai', displayName: 'Z.ai', status: 'error', plan: parsed.plan, windows: [], message: 'invalid-response' }
    }
    return { id: 'zai', displayName: 'Z.ai', status: 'ok', plan: parsed.plan, windows: parsed.windows }
  } catch (error) {
    return { id: 'zai', displayName: 'Z.ai', status: 'error', plan: 'GLM Coding Plan', windows: [], message: errorStatus(error) }
  }
}

/** Both subscription cards. Failures stay on the card. */
export async function querySubscriptions(
  credentials: CredentialsFace | undefined,
  deps: SubscriptionDeps = {},
): Promise<SubscriptionCard[]> {
  return Promise.all([collectOpenCodeGo(credentials, deps), collectZai(credentials, deps)])
}
