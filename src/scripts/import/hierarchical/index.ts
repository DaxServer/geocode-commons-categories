/**
 * Hierarchical administrative boundary import system
 * Recursively fetches all admin levels (2-11) for all countries
 */

import { Effect } from 'effect'
import { batchInsertRelations } from '@/database/insert.ts'
import { DELAYS, getAdminLevelRange, HIERARCHICAL_IMPORT } from '@/scripts/constants'
import { batchCountryCodes, getSortedCountryCodes } from '@/scripts/utils/country-codes.ts'
import {
  getCountryStats,
  initializeProgress,
  markCompleted,
  markFailed,
  updateProgress,
} from './database/queries.ts'
import { fetchAllGeometry } from './fetch-geometry.ts'
import { fetchAllRelationIds } from './fetch-relations.ts'
import { storeRelationsWithParents } from './parent-linking.ts'

/**
 * Import all administrative levels for a single country
 */
function importCountry(
  iso3Code: string,
  adminLevelRange: { min: number; max: number },
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    console.log(`\n=== Starting import for ${iso3Code} ===`)

    // Initialize progress tracking
    yield* initializeProgress(iso3Code)

    // Fetch all relation IDs by level
    const relationMap = yield* fetchAllRelationIds(iso3Code, adminLevelRange.max)

    if (relationMap.size === 0) {
      console.warn(`No relations found for ${iso3Code}`)
      yield* markFailed(iso3Code, 'No relations found')
      return
    }

    let totalRelationsInserted = 0

    // Process each admin level
    for (let level = adminLevelRange.min; level <= adminLevelRange.max; level++) {
      const relationIds = relationMap.get(level)

      if (!relationIds || relationIds.length === 0) {
        console.log(`No relations at level ${level} for ${iso3Code}, skipping`)
        continue
      }

      console.log(
        `\n--- Processing ${iso3Code} level ${level} (${relationIds.length} relations) ---`,
      )

      // Fetch geometry for all relations at this level
      const parsedGeometries = yield* fetchAllGeometry(relationIds)

      if (parsedGeometries.length === 0) {
        console.warn(`No geometries parsed for ${iso3Code} at level ${level}`)
        continue
      }

      // Convert to OSMRelation format
      const relations = yield* storeRelationsWithParents(parsedGeometries, iso3Code, level)

      // Insert to database
      const insertResult = yield* batchInsertRelations(relations)

      console.log(
        `Inserted ${insertResult.inserted} and updated ${insertResult.updated} relations for ${iso3Code} at level ${level}`,
      )

      totalRelationsInserted += insertResult.inserted + insertResult.updated

      // Update progress
      yield* updateProgress(iso3Code, {
        currentAdminLevel: level,
        relationsFetched: totalRelationsInserted,
      })
    }

    // Mark as completed
    yield* markCompleted(iso3Code)

    // Show final stats
    const stats = yield* getCountryStats(iso3Code)
    console.log(`\n=== Import complete for ${iso3Code} ===`)
    console.log(`Total relations: ${stats.totalRelations}`)
    console.log(`By admin level:`)
    for (const levelStat of stats.byAdminLevel) {
      console.log(`  Level ${levelStat.adminLevel}: ${levelStat.count}`)
    }
  })
}

/**
 * Import countries in batches with rate limiting
 */
function importCountriesBatch(
  countryCodes: string[],
  adminLevelRange: { min: number; max: number },
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    console.log(`\n=== Processing batch of ${countryCodes.length} countries ===`)

    // Import all countries in this batch in parallel
    yield* Effect.all(countryCodes.map((code) => importCountry(code, adminLevelRange)))

    console.log(`\n=== Batch complete ===`)
  })
}

/**
 * Main entry point: Import all 250 countries
 */
export const importAllCountries = (): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    console.log('=== Starting hierarchical import for all countries ===')

    const allCodes = getSortedCountryCodes()
    console.log(`Importing ${allCodes.length} countries...`)

    const adminLevelRange = getAdminLevelRange()
    console.log(`Admin level range: ${adminLevelRange.min} to ${adminLevelRange.max}`)

    // Process in batches
    const batches = batchCountryCodes(HIERARCHICAL_IMPORT.COUNTRY_BATCH_SIZE)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      if (!batch) break
      console.log(`\n### Processing batch ${i + 1}/${batches.length} ###`)

      yield* importCountriesBatch(batch, adminLevelRange)

      // Rate limiting between batches
      if (i < batches.length - 1) {
        console.log(`Waiting ${DELAYS.COUNTRY_BATCH_MS}ms before next batch...`)
        yield* Effect.sleep(`${DELAYS.COUNTRY_BATCH_MS} millis`)
      }
    }

    console.log('\n=== Hierarchical import complete for all countries ===')
  })
}

/**
 * Import a single country (for testing)
 */
export const importSingleCountry = (
  iso3Code: string,
  adminLevelRange: { min: number; max: number },
): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    console.log(`=== Starting single country import for ${iso3Code} ===`)

    yield* importCountry(iso3Code, adminLevelRange)

    console.log(`\n=== Single country import complete for ${iso3Code} ===`)
  })
}

// Run the import if this file is executed directly
if (import.meta.main) {
  const countryCode = Bun.env.COUNTRY_CODE
  const adminLevelRange = getAdminLevelRange()

  console.log(`Admin level range: ${adminLevelRange.min} to ${adminLevelRange.max}`)

  if (countryCode) {
    console.log(`Importing single country: ${countryCode}`)
    Effect.runPromise(importSingleCountry(countryCode, adminLevelRange))
  } else {
    console.log('Importing all countries...')
    Effect.runPromise(importAllCountries())
  }
}
