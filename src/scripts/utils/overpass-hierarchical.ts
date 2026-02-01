/**
 * Overpass API queries for hierarchical administrative boundary import
 * Uses full polygon geometry (out geom) instead of bounding boxes
 */

import { Effect } from 'effect'
import { HIERARCHICAL_IMPORT, RETRY_CONFIG } from '@/scripts/constants'
import { tryAsync } from './effect-helpers'

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

/**
 * Build query to fetch relation IDs by ISO3166-1:alpha3 tag (for country level only)
 */
export function buildCountryLevelQuery(iso3Code: string, adminLevel: number): string {
  return `
    [out:json][timeout:${HIERARCHICAL_IMPORT.OVERPASS_TIMEOUT}];
    (
      relation["boundary"="administrative"]["admin_level"="${adminLevel}"]["ISO3166-1:alpha3"="${iso3Code}"];
    );
    out ids;
  `
}

/**
 * Build query to fetch child relations within parent relation
 */
export function buildChildQuery(parentRelationId: number, childLevel: number): string {
  // Convert relation ID to area ID (Overpass area IDs for relations are 3600000000 + relationId)
  const areaId = 3600000000 + parentRelationId
  return `
    [out:json][timeout:${HIERARCHICAL_IMPORT.OVERPASS_TIMEOUT}];
    (
      relation["boundary"="administrative"]["admin_level"="${childLevel}"](area:${areaId});
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
      way(r);
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
 * Fetch relation IDs for a country at a specific admin level (level 2 only - uses ISO3166-1:alpha3 tag)
 */
export function fetchCountryLevelRelations(
  iso3Code: string,
  adminLevel: number,
): Effect.Effect<number[], Error> {
  return Effect.gen(function* () {
    const query = buildCountryLevelQuery(iso3Code, adminLevel)
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
