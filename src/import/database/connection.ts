/**
 * Database connection pool management
 */

import type { Effect } from 'effect'
import pg from 'pg'
import { tryAsync } from '@/import/utils/effect-helpers'

const { Pool } = pg

let poolInstance: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: Bun.env.DATABASE_URL,
      max: 10,
    })
  }
  return poolInstance
}

export const closePool = (): Effect.Effect<void, Error> => {
  return tryAsync(async () => {
    if (poolInstance) {
      await poolInstance.end()
      poolInstance = null
    }
  }, 'Failed to close pool')
}

export const testConnection = (): Effect.Effect<void, Error> => {
  return tryAsync(async () => {
    const pool = getPool()
    await pool.query('SELECT 1')
  }, 'Database connection failed')
}
