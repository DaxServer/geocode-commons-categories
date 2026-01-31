/**
 * Database schema operations for hierarchical import
 */

import { Effect } from 'effect'
import type { Pool } from 'pg'
import { getPool } from '@/scripts/import/database/connection'
import { tryAsync } from '@/scripts/utils/effect-helpers'

/**
 * Initialize the hierarchical import schema
 * This function ensures the tables exist before importing
 */
export const initializeSchema = (): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    yield* tryAsync(async () =>
      pool.query(`
        CREATE TABLE IF NOT EXISTS osm_relations (
          id SERIAL PRIMARY KEY,
          relation_id BIGINT NOT NULL,
          country_code VARCHAR(3) NOT NULL,
          admin_level INTEGER NOT NULL CHECK (admin_level BETWEEN 2 AND 11),
          name VARCHAR(255) NOT NULL,
          wikidata_id VARCHAR(20),
          parent_relation_id BIGINT,
          geometry GEOMETRY(Polygon, 4326),
          tags JSONB,
          fetched_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(relation_id, country_code)
        );
      `),
    )

    yield* tryAsync(async () =>
      pool.query(
        `CREATE INDEX IF NOT EXISTS idx_osm_relations_relation_id ON osm_relations(relation_id);`,
      ),
    )

    yield* tryAsync(async () =>
      pool.query(
        `CREATE INDEX IF NOT EXISTS idx_osm_relations_country_level ON osm_relations(country_code, admin_level);`,
      ),
    )

    yield* tryAsync(async () =>
      pool.query(
        `CREATE INDEX IF NOT EXISTS idx_osm_relations_parent ON osm_relations(parent_relation_id);`,
      ),
    )

    yield* tryAsync(async () =>
      pool.query(
        `CREATE INDEX IF NOT EXISTS idx_osm_relations_geom ON osm_relations USING GIST(geometry);`,
      ),
    )

    yield* tryAsync(async () =>
      pool.query(
        `CREATE INDEX IF NOT EXISTS idx_osm_relations_wikidata ON osm_relations(wikidata_id);`,
      ),
    )

    yield* tryAsync(async () =>
      pool.query(`
        CREATE TABLE IF NOT EXISTS import_progress (
          id SERIAL PRIMARY KEY,
          country_code VARCHAR(3) NOT NULL UNIQUE,
          current_admin_level INTEGER DEFAULT 2,
          status VARCHAR(20) NOT NULL,
          relations_fetched INTEGER DEFAULT 0,
          errors INTEGER DEFAULT 0,
          started_at TIMESTAMP DEFAULT NOW(),
          completed_at TIMESTAMP,
          last_error TEXT
        );
      `),
    )

    yield* tryAsync(async () =>
      pool.query(
        `CREATE INDEX IF NOT EXISTS idx_import_progress_status ON import_progress(status);`,
      ),
    )

    yield* tryAsync(async () =>
      pool.query(
        `CREATE INDEX IF NOT EXISTS idx_import_progress_country ON import_progress(country_code);`,
      ),
    )

    console.log('Hierarchical import schema initialized successfully')
  })
}

/**
 * Drop the hierarchical import schema (for cleanup/testing)
 */
export const dropSchema = (): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    const pool: Pool = getPool()

    yield* tryAsync(async () => pool.query('DROP TABLE IF EXISTS osm_relations CASCADE;'))
    yield* tryAsync(async () => pool.query('DROP TABLE IF EXISTS import_progress CASCADE;'))

    console.log('Hierarchical import schema dropped')
  })
}

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
