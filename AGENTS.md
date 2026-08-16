# AGENTS

Independent DSH Webpage App. Package `@wha1echai/dsh-usage-app`. App ID `wha1echai.usage`, `surface: 'panel'`. Peer on `@wha1echai/dsh-webpage`: public `/client` types only, never Webpage source paths.

The heatmap is local session tokens. Balances and subscriptions are Host-proxied provider accounts. Credentials stay on the Host (`credentials.resolve`) and never reach the browser. Keep `surface: 'panel'`. Do not rewrite the fold algorithm.

## Invariants

- Pin DSH packages to `0.1.0-rc.6`. Package manager is `pnpm@11.7.0`. Node is `^22.19.0 || >=24.0.0`.
- Host `apply` soft-gets `webServer` via `ctx.inject(['webServer'], …)` or `ctx.get`. Soft-get `llm` / `sessionQuery` / other optional peers. Do not hard-`inject` Host peers.
- HTTP is loopback GET only: `/api/wha1echai-usage/summary`, `/day?date=`, `/balances`, `/subscriptions`.
- Balance schemes are a closed alias set: `deepseek` / `deepseek-official`, `openrouter`, `moonshot` / `kimi`, `zai` / `z.ai` / `glm`. Unknown routes are `unsupported`; do not guess HTTP.
- The panel shows only `ok` and `error` cards (`visibleAccountCards` in `src/client/usage-view.ts`). Hide `missing` (no credential) and `unsupported` (no public balance API). Omit the whole section when the filtered list is empty.
- Selected day is the URL: `/apps/wha1echai.usage/YYYY-MM-DD`. `/` and `/today` mean today. Invalid paths `replace` to today.
- Session rows call `ctx.sessions.open`. The conversation header action opens `pages.open('wha1echai.usage', '/')`.
- Chinese locale is the source of truth; English keys must match. Tokens are `--dsw-alias-*` only (never `--dsw-alias-fill-l2`). Light theme: `bg-layer-1/2/3` are the same white — depth from borders.
- Do not invent pricing or a year heatmap. Do not change `applyUsageDelta` / turn:step replace.
- `dsh-app-check` scans `*.md` and source. Do not name the adjacent official DSH checkout (`['deepseek', 'harness'].join('-')`) or the forbidden UI/router libraries listed in that checker's `FORBIDDEN_UI` regex.

## Layout

- `src/index.ts` — Host `apply()`
- `src/fold.ts` — token fold (do not change the math)
- `src/collect.ts` — live sessions + persistence logs; titles via `sessionQuery` when present
- `src/balances.ts` / `src/subscriptions.ts` / `src/http.ts` — provider discovery, OpenCode Go + Z.ai windows, routes
- `src/client/` — `UsageApp`, header action, locales, view helpers
- `tests/` — Host, fold, and panel tests
- `dsh-app-check.config.mjs` — `expectedClientInject` and packed allowlist
- `docs/research/` — dated capability notes; treat as stale if they disagree with source

Client inject is `['pages', 'slots', 'locale', 'sessions']`. `dsh.client.inject` also lists `@wha1echai/dsh-webpage`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-ui-conversation`.

## Verify

`pnpm verify`, or the pieces: `tsc -b`, `node scripts/check.mjs --lint`, `node node_modules/vitest/vitest.mjs run --coverage`, `pnpm run build`, `node scripts/check.mjs --pack`.

Coverage floors: lines 98, functions 96, statements 98, branches 85.

If nested `pnpm run` resolves pnpm `11.0.9` against `packageManager: pnpm@11.7.0`, invoke the scripts directly as in the README.

## Pack into a web profile

Version is still `0.1.0`, so a new `file:` directory is required or pnpm will keep the old tarball.

1. `pnpm run build` then `pnpm pack --pack-destination` under `$DSH_HOME/packages/dsh-usage-app/<new-dir>/`.
2. Point the profile `package.json` dependency, `pnpm.overrides`, and `pnpm-workspace.yaml` override at that tarball.
3. `dsh plugin --profile web add <tarball>` forwards to PATH pnpm. On Windows that pnpm may want store `v10` while this profile's `node_modules` is `v11`. If so, add with Local pnpm 11 and `--store-dir` pointing at the parent of `store/v11` (pnpm 11 appends `v11`).
4. Restart `dsh web` to load the new client bundle.

Do not commit machine-local profile paths. The pack `files` allowlist is the publish surface; `AGENTS.md` and `docs/` stay out of the tarball.

## Shipped panel

Hero (today / this month / all-time + four buckets + cache hit), provider-filtered heatmap, day detail, session open, balance breakdown, localized subscription windows, manual refresh plus a five-minute interval, hidden missing/unsupported cards.
