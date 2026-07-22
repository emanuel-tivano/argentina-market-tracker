# Runbook

Operational notes for the production-oriented demo deployment of
`argentina-market-tracker`.

## Fast Checks

### Health

```bash
curl -i http://localhost:3000/api/health/live
curl -i http://localhost:3000/api/health/ready
```

Expected:

- liveness always returns HTTP `200` with `status: "ok"` while the process can
  execute basic application code; it never contacts Redis or the market provider
- readiness returns HTTP `200` with `status: "ready"` when the configured
  rate-limit backend is usable or is not required in the selected mode
- readiness returns HTTP `503` with `status: "not-ready"` when Redis REST is
  required but missing, invalid, unreachable, timed out, or returned an invalid
  response
- `X-Request-Id` response header for correlation

Readiness uses a read-only Redis `PING`, the configured Redis REST timeout, and
a process-local five-second result cache. Concurrent probes share one request.
Probe responses and logs never include the Redis URL, token, command payload, or
backend response body. A probe interval of roughly 10 seconds is recommended so
routine monitoring normally benefits from the short cache without masking a
sustained failure.

`GET /api/health` remains available as a compatibility diagnostic endpoint. It
keeps its existing contract and HTTP `200` behavior, including
`status: "degraded"`; do not use it as a readiness probe. Existing monitors
should migrate to `/api/health/live` and `/api/health/ready`.

Endpoint roles are intentionally different:

- `/api/health/live`: process liveness only; no Redis or market-provider call
- `/api/health/ready`: dependency readiness; returns `503` when required Redis
  configuration is insecure/incomplete or the probe fails
- `/api/health`: HTTP `200` compatibility diagnostics; reports invalid live
  `API_URL` under `checks.config.invalidLiveConfig` and Redis URL failures under
  `checks.rateLimit`

### Debug Metrics

Development and test:

```bash
curl -i http://localhost:3000/api/debug/metrics
```

Production:

```bash
curl -i \
  -H "x-observability-token: $OBSERVABILITY_DEBUG_TOKEN" \
  https://your-deploy.example.com/api/debug/metrics
```

Notes:

- Do not share `OBSERVABILITY_DEBUG_TOKEN`.
- The endpoint returns aggregated metrics only, not raw upstream payloads.
- If the token is missing or invalid in production, the endpoint returns
  `404` or `401` without revealing metrics.

## Configuration Reference

All TTLs and timeouts below use milliseconds. Invalid, non-integer, or
out-of-range values fall back to the documented default. For each fresh/stale
pair, `fresh` must be lower than `stale`; otherwise both values fall back to
their defaults. Stale TTL is maximum total snapshot age from `fetchedAt`, not
an additional duration after the fresh window.

| Variable | Default | Valid range | Scope and invalid behavior |
| --- | ---: | ---: | --- |
| `PANEL_CACHE_FRESH_TTL_MS` | `30000` | `1000-300000` | Optional in demo/live. Invalid values use `30000`. |
| `PANEL_CACHE_STALE_TTL_MS` | `120000` | `5000-900000` | Optional in demo/live. Invalid values use `120000`. |
| `STOCK_QUOTE_FRESH_TTL_MS` | `15000` | `1000-60000` | Shared by individual quote detail and Favorites quote caches. Invalid values use `15000`. |
| `STOCK_QUOTE_STALE_TTL_MS` | `120000` | `5000-600000` | Shared maximum snapshot age for those two caches. Invalid values use `120000`. |
| `STOCK_QUOTE_NOT_FOUND_TTL_MS` | `30000` | `1000-300000` | Optional; used by confirmed live quote `404` negative cache. Invalid values use `30000`. |
| `RATE_LIMIT_REDIS_TIMEOUT_MS` | `3000` | `2000-5000` | Optional; used by Redis REST operations and readiness. Invalid values use `3000`. |

`RATE_LIMIT_TRUSTED_PROXY` accepts `none` or `vercel`. Use `vercel` only when
the deployment is actually behind Vercel's trusted edge; otherwise forwarded
client headers are not trusted and the limiter uses a conservative shared
identity. An unrecognized value falls back to `vercel` only in a production
Vercel environment and to `none` elsewhere. `RATE_LIMIT_STORE=redis-rest` additionally requires
`RATE_LIMIT_REDIS_REST_URL` and `RATE_LIMIT_REDIS_REST_TOKEN`. Public rate
limiting remains fail-closed if the configured store cannot verify a request.

