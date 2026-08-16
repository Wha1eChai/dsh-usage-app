# 上游能力核对：DSH + dsh-webpage vs dsh-usage-app

- **日期：** 2026-08-16
- **范围：** `@wha1echai/dsh-usage-app` 当前消费面 vs `DSH` Host/client 接口 vs `dsh-webpage` 合同/kit/outlet vs 兄弟 App（notes / jobs / automations）已证明的形式。社区产品面只作功能清单，源是 Ychris `dsh-usage-stats` 官方 README（NOTICE 已引），不抄 UI。
- **方法：** 只读源码与第一方类型/官方文档。文档与源码冲突时信源码。未在树里出现的符号记为不存在。`dsh-webpage/docs/research/usage-app-candidates.md` 与 `docs/evidence/phase-0.5-usage-api-spike.md` 只当线索，不当事证。

读过的树：

| 树 | 路径 |
| --- | --- |
| 本 App | `dsh-usage-app/src/**`、`README.md`、`NOTICE` |
| DSH session | `DSH/packages/core/session/src/{index,surface,types}.ts` |
| DSH persistence | `packages/session/session-persistence/src/index.ts` |
| DSH credentials | `packages/credentials/credentials/src/index.ts` |
| DSH webServer | `packages/host/webserver/src/index.ts` |
| DSH settings / llm / token-meter / session-stats / session-query / storage / home-paths | 各包 `src/index.ts` 及直接引用的 types |
| DSH client | `packages/client/runtime/src/client/contract/{sessions,session}.ts`、`ui-primitives/src/index.ts`、`ui-theme/.../design-platform.css` |
| webpage | `packages/webpage/src/{ui,client/contract,client/route,client/outlet,client/slots,app-id,tools}.ts(x)`、`docs/guides/app-authoring.md`、`docs/adr/0005-*.md`、`.cursor/skills/dsh-app-authoring/SKILL.md` |
| 兄弟 | `dsh-notes-app/src/client/`、`dsh-jobs-app/src/client/`、`dsh-automations-app/src/` |
| 社区清单 | https://raw.githubusercontent.com/Ychris12138/dsh-usage-stats/main/README.md（本机无 clone） |

---

## 结论（先写）

**判断 1（DSH 暴露的 Host/client 面比本 App 用的多）成立。**

本 App Host 只软取 `webServer` / `sessions` / `sessionPersistence` / `credentials` / `settings`，且后四者各只用一角：`sessions.list()`、`sessionPersistence.list|listSnapshots|readFrom`、`credentials.resolve`、`settings.get('llm-deepseek')`。同一棵树上还有完整的 `SessionPersistence`（`load` / `inspect` / `prepare` / `locate` / `readRaw` / `create` / `append`）、`CredentialProvider.describe`、`SettingsProvider.describe`、`ctx.llm.listProviders|listConfigurableProviders|listModels`、`ctx.sessionQuery.listSessions|readTitle*`、`session/event` 火线、`ctx.tokenMeter` / `tokenUsage` 投影、`webServer.register({ kind: 'prefix' })` / `registerUpgrade` / SSE 长连接。客户端还有官方 `ctx.sessions.open(id)`（`ISessions.open`），本 App 未注入 `sessions`，会话行不可点。最硬证据：`SessionPersistence` 抽象类在 `DSH/packages/session/session-persistence/src/index.ts` 声明了 10+ 方法，本包 `PersistenceFace`（`src/collect.ts` L24–28）只收 3 个；`ISessions.open` 在 `packages/client/runtime/src/client/contract/sessions.ts` L41。

**判断 2（dsh-webpage 支持比 AppPage/AppList/AppFields 更自由的 UI）成立，但不是「换 surface」。**

`/ui` 是可选 kit，不是合同要求。ADR 0005 标题即 *「`/ui` is optional」*；`docs/guides/app-authoring.md` §6 写「optional」。Outlet 只包 chrome（标题 + 关闭），`main.body` 是 `overflow: auto` 的自由区。Notes 已在 `surface: 'panel'` 里自绘 composer / `<pre>` / CSS modules，并用 `navigate(\`/${id}\`)` 做嵌套路由。本 App 已经自绘热图网格，却把 day/balances 压成 kit 列表，且丢掉 `navigate` / `appPath` / `search`。最硬证据：`dsh-webpage/packages/webpage/src/client/outlet/AppOutlet.tsx` L45–77 的 chrome 只有 label+close；`AppOutlet.module.css` `.panel` 宽 `min(32rem, 100%)`、`.body { overflow: auto }`；`NotesApp.tsx` L92 `onClick={() => navigate(\`/${note.id}\`)}`。

**对「做成真正好用的用量台」：**

| 档 | 内容 |
| --- | --- |
| **数据已有、只差面板** | 四桶 token（`input/output/cacheRead/cacheWrite`）、`cacheHitRate`、按日/模型/会话拆分、余额 `granted/toppedUp/used/limit/currency`、订阅 `windows[].resetsAt` / `usedPercent`。Host 已算，面板几乎不画。 |
| **要接新的上游接口** | 客户端 `sessions.open(id)` 深链会话；`settings.describe` + `llm.listProviders/listConfigurableProviders` 发现真实供应商（不要写死四家）；可选 `sessionQuery.readTitle` 换会话标题；可选 Host `session/event` 或定时拉 summary 做刷新。 |
| **上游没有、不能幻想** | 官方跨会话日历 usage API、官方计价/花费（pi-ai `ModelCost` 被 harness 显式置零）、Tabs/Segment/Progress 原语、year heatmap kit、panel chrome 里的 header-actions 槽。`tokenUsage` / `sessionStats` 是**单会话**投影，不是账本。 |

