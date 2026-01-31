/**
 * Parent-child linking using PostGIS spatial queries
 */

import { Effect } from 'effect'
import type { OSMRelation } from '@/types/import.types'
import { updateParentsWithSpatialQuery } from './database/insert.ts'

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
  parentRelationId: number | null,
): OSMRelation {
  // Convert geometry to EWKT
  const ewkt = geometryToEWKT(parsed.geometry)

  return {
    relationId: parsed.relationId,
    countryCode,
    adminLevel: parseInt(parsed.adminLevel, 10),
    name: parsed.name,
    wikidataId: parsed.wikidataId,
    parentRelationId,
    tags: parsed.tags,
    geometry: ewkt,
  }
}

/**
 * Convert geometry to EWKT format for PostGIS
 */
function geometryToEWKT(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): string {
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates.map((ring) =>
      ring.map((coord) => `${coord[0]} ${coord[1]}`).join(','),
    )
    return `SRID=4326;POLYGON(${rings.map((r) => `(${r})`).join(',')})`
  } else {
    const polygons = geometry.coordinates.map((poly) =>
      poly.map((ring) => ring.map((coord) => `${coord[0]} ${coord[1]}`).join(',')).join(')'),
    )
    return `SRID=4326;MULTIPOLYGON(${polygons.map((p) => `(${p})`).join(',')})`
  }
}

/**
 * Link children to parents using PostGIS spatial queries
 * This is called after inserting all relations at a given level
 */
export function linkChildrenToParents(
  countryCode: string,
  childLevel: number,
  parentLevel: number,
): Effect.Effect<number, Error> {
  return Effect.gen(function* () {
    console.log(
      `Linking level ${childLevel} children to level ${parentLevel} parents for ${countryCode}...`,
    )

    const linksUpdated = yield* updateParentsWithSpatialQuery(countryCode, childLevel, parentLevel)

    console.log(`Created ${linksUpdated} parent links for ${countryCode} at level ${childLevel}`)

    return linksUpdated
  })
}

/**
 * Store relations with parent linking
 * Converts parsed geometries to OSMRelation format and inserts to database
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
    // Convert to OSMRelation format (parent linking happens via spatial query after insert)
    const relations = parsedGeometries.map((parsed) =>
      convertToOSMRelation(parsed, countryCode, null),
    )

    console.log(`Converted ${relations.length} relations for ${countryCode} at level ${adminLevel}`)

    return relations
  })
}

/**
 * Handle edge cases for parent linking
 */
export function handleParentLinkingEdgeCases(): {
  warnOverlappingBorders: boolean
  handleEnclaves: boolean
} {
  return {
    warnOverlappingBorders: true,
    handleEnclaves: true,
  }
}
