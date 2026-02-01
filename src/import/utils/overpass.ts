/**
 * Overpass API client for querying OpenStreetMap boundary data
 */

import { Effect } from 'effect'
import { fetchOverpass } from '@/import/utils/retry'
import type { OSMBoundary, OverpassFeature, OverpassResponse } from '@/types/import.types'

/**
 * Build Overpass QL query for administrative boundaries
 */
function buildBoundaryQuery(countryCode?: string, adminLevels?: number[]): string {
  let levelFilter = ''
  if (adminLevels && adminLevels.length > 0) {
    const levels = adminLevels.join('|')
    levelFilter = `["admin_level"~"^(${levels})$"]`
  }

  let areaFilter = ''
  if (countryCode) {
    areaFilter = `area["ISO3166-1"="${countryCode}"]->.searchArea;`
  }

  // Query for relations with boundary tags and admin_level
  // Use "out bb;" to get bounding boxes for relations
  const query = `
    [out:json][timeout:90];
    ${areaFilter}
    (
      relation["boundary"="administrative"]${levelFilter}${countryCode ? '(area.searchArea)' : ''};
    );
    out bb;
  `

  return query
}

/**
 * Type guards for Overpass elements
 */
function isRelation(element: { type: string }): element is {
  type: 'relation'
  id: number
  tags?: Record<string, string>
  bounds?: {
    minlat: number
    minlon: number
    maxlat: number
    maxlon: number
  }
} {
  return element.type === 'relation'
}

/**
 * Convert bounding box to GeoJSON Polygon coordinates
 */
function boundsToPolygon(bounds: {
  minlat: number
  minlon: number
  maxlat: number
  maxlon: number
}): number[][] {
  // Create a rectangular polygon from the bounding box
  const { minlat, minlon, maxlat, maxlon } = bounds
  return [
    [minlon, minlat],
    [maxlon, minlat],
    [maxlon, maxlat],
    [minlon, maxlat],
    [minlon, minlat], // Close the ring
  ]
}

/**
 * Convert Overpass response elements to GeoJSON features
 *
 * Uses bounding boxes from relation metadata to create simplified polygons
 */
function convertToGeoJSON(elements: OverpassResponse['elements']): OverpassFeature[] {
  const features: OverpassFeature[] = []

  console.log(`Converting ${elements.length} elements to GeoJSON`)

  const relations = elements.filter(isRelation)
  console.log(`Found ${relations.length} relations`)

  let skippedNoBounds = 0
  let skippedNoName = 0
  let successful = 0

  for (const relation of relations) {
    if (!relation.tags) {
      skippedNoName++
      continue
    }

    const name = relation.tags['name']
    const adminLevel = relation.tags['admin_level']
    if (!name || !adminLevel) {
      if (!name) skippedNoName++
      continue
    }

    // Use bounding box to create a simplified polygon
    if (!relation.bounds) {
      skippedNoBounds++
      continue
    }

    const coordinates = boundsToPolygon(relation.bounds)
    const wikidata = relation.tags['wikidata']

    features.push({
      type: 'Feature',
      id: relation.id,
      properties: {
        name,
        admin_level: adminLevel,
        wikidata,
        ...relation.tags,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates],
      },
    })
    successful++
  }

  console.log(
    `Conversion stats: ${successful} successful, ${skippedNoBounds} no bounds, ${skippedNoName} no name`,
  )

  return features
}

/**
 * Fetch boundaries from Overpass API with retry logic
 */
function fetchBoundariesFromAPI(query: string): Effect.Effect<OverpassResponse, Error> {
  return fetchOverpass<OverpassResponse>(query)
}

/**
 * Fetch administrative boundaries for a country
 */
export const fetchBoundaries = (
  countryCode?: string,
  adminLevels?: number[],
): Effect.Effect<OSMBoundary[], Error> => {
  return Effect.gen(function* () {
    const query = buildBoundaryQuery(countryCode, adminLevels)
    console.log(`Fetching boundaries${countryCode ? ` for ${countryCode}` : ' globally'}...`)
    console.log(`Query: ${query}`)

    const data = yield* fetchBoundariesFromAPI(query)

    if (!data.elements || data.elements.length === 0) {
      console.warn('No boundaries found in Overpass response')
      return []
    }

    const features = convertToGeoJSON(data.elements)
    console.log(`Found ${features.length} boundaries (from ${data.elements.length} elements)`)

    return features.map((feature) => ({
      osmId: feature.id,
      name: feature.properties['name'],
      adminLevel: parseInt(feature.properties['admin_level'], 10),
      geometry: feature.geometry as GeoJSON.Polygon,
      tags: feature.properties as Record<string, string>,
    }))
  })
}

/**
 * Fetch boundaries by region (bounding box)
 */
export const fetchBoundariesByBBox = (
  south: number,
  west: number,
  north: number,
  east: number,
  adminLevels?: number[],
): Effect.Effect<OSMBoundary[], Error> => {
  return Effect.gen(function* () {
    let levelFilter = ''
    if (adminLevels && adminLevels.length > 0) {
      const levels = adminLevels.join('|')
      levelFilter = `["admin_level"~"^(${levels})$"]`
    }

    const query = `
      [out:json][timeout:90];
      (
        relation["boundary"="administrative"]${levelFilter}(south:${south}, west:${west}, north:${north}, east:${east});
      );
      out geom;
    `

    console.log(`Fetching boundaries for bbox: ${south},${west},${north},${east}`)

    const data = yield* fetchBoundariesFromAPI(query)

    if (!data.elements || data.elements.length === 0) {
      return []
    }

    const features = convertToGeoJSON(data.elements)
    return features.map((feature) => ({
      osmId: feature.id,
      name: feature.properties['name'],
      adminLevel: parseInt(feature.properties['admin_level'], 10),
      geometry: feature.geometry as GeoJSON.Polygon,
      tags: feature.properties as Record<string, string>,
    }))
  })
}
