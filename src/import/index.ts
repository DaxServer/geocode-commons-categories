/**
 * Main import orchestrator - coordinates the entire import pipeline
 */

import { join } from 'node:path'
import { Effect } from 'effect'
import { getAdminLevelRange } from '@/import/constants'
import { batchInsertBoundaries } from '@/import/database'
import { closePool } from '@/import/database/connection'
import { getOSMRelationsForTransform, getOSMRelationsForWikidata } from '@/import/database/queries'
import { verifyImport } from '@/import/database/verification'
import { importSingleCountry } from '@/import/import'
import { transformDatabaseRows } from '@/import/transform'
import { tryAsync } from '@/import/utils/effect-helpers'
import { logSection } from '@/import/utils/logging'
import { fetchWikimediaCategoriesBatch } from '@/import/utils/wikidata-api'
import type { AdminBoundaryImport, ImportConfig, ImportStats } from '@/types/import.types'

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

function extractWikidataIds(rows: Array<{ wikidata_id: string | null }>): string[] {
  return rows
    .map((r) => r.wikidata_id)
    .filter((id): id is string => id !== undefined && id !== null)
}

function fetchWikidataCategoriesIfNeeded(
  countryCode: string | undefined,
  skip: boolean,
): Effect.Effect<Map<string, string>, Error, never> {
  return Effect.gen(function* () {
    if (skip) {
      return new Map()
    }

    logSection('Step 2: Extracting Wikidata IDs from OSM relations')

    const rows = yield* getOSMRelationsForWikidata(countryCode)
    console.log(`Found ${rows.length} OSM relations with Wikidata IDs`)

    const wikidataIds = extractWikidataIds(rows)
    console.log(`Extracted ${wikidataIds.length} unique Wikidata IDs`)

    if (wikidataIds.length === 0) {
      console.warn('No Wikidata IDs found in OSM relations')
      return new Map()
    }

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
    if (!config.outputDir) {
      console.log('Skipping save (no output directory configured)')
      return
    }
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
  console.log(`OSM relations imported:    ${osmCount}`)
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

    const adminLevelRange = getAdminLevelRange()
    const countryCode = config.countryCode

    if (!countryCode) {
      console.error('COUNTRY_CODE environment variable is required')
      return
    }

    // Step 1: Run import to fetch OSM data
    logSection('Step 1: Fetching OSM data')
    yield* importSingleCountry(countryCode, adminLevelRange)

    // Step 2 & 3: Fetch Wikidata categories
    const wikidataCategories = yield* fetchWikidataCategoriesIfNeeded(
      countryCode,
      config.skipWikidata,
    )

    // Step 4: Get OSM relations from database and transform
    logSection('Step 4: Transforming and enriching data')
    const osmRelations = yield* getOSMRelationsForTransform(countryCode)

    if (osmRelations.length === 0) {
      console.error('No OSM relations found in database. Aborting import.')
      return
    }

    console.log(`Found ${osmRelations.length} OSM relations in database`)

    const transformedBoundaries = transformDatabaseRows(osmRelations, wikidataCategories)

    if (transformedBoundaries.length === 0) {
      console.error('No transformed boundaries. Aborting import.')
      return
    }

    yield* saveTransformedData(transformedBoundaries, config)

    // Step 5: Insert to admin_boundaries table
    logSection('Step 5: Inserting data into admin_boundaries table')
    const stats = yield* batchInsertBoundaries(transformedBoundaries, config.batchSize)

    displaySummary(
      stats,
      osmRelations.length,
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
