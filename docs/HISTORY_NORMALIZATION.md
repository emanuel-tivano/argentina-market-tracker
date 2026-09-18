# Normalización del histórico

## Diagnóstico live de ALUA

Inspección controlada del 18-09-2026, mercado `bCBA`, desde 03-09-2021 hasta
18-09-2026 (rango 5Y más el margen de referencia). Se usó la integración server
existente; no se guardaron tokens ni payloads completos. Los conteos corresponden
a la consulta observada, no son objetivos fijos.

| Símbolo | Variante | Requests | Recibidos | Ruedas únicas | Duplicados | % sobre recibidos | Fechas duplicadas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PAMP | ajustada | 1 | 2443 | 1232 | 1211 | 49,57% | 1 |
| GGAL | ajustada | 1 | 4336 | 1232 | 3104 | 71,59% | 1 |
| ALUA | ajustada | 1 | 2606 | 1232 | 1374 | 52,72% | 1 |
| TXAR | ajustada | 1 | 2009 | 1232 | 777 | 38,68% | 1 |
| COME | ajustada | 1 | 1957 | 1232 | 725 | 37,05% | 1 |
| YPFD | ajustada | 1 | 3677 | 1232 | 2445 | 66,49% | 1 |
| AAPL | sinAjustar | 2 | 5939 | 1232 | 4707 | 79,26% | 5 |

En ALUA, 1231 fechas tienen una fila y **2022-05-17 tiene 1375 filas**.
Sus 1375 `fechaHora` son distintos: desde `03:00:03.213` hasta `17:00:03.007`,
sin zona horaria explícita. El array no está ordenado cronológicamente.

Campos que difieren dentro de esa fecha:

| Upstream | Campo normalizado | Valores distintos |
| --- | --- | ---: |
| fechaHora | timestamp (date conserva 2022-05-17) | 1375 |
| apertura | open | 3 |
| maximo | high | 16 |
| minimo | low | 4 |
| volumenNominal | volume | 394 |
| montoOperado | amountTraded | 675 |

`ultimoPrecio/close` es 84.5 en todo el grupo. `variacion/dailyVariation`,
`cierreAnterior/previousClose` y `precioPromedio/averagePrice` son 0 y constantes;
`moneda/currency` es constante. No se observaron diferencias en `plazo`,
`descripcionTitulo`, `tendencia`, `precioAjuste`, `interesesAbiertos`, `puntas`,
`cantidadOperaciones`, `laminaMinima` ni `lote`. No hay evidencia de distintos
plazos o mercados como causa; el normalizador no recibió variantes mezcladas.
Los 1375 registros completos son distintos; al excluir `fechaHora` quedan 1348
snapshots distintos. Sólo el snapshot final coincide consigo mismo en todos los
campos económicos, por lo que las 1374 filas removidas son conflictivas respecto
de la seleccionada, aunque todas comparten el cierre 84,5.