---

## 1. 本 App 当前实际消费的上游面

| 符号 | 用在哪 | 用了多少 |
| --- | --- | --- |
| `webServer.register({ kind: 'exact', path, handler })` | `src/http.ts` `registerUsageRoutes` | 只 exact GET 四条：`/api/wha1echai-usage/{summary,day,balances,subscriptions}`。拒非 GET / 非 loopback。 |
| `ctx.inject(['webServer'], …)` 然后 `ctx.get('webServer')` | `src/index.ts` `apply`；`http.ts` `webServerOf` | 等 listen，避免硬 `inject` 挂起插件。 |
| `sessions.list()` | `src/collect.ts` `liveSessions` | 只要 `{ id, events[] }`。不用 `header` / `requestHeader()` / `requestContext()` / `deriveMessages()`。 |
| `sessionPersistence.list()` | `collect.ts` `foldPersisted` | 只要 `header.id`。`SessionHeader` 的 `createdAt` / `cwd` / `parentSession` / `agentPreset` 丢掉。 |
| `sessionPersistence.listSnapshots()` | 同上 | 只要 `header.id` + `revision` 做增量跳过。 |
| `sessionPersistence.readFrom(id, fromSeq)` | 同上 | 只要 `events`。返回的 `meta` 不用。 |
| `credentials.resolve(ref)` | `src/balances.ts`、`src/subscriptions.ts` | 只要 `hit.value`。不用 `source`，不用 `describe` / `set` / `unset`。 |
| `settings.get('llm-deepseek')` | `balances.ts` `providersFromSettings` | 只 overlay DeepSeek 的 `apiKeyEnv` / `baseURL`。不读 `llm-pi-ai`，不 `describe()`。 |
| `DSH_HOME` + 手写 JSON | `collect.ts` `cachePath` | `$DSH_HOME/storages/wha1echai-usage-cache.json`。不走 `ctx.storage`。 |
| `@wha1echai/dsh-webpage/ui`：`AppPage` `AppEmpty` `AppFields` `AppField` `AppList` `AppRow` | `src/client/UsageApp.tsx` | `AppPage.actions` 接空槽；`AppRow` 无 `onClick` / `trailing` / `leading`。未用 `AppActions`（被 `AppPage` 间接包）。 |
| DSH primitives：`Button` `Pill` `StateDot` `Tooltip` `IconChevronLeft/RightOutline14` | `UsageApp.tsx` | 月导航 + 订阅 plan 徽章 + 状态点 + 格 tooltip。 |
| `WebpageAppSlotProps`：`appPath` `navigate` `search` `hash` `close` | `UsageApp.tsx` L136 | 只把 `appPath` 塞进 owner。`navigate` / `search` / `hash` **未解构**。选日是 `useState`，不进 URL。 |
| `pages.register` + `slots.inject('webpage.app')` | `src/client/index.tsx` | `id: 'wha1echai.usage'`，`surface: 'panel'`，`inject: ['pages','slots','locale']`。无 `sessions`。 |
| 浏览器 `fetch` 三条 + day | `usage-view.ts` `loadUsagePanel` / `loadDay` | 挂载拉一次 summary/balances/subscriptions；换日再拉 day。无刷新、无轮询、无 SSE。 |

Host 已算、面板几乎不画：

| 字段 | 算出位置 | 面板现状 |
| --- | --- | --- |
| `TokenBuckets` 四桶 + `cacheHitRate` | `fold.ts` `renderUsage` / `renderDayDetail` | Hero 只画总 token + 总命中率。Day 只画总 token。模型/会话行只有总 token。 |
| `DayRow.models[]`（含四桶） | `fold.ts` `modelRows` | `AppRow.description` 只有 `tokens`。 |
| `SessionDayRow.id` + 四桶 | `fold.ts` `renderDayDetail` | 行标题是截断 id，不可点。 |
| `BalanceCard.granted/toppedUp/used/limit/currency` | `balances.ts` `cardFromParsed` | 只画 `remaining` + currency。 |
| `SubscriptionWindow.resetsAt` / `remainingPercent` | `subscriptions.ts` | 只画 `kind` + `usedPercent` + 自绘条。 |

---

## 2. DSH 已暴露、本 App 未用（或只用了一角）的接口

**调用约定（全表适用）：** Webpage App Host 半边**禁止** Node 入口硬 `export const inject = ['…']`（缺 peer 会把整插件挂 pending；`app-authoring.md` §7）。安全写法是 `ctx.get('name')` + 可选 `ctx.inject(['name'], cb)` 等待。客户端 `inject = ['pages','slots','locale']` 是 webpage 图硬依赖；再加 `sessions` 与 jobs 同形，web profile 里通常在。