Sensitive server URLs are validated before network access. `API_URL` requires
HTTPS in production and in normal live deployments, permits a normalized base
pathname, and rejects credentials, query strings, and fragments. Redis REST
requires an HTTPS origin in production and rejects pathnames as well. Outside
production, HTTP is accepted only for `localhost`, `127.0.0.1`, or `::1`.
`TOKEN_ENDPOINT`, `PANEL_LIDER_ENDPOINT`, `PANEL_GENERAL_ENDPOINT`, and
`PANEL_CEDEARS_ENDPOINT` accept only non-empty relative paths. Absolute and
protocol-relative URLs, query strings, fragments, backslashes, control
characters, `.`/`..`, encoded traversal, and encoded separators are rejected.
Paths are appended below `API_URL`'s base pathname, then checked for the exact
same origin and base-path containment before OAuth credentials or bearer tokens
are obtained. Secret-bearing fetches reject redirects.

An insecure required Redis URL makes readiness `not-ready` without sending a
request. An invalid live `API_URL` or upstream endpoint makes `/api/health`
degraded; `invalidLiveConfig` contains only variable names, and health never
calls the provider to validate configuration.

Controlled test inputs are optional and must not contain secrets:

- `PANEL_RESPONSE_FIXTURE_JSON`: JSON object keyed by panel, used only in
  controlled tests/E2E; unset by default. Invalid JSON fails explicitly.
- `DISABLE_SERVER_DASHBOARD_PREFETCH`: only `1` disables SSR dashboard
  prefetch; unset, `0`, or any other value keeps it enabled.
- `PLAYWRIGHT_TEST_BASE_URL`: Playwright base URL; default
  `http://localhost:3100`.
- `PLAYWRIGHT_E2E_MODE`: `default` or `ssr`; normally set by the project
  runner. Values other than `ssr` do not enable the SSR-only suite.

## Quote Limit Namespaces

- `quote-public`: public requests to the individual quote endpoint.
- `favorites-public`: public favorites batch requests.
- `quote-upstream`: one unit per real live provider lookup, after cache and
  in-flight dedupe; cache hits do not consume it.

Different symbols in one favorites fan-out consume separate upstream units. If
the budget is exhausted partway through a batch, completed rows remain valid
and unresolved assets are reported in `failedItems`. In-memory rate limits,
caches, and in-flight maps are process-local.

`Retry-After` is the minimum delay used by automatic quote retries. Manual
retries remain constrained by the same server-side window and repeated manual
activation is coalesced while one request is pending.

## Data Contract Notes

Panel and quote responses require the current freshness metadata in every
successful response. `fresh` and `memory-cache` require `stale: false` and no
`degradationReason`; `stale` requires `stale: true` plus the admitted
`upstream-unavailable` reason. `fetchedAt`, `servedAt`, and `staleUntil` use the
complete UTC ISO format emitted by `Date#toISOString`, with
`fetchedAt <= servedAt <= staleUntil` and `fetchedAt < staleUntil`.

There is no compatibility mode for older ambiguous responses: during a mixed
deployment, a client receiving an older contract without these mandatory
fields fails validation explicitly instead of guessing freshness from its own
clock.

Historical normalization validates rows first, then deduplicates calendar
dates with “last valid payload row wins”, and finally sorts ascending.
`totalPoints` is always the final unique `data.length`; `discardedPoints`
includes invalid upstream rows and valid duplicate rows that do not reach the
response.

Historical freshness has an explicit invariant: `fresh` and `memory-cache`
require `meta.stale: false`, while stale fallback is `cacheStatus: stale` with
`meta.stale: true`. Metrics therefore distinguish a normal memory hit from a
stale fallback. When the UI changes symbol, market, or range, it clears the
previous points and statistics and shows the active request state until a
response with the same identity arrives; late responses for older keys remain
isolated in their own SWR cache entry.

## Request ID Correlation

Every internal API route returns `X-Request-Id`.

Example:

```bash
curl -i http://localhost:3000/api/panel?type=lider
```

Use the returned `X-Request-Id` value to correlate:

