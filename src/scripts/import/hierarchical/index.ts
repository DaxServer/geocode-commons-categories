/**
 * Hierarchical administrative boundary import system
 * Recursively fetches all admin levels (2-11) for all countries
 */

import { Effect } from 'effect'
import { DELAYS, HIERARCHICAL_IMPORT } from '@/scripts/constants'
import { batchCountryCodes, getSortedCountryCodes } from '@/scripts/utils/taginfo'
import { batchInsertRelations } from './database/insert.ts'
import {
  getCountryStats,
  initializeProgress,
  markCompleted,
  markFailed,
  updateProgress,
} from './database/queries.ts'
import { fetchAllGeometry } from './fetch-geometry.ts'
import { fetchAllRelationIds } from './fetch-relations.ts'
import { linkChildrenToParents, storeRelationsWithParents } from './parent-linking.ts'

/**
 * Import all administrative levels for a single country
 */
function importCountry(iso3Code: string): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    console.log(`\n=== Starting import for ${iso3Code} ===`)

    // Initialize progress tracking
    yield* initializeProgress(iso3Code)

    // Fetch all relation IDs by level
    const relationMap = yield* fetchAllRelationIds(iso3Code, HIERARCHICAL_IMPORT.MAX_ADMIN_LEVEL)

    if (relationMap.size === 0) {
      console.warn(`No relations found for ${iso3Code}`)
      yield* markFailed(iso3Code, 'No relations found')
      return
    }

    let totalRelationsInserted = 0

    // Process each admin level
    for (
      let level = HIERARCHICAL_IMPORT.MIN_ADMIN_LEVEL;
      level <= HIERARCHICAL_IMPORT.MAX_ADMIN_LEVEL;
      level++
    ) {
      const relationIds = relationMap.get(level)

      if (!relationIds || relationIds.length === 0) {
        console.log(`No relations at level ${level} for ${iso3Code}, stopping`)
        break
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

      // Insert to database (parent_relation_id is null initially)
      const insertResult = yield* batchInsertRelations(relations)

      console.log(
        `Inserted ${insertResult.inserted} and updated ${insertResult.updated} relations for ${iso3Code} at level ${level}`,
      )

      totalRelationsInserted += insertResult.inserted + insertResult.updated

      // Link to parent using spatial query (except for level 2 which has no parent)
      if (level > 2 && relationMap.has(level - 1)) {
        const linksCreated = yield* linkChildrenToParents(iso3Code, level, level - 1)
        console.log(`Created ${linksCreated} parent links for level ${level}`)
      }

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
    console.log(`Parent links: ${stats.parentLinks}`)
    console.log(`Orphans (level > 2 without parent): ${stats.orphans}`)
  })
}

/**
 * Import countries in batches with rate limiting
 */
function importCountriesBatch(countryCodes: string[]): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    console.log(`\n=== Processing batch of ${countryCodes.length} countries ===`)

    // Import all countries in this batch in parallel
    yield* Effect.all(countryCodes.map((code) => importCountry(code)))

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

    // Process in batches
    const batches = batchCountryCodes(HIERARCHICAL_IMPORT.COUNTRY_BATCH_SIZE)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      if (!batch) break
      console.log(`\n### Processing batch ${i + 1}/${batches.length} ###`)

      yield* importCountriesBatch(batch)

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
export const importSingleCountry = (iso3Code: string): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    console.log(`=== Starting single country import for ${iso3Code} ===`)

    yield* importCountry(iso3Code)

    console.log(`\n=== Single country import complete for ${iso3Code} ===`)
  })
}

// Run the import if this file is executed directly
if (import.meta.main) {
  const countryCode = Bun.env['COUNTRY_CODE']

  if (countryCode) {
    console.log(`Importing single country: ${countryCode}`)
    Effect.runPromise(importSingleCountry(countryCode))
  } else {
    console.log('Importing all countries...')
    Effect.runPromise(importAllCountries())
  }
}