### 高：做用量台几乎一定用得上

| 符号 | 签名 / 要点 | 源码 | 建议用法 |
| --- | --- | --- | --- |
| `ISessions.open` | `open(id: SessionId): void` | `packages/client/runtime/src/client/contract/sessions.ts` L41 | 客户端加 `inject: ['sessions']`，day 会话行 `onClick → ctx.sessions.open(id)`。官方「打开某个 session」。 |
| `AppRow.onClick` + `trailing` | `onClick?: () => void`；`trailing?: ReactNode` | `dsh-webpage/packages/webpage/src/ui/AppList.tsx` L18–19 | 会话行可点；trailing 放 token / 模型 pill。不必等新 kit。 |
| `navigate(appPath, { search, hash, replace })` | `AppOwnerProps.navigate` | `webpage/src/client/contract.ts` L60–62；`route/controller.ts` L129–136 | 选日写成 `/apps/wha1echai.usage/2026-08-16` 或 `?date=`。刷新/分享/agent `open_app` 的 `path` 才能落地。 |
| `settings.describe()` | `describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]` | `packages/settings/settings/src/index.ts` L479 | 列出已注册 ns（含 `llm-pi-ai`），发现真实供应商，而不是写死四家。Host 软取。 |
| `settings.get('llm-pi-ai')` | `get(ns): unknown` | 同上 L519；ns 在 `llm-pi-ai/src/index.ts` `settingsNamespace('llm-pi-ai')` | 读 `providers` dict：每路由 `apiKeyEnv` / `baseURL` / `displayName`。 |
| `llm.listProviders()` | `(): LlmProviderInfo[]` → `{ id, name }` | `packages/llm/llm/src/index.ts` L419 | 当前**已注册**路由。软取 `llm`。 |
| `llm.listConfigurableProviders()` | `(): LlmConfigurableProvider[]` | 同上 L490 | 可配置但可能休眠的路由（含未配 key 的 pi-ai 目录项）。 |
| `llm.listModels(provider)` | `(provider: string) => Promise<LlmModelInfo[]>` | 同上 L581 | 模型表/过滤。advisory，不改路由。 |
| `credentials.describe(ref)` | `(ref: CredentialRef) => Promise<CredentialInfo>` → `{ configured, source?, writable }` | `packages/credentials/credentials/src/index.ts` L81 | 「未配置」不必 `resolve` 出 value；value 仍不得下发浏览器。 |
| `SessionHeader` 已有字段 | `createdAt`, `cwd`, `parentSession`, `agentPreset`, `origin` | `packages/core/session/src/types.ts` L61–98 | `list()` / `listSnapshots()` 已带回。会话行可显示日期/工作区，不必再 `load`。 |
| `TokenBuckets` 四桶（本包已有） | `inputTokens` … `cacheWriteTokens` | `src/fold.ts` L11–16；对齐 `TokenUsage`（`llm/src/types.ts` L135） | 面板拆 input/output/cache。`reasoningTokens` 官方在 output 里，不要再加一列当独立花费。 |
| `BalanceCard` 细字段（本包已有） | `granted` `toppedUp` `used` `limit` | `src/balances.ts` L8–11 | 卡上画构成，不要只画 remaining。 |
| `SubscriptionWindow.resetsAt`（本包已有） | `resetsAt?: string` | `src/subscriptions.ts` L10 | 画「下次重置」。 |
| `session/event` | `ctx.on('session/event', (session, event) => …)` | `packages/core/session/src/index.ts` L76 | Host 软听，增量折或标脏再拉。不要硬 inject `sessions`。 |
| `webServer.register` 不限 method | `handler` 自管响应；注释写明可 SSE | `packages/host/webserver/src/index.ts` L32–33 | 若要推送：同 path 上 SSE（仍 loopback）。本包政策是只 GET；加 POST 是产品选择，不是 harness 禁令。 |
| `IconRefreshOutline16` 等 | primitives 公共导出 | `ui-primitives/src/index.ts`；icons `src/icons/index.tsx` | 标题栏手动刷新。kit 无 refresh 原语，用 Button+icon。 |

### 中：能明显变好，但可后做

