import { lazy } from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { AppDescriptor } from '@dshapps/webpage/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import { UsageHeaderAction } from './UsageHeaderAction.js'
import { en, zh } from './locales.js'

export const UsageAppBody = lazy(async () => {
  const module = await import('./UsageApp.js')
  return { default: module.UsageApp }
})

const descriptor = Object.freeze({
  id: 'dshapps.usage',
  label: 'Usage',
  description: 'Local token heatmap and Host-proxied provider balances.',
  order: 30,
  categories: ['ops'],
  surface: 'panel',
}) satisfies AppDescriptor

const LOCALE_NAMESPACE = 'usage'
const APP_ID = 'dshapps.usage'

export const name = '@dshapps/usage-app'
export const inject = ['pages', 'slots', 'locale', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const unregisterLocale = ctx.locale.register(LOCALE_NAMESPACE, { zh, en })
    const unregisterPage = ctx.pages.register(descriptor)
    const unregisterApp = ctx.slots.inject('webpage.app', () => ctx.slots.register({
      name: 'webpage.app',
      key: APP_ID,
      locale: LOCALE_NAMESPACE,
      children: {
        'dshapps.usage.actions': { kind: 'list', scope: 'root' },
      },
      inject: () => ({
        openSession: (id: string) => { ctx.sessions.open(id as SessionId) },
      }),
    }, UsageAppBody))
    const unregisterHeader = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'dshapps.usage',
      order: 30,
      locale: LOCALE_NAMESPACE,
      inject: () => ({
        openUsage: () => ctx.pages.open(APP_ID, '/'),
      }),
    }, UsageHeaderAction))

    return () => {
      unregisterHeader()
      unregisterApp()
      unregisterPage()
      unregisterLocale()
    }
  }, 'dsh-usage-app: composition')
}

export type { UsageAppProps } from './UsageApp.js'
export type { UsageHeaderActionProps } from './UsageHeaderAction.js'
