/**
 * Tests for Overpass API client query building and data transformation
 */

import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { Effect } from 'effect'
import { fetchBoundaries, fetchBoundariesByBBox } from './overpass'
import { getMockedFetchBody, mockConsole } from './test-utils'

function mockFetchResponse(elements: unknown[]) {
  globalThis.fetch = mock(async () => Response.json({ elements })) as unknown as typeof fetch
}

describe('fetchBoundaries', () => {
  beforeAll(() => {
    mockConsole()
  })

  test('should fetch and parse boundaries successfully', async () => {
    mockFetchResponse([
      {
        type: 'relation',
        id: 123,
        tags: { name: 'Test Region', admin_level: '4', wikidata: 'Q123' },
        bounds: { minlat: 50, minlon: 4, maxlat: 51, maxlon: 5 },
      },
    ])

    const result = await Effect.runPromise(fetchBoundaries('BEL', [4]))

    expect(result).toHaveLength(1)
    expect(result[0]?.osmId).toBe(123)
    expect(result[0]?.name).toBe('Test Region')
    expect(result[0]?.adminLevel).toBe(4)
  })

  test('should return empty array when no elements found', async () => {
    mockFetchResponse([])

    const result = await Effect.runPromise(fetchBoundaries('BEL', [4]))

    expect(result).toEqual([])
  })

  test('should skip relations without bounds', async () => {
    mockFetchResponse([
      {
        type: 'relation',
        id: 123,
        tags: { name: 'With Bounds', admin_level: '4' },
        bounds: { minlat: 50, minlon: 4, maxlat: 51, maxlon: 5 },
      },
      {
        type: 'relation',
        id: 456,
        tags: { name: 'No Bounds', admin_level: '4' },
      },
    ])

    const result = await Effect.runPromise(fetchBoundaries('BEL', [4]))

    expect(result).toHaveLength(1)
    expect(result[0]?.osmId).toBe(123)
  })

  test('should skip relations without name or admin_level', async () => {
    mockFetchResponse([
      {
        type: 'relation',
        id: 123,
        tags: { name: 'Valid', admin_level: '4' },
        bounds: { minlat: 50, minlon: 4, maxlat: 51, maxlon: 5 },
      },
      {
        type: 'relation',
        id: 456,
        tags: { other_tag: 'value' },
        bounds: { minlat: 50, minlon: 4, maxlat: 51, maxlon: 5 },
      },
    ])

    const result = await Effect.runPromise(fetchBoundaries('BEL', [4]))

    expect(result).toHaveLength(1)
    expect(result[0]?.osmId).toBe(123)
  })

  test('should fetch globally when no country code provided', async () => {
    mockFetchResponse([
      {
        type: 'relation',
        id: 789,
        tags: { name: 'Global Region', admin_level: '4' },
        bounds: { minlat: 50, minlon: 4, maxlat: 51, maxlon: 5 },
      },
    ])

    const result = await Effect.runPromise(fetchBoundaries())

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Global Region')
  })
})

describe('fetchBoundariesByBBox', () => {
  test('should fetch boundaries within bounding box', async () => {
    mockFetchResponse([
      {
        type: 'relation',
        id: 999,
        tags: { name: 'BBox Region', admin_level: '5' },
        bounds: { minlat: 50, minlon: 4, maxlat: 51, maxlon: 5 },
      },
    ])

    const result = await Effect.runPromise(fetchBoundariesByBBox(50, 4, 51, 5, [5]))

    expect(result).toHaveLength(1)
    expect(result[0]?.osmId).toBe(999)
    expect(result[0]?.name).toBe('BBox Region')
  })

  test('should return empty array when no elements in bbox', async () => {
    mockFetchResponse([])

    const result = await Effect.runPromise(fetchBoundariesByBBox(50, 4, 51, 5))

    expect(result).toEqual([])
  })

  test('should build query without admin level filter when not provided', async () => {
    mockFetchResponse([])

    await Effect.runPromise(fetchBoundariesByBBox(50, 4, 51, 5))

    const body = getMockedFetchBody(0)
    expect(body).toBeDefined()
    expect(body).not.toContain('admin_level')
  })
})
