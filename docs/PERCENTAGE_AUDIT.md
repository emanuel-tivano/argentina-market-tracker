# Auditoría de porcentajes de mercado

## Política vigente

La fuente de verdad matemática es `src/lib/marketPerformance.ts`:

```text
returnPercentage = (endPrice / startPrice - 1) * 100
```

Los operandos deben ser finitos y estrictamente positivos. El cálculo usa la
precisión recibida; el redondeo a dos decimales existe sólo en los formatters de
presentación.

Los períodos `1W`, `1M`, `3M`, `6M`, `1Y`, `3Y` y `5Y` son calendario, no una
cantidad fija de ruedas. `YTD` está soportado por el dominio aunque todavía no
es un control de la UI. La fecha objetivo se resta desde la última fecha válida
de la serie. La referencia es la última rueda cuya fecha es menor o igual a la
fecha objetivo. El 29 de febrero se limita al último día válido del mes del año
objetivo.

El backend solicita 14 días adicionales antes del objetivo nominal. Luego de
normalizar, ordenar y consolidar fechas, vuelve a anclar el período al último
punto realmente disponible y elimina el margen anterior. Si no existe una
referencia suficiente no inventa un índice ni calcula un rendimiento.

## Base de precios y acciones societarias

Live solicita primero la variante `ajustada` del endpoint de serie histórica de
IOL. El nombre del parámetro no se interpreta como garantía de “sólo splits” ni
como garantía de total return. La [documentación pública de IOL](https://api.invertironline.com/)
expone el servicio, pero no publica una definición suficientemente precisa de
qué acciones societarias cubre la variante.

La inspección live del 18-09-2026 demostró que `ajustada` no es una garantía de
continuidad por split: YPFD pasó de 83.000 el 31-07-2026 a 8.105 el 03-08-2026.
YPF confirma oficialmente un split 10:1 efectivo en el mercado local el
04-08-2026 y que no cambió el interés económico del accionista en su
[página de capital](https://inversores.ypf.com/capital-suscripto.html).

Por eso la política es fail closed:

- `ajustada`: se usa sin aplicar factores nuevamente; esto evita doble ajuste.
- `sinAjustar`: puede conservarse para el gráfico como fallback, pero no publica
  rendimiento histórico.
- salto extremo entre ruedas adyacentes aun en `ajustada`: se conserva la serie,
  se muestra una advertencia y se omite el rendimiento; no se infiere ni se
  hardcodea un factor.
- una serie raw sólo puede ajustarse mediante la abstracción genérica de acciones
  societarias y factores explícitos. El proyecto no tiene hoy un feed autorizado
  de corporate actions, por lo que esa ruta no está conectada a datos live.

No existe en el proyecto un endpoint separado de splits ni persistencia de
acciones societarias. Tampoco existe un campo `adjustedClose` separado: los
aliases `precioAjustado`/`cierreAjustado` se normalizan al mismo `close` sólo
cuando el payload alternativo los entrega.

## Inventario de cálculos y transformaciones

| Ubicación | Métrica | Numerador / denominador | Precio y fecha | Resultado de auditoría |
| --- | --- | --- | --- | --- |
| `src/lib/marketPerformance.ts` `calculateReturnPercentage` | retorno histórico y variación diaria | `endPrice / startPrice` | cierres positivos sin redondear | Fuente única, correcto |
| `src/lib/marketPerformance.ts` `selectPerformanceWindow` | selección de período | último cierre / última rueda `<= targetDate` | calendario anclado al último dato | Corrige desfase de PAMP, fines de semana, feriados y bisiestos |
| `src/lib/marketPerformance.ts` `deriveStartPriceFromReturnPercentage` | reconstrucción de cierre anterior | `current / (1 + pct/100)` | sólo fallback cuando falta un cierre anterior confiable | Correcto; rechaza `pct <= -100%` |
| `src/lib/panel.ts` `parsePanelTitulo` y `normalizeQuoteData` | variación diaria de panel/favoritos | último precio / último cierre | intradiario o último precio del proveedor contra cierre anterior | Se recalcula centralmente cuando existen ambos precios; el porcentaje upstream queda sólo como fallback |
| `src/lib/stockQuote.ts` `normalizeStockQuoteDetail` | variación diaria de detalle | último precio / cierre anterior | cotización actual | Se recalcula centralmente; no usa valores mostrados |
| `src/features/dashboard/stock-detail/currentStockQuote.ts` | variación diaria resuelta | precio actual / cierre anterior resuelto | detalle, panel o histórico | Se recalcula centralmente y mantiene separada la métrica diaria |
| `src/features/dashboard/charts/advancedStockChart.ts` `calculateDailyQuoteMetrics` | variación diaria histórica | último cierre / cierre anterior o punto previo | últimas dos ruedas válidas | El precio calculado tiene prioridad sobre el porcentaje upstream |
| `src/features/dashboard/charts/AdvancedStockDetailChart.tsx` | tooltip diario | cierre del punto / cierre de la rueda previa | puntos visibles ordenados | Centralizado y coherente con el gráfico |
| `src/features/dashboard/charts/advancedStockChart.ts` `calculatePeriodMetrics` | variación del período | último cierre visible / cierre de referencia visible | misma serie entregada al gráfico | Centralizado; gráfico y resumen comparten extremos |
| `src/lib/server/demo/demoMarketData.ts` | variaciones demo | cierre actual / cierre anterior | serie demo determinística | Centralizado y con períodos calendario |
| `src/features/dashboard/shared/stockQuoteMetrics.ts` | cierre anterior derivado | precio actual / factor porcentual | sólo si no hay cierre explícito válido | Centralizado; no redondea |
| `src/lib/formatters.ts` | porcentaje visible | no calcula rendimiento | valor numérico final | Sólo redondea para UI |
| `src/features/dashboard/stocks/stockVariationSeverity.ts` | clases visuales | valor absoluto contra umbrales | porcentaje ya calculado | No transforma el valor |
| sorting, favoritos y caches | orden/almacenamiento | ninguno | guardan el número normalizado | No recalculan ni redondean |

## Causa de PAMP

El backend construía `1Y` restando 365 días al reloj del servidor. El 18-09-2026
pidió datos desde 18-09-2025, mientras la última rueda disponible era
17-09-2026. La UI tomó simplemente el primer y último array: 3.520 y 5.335.
Eso produjo 51,5625%. La referencia correcta, anclada al último cierre, es
17-09-2025 a 3.595; el resultado es 48,400556% y se presenta como `+48,40%`.

## Validación live puntual

La lógica se ejecutó el 18-09-2026 contra el BFF en modo live. Estos valores son
evidencia de revisión y no quedaron hardcodeados en la aplicación:

| Símbolo | Variante resuelta | Referencia → cierre | Retorno 1Y | Decisión |
| --- | --- | --- | ---: | --- |
| PAMP | `ajustada` | 3.595 → 5.335 | +48,400556% | publicable |
| GGAL | `ajustada` | 4.395 → 6.810 | +54,948805% | publicable |
| ALUA | `ajustada` | 689 → 862 | +25,108853% | publicable |
| TXAR | `ajustada` | 573,5 → 670 | +16,826504% | publicable |
| COME | `ajustada` | 33,05 → 40,78 | +23,388805% | publicable |
| YPFD | `ajustada` | 40.820 → 8.690 | -78,711416% raw | omitido por salto compatible con split |
| AAPL | `sinAjustar` | 17.870 → 26.880 | +50,419698% raw | omitido por base no ajustada |

La muestra adicional encontró así dos fallas que PAMP por sí solo no revelaba:
el proveedor puede devolver una serie denominada `ajustada` con discontinuidad
de split (YPFD), y puede resolver un CEDEAR únicamente como `sinAjustar` (AAPL).
En ambos casos la UI ahora evita publicar un rendimiento potencialmente falso.

## Riesgos residuales

- IOL no define públicamente con precisión si `ajustada` incorpora dividendos,
  splits, ambos u otros eventos; la evidencia live demuestra al menos un split
  no ajustado.
- La detección de saltos extremos es defensiva, no reemplaza un feed de acciones
  societarias. Puede omitir un rendimiento ante un movimiento económico extremo
  real y puede no detectar ratios pequeños.
- Hasta incorporar un origen autorizado de corporate actions, el proyecto no
  autoajusta series live ni debe afirmar que ofrece total return.
