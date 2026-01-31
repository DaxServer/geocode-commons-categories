/**
 * Database schema operations for hierarchical import
 *
 * NOTE: Database schema is managed via migrations in the migrations/ directory.
 * The application assumes migrations have been run before importing.
 * Run migrations with: psql -d geocode -f migrations/002_hierarchical_import_schema.sql
 */

import { Effect } from 'effect'
import type { Pool } from 'pg'
import { getPool } from '@/scripts/import/database/connection'
import { tryAsync } from '@/scripts/utils/effect-helpers'

/**
 * Check if a country import is complete
 */
export const isCountryComplete = (countryCode: string): Effect.Effect<boolean, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const result = yield* tryAsync(async () =>
      pool.query('SELECT status FROM import_progress WHERE country_code = $1 AND status = $2;', [
        countryCode,
        'completed',
      ]),
    )

    return result.rows.length > 0
  })
}

/**
 * Get import progress for a country
 */
export const getImportProgress = (
  countryCode: string,
): Effect.Effect<
  {
    currentAdminLevel: number
    relationsFetched: number
    errors: number
  } | null,
  Error
> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const result = yield* tryAsync(async () =>
      pool.query(
        'SELECT current_admin_level, relations_fetched, errors FROM import_progress WHERE country_code = $1;',
        [countryCode],
      ),
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return {
      currentAdminLevel: row.current_admin_level,
      relationsFetched: row.relations_fetched,
      errors: row.errors,
    }
  })
}
