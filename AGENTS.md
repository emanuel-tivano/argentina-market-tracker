# AGENTS.md

## Descripción del proyecto

`argentina-market-tracker` es un dashboard demo/portfolio sobre mercado argentino.
Tratarlo como proyecto de muestra técnica: no como plataforma real de trading, broker ni asesor financiero.

El repo muestra una arquitectura Next.js con BFF interno, validación de contratos, SSR inicial, revalidación cliente, modo `demo/live`, observabilidad liviana y tests automatizados.

## Stack real

- Next.js `16.2.6` con App Router
- React `19.2.6`
- TypeScript `6.0.3` en `strict`
- Tailwind CSS `4`
- SWR `2.4.1`
- `lightweight-charts` para histórico
- Vitest + Testing Library para unit/component/hook/route tests
- Playwright para E2E
- GitHub Actions en `.github/workflows/ci.yml`
- Node `>=24.15.0 <25`

## Comandos reales

Instalación:

```bash
npm install
```

Desarrollo:

```bash
npm run dev
npm run dev:e2e
```

Calidad:

```bash
npm run lint
npm run type-check
npm run test
npm run build
```

E2E:

```bash
npm run test:e2e
npm run test:e2e:run
npm run test:e2e:app
npm run test:e2e:app:run
npm run test:e2e:ssr
npm run test:e2e:ssr:run
npm run test:e2e:ui
```

Validación completa:

```bash
npm run validate:local
npm run validate
npm run test:coverage
```

Notas:

- `validate:local` corre `lint`, `type-check`, `test` y `build`.
- `validate` corre `validate:local` y luego `test:e2e:run`.
- `test:e2e`, `test:e2e:app` y `test:e2e:ssr` hacen `next build` antes de correr Playwright.
- `test:e2e:run` ejecuta `scripts/run-e2e-suite.mjs`, que corre SSR E2E y luego E2E interactivo.
- `test:coverage` corre Vitest con V8, thresholds globales y límites específicos para módulos críticos; `coverage/` es generado y no se versiona.
- `deps:update` existe pero modifica lockfile y dependencias; no usarlo salvo pedido explícito.

## Variables de entorno esperadas

Referencia: `.env.local.example`

Modo de datos:

- `MARKET_DATA_SOURCE`
  - `demo`: datos determinísticos, sin credenciales upstream
  - `live`: integración real con API externa

Live mode:

- `API_URL`
  - HTTPS obligatorio en `live`; sólo se permite HTTP loopback fuera de producción
  - admite pathname base, pero no credenciales, query ni fragment
- `TOKEN_ENDPOINT`
- `API_USERNAME`
- `API_PASSWORD`
- `PANEL_LIDER_ENDPOINT`
- `PANEL_GENERAL_ENDPOINT`
- `PANEL_CEDEARS_ENDPOINT`
  - los cuatro endpoints son paths relativos estrictos, sin URL absoluta o protocol-relative, query, fragment, backslashes, traversal ni separadores/traversal codificados
  - se resuelven dentro del origin y pathname base de `API_URL`

Generales / despliegue:

- `NEXT_PUBLIC_SITE_URL`
- `APP_VERSION`

Debug / observabilidad:

- `ENABLE_TOKEN_DEBUG`
- `LOCAL_DEBUG_TOKEN`
- `OBSERVABILITY_DEBUG_TOKEN`

Rate limiting / operación:

- `FAVORITES_QUOTE_CONCURRENCY`
- `RATE_LIMIT_STORE`
- `RATE_LIMIT_TRUSTED_PROXY`
- `RATE_LIMIT_REDIS_REST_URL`
  - HTTPS obligatorio en producción; HTTP sólo loopback en desarrollo/tests
  - debe ser sólo origen, sin credenciales, pathname, query ni fragment
- `RATE_LIMIT_REDIS_REST_TOKEN`

Variables usadas en testing/dev controlado:

- `PANEL_RESPONSE_FIXTURE_JSON`
  - sólo se acepta con `NODE_ENV=test` o `PLAYWRIGHT_E2E_MODE=ssr`
- `DISABLE_SERVER_DASHBOARD_PREFETCH`
- `PLAYWRIGHT_TEST_BASE_URL`
- `PLAYWRIGHT_E2E_MODE`

No incluir secretos ni valores reales en commits, logs, issues, snapshots ni documentación.

## Estructura importante

```txt
src/
  app/
    page.tsx
    layout.tsx
    api/
      panel/route.ts
      favorites/route.ts
      stocks/[symbol]/history/route.ts
      health/route.ts
      debug/metrics/route.ts
      token/route.ts
    stocks/[symbol]/page.tsx
  features/
    dashboard/
      panel/
      stocks/
      favorites/
      history/
      charts/
      shell/
      shared/
  lib/
    market.ts
    panel.ts
    stockHistory.ts
    favorites.ts
    server/
      core/
      upstream/
      panel/
      history/
      favorites/
      demo/
docs/
  RUNBOOK.md
e2e/
scripts/run-e2e.mjs
scripts/run-e2e-suite.mjs
.github/workflows/ci.yml
```

