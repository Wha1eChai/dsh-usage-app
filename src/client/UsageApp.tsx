import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconDataOutline16,
  IconRefreshOutline16,
  IconWarningOutline16,
  Pill,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { WebpageAppSlotProps } from '@wha1echai/dsh-webpage/client'
import { AppEmpty, AppField, AppFields, AppList, AppPage, AppRow } from '@wha1echai/dsh-webpage/ui'
import type { DayDetail } from '../fold.js'
import type { UsageAppOwner } from '../index.js'
import type { HeatmapCell, UsagePanelData } from './usage-view.js'
import {
  dateFromPath,
  filterDaysByProvider,
  formatBucketSummary,
  formatSessionId,
  formatTokens,
  loadDay,
  loadUsagePanel,
  monthGrid,
  monthLabel,
  pathFromDate,
  periodTotals,
  shiftMonth,
  todayKey,
  tokensByProvider,
} from './usage-view.js'
import { UsageAccountPane } from './UsageAccountPane.js'
import { UsagePeriodHero, type LedgerPeriod } from './UsagePeriodHero.js'
import styles from './UsageApp.module.css'

interface UsageAppInject {
  openSession?(id: string): void
}

export type UsageAppProps =
  WebpageAppSlotProps
  & PropsRenderSlots<'wha1echai.usage.actions'>
  & PropsLocale<'usage'>
  & InjectFace<UsageAppInject>
  & { openSession?: (id: string) => void }

const WEEKDAY_KEYS = ['weekday0', 'weekday1', 'weekday2', 'weekday3', 'weekday4', 'weekday5', 'weekday6'] as const
const HEAT_LEVELS = [0, 1, 2, 3, 4] as const
const REFRESH_MS = 5 * 60 * 1000

function bucketLabels(t: UsageAppProps['t']): {
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
} {
  return { input: t('input'), output: t('output'), cacheRead: t('cacheRead'), cacheWrite: t('cacheWrite') }
}

