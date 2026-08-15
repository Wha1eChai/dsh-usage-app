# dsh-usage-app

Local token heatmap and Host-proxied provider balances as a Webpage App (`wha1echai.usage`, `surface: 'panel'`).

This is a first-party App. It does **not** install community usage plugins. The fold and balance algorithms are adapted from [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) (MIT); see [NOTICE](NOTICE). Their Loader UI is not included.

## What it does

- `/apps/wha1echai.usage` — month heatmap, day detail (models + sessions), four provider balance cards, OpenCode Go + Z.ai subscription cards
- Host routes (loopback GET only): `/api/wha1echai-usage/summary`, `/day?date=`, `/balances`, `/subscriptions`
- Usage is folded from live `sessions.list()` plus `sessionPersistence` logs (`assistant/message.usage` / usage chunks). Incremental cache: `$DSH_HOME/storages/wha1echai-usage-cache.json`
- Keys stay on the Host (`credentials.resolve`). The browser only calls the local HTTP routes.

The heatmap is local session tokens. Balances are Host-proxied provider accounts.

## Requirements

- DSH `0.1.0-rc.6`
- `@wha1echai/dsh-webpage` `0.1.0` installed first
