/**
 * Fetch full polygon geometry for relations from Overpass API
 */

import { Effect } from 'effect'
import { BATCH_SIZES, DELAYS } from '@/import/constants'
import { buildGeometryQuery, fetchOverpass } from '@/import/utils/overpass-import'
import type { ParsedGeometry } from '@/types/import.types'

/**
 * Compare two points with epsilon for floating-point precision
 */
function pointsEqual(a: number[], b: number[]): boolean {
  const EPSILON = 1e-7
  return (
    Math.abs((a[0] ?? 0) - (b[0] ?? 0)) < EPSILON && Math.abs((a[1] ?? 0) - (b[1] ?? 0)) < EPSILON
  )
}

/**
 * Get the first and last points of a way
 */
function getWayEndpoints(way: number[][]): { first: number[]; last: number[] } | null {
  if (way.length === 0) return null
  return { first: way[0] ?? [0, 0], last: way[way.length - 1] ?? [0, 0] }
}

/**
 * Reverse a way's coordinates (for connecting in opposite direction)
 */
function reverseWay(way: number[][]): number[][] {
  return [...way].reverse()
}

/**
 * Merge connected ways into complete rings
 * Uses a graph-based approach to find connected components and walk them
 */
function mergeWaysIntoRings(ways: number[][][]): number[][][] {
  if (ways.length === 0) return []
  if (ways.length === 1) {
    const way = ways[0]
    return way ? [way] : []
  }

  // Build adjacency graph: map from endpoint to list of ways
  const adjacency = new Map<string, Array<{ way: number[][]; used: boolean }>>()
  const wayList: Array<{ way: number[][]; used: boolean }> = []

  for (const way of ways) {
    const endpoints = getWayEndpoints(way)
    if (!endpoints) continue

    const keyFirst = `${endpoints.first[0]},${endpoints.first[1]}`
    const keyLast = `${endpoints.last[0]},${endpoints.last[1]}`

    if (!adjacency.has(keyFirst)) adjacency.set(keyFirst, [])
    if (!adjacency.has(keyLast)) adjacency.set(keyLast, [])

    const wayEntry = { way, used: false }
    wayList.push(wayEntry)

    // Each way connects to both its endpoints (can traverse either direction)
    adjacency.get(keyFirst)?.push(wayEntry)
    adjacency.get(keyLast)?.push(wayEntry)
  }

  const rings: number[][][] = []

  // Find and walk each connected component
  for (const startWay of wayList) {
    if (startWay.used) continue

    // Start a new ring with this unused way
    const currentRing: number[][] = [...startWay.way]
    startWay.used = true

    // Try to extend the ring in both directions
    let extended = true

    while (extended) {
      extended = false
      const ringEndpoints = getWayEndpoints(currentRing)

      if (!ringEndpoints) break

      // Try to extend from the end
      const endKey = `${ringEndpoints.last[0]},${ringEndpoints.last[1]}`
      const connections = adjacency.get(endKey) ?? []

      for (const conn of connections) {
        if (conn.used) continue

        const connEndpoints = getWayEndpoints(conn.way)
        if (!connEndpoints) continue

        // Check if this way connects to our current end
        if (pointsEqual(connEndpoints.first, ringEndpoints.last)) {
          // Connect in forward direction
          currentRing.push(...conn.way.slice(1))
          conn.used = true
          extended = true
          break
        } else if (pointsEqual(connEndpoints.last, ringEndpoints.last)) {
          // Connect in reverse direction
          currentRing.push(...reverseWay(conn.way).slice(1))
          conn.used = true
          extended = true
          break
        }
      }

      if (extended) continue

      // Try to extend from the start (if we haven't closed the ring)
      const startKey = `${ringEndpoints.first[0]},${ringEndpoints.first[1]}`
      const startConnections = adjacency.get(startKey) ?? []

      for (const conn of startConnections) {
        if (conn.used) continue

        const connEndpoints = getWayEndpoints(conn.way)
        if (!connEndpoints) continue

        // Check if this way connects to our current start
        if (pointsEqual(connEndpoints.last, ringEndpoints.first)) {
          // Prepend in forward direction
          currentRing.unshift(...conn.way.slice(0, -1))
          conn.used = true
          extended = true
          break
        } else if (pointsEqual(connEndpoints.first, ringEndpoints.first)) {
          // Prepend in reverse direction
          currentRing.unshift(...reverseWay(conn.way).slice(0, -1))
          conn.used = true
          extended = true
          break
        }
      }
    }

    // Only add if ring is closed (first == last) or has reasonable length
    if (currentRing.length >= 3) {
      // Ensure ring is closed
      const firstPoint = currentRing[0] ?? [0, 0]
      const lastPoint = currentRing[currentRing.length - 1] ?? [0, 0]

      if (!pointsEqual(firstPoint, lastPoint)) {
        currentRing.push([...firstPoint])
      }

      rings.push(currentRing)
    }
  }

  return rings
}

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
 * Simplify a ring by removing redundant collinear points
 */
function simplifyRing(ring: number[][], tolerance = 1e-7): number[][] {
  if (ring.length <= 3) return ring

  const simplified: number[][] = [ring[0] ?? [0, 0]]

  for (let i = 1; i < ring.length - 1; i++) {
    const prev = simplified[simplified.length - 1]
    if (!prev) continue

    const curr = ring[i] ?? [0, 0]
    const next = ring[i + 1] ?? [0, 0]

    const prevX = prev[0] ?? 0
    const prevY = prev[1] ?? 0
    const currX = curr[0] ?? 0
    const currY = curr[1] ?? 0
    const nextX = next[0] ?? 0
    const nextY = next[1] ?? 0

    // Check if current point is collinear with prev and next
    const crossProduct = (currX - prevX) * (nextY - prevY) - (currY - prevY) * (nextX - prevX)

    // Keep point if not collinear (cross product > tolerance)
    if (Math.abs(crossProduct) > tolerance) {
      simplified.push(curr)
    }
  }

  // Always keep the last point (which should equal the first)
  simplified.push(ring[ring.length - 1] ?? [0, 0])

  return simplified
}

/**
 * Parse relation geometry from members
 * Merges connected ways into complete rings
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

  // Merge outer ways into complete rings
  const outerRings = mergeWaysIntoRings(outerWays)
  if (outerRings.length === 0) {
    return null
  }

  // Merge inner ways into complete rings
  const innerRings = mergeWaysIntoRings(innerWays)

  // Simplify rings to reduce vertex count
  const simplifiedOuterRings = outerRings.map((ring) => simplifyRing(ring))
  const simplifiedInnerRings = innerRings.map((ring) => simplifyRing(ring))

  // If multiple outer rings, return MultiPolygon
  if (simplifiedOuterRings.length > 1) {
    const polygons: GeoJSON.Polygon[] = []

    for (const outer of simplifiedOuterRings) {
      const rings: number[][][] = [outer]

      // Match inner rings to this outer ring
      for (const inner of simplifiedInnerRings) {
        if (inner.length === 0) continue

        const testPoint = inner[0] ?? [0, 0]
        if (isPointInPolygon(testPoint, outer)) {
          rings.push(inner)
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

  // Single outer ring - add all inner rings that are contained within it
  const rings: number[][][] = [simplifiedOuterRings[0] ?? []]

  for (const inner of simplifiedInnerRings) {
    if (inner.length === 0) continue

    const testPoint = inner[0] ?? [0, 0]
    if (isPointInPolygon(testPoint, simplifiedOuterRings[0] ?? [])) {
      rings.push(inner)
    }
  }

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
