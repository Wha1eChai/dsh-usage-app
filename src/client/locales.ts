export const zh = Object.freeze({
  title: '用量',
  description: '热图是本机会话折算的 token。余额是 Host 代查的供应商账户，密钥不会下发到浏览器。',
  listTitle: '本月用量',
  listEmpty: '这个月还没有用量',
  heatmap: '月热图',
  previousMonth: '上个月',
  nextMonth: '下个月',
  dayDetail: '当日明细',
  models: '模型',
  sessions: '会话',
  tokens: 'Token',
  cacheHit: '缓存命中',
  balances: '供应商余额',
  subscriptions: '订阅额度',
  missing: '未配置密钥',
  error: '查询失败',
  remaining: '剩余',
  loadError: '用量接口不可用。确认 Host 半边已激活。',
  loading: '正在读取本机账本…',
  actions: '扩展操作',
  noModels: '这一天没有模型明细',
  noSessions: '这一天没有会话明细',
})

export const en = Object.freeze({
  title: 'Usage',
  description: 'The heatmap is local session tokens. Balances are Host-proxied provider accounts; keys never reach the browser.',
  listTitle: 'This month',
  listEmpty: 'No usage this month',
  heatmap: 'Month heatmap',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  dayDetail: 'Day detail',
  models: 'Models',
  sessions: 'Sessions',
  tokens: 'Tokens',
  cacheHit: 'Cache hit',
  balances: 'Provider balances',
  subscriptions: 'Subscriptions',
  missing: 'No credential',
  error: 'Lookup failed',
  remaining: 'Remaining',
  loadError: 'Usage API unavailable. Confirm the Host half is active.',
  loading: 'Reading the local ledger…',
  actions: 'Extension actions',
  noModels: 'No model rows for this day',
  noSessions: 'No session rows for this day',
})

export type UsageLocaleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    usage: UsageLocaleKey
  }
}
