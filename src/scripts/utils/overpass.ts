/**
 * Overpass API client for querying OpenStreetMap boundary data
 */

import type { OSMBoundary, OverpassFeature, OverpassResponse } from '../../types/import.types'

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

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

    if (currentRing.length > 0) {
      coordinates.push(currentRing)
    }

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
        coordinates:
          coordinates.length > 0
            ? coordinates
            : [
                [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
              ],
      },
    })
  }

  return features
}

/**
 * Fetch boundaries from Overpass API with retry logic
 */
async function fetchWithRetry(query: string, retries = MAX_RETRIES): Promise<OverpassResponse> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(OVERPASS_API_URL, {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain',
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 429 && attempt < retries - 1) {
          // Rate limited - wait and retry
          const delay = BASE_DELAY_MS * 2 ** attempt
          console.warn(`Rate limited, waiting ${delay}ms...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        throw new Error(`Overpass API error: ${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as OverpassResponse
      return data
    } catch (error) {
      if (attempt === retries - 1) {
        throw error
      }
      const delay = BASE_DELAY_MS * 2 ** attempt
      console.warn(`Request failed, retrying in ${delay}ms...`, error)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error('Max retries exceeded')
}

/**
 * Fetch administrative boundaries for a country
 */
export async function fetchBoundaries(
  countryCode?: string,
  adminLevels?: number[],
): Promise<OSMBoundary[]> {
  const query = buildBoundaryQuery(countryCode, adminLevels)
  console.log(`Fetching boundaries${countryCode ? ` for ${countryCode}` : ' globally'}...`)

  const data = await fetchWithRetry(query)

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
    geometry: feature.properties['geometry'] as unknown as GeoJSON.Polygon,
    tags: feature.properties as Record<string, string>,
  }))
}

/**
 * Fetch boundaries by region (bounding box)
 */
export async function fetchBoundariesByBBox(
  south: number,
  west: number,
  north: number,
  east: number,
  adminLevels?: number[],
): Promise<OSMBoundary[]> {
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
  const data = await fetchWithRetry(query)

  if (!data.elements || data.elements.length === 0) {
    return []
  }

  const features = convertToGeoJSON(data.elements)
  return features.map((feature) => ({
    osmId: feature.id,
    name: feature.properties['name'],
    adminLevel: parseInt(feature.properties['admin_level'], 10),
    geometry: feature.properties['geometry'] as unknown as GeoJSON.Polygon,
    tags: feature.properties as Record<string, string>,
  }))
}
