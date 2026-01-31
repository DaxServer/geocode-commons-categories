/**
 * Database insert operations for hierarchical import
 */

import { Effect } from 'effect'
import type { Pool } from 'pg'
import { getPool } from '@/scripts/import/database/connection'
import { tryAsync } from '@/scripts/utils/effect-helpers'
import type { OSMRelation } from '@/types/import.types'

/**
 * Insert a single OSM relation with parent linking
 */
export const insertRelation = (relation: OSMRelation): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    yield* tryAsync(async () =>
      pool.query(
        `INSERT INTO osm_relations (relation_id, country_code, admin_level, name, wikidata_id, parent_relation_id, geometry, tags)
         VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326), $8)
         ON CONFLICT (relation_id, country_code) DO UPDATE SET
           admin_level = EXCLUDED.admin_level,
           name = EXCLUDED.name,
           wikidata_id = EXCLUDED.wikidata_id,
           parent_relation_id = EXCLUDED.parent_relation_id,
           geometry = EXCLUDED.geometry,
           tags = EXCLUDED.tags,
           fetched_at = NOW();`,
        [
          relation.relationId,
          relation.countryCode,
          relation.adminLevel,
          relation.name,
          relation.wikidataId,
          relation.parentRelationId,
          relation.geometry,
          JSON.stringify(relation.tags),
        ],
      ),
    )
  })
}

/**
 * Batch insert multiple OSM relations
 */
export const batchInsertRelations = (
  relations: OSMRelation[],
): Effect.Effect<{ inserted: number; updated: number }, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const client = yield* tryAsync(async () => pool.connect())

    try {
      yield* tryAsync(async () => client.query('BEGIN'))

      let inserted = 0
      let updated = 0

      for (const relation of relations) {
        const result = yield* tryAsync(async () =>
          client.query(
            `INSERT INTO osm_relations (relation_id, country_code, admin_level, name, wikidata_id, parent_relation_id, geometry, tags)
             VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326), $8)
             ON CONFLICT (relation_id, country_code) DO UPDATE SET
               admin_level = EXCLUDED.admin_level,
               name = EXCLUDED.name,
               wikidata_id = EXCLUDED.wikidata_id,
               parent_relation_id = EXCLUDED.parent_relation_id,
               geometry = EXCLUDED.geometry,
               tags = EXCLUDED.tags,
               fetched_at = NOW()
             RETURNING (xmax = 0) AS inserted;`,
            [
              relation.relationId,
              relation.countryCode,
              relation.adminLevel,
              relation.name,
              relation.wikidataId,
              relation.parentRelationId,
              relation.geometry,
              JSON.stringify(relation.tags),
            ],
          ),
        )

        if (result.rows[0].inserted) {
          inserted++
        } else {
          updated++
        }
      }

      yield* tryAsync(async () => client.query('COMMIT'))

      return { inserted, updated }
    } catch (error) {
      yield* tryAsync(async () => client.query('ROLLBACK'))
      throw error
    } finally {
      client.release()
    }
  })
}

/**
 * Update parent relation ID using PostGIS spatial query
 * Finds the parent that spatially contains the child
 */
export const updateParentsWithSpatialQuery = (
  countryCode: string,
  childLevel: number,
  parentLevel: number,
): Effect.Effect<number, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const result = yield* tryAsync(async () =>
      pool.query(
        `UPDATE osm_relations child
         SET parent_relation_id = parent.relation_id
         FROM osm_relations parent
         WHERE child.country_code = $1
           AND child.admin_level = $2
           AND parent.admin_level = $3
           AND parent.country_code = $1
           AND child.parent_relation_id IS NULL
           AND ST_Contains(parent.geometry, child.geometry)
         RETURNING child.relation_id;`,
        [countryCode, childLevel, parentLevel],
      ),
    )

    console.log(
      `Updated ${result.rows.length} parent links for ${countryCode} at level ${childLevel}`,
    )

    return result.rows.length
  })
}

/**
 * Find parent for a specific relation using spatial query
 */
export const findParentForRelation = (
  relationId: number,
  countryCode: string,
  parentLevel: number,
): Effect.Effect<number | null, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const result = yield* tryAsync(async () =>
      pool.query(
        `SELECT parent.relation_id
         FROM osm_relations parent, osm_relations child
         WHERE child.relation_id = $1
           AND child.country_code = $2
           AND parent.admin_level = $3
           AND parent.country_code = $2
           AND ST_Contains(parent.geometry, child.geometry)
         LIMIT 1;`,
        [relationId, countryCode, parentLevel],
      ),
    )

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0].relation_id as number
  })
}
