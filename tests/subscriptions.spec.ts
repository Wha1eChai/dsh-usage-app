import { describe, expect, it } from 'vitest'
import {
  collectOpenCodeGo,
  collectZai,
  localOpenCodeApiKey,
  parseOpenCodeGoApi,
  parseZai,
  querySubscriptions,
} from '../src/subscriptions.js'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('subscriptions', () => {
  it('parses OpenCode Go windows from ratios and percents', () => {
    const now = Date.parse('2026-08-15T00:00:00Z')
    const windows = parseOpenCodeGoApi({
      usage: {
        rolling: { usagePercent: 0.2, resetInSec: 60 },
        weekly: { used: 1, limit: 4 },
        monthly: { percent: 10, resetAt: '2026-09-01T00:00:00.000Z' },
      },
    }, now)
    expect(windows).toHaveLength(3)
    expect(windows[0]?.kind).toBe('session')
    expect(parseOpenCodeGoApi(null, now)).toEqual([])
    expect(parseOpenCodeGoApi({ usage: { rolling: 1 } }, now)).toEqual([])
    expect(parseOpenCodeGoApi({
      rolling: { used: '2', limit: '4', resetAt: 1_700_000_000 },
      weekly: { percent: 3, nextReset: 'not-a-date' },
    }, now).length).toBeGreaterThan(0)
  })

  it('reads a local OpenCode auth.json and treats missing files as empty', async () => {
    await expect(localOpenCodeApiKey({
      homedir: () => '/tmp',
      readFile: async () => JSON.stringify({ 'opencode-go': { type: 'api', key: ' local ' } }),
    })).resolves.toBe('local')
    await expect(localOpenCodeApiKey({
      homedir: () => '/tmp',
      readFile: async () => JSON.stringify({ opencode: { type: 'oauth' } }),
    })).resolves.toBe('')
    await expect(localOpenCodeApiKey({
      homedir: () => '/tmp',
      readFile: async () => { throw new Error('missing') },
    })).resolves.toBe('')
  })

  it('collects OpenCode Go from Bearer or marks missing/error', async () => {
    await expect(collectOpenCodeGo(undefined, { readFile: async () => { throw new Error('x') } })).resolves.toMatchObject({ status: 'missing' })
    await expect(collectOpenCodeGo({
      resolve: async () => ({ value: 'k' }),
    }, {
      now: () => 1,
      fetch: async () => jsonResponse(200, { usage: { rolling: { percent: 5 }, weekly: { percent: 6 } } }),
    })).resolves.toMatchObject({ status: 'ok' })
    await expect(collectOpenCodeGo({
      resolve: async () => ({ value: 'k' }),
    }, { fetch: async () => jsonResponse(200, {}) })).resolves.toMatchObject({ status: 'error', message: 'invalid-response' })
    await expect(collectOpenCodeGo({
      resolve: async () => ({ value: 'k' }),
    }, { fetch: async () => jsonResponse(401, {}) })).resolves.toMatchObject({ status: 'error', message: 'unauthorized' })
    await expect(collectOpenCodeGo({
      resolve: async () => ({ value: 'k' }),
    }, { fetch: async () => jsonResponse(429, {}) })).resolves.toMatchObject({ message: 'rate-limited' })
    const timeout = new Error('slow')
    timeout.name = 'TimeoutError'
    await expect(collectOpenCodeGo({
      resolve: async () => ({ value: 'k' }),
    }, { fetch: async () => { throw timeout } })).resolves.toMatchObject({ message: 'unavailable' })
    const aborted = new Error('aborted')
    aborted.name = 'AbortError'
    await expect(collectOpenCodeGo({
      resolve: async () => ({ value: 'k' }),
    }, { fetch: async () => { throw aborted } })).resolves.toMatchObject({ message: 'unavailable' })
    await expect(collectOpenCodeGo({
      resolve: async () => ({ value: 'k' }),
    }, { fetch: async () => { throw new SyntaxError('bad json') } })).resolves.toMatchObject({ message: 'invalid-response' })
  })

  it('parses Z.ai quota windows and plan labels', () => {
    const parsed = parseZai({
      data: {
        product_name: 'glm_pro',
        limits: [
          { type: 'TOKENS_LIMIT', unit: 5, number: 5, usage: 100, remaining: 40, nextResetTime: '2026-08-16T00:00:00.000Z' },
          { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 200, remaining: 50 },
          { type: 'TIME_LIMIT', usage: 10, remaining: 2, currentValue: 8 },
          { type: 'OTHER' },
        ],
      },
    }, { data: [{ next_renew_time: '2026-09-01T00:00:00.000Z' }] })
    expect(parsed.plan).toBe('GLM Pro')
    expect(parsed.windows.some(window => window.kind === 'session')).toBe(true)
    expect(parseZai({ data: { limits: [{ type: 'TOKENS_LIMIT', unit: 1, number: 1, usage: 10, remaining: 1 }] } }, null).windows[0]?.kind).toBe('weekly')
    expect(parseZai({}, null).windows).toEqual([])
    expect(parseZai({
      data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 40, unit: 3, number: 1 }] },
    }, null).windows[0]?.usedPercent).toBe(40)
    expect(parseZai({
      data: { limits: [{ type: 'TOKENS_LIMIT', usage: 10, remaining: 1, unit: 1, number: 1 }] },
    }, null).windows[0]?.kind).toBe('weekly')
    expect(parseZai({
      data: { limits: [{ type: 'TOKENS_LIMIT', usage: 10, currentValue: 4, unit: 99, number: 1 }] },
    }, null).windows.length).toBeGreaterThan(0)
    expect(parseZai({
      data: { limits: [{ type: 'TOKENS_LIMIT', usage: 10, remaining: 1, current_value: 9, unit: 5, number: 1 }] },
    }, null).windows[0]?.usedPercent).toBe(90)
  })

  it('collects Z.ai with region overlay and isolated failures', async () => {
    await expect(collectZai(undefined)).resolves.toMatchObject({ status: 'missing' })
    await expect(collectZai({
      resolve: async ref => ref === 'ZAI_API_KEY' ? { value: 'k' } : 'cn',
    }, {
      fetch: async url => {
        if (String(url).includes('quota')) {
          return jsonResponse(200, { data: { limits: [{ type: 'TOKENS_LIMIT', unit: 5, number: 5, usage: 10, remaining: 5 }] } })
        }
        throw new Error('skip sub')
      },
    })).resolves.toMatchObject({ status: 'ok' })
    await expect(collectZai({
      resolve: async () => ({ value: 'k' }),
    }, { fetch: async () => jsonResponse(200, { data: { limits: [] } }) })).resolves.toMatchObject({ status: 'error' })
    await expect(collectZai({
      resolve: async ref => ref === 'ZAI_API_KEY' ? { value: 'k' } : 'bigmodel.cn',
    }, { fetch: async () => jsonResponse(403, {}) })).resolves.toMatchObject({ status: 'error' })
    const cards = await querySubscriptions({
      resolve: async () => { throw new Error('nope') },
    }, { readFile: async () => { throw new Error('x') } })
    expect(cards).toHaveLength(2)
    expect(cards.every(card => card.status === 'missing')).toBe(true)
  })
})