## Reglas de arquitectura

- Mantener App Router. `src/app/page.tsx` hace SSR inicial del panel y entrega `initialData` al cliente.
- El browser no habla con el proveedor externo. Todo acceso pasa por route handlers internos.
- Conservar separación:
  - UI/hooks cliente en `src/features/dashboard/**`
  - contratos y normalización compartida en `src/lib/**`
  - integración externa, cachés, rate limiting y observabilidad en `src/lib/server/**`
- No duplicar tipos si ya existen en `src/lib/market.ts`, `src/lib/panel.ts`, `src/lib/stockHistory.ts` o `src/lib/favorites.ts`.
- El frontend debe consumir datos ya validados; no empujar payloads upstream crudos a componentes.
- Si cambia un contrato del BFF o del upstream, actualizar validadores, consumidores y tests en el mismo cambio.

## BFF y datos externos

Rutas internas actuales:

- `/api/panel?type=lider|general|cedears`
- `/api/favorites?items=bCBA:ALUA,bCBA:AAPL`
- `/api/stocks/[symbol]/history?range=1W|1M|3M|6M|1Y&market=bCBA`
- `/api/health`
- `/api/health/live`
- `/api/health/ready`
- `/api/debug/metrics`
- `/api/token`

Notas importantes:

- `/api/panel?refresh=1` fuerza bypass de cache y puede gatillar cooldown de refresh.
- `/api/panel?raw=1` sólo está habilitado fuera de producción cuando `ENABLE_TOKEN_DEBUG=1` y `x-local-debug-token` coincide con `LOCAL_DEBUG_TOKEN`.
- `/api/token` también exige esas mismas condiciones de autorización explícita.
- `/api/favorites` valida y deduplica items, aplica rate limiting y hace fan-out a quotes individuales con cache y concurrencia acotada.
- `/api/health` expone diagnóstico compatible con HTTP `200`, incluso como `degraded` ante configuración live/Redis inválida.
- `/api/health/live` es liveness sin dependencias externas; `/api/health/ready` prueba Redis cuando es requerido y devuelve `503` si su configuración es insegura o no está disponible.
- `/api/debug/metrics` en desarrollo/test está abierto; en producción requiere `OBSERVABILITY_DEBUG_TOKEN` vía header `x-observability-token`, y si no está configurado devuelve `404`.

Live/demo:

- `MARKET_DATA_SOURCE=demo` usa `src/lib/server/demo/demoMarketData.ts` y no requiere credenciales upstream.
- `MARKET_DATA_SOURCE=live` usa `src/lib/server/upstream/iol.ts` y requiere configuración live completa.
- Para despliegue público tipo portfolio, preferir `demo`.
- Para revisión controlada de integración real, usar `live` y rate limiting distribuido.

Integración server:

- `src/lib/server/upstream/iol.ts` maneja OAuth, timeout, `cache: 'no-store'`, `redirect: 'error'`, sanitización básica y retry único ante `401/403`.
- `src/lib/server/core/env.ts` valida URLs sensibles y endpoints relativos, normaliza la base URL y resuelve variables operativas.
- `src/lib/server/panel/panelCache.ts` usa cache en memoria por panel con TTL de `30s`.
- `src/lib/server/history/historyCache.ts` usa cache en memoria por `market:symbol:range` con TTL de `5m` y máximo `500` claves.
- `src/lib/server/upstream/quoteCache.ts` cachea quotes de favoritos y soporta stale fallback con `STOCK_QUOTE_FRESH_TTL_MS` / `STOCK_QUOTE_STALE_TTL_MS`, igual que la caché de detalle en `src/lib/server/quote/quoteCache.ts`.
- Si `STOCK_QUOTE_FRESH_TTL_MS >= STOCK_QUOTE_STALE_TTL_MS`, ambos vuelven a los defaults `15000` / `120000`.

Rate limiting:

- `src/lib/server/panel/panelLimits.ts` aplica rate limit de `120` requests por `60s` y cooldown de refresh manual de `15s` por panel/cliente.
- `src/lib/server/history/historyRateLimit.ts` aplica rate limit de `120` requests por `60s`.
- `src/lib/server/favorites/favoritesRateLimit.ts` aplica rate limit de `120` requests por `60s`.
- `src/lib/server/core/rateLimit.ts` soporta `memory` y `redis-rest`, con fallback conservador y fail-closed `503 RATE_LIMIT_UNAVAILABLE`.
- Estos límites siguen siendo proceso-locales si no hay storage distribuido configurado; no tratarlos como protección global real.

## Seguridad y credenciales

