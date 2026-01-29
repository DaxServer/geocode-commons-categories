/**
 * Overpass API client for querying OpenStreetMap boundary data
 */

import { Effect } from 'effect'
import type { OSMBoundary, OverpassFeature, OverpassResponse } from '../../types/import.types'
import { DELAYS, RETRY_CONFIG } from '../constants'
import { tryAsync } from './effect'

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'

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
  const query = `
    [out:json][timeout:90];
    ${areaFilter}
    (
      relation["boundary"="administrative"]${levelFilter}${countryCode ? '(area.searchArea)' : ''};
    );
    out geom;
  `

  return query
}

/**
 * Convert Overpass response elements to GeoJSON features
 */
function convertToGeoJSON(elements: OverpassResponse['elements']): OverpassFeature[] {
  const features: OverpassFeature[] = []

  for (const element of elements) {
    if (element.type !== 'relation' || !element.tags || !element.geometry) {
      continue
    }

    const name = element.tags['name']
    const adminLevel = element.tags['admin_level']
    if (!name || !adminLevel) {
      continue
    }

    // Convert geometry array to GeoJSON Polygon
    // Overpass returns simplified geometry, we need to build proper rings
    const coordinates: number[][][] = []
    const currentRing: number[][] = []

    for (const point of element.geometry) {
      currentRing.push([point.lon, point.lat])
    }

    // A valid polygon ring must have at least 4 points (closed ring)
    if (currentRing.length < 4) {
      console.warn(
        `Skipping element ${element.id}: insufficient geometry points (${currentRing.length})`,
      )
      continue
    }

    coordinates.push(currentRing)

    const wikidata = element.tags['wikidata']

    features.push({
      type: 'Feature',
      id: element.id,
      properties: {
        name,
        admin_level: adminLevel,
        wikidata,
        ...element.tags,
      },
      geometry: {
        type: 'Polygon',
        coordinates,
      },
    })
  }

  return features
}

/**
 * Fetch boundaries from Overpass API with retry logic
 */
function fetchWithRetry(query: string): Effect.Effect<OverpassResponse, Error> {
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
          const delay = RETRY_CONFIG.BASE_DELAY_MS * DELAYS.RETRY_EXPONENTIAL_BASE ** attempt
          console.warn(`Request failed, retrying in ${delay}ms...`, response.left)
          yield* Effect.sleep(`${delay} millis`)
          continue
        }
        return yield* Effect.fail(response.left)
      }

      const res = response.right

      if (!res.ok) {
        if (res.status === 429 && attempt < RETRY_CONFIG.MAX_ATTEMPTS - 1) {
          const delay = RETRY_CONFIG.BASE_DELAY_MS * DELAYS.RETRY_EXPONENTIAL_BASE ** attempt
          console.warn(`Rate limited, waiting ${delay}ms...`)
          yield* Effect.sleep(`${delay} millis`)
          continue
        }
        return yield* Effect.fail(new Error(`Overpass API error: ${res.status} ${res.statusText}`))
      }

      const data = yield* tryAsync(async () => (await res.json()) as OverpassResponse)

      return data
    }

    return yield* Effect.fail(new Error('Max retries exceeded'))
  })
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

    const data = yield* fetchWithRetry(query)

    if (!data.elements || data.elements.length === 0) {
      console.warn('No boundaries found in Overpass response')
      return []
    }

    const features = convertToGeoJSON(data.elements)
    console.log(`Found ${features.length} boundaries`)

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

    const data = yield* fetchWithRetry(query)

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
