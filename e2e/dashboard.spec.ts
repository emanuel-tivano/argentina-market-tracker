import { expect, type Locator, type Page, test } from '@playwright/test'
import type { StockHistoryNormalizationCounts, StockHistoryRange } from '../src/lib/stockHistory'

type PanelKey = 'lider' | 'general' | 'cedears'

type PanelRequest = {
  type: string | null
  refresh: string | null
}

type HistoryRequest = {
  symbol: string
  range: string | null
  market: string | null
}

type QuoteRequest = {
  symbol: string
  market: string | null
}

type BrowserDiagnostics = {
  consoleErrors: string[]
  pageErrors: string[]
}

type MockPanelItem = {
  simbolo: string
  descripcion: string
  ultimoPrecio?: number
  variacionPorcentual?: number
  volumen?: number
}

type MockHistoryPoint = {
  date: string
  close: number
  open?: number
  high?: number
  low?: number
  volume?: number
}

const fetchedAt = '2026-05-04T16:00:00.000Z'

const panelData: Record<PanelKey, MockPanelItem[]> = {
  lider: [
    {
      simbolo: 'GGAL',
      descripcion: 'Grupo Financiero Galicia',
      ultimoPrecio: 4200.5,
      variacionPorcentual: 1.25,
      volumen: 120000,
    },
  ],
  general: [
    {
      simbolo: 'YPFD',
      descripcion: 'YPF',
      ultimoPrecio: 38000,
      variacionPorcentual: -0.75,
      volumen: 90000,
    },
  ],
  cedears: [
    {
      simbolo: 'AAPL',
      descripcion: 'Apple',
      ultimoPrecio: 15000,
      variacionPorcentual: 0.5,
      volumen: 70000,
    },
  ],
}

function panelResponse(data: MockPanelItem[], cacheStatus = 'fresh') {
  const stale = cacheStatus === 'stale'

  return {
    ok: true,
    data,
    fetchedAt,
    servedAt: fetchedAt,
    staleUntil: '2026-05-04T16:02:00.000Z',
    cacheStatus,
    stale,
    ...(stale ? { degradationReason: 'upstream-unavailable' } : {}),
  }
}

function historySuccessResponse(
  symbol: string,
  range: string,
  data: MockHistoryPoint[],
  cacheStatus = 'fresh',
  counts: Pick<StockHistoryNormalizationCounts, 'invalidPoints' | 'duplicatePoints'> = { invalidPoints: 0, duplicatePoints: 0 }
) {
  return {
    ok: true,
    data,
    fetchedAt,
    servedAt: fetchedAt,
    cacheStatus,
    range,
    market: 'bCBA',
    symbol,
    meta: {
      ...counts,
      discardedPoints: counts.invalidPoints + counts.duplicatePoints,
      source: 'demo',
      stale: false,
      totalPoints: data.length,
    },
  }
}

async function mockPanelApi(
  page: Page,
  options: {
    requests?: PanelRequest[]
    delayRefreshMs?: number
    error?: boolean
  } = {}
) {
  await page.route(/\/api\/panel(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url())
    const type = url.searchParams.get('type') ?? 'lider'
    const refresh = url.searchParams.get('refresh')

    options.requests?.push({ type, refresh })

    if (options.error) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'PANEL_ERROR',
        }),
      })
      return
    }

    if (refresh === '1' && options.delayRefreshMs) {
      await new Promise((resolve) => {
        setTimeout(resolve, options.delayRefreshMs)
      })
    }

    const key = type === 'general' || type === 'cedears' ? type : 'lider'
    const data =
      refresh === '1'
        ? [
            {
              ...panelData[key][0],
              simbolo: `${panelData[key][0].simbolo}R`,
            },
          ]
        : panelData[key]

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(panelResponse(data)),
    })
  })
}

async function mockHistoryApi(
  page: Page,
  options: {
    requests?: HistoryRequest[]
    responsesByRange?: Partial<
      Record<StockHistoryRange, MockHistoryPoint[]>
    >
    errorRanges?: string[]
    normalizationCounts?: Pick<StockHistoryNormalizationCounts, 'invalidPoints' | 'duplicatePoints'>
  } = {}
) {
  await page.route(/\/api\/stocks\/[^/]+\/history\?/, async (route) => {
    const url = new URL(route.request().url())
    const pathMatch = url.pathname.match(/\/api\/stocks\/([^/]+)\/history$/)
    const symbol = pathMatch ? decodeURIComponent(pathMatch[1] ?? '') : ''
    const range = url.searchParams.get('range')
    const market = url.searchParams.get('market')

    options.requests?.push({ symbol: symbol.toUpperCase(), range, market })

    if (range && options.errorRanges?.includes(range)) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'HISTORY_ERROR',
        }),
      })
      return
    }

    const data = range
      ? (options.responsesByRange?.[
          range as keyof NonNullable<typeof options.responsesByRange>
        ] ?? [])
      : []

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        historySuccessResponse(symbol.toUpperCase(), range ?? '1M', data, 'fresh', options.normalizationCounts)
      ),
    })
  })
}

