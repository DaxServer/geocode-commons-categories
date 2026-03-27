/**
 * Database migration runner
 * Executes SQL migration files from the migrations directory
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Pool } from 'pg'
import { tryAsync } from '@/import/utils/effect-helpers'

/**
 * Run all migration files in order
 */
export const runMigrations = (): Effect.Effect<void, Error, never> => {
  return Effect.gen(function* () {
    const migrationsDir = join(process.cwd(), 'migrations')
    const databaseUrl = Bun.env.DATABASE_URL

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required')
    }

    const pool = new Pool({ connectionString: databaseUrl })

    try {
      const files = yield* tryAsync(
        async () => await readdir(migrationsDir),
        'Failed to read migrations directory',
      )

      // Filter and sort migration files
      const migrationFiles = files.filter((f) => f.endsWith('.sql')).sort()

      console.log(`Found ${migrationFiles.length} migration files`)

      for (const file of migrationFiles) {
        const filePath = join(migrationsDir, file)
        console.log(`Running migration: ${file}`)

        const sql = yield* tryAsync(
          async () => await Bun.file(filePath).text(),
          `Failed to read ${file}`,
        )

        yield* tryAsync(async () => {
          await pool.query(sql)
        }, `Failed to execute ${file}`)

        console.log(`✓ Completed: ${file}`)
      }

      console.log('All migrations completed successfully')
    } finally {
      yield* tryAsync(async () => await pool.end(), 'Failed to close database connection')
    }
  })
}

/**
 * Run migrations if NODE_ENV is production
 */
export async function runMigrationsIfNeeded(): Promise<void> {
  if (Bun.env.NODE_ENV === 'production') {
    console.log('NODE_ENV is production - running migrations...')
    try {
      await Effect.runPromise(runMigrations())
    } catch (error) {
      console.error('Migration failed:', error)
      throw error
    }
  }
}
