import { useEffect, useState } from 'react'
import { Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BalanceCard } from '../balances.js'
import type { SubscriptionCard, SubscriptionWindow } from '../subscriptions.js'
import { formatResetAt, visibleAccountCards } from './usage-view.js'
import styles from './UsageAccountPane.module.css'

export type UsageAccountPaneProps = {
  readonly balances: readonly BalanceCard[]
  readonly subscriptions: readonly SubscriptionCard[]
  readonly t: PropsLocale<'usage'>['t']
}

const WINDOW_KEYS = {
  session: 'windowSession',
  weekly: 'windowWeekly',
  monthly: 'windowMonthly',
  billing: 'windowBilling',
} as const

function statusLabel(status: string, t: UsageAccountPaneProps['t']): string {
  return status === 'error' ? t('error') : t('remaining')
}

function statusDot(status: string): StateDotState {
  return status === 'error' ? 'error' : 'done'
}

function windowLabel(kind: SubscriptionWindow['kind'], t: UsageAccountPaneProps['t']): string {
  return t(WINDOW_KEYS[kind])
}

function BalanceMeta({ card, t }: { card: BalanceCard; t: UsageAccountPaneProps['t'] }) {
  if (card.status !== 'ok') return null
  const lines: { key: string; label: string; value: number }[] = []
  if (card.granted !== undefined) lines.push({ key: 'granted', label: t('granted'), value: card.granted })
  if (card.toppedUp !== undefined) lines.push({ key: 'toppedUp', label: t('toppedUp'), value: card.toppedUp })
  if (card.used !== undefined) lines.push({ key: 'used', label: t('used'), value: card.used })
  if (card.limit !== undefined) lines.push({ key: 'limit', label: t('limit'), value: card.limit })
  if (lines.length === 0) return null
  return (
    <>
      {lines.map(line => (
        <p key={line.key} className={styles.cardMeta}>{line.label} {line.value}</p>
      ))}
    </>
  )
}

function selectedCard<T extends { readonly id: string }>(
  cards: readonly T[],
  selectedId: string | undefined,
): T | undefined {
  return cards.find(card => card.id === selectedId) ?? cards[0]
}

/** One visible balance and one visible subscription; switch with pills. */
export function UsageAccountPane({ balances, subscriptions, t }: UsageAccountPaneProps) {
  const visibleBalances = visibleAccountCards(balances)
  const visibleSubscriptions = visibleAccountCards(subscriptions)
  const [selectedBalanceId, setSelectedBalanceId] = useState(visibleBalances[0]?.id)
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState(visibleSubscriptions[0]?.id)

  useEffect(() => {
    if (selectedBalanceId !== undefined && visibleBalances.some(card => card.id === selectedBalanceId)) return
    setSelectedBalanceId(visibleBalances[0]?.id)
  }, [visibleBalances, selectedBalanceId])

  useEffect(() => {
    if (selectedSubscriptionId !== undefined && visibleSubscriptions.some(card => card.id === selectedSubscriptionId)) return
    setSelectedSubscriptionId(visibleSubscriptions[0]?.id)
  }, [visibleSubscriptions, selectedSubscriptionId])

  const selectedBalance = selectedCard(visibleBalances, selectedBalanceId)
  const selectedSubscription = selectedCard(visibleSubscriptions, selectedSubscriptionId)

  if (visibleBalances.length === 0 && visibleSubscriptions.length === 0) return null

  return (
    <div className={styles.pane}>
      {selectedBalance === undefined
        ? null
        : (
          <section className={styles.section} aria-label={t('balances')}>
            <h2 className={styles.heading}>{t('balances')}</h2>
            {visibleBalances.length > 1
              ? (
                <div className={styles.pills} role="group" aria-label={t('balances')}>
                  {visibleBalances.map(card => (
                    <Pill
                      key={card.id}
                      active={card.id === selectedBalance.id}
                      onClick={() => setSelectedBalanceId(card.id)}
                    >
                      {card.displayName}
                    </Pill>
                  ))}
                </div>
              )
              : null}
            <article className={styles.card} data-provider={selectedBalance.id} data-status={selectedBalance.status}>
              <h3 className={styles.cardTitle}>{selectedBalance.displayName}</h3>
              <p className={styles.status}>
                <StateDot state={statusDot(selectedBalance.status)} />
                <span>
                  {statusLabel(selectedBalance.status, t)}
                  {selectedBalance.status === 'ok' && selectedBalance.remaining !== undefined
                    ? ` ${selectedBalance.remaining}${selectedBalance.currency === undefined ? '' : ` ${selectedBalance.currency}`}`
                    : ''}
                  {selectedBalance.status !== 'ok' && selectedBalance.message !== undefined
                    ? ` · ${selectedBalance.message}`
                    : ''}
                </span>
              </p>
              <BalanceMeta card={selectedBalance} t={t} />
            </article>
          </section>
        )}
      {selectedSubscription === undefined
        ? null
        : (
          <section className={styles.section} aria-label={t('subscriptions')}>
            <h2 className={styles.heading}>{t('subscriptions')}</h2>
            {visibleSubscriptions.length > 1
              ? (
                <div className={styles.pills} role="group" aria-label={t('subscriptions')}>
                  {visibleSubscriptions.map(card => (
                    <Pill
                      key={card.id}
                      active={card.id === selectedSubscription.id}
                      onClick={() => setSelectedSubscriptionId(card.id)}
                    >
                      {card.displayName}
                    </Pill>
                  ))}
                </div>
              )
              : null}
            <article
              className={styles.card}
              data-subscription={selectedSubscription.id}
              data-status={selectedSubscription.status}
            >
              <div className={styles.cardHead}>
                <h3 className={styles.cardTitle}>{selectedSubscription.displayName}</h3>
                <Pill active className={styles.pillOnCard}>{selectedSubscription.plan}</Pill>
              </div>
              <p className={styles.status}>
                <StateDot state={statusDot(selectedSubscription.status)} />
                <span>{statusLabel(selectedSubscription.status, t)}</span>
              </p>
              {selectedSubscription.windows.map(window => (
                <div key={window.kind} className={styles.window}>
                  <p className={styles.cardMeta}>{windowLabel(window.kind, t)} {window.usedPercent}%</p>
                  {window.resetsAt !== undefined
                    ? <p className={styles.cardMeta}>{t('resetsAt')} {formatResetAt(window.resetsAt)}</p>
                    : null}
                  <div className={styles.bar}><div className={styles.fill} style={{ width: `${window.usedPercent}%` }} /></div>
                </div>
              ))}
            </article>
          </section>
        )}
    </div>
  )
}