async function mockQuoteApi(
  page: Page,
  options: {
    requests?: QuoteRequest[]
  } = {}
) {
  await page.route(/\/api\/stocks\/[^/]+\/quote\?/, async (route) => {
    const url = new URL(route.request().url())
    const pathMatch = url.pathname.match(/\/api\/stocks\/([^/]+)\/quote$/)
    const symbol = pathMatch ? decodeURIComponent(pathMatch[1] ?? '') : ''
    const market = url.searchParams.get('market')

    options.requests?.push({ symbol: symbol.toUpperCase(), market })

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          symbol: symbol.toUpperCase(),
          market: market ?? 'bCBA',
          description:
            symbol.toUpperCase() === 'GGAL'
              ? 'Grupo Financiero Galicia'
              : symbol.toUpperCase(),
          price: 4200.5,
          variation: 1.25,
          open: 4100,
          high: 4250,
          low: 4050,
          timestamp: fetchedAt,
          previousClose: 4148.63,
          amountTraded: 504060000,
          volume: 120000,
          averagePrice: null,
          currency: 'ARS',
          openInterest: null,
          operationCount: 50,
          settlement: 'CI',
          minimumSheet: null,
          lot: null,
          minimumQuantity: null,
          depth: [
            {
              buyQuantity: 100,
              buyPrice: 4195,
              sellPrice: 4205,
              sellQuantity: 120,
            },
          ],
        },
        fetchedAt,
        servedAt: fetchedAt,
        source: 'demo',
        market: market ?? 'bCBA',
        symbol: symbol.toUpperCase(),
      }),
    })
  })
}

async function selectMarketPanel(page: Page, label: string) {
  const panelButton = page.getByRole('button', {
    name: `Mostrar panel ${label}`,
  })

  if (await panelButton.isVisible().catch(() => false)) {
    await panelButton.click()
    return
  }

  await page
    .getByRole('button', { name: 'Abrir navegación de paneles' })
    .click()
  await panelButton.click()
}

function attachBrowserDiagnostics(page: Page): BrowserDiagnostics {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message)
  })

  return {
    consoleErrors,
    pageErrors,
  }
}

function expectNoBrowserErrors(
  diagnostics: BrowserDiagnostics,
  options: {
    allowedConsoleErrors?: RegExp[]
  } = {}
) {
  const unexpectedConsoleErrors = diagnostics.consoleErrors.filter(
    (message) =>
      !options.allowedConsoleErrors?.some((pattern) => pattern.test(message))
  )

  expect(
    unexpectedConsoleErrors,
    `Unexpected browser console errors:\n${unexpectedConsoleErrors.join('\n')}`
  ).toEqual([])
  expect(
    diagnostics.pageErrors,
    `Unexpected browser runtime errors:\n${diagnostics.pageErrors.join('\n')}`
  ).toEqual([])
}

async function expectPanelRequest(
  requests: PanelRequest[],
  expectedType: PanelKey = 'lider'
) {
  await expect
    .poll(
      () => requests.some((request) => request.type === expectedType),
      {
        message: `Expected an intercepted /api/panel request for type=${expectedType}. Recorded requests: ${JSON.stringify(
          requests
        )}`,
      }
    )
    .toBe(true)
}

async function tabUntilFocused(
  page: Page,
  locator: Locator,
  maxTabs = 20
) {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await locator.evaluate((node) => node === document.activeElement)) {
      return
    }

    await page.keyboard.press('Tab')
  }

  throw new Error(`Could not focus target after ${maxTabs} tabs`)
}