| 符号 | 签名 / 要点 | 源码 | 建议用法 |
| --- | --- | --- | --- |
| `sessionQuery.listSessions` | `(): Promise<SessionRecord[]>`（`header` + `live` + `persisted`） | `packages/session-query/session-query/src/index.ts` L134 | 统一活+盘会话目录。软取；硬 inject 会在无 sqlite 后端时挂起。 |
| `sessionQuery.readTitle` / `readTitleSnapshots` | `(id) => Promise<SessionTitleSnapshot \| undefined>` | 同上 L173–215 | 会话行用标题代替截断 id。 |
| `sessionQuery.filterSessions` / `searchSessions` | 元数据过滤 / 全文 | 同上 L113、L159 | 按 cwd/标题搜会话。对账本不是刚需。 |
| `ISessions.search` | `(query, signal) => Promise<RpcResult<…>>` | `client/runtime/.../contract/sessions.ts` L83 | 客户端搜消息，不是 token 账本。 |
| `SessionFace.projections.faceOf('tokenUsage')` | 单会话四桶 | `token-meter/src/projection.ts` L13；`contract/session.ts` L19 | 打开某会话后显示其累计。**不能**替代跨会话日历 fold。 |
| `sessionStats` 投影 | `{ turns, steps, llmMs, toolMs, ttftMs, … }` | `session-stats/src/types.ts` L22 | 会话耗时，不是 token。插件 `inject = ['sessionProjections']`。 |
| `tokenMeter.measure(session)` | 当前请求压力 / surface tokens | `token-meter/src/index.ts` L116 | 上下文占用，不是账单。 |
| `webServer.register({ kind: 'prefix' })` | 最长前缀 | `webserver/src/index.ts` L24、L241 | `/api/wha1echai-usage/*` 一处登记。现四 exact 已够。 |
| `ctx.effect` + 定时器 | Host 已有 `effect` | 本包 `http.ts` `UsageHostContext.effect` | Ychris 每 5 分钟后台刷。本包是打开才拉。 |
| `credentials/updated` | `notifyUpdated` 后 fan-out | `credentials/src/index.ts` L115 | 配了 key 后刷新余额卡。 |
| `Pill` 作过滤器 | `active` + `onClick` → `<button>` | `ui-primitives/src/Pill.tsx` L7–12 | 月/年、供应商切换。注释就写「view switcher tabs」。无独立 Tabs 组件。 |
| `DisclosureRow` | 受控展开行 | `ui-primitives/src/DisclosureRow.tsx` L7 | 日明细里折叠模型/会话。 |
| `Menu` | 受控下拉 | `ui-primitives/src/Menu.tsx` | 月份/供应商选择。 |
| `HoverCard` | 可停留预览 | `ui-primitives/src/HoverCard.tsx` | 比 Tooltip 更适合会话预览。 |
| `Input` | 单行；textarea 不在此 | `ui-primitives/src/Input.tsx` L1–2 | 会话搜索。多行不要用它。 |
| `Modal` | 全视口 dialog | `ui-primitives/src/Modal.tsx` | 日详情弹层。与 App `surface: 'modal'` 不是一回事。 |
| `Toast` / `writeClipboard` | 公共导出 | `ui-primitives/src/index.ts` L26–27 | 刷新失败、复制 session id。 |
| `pages.open(id, path, { search })` | 从会话头打开本 App | `contract.ts` L34；jobs `index.tsx` L56 | 对标 jobs 的 `conversation.session.header.actions`。 |
| `open_app` tool | webpage Host 已注册 | `webpage/src/tools.ts` L4 | 已有。本 App 不消费 path，agent 深链日期会丢。 |
| `sessionPersistence.list` 全 header | `list(): Promise<SessionHeader[]>` | `session-persistence/src/index.ts` L228 | 用 `createdAt`/`cwd`，不必 `inspect`。 |

### 低 / 不要碰

| 符号 | 签名 / 要点 | 源码 | 为何不要 |
| --- | --- | --- | --- |
| `sessionPersistence.load` | `(id) => Promise<SessionInspection>`；会 **commit 冷恢复** | `session-persistence/src/index.ts` L183 | 读模型应走 `readFrom`。`load` 会写盘修尾。 |
| `sessionPersistence.inspect` | 不写盘；可能占 prepare 缓存 | 同上 L200 | 全量日志。本包已有增量 `readFrom`。 |
| `sessionPersistence.prepare` | 给 resume 的未发布 Session | 同上 L155 | 打开会话是客户端 `sessions.open`，不是 Host prepare。 |
| `sessionPersistence.create` / `append` | 写路径 | 同上 L133、L143 | 用量台只读。 |
| `sessionPersistence.locate` / `readRaw` | 工件路径 / 原文 | 同上 L96、L119 | 路径不是授权令牌；原文含提示词，禁止下发浏览器。 |
| `credentials.set` / `unset` | 写密钥 | `credentials/src/index.ts` L91、L99 | 用量台不是配密钥页。 |
| `credentials.resolve` 把 value 放进 JSON | 已有 resolve | `balances.ts` `resolveKey` | **红线**：key 只留 Host。响应不得带 value。 |
| `settings.update` / `replace` | 写用户层 | `settings/src/index.ts` L534、L548 | 不要从用量台改模型设置。 |
| `SessionStore.create` / `fork` / `flush` | Host 会话生命周期 | `core/session/src/index.ts` L830、L1081、L1022 | 用量台不创建/分叉会话。客户端 fork 也不是用量功能。 |
| `SessionFace.prompt` / `cancel` / `command` | 会话动词 | `contract/session.ts` L41–81 | 不是用量台。 |
| `sessionTelemetry` / `session-telemetry/record` | 外发 OTel | `packages/session/session-telemetry/src/index.ts` | 观测出口，不是账本。记录含 `event.data` 深拷贝，接上易泄内容。 |
| `ctx.storage` / `storage-json` | hub + 命名 backend | `storage/src/index.ts`；`storage-json` `inject = ['storage']` | 硬 inject 会挂起。现手写 JSON 已够。要迁也只能软取，且无「随便写文件」API——要 `kv` unit。 |
| `webServer.registerFallback` / `tapIndex` | 单座 fallback = SPA | `webserver/src/index.ts` L125、L139 | 抢 fallback 会炸 web 组合。不要静态托管。 |
| `webServer.registerUpgrade` | 精确路径 upgrade | 同上 L109 | 用量不需要 WS。SSE 用普通 handler 即可。 |
| `webServer` 绑 `0.0.0.0` | `Config.host` | 同上 L47 | 本包 loopback 篱笆必须留。不要为「方便」放宽。 |
| 官方 **pricing / cost / spend** API | **不存在** | `llm-pi-ai/src/catalog.ts` L28–32：*「harness never reads pi-ai's cost metadata — replay.ts zeroes it and no consumer reports spend」* | 不能编花费。token ≠ 钱。 |
| 官方跨会话 **usage/stats 日历** | **不存在** | `tokenUsage` 是单会话累计（`token-meter/src/projection.ts` L8）；`sessionStats` 是 wall time | 日历账本继续用本包 fold。不要改折算法（产品目标）。 |
| `sessionQuery.readSession` / `readSurface` / `readEvent` | 全日志 / surface | `session-query/src/index.ts` L144、L263、L307 | 把对话内容带进用量 Host 无收益，有泄密面。 |
| `tool-session-query` | agent 工具 | `packages/session-query/tool-session-query` | 给模型搜历史，不是面板。 |

