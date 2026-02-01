/**
 * Fetch relation IDs for import
 */

import { Effect } from 'effect'
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
    const relationMap = new Map<number, number[]>()

    // Level 2: Fetch by country tag
    console.log(`Fetching level 2 relations for ${iso3Code}...`)
    const level2Ids = yield* fetchCountryLevelRelations(iso3Code, 2)
    if (level2Ids.length > 0) {
      relationMap.set(2, level2Ids)
    }

    // Levels 3+: Fetch as children of previous level
    let parentRelations = level2Ids
    for (let level = 3; level <= maxLevel; level++) {
      console.log(`Fetching level ${level} relations for ${iso3Code}...`)

      const childIds: number[] = []

      // Fetch children for each parent relation at previous level
      for (const parentId of parentRelations) {
        const children = yield* fetchChildRelationIds(parentId, level)
        childIds.push(...children)
      }

      // Deduplicate child IDs (same child might be under multiple parents at borders)
      const uniqueChildIds = Array.from(new Set(childIds))

      if (uniqueChildIds.length === 0) {
        console.log(`No relations found at level ${level} for ${iso3Code}, skipping`)
        // Don't update parentRelations - continue using previous level's relations as search area
        continue
      }

      relationMap.set(level, uniqueChildIds)
      parentRelations = uniqueChildIds

      console.log(`Found ${uniqueChildIds.length} unique relations at level ${level}`)
    }

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
    }

    // Deduplicate
    const uniqueChildIds = Array.from(new Set(childIds))
    console.log(`Found ${uniqueChildIds.length} unique child relations at level ${adminLevel}`)

    return uniqueChildIds
  })
}