- client-visible failures
- structured server logs
- health/debug requests during incident review

## How to Interpret `degraded` Health

This section describes the compatibility diagnostic endpoint `/api/health`, not
the readiness endpoint. A monitor that only checks HTTP status must use
`/api/health/ready`.

Common `degraded` causes:

- `MARKET_DATA_SOURCE=live` but one or more required live env vars are missing
- `MARKET_DATA_SOURCE=live` with an invalid or insecure `API_URL`
- required Redis REST configuration has an invalid or insecure URL
- rate-limit runtime could not initialize as expected
- operational config is incomplete for the selected mode
- live/production-like rate limiting is using process-local memory buckets
- live/production-like rate limiting is using a shared global client bucket

What to check:

1. `dataSource` in `/api/health`
2. `checks.config.missingLiveConfig`
3. `checks.rateLimit`
4. deployment environment variables

For rate limiting specifically, inspect:

1. `checks.rateLimit.configuredStore`
2. `checks.rateLimit.storeMode`
3. `checks.rateLimit.trustedProxy`
4. `checks.rateLimit.reasons`

## If `/api/panel` Fails

Check in this order:

1. `GET /api/health/ready`
2. `GET /api/health` for compatibility diagnostics
3. `GET /api/debug/metrics` and inspect:
   - `api.request.total`
   - `panel.cache.event.total`
   - `rate_limit.check.total`
   - `upstream.request.total`
4. server logs for the matching `X-Request-Id`
5. current `MARKET_DATA_SOURCE`

Typical causes:

- invalid or missing live env config
- upstream auth/token failure
- upstream panel endpoint failure
- distributed rate-limit store not configured as expected in live mode
- process-local rate-limit fallback causing conservative blocking

## If `/api/stocks/[symbol]/history` Fails

Check:

1. `GET /api/health/ready`
2. `GET /api/health` for compatibility diagnostics
3. `GET /api/debug/metrics` and inspect:
   - `history.cache.event.total`
   - `history.discarded_points.total`
   - `history.stale_fallback.total`
   - `history.variant.selected.total`
   - `upstream.request.total`
4. logs for the route request ID

Typical causes:

- upstream historical endpoint failure
- upstream returned only invalid points
- rate limiting
- no stale cache available for fallback on this instance

## Favorites Partial Degradation

If `/api/favorites` returns partial data, interpret the UI messages as follows:

- `missingItems`: a favorite symbol is not available in the current source
- `failedItems`: a favorite lookup failed temporarily and may succeed on retry
- `Datos locales desactualizados.`: the dashboard is using a stale local fallback

Operator guidance:

1. capture `X-Request-Id` from the failing favorites response when possible
2. distinguish source availability issues (`missingItems`) from transient lookup failures (`failedItems`)
3. if the UI shows stale local fallback, remember that the browser is preserving the last local snapshot rather than confirming fresh upstream data

## Favorites Fan-Out Behavior

`/api/favorites` does not use a true upstream batch endpoint. It fans out into
individual upstream quote lookups after request validation and deduplication.

Operational notes:

- browser fetch and polling run only while the Favorites panel is visible
- fan-out concurrency is limited by `FAVORITES_QUOTE_CONCURRENCY`
- default concurrency is `4`
- valid configured range is `1-10`
- only complete decimal integers are accepted; malformed values such as
  `4workers`, `4.5`, `0x4`, or `1e1` use the default
- lower values reduce upstream burst pressure at the cost of higher batch latency
- cache hits and in-flight dedupe still apply before extra upstream work
- partial upstream-budget exhaustion preserves completed rows and records the
  remaining assets in `failedItems`

## Temporary PostCSS Override

Next.js `16.2.6` currently declares exact `postcss@8.4.31`, the vulnerable
version addressed by this repository's dependency remediation. The project
temporarily uses a direct safe PostCSS dependency plus the existing
`"postcss": "$postcss"` override, so Next resolves `8.5.19`. This is outside
the exact version declared by Next; compatibility is not guaranteed by Next,
although lint, type-check, unit tests, production build, and E2E have been
validated in this repository.

Remove the override when `npm explain postcss` demonstrates that the installed
Next version resolves a non-vulnerable compatible PostCSS version without the
override. Re-run the full validation after removal.

