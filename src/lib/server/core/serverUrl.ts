import 'server-only'

export type ServerUrlHttpPolicy = 'public-origin' | 'sensitive'

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:/i

function invalidUpstreamPath(variableName: string): never {
  throw new Error(`${variableName} must be a safe relative upstream path`)
}

function validateDecodedPathSegment(
  variableName: string,
  segment: string
): void {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    CONTROL_CHARACTER_PATTERN.test(segment) ||
    /[\\/?#@:]/.test(segment)
  ) {
    invalidUpstreamPath(variableName)
  }
}

function validateEncodedPathSegment(
  variableName: string,
  segment: string
): void {
  let decoded = segment

  for (let depth = 0; depth < 10; depth += 1) {
    validateDecodedPathSegment(variableName, decoded)

    let next: string

    try {
      next = decodeURIComponent(decoded)
    } catch {
      invalidUpstreamPath(variableName)
    }

    if (next === decoded) {
      return
    }

    decoded = next
  }

  invalidUpstreamPath(variableName)
}

export function normalizeUpstreamRelativePath(
  variableName: string,
  value: string
): string {
  if (
    !value ||
    value.trim() !== value ||
    /\s/.test(value) ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    ABSOLUTE_URL_PATTERN.test(value) ||
    value.startsWith('//')
  ) {
    invalidUpstreamPath(variableName)
  }

  const normalized = value.replace(/^\/+|\/+$/g, '')
  const segments = normalized.split('/')

  if (!normalized || segments.some((segment) => !segment)) {
    invalidUpstreamPath(variableName)
  }

  for (const segment of segments) {
    validateEncodedPathSegment(variableName, segment)
  }

  return segments.join('/')
}

export function buildUpstreamUrl(
  apiBaseUrl: string,
  variableName: string,
  relativePath: string
): string {
  const baseUrl = new URL(apiBaseUrl)
  const normalizedPath = normalizeUpstreamRelativePath(
    variableName,
    relativePath
  )
  const basePathname = baseUrl.pathname.replace(/\/+$/, '')
  const expectedPathname = `${basePathname}/${normalizedPath}`
  const resolved = new URL(expectedPathname, baseUrl.origin)

  if (
    resolved.origin !== baseUrl.origin ||
    resolved.pathname !== expectedPathname
  ) {
    invalidUpstreamPath(variableName)
  }

  return resolved.toString()
}

export function buildUpstreamRequestUrl(
  apiBaseUrl: string,
  variableName: string,
  relativeUrl: string
): string {
  const queryIndex = relativeUrl.indexOf('?')

  if (queryIndex === -1) {
    return buildUpstreamUrl(apiBaseUrl, variableName, relativeUrl)
  }

  const relativePath = relativeUrl.slice(0, queryIndex)
  const query = relativeUrl.slice(queryIndex + 1)

  if (
    !query ||
    query.includes('?') ||
    query.includes('#') ||
    query.includes('\\') ||
    /\s/.test(query) ||
    CONTROL_CHARACTER_PATTERN.test(query)
  ) {
    invalidUpstreamPath(variableName)
  }

  const params = new URLSearchParams(query)
  const normalizedQuery = params.toString()

  if (
    normalizedQuery !== query ||
    [...params.keys()].some((key) => !key)
  ) {
    invalidUpstreamPath(variableName)
  }

  const resolved = new URL(
    buildUpstreamUrl(apiBaseUrl, variableName, relativePath)
  )
  resolved.search = normalizedQuery

  return resolved.toString()
}

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

export function normalizeServerUrl(
  value: string,
  options: {
    allowPathname: boolean
    httpPolicy: ServerUrlHttpPolicy
    nodeEnv: string
    originDescription?: string
    variableName: string
  }
): string {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`${options.variableName} must be a valid absolute URL`)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${options.variableName} must use http or https`)
  }

  if (url.username || url.password) {
    throw new Error(`${options.variableName} must not include credentials`)
  }

  if (url.search) {
    throw new Error(`${options.variableName} must not include a query string`)
  }

  if (url.hash) {
    throw new Error(`${options.variableName} must not include a fragment`)
  }

  if (!options.allowPathname && url.pathname !== '/') {
    throw new Error(
      `${options.variableName} must contain only ${options.originDescription ?? 'an origin'}`
    )
  }

  if (url.protocol === 'http:') {
    const loopback = isLoopbackHostname(url.hostname)
    const isProduction = options.nodeEnv === 'production'
    const allowed =
      options.httpPolicy === 'public-origin'
        ? !isProduction || loopback
        : !isProduction && loopback

    if (!allowed) {
      throw new Error(
        isProduction
          ? `${options.variableName} must use https in production`
          : `${options.variableName} may use http only for loopback in development or tests`
      )
    }
  }

  if (!options.allowPathname || url.pathname === '/') {
    return url.origin
  }

  const normalizedPathname = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${normalizedPathname}`
}
