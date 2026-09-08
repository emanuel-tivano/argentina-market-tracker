import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

import { ENV } from './env'

type LocalDebugRequest = {
  headers: {
    get(name: string): string | null
  }
}

export const LOCAL_DEBUG_TOKEN_HEADER = 'x-local-debug-token'

export function isDebugEnabled() {
  return ENV.NODE_ENV !== 'production' && process.env.ENABLE_TOKEN_DEBUG === '1'
}

function safeTokenMatches(providedToken: string, configuredToken: string): boolean {
  const providedDigest = createHash('sha256').update(providedToken).digest()
  const configuredDigest = createHash('sha256').update(configuredToken).digest()

  return timingSafeEqual(providedDigest, configuredDigest)
}

export function canUseLocalDebug(req: LocalDebugRequest): boolean {
  if (!isDebugEnabled()) {
    return false
  }

  const configuredToken = ENV.LOCAL_DEBUG_TOKEN
  const providedToken = req.headers.get(LOCAL_DEBUG_TOKEN_HEADER)

  return (
    configuredToken.trim().length > 0 &&
    providedToken !== null &&
    safeTokenMatches(providedToken, configuredToken)
  )
}