## If You See `429`

Interpretation:

- `/api/panel` or `/api/stocks/[symbol]/history` exceeded rate limits
- `/api/panel?refresh=1` may also hit refresh cooldown

What to do:

1. read `Retry-After`
2. inspect `X-RateLimit-*` headers
3. confirm whether the deployment is using:
   - `RATE_LIMIT_STORE=redis-rest`
   - `RATE_LIMIT_REDIS_REST_URL`
   - `RATE_LIMIT_REDIS_REST_TOKEN`
   - `RATE_LIMIT_TRUSTED_PROXY=vercel` on Vercel
4. inspect `rate_limit.check.total` in metrics

If live mode is public-facing and still using process-local memory buckets,
move to distributed storage before treating the deployment as serious.

## If You See `503 RATE_LIMIT_UNAVAILABLE`

Interpretation:

- the API failed closed because the rate-limit backend could not verify limits
- the JSON contract is still preserved, with `X-Request-Id` and `Retry-After`

What to do:

1. capture `X-Request-Id`
2. `GET /api/health/ready` and inspect `dependencies.rateLimitStore`
3. `GET /api/health` for compatibility diagnostics
4. inspect structured logs for the same request ID
5. verify:
   - `RATE_LIMIT_STORE`
   - `RATE_LIMIT_REDIS_REST_URL`
   - `RATE_LIMIT_REDIS_REST_TOKEN`
   - `RATE_LIMIT_TRUSTED_PROXY`
6. inspect `rate_limit.unavailable.total` in `/api/debug/metrics`

Notes:

- the route response intentionally does not expose Redis/KV URLs, tokens, or raw
  backend errors
- this fail-closed mode protects the upstream when limit verification is not
  trustworthy

## If Upstream Fails

Panel:

- panel responses use a 30-second fresh window and a bounded two-minute maximum
  age by default; both values are configurable
- recoverable failures (timeouts, connectivity, invalid responses, upstream
  `429`, and `5xx`) can return a previous snapshot inside that stale window
  with `cacheStatus: stale` and `stale: true`
- persistent authentication failures and other upstream `4xx` responses do not
  use stale fallback; without an eligible snapshot the route returns the normal
  controlled `502`
- no raw upstream bodies are exposed

Quote detail:

- individual detail and Favorites quote caches share a 15-second fresh window
  and a bounded two-minute maximum age by default
- both read `STOCK_QUOTE_FRESH_TTL_MS` / `STOCK_QUOTE_STALE_TTL_MS`; if
  `fresh >= stale`, both values revert to `15000` / `120000`
- timeout, connectivity, invalid response, upstream `429`/`5xx`, confirmed
  `404`, and quote upstream-budget store failures can use stale fallback
- persistent `401`/`403` and other non-recoverable upstream `4xx` responses do
  not use stale fallback
- the public request rate limiter remains fail-closed before the quote service

History:

- fresh upstream data returns `cacheStatus: fresh` and `meta.stale: false`
- a valid memory hit returns `cacheStatus: memory-cache` and `meta.stale: false`
- a recoverable failure inside the stale window returns `cacheStatus: stale`
  and `meta.stale: true`; expired entries are not served

History:

- live history can fall back to stale cache if a previous success exists on the
  same instance and still falls within the stale window

Operator action:

1. confirm whether the app is in `demo` or `live`
2. inspect logs with `X-Request-Id`
3. inspect `upstream.request.total` and `history.stale_fallback.total`
4. if public portfolio stability matters more than live data, switch to
   `MARKET_DATA_SOURCE=demo`

## Demo vs Live

How to distinguish:

- `/api/health` reports `dataSource`
- history responses include `meta.source`
- the UI shows a `Demo público · datos sintéticos` badge in demo mode

Guidance:

- public portfolio deploy: use `demo`
- controlled private review of real upstream integration: use `live`

## Basic Config Rollback

Safe rollback order:

1. set `MARKET_DATA_SOURCE=demo`
2. remove or ignore live credentials
3. keep CSP, request IDs, and observability enabled
4. optionally remove `OBSERVABILITY_DEBUG_TOKEN` if production debug access
   should be disabled
5. redeploy

This is the safest fallback if the upstream, credentials, or distributed
rate-limit/storage configuration is unstable.
