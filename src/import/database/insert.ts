/**
 * Database insert operations for import
 */

import { Effect } from 'effect'
import type { Pool } from 'pg'
import { getPool } from '@/import/database/connection'
import { tryAsync } from '@/import/utils/effect-helpers'
import type { OSMRelation } from '@/types/import.types'

/**
 * Insert a single OSM relation
 */
export const insertRelation = (relation: OSMRelation): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    yield* tryAsync(async () =>
      pool.query(
        `INSERT INTO osm_relations (relation_id, country_code, admin_level, name, wikidata_id, geometry, tags)
         VALUES ($1, $2, $3, $4, $5, ST_MakeValid(ST_GeomFromText($6, 4326))::geometry(Geometry, 4326), $7)
         ON CONFLICT (relation_id, country_code) DO UPDATE SET
           admin_level = EXCLUDED.admin_level,
           name = EXCLUDED.name,
           wikidata_id = EXCLUDED.wikidata_id,
           geometry = EXCLUDED.geometry,
           tags = EXCLUDED.tags,
           fetched_at = NOW();`,
        [
          relation.relationId,
          relation.countryCode,
          relation.adminLevel,
          relation.name,
          relation.wikidataId,
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
            `INSERT INTO osm_relations (relation_id, country_code, admin_level, name, wikidata_id, geometry, tags)
             VALUES ($1, $2, $3, $4, $5, ST_MakeValid(ST_GeomFromText($6, 4326))::geometry(Geometry, 4326), $7)
             ON CONFLICT (relation_id, country_code) DO UPDATE SET
               admin_level = EXCLUDED.admin_level,
               name = EXCLUDED.name,
               wikidata_id = EXCLUDED.wikidata_id,
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
