import { Pool } from 'pg'
import { config } from '../config/env'
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

export async function findAdminBoundary(
  lat: number,
  lon: number,
): Promise<AdminBoundaryRow | null> {
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

  return result.rows[0] || null
}
