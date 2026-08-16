import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyHost } from '../src/index.js'
import { apply as applyInvariant, inject as invariantInject, name as invariantName } from '../src/invariant.js'
import { apply, inject, name, UsageAppBody } from '../src/client/index.js'
import { UsageHeaderAction } from '../src/client/UsageHeaderAction.js'
import { en, zh } from '../src/client/locales.js'

describe('Usage App composition', () => {
  afterEach(() => vi.restoreAllMocks())

  it('registers metadata, locale, the App body, and a header deep-link in one effect', () => {
    const unregisterPage = vi.fn()
    const unregisterLocale = vi.fn()
    const unregisterApp = vi.fn()
    const unregisterHeader = vi.fn()
    const pageRegister = vi.fn(() => unregisterPage)
    const localeRegister = vi.fn(() => unregisterLocale)
    const slotRegister = vi.fn((options: { name: string }) => (
      options.name === 'webpage.app' ? unregisterApp : unregisterHeader
    ))
    const slotInject = vi.fn((_name: string, callback: () => (() => void)) => callback())
    const open = vi.fn()
    const openSession = vi.fn()
    const cleanups: Array<() => void> = []
    const effect = vi.fn((execute: () => () => void) => {
      cleanups.push(execute())
    })

    apply({
      pages: { register: pageRegister, open },
      locale: { register: localeRegister },
      slots: { inject: slotInject, register: slotRegister },
      sessions: { open: openSession },
      effect,
    } as never)

    expect(name).toBe('@wha1echai/dsh-usage-app')
    expect(inject).toEqual(['pages', 'slots', 'locale', 'sessions'])
    expect(pageRegister).toHaveBeenCalledWith(expect.objectContaining({
      id: 'wha1echai.usage',
      surface: 'panel',
    }))
    expect(localeRegister).toHaveBeenCalledWith('usage', { zh, en })
    expect(slotInject).toHaveBeenCalledWith('webpage.app', expect.any(Function))
    expect(slotInject).toHaveBeenCalledWith('conversation.session.header.actions', expect.any(Function))
    expect(slotRegister).toHaveBeenCalledWith(expect.objectContaining({
      name: 'webpage.app',
      key: 'wha1echai.usage',
      inject: expect.any(Function),
    }), UsageAppBody)
    expect(slotRegister).toHaveBeenCalledWith({
      name: 'conversation.session.header.actions',
      id: 'wha1echai.usage',
      order: 30,
      locale: 'usage',
      inject: expect.any(Function),
    }, UsageHeaderAction)

    const appFace = (slotRegister.mock.calls[0]![0] as { inject(): { openSession(id: string): void } }).inject()
    appFace.openSession('session-1')
    expect(openSession).toHaveBeenCalledWith('session-1')
    const headerFace = (slotRegister.mock.calls[1]![0] as { inject(): { openUsage(): void } }).inject()
    headerFace.openUsage()
    expect(open).toHaveBeenCalledWith('wha1echai.usage', '/')

    cleanups[0]!()
    expect(unregisterHeader).toHaveBeenCalledOnce()
    expect(unregisterApp).toHaveBeenCalledOnce()
    expect(unregisterPage).toHaveBeenCalledOnce()
    expect(unregisterLocale).toHaveBeenCalledOnce()
  })

  it('keeps English keys identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('Usage App host and invariant entries', () => {
  it('registers Host routes when webServer is present and reserves package ownership', async () => {
    expect(applyHost).not.toThrow()
    const register = vi.fn(() => () => {})
    applyHost({
      effect: (fn: () => () => void) => { fn() },
      inject: (_deps, callback) => {
        callback({
          effect: (fn: () => () => void) => { fn() },
          get: (name: string) => name === 'webServer' ? { register } : undefined,
        })
      },
    })
    expect(register).toHaveBeenCalled()
    expect(invariantName).toBe('dsh-usage-app-invariant')
    expect(invariantInject).toEqual(['invariants'])
    const invariantRegister = vi.fn(() => () => {})
    const disposer = await applyInvariant({ invariants: { register: invariantRegister } } as never)
    expect(invariantRegister).toHaveBeenCalledWith('@wha1echai/dsh-usage-app', expect.any(Function))
    invariantRegister.mock.calls[0]![1]()
    disposer()
  })
})
