import { expect, test } from '@playwright/test'

for (const method of ['GET', 'POST']) {
  test(`production token ${method} stays protected through the Next router`, async ({ request }) => {
    const requestId = `token-e2e-${method.toLowerCase()}`
    const response = await request.fetch('/api/token', {
      method,
      headers: {
        'x-request-id': requestId,
        'x-local-debug-token': 'untrusted-debug-token',
      },
    })

    expect(response.status()).toBe(404)
    expect(response.headers()['x-request-id']).toBe(requestId)
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(await response.json()).toEqual({ ok: false, error: 'NOT_FOUND', requestId })
  })
}
