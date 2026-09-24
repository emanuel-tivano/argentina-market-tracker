import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  buildUpstreamRequestUrl,
  buildUpstreamUrl,
  normalizeServerUrl,
  normalizeUpstreamRelativePath,
} from './serverUrl'

type SensitiveUrlCase = {
  allowPathname: boolean
  expected?: string
  nodeEnv: string
  value: string
  variableName: 'API_URL' | 'RATE_LIMIT_REDIS_REST_URL'
}

function normalizeSensitiveUrl(testCase: SensitiveUrlCase) {
  return normalizeServerUrl(testCase.value, {
    allowPathname: testCase.allowPathname,
    httpPolicy: 'sensitive',
    nodeEnv: testCase.nodeEnv,
    variableName: testCase.variableName,
  })
}

describe('sensitive server URL validation', () => {
  it.each<SensitiveUrlCase>([
    {
      variableName: 'API_URL',
      value: 'https://api.example.com',
      nodeEnv: 'production',
      allowPathname: true,
      expected: 'https://api.example.com',
    },
    {
      variableName: 'API_URL',
      value: 'https://api.example.com/v2/',
      nodeEnv: 'production',
      allowPathname: true,
      expected: 'https://api.example.com/v2',
    },
    {
      variableName: 'RATE_LIMIT_REDIS_REST_URL',
      value: 'https://redis.example.com',
      nodeEnv: 'production',
      allowPathname: false,
      expected: 'https://redis.example.com',
    },
    ...(['development', 'test'] as const).flatMap((nodeEnv) => [
      {
        variableName: 'API_URL' as const,
        value: 'http://localhost:3000',
        nodeEnv,
        allowPathname: true,
        expected: 'http://localhost:3000',
      },
      {
        variableName: 'API_URL' as const,
        value: 'http://127.0.0.1:3000',
        nodeEnv,
        allowPathname: true,
        expected: 'http://127.0.0.1:3000',
      },
      {
        variableName: 'RATE_LIMIT_REDIS_REST_URL' as const,
        value: 'http://[::1]:3000',
        nodeEnv,
        allowPathname: false,
        expected: 'http://[::1]:3000',
      },
    ]),
  ])('accepts $variableName=$value in $nodeEnv', (testCase) => {
    expect(normalizeSensitiveUrl(testCase)).toBe(testCase.expected)
  })

  it.each<SensitiveUrlCase>([
    {
      variableName: 'API_URL',
      value: 'http://api.example.com',
      nodeEnv: 'production',
      allowPathname: true,
    },
    {
      variableName: 'API_URL',
      value: 'http://api.example.com',
      nodeEnv: 'test',
      allowPathname: true,
    },
    {
      variableName: 'API_URL',
      value: 'http://localhost:3000',
      nodeEnv: 'production',
      allowPathname: true,
    },
    {
      variableName: 'RATE_LIMIT_REDIS_REST_URL',
      value: 'http://redis.example.com',
      nodeEnv: 'production',
      allowPathname: false,
    },
    ...(['API_URL', 'RATE_LIMIT_REDIS_REST_URL'] as const).flatMap(
      (variableName) =>
        [
          'ftp://example.com',
          '/relative',
          'https://user@example.com',
          'https://user:secret@example.com',
          'https://example.com/#fragment',
          'https://example.com/?token=secret',
          '',
          'not a url',
        ].map((value) => ({
          variableName,
          value,
          nodeEnv: 'production',
          allowPathname: variableName === 'API_URL',
        })),
    ),
    {
      variableName: 'RATE_LIMIT_REDIS_REST_URL',
      value: 'https://redis.example.com/rest',
      nodeEnv: 'production',
      allowPathname: false,
    },
  ])('rejects $variableName=$value in $nodeEnv', (testCase) => {
    let error: unknown

    try {
      normalizeSensitiveUrl(testCase)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(testCase.variableName)
    expect((error as Error).message).not.toContain('secret')
  })
})

describe('upstream relative paths', () => {
  it.each([
    ['token', 'token'],
    ['/token', 'token'],
    ['api/token', 'api/token'],
    ['/api/v2/panel/lider/', 'api/v2/panel/lider'],
    ['cotizaciones/paneles/lideres', 'cotizaciones/paneles/lideres'],
    ['api/v2/panel%20general', 'api/v2/panel%20general'],
  ])('normalizes valid path %s', (value, expected) => {
    expect(normalizeUpstreamRelativePath('TOKEN_ENDPOINT', value)).toBe(
      expected
    )
  })

  it.each([
    'https://attacker.example/token',
    'http://attacker.example/token',
    'ftp://attacker.example/token',
    '//attacker.example/token',
    '\\attacker.example\\token',
    'path\\segment',
    '../token',
    'api/../token',
    './token',
    'api/./token',
    '%2e%2e/token',
    '%2E%2E/token',
    '%252e%252e/token',
    '%2f%2fattacker.example',
    '%5c%5cattacker.example',
    'token?redirect=https://attacker.example',
    'token#fragment',
    'user:password@host/path',
    '',
    '   ',
    'api token',
    'token\u0000next',
    'token\u000anext',
    'api//token',
  ])('rejects unsafe path %j without echoing it', (value) => {
    expect(() =>
      normalizeUpstreamRelativePath('TOKEN_ENDPOINT', value)
    ).toThrow('TOKEN_ENDPOINT')

    try {
      normalizeUpstreamRelativePath('TOKEN_ENDPOINT', value)
    } catch (error: unknown) {
      if (value) {
        expect(String(error)).not.toContain(value)
      }
    }
  })

  it('preserves the API origin and base pathname', () => {
    const url = buildUpstreamUrl(
      'https://api.example.com/base/v2',
      'PANEL_LIDER_ENDPOINT',
      '/panel/lider/'
    )

    expect(url).toBe('https://api.example.com/base/v2/panel/lider')
    expect(new URL(url).origin).toBe('https://api.example.com')
    expect(new URL(url).pathname.startsWith('/base/v2/')).toBe(true)
  })

  it('allows a canonical query on an internal upstream request URL', () => {
    const url = buildUpstreamRequestUrl(
      'https://api.example.com/base/v2',
      'UPSTREAM_ENDPOINT',
      '/api/v2/bCBA/Titulos/GGAL/Cotizacion?mercado=bcba&simbolo=GGAL&model.simbolo=GGAL&model.mercado=bCBA&model.plazo=t1'
    )

    expect(url).toBe(
      'https://api.example.com/base/v2/api/v2/bCBA/Titulos/GGAL/Cotizacion?mercado=bcba&simbolo=GGAL&model.simbolo=GGAL&model.mercado=bCBA&model.plazo=t1'
    )
    expect(new URL(url).origin).toBe('https://api.example.com')
  })

  it.each([
    '/quote?',
    '/quote?model.plazo=t1#fragment',
    '/quote?model.plazo=t1\\extra',
    '/quote?model.plazo=t1 extra',
    '/quote?model.plazo=t1?next=value',
    '/quote?=value',
    '/quote?symbol=%2f',
  ])('rejects a non-canonical or unsafe request query %j', (value) => {
    expect(() =>
      buildUpstreamRequestUrl(
        'https://api.example.com/base/v2',
        'UPSTREAM_ENDPOINT',
        value
      )
    ).toThrow('UPSTREAM_ENDPOINT')
  })
})