function formatCacheHit(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${rate}%`
}

function cellTooltip(cell: HeatmapCell, t: UsageAppProps['t']): string {
  return `${cell.date} · ${t('tokens')} ${formatTokens(cell.tokens)}`
}

function EmptyFace({ warning, children }: { warning?: boolean; children: string }) {
  const Icon = warning === true ? IconWarningOutline16 : IconDataOutline16
  return (
    <div className={styles.emptyState}>
      <Icon className={styles.emptyIcon} size={32} />
      <AppEmpty>{children}</AppEmpty>
    </div>
  )
}

function HeatmapDay({ cell, selected, t, onSelect }: {
  cell: HeatmapCell
  selected: string
  t: UsageAppProps['t']
  onSelect: (date: string) => void
}) {
  return (
    <Tooltip label={cellTooltip(cell, t)} side="top">
      <button
        type="button"
        data-day={cell.date}
        data-level={cell.level}
        aria-label={cell.date}
        className={[
          styles.cell,
          cell.inMonth ? undefined : styles.out,
          styles[`level${cell.level}`],
          cell.date === selected ? styles.selected : undefined,
        ].filter(Boolean).join(' ')}
        onClick={() => onSelect(cell.date)}
      />
    </Tooltip>
  )
}

function DayDetailSection({ day, selected, t, openSession }: {
  day: DayDetail | undefined
  selected: string
  t: UsageAppProps['t']
  openSession?: (id: string) => void
}) {
  if (day === undefined || (day.totals?.tokens ?? 0) === 0) {
    return (
      <section className={styles.section} aria-label={t('dayDetail')}>
        <h2 className={styles.heading}>{t('dayDetail')} {selected}</h2>
        <EmptyFace>{t('listEmpty')}</EmptyFace>
      </section>
    )
  }
  const totals = day.totals
  const labels = bucketLabels(t)
  return (
    <section className={styles.section} aria-label={t('dayDetail')}>
      <h2 className={styles.heading}>{t('dayDetail')} {selected}</h2>
      <div className={styles.dayFields}>
        <AppFields>
          <AppField field="day-tokens" label={t('tokens')} value={formatTokens(totals.tokens)} />
          <AppField field="day-input" label={t('input')} value={formatTokens(totals.inputTokens ?? 0)} />
          <AppField field="day-output" label={t('output')} value={formatTokens(totals.outputTokens ?? 0)} />
          <AppField field="day-cache-read" label={t('cacheRead')} value={formatTokens(totals.cacheReadTokens ?? 0)} />
          <AppField field="day-cache-write" label={t('cacheWrite')} value={formatTokens(totals.cacheWriteTokens ?? 0)} />
          <AppField field="day-cache" label={t('cacheHit')} value={formatCacheHit(totals.cacheHitRate)} />
        </AppFields>
      </div>
      {day.models.length === 0
        ? <EmptyFace>{t('noModels')}</EmptyFace>
        : (
          <AppList dense label={t('models')}>
            {day.models.map(model => (
              <AppRow
                key={model.model}
                dense
                title={model.model}
                description={formatBucketSummary(model, labels)}
                trailing={formatTokens(model.tokens)}
              />
            ))}
          </AppList>
        )}
      {day.sessions.length === 0
        ? <EmptyFace>{t('noSessions')}</EmptyFace>
        : (
          <AppList dense label={t('sessions')}>
            {day.sessions.map(session => (
              <AppRow
                key={session.id}
                dense
                data-app-id={session.id}
                title={<span title={session.id}>{session.title ?? formatSessionId(session.id)}</span>}
                description={formatBucketSummary(session, labels)}
                trailing={formatTokens(session.tokens)}
                onClick={openSession === undefined ? undefined : () => openSession(session.id)}
              />
            ))}
          </AppList>
        )}
    </section>
  )
}

/** Local ledger heatmap plus Host-proxied provider cards. */
export function UsageApp({ appPath, navigate, renderSlot, t, openSession }: UsageAppProps) {
  const owner: UsageAppOwner = Object.freeze({ appPath })
  const actions = renderSlot('wha1echai.usage.actions', owner)
  const pathDate = dateFromPath(appPath)
  const selected = pathDate ?? todayKey()
  const [panel, setPanel] = useState<UsagePanelData | undefined>()
  const [day, setDay] = useState<DayDetail | undefined>()
  const [cursor, setCursor] = useState(selected)
  const [provider, setProvider] = useState('all')
  const [period, setPeriod] = useState<LedgerPeriod>('today')
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (pathDate !== null) return
    navigate(pathFromDate(todayKey()), { replace: true })
  }, [navigate, pathDate])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void loadUsagePanel().then(next => {
      if (cancelled) return
      setPanel(next)
      setError(undefined)
      setLoading(false)
    }, reason => {
      if (cancelled) return
      setError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadDay(selected).then(next => {
      if (!cancelled) setDay(next)
    }, () => {
      if (!cancelled) setDay(undefined)
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  useEffect(() => {
    let cancelled = false
    const timer = window.setInterval(() => {
      setRefreshing(true)
      void Promise.all([loadUsagePanel(), loadDay(selected)]).then(([next, nextDay]) => {
        if (cancelled) return
        setPanel(next)
        setDay(nextDay)
        setError(undefined)
        setRefreshing(false)
      }, () => {
        if (!cancelled) setRefreshing(false)
      })
    }, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selected])

  const refresh = () => {
    setRefreshing(true)
    void Promise.all([loadUsagePanel(), loadDay(selected)]).then(([next, nextDay]) => {
      setPanel(next)
      setDay(nextDay)
      setError(undefined)
      setRefreshing(false)
    }, () => {
      setRefreshing(false)
    })
  }

  const days = panel?.summary.days ?? []
  const filteredDays = useMemo(() => filterDaysByProvider(days, provider), [days, provider])
  const grid = useMemo(() => monthGrid(cursor, filteredDays), [cursor, filteredDays])
  const totals = useMemo(() => periodTotals(filteredDays), [filteredDays])
  const providers = useMemo(() => tokensByProvider(days), [days])

  return (
    <article data-route={`/${selected}`}>
      <AppPage title={t('title')} description={t('description')} actions={actions} actionsLabel={t('actions')}>
        {loading && panel === undefined ? <EmptyFace>{t('loading')}</EmptyFace> : null}
        {error !== undefined && !loading && panel === undefined ? <EmptyFace warning>{t('loadError')}</EmptyFace> : null}
        {panel !== undefined
          ? (
            <>
              <div className={styles.toolbar}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconRefreshOutline16 />}
                  aria-label={t('refresh')}
                  aria-busy={refreshing}
                  disabled={refreshing}
                  onClick={refresh}
                />
              </div>
              <UsagePeriodHero totals={totals} period={period} onPeriod={setPeriod} t={t} />
              <div className={styles.providers} data-provider-filter role="group" aria-label={t('providers')}>
                <Pill active={provider === 'all'} onClick={() => setProvider('all')}>{t('allProviders')}</Pill>
                {providers.map(item => (
                  <Pill
                    key={item.provider}
                    active={provider === item.provider}
                    onClick={() => setProvider(item.provider)}
                  >
                    {item.provider}
                  </Pill>
                ))}
              </div>
              <section className={styles.heatmap} aria-label={t('heatmap')}>
                <div className={styles.nav}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronLeftOutline14 />}
                    aria-label={t('previousMonth')}
                    onClick={() => setCursor(current => shiftMonth(current, -1))}
                  />
                  <p className={styles.monthLabel}>{monthLabel(cursor)}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronRightOutline14 />}
                    aria-label={t('nextMonth')}
                    onClick={() => setCursor(current => shiftMonth(current, 1))}
                  />
                </div>
                <div className={styles.calendar}>
                  <div className={styles.weekdays}>
                    {WEEKDAY_KEYS.map(key => <span key={key} className={styles.weekday}>{t(key)}</span>)}
                  </div>
                  <div className={styles.cells}>
                    {grid.cells.map(cell => (
                      <HeatmapDay
                        key={cell.date}
                        cell={cell}
                        selected={selected}
                        t={t}
                        onSelect={date => navigate(pathFromDate(date))}
                      />
                    ))}
                  </div>
                  <div className={styles.legend}>
                    <span className={styles.legendLabel}>{t('heatmapLess')}</span>
                    <span className={styles.legendSwatches}>
                      {HEAT_LEVELS.map(level => (
                        <span key={level} className={[styles.swatch, styles[`level${level}`]].join(' ')} />
                      ))}
                    </span>
                    <span className={styles.legendLabel}>{t('heatmapMore')}</span>
                  </div>
                </div>
              </section>
              <DayDetailSection day={day} selected={selected} t={t} openSession={openSession} />
              <UsageAccountPane
                balances={panel.balances}
                subscriptions={panel.subscriptions}
                t={t}
              />
            </>
          )
          : null}
      </AppPage>
    </article>
  )
}
