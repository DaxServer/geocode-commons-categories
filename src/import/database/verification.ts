/**
 * Import verification queries
 */

import { Effect } from 'effect'
import type { QueryResult } from 'pg'
import { getPool } from '@/import/database/connection'
import { tryAsync } from '@/import/utils/effect-helpers'

type CountRow = { count: string }
type AdminLevelRow = { admin_level: string; count: string }
type NullFieldsRow = {
  null_wikidata: string
  null_commons: string
  null_name: string
  null_geom: string
}

export const verifyImport = (): Effect.Effect<void, Error, never> => {
  return Effect.gen(function* () {
    console.log('[Database] Verifying import')

    const pool = getPool()

    const countResult = yield* tryAsync(
      async () => await pool.query('SELECT COUNT(*) as count FROM admin_boundaries'),
      'Failed to count records',
    )
    console.log(`[Database] Total records: ${(countResult.rows[0] as CountRow).count}`)

    const levelResult = yield* tryAsync(
      async () =>
        await pool.query(`
          SELECT admin_level, COUNT(*) as count
          FROM admin_boundaries
          GROUP BY admin_level
          ORDER BY admin_level
        `),
      'Failed to count by level',
    )
    console.log('[Database] Records by admin level:')
    ;(levelResult as QueryResult<AdminLevelRow>).rows.forEach((row) => {
      console.log(`[Database]   Level ${row.admin_level}: ${row.count}`)
    })

    const nullResult = yield* tryAsync(
      async () =>
        await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE wikidata_id IS NULL) as null_wikidata,
            COUNT(*) FILTER (WHERE commons_category IS NULL) as null_commons,
            COUNT(*) FILTER (WHERE name IS NULL) as null_name,
            COUNT(*) FILTER (WHERE geom IS NULL) as null_geom
          FROM admin_boundaries
        `),
      'Failed to check NULL fields',
    )
    console.log('[Database] NULL field counts:')
    const nullFields = nullResult.rows[0] as NullFieldsRow
    console.log(`[Database]   Wikidata ID: ${nullFields.null_wikidata}`)
    console.log(`[Database]   Commons category: ${nullFields.null_commons}`)
    console.log(`[Database]   Name: ${nullFields.null_name}`)
    console.log(`[Database]   Geometry: ${nullFields.null_geom}`)

    const invalidGeomResult = yield* tryAsync(
      async () =>
        await pool.query(`
          SELECT COUNT(*) as count
          FROM admin_boundaries
          WHERE ST_IsValid(geom) = false
        `),
      'Failed to check geometries',
    )
    console.log(`[Database] Invalid geometries: ${(invalidGeomResult.rows[0] as CountRow).count}`)
  })
}