### 必须覆盖的判定（汇总）

| 题目 | 判定 |
| --- | --- |
| **sessionPersistence 全表面** | 本包已用 `list` / `listSnapshots` / `readFrom`（增量折的正确三件套）。`load`/`inspect`/`prepare`/`locate`/`readRaw`/`create`/`append` 对用量台低价值或有害。缺的是把 `list` 已返回的 `SessionHeader` 字段用起来。 |
| **官方 usage / stats / telemetry / pricing** | `tokenUsage`（单会话四桶）、`sessionStats`（单会话耗时）、`tokenMeter.measure`（压力）、`sessionTelemetry`（外发）。**无**跨会话日历、**无**计价。本包 fold 就是官方真空下的正确读模型。 |
| **settings / llm 全供应商目录** | 本包只 overlay `llm-deepseek`。完整目录 = `settings.get('llm-pi-ai').providers` ∪ `llm.listProviders()` ∪ `llm.listConfigurableProviders()`。pi-ai 内置 id 来自 `catalogProviderIds()` → `getBuiltinProviders()`（`llm-pi-ai/src/catalog.ts` L140），**不是**写死的 openrouter/moonshot/zai。 |
| **客户端打开某个 session** | 官方：`ctx.sessions.open(id)`（`ISessions.open`）。兄弟：`ui-workflow-run` `openSession: (id) => ctx.sessions.open(id)`。**没有** `pages.open(sessionId)`。`navigate` 只走 `/apps/<appId>/*`。 |
| **实时 session 事件** | Host：`session/event`（及 `session/created` / `disposed` / `flush`）。Client：`ctx.sessions.list` 是 `ObservableSnapshot<SessionListState>`，jobs 已订阅；**不含** token 增量。实时用量仍要 Host 折 + 拉/推 HTTP。 |
| **sessionQuery** | 存在，包在 `packages/session-query/session-query`。对用量：标题与目录（中）。不要当 fold 数据源（会丢掉增量缓存优势，且 `readSession` 拉全文）。 |
| **storage API vs 手写 JSON** | `ctx.storage` 是 backend 注册表 + domain form，不是「往 `storages/` 丢文件」。本包手写 `$DSH_HOME/storages/*.json` 与 Ychris 同形，且对齐 `dsh-home-paths` 的 `DSH_HOME` / `~/.dsh`。迁 storage 不是用量台前置。 |
| **webServer 除 exact GET** | `kind: 'prefix' \| 'exact'`；`registerUpgrade`；`registerFallback`；`tapIndex`；handler 可 POST/SSE。本包自我限制 GET+loopback 是篱笆，不是 harness 上限。不要碰 fallback。 |

---

## 3. dsh-webpage 实际支持的 UI 自由度

### kit 真实导出与 props（对照 usage）

`packages/webpage/src/ui/index.ts` 只导出 7 个组件。没有第八个。

| 组件 | 真实 props | usage 用了？ | 未用的有用 props |
| --- | --- | --- | --- |
| `AppPage` | `title` `description?` `actions?` `actionsLabel?` `children?` | 是 | `actions` 接了空槽，本 App 自己没放刷新钮 |
| `AppActions` | `label?` `children?`；无贡献则 `null` | 间接（AppPage 尾部） | 可单独把刷新放底部；**不是** chrome header |
| `AppEmpty` | `children` only | 是 | 无 icon 槽（notes 自包一层） |
| `AppFields` | `children` only | 是 | **无 `className` / variant**。hero 靠 `:global(dl)` 黑进 |
| `AppField` | `field` `label` `value` `valueClassName?` | 是 | 无堆叠布局。默认两列 label\|value（`kit.module.css` `.field`） |
| `AppList` | `label?` `dense?` `children` | 是 | — |
| `AppRow` | `title` `description?` `icon?` `leading?` `trailing?` `children?` `onClick?` `titleAs?` `dense?` `className?` `data-app-id?` `data-job-id?` | 只用 title/description/dense | **onClick / trailing / leading / icon**。无 `data-session-id` |

