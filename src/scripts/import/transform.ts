import { pipe } from 'effect'
import type { AdminBoundaryImport, OSMBoundary } from '../../types/import.types'

/**
 * Convert GeoJSON Polygon to EWKT (Extended Well-Known Text)
 */
function polygonToEWKT(polygon: GeoJSON.Polygon): string {
  const rings = polygon.coordinates.map(
    (ring: number[][]) => `(${ring.map((point: number[]) => `${point[0]} ${point[1]}`).join(',')})`,
  )

  return `SRID=4326;POLYGON(${rings.join(',')})`
}

/**
 * Extract Wikidata ID from OSM wikidata tag
 */
function extractWikidataId(wikidataTag: string): string {
  return wikidataTag.replace('http://www.wikidata.org/entity/', '')
}

/**
 * Enrich OSM boundaries with Wikidata Commons categories
 */
export function enrichWithWikidataData(
  osmBoundaries: OSMBoundary[],
  wikidataCategories: Map<string, string>,
): AdminBoundaryImport[] {
  console.log('=== Enriching OSM Boundaries with Wikidata Data ===')

  const enriched: AdminBoundaryImport[] = []
  let skippedCount = 0

  for (const osmBoundary of osmBoundaries) {
    const wikidataTag = osmBoundary.tags?.['wikidata']

    if (!wikidataTag) {
      skippedCount++
      console.debug(`No wikidata tag for: ${osmBoundary.name}`)
      continue
    }

    const wikidataId = extractWikidataId(wikidataTag)
    const commonsCategory = wikidataCategories.get(wikidataId)

    if (!commonsCategory) {
      skippedCount++
      console.debug(`No Commons category for Wikidata ID ${wikidataId} (${osmBoundary.name})`)
      continue
    }

    enriched.push({
      wikidata_id: wikidataId,
      commons_category: commonsCategory,
      admin_level: osmBoundary.adminLevel,
      name: osmBoundary.name,
      geom: polygonToEWKT(osmBoundary.geometry),
    })
  }

  console.log(`Enriched: ${enriched.length} boundaries`)
  console.log(`Skipped: ${skippedCount} boundaries (no wikidata tag or Commons category)`)

  return enriched
}

/**
 * Validate and filter boundaries with invalid geometries
 */
export function validateGeometries(boundaries: AdminBoundaryImport[]): AdminBoundaryImport[] {
  console.log('=== Validating Geometries ===')

  const valid: AdminBoundaryImport[] = []
  let invalidCount = 0

  for (const boundary of boundaries) {
    // Basic validation: check if EWKT is well-formed
    if (!boundary.geom.startsWith('SRID=4326;POLYGON((')) {
      console.warn(`Invalid geometry format for: ${boundary.name}`)
      invalidCount++
      continue
    }

    // Check for minimum polygon validity (has coordinates)
    const coords = boundary.geom.match(/POLYGON\(\((.+)\)\)/)?.[1]
    if (!coords || coords.split(',').length < 4) {
      console.warn(`Invalid polygon coordinates for: ${boundary.name}`)
      invalidCount++
      continue
    }

    valid.push(boundary)
  }

  console.log(`Valid geometries: ${valid.length}`)
  console.log(`Invalid geometries: ${invalidCount}`)

  return valid
}

/**
 * Remove duplicates by wikidata_id
 */
export function deduplicateBoundaries(boundaries: AdminBoundaryImport[]): AdminBoundaryImport[] {
  console.log('=== Deduplicating Boundaries ===')

  const seen = new Set<string>()
  const unique: AdminBoundaryImport[] = []

  for (const boundary of boundaries) {
    if (!seen.has(boundary.wikidata_id)) {
      seen.add(boundary.wikidata_id)
      unique.push(boundary)
    }
  }

  console.log(`Duplicates removed: ${boundaries.length - unique.length}`)
  console.log(`Unique boundaries: ${unique.length}`)

  return unique
}

/**
 * Complete transformation pipeline
 */
export function transformBoundaries(
  osmBoundaries: OSMBoundary[],
  wikidataCategories: Map<string, string>,
): AdminBoundaryImport[] {
  return pipe(
    osmBoundaries,
    (boundaries) => enrichWithWikidataData(boundaries, wikidataCategories),
    validateGeometries,
    deduplicateBoundaries,
  )
}
