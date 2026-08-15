import { lazy } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { AppDescriptor } from '@wha1echai/dsh-webpage/client'

import { en, zh } from './locales.js'

export const UsageAppBody = lazy(async () => {
  const module = await import('./UsageApp.js')
  return { default: module.UsageApp }
})

const descriptor = Object.freeze({
  id: 'wha1echai.usage',
  label: 'Usage',
  description: 'Local token heatmap and Host-proxied provider balances.',
  order: 30,
  categories: ['ops'],
  surface: 'panel',
}) satisfies AppDescriptor

const LOCALE_NAMESPACE = 'usage'
const APP_ID = 'wha1echai.usage'

export const name = '@wha1echai/dsh-usage-app'
export const inject = ['pages', 'slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const unregisterLocale = ctx.locale.register(LOCALE_NAMESPACE, { zh, en })
    const unregisterPage = ctx.pages.register(descriptor)
    const unregisterApp = ctx.slots.inject('webpage.app', () => ctx.slots.register({
      name: 'webpage.app',
      key: APP_ID,
      locale: LOCALE_NAMESPACE,
      children: {
        'wha1echai.usage.actions': { kind: 'list', scope: 'root' },
      },
    }, UsageAppBody))

    return () => {
      unregisterApp()
      unregisterPage()
      unregisterLocale()
    }
  }, 'dsh-usage-app: composition')
}

export type { UsageAppProps } from './UsageApp.js'
