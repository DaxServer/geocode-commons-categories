/**
 * Import verification queries
 */

import { Effect } from 'effect'
import type { QueryResult } from 'pg'
import { tryAsync } from '../../utils/effect-helpers'
import { getPool } from './connection'

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
    console.log('=== Verifying Import ===')

    const pool = getPool()

    const countResult = yield* tryAsync(
      async () => await pool.query('SELECT COUNT(*) as count FROM admin_boundaries'),
      'Failed to count records',
    )
    console.log(`Total records in database: ${(countResult.rows[0] as CountRow).count}`)

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
    console.log('\nRecords by admin level:')
    ;(levelResult as QueryResult<AdminLevelRow>).rows.forEach((row) => {
      console.log(`  Level ${row.admin_level}: ${row.count}`)
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
    console.log('\nNULL field counts:')
    const nullFields = nullResult.rows[0] as NullFieldsRow
    console.log(`  Wikidata ID: ${nullFields.null_wikidata}`)
    console.log(`  Commons category: ${nullFields.null_commons}`)
    console.log(`  Name: ${nullFields.null_name}`)
    console.log(`  Geometry: ${nullFields.null_geom}`)

    const invalidGeomResult = yield* tryAsync(
      async () =>
        await pool.query(`
          SELECT COUNT(*) as count
          FROM admin_boundaries
          WHERE ST_IsValid(geom) = false
        `),
      'Failed to check geometries',
    )
    console.log(`\nInvalid geometries: ${(invalidGeomResult.rows[0] as CountRow).count}`)
  })
}