- Nunca mover `API_USERNAME`, `API_PASSWORD` ni tokens OAuth al cliente.
- No exponer token completo en respuestas, UI, logs, snapshots ni docs.
- No exponer `RATE_LIMIT_REDIS_REST_TOKEN`, `OBSERVABILITY_DEBUG_TOKEN` ni valores reales de `.env.local`.
- `ENABLE_TOKEN_DEBUG=1` sólo habilita debug fuera de producción y requiere `LOCAL_DEBUG_TOKEN` mediante `x-local-debug-token`.
- `/api/debug/metrics` en producción no debe quedar abierto sin token.
- Mantener `runtime = 'nodejs'` al tocar handlers con integración server-side; hoy está explícito en `panel`, `favorites`, `history`, `health` y `debug/metrics`.
- Respetar headers y CSP definidos por `middleware.ts` y `next.config.mjs`.
- Mantener `X-Request-Id` y sanitización de logs cuando se toque observabilidad.
- Evitar volcar payloads completos del proveedor en errores, métricas o logs.

## UI y dashboard

- El dashboard principal es cliente (`src/features/dashboard/panel/Panel.tsx`) e hidrata con datos SSR cuando existen.
- `useMarketPanel` usa SWR con polling de `60s`, pausa por pestaña oculta y refresh manual con `?refresh=1`.
- `useFavoritePanel` usa un patrón similar para `/api/favorites`, pero su key y polling sólo están habilitados cuando el panel Favoritos está activo.
- `StockDetailsModal` se carga con `next/dynamic` y `ssr: false`; no romper esa carga diferida salvo motivo claro.
- El histórico usa `lightweight-charts`; tratarlo como componente relativamente pesado.
- `useStockHistory` no conserva puntos de una key anterior al cambiar símbolo, mercado o rango; sólo acepta respuestas cuya identidad coincide con la solicitud activa.
- El histórico usa `fresh`/`memory-cache` con `meta.stale: false` y `stale` con `meta.stale: true`.
- Mantener estados explícitos de loading, error, empty, stale y success.
- Favoritos, tema y orden viven del lado cliente; no mezclar esa lógica con server code.
- En demo mode la UI muestra badge `Demo data`.

## Testing y validación

- Unit, component, hook y route tests corren con `npm run test` mediante Vitest.
- `npm run test:coverage` agrega cobertura V8; thresholds globales: statements/lines `80`, functions `75`, branches `70`, más límites específicos de módulos críticos.
- E2E corren con Playwright sobre `http://localhost:3100` por default vía `scripts/run-e2e.mjs`.
- Existe cobertura SSR específica con `npm run test:e2e:ssr`.
- CI usa jobs `quality`, `build` y `e2e`, acciones fijadas por SHA, permisos read-only, cancelación de ejecuciones obsoletas y Node `24.15.0`; `quality` bloquea vulnerabilidades de producción con `npm audit --omit=dev` y corre en demo con `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100`.

Antes de dar por válido un cambio de código, correr como mínimo:

```bash
npm run type-check
npm run build
```

Recomendaciones:

- Si el cambio toca lógica, contratos, hooks, cachés o handlers, preferir también `npm run test`.
- Si toca flujo dashboard, favoritos, modal, histórico o SSR inicial, preferir además el E2E relevante:
  - `npm run test:e2e:ssr`
  - `npm run test:e2e:app`
- Si querés la validación más parecida a CI, usar `npm run validate`.

## Git safety

- No hacer `commit`, `push`, `reset`, `checkout`, `rebase` ni comandos destructivos sin pedido explícito.
- No revertir cambios ajenos del worktree.
- Verificar siempre qué archivos quedaron modificados antes de cerrar.
- En PowerShell, usar `-LiteralPath` para rutas con corchetes como `src/app/api/stocks/[symbol]/history/route.ts`.
- Si hay cambios previos del usuario, trabajar alrededor de ellos y mencionarlos si afectan la tarea.

## Qué no hacer

- No agregar features sin pedido explícito.
- No inventar comandos, variables, endpoints ni arquitectura.
- No convertir esto en producto financiero real ni agregar copy de asesoramiento.
- No llamar al proveedor externo desde client components.
- No duplicar validaciones o tipos entre cliente y servidor si ya hay una fuente única.
- No relajar validaciones o controles de seguridad para “hacer que pase”.

## Criterio de terminado

Un trabajo queda terminado cuando:

- el cambio respeta la separación cliente/BFF/server existente
- los contratos externos quedan validados antes de llegar a UI
- no se exponen credenciales, tokens ni secretos operativos
- se ejecutaron al menos `npm run type-check` y `npm run build` cuando hubo cambios de código
- el resumen final cita archivos tocados, validación ejecutada y riesgos/notas abiertas

Para tareas de documentación pura como esta, no hace falta correr build o type-check si no se modificó código.

## Formato de resumen final

Responder en este formato:

1. Cambios realizados.
2. Archivos afectados.
3. Validación ejecutada.
4. Riesgos o notas abiertas.

## Notas abiertas verificadas

- No existe un script separado de “integration tests”; la cobertura intermedia actual vive en route tests/hook tests con Vitest y en E2E con Playwright.
- `next.config.test.ts` no es config de runtime: contiene tests de seguridad/CSP.
