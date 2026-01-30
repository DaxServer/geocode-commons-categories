/**
 * Main import orchestrator - coordinates the entire import pipeline
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import type {
  AdminBoundaryImport,
  ImportConfig,
  ImportStats,
  OSMBoundary,
} from '../../types/import.types'
import { tryAsync } from '../utils/effect'
import { logSection } from '../utils/logging'
import { fetchWikimediaCategoriesBatch } from '../utils/wikidata-api'
import { batchInsertBoundaries } from './database'
import { closePool } from './database/connection'
import { verifyImport } from './database/verification'
import { fetchOSMData } from './fetch-osm'
import { transformBoundaries } from './transform'

function displayConfig(config: ImportConfig): void {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║   Administrative Boundary Data Import System            ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log()
  console.log('Configuration:')
  console.log(`  Country: ${config.countryCode}`)
  console.log(`  Admin levels: ${config.adminLevels.join(', ')}`)
  console.log(`  Batch size: ${config.batchSize}`)
  console.log(`  Skip Wikidata: ${config.skipWikidata ? 'Yes' : 'No'}`)
  console.log()
}

function setupOutputDirectory(config: ImportConfig): Effect.Effect<void, Error, never> {
  return Effect.gen(function* () {
    yield* tryAsync(async () => await mkdir(config.outputDir, { recursive: true }))
  })
}

function extractWikidataIds(boundaries: OSMBoundary[]): string[] {
  return boundaries
    .map((b) => b.tags?.['wikidata'])
    .filter((id): id is string => id !== undefined)
    .map((id) => id.replace('http://www.wikidata.org/entity/', '').replace('Q', ''))
}

function fetchWikidataCategoriesIfNeeded(
  boundaries: OSMBoundary[],
  skip: boolean,
): Effect.Effect<Map<string, string>, Error, never> {
  return Effect.gen(function* () {
    if (skip) {
      return new Map()
    }

    logSection('Step 2: Extracting Wikidata IDs from OSM data')

    const wikidataIds = extractWikidataIds(boundaries)
    console.log(`Found ${wikidataIds.length} unique Wikidata IDs in OSM data`)

    logSection('Step 3: Fetching Commons categories from Wikidata')
    const categories = yield* fetchWikimediaCategoriesBatch(wikidataIds)

    if (categories.size === 0) {
      console.warn('No Commons categories fetched. Continuing without Wikidata data.')
    }

    return categories
  })
}

function saveTransformedData(
  boundaries: AdminBoundaryImport[],
  config: ImportConfig,
): Effect.Effect<void, Error, never> {
  return Effect.gen(function* () {
    const filename = config.countryCode || 'global'
    const outputPath = join(config.outputDir, `transformed-${filename}.json`)
    yield* tryAsync(
      async () => await Bun.write(outputPath, JSON.stringify(boundaries, null, 2)),
      'Failed to write transformed data',
    )
    console.log(`Saved transformed data to ${outputPath}`)
  })
}

function displaySummary(
  stats: ImportStats,
  osmCount: number,
  wikidataCount: number,
  transformedCount: number,
): void {
  console.log()
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                      Import Summary                        ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log(`OSM boundaries fetched:    ${osmCount}`)
  console.log(`Wikidata IDs found:       ${wikidataCount}`)
  console.log(`Matched records:          ${transformedCount}`)
  console.log(`Successfully inserted:     ${stats.insertedRecords}`)
  console.log(`Errors:                   ${stats.errors.length}`)
  console.log()
}

/**
 * Run the complete import pipeline
 */
export const runImport = (config: ImportConfig): Effect.Effect<void, Error, never> => {
  return Effect.gen(function* () {
    displayConfig(config)
    yield* setupOutputDirectory(config)

    logSection('Step 1: Fetching OSM boundary data')
    const osmBoundaries = yield* fetchOSMData(config)

    if (osmBoundaries.length === 0) {
      console.error('No OSM boundaries fetched. Aborting import.')
      return
    }

    const wikidataCategories = yield* fetchWikidataCategoriesIfNeeded(
      osmBoundaries,
      config.skipWikidata,
    )

    logSection('Step 4: Transforming and enriching data')
    const transformedBoundaries = transformBoundaries(osmBoundaries, wikidataCategories)

    if (transformedBoundaries.length === 0) {
      console.error('No transformed boundaries. Aborting import.')
      return
    }

    yield* saveTransformedData(transformedBoundaries, config)

    logSection('Step 5: Inserting data into database')
    const stats = yield* batchInsertBoundaries(transformedBoundaries, config.batchSize)

    displaySummary(
      stats,
      osmBoundaries.length,
      wikidataCategories.size,
      transformedBoundaries.length,
    )

    if (stats.errors.length > 0) {
      console.log('⚠️  Import completed with errors')
      return yield* Effect.fail(new Error('Import completed with errors'))
    } else {
      console.log('✅ Import completed successfully!')

      logSection('Step 6: Verifying import')
      yield* verifyImport()
    }
  })
}

export const runImportWithCleanup = (config: ImportConfig): Effect.Effect<void, Error> => {
  return runImport(config).pipe(
    Effect.ensuring(
      Effect.catchAll((error) => Effect.sync(() => console.error('Failed to close pool:', error)))(
        closePool(),
      ),
    ),
  )
}

/**
 * Main function for CLI execution
 */
export async function main() {
  const countryCode = Bun.env.COUNTRY_CODE
  const adminLevelsStr = Bun.env.ADMIN_LEVELS
  const config: ImportConfig = {
    countryCode,
    adminLevels: adminLevelsStr
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => !Number.isNaN(n)),
    batchSize: parseInt(Bun.env.BATCH_SIZE, 10),
    skipWikidata: Bun.env.SKIP_WIKIDATA === 'true',
    outputDir: Bun.env.OUTPUT_DIR,
  }

  await Effect.runPromise(runImportWithCleanup(config))
}

// Run if executed directly
if (import.meta.path === Bun.main) {
  main()
}