`AppPage` 结构（`AppPage.tsx` L16–24）：`<header>`（h1+description）→ `{children}` → `<AppActions>`。扩展 actions 在**内容下方**，不在 Outlet chrome。

### 自由 React + primitives + CSS modules 是否被合同允许？

**允许，而且是设计。**

| 主张 | 源 |
| --- | --- |
| `/ui` 可选，不是 `register()` 参数 | ADR 0005 标题与 Decision 3：`dsh-webpage/docs/adr/0005-launcher-switcher-and-app-surfaces.md` L19 |
| 指南 §6：「`@wha1echai/dsh-webpage/ui` is optional」 | `docs/guides/app-authoring.md` L78 |
| Skill：「App 的本职是 design tokens and layout」；平台缺的控件用 token+CSS 自绘 | `.cursor/skills/dsh-app-authoring/SKILL.md` L39–51 |
| 本 App 热图已是自绘 grid | `UsageApp.module.css` `.cells`；`UsageApp.tsx` `HeatmapDay` |
| Notes 在 panel 里自绘 textarea / `<pre>` / 空态图标 | `NotesApp.tsx` L61–80；`NotesApp.module.css` |

合同要求：token 用 `--dsw-alias-*`（`design-platform.css`）；能用 primitives 就不要手搓 Button/Pill/Tooltip；第三方组件库和客户端路由器都在 checker 黑名单里。

### 路由 / search / hash / navigate

| 能力 | 源 | 对本 App |
| --- | --- | --- |
| URL = `/apps/<id>` + `appPath` + `search` + `hash` | `route/parser.ts` L20–41 | `/apps/wha1echai.usage/2026-08-16` 合法 |
| `appPath` 必须绝对、无 `?`/`#`/`..` | `app-id.ts` `isValidAppPath` L14–28 | 日期用 path 段或 search，不要塞进非法 path |
| `navigate(appPath, { search, hash, replace })` | `controller.ts` L129–136 | 省略 search/hash 会**清空**它们（`contract.ts` L52） |
| `pages.open(id, path?, options?)` | `contract.ts` L34 | jobs header、`open_app` 卡都走这条 |
| `open_app` 的 `path` | `tools.ts` L41–44；测试 `open-app.spec.tsx` 用 `wha1echai.usage` + `/today` | 本 App 忽略 `appPath`，深链无效 |
| 无第三方路由器 | skill 硬禁 | 用 props + `data-route`（notes/jobs 模式） |

**可以**一个 App 嵌套路由。**可以** `?date=`。本 App 两者都没接。

### panel chrome 约束

| 事实 | 源 |
| --- | --- |
| panel 宽 `min(32rem, 100%)`，右缘抽屉，左侧半透明 mask 可点关 | `AppOutlet.module.css` L42–50、L21–25 |
| overlay 铺满 `inset: 0` | 同文件 L10–15 |
| modal `min(40rem, 100vw-2rem)` | L104–107 |
| chrome = 标题 + 关闭；**无 header-actions 槽** | `AppOutlet.tsx` L68–73 |
| body `flex: 1; overflow: auto` | `AppOutlet.module.css` L95–102 |
| Escape 关 panel/overlay（modal 走 Modal） | `AppOutlet.tsx` L34–42、L92 |
| 不要在 body 里再做「关闭 App」 | `app-authoring.md` §2 |
| `formatSessionId` 注释写「300px panel」 | `usage-view.ts` L109 | **与源码不符**。panel 是 32rem（512px），不是 300。 |

**保持 `surface: 'panel'` 就能做更密的内部。** ADR 0005：panel =「对话应保持可见（Jobs, usage, boards）」；overlay = 全框工作台。Ychris 自己的浮层是 440px 月历，比 32rem 还窄。换 overlay 只在要做 53 周 year heatmap 或并排多表时才有必要——而第一方 Ychris README 也是**月历**，不是年热图。

### 已知 token / kit 陷阱（已回源码）

| 陷阱 | 验证 |
| --- | --- |
| 浅色主题 `bg-layer-1/2/3` 同为 `--dsw-static-neutral-bluish-00` | `design-platform.css` L157–160。深度只能靠 `border-l*` + 间距。本 App 热图/卡已用 `border-l3`，对。 |
| **不存在** `--dsw-alias-fill-l2` | `design-platform.css` 无此名。jobs `JobsApp.module.css` L14 在用 → 浅色下静默失效。不要抄。 |
| `Pill` 默认填 `bg-layer-2`，放在 layer-2 卡上浅色隐形 | skill + `ui-kit-gaps.md`（线索）；本 App 订阅 Pill 叠在 `.card`（`bg-layer-2`）上，浅色会吃这个。 |
| `AppRow dense` 去掉边框 | `kit.module.css` `.rowDense` L71–76 `border: none`。浅色下边框是唯一深度。 |
| `AppRow` 省略号截尾，对 `session-<uuid>` 无效 | `kit.module.css` `.rowTitle` `text-overflow: ellipsis`。本包 `formatSessionId` 是对的，不是长久 kit 解。 |
| 无 shadow / elevation token | `bg-mask-*` 是遮罩（`design-platform.css` L161–165）。不要发明 box-shadow 色。 |
| `Button` 默认 `type="button"`，可用 rest 覆盖 | `Button.tsx` L26。表单提交要显式 `type="submit"`（notes 已做）。 |
| `IconWarningOutline16` 默认画 14px | `icons/index.tsx` L474 `size = 14`。 |
| 无 Tabs / Segmented / Progress 组件 | `ui-primitives/src/index.ts` 公共表无这些名字。进度条本 App 已自绘（`.bar/.fill`）。过滤器用 `Pill`。 |

