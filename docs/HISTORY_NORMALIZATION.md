# Normalización del histórico

## Diagnóstico live de ALUA

Inspección controlada de la variante `ajustada`, mercado `bCBA`. Se usó la
integración server existente; no se guardaron tokens ni payloads completos.
Los conteos corresponden a la consulta observada, no son objetivos fijos.

| Rango | Filas upstream | Filas válidas | Duplicados | Inválidas | Fechas finales |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1Y | 245 | 245 | 0 | 0 | 245 |
| 5Y | 2594 | 2594 | 1374 | 0 | 1220 |

En `5Y`, 1219 fechas tienen una fila y **2022-05-17 tiene 1375 filas**.
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

La evidencia es compatible con snapshots intradiarios de una misma rueda,
no con 1374 filas inválidas ni con 1374 ruedas adicionales. No demuestra por
qué el proveedor incluyó esos snapshots en una única fecha. En las páginas
públicas consultadas de [IOL API](https://api.invertironline.com/Help) no se
encontró una garantía de orden del array ni una explicación de esta anomalía;
no se asume que ocurra normalmente en todas las series.

## Selección diaria

Se conserva una fila completa por fecha, sin sumar volúmenes acumulados ni
combinar campos de snapshots distintos. Se selecciona el timestamp más reciente
si todas las filas del grupo tienen timestamps ISO válidos, correspondientes a
esa fecha, comparables entre sí, y la misma moneda y plazo.

Los timestamps sin zona se comparan como valores de un mismo reloj local,
independientemente de la zona del servidor. Los que declaran zona se comparan
por instante. No se mezclan ambos tipos. En un empate temporal se conserva la
última fila entre las empatadas; sin cronología comparable o con distinta moneda
o plazo se conserva la última fila válida del array, por compatibilidad. Estos
casos ambiguos no tienen una preferencia conceptual demostrada y pueden depender
del orden del proveedor. No se inventa una preferencia de liquidación.

Para ALUA se selecciona `2022-05-17T17:00:03.007`, con OHLC
83 / 85.6 / 82.2 / 84.5 y volumen 817236. La política anterior elegía una fila
con volumen 0. Ambas conservan el mismo cierre. Tras el cambio se verificaron
1220 fechas únicas ascendentes y el mismo resultado al invertir el array live.
No se agregan días sin cotización ni se eliminan ruedas por ser duplicadas.

## Contrato y observabilidad

`StockHistoryNormalizationCounts` es la fuente compartida del normalizador y meta:

- `invalidPoints`: filas que no se pudieron normalizar (fecha o cierre inválidos).
- `duplicatePoints`: filas válidas consolidadas por compartir fecha.
- `discardedPoints`: agregado compatible, `invalidPoints + duplicatePoints`.
  **No significa cantidad de filas inválidas.**
- `totalPoints`: cantidad final de fechas, igual a `data.length` (semántica previa).
- Filas brutas = `totalPoints + invalidPoints + duplicatePoints`.

Demo devuelve ambos contadores nuevos en cero. Caché y stale preservan meta.
El cliente valida enteros no negativos y la consistencia del agregado.
Las métricas nuevas son `history.invalid_points.total` y
`history.duplicate_points.total`; `history.discarded_points.total` conserva
explícitamente su suma por compatibilidad. Labels: market, range y variant;
symbol y requestId quedan en logs, no en labels. Los duplicados solos se registran
como información (`history.normalize.consolidated`); los inválidos mantienen
el warning `history.normalize.partial`. La UI usa los contadores separados y
presenta la consolidación con estilo informativo.

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
