# Project Structure

Reviewer-focused map of the repository. For setup, scripts, environment
variables, demo/live mode, and portfolio positioning, start with
[README.md](./README.md). For health, metrics, and troubleshooting, use
[docs/RUNBOOK.md](./docs/RUNBOOK.md).

## Quick Map

### App Router

- `src/app/page.tsx`
  - Server-renders the initial dashboard panel and passes `initialData` to the
    client dashboard.
- `src/app/stocks/[symbol]/page.tsx`
  - Route entry for the stock detail page.
- `src/app/layout.tsx`
  - Metadata, theme bootstrap, and root layout.
- `src/app/globals.css`
  - Active global styles.
- `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`
  - App Router error and not-found boundaries.

### Internal BFF Routes

- `src/app/api/panel/route.ts`
  - Market panels: `lider`, `general`, and `cedears`.
- `src/app/api/favorites/route.ts`
  - Validates favorite item requests and resolves quotes through bounded
    server-side fan-out.
- `src/app/api/stocks/[symbol]/quote/route.ts`
  - Current quote detail for one symbol.
- `src/app/api/stocks/[symbol]/history/route.ts`
  - Historical data for one symbol and range.
- `src/app/api/health/route.ts`
  - Runtime health and config/cache/rate-limit checks.
- `src/app/api/debug/metrics/route.ts`
  - Lightweight metrics endpoint.
- `src/app/api/token/route.ts`
  - Localhost-only token debug route.

### Dashboard Feature

- `src/features/dashboard/panel/`
  - Main dashboard coordinator, panel state, refresh behavior, toolbar/menu,
    loading and freshness UI, theme toggle, and floating actions.
- `src/features/dashboard/stocks/`
  - Stock table, row rendering, sorting, ticker display, and table layout
    helpers.
- `src/features/dashboard/favorites/`
  - Favorite persistence, favorite panel fetch/revalidation, and favorite
    button UI. The favorites SWR key and polling are disabled unless the
    Favorites panel is active.
- `src/features/dashboard/stock-detail/`
  - Detail modal/page, quote and history clients/hooks, current quote
    resolution, quote/history synchronization, live-session candle handling,
    and presentational detail sections. History responses retain
    symbol/market/range identity; previous request data is not displayed under
    a new selection.
- `src/features/dashboard/charts/`
  - Chart components, chart theme, and historical price calculations.
- `src/features/dashboard/shared/`
  - Shared client helpers, dashboard row model, ticker utilities, quote metric
    helpers, and JSON fetch wrapper.
`stock-detail` is intentionally separate from `panel`, `favorites`, `charts`,
and `shared` because stock detail has a distinct flow: choose or route to a
symbol, fetch quote/history detail, resolve the current quote, merge quote data
with history when appropriate, and render detail-specific sections. Chart
components remain in `charts` so they can stay focused on visualization, while
shared row/formatting utilities stay reusable across the dashboard.

### Shared Contracts

- `src/lib/market.ts`
  - Panel keys and market helpers.
- `src/lib/panel.ts`
  - Panel contract and payload normalization.
- `src/lib/stockHistory.ts`
  - Historical data contract and normalization.
- `src/lib/stockQuote.ts`
  - Current quote detail contract and normalization.
- `src/lib/favorites.ts`
  - Favorites request/response types and validation.
- `src/lib/formatters.ts`
  - Display formatting helpers.
- `src/lib/theme.ts`
  - Theme persistence types.

### Server-Only Layer

- `src/lib/server/core/env.ts`
  - Environment parsing, sensitive URL validation, TTL policy, and runtime
    summary.
- `src/lib/server/core/serverUrl.ts`
  - Shared absolute HTTP(S) URL validation for public and secret-bearing
    server endpoints, plus strict upstream-relative-path normalization and
    same-origin/base-path URL construction.
- `src/lib/server/core/httpResponse.ts`
  - Shared JSON response helper for route handlers.
- `src/lib/server/core/rateLimit.ts`
  - Rate-limit storage abstraction and failure behavior.
- `src/lib/server/core/observability.ts`
  - Request IDs, structured logging, metrics, and sanitization.
- `src/lib/server/core/debug.ts`
  - Debug route access checks.
- `src/lib/server/upstream/`
  - OAuth token cache, upstream API client, quote endpoint helpers, and quote
    cache. Its Favorites quote cache uses the shared stock quote TTL policy.
- `src/lib/server/panel/`
  - Panel request parsing, endpoint selection, cache, limits, and response
    helpers.
- `src/lib/server/history/`
  - History request parsing, endpoint selection, cache, rate limiting,
    response helpers, and service orchestration.
- `src/lib/server/favorites/`
  - Favorites request parsing, rate limiting, and server-side quote fan-out.
- `src/lib/server/quote/`
  - Current quote service orchestration and the individual quote cache using
    the same fresh/stale TTL policy as Favorites.
- `src/lib/server/demo/demoMarketData.ts`
  - Deterministic demo data source.

### Tests And Tooling

- Co-located `*.test.ts` and `*.test.tsx`
  - Unit, component, hook, route, and server tests.
- `e2e/`
  - Playwright dashboard and SSR boot tests.
- `vitest.config.ts`
  - Vitest configuration, V8 coverage, global thresholds, and critical-module
    non-regression thresholds.
- `playwright.config.ts`
  - Playwright configuration.
- `scripts/run-e2e.mjs`
  - Built-app runner for Playwright.
