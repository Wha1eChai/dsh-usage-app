/** Normalized balance card for one provider. */
export interface BalanceCard {
  readonly id: string
  readonly displayName: string
  readonly status: 'ok' | 'missing' | 'error'
  readonly currency?: string
  readonly remaining?: number
  readonly granted?: number
  readonly toppedUp?: number
  readonly used?: number
  readonly limit?: number
  readonly message?: string
}

export interface ProviderSpec {
  readonly id: string
  readonly displayName: string
  readonly apiKeyEnv: string
  readonly baseURL: string
  readonly scheme: BalanceSchemeId
}

export type BalanceSchemeId = 'deepseek' | 'openrouter' | 'moonshot' | 'zai'

export interface ParsedBalance {
  readonly isAvailable?: boolean
  readonly currency?: string
  readonly total?: number
  readonly used?: number
  readonly limit?: number
  readonly granted?: number
  readonly toppedUp?: number
}

export interface CredentialsFace {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

export interface BalanceQueryDeps {
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

const SCHEMES: Record<BalanceSchemeId, {
  url: (baseURL: string) => string
  parse: (body: unknown) => ParsedBalance
}> = {
  deepseek: {
    url: baseURL => new URL('/user/balance', baseURL).href,
    parse: body => {
      const json = asRecord(body)
      const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : []
      const records = infos.filter(entry => asRecord(entry) !== undefined).map(entry => asRecord(entry)!)
      const info = records.find(entry => entry.currency === 'CNY') ?? records[0]
      return {
        isAvailable: json?.is_available === true,
        currency: typeof info?.currency === 'string' ? info.currency : undefined,
        total: numberOrUndef(info?.total_balance),
        granted: numberOrUndef(info?.granted_balance),
        toppedUp: numberOrUndef(info?.topped_up_balance),
      }
    },
  },
  openrouter: {
    url: baseURL => new URL('/api/v1/credits', baseURL).href,
    parse: body => {
      const data = asRecord(asRecord(body)?.data)
      const totalCredits = numberOrUndef(data?.total_credits)
      const totalUsage = numberOrUndef(data?.total_usage)
      const remaining = totalCredits !== undefined && totalUsage !== undefined ? totalCredits - totalUsage : undefined
      return {
        isAvailable: remaining !== undefined ? remaining > 0 : undefined,
        currency: 'USD',
        total: remaining,
        used: totalUsage,
        limit: totalCredits,
      }
    },
  },
  moonshot: {
    url: baseURL => new URL('/v1/users/me/balance', baseURL).href,
    parse: body => {
      const data = asRecord(asRecord(body)?.data)
      const available = numberOrUndef(data?.available_balance)
      return {
        isAvailable: available !== undefined ? available > 0 : undefined,
        currency: typeof data?.currency === 'string' ? data.currency : undefined,
        total: available,
        granted: numberOrUndef(data?.voucher_balance),
        toppedUp: numberOrUndef(data?.cash_balance),
      }
    },
  },
  zai: {
    url: baseURL => new URL('/api/paas/v4/balance', baseURL).href,
    parse: body => {
      const data = asRecord(asRecord(body)?.data)
      const available = numberOrUndef(data?.available_balance)
      const total = numberOrUndef(data?.total_balance) ?? available
      return {
        isAvailable: total !== undefined ? total > 0 : undefined,
        currency: typeof data?.currency === 'string' ? data.currency : undefined,
        total,
        toppedUp: available,
      }
    },
  },
}

/** Built-in providers. Settings may overlay DeepSeek's env/base URL. */
export const DEFAULT_PROVIDERS: readonly ProviderSpec[] = Object.freeze([
  { id: 'deepseek', displayName: 'DeepSeek', apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com', scheme: 'deepseek' },
  { id: 'openrouter', displayName: 'OpenRouter', apiKeyEnv: 'OPENROUTER_API_KEY', baseURL: 'https://openrouter.ai', scheme: 'openrouter' },
  { id: 'moonshot', displayName: 'Moonshot', apiKeyEnv: 'MOONSHOT_API_KEY', baseURL: 'https://api.moonshot.cn', scheme: 'moonshot' },
  { id: 'zai', displayName: 'Z.ai', apiKeyEnv: 'ZAI_API_KEY', baseURL: 'https://api.z.ai', scheme: 'zai' },
])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function numberOrUndef(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function httpStatusKind(status: number): string {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate-limited'
  return status >= 500 ? 'unavailable' : 'invalid-response'
}

/** Parse one scheme's JSON body. */
export function parseBalance(scheme: BalanceSchemeId, body: unknown): ParsedBalance {
  return SCHEMES[scheme].parse(body)
}

/** Query one provider. Throws on transport/HTTP/JSON errors. */
export async function queryBalance(
  scheme: BalanceSchemeId,
  baseURL: string,
  apiKey: string,
  deps: BalanceQueryDeps = {},
): Promise<ParsedBalance> {
  const spec = SCHEMES[scheme]
  const fetchImpl = deps.fetch ?? fetch
  const response = await fetchImpl(spec.url(baseURL), {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
  })
  if (!response.ok) throw new Error(`${httpStatusKind(response.status)}: HTTP ${response.status}`)
  try {
    return spec.parse(await response.json())
  } catch {
    throw new Error('invalid-response')
  }
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

function cardFromParsed(provider: ProviderSpec, parsed: ParsedBalance): BalanceCard {
  return {
    id: provider.id,
    displayName: provider.displayName,
    status: 'ok',
    ...(parsed.currency === undefined ? {} : { currency: parsed.currency }),
    ...(parsed.total === undefined ? {} : { remaining: parsed.total }),
    ...(parsed.granted === undefined ? {} : { granted: parsed.granted }),
    ...(parsed.toppedUp === undefined ? {} : { toppedUp: parsed.toppedUp }),
    ...(parsed.used === undefined ? {} : { used: parsed.used }),
    ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
  }
}

/** Query every configured provider. One failure does not block the others. */
export async function queryBalances(
  providers: readonly ProviderSpec[],
  credentials: CredentialsFace | undefined,
  deps: BalanceQueryDeps = {},
): Promise<BalanceCard[]> {
  return Promise.all(providers.map(async provider => {
    const apiKey = await resolveKey(credentials, provider.apiKeyEnv)
    if (apiKey === '') {
      return { id: provider.id, displayName: provider.displayName, status: 'missing' as const, message: provider.apiKeyEnv }
    }
    try {
      return cardFromParsed(provider, await queryBalance(provider.scheme, provider.baseURL, apiKey, deps))
    } catch (error) {
      return {
        id: provider.id,
        displayName: provider.displayName,
        status: 'error' as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }))
}

/** Overlay DeepSeek env/base URL from optional harness settings. */
export function providersFromSettings(settings: { get?(key: string): unknown } | undefined): ProviderSpec[] {
  const deepseek = settings?.get?.('llm-deepseek')
  const record = asRecord(deepseek)
  return DEFAULT_PROVIDERS.map(provider => {
    if (provider.id !== 'deepseek' || record === undefined) return provider
    return {
      ...provider,
      apiKeyEnv: typeof record.apiKeyEnv === 'string' ? record.apiKeyEnv : provider.apiKeyEnv,
      baseURL: typeof record.baseURL === 'string' ? record.baseURL : provider.baseURL,
    }
  })
}
