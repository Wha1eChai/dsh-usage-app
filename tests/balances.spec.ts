import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROVIDERS,
  parseBalance,
  providersFromHost,
  providersFromSettings,
  queryBalance,
  queryBalances,
} from '../src/balances.js'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('balances', () => {
  it('parses each provider scheme', () => {
    expect(parseBalance('deepseek', {
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: 1 }, { currency: 'CNY', total_balance: 9, granted_balance: 1, topped_up_balance: 8 }],
    }).total).toBe(9)
    expect(parseBalance('deepseek', { balance_infos: 'nope' }).total).toBeUndefined()
    expect(parseBalance('openrouter', { data: { total_credits: 10, total_usage: 3 } }).total).toBe(7)
    expect(parseBalance('moonshot', { data: { available_balance: 2, voucher_balance: 1, cash_balance: 1, currency: 'CNY' } }).total).toBe(2)
    expect(parseBalance('openrouter', { data: { total_credits: 1 } }).total).toBeUndefined()
    expect(parseBalance('openrouter', { data: { total_credits: 1, total_usage: 2 } }).isAvailable).toBe(false)
    expect(parseBalance('moonshot', { data: {} }).total).toBeUndefined()
    expect(parseBalance('zai', {}).total).toBeUndefined()
    expect(parseBalance('zai', { data: { available_balance: 4, currency: 'CNY' } }).total).toBe(4)
  })

  it('maps HTTP failures and invalid JSON', async () => {
    await expect(queryBalance('deepseek', 'https://api.deepseek.com', 'k', {
      fetch: async () => jsonResponse(401, {}),
    })).rejects.toThrow(/unauthorized/)
    await expect(queryBalance('deepseek', 'https://api.deepseek.com', 'k', {
      fetch: async () => jsonResponse(429, {}),
    })).rejects.toThrow(/rate-limited/)
    await expect(queryBalance('deepseek', 'https://api.deepseek.com', 'k', {
      fetch: async () => jsonResponse(500, {}),
    })).rejects.toThrow(/unavailable/)
    await expect(queryBalance('deepseek', 'https://api.deepseek.com', 'k', {
      fetch: async () => jsonResponse(418, {}),
    })).rejects.toThrow(/invalid-response/)
    await expect(queryBalance('deepseek', 'https://api.deepseek.com', 'k', {
      fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('nope') } }) as Response,
    })).rejects.toThrow('invalid-response')
    await expect(queryBalance('deepseek', 'https://api.deepseek.com', 'k', {
      fetch: async () => jsonResponse(200, { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 1 }] }),
    })).resolves.toMatchObject({ total: 1 })
    await expect(queryBalance('openrouter', 'https://openrouter.ai', 'k', {
      fetch: async () => jsonResponse(200, { data: { total_credits: 5, total_usage: 1 } }),
    })).resolves.toMatchObject({ total: 4 })
    await expect(queryBalance('moonshot', 'https://api.moonshot.cn', 'k', {
      fetch: async () => jsonResponse(200, { data: { available_balance: 2 } }),
    })).resolves.toMatchObject({ total: 2 })
    await expect(queryBalance('zai', 'https://api.z.ai', 'k', {
      fetch: async () => jsonResponse(200, { data: { total_balance: 8, available_balance: 8 } }),
    })).resolves.toMatchObject({ total: 8 })
  })

  it('isolates missing and failed providers', async () => {
    const cards = await queryBalances(DEFAULT_PROVIDERS, {
      resolve: async ref => ref === 'DEEPSEEK_API_KEY' ? { value: 'k' } : ref === 'OPENROUTER_API_KEY' ? Promise.reject(new Error('boom')) : undefined,
    }, {
      fetch: async url => {
        if (String(url).includes('deepseek')) return jsonResponse(200, { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 3 }] })
        throw new Error('network')
      },
    })
    expect(cards.find(card => card.id === 'deepseek')?.status).toBe('ok')
    expect(cards.find(card => card.id === 'openrouter')?.status).toBe('missing')
    expect(cards.find(card => card.id === 'moonshot')?.status).toBe('missing')
    expect(cards.find(card => card.id === 'zai')?.status).toBe('missing')
    const failed = await queryBalances([DEFAULT_PROVIDERS[0]!], {
      resolve: async () => ({ value: 'k' }),
    }, { fetch: async () => { throw new Error('down') } })
    expect(failed[0]?.status).toBe('error')
    expect((await queryBalances([DEFAULT_PROVIDERS[0]!], undefined))[0]?.status).toBe('missing')
  })

  it('overlays DeepSeek settings when present', () => {
    expect(providersFromSettings(undefined)[0]?.baseURL).toBe('https://api.deepseek.com')
    expect(providersFromSettings({ get: () => null })[0]?.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
    const overlaid = providersFromSettings({
      get: key => key === 'llm-deepseek' ? { apiKeyEnv: 'CUSTOM_KEY', baseURL: 'https://example.test' } : undefined,
    })
    expect(overlaid[0]).toMatchObject({ apiKeyEnv: 'CUSTOM_KEY', baseURL: 'https://example.test' })
    expect(overlaid[1]?.id).toBe('openrouter')
  })

  it('overlays aliased host providers and marks unknown ones unsupported', async () => {
    const settings = {
      get: (key: string) => key === 'llm-deepseek'
        ? { apiKeyEnv: 'CUSTOM_KEY', baseURL: 'https://ds.example' }
        : undefined,
    }
    const llm = {
      listConfigurableProviders: () => [
        { provider: 'deepseek-official', displayName: 'DeepSeek Official', settingsNs: 'llm-deepseek', settingsPath: [] as const },
        { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] as const },
      ],
      listProviders: () => [{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }],
    }
    const providers = providersFromHost(settings, llm)
    expect(providers.map(provider => provider.id).slice(0, 4)).toEqual(['deepseek', 'openrouter', 'moonshot', 'zai'])
    expect(providers.find(provider => provider.id === 'deepseek')).toMatchObject({
      displayName: 'DeepSeek Official',
      apiKeyEnv: 'CUSTOM_KEY',
      baseURL: 'https://ds.example',
      scheme: 'deepseek',
    })
    expect(providers.find(provider => provider.id === 'openai')).toMatchObject({ displayName: 'OpenAI' })
    expect(providers.find(provider => provider.id === 'openai')?.scheme).toBeUndefined()
    expect(providers.find(provider => provider.id === 'anthropic')?.scheme).toBeUndefined()
    expect(providersFromHost(undefined).map(provider => provider.id)).toEqual(DEFAULT_PROVIDERS.map(provider => provider.id))

    const fetches: string[] = []
    const cards = await queryBalances(providers, {
      resolve: async () => ({ value: 'k' }),
    }, {
      fetch: async url => {
        fetches.push(String(url))
        return jsonResponse(200, { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 1 }] })
      },
    })
    expect(cards.find(card => card.id === 'openai')?.status).toBe('unsupported')
    expect(cards.find(card => card.id === 'anthropic')?.status).toBe('unsupported')
    expect(fetches.some(url => url.includes('openai') || url.includes('anthropic'))).toBe(false)

    let fetched = false
    const unsupported = await queryBalances(
      [{ id: 'openai', displayName: 'OpenAI', apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com' }],
      { resolve: async () => ({ value: 'k' }) },
      { fetch: async () => { fetched = true; return jsonResponse(200, {}) } },
    )
    expect(unsupported[0]).toMatchObject({ id: 'openai', status: 'unsupported' })
    expect(fetched).toBe(false)
  })

  it('swallows throwing llm listings and broken settings paths', () => {
    const broken = providersFromHost({
      get: key => {
        if (key === 'llm-pi-ai') throw new Error('settings')
        return { providers: { openai: 'nope' } }
      },
    }, {
      listConfigurableProviders: () => {
        throw new Error('directory')
      },
      listProviders: () => {
        throw new Error('live')
      },
    })
    expect(broken.map(provider => provider.id)).toEqual(DEFAULT_PROVIDERS.map(provider => provider.id))

    const walked = providersFromHost({
      get: key => key === 'llm-pi-ai' ? { providers: 'nope' } : undefined,
    }, {
      listConfigurableProviders: () => [
        { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
      ],
    })
    expect(walked.find(provider => provider.id === 'openai')?.scheme).toBeUndefined()

    const throwingProfile = providersFromHost({
      get: key => {
        if (key === 'llm-pi-ai') throw new Error('profile')
        return undefined
      },
    }, {
      listConfigurableProviders: () => [
        { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: [] },
      ],
    })
    expect(throwingProfile.find(provider => provider.id === 'openai')?.displayName).toBe('OpenAI')
  })
})