La evidencia es compatible con snapshots intradiarios de una misma rueda,
no con 1374 filas inválidas ni con 1374 ruedas adicionales. No demuestra por
qué el proveedor incluyó esos snapshots en una única fecha. En las páginas
públicas consultadas de [IOL API](https://api.invertironline.com/Help) no se
encontró una garantía de orden del array ni una explicación de esta anomalía;
no se asume que ocurra normalmente en todas las series.

## Origen y flujo

Los duplicados ya están presentes en el único JSON devuelto por IOL, antes del
adapter y de la normalización. Para PAMP, GGAL, ALUA, TXAR, COME e YPFD, 5Y hace
un solo request de variante `ajustada`. AAPL hace dos porque `ajustada` llega
vacía y se consulta `sinAjustar`; las respuestas no se concatenan.

No existe paginación en este flujo ni ventanas consecutivas inclusivas. El retry
de autenticación ante 401/403 reemplaza la respuesta fallida y tampoco concatena
datos. La caché almacena la respuesta ya normalizada. Por lo tanto, la causa no
es superposición local, retry, caché, timezone ni combinación adjusted/raw.

La detección ocurre en `normalizeStockHistoryDataResult`, agrupando por fecha de
mercado. El BFF selecciona el período después de consolidar y el frontend recibe
una sola fila por rueda. Para la consulta medida hay 1232 fechas únicas antes del
recorte y 1222 puntos servidos después de quitar el margen anterior a la rueda de
referencia.

## Selección diaria

Se conserva una fila completa por fecha, sin sumar volúmenes acumulados ni
combinar campos de snapshots distintos. Se selecciona el timestamp más reciente
si todas las filas del grupo tienen timestamps ISO válidos, correspondientes a
esa fecha, comparables entre sí, y la misma moneda y plazo.

Los timestamps sin zona se comparan como valores de un mismo reloj local,
independientemente de la zona del servidor. Los que declaran zona se comparan
por instante y se asignan a la fecha de mercado de Buenos Aires. No se mezclan
ambos tipos. Si las filas son económicamente idénticas, se conserva una de forma
determinística aunque no exista una cronología útil.

Si OHLC, cierre, volumen u otros campos difieren y no existe un timestamp máximo
inequívoco, o se mezclan moneda/plazo, se omite la rueda completa y se contabiliza
como inconsistencia. Ya no se conserva arbitrariamente la última fila del array.
Un empate de timestamp con valores diferentes también se omite.

Para ALUA se selecciona `2022-05-17T17:00:03.007`, con OHLC
83 / 85.6 / 82.2 / 84.5 y volumen 817236. La política anterior elegía una fila
con volumen 0. Ambas conservan el mismo cierre. Tras el cambio se verificaron
1232 fechas únicas ascendentes antes del recorte (1222 servidas) y el mismo
resultado al invertir el array live.
No se agregan días sin cotización ni se eliminan ruedas por ser duplicadas.

## Contrato y observabilidad

`StockHistoryNormalizationCounts` es la fuente compartida del normalizador y meta:

- `invalidPoints`: filas que no se pudieron normalizar o pertenecían a una rueda
  conflictiva sin una selección temporal segura.
- `duplicatePoints`: filas válidas consolidadas por compartir fecha.
- `discardedPoints`: agregado compatible, `invalidPoints + duplicatePoints`.
  **No significa cantidad de filas inválidas.**
- `totalPoints`: cantidad final de fechas devueltas, igual a `data.length`.

La consulta incorpora ahora un margen anterior de 14 días para encontrar la
rueda de referencia de un período calendario. Los puntos válidos de ese margen
que quedan antes de la referencia se excluyen de `data`; por eso ya no se puede
reconstruir la cantidad bruta sumando `totalPoints` y `discardedPoints`. Los
logs de normalización conservan el total único previo al recorte y el log de
variante seleccionada informa la cantidad efectivamente servida.

Demo devuelve ambos contadores nuevos en cero. Caché y stale preservan meta.
El cliente valida enteros no negativos y la consistencia del agregado.
Las métricas nuevas son `history.invalid_points.total` y
`history.duplicate_points.total`, junto con
`history.duplicate_trading_days.total`,
`history.conflicting_duplicate_points.total`,
`history.ambiguous_duplicate_points.total` y
`history.normalization_anomaly.total`; `history.discarded_points.total` conserva
explícitamente la suma compatible. Labels: provider, market, range y variant;
symbol y requestId quedan en logs, no en labels.

El log estructurado incluye provider, symbol, range, recordsFetched,
validRecords, uniqueTradingDays, duplicateTradingDays, duplicatesRemoved,
conflictingDuplicates, identicalDuplicates, ambiguousDuplicatePoints,
omittedTradingDays, maxMultiplicity, duplicateRatio y requestCount. Una relación
`duplicatesRemoved / uniqueTradingDays >= 0,5` genera
`history.normalize.anomaly`; inconsistencias omitidas generan
`history.normalize.partial`.

La UI pública no muestra cantidades internas de duplicados cuando la
consolidación fue segura. Si se omitieron filas ambiguas o inválidas muestra el
mensaje: “Algunos datos históricos presentan inconsistencias y fueron
omitidos.” Los contadores permanecen en el contrato y en observabilidad.

## Impacto funcional y performance

La deduplicación ocurre antes de selección de período, cálculo porcentual,
gráfico, velas, SMA, min/max, volumen y tooltips. Esos consumidores operan sobre
ruedas únicas; no suman snapshots ni usan índices de la lista raw. En ALUA el
snapshot elegido conserva el mismo cierre 84,5, por lo que los retornos no cambian;
sí evita mostrar el volumen cero de un snapshot temprano.

La medición directa de ALUA transfirió aproximadamente 1,51 MB y tardó 395 ms
en la consulta observada. El exceso de trabajo proviene del payload upstream y
no de requests redundantes locales. Dividir el período no evitaría la anomalía y
podría introducir superposiciones; la caché de cinco minutos ya evita repetir el
fetch. Se mantiene la normalización defensiva sin una optimización especulativa.

## Límites de la evidencia

La inspección detectó 1 fecha con OHLC fuera de sus límites en `1Y` y 4 en `5Y`,
tanto antes como después de esta corrección. Son inconsistencias preexistentes
de los valores upstream, distintas de duplicación o fechas inválidas. No se
alteran precios ni se eliminan esas ruedas para aparentar coherencia. Los tests
verifican que snapshots con OHLC coherente sigan siendo coherentes y que la
selección copie una fila completa. Una corrección de esos valores requiere
evidencia adicional del proveedor sobre ajustes y campos OHLC.

Los tests usan datos sintéticos; los números observados no se hardcodean como
cantidad obligatoria de ruedas para cinco años.
