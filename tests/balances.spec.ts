import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROVIDERS,
  parseBalance,
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
})
