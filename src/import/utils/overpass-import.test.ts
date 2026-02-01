/**
 * Tests for Overpass import query builders and data parsing
 */

import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { Effect } from 'effect'
import {
  buildChildQuery,
  buildCountryLevelQuery,
  buildGeometryQuery,
  fetchChildRelationIds,
  fetchCountryLevelRelations,
} from './overpass-import'
import { mockConsole } from './test-utils'

describe('buildCountryLevelQuery', () => {
  beforeAll(() => {
    mockConsole()
  })

  test('should build query for country level with ISO3 code', () => {
    const query = buildCountryLevelQuery('BEL', 4)
    expect(query).toContain('[timeout:90]')
    expect(query).toContain('["boundary"="administrative"]')
    expect(query).toContain('["admin_level"="4"]')
    expect(query).toContain('["ISO3166-1:alpha3"="BEL"]')
    expect(query).toContain('out ids;')
  })
})

describe('buildChildQuery', () => {
  test('should build query for child relations within parent', () => {
    const query = buildChildQuery(12345, 6)
    expect(query).toContain('[timeout:90]')
    expect(query).toContain('["boundary"="administrative"]')
    expect(query).toContain('["admin_level"="6"]')
    expect(query).toContain('(area:3600012345)')
    expect(query).toContain('out ids;')
  })

  test('should use correct area ID calculation', () => {
    const query = buildChildQuery(1, 4)
    expect(query).toContain('(area:3600000001)')
  })
})

describe('buildGeometryQuery', () => {
  test('should build query for single relation', () => {
    const query = buildGeometryQuery([12345])
    expect(query).toContain('relation(id:12345)')
    expect(query).toContain('way(r)')
    expect(query).toContain('out geom;')
  })

  test('should build query for multiple relations', () => {
    const query = buildGeometryQuery([123, 456, 789])
    expect(query).toContain('relation(id:123,456,789)')
    expect(query).toContain('way(r)')
    expect(query).toContain('out geom;')
  })

  test('should handle empty list gracefully', () => {
    const query = buildGeometryQuery([])
    expect(query).toContain('relation(id:)')
  })
})

describe('fetchCountryLevelRelations', () => {
  test('should parse relation IDs from response', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        elements: [
          { type: 'relation', id: 123 },
          { type: 'relation', id: 456 },
        ],
      }),
    ) as unknown as typeof fetch

    const result = await Effect.runPromise(fetchCountryLevelRelations('BEL', 4))
    expect(result).toEqual([123, 456])
  })

  test('should return empty array when no elements found', async () => {
    globalThis.fetch = mock(async () => Response.json({ elements: [] })) as unknown as typeof fetch

    const result = await Effect.runPromise(fetchCountryLevelRelations('BEL', 4))
    expect(result).toEqual([])
  })

  test('should return empty array when response has no elements property', async () => {
    globalThis.fetch = mock(async () => Response.json({})) as unknown as typeof fetch

    const result = await Effect.runPromise(fetchCountryLevelRelations('BEL', 4))
    expect(result).toEqual([])
  })
})

describe('fetchChildRelationIds', () => {
  test('should parse child relation IDs from response', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        elements: [
          { type: 'relation', id: 111 },
          { type: 'relation', id: 222 },
        ],
      }),
    ) as unknown as typeof fetch

    const result = await Effect.runPromise(fetchChildRelationIds(12345, 6))
    expect(result).toEqual([111, 222])
  })

  test('should return empty array when no children found', async () => {
    globalThis.fetch = mock(async () => Response.json({ elements: [] })) as unknown as typeof fetch

    const result = await Effect.runPromise(fetchChildRelationIds(12345, 6))
    expect(result).toEqual([])
  })
})
