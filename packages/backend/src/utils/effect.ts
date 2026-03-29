/**
 * Effect utilities for consistent error handling
 */

import { Effect } from 'effect'

/**
 * Convert unknown error to Error instance
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Wrap async operation in Effect with standard error handling
 */
export function tryAsync<T>(
  tryFn: () => Promise<T>,
  context?: string,
): Effect.Effect<T, Error, never> {
  return Effect.tryPromise({
    try: tryFn,
    catch: (error) => {
      const err = toError(error)
      return context ? new Error(`${context}: ${err.message}`) : err
    },
  })
}
