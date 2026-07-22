import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readme = readFileSync(path.join(process.cwd(), 'README.md'), 'utf8')
const runbook = readFileSync(
  path.join(process.cwd(), 'docs', 'RUNBOOK.md'),
  'utf8'
)
const envExample = readFileSync(
  path.join(process.cwd(), '.env.local.example'),
  'utf8'
)

describe('README', () => {
  it('presents the author, project, repository, and verified demo', () => {
    expect(readme).toContain('Emanuel Tivano')
    expect(readme).toContain('Dashboard full-stack')
    expect(readme).toContain(
      'https://github.com/emanuel-tivano/argentina-market-tracker'
    )
    expect(readme).toContain('https://argentina-market-tracker.vercel.app')
    expect(readme).not.toContain('github.com/emanueltivano/')
  })

  it('keeps setup, environment, scripts, testing, and architecture discoverable', () => {
    for (const heading of [
      '## Arquitectura resumida',
      '## Ejecución local',
      '## Variables de entorno',
      '## Scripts',
      '## Testing y validación',
      '## Estructura principal',
      '## Limitaciones conocidas',
      '## Autor y contacto',
    ]) {
      expect(readme).toContain(heading)
    }

    expect(readme).toContain('npm install')
    expect(readme).toContain('npm run validate')
    expect(readme).toContain('MARKET_DATA_SOURCE')
  })

  it('documents optional contact configuration without invented personal data', () => {
    expect(readme).toContain('[Agregar LinkedIn]')
    expect(readme).toContain('[Agregar correo profesional]')
    expect(readme).toContain('src/lib/authorContact.ts')
    expect(readme).toContain('no se renderizan en la interfaz')
    expect(readme).not.toMatch(/example@example\.com/i)
    expect(readme).not.toMatch(/mailto:/i)
    expect(readme).not.toMatch(/linkedin\.com\/in\//i)
  })

  it('documents verified technical decisions without fixed test-count claims', () => {
    expect(readme).toContain('BFF interno')
    expect(readme).toContain('Caché fresh/stale')
    expect(readme).toContain('Rate limiting configurable')
    expect(readme).toContain('npm run test:coverage')
    expect(readme).toContain('statements `80`')
    expect(readme).toContain('branches `70`')
  })

  it('documents bounded panel stale fallback without contradictory fail-closed claims', () => {
    expect(runbook).toContain('bounded two-minute maximum')
    expect(runbook).toContain('cacheStatus: stale')
    expect(runbook).not.toContain(
      'panel requests fail closed with controlled `502` responses'
    )
  })

  it('documents every accumulated cache and Redis timeout variable with safe examples', () => {
    for (const [name, defaultValue] of [
      ['PANEL_CACHE_FRESH_TTL_MS', '30000'],
      ['PANEL_CACHE_STALE_TTL_MS', '120000'],
      ['STOCK_QUOTE_FRESH_TTL_MS', '15000'],
      ['STOCK_QUOTE_STALE_TTL_MS', '120000'],
      ['STOCK_QUOTE_NOT_FOUND_TTL_MS', '30000'],
      ['RATE_LIMIT_REDIS_TIMEOUT_MS', '3000'],
    ]) {
      expect(envExample).toContain(`${name}="${defaultValue}"`)
      expect(runbook).toContain(`\`${name}\``)
    }

    expect(runbook).toContain('maximum total snapshot age from `fetchedAt`')
    expect(runbook).toContain('fall back to the documented default')
  })

  it('documents controlled fixture and Playwright variables that exist in the example', () => {
    for (const name of [
      'PANEL_RESPONSE_FIXTURE_JSON',
      'DISABLE_SERVER_DASHBOARD_PREFETCH',
      'PLAYWRIGHT_TEST_BASE_URL',
      'PLAYWRIGHT_E2E_MODE',
    ]) {
      expect(envExample).toContain(`${name}=`)
      expect(runbook).toContain(`\`${name}\``)
    }
  })

  it('documents quote namespaces, process-local limits, and fail-closed behavior', () => {
    for (const namespace of [
      'quote-public',
      'favorites-public',
      'quote-upstream',
    ]) {
      expect(readme).toContain(`\`${namespace}\``)
      expect(runbook).toContain(`\`${namespace}\``)
    }

    expect(readme).toContain('process-local')
    expect(readme).toContain('falla cerrado')
    expect(runbook).toContain('cache hits do not consume it')
    expect(runbook).toContain('failedItems')
  })

  it('records the temporary PostCSS override and a concrete removal criterion', () => {
    expect(runbook).toContain('Next.js `16.2.6`')
    expect(runbook).toContain('postcss@8.4.31')
    expect(runbook).toContain('resolves `8.5.19`')
    expect(runbook).toContain('compatibility is not guaranteed by Next')
    expect(runbook).toContain('npm explain postcss')
  })

  it('references existing screenshots with reproducible dimensions', () => {
    const expectedDimensions = new Map([
      ['./docs/screenshots/desktop.png', [1440, 650]],
      ['./docs/screenshots/mobile.png', [390, 844]],
      ['./docs/screenshots/modal-history.png', [1440, 1000]],
    ])

    for (const [relativePath, [expectedWidth, expectedHeight]] of expectedDimensions) {
      expect(readme).toContain(relativePath)

      const absolutePath = path.join(process.cwd(), relativePath)
      const png = readFileSync(absolutePath)

      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(expectedWidth)
      expect(png.readUInt32BE(20)).toBe(expectedHeight)
    }
  })
})
