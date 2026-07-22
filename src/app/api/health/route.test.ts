import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const OLD_ENV = { ...process.env }

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init)
}

async function loadRoute(env: Record<string, string | undefined>) {
  vi.resetModules()
  process.env = {
    ...OLD_ENV,
    ...env,
  }
  vi.doMock('server-only', () => ({}))

  return import('./route')
}

describe('/api/health route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    process.env = OLD_ENV
  })

  it('responds in demo mode without live credentials', async () => {
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'demo',
      NODE_ENV: 'test',
      API_URL: undefined,
      API_USERNAME: undefined,
      API_PASSWORD: undefined,
      PANEL_LIDER_ENDPOINT: undefined,
      PANEL_GENERAL_ENDPOINT: undefined,
      PANEL_CEDEARS_ENDPOINT: undefined,
    })

    const response = await GET(request('/api/health'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      status: 'ok',
      dataSource: 'demo',
      checks: {
        config: {
          missingLiveConfig: [],
          status: 'ok',
        },
        metrics: {
          processLocal: true,
        },
      },
    })
    expect(JSON.stringify(body)).not.toContain('API_PASSWORD')
    expect(response.headers.get('X-Request-Id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
  })

  it('reports degraded status when live configuration is incomplete', async () => {
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'live',
      NODE_ENV: 'production',
      API_URL: 'https://api.example.test',
      API_USERNAME: undefined,
      API_PASSWORD: undefined,
      PANEL_LIDER_ENDPOINT: 'lider-endpoint',
      PANEL_GENERAL_ENDPOINT: undefined,
      PANEL_CEDEARS_ENDPOINT: 'cedears-endpoint',
    })

    const response = await GET(request('/api/health'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.config).toEqual({
      missingLiveConfig: ['API_USERNAME', 'API_PASSWORD', 'PANEL_GENERAL_ENDPOINT'],
      status: 'degraded',
    })
    expect(JSON.stringify(body)).not.toContain('password')
  })

  it('reports an insecure live API URL as invalid without exposing it', async () => {
    const insecureUrl = 'http://user:private-password@api.example.test'
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'live',
      NODE_ENV: 'production',
      API_URL: insecureUrl,
      API_USERNAME: 'user',
      API_PASSWORD: 'password',
      PANEL_LIDER_ENDPOINT: 'lider-endpoint',
      PANEL_GENERAL_ENDPOINT: 'general-endpoint',
      PANEL_CEDEARS_ENDPOINT: 'cedears-endpoint',
      RATE_LIMIT_STORE: 'memory',
      RATE_LIMIT_TRUSTED_PROXY: 'vercel',
      VERCEL: '1',
    })

    const response = await GET(request('/api/health'))
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.config).toEqual({
      invalidLiveConfig: ['API_URL'],
      missingLiveConfig: [],
      status: 'degraded',
    })
    expect(serialized).not.toContain(insecureUrl)
    expect(serialized).not.toContain('private-password')
  })

  it.each([
    ['TOKEN_ENDPOINT', 'https://attacker.example/private-token'],
    ['PANEL_LIDER_ENDPOINT', '../private-lider'],
    ['PANEL_GENERAL_ENDPOINT', 'panel?token=private-query'],
    ['PANEL_CEDEARS_ENDPOINT', 'panel\\private-cedears'],
  ])('reports invalid live endpoint %s without exposing its value', async (name, value) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'live',
      NODE_ENV: 'production',
      API_URL: 'https://api.example.test/base',
      TOKEN_ENDPOINT: 'token',
      API_USERNAME: 'user',
      API_PASSWORD: 'password',
      PANEL_LIDER_ENDPOINT: 'lider-endpoint',
      PANEL_GENERAL_ENDPOINT: 'general-endpoint',
      PANEL_CEDEARS_ENDPOINT: 'cedears-endpoint',
      [name]: value,
      RATE_LIMIT_STORE: 'memory',
      RATE_LIMIT_TRUSTED_PROXY: 'vercel',
      VERCEL: '1',
    })

    const response = await GET(request('/api/health'))
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.config.invalidLiveConfig).toEqual([name])
    expect(serialized).not.toContain(value)
    expect(serialized).not.toContain('private')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports multiple invalid endpoints once and accepts valid nested paths', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'live',
      NODE_ENV: 'production',
      API_URL: 'https://api.example.test/base',
      TOKEN_ENDPOINT: '//attacker.example/token',
      API_USERNAME: 'user',
      API_PASSWORD: 'password',
      PANEL_LIDER_ENDPOINT: 'api/v2/panel/lider',
      PANEL_GENERAL_ENDPOINT: '%2e%2e/general',
      PANEL_CEDEARS_ENDPOINT: 'api/v2/panel/cedears',
      RATE_LIMIT_STORE: 'memory',
      RATE_LIMIT_TRUSTED_PROXY: 'vercel',
      VERCEL: '1',
    })

    const response = await GET(request('/api/health'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.checks.config).toEqual({
      invalidLiveConfig: ['TOKEN_ENDPOINT', 'PANEL_GENERAL_ENDPOINT'],
      missingLiveConfig: [],
      status: 'degraded',
    })
    expect(new Set(body.checks.config.invalidLiveConfig).size).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports an insecure required Redis URL as degraded', async () => {
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'demo',
      NODE_ENV: 'production',
      RATE_LIMIT_STORE: 'redis-rest',
      RATE_LIMIT_REDIS_REST_URL: 'http://redis.example.test',
      RATE_LIMIT_REDIS_REST_TOKEN: 'redis-secret-token',
    })

    const response = await GET(request('/api/health'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.rateLimit).toMatchObject({
      status: 'degraded',
      details: 'RATE_LIMIT_STORE_CONFIG_INVALID',
      storeMode: 'unavailable',
    })
  })

  it('reports degraded status when redis-rest rate limiting is misconfigured', async () => {
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'demo',
      NODE_ENV: 'production',
      RATE_LIMIT_STORE: 'redis-rest',
      RATE_LIMIT_REDIS_REST_URL: undefined,
      RATE_LIMIT_REDIS_REST_TOKEN: undefined,
    })

    const response = await GET(request('/api/health'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.rateLimit).toEqual({
      status: 'degraded',
      configuredStore: 'redis-rest',
      storeMode: 'unavailable',
      trustedProxy: 'none',
      reasons: ['distributed-store-unavailable'],
      details: 'RATE_LIMIT_STORE_CONFIG_INVALID',
    })
  })

  it('reports degraded status when live mode falls back to memory and shared identity', async () => {
    const { GET } = await loadRoute({
      MARKET_DATA_SOURCE: 'live',
      NODE_ENV: 'production',
      API_URL: 'https://api.example.test',
      API_USERNAME: 'user',
      API_PASSWORD: 'password',
      PANEL_LIDER_ENDPOINT: 'lider-endpoint',
      PANEL_GENERAL_ENDPOINT: 'general-endpoint',
      PANEL_CEDEARS_ENDPOINT: 'cedears-endpoint',
      RATE_LIMIT_STORE: 'memory',
      RATE_LIMIT_TRUSTED_PROXY: 'none',
    })

    const response = await GET(request('/api/health'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.rateLimit).toEqual({
      status: 'degraded',
      configuredStore: 'memory',
      storeMode: 'memory',
      trustedProxy: 'none',
      reasons: ['memory-store-fallback', 'shared-global-client-fallback'],
    })
  })
})
