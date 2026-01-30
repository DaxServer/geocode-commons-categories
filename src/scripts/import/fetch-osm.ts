/**
 * Fetch OSM boundary data and save to intermediate file
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import type { ImportConfig, OSMBoundary } from '../../types/import.types'
import { tryAsync } from '../utils/effect'
import { fetchBoundaries } from '../utils/overpass'

/**
 * Fetch OSM data and save to JSON file
 */
export const fetchOSMData = (config: ImportConfig): Effect.Effect<OSMBoundary[], Error> => {
  return Effect.gen(function* () {
    const { countryCode, adminLevels, outputDir } = config

    console.log('=== Fetching OSM Boundary Data ===')

    let boundaries: OSMBoundary[]

    if (countryCode) {
      boundaries = yield* fetchBoundaries(countryCode, adminLevels)
    } else {
      console.warn('Global import not yet implemented, use countryCode parameter')
      boundaries = []
    }

    console.log(`Total boundaries fetched: ${boundaries.length}`)

    if (outputDir) {
      const filename = countryCode || 'global'
      const outputPath = join(outputDir, `osm-${filename}.json`)
      yield* tryAsync(
        async () => await writeFile(outputPath, JSON.stringify(boundaries, null, 2)),
        'Failed to write OSM data file',
      )
      console.log(`Saved OSM data to ${outputPath}`)
    }

    return boundaries
  })
}

/**
 * Main function for standalone execution
 */
export async function main() {
  const countryCode = Bun.env.COUNTRY_CODE
  const adminLevelsStr = Bun.env.ADMIN_LEVELS
  const adminLevels = adminLevelsStr
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n))
  const outputDir = Bun.env.OUTPUT_DIR

  const config: ImportConfig = {
    countryCode,
    adminLevels,
    outputDir,
    batchSize: parseInt(Bun.env.BATCH_SIZE, 10),
    skipWikidata: Bun.env.SKIP_WIKIDATA === 'true',
  }

  const program = Effect.gen(function* () {
    const boundaries = yield* fetchOSMData(config)
    console.log(`\nSuccess! Fetched ${boundaries.length} boundaries`)
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error('Failed to fetch OSM data:', error)
        process.exit(1)
      }),
    ),
  )

  await Effect.runPromise(program)
}

// Run if executed directly
if (import.meta.path === Bun.main) {
  await main()
}