test.describe('dashboard', () => {
  test('loads the initial panel with mocked market data and freshness metadata', async ({
    page,
  }) => {
    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })

    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics, {
      allowedConsoleErrors: [
        /Failed to load resource: the server responded with a status of 502/,
      ],
    })

    await expect(page.getByRole('heading', { name: 'Panel Líder' })).toBeVisible()
    await expect(
      page.getByLabel('Demo pública con datos sintéticos')
    ).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: 'Abrir detalle de GGAL, Grupo Financiero Galicia',
      })
    ).toBeVisible()
    await expect(page.getByText(/Actualizado/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Actualizar' })).toHaveCount(0)
  })

  test('switches panels and requests the selected panel type', async ({ page }) => {
    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })
    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics)

    await selectMarketPanel(page, 'Panel General')
    await expect(page.getByRole('heading', { name: 'Panel General' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Abrir detalle de YPFD, YPF' })
    ).toBeVisible()

    await selectMarketPanel(page, 'CEDEARs')
    await expect(page.getByRole('heading', { name: 'CEDEARs' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Abrir detalle de AAPL, Apple' })
    ).toBeVisible()

    await expect
      .poll(() => requests.map((request) => request.type))
      .toEqual(expect.arrayContaining(['lider', 'general', 'cedears']))
  })

  test('keeps freshness beside the panel menu without manual refresh', async ({
    page,
  }, testInfo) => {
    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })
    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics)

    const menuStatus = page.locator('.panel-menu-status')
    const floatingActions = page.locator('.dashboard-floating-actions')

    await expect(menuStatus.getByText(/Actualizado/)).toBeVisible()
    await expect(
      floatingActions.getByRole('button', { name: 'Usar tema oscuro' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Actualizar' })).toHaveCount(0)
    expect(requests.some((request) => request.refresh === '1')).toBe(false)

    if (testInfo.project.name === 'mobile-chrome') {
      for (const width of [375, 400]) {
        await page.setViewportSize({ width, height: 800 })

        const menuToggle = page.locator('.panel-menu-toggle')
        const themeToggle = page.locator('.panel-theme-toggle')
        const freshness = page.locator('.panel-freshness-inline')
        const floatingStack = page.locator('.dashboard-floating-actions')
        const [menuBox, themeBox, freshnessBox] = await Promise.all([
          menuToggle.boundingBox(),
          themeToggle.boundingBox(),
          freshness.boundingBox(),
        ])

        expect(menuBox).not.toBeNull()
        expect(themeBox).not.toBeNull()
        expect(freshnessBox).not.toBeNull()
        await expect(floatingStack).toBeVisible()
        expect(themeBox!.width).toBe(40)
        expect(themeBox!.height).toBe(40)
        expect(freshnessBox!.y).toBeGreaterThanOrEqual(
          menuBox!.y + menuBox!.height
        )
        expect(freshnessBox!.x + freshnessBox!.width).toBeLessThanOrEqual(width)
      }
    }
  })

  test('toggles favorites without breaking the modal flow', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-chrome',
      'Modal quick view is desktop/tablet-large behavior.'
    )

    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })
    await mockHistoryApi(page)
    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics)

    const favoriteButton = page.getByRole('button', {
      name: 'Agregar GGAL a favoritos',
    })

    await favoriteButton.click()
    await expect(
      page.getByRole('button', { name: 'Quitar GGAL de favoritos' })
    ).toBeVisible()

    await page.getByRole('button', {
      name: 'Abrir detalle de GGAL, Grupo Financiero Galicia',
    }).click()

    const dialog = page.getByRole('dialog', { name: 'GGAL' })

    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Quitar GGAL de favoritos' })
    ).toBeVisible()
  })

  test('supports keyboard navigation for favorites and modal focus restoration', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-chrome',
      'Modal focus restoration is desktop/tablet-large behavior.'
    )

    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })
    await mockHistoryApi(page)
    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics)

    const favoriteButton = page.getByRole('button', {
      name: 'Agregar GGAL a favoritos',
    })

    await tabUntilFocused(page, favoriteButton)
    await expect(favoriteButton).toBeFocused()

    await page.keyboard.press('Space')
    await expect(
      page.getByRole('button', { name: 'Quitar GGAL de favoritos' })
    ).toBeFocused()

    const opener = page.getByRole('button', {
      name: 'Abrir detalle de GGAL, Grupo Financiero Galicia',
    })
    await tabUntilFocused(page, opener)
    await expect(opener).toBeFocused()

    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'GGAL' })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Cerrar detalle' })
    ).toBeFocused()

    await page.keyboard.press('Escape')

    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('renders API errors without exposing manual refresh', async ({ page }) => {
    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { error: true, requests })

    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics, {
      allowedConsoleErrors: [
        /Failed to load resource: the server responded with a status of 502/,
      ],
    })

    const errorMessage = page.getByText(
      'Error cargando datos: No se pudo cargar el panel de mercado.'
    )

    await expect(errorMessage).toBeVisible()
    await expect(errorMessage).toHaveText(
      'Error cargando datos: No se pudo cargar el panel de mercado.'
    )
    await expect(page.getByRole('button', { name: 'Actualizar' })).toHaveCount(0)
    await expect(page.getByText('Actualización pendiente')).toBeVisible()
  })

  test('opens and closes the stock details modal while restoring focus', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-chrome',
      'Modal quick view is desktop/tablet-large behavior.'
    )

    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })
    await mockHistoryApi(page)
    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics)

    const opener = page.getByRole('button', {
      name: 'Abrir detalle de GGAL, Grupo Financiero Galicia',
    })

    await opener.click()

    const dialog = page.getByRole('dialog', { name: 'GGAL' })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Grupo Financiero Galicia')).toBeVisible()
    await expect(dialog.getByText('Último precio')).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('mobile navigates to the stock detail page instead of opening the modal', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-chrome',
      'Responsive stock-detail navigation coverage is mobile-specific.'
    )

    const requests: PanelRequest[] = []
    const quoteRequests: QuoteRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })
    await mockHistoryApi(page)
    await mockQuoteApi(page, { requests: quoteRequests })
    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics)

    const favoriteButton = page.getByRole('button', {
      name: 'Agregar GGAL a favoritos',
    })

    await favoriteButton.click()
    await expect(
      page.getByRole('button', { name: 'Quitar GGAL de favoritos' })
    ).toBeVisible()

    const opener = page.getByRole('button', {
      name: 'Abrir detalle de GGAL, Grupo Financiero Galicia',
    })

    await expect(opener).not.toHaveAttribute('aria-haspopup', 'dialog')
    await opener.click()

    await page.waitForURL('**/stocks/GGAL')

    await expect(page.getByRole('dialog', { name: 'GGAL' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'GGAL' })).toBeVisible()
    await expect(
      page.getByRole('heading', {
        name: 'Grupo Financiero Galicia',
        exact: true,
      })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Quitar GGAL de favoritos' })
    ).toBeVisible()
    const marketDepth = page.getByRole('region', { name: 'Puntas' })
    const mobileDepth = marketDepth.locator('.stock-detail-market-depth-mobile')
    const desktopTable = marketDepth.locator(
      '.stock-detail-market-depth-table-wrap'
    )

    await expect(marketDepth).toBeVisible()
    await expect(mobileDepth).toBeVisible()
    await expect(desktopTable).toBeHidden()
    await expect(mobileDepth.getByText('Compra')).toBeVisible()
    await expect(mobileDepth.getByText('Venta')).toBeVisible()
    await expect(mobileDepth.getByText('$ 9.480,00')).toBeVisible()
    await expect(mobileDepth.getByText('$ 9.548,00')).toBeVisible()
    await expect(mobileDepth.getByText('Cantidad: 2.400')).toBeVisible()
    await expect(mobileDepth.getByText('Cantidad: 1.800')).toBeVisible()
    await expect(
      mobileDepth.getByLabel('Precio compra: $ 9.480,00')
    ).toBeVisible()
    await expect(mobileDepth.getByLabel('Cantidad compra: 2.400')).toBeVisible()
    await expect(
      mobileDepth.getByLabel('Precio venta: $ 9.548,00')
    ).toBeVisible()
    await expect(mobileDepth.getByLabel('Cantidad venta: 1.800')).toBeVisible()
    await expect(mobileDepth).not.toContainText('Precio compra')
    await expect(mobileDepth).not.toContainText('Precio venta')
    await expect(mobileDepth).not.toContainText('...')
    expect(quoteRequests).toEqual([])
    expect(requests).toEqual([{ type: 'lider', refresh: null }])
  })

  test('keeps safely consolidated history diagnostics out of the public UI', async ({ page }) => {
    await mockQuoteApi(page)
    await mockHistoryApi(page, {
      normalizationCounts: { invalidPoints: 0, duplicatePoints: 1374 },
      responsesByRange: { '1M': [{ date: '2026-05-07', close: 4200 }] },
    })
    await page.goto('/stocks/GGAL?market=bCBA')
    await expect(page.getByText(/Se consolid/)).toHaveCount(0)
    await expect(page.getByText(/1374/)).toHaveCount(0)
    await expect(page.getByText(/Se descart/)).toHaveCount(0)
    await expect(page.getByLabel('Gráfico avanzado de GGAL', { exact: true })).toBeVisible()
  })

  test('selects 3Y and 5Y history on the detail page without horizontal overflow', async ({ page }) => {
    const requests: HistoryRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)
    await mockQuoteApi(page)
    await mockHistoryApi(page, {
      requests,
      responsesByRange: {
        '1M': [{ date: '2026-04-07', close: 4000 }, { date: '2026-05-07', close: 4200 }],
        '3Y': [{ date: '2023-05-07', close: 2000 }, { date: '2026-05-07', close: 4200 }],
        '5Y': [{ date: '2021-05-07', close: 1000 }, { date: '2026-05-07', close: 4200 }],
      },
    })
    await page.goto('/stocks/GGAL?market=bCBA')
    const controls = page.locator('.stock-history-range-group')
    await expect(controls.getByRole('button')).toHaveText(['1W', '1M', '3M', '6M', '1Y', '3Y', '5Y'])
    for (const [range, variation] of [['3Y', '+110,00%'], ['5Y', '+320,00%']]) {
      const button = controls.getByRole('button', { name: range, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => requests.some((request) =>
        request.symbol === 'GGAL' && request.range === range && request.market === 'bCBA'
      )).toBe(true)
      await expect(page.getByText(variation, { exact: true }).first()).toBeVisible()
      await expect(page.getByLabel('Gráfico avanzado de GGAL', { exact: true })).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expectNoBrowserErrors(diagnostics)
  })

  test('loads stock history in the modal and changes range with the expected request', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-chrome',
      'Modal history controls are desktop/tablet-large behavior.'
    )

    const historyRequests: HistoryRequest[] = []
    const panelRequests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests: panelRequests })
    await mockHistoryApi(page, {
      requests: historyRequests,
      responsesByRange: {
        '1M': [
          { date: '2026-04-01', close: 3900 },
          { date: '2026-04-21', close: 3960 },
          { date: '2026-05-01', close: 4165 },
        ],
        '1W': [
          { date: '2026-04-30', close: 4100 },
          { date: '2026-05-05', close: 4140 },
          { date: '2026-05-07', close: 4165 },
        ],
      },
    })
    await page.goto('/')
    await expectPanelRequest(panelRequests)
    expectNoBrowserErrors(diagnostics)

    const opener = page.getByRole('button', {
      name: 'Abrir detalle de GGAL, Grupo Financiero Galicia',
    })

    await opener.click()

    const dialog = page.getByRole('dialog', { name: 'GGAL' })

    await expect(dialog).toBeVisible()
    await expect
      .poll(() => historyRequests.map((request) => request.range))
      .toContain('1M')
    await expect(dialog.getByText('Último mes')).toBeVisible()
    await expect(dialog.getByText(/\+\s*6,79%/)).toBeVisible()
    await expect(
      dialog.getByRole('img', { name: 'Evolución del precio de cierre de GGAL' })
    ).toBeVisible()
    await expect(dialog.getByText('$ 3.900')).toBeVisible()
    await expect(dialog.getByText('$ 4.165')).toBeVisible()

    await dialog.getByRole('button', { name: '1W' }).click()

    await expect
      .poll(() =>
        historyRequests.some(
          (request) =>
            request.symbol === 'GGAL' &&
            request.range === '1W' &&
            request.market === 'bCBA'
        )
      )
      .toBe(true)
    await expect(dialog.getByText('Última semana')).toBeVisible()
    await expect(dialog.getByText(/\+\s*1,59%/)).toBeVisible()
    await expect(dialog.getByText('$ 4.100')).toBeVisible()
    await expect(dialog.getByText('$ 4.165')).toBeVisible()

    await dialog.getByRole('button', { name: 'Cerrar detalle' }).click()

    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('renders an error state when stock history fails', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-chrome',
      'Modal error state coverage is desktop/tablet-large behavior.'
    )

    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })
    await mockHistoryApi(page, {
      errorRanges: ['1M'],
    })
    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics)

    await page
      .getByRole('button', {
        name: 'Abrir detalle de GGAL, Grupo Financiero Galicia',
      })
      .click()

    const dialog = page.getByRole('dialog', { name: 'GGAL' })

    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('alert').getByText('No se pudo cargar el histórico.')
    ).toBeVisible()
  })

  test('renders an empty state when stock history has no points', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-chrome',
      'Modal empty state coverage is desktop/tablet-large behavior.'
    )

    const requests: PanelRequest[] = []
    const diagnostics = attachBrowserDiagnostics(page)

    await mockPanelApi(page, { requests })
    await mockHistoryApi(page, {
      responsesByRange: {
        '1M': [],
      },
    })
    await page.goto('/')
    await expectPanelRequest(requests)
    expectNoBrowserErrors(diagnostics)

    await page
      .getByRole('button', {
        name: 'Abrir detalle de GGAL, Grupo Financiero Galicia',
      })
      .click()

    const dialog = page.getByRole('dialog', { name: 'GGAL' })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Sin histórico disponible')).toBeVisible()
    await expect(
      dialog.getByText('No hay datos históricos para este rango.')
    ).toBeVisible()
  })
})