---

## 4. 兄弟 App 已证明、用量 App 没走的形式

| 模式 | 谁 | 源码 | 用量现状 |
| --- | --- | --- | --- |
| `navigate(\`/${id}\`)` 嵌套列表/详情 | notes, jobs | `NotesApp.tsx` L92；`JobsApp.tsx` L60 | 选日只 `setSelected`，URL 不变 |
| 按 `appPath` 分支 + `data-route` | notes, jobs, automations | `NotesApp.tsx` L59/L110/L135；`JobsApp.tsx` L42 | 永远 `data-route="/"` |
| 非法 path → Unavailable + 回列表 | notes, jobs | `NotesApp.tsx` L128；`JobsApp.tsx` L96 | 无 |
| 会话头深链 `pages.open(APP_ID, '/')` | jobs | `JobsApp/src/client/index.tsx` L50–58 `conversation.session.header.actions` | 无入口（只有 launcher） |
| 客户端 `inject: ['sessions']` + `useSessions` 直播 | jobs, automations | `JobsApp.tsx` L118；`AutomationsApp.tsx` L28 | 无。打开后数据冻住 |
| `AppRow.onClick` + `leading`/`trailing` | notes, jobs, automations | `JobsApp.tsx` L51–60；`AutomationsApp.tsx` L90–107 | 行不可点，无 trailing |
| 自绘空态（icon + `AppEmpty`） | notes | `NotesApp.tsx` L77–80 | 纯 `AppEmpty` 句子 |
| 自定义 CSS modules 超 kit | notes（composer/pre）、jobs（duration）、本 App（热图） | `NotesApp.module.css`；`JobsApp.module.css` | 热图有，day/余额仍是 kit 列表 |
| 行内 `Button` 操作（pause/run） | automations | `AutomationsApp.tsx` L91–107 | 无刷新/打开会话钮 |
| Host RPC + `useSyncExternalStore` 刷新 | automations | `AutomationsApp.tsx` L56–61 | 只 fetch 一次 |
| 活任务 1s tick | jobs | `JobsApp.tsx` L128–133 | 无。订阅 `resetsAt` 也不会自己倒计时 |
| `surface: 'panel'` 做完整内部 | 三个兄弟全是 panel | 各 `index.tsx` descriptor | 已是 panel；内部不必换 overlay |

---

## 5. 做成用量台的改造地图（只建议，不实施）

对照社区第一方清单（Ychris README「一眼看懂 / 使用」；**不是**年热图——该 README 写的是「月历热图」「今日、本月、累计」）：

### 功能模块补全

| 模块 | 档 | 说明 |
| --- | --- | --- |
| Hero：今日 / 本月 / 累计 + 四桶拆分 + 命中率 | **只改本包 UI，数据已有** | `UsageRender.days` + `total` 已含。按 `dayKey(now)` 滤今日、按 `YYYY-MM` 滤本月。 |
| Day 模型表：四桶 + 命中率 | **只改 UI** | `DayDetail.models` 已有。 |
| Day 会话表：四桶 + 可点打开 | **UI + 接 DSH** | 数据已有。打开要客户端 `sessions.open`。标题可选 `sessionQuery.readTitle` 或 `SessionHeader.createdAt`。 |
| 余额卡：granted / toppedUp / used / limit | **只改 UI** | `BalanceCard` 已有。 |
| 订阅卡：`resetsAt`、双窗口 | **只改 UI** | `windows[]` 已有。条已自绘，不必等 Progress kit。 |
| 选日进 URL（`/date` 或 `?date=`） | **只改本包 UI**（合同已有 navigate） | 接上 `appPath`/`search`。让 `open_app` path 生效。 |
| 手动刷新 | **只改 UI** | `IconRefreshOutline16` + 重跑 `loadUsagePanel`。可放 `AppPage.actions` 或自绘顶栏（不要塞进 Outlet chrome）。 |
| 供应商发现（不写死 4 家） | **要接 DSH** | 软 `settings.describe` + `llm.listProviders` + `listConfigurableProviders`。无公开余额 API 的路由显示「不支持」，不要猜。 |
| 打开后自动刷新 / 后台 5min | **要接 DSH 或本包 Host 定时** | `session/event` 标脏，或 `effect` 定时；或客户端 interval。不要硬 inject。 |
| 会话头「用量」钮 | **要接 DSH client slot** | 抄 jobs：`conversation.session.header.actions` + `pages.open`。 |
| Kimi / MiniMax / New API / 声明式 monitor | **不要当本迭代必做** | 上游无现成 adapter。Ychris 是他们自己的 Host 协议。本包要做等于新写余额方案，不是「接接口」。 |
| 花费 / 单价 / 年热图 kit | **不要做（上游没有）** | 无 pricing API。kit 无年历。32rem 年热图也挤。若要年视，App 自绘且建议 overlay——非本阶段。 |
| 改 fold / 换 tokenMeter | **不要做** | 产品目标禁止改折算法。`tokenUsage` 不能替代日历账本。 |
| 把 key 或 raw log 下发浏览器 | **不要做** | 合同红线。 |

