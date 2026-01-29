/**
 * Fetch OSM boundary data and save to intermediate file
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportConfig, OSMBoundary } from '../../types/import.types'
import { fetchBoundaries } from '../utils/overpass'

/**
 * Fetch OSM data and save to JSON file
 */
export async function fetchOSMData(config: ImportConfig): Promise<OSMBoundary[]> {
  const { countryCode, adminLevels, outputDir } = config

  console.log('=== Fetching OSM Boundary Data ===')

  let boundaries: OSMBoundary[]

  if (countryCode) {
    // Fetch by country code
    boundaries = await fetchBoundaries(countryCode, adminLevels)
  } else {
    // For global import, fetch by continent/region using bounding boxes
    console.warn('Global import not yet implemented, use countryCode parameter')
    boundaries = []
  }

  console.log(`Total boundaries fetched: ${boundaries.length}`)

  // Save to intermediate file if outputDir specified
  if (outputDir) {
    const filename = countryCode || 'global'
    const outputPath = join(outputDir, `osm-${filename}.json`)
    await writeFile(outputPath, JSON.stringify(boundaries, null, 2))
    console.log(`Saved OSM data to ${outputPath}`)
  }

  return boundaries
}

/**
 * Main function for standalone execution
 */
export async function main() {
  const countryCode = Bun.env.COUNTRY_CODE
  const adminLevelsStr = Bun.env.ADMIN_LEVELS
  const adminLevels = adminLevelsStr?.split(',').map(Number) || []
  const outputDir = Bun.env.OUTPUT_DIR

  const config: ImportConfig = {
    countryCode,
    adminLevels,
    outputDir,
  }

  try {
    const boundaries = await fetchOSMData(config)
    console.log(`\nSuccess! Fetched ${boundaries.length} boundaries`)
  } catch (error) {
    console.error('Failed to fetch OSM data:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.path === Bun.main) {
  await main()
}
