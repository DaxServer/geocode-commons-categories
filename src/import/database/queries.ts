/**
 * Database query operations
 */

import { Effect } from 'effect'
// biome-ignore lint/style/useImportType: pg is used in type annotations
import pg from 'pg'
import { getPool } from '@/import/database/connection'
import { tryAsync } from '@/import/utils/effect-helpers'
import type { AdminBoundaryImport, ImportProgress } from '@/types/import.types'

const insertQuery = `
  INSERT INTO admin_boundaries (wikidata_id, commons_category, admin_level, name, geom)
  VALUES ($1, $2, $3, $4, ST_GeomFromEWKT($5))
  ON CONFLICT (wikidata_id) DO UPDATE
    SET commons_category = EXCLUDED.commons_category,
        admin_level = EXCLUDED.admin_level,
        name = EXCLUDED.name,
        geom = EXCLUDED.geom
`

export function insertBoundary(
  client: pg.PoolClient,
  boundary: AdminBoundaryImport,
): Effect.Effect<void, Error> {
  return tryAsync(async () => {
    await client.query(insertQuery, [
      boundary.wikidata_id,
      boundary.commons_category,
      boundary.admin_level,
      boundary.name,
      boundary.geom,
    ])
  }, `Error inserting ${boundary.name}`)
}

export function beginTransaction(client: pg.PoolClient): Effect.Effect<void, Error> {
  return tryAsync(async () => await client.query('BEGIN'), 'Failed to begin transaction')
}

export function commitTransaction(client: pg.PoolClient): Effect.Effect<void, Error> {
  return tryAsync(async () => await client.query('COMMIT'), 'Failed to commit transaction')
}

export function rollbackTransaction(client: pg.PoolClient): Effect.Effect<void, Error> {
  return tryAsync(async () => await client.query('ROLLBACK'), 'Failed to rollback transaction')
}

export function connectClient(pool: pg.Pool): Effect.Effect<pg.PoolClient, Error> {
  return tryAsync(async () => await pool.connect(), 'Failed to connect to database')
}

export function releaseClient(client: pg.PoolClient): Effect.Effect<void, never> {
  return Effect.sync(() => client.release())
}

/**
 * Query OSM relations from osm_relations table for Wikidata enrichment
 */
export const getOSMRelationsForWikidata = (
  countryCode?: string,
): Effect.Effect<
  Array<{ id: string; wikidata_id: string; admin_level: number; name: string; iso3: string }>,
  Error
> => {
  return Effect.gen(function* () {
    const pool = getPool()

    let query = `
      SELECT id, wikidata_id, admin_level, name, iso3
      FROM osm_relations
      WHERE wikidata_id IS NOT NULL
    `
    const params: (string | number)[] = []

    if (countryCode) {
      query += ' AND iso3 = $1'
      params.push(countryCode)
    }

    query += ' ORDER BY admin_level, name'

    const result = yield* tryAsync(
      async () => await pool.query(query, params),
      'Failed to query OSM relations',
    )

    return result.rows
  })
}

/**
 * Query full OSM relation data with geometry for transformation
 */
export const getOSMRelationsForTransform = (
  countryCode?: string,
): Effect.Effect<
  Array<{
    id: string
    wikidata_id: string | null
    admin_level: number
    name: string
    geom: string
    iso3: string
  }>,
  Error
> => {
  return Effect.gen(function* () {
    const pool = getPool()

    let query = `
      SELECT id, wikidata_id, admin_level, name, ST_AsEWKT(geom) as geom, iso3
      FROM osm_relations
      WHERE geom IS NOT NULL
    `
    const params: (string | number)[] = []

    if (countryCode) {
      query += ' AND iso3 = $1'
      params.push(countryCode)
    }

    query += ' ORDER BY admin_level, name'

    const result = yield* tryAsync(
      async () => await pool.query(query, params),
      'Failed to query OSM relations with geometry',
    )

    return result.rows
  })
}

/**
 * Progress tracking queries for import
 */

/**
 * Initialize progress tracking for a country
 */
export const initializeProgress = (countryCode: string): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    const pool = getPool()

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
    const pool = getPool()

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
export const getPendingCountries = (allCountryCodes: string[]): Effect.Effect<string[], Error> => {
  return Effect.gen(function* () {
    const pool = getPool()

    const result = yield* tryAsync(async () =>
      pool.query(
        `SELECT code
         FROM unnest($1::text[]) as code
         LEFT JOIN import_progress p ON p.country_code = code
         WHERE p.status IS NULL OR p.status != 'completed';`,
        [allCountryCodes],
      ),
    )

    return result.rows.map((row: { code: string }) => row.code)
  })
}

/**
 * Get import progress for all countries
 */
export const getAllProgress = (): Effect.Effect<ImportProgress[], Error> => {
  return Effect.gen(function* () {
    const pool = getPool()

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
  },
  Error
> => {
  return Effect.gen(function* () {
    const pool = getPool()

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

    return {
      totalRelations: parseInt(totalResult.rows[0].count as string, 10),
      byAdminLevel: levelResult.rows.map((row) => ({
        adminLevel: row.admin_level,
        count: parseInt(row.count as string, 10),
      })),
    }
  })
}
