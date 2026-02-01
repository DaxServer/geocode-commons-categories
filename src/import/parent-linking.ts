/**
 * Geometry conversion utilities for import
 */

import { Effect } from 'effect'
import type { OSMRelation } from '@/types/import.types'

/**
 * Convert ParsedGeometry to OSMRelation for database insertion
 */
export function convertToOSMRelation(
  parsed: {
    relationId: number
    name: string
    wikidataId: string | null
    adminLevel: string
    tags: Record<string, string>
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  },
  countryCode: string,
): OSMRelation {
  // Convert geometry to EWKT
  const ewkt = geometryToEWKT(parsed.geometry)

  return {
    relationId: parsed.relationId,
    countryCode,
    adminLevel: parseInt(parsed.adminLevel, 10),
    name: parsed.name,
    wikidataId: parsed.wikidataId,
    geometry: ewkt,
    tags: parsed.tags,
  }
}

/**
 * Simplify a ring by sampling points (reduce vertex count)
 * Keeps every Nth point to reduce complexity while preserving shape
 */
function simplifyRing(coords: number[][], targetMaxPoints: number): number[][] {
  if (coords.length <= targetMaxPoints) return coords

  // Calculate step size to get approximately targetMaxPoints
  const step = Math.ceil(coords.length / targetMaxPoints)
  const simplified: number[][] = []

  for (let i = 0; i < coords.length; i += step) {
    simplified.push(coords[i] ?? [0, 0])
  }

  // Ensure last point is included
  const last = coords[coords.length - 1]
  if (
    last &&
    (simplified[simplified.length - 1]?.[0] !== last[0] ||
      simplified[simplified.length - 1]?.[1] !== last[1])
  ) {
    simplified.push(last)
  }

  return simplified
}

/**
 * Ensure a ring is closed (first point equals last point)
 */
function closeRing(coords: number[][]): number[][] {
  if (coords.length === 0) return coords

  const first = coords[0]
  const last = coords[coords.length - 1]

  // Check if ring is already closed
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    return coords
  }

  // Close the ring by appending the first point
  return [...coords, first ?? [0, 0]]
}

/**
 * Convert geometry to EWKT format for PostGIS
 * Simplifies complex geometries to avoid PostGIS limits
 */
function geometryToEWKT(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): string {
  const MAX_POINTS_PER_RING = 500 // Limit to avoid oversized EWKT strings

  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates
      .map((ring) => {
        const simplified = simplifyRing(ring, MAX_POINTS_PER_RING)
        const closed = closeRing(simplified)
        // Skip invalid rings (less than 4 points for closed ring)
        if (closed.length < 4) return null
        return closed.map((coord) => `${coord[0]} ${coord[1]}`).join(',')
      })
      .filter((r): r is string => r !== null)

    if (rings.length === 0) {
      // Fallback to minimal polygon
      return 'SRID=4326;POLYGON((0 0,0 0,0 0,0 0))'
    }

    return `SRID=4326;POLYGON(${rings.map((r) => `(${r})`).join(',')})`
  } else {
    // MultiPolygon: Each polygon has multiple rings (outer + holes)
    const polygons = geometry.coordinates
      .map((poly) =>
        poly
          .map((ring) => {
            const simplified = simplifyRing(ring, MAX_POINTS_PER_RING)
            const closed = closeRing(simplified)
            // Skip invalid rings
            if (closed.length < 4) return null
            return `(${closed.map((coord) => `${coord[0]} ${coord[1]}`).join(',')})`
          })
          .filter((r): r is string => r !== null)
          .join(','),
      )
      .filter((p) => p.length > 0)

    if (polygons.length === 0) {
      // Fallback to minimal polygon
      return 'SRID=4326;POLYGON((0 0,0 0,0 0,0 0))'
    }

    return `SRID=4326;MULTIPOLYGON(${polygons.map((p) => `(${p})`).join(',')})`
  }
}

/**
 * Store relations for database insertion
 * Converts parsed geometries to OSMRelation format
 */
export function storeRelationsWithParents(
  parsedGeometries: Array<{
    relationId: number
    name: string
    wikidataId: string | null
    adminLevel: string
    tags: Record<string, string>
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  }>,
  countryCode: string,
  adminLevel: number,
): Effect.Effect<OSMRelation[], Error> {
  return Effect.gen(function* () {
    // Convert to OSMRelation format
    const relations = parsedGeometries.map((parsed) => convertToOSMRelation(parsed, countryCode))

    console.log(`Converted ${relations.length} relations for ${countryCode} at level ${adminLevel}`)

    return relations
  })
}
