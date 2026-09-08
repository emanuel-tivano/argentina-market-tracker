import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const OLD_ENV = process.env
const DEBUG_TOKEN = 'test-local-debug-token'

function request(path: string, token?: string, host = 'localhost') {
  return new NextRequest(`http://${host}${path}`, {
    headers: token ? { 'x-local-debug-token': token } : undefined,
  })
}

async function loadRoute(
  envOverrides: Record<string, string | undefined> = {},
  refreshTokenForDebug = vi.fn(async () => ({ expiresIn: 1800 }))
) {
  vi.resetModules()
  process.env = {
    ...OLD_ENV,
    API_URL: 'https://api.example.test',
    API_USERNAME: 'user',
    API_PASSWORD: 'password',
    ENABLE_TOKEN_DEBUG: '1',
    LOCAL_DEBUG_TOKEN: DEBUG_TOKEN,
    NODE_ENV: 'development',
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server/upstream/tokenCache', () => ({
    getCachedToken: vi.fn(() => null),
  }))
  vi.doMock('@/lib/server/upstream/iol', () => ({
    IolTokenFormatError: class IolTokenFormatError extends Error {},
    IolTokenUpstreamError: class IolTokenUpstreamError extends Error {
      status = 502
    },
    refreshTokenForDebug,
  }))

  return import('./route')
}

describe('/api/token debug route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    process.env = OLD_ENV
  })

  it('allows an explicitly authorized development request', async () => {
    const { POST } = await loadRoute()

    const response = await POST(request('/api/token', DEBUG_TOKEN))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      cached: false,
      status: 'refreshed',
    })
    expect(response.headers.get('X-Request-Id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
  })

  it('does not depend on hostname when the explicit token is valid', async () => {
    const { POST } = await loadRoute()

    const response = await POST(
      request('/api/token', DEBUG_TOKEN, 'preview.example.test')
    )

    expect(response.status).toBe(200)
  })

  it('returns not found in production even when the debug flag is set', async () => {
    const { POST } = await loadRoute({ NODE_ENV: 'production' })

    const response = await POST(request('/api/token', DEBUG_TOKEN))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toMatchObject({
      ok: false,
      error: 'NOT_FOUND',
    })
    expect(body.requestId).toEqual(expect.any(String))
  })

  it.each([
    ['debug flag disabled', { ENABLE_TOKEN_DEBUG: '0' }, DEBUG_TOKEN],
    ['debug token not configured', { LOCAL_DEBUG_TOKEN: undefined }, DEBUG_TOKEN],
    ['request token missing', {}, undefined],
    ['request token incorrect', {}, 'incorrect-token'],
  ])('returns not found when %s', async (_case, env, providedToken) => {
    const { POST } = await loadRoute(env)

    const response = await POST(request('/api/token', providedToken))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toMatchObject({ ok: false, error: 'NOT_FOUND' })
  })

  it('rejects Host localhost without an explicit token', async () => {
    const { POST } = await loadRoute()

    const response = await POST(request('/api/token'))

    expect(response.status).toBe(404)
  })

  it('redacts the configured debug token from errors and logs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { POST } = await loadRoute({}, vi.fn(async () => {
      throw new Error(`debug failed for ${DEBUG_TOKEN}`)
    }))

    const response = await POST(request('/api/token', DEBUG_TOKEN))
    const output = JSON.stringify({
      body: await response.json(),
      logs: consoleError.mock.calls,
    })

    expect(response.status).toBe(500)
    expect(output).not.toContain(DEBUG_TOKEN)
    expect(output).toContain('[redacted]')
  })
})
