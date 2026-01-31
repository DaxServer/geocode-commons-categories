/**
 * Overpass API queries for hierarchical administrative boundary import
 * Uses full polygon geometry (out geom) instead of bounding boxes
 */

import { Effect } from 'effect'
import { HIERARCHICAL_IMPORT, RETRY_CONFIG } from '@/scripts/constants'
import { tryAsync } from './effect-helpers'

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

/**
 * Build query to fetch relation IDs within a country area
 */
export function buildRelationIdQuery(iso3Code: string, adminLevel: number): string {
  return `
    [out:json][timeout:${HIERARCHICAL_IMPORT.OVERPASS_TIMEOUT}];
    area["ISO3166-1"="${iso3Code}"]->.searchArea;
    (
      relation["boundary"="administrative"]["admin_level"="${adminLevel}"](area.searchArea);
    );
    out ids;
  `
}

/**
 * Build query to fetch child relations within parent relation
 */
export function buildChildQuery(parentRelationId: number, childLevel: number): string {
  return `
    [out:json][timeout:${HIERARCHICAL_IMPORT.OVERPASS_TIMEOUT}];
    (
      relation["boundary"="administrative"]["admin_level"="${childLevel}"](area:${parentRelationId});
    );
    out ids;
  `
}

/**
 * Build query to fetch full geometry for multiple relations
 */
export function buildGeometryQuery(relationIds: number[]): string {
  const idList = relationIds.join(',')
  return `
    [out:json][timeout:${HIERARCHICAL_IMPORT.OVERPASS_TIMEOUT}];
    (
      relation(id:${idList});
    );
    out geom;
  `
}

/**
 * Fetch data from Overpass API with retry logic
 */
export function fetchOverpass(query: string): Effect.Effect<unknown, Error> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
      const response = yield* Effect.either(
        tryAsync(async () =>
          fetch(OVERPASS_API_URL, {
            method: 'POST',
            body: query,
            headers: {
              'Content-Type': 'text/plain',
              Accept: 'application/json',
            },
          }),
        ),
      )

      if (response._tag === 'Left') {
        if (attempt < RETRY_CONFIG.MAX_ATTEMPTS - 1) {
          const delay = RETRY_CONFIG.BASE_DELAY_MS * 2 ** attempt
          console.warn(`Overpass request failed, retrying in ${delay}ms...`, response.left)
          yield* Effect.sleep(`${delay} millis`)
          continue
        }
        return yield* Effect.fail(response.left)
      }

      const res = response.right

      if (!res.ok) {
        if (res.status === 429 && attempt < RETRY_CONFIG.MAX_ATTEMPTS - 1) {
          const delay = RETRY_CONFIG.BASE_DELAY_MS * 2 ** attempt
          console.warn(`Rate limited by Overpass API, waiting ${delay}ms...`)
          yield* Effect.sleep(`${delay} millis`)
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
 * Fetch relation IDs for a country at a specific admin level
 */
export function fetchRelationIds(
  iso3Code: string,
  adminLevel: number,
): Effect.Effect<number[], Error> {
  return Effect.gen(function* () {
    const query = buildRelationIdQuery(iso3Code, adminLevel)
    const data = (yield* fetchOverpass(query)) as unknown as {
      elements: Array<{ type: string; id: number }>
    }

    if (!data.elements || data.elements.length === 0) {
      console.log(`No relations found for ${iso3Code} at admin_level ${adminLevel}`)
      return []
    }

    const relationIds = data.elements.map((el: { type: string; id: number }) => el.id)
    console.log(
      `Found ${relationIds.length} relations for ${iso3Code} at admin_level ${adminLevel}`,
    )

    return relationIds
  })
}

/**
 * Fetch child relation IDs within a parent relation
 */
export function fetchChildRelationIds(
  parentRelationId: number,
  childLevel: number,
): Effect.Effect<number[], Error> {
  return Effect.gen(function* () {
    const query = buildChildQuery(parentRelationId, childLevel)
    const data = (yield* fetchOverpass(query)) as unknown as {
      elements: Array<{ type: string; id: number }>
    }

    if (!data.elements || data.elements.length === 0) {
      return []
    }

    const relationIds = data.elements.map((el: { type: string; id: number }) => el.id)
    console.log(
      `Found ${relationIds.length} child relations for parent ${parentRelationId} at admin_level ${childLevel}`,
    )

    return relationIds
  })
}

/**
 * Parse Overpass geometry response to GeoJSON
 */
export function parseOverpassGeometry(elements: unknown[]): Array<{
  relationId: number
  name: string
  wikidataId: string | null
  adminLevel: string
  tags: Record<string, string>
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}> {
  const results: Array<{
    relationId: number
    name: string
    wikidataId: string | null
    adminLevel: string
    tags: Record<string, string>
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  }> = []

  const relations = elements.filter(
    (
      el,
    ): el is { type: 'relation'; id: number; tags?: Record<string, string>; members?: unknown[] } =>
      typeof el === 'object' && el !== null && 'type' in el && el.type === 'relation',
  )

  for (const relation of relations) {
    if (!relation.tags) {
      continue
    }

    const name = relation.tags['name']
    const adminLevel = relation.tags['admin_level']
    const wikidataId = relation.tags['wikidata'] || null

    if (!name || !adminLevel) {
      continue
    }

    // Build geometry from members
    // This is a simplified version - full implementation would process ways and nodes
    // For now, we'll store minimal geometry info
    const geometry: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
      ], // Placeholder
    }

    results.push({
      relationId: relation.id,
      name,
      wikidataId,
      adminLevel,
      tags: relation.tags,
      geometry,
    })
  }

  return results
}
