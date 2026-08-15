import { registerUsageRoutes, type UsageHostContext } from './http.js'

export interface UsageAppOwner {
  readonly appPath: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'wha1echai.usage.actions': {
      kind: 'list'
      scope: 'root'
      owner: UsageAppOwner
    }
  }
}

/** Host half: exact loopback routes. Missing peers skip routes. Never throws. */
export function apply(ctx?: UsageHostContext): void {
  if (ctx === undefined) return
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], inner => {
        registerUsageRoutes(inner)
      })
      return
    }
  } catch (error) {
    ctx.logger?.warn(`wha1echai-usage: inject webServer failed: ${String(error)}`)
  }
  registerUsageRoutes(ctx)
}