### 界面样式

| 项 | 档 | 说明 |
| --- | --- | --- |
| Hero 统计块（大数字、多列） | **只改 UI**；kit 无 `variant="stat"` | 继续 `:global` 或自绘 `<dl>`。不必等 kit。 |
| 小节标题 | **只改 UI** | 已有 `.heading`。可统一。 |
| 余额/订阅改密卡（构成 + 条 + 重置） | **只改 UI** | 已有 `.card` 网格。浅色靠 border，不要换 layer。 |
| `Pill` 在卡上隐形 | **只改 UI** | 给 Pill 加本地边框/`bg-skeleton`，或不用 Pill 改 caption。 |
| 模型/会话 `AppRow` 加 trailing + onClick | **只改 UI**（打开会话另接 DSH） | kit 已有 props。 |
| 空态加 icon | **只改 UI** | 抄 notes：`IconDataOutline16` / `IconWarningOutline16` + `AppEmpty`。 |
| 供应商/月份 `Pill` 或 `Menu` 过滤 | **只改 UI** | primitives 已有。无 Tabs。 |
| 热图保持自绘 | **故意不进 kit** | skill：热图用 token+grid。第二个 App 要热图再进 kit。 |
| 换 `overlay` | **不要做（除非年视）** | panel 32rem + 可滚已够月台。对话应保持可见（ADR 0005）。 |
| 抄 jobs `--dsw-alias-fill-l2` | **不要做** | token 不存在。 |
| 等 webpage 出 Progress/Tabs/stat Field | **要等 kit 或自绘** | 自绘已合法。等 kit 会挡住用量台。 |

---

## 6. 开放问题 / 我无法从源码判定的点

1. **本机 web profile 是否总是装 `llm-pi-ai` + `session-query-sqlite` + `sessionProjections`。** 接口在树里；具体 profile 的 `cordis.yml` 未在本次逐行对安装清单。因此「软取 llm / sessionQuery」的空窗行为必须当可选 peer 写，不能假定一定在。
2. **`catalogProviderIds()` 的运行时具体 id 列表**取决于安装的 `@earendil-works/pi-ai` 版本（`getBuiltinProviders()`）。源码只保证「目录来自 pi-ai」，不在本仓库写死 openai/anthropic/…。做供应商发现要运行时问 `llm` / `settings`，不要把 id 写进本包。
3. **Ychris 当前产品面（v0.2.0 README）没有 year heatmap、没有 cost。** 用户清单里的「年热图 / 花费」在第一方 README 对不上。本机无 Ychris clone，未打开其 `lib/client.js` 核实是否有未写入 README 的年视。清单以 README 为准：月历、今日/本月/累计、按日/供应商/模型下钻、标题栏刷新、当前供应商切换、5 分钟后台刷。
4. **`SessionSummary.projectionValues` 是否在 web 组合里带 `tokenUsage`。** 类型允许（`service.ts` L72），是否投影取决于 Host 是否装 token-meter + session-projection。不能当客户端日历数据源。
5. **`open_app` 的 `path` 与客户端 `isValidAppPath` 是否已对齐。** webpage `tools.ts` 与 `app-id.ts` 现共用同一函数；历史证据曾记过 Host 更松。以当前源码为准：已对齐。本 App 不读 path 才是缺口。
6. **硬 inject `sessions` 是否会在「无会话服务的瘦 profile」挂起客户端。** jobs 已这么做。用量若要 `open()`，与 jobs 同风险。未读所有官方 profile 清单，无法证伪「永远有 sessions」。

---

## 附录：Ychris 功能清单 vs 本包（第一方 README，不抄 UI）

| Ychris 人能看见的 | 本包 Host 载荷 | 本包 Loader UI |
| --- | --- | --- |
| 今日 / 本月 / 累计 token | 有（`days` + `total`） | 只有累计 |
| 缓存命中率 | 有 | 只有总命中率 |
| 月历热图 + 换月 | 有（`days[]`） | 有 |
| 按日下钻模型 | 有（`/day` models） | 只有模型名+总 token |
| 按日下钻会话 | 有（`/day` sessions） | 截断 id + 总 token，不可点 |
| 按供应商拆 token | **无**（fold 键是 `provider/model` 字符串，未单独聚合 provider） | 无 |
| 余额卡构成 | 有（granted/toppedUp/used/limit） | 只 remaining |
| 订阅窗口 + 重置 | 有（`resetsAt`） | 只 percent 条 |
| 当前供应商切换 / provider 列表 API | 写死 4+2，无 `/providers` | 全画在一页 |
| 标题栏刷新 | 无（打开拉一次） | 无 |
| 5 分钟后台刷 | 无 | 无 |
| 年热图 / 花费 | 其 README 也无 | 无；上游也无定价 |
