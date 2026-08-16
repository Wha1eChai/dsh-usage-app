import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import styles from './UsageHeaderAction.module.css'

interface UsageHeaderInjection {
  openUsage(): void
}

export type UsageHeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'usage'>
  & InjectFace<UsageHeaderInjection>

export function UsageHeaderAction({ openUsage, t }: UsageHeaderActionProps): JSX.Element {
  const label = t('headerAria')
  return (
    <button
      type="button"
      className={styles.trigger}
      aria-label={label}
      title={label}
      onClick={openUsage}
    >
      {t('header')}
    </button>
  )
}
