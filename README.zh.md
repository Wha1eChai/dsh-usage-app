# dsh-usage-app

[English](README.md) | 中文

本地 token 热力图，加上 Host 代理的供应商余额，做成一个 Webpage App。包名 `@dshapps/usage-app`。App ID `dshapps.usage`，`surface: 'panel'`。

热力图是本机会话 token：活着的 session 加上已落盘的 session 日志折到一起。余额是 Host 去查的供应商账户。凭据在 Host 上解析（`credentials.resolve`），不会进浏览器。

这个 App 不安装社区 usage 插件。折算和余额算法改编自 [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)（MIT）；见 [NOTICE](NOTICE)。没有抄他们的 Loader UI。

## 做什么

- `/apps/dshapps.usage` 和 `/apps/dshapps.usage/YYYY-MM-DD` — 今天 / 本月 / 全部合计、四个 token 桶、月热力图、日明细（模型 + 会话）、Host 发现的供应商余额卡，以及订阅卡（OpenCode Go、Z.ai）
- 会话行打开活着的 session（`sessions.open`）。对话标题栏有一个控件可以深链回这个 App
- Host 路由（只允许 loopback GET）：`/api/dshapps-usage/summary`、`/api/dshapps-usage/day?date=`、`/api/dshapps-usage/balances`、`/api/dshapps-usage/subscriptions`
- Usage 从活着的 `sessions.list()` 加上 `sessionPersistence` 日志折出（`assistant/message` usage 和 `assistant/chunk` usage chunks）。有 `sessionQuery` 时，日行可以带标题
- 余额从 DeepSeek / OpenRouter / Moonshot / Z.ai 方案起步，再叠 `settings` + `llm.listProviders` / `listConfigurableProviders`。没有公开余额 API 或没有凭据的卡不出现；未知路由不猜
- 增量缓存：`$DSH_HOME/storages/dshapps-usage-cache.json`（`DSH_HOME` 默认 `~/.dsh`）
- pack 只插入本插件

浏览器只打本机 HTTP 路由。凭据留在 Host。

## 要求

- DSH `0.1.0-rc.6`
- Node `^22.19.0 || >=24.0.0`
- pnpm `11.7.0`
- profile 里先有 `@dshapps/webpage` `0.2.0`

## 安装

这一家都还没上 npm。构建后打包这个 App，再加到已经有 `@dshapps/webpage` 的 web profile：

```powershell
dsh plugin --profile web add .\dshapps-webpage-0.2.0.tgz
dsh plugin --profile web add .\dshapps-usage-app-0.2.0.tgz
```

## 校验

```powershell
corepack pnpm@11.7.0 install --frozen-lockfile
corepack pnpm@11.7.0 run verify
```

有些机器上嵌套的 `pnpm run` 会按 `packageManager: pnpm@11.7.0` 解析到 pnpm `11.0.9`，这时直接跑：`node scripts/check.mjs --lint`、`node scripts/check.mjs --pack`，以及 `node node_modules/vitest/vitest.mjs run --coverage`。

## 这一家

平台仓库 [dsh-webpage](https://github.com/dshapps/dsh-webpage) 放内核、写作合同和文档。新 App 从 [dsh-app-template](https://github.com/dshapps/dsh-app-template) 起步。App 故意各自独立成库。

使用 [MIT License](LICENSE)。
