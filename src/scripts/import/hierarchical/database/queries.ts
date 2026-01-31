/**
 * Progress tracking queries for hierarchical import
 */

import { Effect } from 'effect'
import type { Pool } from 'pg'
import { getPool } from '@/scripts/import/database/connection'
import { tryAsync } from '@/scripts/utils/effect-helpers'
import type { ImportProgress } from '@/types/import.types'

/**
 * Initialize progress tracking for a country
 */
export const initializeProgress = (countryCode: string): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    yield* tryAsync(async () =>
      pool.query(
        `INSERT INTO import_progress (country_code, current_admin_level, status, relations_fetched, errors, started_at)
         VALUES ($1, 2, 'in_progress', 0, 0, NOW())
         ON CONFLICT (country_code) DO UPDATE SET
           status = 'in_progress',
           current_admin_level = 2,
           started_at = NOW(),
           completed_at = NULL;`,
        [countryCode],
      ),
    )

    console.log(`Initialized progress tracking for ${countryCode}`)
  })
}

/**
 * Update progress for a country
 */
export const updateProgress = (
  countryCode: string,
  updates: {
    currentAdminLevel?: number
    relationsFetched?: number
    errors?: number
    status?: 'in_progress' | 'completed' | 'failed'
    lastError?: string
  },
): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const setClauses: string[] = []
    const values: (string | number)[] = []
    let paramIndex = 1

    if (updates.currentAdminLevel !== undefined) {
      setClauses.push(`current_admin_level = $${paramIndex++}`)
      values.push(updates.currentAdminLevel)
    }
    if (updates.relationsFetched !== undefined) {
      setClauses.push(`relations_fetched = $${paramIndex++}`)
      values.push(updates.relationsFetched)
    }
    if (updates.errors !== undefined) {
      setClauses.push(`errors = $${paramIndex++}`)
      values.push(updates.errors)
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`)
      values.push(updates.status)
    }
    if (updates.lastError !== undefined) {
      setClauses.push(`last_error = $${paramIndex++}`)
      values.push(updates.lastError)
    }

    if (updates.status === 'completed') {
      setClauses.push(`completed_at = NOW()`)
    }

    values.push(countryCode)

    yield* tryAsync(async () =>
      pool.query(
        `UPDATE import_progress SET ${setClauses.join(', ')} WHERE country_code = $${paramIndex};`,
        values,
      ),
    )
  })
}

/**
 * Mark country import as completed
 */
export const markCompleted = (countryCode: string): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    yield* updateProgress(countryCode, { status: 'completed' })
    console.log(`Marked ${countryCode} as completed`)
  })
}

/**
 * Mark country import as failed
 */
export const markFailed = (countryCode: string, error: string): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    yield* updateProgress(countryCode, { status: 'failed', lastError: error })
    console.error(`Marked ${countryCode} as failed: ${error}`)
  })
}

/**
 * Get all pending or incomplete countries
 */
export const getPendingCountries = (): Effect.Effect<string[], Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const result = yield* tryAsync(async () =>
      pool.query(
        `SELECT country_code FROM import_progress WHERE status != 'completed'
         UNION
         SELECT $1::text AS country_code
         WHERE NOT EXISTS (SELECT 1 FROM import_progress WHERE country_code = $1);`,
        ['XXX'], // Dummy value for UNION - we'll filter this out
      ),
    )

    return result.rows
      .map((row: { country_code: string }) => row.country_code)
      .filter((code: string) => code !== 'XXX')
  })
}

/**
 * Get import progress for all countries
 */
export const getAllProgress = (): Effect.Effect<ImportProgress[], Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const result = yield* tryAsync(async () =>
      pool.query('SELECT * FROM import_progress ORDER BY country_code;'),
    )

    return result.rows.map(
      (row): ImportProgress => ({
        countryCode: row.country_code,
        currentAdminLevel: row.current_admin_level,
        status: row.status as 'pending' | 'in_progress' | 'completed' | 'failed',
        relationsFetched: row.relations_fetched,
        errors: row.errors,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        lastError: row.last_error,
      }),
    )
  })
}

/**
 * Get statistics for a country
 */
export const getCountryStats = (
  countryCode: string,
): Effect.Effect<
  {
    totalRelations: number
    byAdminLevel: Array<{ adminLevel: number; count: number }>
    parentLinks: number
    orphans: number
  },
  Error
> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    const totalResult = yield* tryAsync(async () =>
      pool.query('SELECT COUNT(*) as count FROM osm_relations WHERE country_code = $1;', [
        countryCode,
      ]),
    )

    const levelResult = yield* tryAsync(async () =>
      pool.query(
        `SELECT admin_level, COUNT(*) as count FROM osm_relations
         WHERE country_code = $1 GROUP BY admin_level ORDER BY admin_level;`,
        [countryCode],
      ),
    )

    const parentResult = yield* tryAsync(async () =>
      pool.query(
        `SELECT COUNT(*) as count FROM osm_relations
         WHERE country_code = $1 AND parent_relation_id IS NOT NULL;`,
        [countryCode],
      ),
    )

    const orphanResult = yield* tryAsync(async () =>
      pool.query(
        `SELECT COUNT(*) as count FROM osm_relations
         WHERE country_code = $1 AND admin_level > 2 AND parent_relation_id IS NULL;`,
        [countryCode],
      ),
    )

    return {
      totalRelations: parseInt(totalResult.rows[0].count as string, 10),
      byAdminLevel: levelResult.rows.map((row) => ({
        adminLevel: row.admin_level,
        count: parseInt(row.count as string, 10),
      })),
      parentLinks: parseInt(parentResult.rows[0].count as string, 10),
      orphans: parseInt(orphanResult.rows[0].count as string, 10),
    }
  })
}
