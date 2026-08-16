import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AppField, AppFields } from '@wha1echai/dsh-webpage/ui'
import { formatTokens, type PeriodTotals } from './usage-view.js'
import styles from './UsagePeriodHero.module.css'

export type LedgerPeriod = 'today' | 'month' | 'all'

export interface UsagePeriodHeroProps {
  totals: PeriodTotals
  period: LedgerPeriod
  onPeriod: (period: LedgerPeriod) => void
  t: PropsLocale<'usage'>['t']
}

const PERIODS = ['today', 'month', 'all'] as const satisfies readonly LedgerPeriod[]

const PERIOD_LABELS = {
  today: 'today',
  month: 'thisMonth',
  all: 'allTime',
} as const

function formatCacheHit(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${rate}%`
}

export function UsagePeriodHero({ totals, period, onPeriod, t }: UsagePeriodHeroProps): JSX.Element {
  const selected = totals[period]
  return (
    <div className={styles.hero}>
      <div className={styles.periods} role="group" aria-label={t('tokens')}>
        {PERIODS.map(id => (
          <Pill key={id} active={period === id} onClick={() => onPeriod(id)}>
            {t(PERIOD_LABELS[id])}
          </Pill>
        ))}
      </div>
      <div className={styles.primary}>
        <AppFields>
          <AppField
            field="tokens"
            label={t('tokens')}
            value={formatTokens(selected.tokens)}
            valueClassName={styles.heroValue}
          />
        </AppFields>
      </div>
      <div className={styles.buckets}>
        <AppFields>
          <AppField field="input" label={t('input')} value={formatTokens(selected.inputTokens)} />
          <AppField field="output" label={t('output')} value={formatTokens(selected.outputTokens)} />
          <AppField field="cache-read" label={t('cacheRead')} value={formatTokens(selected.cacheReadTokens)} />
          <AppField field="cache-write" label={t('cacheWrite')} value={formatTokens(selected.cacheWriteTokens)} />
          <AppField field="cache" label={t('cacheHit')} value={formatCacheHit(selected.cacheHitRate)} />
        </AppFields>
      </div>
    </div>
  )
}
