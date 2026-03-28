/**
 * Fetch relation IDs for import
 */

import { Effect } from 'effect'
import { DELAYS } from '@/import/constants'
import { fetchChildRelationIds, fetchCountryLevelRelations } from '@/import/utils/overpass-import'

/**
 * Fetch all relation IDs for a country at all admin levels
 * Returns a map of admin_level -> relation_ids[]
 */
export function fetchAllRelationIds(
  iso3Code: string,
  maxLevel: number,
): Effect.Effect<Map<number, number[]>, Error> {
  return Effect.gen(function* () {
    const startTime = Date.now()
    const relationMap = new Map<number, number[]>()

    // Level 2: Fetch by country tag
    console.log(`[OverpassAPI] Fetching level 2 relations for ${iso3Code}...`)
    const level2Ids = yield* fetchCountryLevelRelations(iso3Code, 2)
    if (level2Ids.length > 0) {
      relationMap.set(2, level2Ids)
    }

    // Levels 3+: Fetch as children of previous level
    let parentRelations = level2Ids
    for (let level = 3; level <= maxLevel; level++) {
      const levelStartTime = Date.now()
      console.log(`[OverpassAPI] Fetching level ${level} relations for ${iso3Code}...`)

      const childIds: number[] = []

      // Fetch children for each parent relation at previous level
      for (const parentId of parentRelations) {
        const children = yield* fetchChildRelationIds(parentId, level)
        childIds.push(...children)

        // Rate limiting between Overpass API calls
        // Relation ID queries are lightweight but still need delays to avoid rate limits
        const delaySeconds = DELAYS.OVERPASS_RELATION_MS / 1000
        console.log(`[RateLimiter] Waiting ${delaySeconds}s before next relation query`)
        yield* Effect.sleep(`${DELAYS.OVERPASS_RELATION_MS} millis`)
        console.log(`[RateLimiter] Wait complete, resuming`)
      }

      // Deduplicate child IDs (same child might be under multiple parents at borders)
      const uniqueChildIds = Array.from(new Set(childIds))

      if (uniqueChildIds.length === 0) {
        const duration = ((Date.now() - levelStartTime) / 1000).toFixed(1)
        console.log(
          `[OverpassAPI] No relations found at level ${level} for ${iso3Code} (${duration}s)`,
        )
        // Don't update parentRelations - continue using previous level's relations as search area
        continue
      }

      relationMap.set(level, uniqueChildIds)
      parentRelations = uniqueChildIds

      const duration = ((Date.now() - levelStartTime) / 1000).toFixed(1)
      console.log(
        `[OverpassAPI] Found ${uniqueChildIds.length} unique relations at level ${level} (${duration}s)`,
      )
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(
      `[OverpassAPI] Completed fetching all relation IDs for ${iso3Code} (${totalDuration}s)`,
    )

    return relationMap
  })
}

/**
 * Fetch relation IDs for a specific admin level only
 */
export function fetchRelationIdsForLevel(
  iso3Code: string,
  adminLevel: number,
  parentRelationIds?: number[],
): Effect.Effect<number[], Error> {
  return Effect.gen(function* () {
    if (adminLevel === 2) {
      // Level 2: Fetch by country tag
      return yield* fetchCountryLevelRelations(iso3Code, 2)
    }

    // Level 3+: Fetch as children of parent relations
    if (!parentRelationIds || parentRelationIds.length === 0) {
      console.warn(`No parent relations provided for level ${adminLevel}`)
      return []
    }

    const childIds: number[] = []

    for (const parentId of parentRelationIds) {
      const children = yield* fetchChildRelationIds(parentId, adminLevel)
      childIds.push(...children)

      // Rate limiting between Overpass API calls
      const delaySeconds = DELAYS.OVERPASS_RELATION_MS / 1000
      console.log(`[RateLimiter] Waiting ${delaySeconds}s before next relation query`)
      yield* Effect.sleep(`${DELAYS.OVERPASS_RELATION_MS} millis`)
      console.log(`[RateLimiter] Wait complete, resuming`)
    }

    // Deduplicate
    const uniqueChildIds = Array.from(new Set(childIds))
    console.log(`Found ${uniqueChildIds.length} unique child relations at level ${adminLevel}`)

    return uniqueChildIds
  })
}
