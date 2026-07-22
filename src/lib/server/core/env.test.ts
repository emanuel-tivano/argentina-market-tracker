import { afterEach, describe, expect, it, vi } from 'vitest'

const OLD_ENV = process.env

describe('server env', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    process.env = OLD_ENV
  })

  it('does not validate required env vars at module import time', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
    }
    vi.doMock('server-only', () => ({}))

    await expect(import('./env')).resolves.toHaveProperty('ENV')
  })

  it('validates API_URL lazily when it is read', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
    }
    vi.doMock('server-only', () => ({}))
    const { ENV } = await import('./env')

    expect(() => ENV.API_URL).toThrow('Missing API_URL')
  })

  it('normalizes secure API and Redis URLs through ENV getters', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'production',
      API_URL: 'https://api.example.com/v2/',
      RATE_LIMIT_REDIS_REST_URL: 'https://redis.example.com/',
    }
    vi.doMock('server-only', () => ({}))
    const { ENV } = await import('./env')

    expect(ENV.API_URL).toBe('https://api.example.com/v2')
    expect(ENV.RATE_LIMIT_REDIS_REST_URL).toBe('https://redis.example.com')
  })

  it('rejects insecure sensitive URLs through ENV getters', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'production',
      API_URL: 'http://api.example.com',
      RATE_LIMIT_REDIS_REST_URL: 'http://redis.example.com',
    }
    vi.doMock('server-only', () => ({}))
    const { ENV } = await import('./env')

    expect(() => ENV.API_URL).toThrow(/API_URL.*https/)
    expect(() => ENV.RATE_LIMIT_REDIS_REST_URL).toThrow(
      /RATE_LIMIT_REDIS_REST_URL.*https/
    )
  })

  it('normalizes safe relative upstream endpoint paths', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      TOKEN_ENDPOINT: '/api/token/',
      PANEL_LIDER_ENDPOINT: '/api/v2/panel/lider/',
      PANEL_GENERAL_ENDPOINT: 'api/v2/panel%20general',
      PANEL_CEDEARS_ENDPOINT: 'api/v2/panel/cedears',
    }
    vi.doMock('server-only', () => ({}))
    const { ENV } = await import('./env')

    expect(ENV.TOKEN_ENDPOINT).toBe('api/token')
    expect(ENV.PANEL_LIDER_ENDPOINT).toBe('api/v2/panel/lider')
    expect(ENV.PANEL_GENERAL_ENDPOINT).toBe('api/v2/panel%20general')
    expect(ENV.PANEL_CEDEARS_ENDPOINT).toBe('api/v2/panel/cedears')
  })

  it.each([
    ['TOKEN_ENDPOINT', 'https://attacker.example/token'],
    ['PANEL_LIDER_ENDPOINT', '../lider'],
    ['PANEL_GENERAL_ENDPOINT', 'panel?redirect=secret'],
    ['PANEL_CEDEARS_ENDPOINT', 'panel\\cedears'],
  ])('rejects invalid %s through ENV', async (name, value) => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      [name]: value,
    }
    vi.doMock('server-only', () => ({}))
    const { ENV } = await import('./env')

    expect(() => ENV[name as keyof typeof ENV]).toThrow(name)
  })

  it('uses a safe default favorites quote concurrency when env is missing', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
    }
    vi.doMock('server-only', () => ({}))
    const { ENV } = await import('./env')

    expect(ENV.FAVORITES_QUOTE_CONCURRENCY).toBe(4)
  })

  it('defaults market data source to demo when env is missing', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
    }
    vi.doMock('server-only', () => ({}))
    const { ENV, getRuntimeEnvSummary } = await import('./env')

    expect(ENV.MARKET_DATA_SOURCE).toBe('demo')
    expect(getRuntimeEnvSummary().marketDataSource).toBe('demo')
  })

  it('keeps live mode available when explicitly configured', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      MARKET_DATA_SOURCE: 'live',
    }
    vi.doMock('server-only', () => ({}))
    const { ENV, getRuntimeEnvSummary } = await import('./env')

    expect(ENV.MARKET_DATA_SOURCE).toBe('live')
    expect(getRuntimeEnvSummary().missingLiveConfig).toContain('API_URL')
  })

  it.each(['1', '4', '10'])(
    'accepts strict favorites quote concurrency %s',
    async (value) => {
      vi.resetModules()
      process.env = {
        NODE_ENV: 'test',
        FAVORITES_QUOTE_CONCURRENCY: value,
      }
      vi.doMock('server-only', () => ({}))
      const { ENV } = await import('./env')

      expect(ENV.FAVORITES_QUOTE_CONCURRENCY).toBe(Number(value))
    }
  )

  it.each([
    '0',
    '11',
    '-1',
    '4workers',
    '4.5',
    ' 4 extra',
    '0x4',
    '1e1',
    'NaN',
    'Infinity',
    '',
  ])('uses the default for invalid favorites concurrency %j', async (value) => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      FAVORITES_QUOTE_CONCURRENCY: value,
    }
    vi.doMock('server-only', () => ({}))
    const { ENV } = await import('./env')

    expect(ENV.FAVORITES_QUOTE_CONCURRENCY).toBe(4)
  })

  it('validates Redis timeout and negative quote cache TTL bounds', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      RATE_LIMIT_REDIS_TIMEOUT_MS: '4500',
      STOCK_QUOTE_NOT_FOUND_TTL_MS: '60000',
    }
    vi.doMock('server-only', () => ({}))
    let { ENV } = await import('./env')

    expect(ENV.RATE_LIMIT_REDIS_TIMEOUT_MS).toBe(4500)
    expect(ENV.STOCK_QUOTE_NOT_FOUND_TTL_MS).toBe(60000)

    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      RATE_LIMIT_REDIS_TIMEOUT_MS: '100',
      STOCK_QUOTE_NOT_FOUND_TTL_MS: '999999',
    }
    vi.doMock('server-only', () => ({}))
    ;({ ENV } = await import('./env'))

    expect(ENV.RATE_LIMIT_REDIS_TIMEOUT_MS).toBe(3000)
    expect(ENV.STOCK_QUOTE_NOT_FOUND_TTL_MS).toBe(30000)
  })

  it('strictly rejects partial integers for the new operational variables', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      RATE_LIMIT_REDIS_TIMEOUT_MS: '2500ms',
      STOCK_QUOTE_NOT_FOUND_TTL_MS: '60000.5',
    }
    vi.doMock('server-only', () => ({}))
    const { ENV } = await import('./env')

    expect(ENV.RATE_LIMIT_REDIS_TIMEOUT_MS).toBe(3000)
    expect(ENV.STOCK_QUOTE_NOT_FOUND_TTL_MS).toBe(30000)
  })

  it('validates bounded fresh and stale cache windows as coherent pairs', async () => {
    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      PANEL_CACHE_FRESH_TTL_MS: '20000',
      PANEL_CACHE_STALE_TTL_MS: '90000',
      STOCK_QUOTE_FRESH_TTL_MS: '10000',
      STOCK_QUOTE_STALE_TTL_MS: '60000',
    }
    vi.doMock('server-only', () => ({}))
    let { ENV } = await import('./env')

    expect(ENV.PANEL_CACHE_FRESH_TTL_MS).toBe(20000)
    expect(ENV.PANEL_CACHE_STALE_TTL_MS).toBe(90000)
    expect(ENV.STOCK_QUOTE_FRESH_TTL_MS).toBe(10000)
    expect(ENV.STOCK_QUOTE_STALE_TTL_MS).toBe(60000)

    vi.resetModules()
    process.env = {
      NODE_ENV: 'test',
      PANEL_CACHE_FRESH_TTL_MS: '90000',
      PANEL_CACHE_STALE_TTL_MS: '30000',
      STOCK_QUOTE_FRESH_TTL_MS: '-1',
      STOCK_QUOTE_STALE_TTL_MS: '1000',
    }
    vi.doMock('server-only', () => ({}))
    ;({ ENV } = await import('./env'))

    expect(ENV.PANEL_CACHE_FRESH_TTL_MS).toBe(30000)
    expect(ENV.PANEL_CACHE_STALE_TTL_MS).toBe(120000)
    expect(ENV.STOCK_QUOTE_FRESH_TTL_MS).toBe(15000)
    expect(ENV.STOCK_QUOTE_STALE_TTL_MS).toBe(120000)
  })
})
