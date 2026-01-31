/**
 * Fetch full polygon geometry for relations from Overpass API
 */

import { Effect } from 'effect'
import { BATCH_SIZES, DELAYS } from '@/scripts/constants'
import { buildGeometryQuery, fetchOverpass } from '@/scripts/utils/overpass-hierarchical'
import type { ParsedGeometry } from '@/types/import.types'

/**
 * Parse polygon from way geometry
 */
function parseWayGeometry(way: {
  nodes?: number[]
  geometry?: Array<{ lat: number; lon: number }>
}): number[][] | null {
  if (!way.geometry || way.geometry.length === 0) {
    return null
  }

  return way.geometry.map((pt) => [pt.lon, pt.lat])
}

/**
 * Parse relation geometry from members
 */
function parseRelationGeometry(
  relation: {
    id: number
    tags?: Record<string, string>
    members?: Array<{ type: string; ref: number; role: string }>
  },
  waysMap: Map<number, { nodes?: number[]; geometry?: Array<{ lat: number; lon: number }> }>,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!relation.members || relation.members.length === 0) {
    return null
  }

  const outerWays: number[][][] = []
  const innerWays: number[][][] = []

  for (const member of relation.members) {
    if (member.type !== 'way') continue

    const way = waysMap.get(member.ref)
    if (!way) continue

    const coords = parseWayGeometry(way)
    if (!coords) continue

    if (member.role === 'outer' || member.role === '') {
      outerWays.push(coords)
    } else if (member.role === 'inner') {
      innerWays.push(coords)
    }
  }

  if (outerWays.length === 0) {
    return null
  }

  // If multiple outer rings, return MultiPolygon
  if (outerWays.length > 1) {
    const polygons: GeoJSON.Polygon[] = []

    for (const outer of outerWays) {
      const rings: number[][][] = [outer]

      // Add inner holes for this outer ring (simplified - assumes 1:1 mapping)
      const firstPoint = outer[0]
      if (firstPoint) {
        const matchingInner = innerWays.find(
          (inner) => inner && isPointInPolygon(firstPoint, inner),
        )
        if (matchingInner) {
          rings.push(matchingInner)
        }
      }

      polygons.push({
        type: 'Polygon',
        coordinates: rings,
      })
    }

    return {
      type: 'MultiPolygon',
      coordinates: polygons.map((p) => p.coordinates),
    }
  }

  // Single outer ring - filter out undefined inner ways
  const validInnerWays = innerWays.filter((inner): inner is number[][] => inner !== undefined)
  const firstOuter = outerWays[0]
  if (!firstOuter) {
    return null
  }
  const rings: number[][][] = [firstOuter, ...validInnerWays]
  return {
    type: 'Polygon',
    coordinates: rings,
  }
}

/**
 * Simple point-in-polygon test
 */
function isPointInPolygon(point: number[], polygon: number[][]): boolean {
  const x = point[0] ?? 0
  const y = point[1] ?? 0
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]?.[0] ?? 0
    const yi = polygon[i]?.[1] ?? 0
    const xj = polygon[j]?.[0] ?? 0
    const yj = polygon[j]?.[1] ?? 0

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + xi)
    if (intersect) inside = !inside
  }

  return inside
}

/**
 * Fetch geometry for a batch of relations
 */
export function fetchGeometryBatch(relationIds: number[]): Effect.Effect<ParsedGeometry[], Error> {
  return Effect.gen(function* () {
    if (relationIds.length === 0) {
      return []
    }

    console.log(`Fetching geometry for ${relationIds.length} relations...`)

    const query = buildGeometryQuery(relationIds)
    const data = (yield* fetchOverpass(query)) as unknown as {
      elements: Array<{
        type: string
        id: number
        tags?: Record<string, string>
        members?: Array<{ type: string; ref: number; role: string }>
        geometry?: Array<{ lat: number; lon: number }>
      }>
    }

    if (!data.elements || data.elements.length === 0) {
      console.warn('No elements returned from Overpass API')
      return []
    }

    // Build maps for ways and nodes
    const waysMap = new Map<
      number,
      { nodes?: number[]; geometry?: Array<{ lat: number; lon: number }> }
    >()

    for (const el of data.elements) {
      if (el.type === 'way' && el.geometry) {
        const wayEl = el as {
          type: string
          id: number
          nodes?: number[]
          geometry: Array<{ lat: number; lon: number }>
        }
        waysMap.set(wayEl.id, { nodes: wayEl.nodes, geometry: wayEl.geometry })
      }
    }

    // Parse relations
    const results: ParsedGeometry[] = []

    for (const el of data.elements) {
      if (el.type !== 'relation' || !el.tags) {
        continue
      }

      const name = el.tags['name']
      const adminLevel = el.tags['admin_level']
      const wikidataId = el.tags['wikidata'] || null

      if (!name || !adminLevel) {
        continue
      }

      const geometry = parseRelationGeometry(el, waysMap)

      if (!geometry) {
        console.warn(`Failed to parse geometry for relation ${el.id} (${name})`)
        continue
      }

      results.push({
        relationId: el.id,
        name,
        wikidataId,
        adminLevel,
        tags: el.tags,
        geometry,
      })
    }

    console.log(`Successfully parsed ${results.length} relations with geometry`)

    return results
  })
}

/**
 * Fetch geometry for all relations in batches with rate limiting
 */
export function fetchAllGeometry(relationIds: number[]): Effect.Effect<ParsedGeometry[], Error> {
  return Effect.gen(function* () {
    const allResults: ParsedGeometry[] = []

    for (let i = 0; i < relationIds.length; i += BATCH_SIZES.OVERPASS_GEOMETRY) {
      const batch = relationIds.slice(i, i + BATCH_SIZES.OVERPASS_GEOMETRY)
      console.log(
        `Processing geometry batch ${Math.floor(i / BATCH_SIZES.OVERPASS_GEOMETRY) + 1}...`,
      )

      const results = yield* fetchGeometryBatch(batch)
      allResults.push(...results)

      // Rate limiting between batches
      if (i + BATCH_SIZES.OVERPASS_GEOMETRY < relationIds.length) {
        console.log(`Waiting ${DELAYS.OVERPASS_GEOMETRY_MS}ms before next batch...`)
        yield* Effect.sleep(`${DELAYS.OVERPASS_GEOMETRY_MS} millis`)
      }
    }

    console.log(`Fetched geometry for ${allResults.length} relations`)

    return allResults
  })
}
