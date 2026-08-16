# dsh-usage-app

Local token heatmap and Host-proxied provider balances as a Webpage App. Package `@dshapps/usage-app`. App ID `dshapps.usage`, `surface: 'panel'`.

The heatmap is local session tokens folded from live sessions plus persisted session logs. The balances are provider accounts queried by the Host. Credentials are resolved on the Host (`credentials.resolve`) and never reach the browser.

This App does not install community usage plugins. The fold and balance algorithms are adapted from [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) (MIT); see [NOTICE](NOTICE). Their Loader UI was not copied.

## What it does

- `/apps/dshapps.usage` and `/apps/dshapps.usage/YYYY-MM-DD` — today / month / all-time totals, four token buckets, month heatmap, day detail (models + sessions), Host-discovered provider balance cards, and subscription cards (OpenCode Go, Z.ai)
- Session rows open the live session (`sessions.open`). A conversation-header control deep-links back into this App
- Host routes (loopback GET only): `/api/dshapps-usage/summary`, `/api/dshapps-usage/day?date=`, `/api/dshapps-usage/balances`, `/api/dshapps-usage/subscriptions`
- Usage is folded from live `sessions.list()` plus `sessionPersistence` logs (`assistant/message` usage and `assistant/chunk` usage chunks). Day rows may carry `sessionQuery` titles when that peer is present
- Balances start from DeepSeek / OpenRouter / Moonshot / Z.ai schemes, then overlay `settings` + `llm.listProviders` / `listConfigurableProviders`. Cards with no public balance API or no credential stay off the panel; unknown routes are not guessed
- Incremental cache: `$DSH_HOME/storages/dshapps-usage-cache.json` (`DSH_HOME` defaults to `~/.dsh`)
- The pack inserts only this plugin

The browser only calls the local HTTP routes. Credentials stay on the Host.

## Requirements

- DSH `0.1.0-rc.6`
- Node `^22.19.0 || >=24.0.0`
- pnpm `11.7.0`
- `@dshapps/webpage` `0.2.0` present in the profile first

## Install

Nothing in this family is published to npm yet. Pack this App after a build, then add the tarball to a web profile that already has `@dshapps/webpage`:

```powershell
dsh plugin --profile web add .\dshapps-webpage-0.2.0.tgz
dsh plugin --profile web add .\dshapps-usage-app-0.2.0.tgz
```

## Verify

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

On machines where nested `pnpm run` resolves pnpm `11.0.9` against `packageManager: pnpm@11.7.0`, invoke the scripts directly: `node scripts/check.mjs --lint`, `node scripts/check.mjs --pack`, and `node node_modules/vitest/vitest.mjs run --coverage`.

## Family

The platform repository [dsh-webpage](https://github.com/Wha1eChai/dsh-webpage) holds the kernel, the authoring contract, and the docs. Apps live in their own repositories on purpose.
