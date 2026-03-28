/**
 * Tests for shared retry utility
 */

import { describe, expect, mock, test } from 'bun:test'
import { Effect } from 'effect'
import { DELAYS, RETRY_CONFIG } from '@/import/constants'
import { fetchWithRetry } from './retry'
import { mockConsole } from './test-utils'

// Use test-friendly delays
const TEST_DELAY_MS = 1

describe('fetchWithRetry', () => {
  // Disable penalty for tests to avoid long waits
  // Set test-friendly values
  // @ts-expect-error - modifying for tests
  RETRY_CONFIG.PENALTY_ENABLED = false
  // @ts-expect-error - modifying for tests
  DELAYS.RATE_LIMIT_PENALTY_MS = 0

  test('should succeed on first attempt with valid response', async () => {
    mockConsole()
    const mockFetch = mock(async () =>
      Response.json({
        elements: [{ id: 123, type: 'relation' }],
      }),
    ) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = await Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    expect(result).toEqual({
      elements: [{ id: 123, type: 'relation' }],
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('should retry on HTTP 429 rate limit and eventually succeed', async () => {
    mockConsole()
    let attemptCount = 0
    const mockFetch = mock(async () => {
      attemptCount++
      if (attemptCount < 3) {
        return new Response('Rate limited', { status: 429, statusText: 'Too Many Requests' })
      }
      return Response.json({
        elements: [{ id: 456, type: 'relation' }],
      })
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = await Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    expect(result).toEqual({
      elements: [{ id: 456, type: 'relation' }],
    })
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  test('should retry on HTTP 500 server error and eventually succeed', async () => {
    mockConsole()
    let attemptCount = 0
    const mockFetch = mock(async () => {
      attemptCount++
      if (attemptCount < 2) {
        return new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        })
      }
      return Response.json({
        elements: [{ id: 789, type: 'relation' }],
      })
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = await Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    expect(result).toEqual({
      elements: [{ id: 789, type: 'relation' }],
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('should retry on HTTP 502 Bad Gateway', async () => {
    mockConsole()
    let attemptCount = 0
    const mockFetch = mock(async () => {
      attemptCount++
      if (attemptCount < 2) {
        return new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' })
      }
      return Response.json({ elements: [] })
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = await Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    expect(result).toEqual({ elements: [] })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('should retry on HTTP 503 Service Unavailable', async () => {
    mockConsole()
    let attemptCount = 0
    const mockFetch = mock(async () => {
      attemptCount++
      if (attemptCount < 2) {
        return new Response('Service Unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
        })
      }
      return Response.json({ elements: [] })
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = await Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    expect(result).toEqual({ elements: [] })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('should retry on HTTP 504 Gateway Timeout', async () => {
    mockConsole()
    let attemptCount = 0
    const mockFetch = mock(async () => {
      attemptCount++
      if (attemptCount < 2) {
        return new Response('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' })
      }
      return Response.json({ elements: [] })
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = await Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    expect(result).toEqual({ elements: [] })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('should fail immediately on non-retryable error (404)', async () => {
    mockConsole()
    const mockFetch = mock(
      async () => new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    await expect(result).rejects.toThrow('Overpass API error: 404 Not Found')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('should fail immediately on non-retryable error (400)', async () => {
    mockConsole()
    const mockFetch = mock(
      async () => new Response('Bad Request', { status: 400, statusText: 'Bad Request' }),
    ) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    await expect(result).rejects.toThrow('Overpass API error: 400 Bad Request')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('should retry on network errors and eventually succeed', async () => {
    mockConsole()
    let attemptCount = 0
    const mockFetch = mock(async () => {
      attemptCount++
      if (attemptCount < 2) {
        throw new Error('Network error')
      }
      return Response.json({ elements: [] })
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = await Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    expect(result).toEqual({ elements: [] })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('should fail after max retries on persistent 504', async () => {
    mockConsole()
    const mockFetch = mock(
      async () => new Response('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' }),
    ) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    await expect(result).rejects.toThrow('Overpass API error: 504 Gateway Timeout')
    // MAX_ATTEMPTS is 5 in production
    expect(mockFetch).toHaveBeenCalledTimes(RETRY_CONFIG.MAX_ATTEMPTS)
  })

  test('should fail after max retries on persistent rate limit', async () => {
    mockConsole()
    const mockFetch = mock(
      async () => new Response('Rate limited', { status: 429, statusText: 'Too Many Requests' }),
    ) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    await expect(result).rejects.toThrow('Overpass API error: 429 Too Many Requests')
    // MAX_ATTEMPTS is 5 in production
    expect(mockFetch).toHaveBeenCalledTimes(RETRY_CONFIG.MAX_ATTEMPTS)
  })

  test('should fail after max retries on persistent network errors', async () => {
    mockConsole()
    const mockFetch = mock(async () => {
      throw new Error('Persistent network error')
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const result = Effect.runPromise(
      fetchWithRetry({
        url: 'https://overpass-api.de/api/interpreter',
        body: '[out:json];out ids;',
        baseDelayMs: TEST_DELAY_MS,
      }),
    )

    await expect(result).rejects.toThrow('Persistent network error')
    // MAX_ATTEMPTS is 5 in production
    expect(mockFetch).toHaveBeenCalledTimes(RETRY_CONFIG.MAX_ATTEMPTS)
  })
})
