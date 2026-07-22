# Argentina Market Tracker

[![CI](https://github.com/emanuel-tivano/argentina-market-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/emanuel-tivano/argentina-market-tracker/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Tests](https://img.shields.io/badge/tests-Vitest%20%2B%20Playwright-green)

Dashboard full-stack para explorar paneles del mercado argentino, favoritos,
cotizaciones detalladas e histórico de activos. Fue construido por **Emanuel
Tivano** como proyecto de portfolio para demostrar arquitectura con Next.js,
integración segura con APIs, resiliencia y calidad automatizada.

- **Demo pública:** [argentina-market-tracker.vercel.app](https://argentina-market-tracker.vercel.app)
- **Código:** [github.com/emanuel-tivano/argentina-market-tracker](https://github.com/emanuel-tivano/argentina-market-tracker)
- **Modo recomendado para revisión:** `MARKET_DATA_SOURCE=demo`, sin credenciales externas
- **Contacto público actual:** [repositorio en GitHub](https://github.com/emanuel-tivano/argentina-market-tracker)

El proyecto es una demostración técnica. No es un broker, una plataforma de
trading, un servicio garantizado de cotizaciones en tiempo real ni una fuente
de asesoramiento financiero.

![Dashboard de escritorio de Argentina Market Tracker](./docs/screenshots/desktop.png)

## En un minuto

Argentina Market Tracker resuelve la presentación consistente de datos que
pueden provenir de paneles, cotizaciones puntuales e históricos con contratos
distintos. El navegador nunca accede al proveedor externo: consume un Backend
for Frontend interno que valida, normaliza, limita y observa cada operación.

No es una interfaz estática ni un tutorial aislado. El repositorio incluye:

- SSR inicial para dashboard y páginas de activos, seguido de revalidación con SWR
- BFF con contratos tipados y acceso upstream exclusivamente server-side
- modos `demo` determinístico y `live` configurable
- caché fresh/stale, deduplicación de solicitudes concurrentes y rate limiting
- estados explícitos de carga, error, vacío, stale y degradación parcial
- observabilidad con request IDs, métricas agregadas, health checks y logs sanitizados
- pruebas unitarias, de componentes, hooks, Route Handlers, SSR y flujos E2E

## Problema que resuelve

La experiencia reúne panel líder, panel general y CEDEARs; permite ordenar
cotizaciones, persistir favoritos y consultar detalle, puntas e histórico de
cada activo. La complejidad principal no está sólo en la tabla: está en
integrar fuentes heterogéneas sin exponer credenciales, evitar trabajo repetido
y conservar una experiencia útil cuando una parte del sistema falla.

El modo demo permite revisar la aplicación de forma estable y segura. El modo
live demuestra la misma arquitectura contra un proveedor real, con OAuth,
timeouts, retry de autenticación y validación antes de llegar a React.

## Responsabilidad del autor

Emanuel Tivano diseñó e implementó el proyecto de extremo a extremo:

- arquitectura App Router y separación entre cliente, BFF, contratos y servicios server-only
- dashboard responsive, favoritos, detalle de activos, histórico y temas claro/oscuro
- integración demo/live, autenticación upstream y normalización de payloads
- SSR, cachés, stale fallback, deduplicación concurrente y rate limiting
- observabilidad, seguridad de rutas debug, tests automatizados y CI
- documentación para ejecución, revisión técnica y operación

Estas responsabilidades describen trabajo verificable en el repositorio; no
representan una plataforma financiera productiva ni experiencia laboral no
documentada.

## Características principales

- Paneles de mercado: líder, general y CEDEARs
- Favoritos persistidos localmente y actualizados mediante `/api/favorites`
  sólo mientras el panel Favoritos está visible
- Cotización detallada, sesión, liquidez, puntas e histórico por activo
- SSR del panel inicial y cabecera inicial de páginas de activos
- Revalidación cliente con polling, pausa por pestaña oculta y refresh manual
- Modal desktop con carga diferida y página dedicada para navegación mobile
- Metadata por activo, canonical, sitemap, robots y Open Graph
- Indicador visible de fuente demo/live
- Health check y métricas de diagnóstico protegidas según ambiente

## Arquitectura resumida

```txt
Browser
  Next.js pages + dashboard cliente
        |
        | fetches internos
        v
Route Handlers en src/app/api (BFF)
  validación de request y contratos
  rate limiting y respuestas consistentes
        |
        v
Servicios en src/lib/server
  demo determinístico o integración live
  OAuth / timeout / retry
  caché fresh + stale e in-flight dedupe
  observabilidad y normalización
```

Reglas centrales:

- el browser no llama al proveedor externo
- los payloads upstream se validan antes de llegar a componentes
- los contratos compartidos viven en `src/lib/**`
- integración, caché, límites y observabilidad viven en `src/lib/server/**`
- cambios de contrato actualizan validadores, consumidores y tests juntos

El mapa detallado está en
[ESTRUCTURA_PROYECTO.md](./ESTRUCTURA_PROYECTO.md). La guía operativa está en
[docs/RUNBOOK.md](./docs/RUNBOOK.md).

## Decisiones técnicas destacadas

| Decisión | Problema resuelto | Trade-off |
| --- | --- | --- |
| BFF interno | Aísla credenciales, OAuth y contratos del proveedor. | Agrega una capa server-side que debe operarse y probarse. |
| SSR + SWR | Entrega contenido inicial y mantiene datos actualizados. | Requiere coordinar fallback, hidratación y revalidación. |
| Demo/live | Ofrece revisión pública estable sin perder integración real. | Demo no representa datos reales; live depende del upstream. |
| Caché fresh/stale | Reduce latencia y conserva datos conocidos ante fallos breves. | En memoria, el estado es local a cada instancia. |
| Deduplicación in-flight | Evita llamadas duplicadas para una misma clave concurrente. | Sólo coordina solicitudes dentro del mismo proceso. |
| Rate limiting configurable | Protege al BFF y al proveedor ante abuso o ráfagas. | Para alcance global requiere Redis REST y proxy confiable. |
| Validación de payloads | Impide que estructuras upstream inválidas contaminen la UI. | Obliga a mantener adaptadores explícitos por contrato. |
| Observabilidad liviana | Permite correlacionar fallos sin exponer payloads ni secretos. | No reemplaza una plataforma externa de observabilidad. |

## Stack real

| Área | Tecnologías |
| --- | --- |
| Aplicación | Next.js 16, React 19, App Router, TypeScript 6 strict |
| UI y datos cliente | Tailwind CSS 4, SWR 2, lightweight-charts |
| Backend for Frontend | Route Handlers, Node.js runtime, Fetch API, OAuth upstream |
| Calidad | ESLint 9, contratos tipados, validadores y normalizadores |
| Testing | Vitest 4, Testing Library, jsdom, Playwright |
| Operación | GitHub Actions, health checks, métricas, request IDs, Redis REST opcional |

## Ejecución local

### Requisitos

- Node `>=24.15.0 <25`
- npm
- no requiere base de datos, Prisma ni seed

### Instalación

```bash
npm install
```

Crear el archivo local de entorno:

```bash
cp .env.local.example .env.local
```

En PowerShell:

```powershell
Copy-Item -LiteralPath .env.local.example -Destination .env.local
```

Iniciar desarrollo:

```bash
npm run dev
```

Abrir `http://localhost:3000`.

## Variables de entorno

[.env.local.example](./.env.local.example) es la fuente de referencia. Nunca
se deben guardar secretos reales en commits, logs, issues o snapshots.

### Demo y despliegue

| Variable | Requerida | Uso |
| --- | --- | --- |
| `MARKET_DATA_SOURCE` | No | `demo` para revisión pública; `live` para integración controlada. |
| `NEXT_PUBLIC_SITE_URL` | Producción fuera de Vercel | Origen público HTTPS para metadata, sitemap, robots y Open Graph. |
| `APP_VERSION` | No | Versión opcional expuesta por `/api/health`. |

Si `NEXT_PUBLIC_SITE_URL` no existe, el SEO usa primero las variables de
producción de Vercel. Fuera de producción utiliza `http://localhost:3000`; una
producción sin origen válido falla de forma explícita.

### Integración live

| Variable | Uso |
| --- | --- |
| `API_URL` | Base URL HTTPS del proveedor externo; admite pathname base normalizado. |
| `TOKEN_ENDPOINT` | Ruta del endpoint OAuth. |
| `API_USERNAME` | Usuario upstream, sólo servidor. |
| `API_PASSWORD` | Contraseña upstream, sólo servidor. |
| `PANEL_LIDER_ENDPOINT` | Endpoint upstream del panel líder. |
| `PANEL_GENERAL_ENDPOINT` | Endpoint upstream del panel general. |
| `PANEL_CEDEARS_ENDPOINT` | Endpoint upstream de CEDEARs. |

Los cuatro endpoints configurables son paths relativos estrictos. Admiten
rutas anidadas como `api/v2/panel/lider`, con o sin barras exteriores, pero
rechazan URLs absolutas o protocol-relative, query, fragment, backslashes,
caracteres de control, traversal (`.`/`..`) y sus variantes codificadas. Se
resuelven debajo del pathname base de `API_URL` y la URL final conserva siempre
su origin. Las requests OAuth y bearer usan `redirect: error`; el proveedor
debe exponer directamente la URL HTTPS configurada.

### Operación y debug

| Variable | Uso |
| --- | --- |
| `ENABLE_TOKEN_DEBUG` | Habilita debug local de token/raw fuera de producción. |
| `OBSERVABILITY_DEBUG_TOKEN` | Protege `/api/debug/metrics` en producción. |
| `FAVORITES_QUOTE_CONCURRENCY` | Entero decimal estricto `1-10` para fan-out de favoritos; valores parciales usan el default `4`. |
| `PANEL_CACHE_FRESH_TTL_MS` / `PANEL_CACHE_STALE_TTL_MS` | Ventana fresh y edad máxima del snapshot de panel; defaults `30s` / `2m`. |
| `STOCK_QUOTE_FRESH_TTL_MS` / `STOCK_QUOTE_STALE_TTL_MS` | Ventana fresh y edad máxima compartidas por detalle y Favoritos; defaults `15s` / `2m`. |
| `STOCK_QUOTE_NOT_FOUND_TTL_MS` | Caché negativa de un `404` confirmado; default `30s`, rango `1s-5m`. |
| `RATE_LIMIT_STORE` | `auto`, `memory` o `redis-rest`. |
| `RATE_LIMIT_TRUSTED_PROXY` | `none` o `vercel`. |
| `RATE_LIMIT_REDIS_REST_URL` | Origen REST HTTPS de Redis/KV, sin pathname, query ni fragment. |
| `RATE_LIMIT_REDIS_REST_TOKEN` | Token del almacenamiento distribuido. |
| `RATE_LIMIT_REDIS_TIMEOUT_MS` | Timeout `2000-5000ms` compartido por operaciones y readiness Redis; default `3000ms`. |

Las variables adicionales usadas por E2E y fixtures controlados están
documentadas en [.env.local.example](./.env.local.example) y
[AGENTS.md](./AGENTS.md).

Los TTL se expresan en milisegundos. El stale TTL es la edad máxima total
desde `fetchedAt`, no tiempo adicional después de la ventana fresh. Los valores
inválidos o fuera de rango vuelven a los defaults; si una pareja configura
`fresh >= stale`, ambos TTL de esa pareja vuelven a sus defaults. Los rangos y
el comportamiento por ambiente se detallan en el runbook.

`API_URL` y `RATE_LIMIT_REDIS_REST_URL` rechazan credenciales embebidas, query,
fragment y protocolos distintos de HTTP/HTTPS. En producción ambas exigen
HTTPS. Fuera de producción, HTTP sólo se admite para `localhost`, `127.0.0.1`
o `::1`. `API_URL` admite un pathname base; Redis REST exige sólo el origen.

## Scripts

```bash
npm run dev              # desarrollo en puerto 3000
npm run dev:e2e          # desarrollo E2E en puerto 3100
npm run lint             # ESLint
npm run type-check       # TypeScript --noEmit
npm run test             # Vitest
npm run test:coverage    # Vitest con cobertura V8 y thresholds
npm run build            # build de producción
npm run validate:local   # lint + type-check + test + build
npm run validate         # validación local + suite E2E
```

E2E específicos:

```bash
npm run test:e2e
npm run test:e2e:ssr
npm run test:e2e:app
npm run test:e2e:ui
```

`npm run validate` es el flujo más cercano a CI. `deps:update` modifica
dependencias y lockfile, por lo que no forma parte de la validación habitual.

## Testing y validación

La estrategia valida comportamiento en distintos límites:

- contratos y normalización de datos
- servicios, cachés, rate limiting y stale fallback
- hooks y estados de UI
- componentes y accesibilidad estructural
- Route Handlers y códigos/headers de error
- SSR inicial y metadata de activos
- flujos interactivos y responsive con Playwright

GitHub Actions ejecuta en modo demo tres jobs encadenados: `quality` instala,
ejecuta lint, type-check y tests con cobertura; `build` valida el build de
Next.js; `e2e` construye una vez y corre las suites SSR y app sobre Chromium.
Las acciones están fijadas por SHA, los jobs tienen timeout y las ejecuciones
obsoletas de una rama o PR se cancelan. Los thresholds globales de cobertura
son statements `80`, lines `80`, functions `75` y branches `70`, con límites
específicos de no regresión para módulos críticos. `coverage/` es generado y no
se versiona.

## Estructura principal

```txt
src/
  app/                         páginas, layout, metadata y Route Handlers
  features/dashboard/          UI, hooks y flujos del dashboard
  lib/                         contratos, validación y formateo compartido
  lib/server/                  integración, caché, límites y observabilidad
e2e/                           pruebas Playwright
docs/                          runbook y capturas
scripts/                       runners E2E
.github/workflows/ci.yml       validación continua
```

## Rutas internas del BFF

- `GET /api/panel?type=lider|general|cedears`
- `GET /api/favorites?items=bCBA:ALUA,bCBA:AAPL`
- `GET /api/stocks/[symbol]/quote?market=bCBA`
- `GET /api/stocks/[symbol]/history?range=1W|1M|3M|6M|1Y&market=bCBA`
- `GET /api/health/live`, liveness sin dependencias externas
- `GET /api/health/ready`, readiness del backend de rate limiting
- `GET /api/health`, diagnóstico compatible; puede responder `200 degraded`
- `GET /api/debug/metrics`
- `GET /api/token`, sólo para debug local autorizado

Las cotizaciones separan tres controles: `quote-public` limita el endpoint de
detalle, `favorites-public` limita cada request batch de favoritos y
`quote-upstream` protege cada lookup real al proveedor. Un cache hit no consume
`quote-upstream`; dos símbolos distintos sí consumen dos unidades. Si el
presupuesto se agota durante el fan-out, favoritos conserva los resultados ya
obtenidos y declara los restantes en `failedItems`.

El rate limiter público falla cerrado si no puede verificar el límite. Cachés,
deduplicación y límites configurados en memoria son process-local. En respuestas
`429`, `Retry-After` fija el mínimo para el retry automático; un retry manual
sigue sujeto a la misma ventana del servidor y el cliente evita ejecuciones
manuales concurrentes.

`/api/health/live` sólo confirma que el proceso responde y siempre evita
dependencias externas. `/api/health/ready` prueba Redis con `PING` cuando es
requerido y devuelve `503` ante configuración insegura o dependencia no
disponible. `/api/health` conserva HTTP `200` para diagnóstico y marca
`degraded` una `API_URL`, `TOKEN_ENDPOINT`, `PANEL_LIDER_ENDPOINT`,
`PANEL_GENERAL_ENDPOINT` o `PANEL_CEDEARS_ENDPOINT` live inválida, o una
configuración Redis insegura. Sólo informa nombres de variables inválidas y no
consulta al upstream.

El histórico usa `cacheStatus: fresh` para una carga nueva,
`cacheStatus: memory-cache` para un hit vigente y `cacheStatus: stale` para el
fallback desactualizado. Las dos primeras variantes exigen `meta.stale: false`;
la última exige `meta.stale: true`. Al cambiar rango, símbolo o mercado, la UI
deja de mostrar los puntos y estadísticas anteriores y presenta loading/error
hasta recibir una respuesta cuya identidad coincida con la solicitud activa.

## Modo demo y modo live

`MARKET_DATA_SOURCE=demo` usa datos determinísticos locales. Es la opción
recomendada para portfolio porque no necesita secretos y produce una revisión
repetible.

`MARKET_DATA_SOURCE=live` habilita el proveedor externo desde el servidor. Se
debe usar con credenciales privadas, configuración de rate limiting adecuada y
las variables live completas.

## Capturas

- [Dashboard desktop](./docs/screenshots/desktop.png)
- [Detalle con histórico](./docs/screenshots/modal-history.png)
- [Dashboard mobile](./docs/screenshots/mobile.png)

![Detalle e histórico de un activo](./docs/screenshots/modal-history.png)

## Operación

[docs/RUNBOOK.md](./docs/RUNBOOK.md) documenta:

- liveness, readiness y diagnóstico compatible `degraded`
- correlación mediante `X-Request-Id`
- métricas y rutas debug
- fallos de rate limiting
- degradación de favoritos e histórico
- troubleshooting demo/live y rollback seguro

## Limitaciones conocidas

- el modo demo es sintético y no representa cotizaciones reales
- live depende de disponibilidad, contratos y credenciales de un tercero
- cachés, deduplicación y métricas en memoria son locales a cada instancia
- el rate limiting sólo es distribuido cuando se configura Redis REST
- favoritos hace fan-out acotado porque no existe un endpoint batch upstream
- no existe persistencia propia de histórico ni una base de datos
- la aplicación no ejecuta órdenes ni ofrece asesoramiento financiero

## Autor y contacto

**Emanuel Tivano** diseñó y desarrolló Argentina Market Tracker como proyecto
de portfolio técnico.

- Repositorio: [github.com/emanuel-tivano/argentina-market-tracker](https://github.com/emanuel-tivano/argentina-market-tracker)
- Demo: [argentina-market-tracker.vercel.app](https://argentina-market-tracker.vercel.app)
- LinkedIn: `[Agregar LinkedIn]`
- Correo profesional: `[Agregar correo profesional]`

Estas dos marcas son editoriales y no se renderizan en la interfaz. Para
publicar los canales, reemplazá los valores `null` de
`src/lib/authorContact.ts` por la URL completa de LinkedIn y el correo real.
