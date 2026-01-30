import { Effect } from 'effect'
import { Pool } from 'pg'
import { config } from '../config/env'
import { DatabaseError, NotFoundError } from '../types/errors'
import type { AdminBoundaryRow } from '../types/geocode.types'

let pool: Pool

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
    })
  }
  return pool
}

export const findAdminBoundary = (
  lat: number,
  lon: number,
): Effect.Effect<AdminBoundaryRow, NotFoundError | DatabaseError> => {
  return Effect.tryPromise({
    try: async () => {
      const pool = getPool()
      const point = `POINT(${lon} ${lat})`
      const result = await pool.query(
        `SELECT wikidata_id, commons_category, admin_level, name
         FROM admin_boundaries
         WHERE ST_Contains(geom, ST_GeomFromText($1, 4326))
         ORDER BY admin_level, ST_Area(geom) ASC
         LIMIT 1`,
        [point],
      )
      if (!result.rows[0]) {
        throw new NotFoundError('Location not found')
      }
      return result.rows[0]
    },
    catch: (error) => {
      if (error instanceof NotFoundError) {
        return error
      }
      return new DatabaseError('Database query failed', error)
    },
  })
}
