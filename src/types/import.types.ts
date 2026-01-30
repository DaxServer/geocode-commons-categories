/**
 * Type definitions for the administrative boundary import system
 */

import type { Polygon } from 'geojson'

/**
 * Raw boundary data from OpenStreetMap
 */
export type OSMBoundary = {
  osmId: number
  name: string
  adminLevel: number
  geometry: Polygon
  tags?: Record<string, string>
}

/**
 * Boundary ready for database insertion
 */
export type AdminBoundaryImport = {
  wikidata_id: string
  commons_category: string
  admin_level: number
  name: string
  geom: string // EWKT format
}

/**
 * OSM feature from Overpass API response
 */
export type OverpassFeature = {
  type: 'Feature'
  id: number
  properties: {
    name: string
    admin_level: string
    wikidata?: string
    [key: string]: unknown
  }
  geometry: Polygon
}

/**
 * Overpass API response structure
 */
export type OverpassResponse = {
  version: number
  generator: string
  osm3s: {
    timestamp_osm_base: string
    timestamp_areas_base: string
    copyright: string
  }
  elements: Array<
    | {
        type: 'relation'
        id: number
        tags?: Record<string, string>
        bounds?: {
          minlat: number
          minlon: number
          maxlat: number
          maxlon: number
        }
      }
    | {
        type: 'way'
        id: number
        nodes?: Array<{ ref: number }>
      }
    | {
        type: 'node'
        id: number
        lat: number
        lon: number
      }
  >
}

/**
 * Import statistics
 */
export type ImportStats = {
  osmRecords: number
  wikidataRecords: number
  matchedRecords: number
  insertedRecords: number
  skippedRecords: number
  errors: Array<{ record: string; error: string }>
}

/**
 * Import configuration
 */
export type ImportConfig = {
  countryCode: string
  adminLevels: number[]
  batchSize: number
  skipWikidata: boolean
  outputDir: string
}
