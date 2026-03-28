/**
 * Shared retry utilities for API requests
 */

import { Effect } from 'effect'
import { DELAYS, RETRY_CONFIG, USER_AGENT } from '@/import/constants'
import { tryAsync } from '@/import/utils/effect-helpers'

const RETRYABLE_SERVER_ERRORS = [500, 502, 503, 504] as const
const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

type RequestOptions = {
  url: string
  body: string
  baseDelayMs?: number
}

/**
 * Fetch with retry logic for network errors and retryable HTTP status codes
 * Retries on: network failures, 429 rate limits, 500/502/503/504 server errors
 *
 * @param options - Request options including optional baseDelayMs for testing
 */
export function fetchWithRetry(options: RequestOptions): Effect.Effect<unknown, Error> {
  const { baseDelayMs = RETRY_CONFIG.BASE_DELAY_MS } = options

  return Effect.gen(function* () {
    for (let attempt = 0; attempt < RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
      const response = yield* Effect.either(
        tryAsync(async () =>
          fetch(options.url, {
            method: 'POST',
            body: options.body,
            headers: {
              'Content-Type': 'text/plain',
              Accept: 'application/json',
              'User-Agent': USER_AGENT,
            },
          }),
        ),
      )

      if (response._tag === 'Left') {
        if (attempt < RETRY_CONFIG.MAX_ATTEMPTS - 1) {
          const delay = baseDelayMs * 2 ** attempt
          const delaySeconds = (delay / 1000).toFixed(1)
          console.warn(
            `[RateLimiter] Network error on attempt ${attempt + 1}/${RETRY_CONFIG.MAX_ATTEMPTS}, retrying in ${delaySeconds}s`,
          )
          console.warn(`[RateLimiter] Error:`, response.left)
          yield* Effect.sleep(`${delay} millis`)
          console.warn(`[RateLimiter] Retry wait complete, resuming`)
          continue
        }
        return yield* Effect.fail(response.left)
      }

      const res = response.right

      if (!res.ok) {
        const isRetryableStatus =
          res.status === 429 ||
          RETRYABLE_SERVER_ERRORS.includes(res.status as (typeof RETRYABLE_SERVER_ERRORS)[number])

        if (isRetryableStatus && attempt < RETRY_CONFIG.MAX_ATTEMPTS - 1) {
          const errorType = res.status === 429 ? 'RATE LIMITED' : 'server error'
          console.warn(
            `[RateLimiter] Overpass API ${errorType} (HTTP ${res.status}) on attempt ${attempt + 1}/${RETRY_CONFIG.MAX_ATTEMPTS}`,
          )

          // Apply penalty cooldown for rate limits if enabled
          if (res.status === 429 && RETRY_CONFIG.PENALTY_ENABLED) {
            const penaltySeconds = DELAYS.RATE_LIMIT_PENALTY_MS / 1000
            console.warn(
              `[RateLimiter] HTTP 429 detected, starting ${penaltySeconds}s penalty cooldown`,
            )
            yield* Effect.sleep(`${DELAYS.RATE_LIMIT_PENALTY_MS} millis`)
            console.warn(`[RateLimiter] Penalty cooldown complete, resuming`)
          }

          const delay = baseDelayMs * 2 ** attempt
          const delaySeconds = (delay / 1000).toFixed(1)
          console.warn(`[RateLimiter] Retrying in ${delaySeconds}s`)
          yield* Effect.sleep(`${delay} millis`)
          console.warn(`[RateLimiter] Retry wait complete, resuming`)
          continue
        }
        return yield* Effect.fail(new Error(`Overpass API error: ${res.status} ${res.statusText}`))
      }

      const data = yield* tryAsync(async () => await res.json())
      return data
    }

    return yield* Effect.fail(new Error('Max retries exceeded'))
  })
}

/**
 * Generic Overpass API fetcher - used by both import and legacy queries
 */
export function fetchOverpass<T = unknown>(
  query: string,
  baseDelayMs?: number,
): Effect.Effect<T, Error> {
  return Effect.map(
    fetchWithRetry({ url: OVERPASS_API_URL, body: query, baseDelayMs }),
    (data) => data as T,
  )
}