- `scripts/run-e2e-suite.mjs`
  - SSR and interactive E2E suite runner.
- `.github/workflows/ci.yml`
  - Least-privilege, SHA-pinned CI in demo mode: `quality`, `build`, and `e2e`
    jobs with concurrency cancellation and per-job timeouts.

## Architecture Rules

- The browser must not call the external market provider directly.
- External access must go through internal route handlers in `src/app/api/**`.
- Shared contracts and normalizers belong in `src/lib/**`.
- Server-only integration, caching, rate limiting, and observability belong in
  `src/lib/server/**`.
- Keep `runtime = 'nodejs'` on handlers that use server-side integration code.
- If an upstream or BFF contract changes, update validators, consumers, and
  tests in the same change.
- Do not pass raw upstream payloads into UI components.
- Do not duplicate existing contracts from `src/lib/market.ts`,
  `src/lib/panel.ts`, `src/lib/stockHistory.ts`, `src/lib/stockQuote.ts`, or
  `src/lib/favorites.ts`.
- Keep debug/token routes protected by environment, local-host checks, or
  observability token checks as applicable.

## Where To Work

### Dashboard UI

Start with:

- `src/features/dashboard/panel/Panel.tsx`
- `src/features/dashboard/panel/PanelContent.tsx`
- `src/features/dashboard/stocks/StockTable.tsx`
- `src/features/dashboard/stocks/Stock.tsx`
- `src/app/globals.css`

If behavior changes, also check nearby `*.test.tsx` files and:

- `src/features/dashboard/panel/useDashboardPanelState.ts`
- `src/features/dashboard/panel/useMarketPanel.ts`
- `src/features/dashboard/panel/panelState.ts`

### Stock Detail

Start with:

- `src/features/dashboard/stock-detail/StockDetailsContent.tsx`
- `src/features/dashboard/stock-detail/StockDetailsSections.tsx`
- `src/features/dashboard/stock-detail/StockDetailsModal.tsx`
- `src/features/dashboard/stock-detail/StockDetailPageClient.tsx`
- `src/features/dashboard/stock-detail/useStockHistory.ts`
- `src/features/dashboard/stock-detail/useStockQuote.ts`
- `src/features/dashboard/stock-detail/currentStockQuote.ts`
- `src/features/dashboard/stock-detail/historyQuoteSync.ts`
- `src/features/dashboard/stock-detail/liveSessionCandle.ts`
- `src/features/dashboard/stock-detail/currentQuoteTypes.ts`

### Market Panels

Start with:

- `src/app/api/panel/route.ts`
- `src/lib/panel.ts`
- `src/lib/market.ts`
- `src/lib/server/panel/panelCache.ts`
- `src/lib/server/panel/panelEndpoint.ts`
- `src/lib/server/demo/demoMarketData.ts`
- `src/features/dashboard/panel/marketPanelOptions.ts`

### Favorites

Start with:

- `src/features/dashboard/favorites/useFavoriteStocks.ts`
- `src/features/dashboard/favorites/useFavoritePanel.ts`
- `src/app/api/favorites/route.ts`
- `src/lib/favorites.ts`
- `src/lib/server/favorites/favoritesRequest.ts`
- `src/lib/server/favorites/favoritesService.ts`
- `src/lib/server/upstream/quoteCache.ts`

### Historical Data

Start with:

- `src/features/dashboard/charts/LightweightStockChart.tsx`
- `src/features/dashboard/charts/AdvancedStockDetailChart.tsx`
- `src/app/api/stocks/[symbol]/history/route.ts`
- `src/lib/stockHistory.ts`
- `src/lib/server/history/historyService.ts`
- `src/lib/server/history/historyCache.ts`

### Current Quote Integration

Start with:

- `src/app/api/stocks/[symbol]/quote/route.ts`
- `src/lib/stockQuote.ts`
- `src/lib/server/quote/quoteService.ts`
- `src/lib/server/upstream/quoteEndpoint.ts`
- `src/lib/server/upstream/quoteCache.ts`
- `src/features/dashboard/stock-detail/stockQuoteClient.ts`
- `src/features/dashboard/stock-detail/useStockQuote.ts`

### Upstream Integration

Start with:

- `src/lib/server/upstream/iol.ts`
- `src/lib/server/upstream/tokenCache.ts`
- `src/lib/server/upstream/quoteEndpoint.ts`
- `src/lib/server/core/env.ts`
- `src/lib/server/panel/panelEndpoint.ts`

### Security Or CSP

Start with:

- `middleware.ts`
- `next.config.mjs`
- `next.config.test.ts`
- `src/app/layout.tsx`
- `src/lib/server/core/debug.ts`

### CI Or Tests

Start with:

- `.github/workflows/ci.yml`
- `package.json`
- `vitest.config.ts`
- `playwright.config.ts`
- `scripts/run-e2e.mjs`
- `scripts/run-e2e-suite.mjs`

## Maintenance Notes

- `README.md` is the main document for portfolio review, setup, scripts, and
  operating modes.
- `docs/RUNBOOK.md` is the companion for health, degraded states, metrics, and
  troubleshooting.
- There is no `src/styles/` directory; active global styles are in
  `src/app/globals.css`.
- There is no Prisma, database, or seed workflow.
- Demo mode is a normal runtime mode, not only a test fixture.
- Tests are usually co-located with the unit they cover.
