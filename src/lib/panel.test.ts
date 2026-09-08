import { describe, expect, it } from 'vitest'
import {
  normalizePanelData,
  normalizePanelDataResult,
  normalizeQuoteData,
  PanelNormalizationError,
} from './panel'

describe('normalizePanelData', () => {
  it('accepts a direct array payload', () => {
    expect(
      normalizePanelData([
        {
          simbolo: 'GGAL',
          descripcion: 'Grupo Financiero Galicia',
        },
      ])
    ).toEqual([
      {
        simbolo: 'GGAL',
        descripcion: 'Grupo Financiero Galicia',
      },
    ])
  })

  it('accepts a payload with titulos', () => {
    expect(
      normalizePanelData({
        titulos: [
          {
            simbolo: 'YPFD',
            descripcion: 'YPF',
          },
        ],
      })
    ).toEqual([
      {
        simbolo: 'YPFD',
        descripcion: 'YPF',
      },
    ])
  })

  it('accepts a payload with data', () => {
    expect(
      normalizePanelData({
        data: [
          {
            simbolo: 'MIRG',
            descripcion: 'Mirgor',
          },
        ],
      })
    ).toEqual([
      {
        simbolo: 'MIRG',
        descripcion: 'Mirgor',
      },
    ])
  })

  it('accepts an empty payload as no results', () => {
    expect(normalizePanelData([])).toEqual([])
    expect(normalizePanelData({ data: [] })).toEqual([])
  })

  it('keeps valid rows when a non-empty payload mixes valid and invalid items', () => {
    expect(
      normalizePanelData([
        { simbolo: '', descripcion: 'Missing ticker' },
        { simbolo: 'COME', descripcion: 'Sociedad Comercial del Plata' },
      ])
    ).toEqual([
      {
        simbolo: 'COME',
        descripcion: 'Sociedad Comercial del Plata',
      },
    ])
  })

  it('returns partial normalization metadata for mixed valid and invalid items', () => {
    expect(
      normalizePanelDataResult([
        { simbolo: '', descripcion: 'Missing ticker' },
        { simbolo: 'GGAL', descripcion: 'Grupo Financiero Galicia' },
        {
          simbolo: 'PAMP',
          descripcion: 'Pampa Energia',
          ultimoPrecio: 'not-a-number',
        },
      ])
    ).toEqual({
      data: [
        {
          simbolo: 'GGAL',
          descripcion: 'Grupo Financiero Galicia',
        },
      ],
      droppedItemsCount: 2,
      droppedItemsSummary: [
        { reason: 'INVALID_IDENTITY:1' },
        { reason: 'INVALID_NUMERIC_FIELD:ultimoPrecio:1' },
      ],
    })
  })

  it('throws when a row has missing required fields', () => {
    expect(() =>
      normalizePanelData([
        { simbolo: 'ALUA' },
      ])
    ).toThrow('Upstream payload contains no valid items')
  })

  it('throws when the upstream structure is invalid', () => {
    expect(() => normalizePanelData({ items: [] })).toThrow(
      'Invalid upstream payload structure'
    )
  })

  it('throws when a non-empty payload has no valid items', () => {
    expect(() =>
      normalizePanelData([
        { simbolo: '', descripcion: 'Missing ticker' },
        { simbolo: 'ALUA', descripcion: '' },
      ])
    ).toThrow('Upstream payload contains no valid items')
  })

  it('keeps optional numeric fields missing without failing the row', () => {
    expect(
      normalizePanelData([
        {
          simbolo: 'PAMP',
          descripcion: 'Pampa Energia',
          ultimoPrecio: 123.45,
          maximo: 130,
          ultimoCierre: 122,
          volumen: 1000,
        },
      ])
    ).toEqual([
      {
        simbolo: 'PAMP',
        descripcion: 'Pampa Energia',
        ultimoPrecio: 123.45,
        maximo: 130,
        ultimoCierre: 122,
        volumen: 1000,
      },
    ])
  })

  it('accepts safe numeric strings and normalizes them to numbers', () => {
    expect(
      normalizePanelData([
        {
          simbolo: 'PAMP',
          descripcion: 'Pampa Energia',
          ultimoPrecio: '123.45',
          variacionPorcentual: '-1,25',
          volumen: '1,234,567',
          montoOperado: '1.234.567,89',
          puntas: {
            cantidadCompra: '10',
            precioVenta: '1,234.50',
          },
        },
      ])
    ).toEqual([
      {
        simbolo: 'PAMP',
        descripcion: 'Pampa Energia',
        ultimoPrecio: 123.45,
        variacionPorcentual: -1.25,
        volumen: 1234567,
        montoOperado: 1234567.89,
        puntas: {
          cantidadCompra: 10,
          precioVenta: 1234.5,
        },
      },
    ])
  })

  it('treats null optional fields as absent without leaking null internally', () => {
    const [item] = normalizePanelData([
      {
        simbolo: 'ALUA',
        descripcion: 'Aluar',
        ultimoPrecio: null,
        variacionPorcentual: null,
        apertura: null,
        maximo: null,
        minimo: null,
        ultimoCierre: null,
        volumen: null,
        fechaHora: null,
        montoOperado: null,
        cantidadOperaciones: null,
        moneda: null,
        plazo: null,
        laminaMinima: null,
        lote: null,
        puntas: null,
      },
    ])

    expect(item).toEqual({
      simbolo: 'ALUA',
      descripcion: 'Aluar',
    })
    expect(Object.values(item)).not.toContain(null)
  })

  it('omits null fields inside puntas while preserving valid values', () => {
    expect(
      normalizePanelData([
        {
          simbolo: 'BMA',
          descripcion: 'Banco Macro',
          puntas: {
            cantidadCompra: null,
            precioCompra: '250,50',
            precioVenta: null,
            cantidadVenta: null,
          },
        },
      ])
    ).toEqual([
      {
        simbolo: 'BMA',
        descripcion: 'Banco Macro',
        puntas: {
          precioCompra: 250.5,
        },
      },
    ])
  })

  it('accepts moneda null as an absent optional string', () => {
    expect(
      normalizePanelData([
        { simbolo: 'GGAL', descripcion: 'Galicia', moneda: null },
      ])
    ).toEqual([{ simbolo: 'GGAL', descripcion: 'Galicia' }])
  })

  it('accepts plazo null as an absent optional string', () => {
    expect(
      normalizePanelData([
        { simbolo: 'YPFD', descripcion: 'YPF', plazo: null },
      ])
    ).toEqual([{ simbolo: 'YPFD', descripcion: 'YPF' }])
  })

  it.each([
    ['alphabetic text', 'abc'],
    ['currency text', '$ 123.45'],
    ['multiple decimal separators', '12.34.56'],
    ['scientific notation', '1e3'],
    ['non-finite text', 'Infinity'],
    ['empty text', '   '],
    ['object', {}],
    ['array', []],
    ['NaN', Number.NaN],
    ['Infinity number', Number.POSITIVE_INFINITY],
  ])('rejects invalid numeric inputs: %s', (_caseName, ultimoPrecio) => {
    expect(() =>
      normalizePanelData([
        {
          simbolo: 'PAMP',
          descripcion: 'Pampa Energia',
          ultimoPrecio,
        },
      ])
    ).toThrow('Upstream payload contains no valid items')
  })

  it('normalizes puntas when their numeric fields are valid', () => {
    expect(
      normalizePanelData([
        {
          simbolo: 'BMA',
          descripcion: 'Banco Macro',
          puntas: {
            cantidadCompra: 10,
            precioVenta: 250,
          },
        },
      ])
    ).toEqual([
      {
        simbolo: 'BMA',
        descripcion: 'Banco Macro',
        puntas: {
          cantidadCompra: 10,
          precioVenta: 250,
        },
      },
    ])
  })

  it('drops invalid nested puntas rows while keeping valid rows', () => {
    expect(
      normalizePanelData([
        {
          simbolo: 'BMA',
          descripcion: 'Banco Macro',
          puntas: 'invalid',
        },
        {
          simbolo: 'GGAL',
          descripcion: 'Grupo Financiero Galicia',
        },
      ])
    ).toEqual([
      {
        simbolo: 'GGAL',
        descripcion: 'Grupo Financiero Galicia',
      },
    ])
  })

  it.each([
    ['string', 'invalid'],
    ['array', []],
  ])('rejects an invalid puntas %s structure', (_caseName, puntas) => {
    expect(() =>
      normalizePanelData([
        {
          simbolo: 'BMA',
          descripcion: 'Banco Macro',
          puntas,
        },
      ])
    ).toThrow('Upstream payload contains no valid items')
  })

  it('keeps fail-closed behavior when every item is genuinely invalid', () => {
    expect(() =>
      normalizePanelData([
        {
          simbolo: 'PAMP',
          descripcion: 'Pampa Energia',
          ultimoPrecio: 'abc',
        },
        {
          simbolo: 'BMA',
          descripcion: 'Banco Macro',
          puntas: [],
        },
      ])
    ).toThrowError(
      new PanelNormalizationError('Upstream payload contains no valid items')
    )
  })

  it('normalizes the individual quote payload shape returned by IOL', () => {
    expect(
      normalizeQuoteData(
        {
          ultimoPrecio: 967.5,
          variacion: 3.09,
          apertura: 948,
          maximo: 970.5,
          minimo: 920,
          cierreAnterior: 938.5,
          volumenNominal: 407493,
          montoOperado: 394290127.5,
          cantidadOperaciones: 156,
          moneda: 'peso_Argentino',
          plazo: '48hs',
          laminaMinima: 1,
          lote: 1,
          fechaHora: '2026-06-24T00:06:03.521Z',
          descripcionTitulo: 'Aluar',
          puntas: [
            {
              cantidadCompra: 18,
              precioCompra: 907.5,
              precioVenta: 974.5,
              cantidadVenta: 6,
            },
          ],
        },
        {
          symbol: 'ALUA',
        }
      )
    ).toEqual({
      simbolo: 'ALUA',
      descripcion: 'Aluar',
      ultimoPrecio: 967.5,
      variacionPorcentual: 3.09,
      apertura: 948,
      maximo: 970.5,
      minimo: 920,
      ultimoCierre: 938.5,
      volumen: 407493,
      montoOperado: 394290127.5,
      cantidadOperaciones: 156,
      moneda: 'peso_Argentino',
      plazo: '48hs',
      laminaMinima: 1,
      lote: 1,
      fechaHora: '2026-06-24T00:06:03.521Z',
      puntas: {
        cantidadCompra: 18,
        precioCompra: 907.5,
        precioVenta: 974.5,
        cantidadVenta: 6,
      },
    })
  })

  it('supports the IOL array shape and falls back to the symbol as description', () => {
    expect(
      normalizeQuoteData(
        [
          {
            ultimoPrecio: 100,
            apertura: 98,
            maximo: 102,
            minimo: 97,
            cierreAnterior: 99,
            volumenNominal: 0,
            fechaHora: '2026-06-24T00:06:03.521Z',
          },
        ],
        {
          symbol: 'GGAL',
        }
      )
    ).toEqual({
      simbolo: 'GGAL',
      descripcion: 'GGAL',
      ultimoPrecio: 100,
      apertura: 98,
      maximo: 102,
      minimo: 97,
      ultimoCierre: 99,
      volumen: 0,
      fechaHora: '2026-06-24T00:06:03.521Z',
    })
  })
})
