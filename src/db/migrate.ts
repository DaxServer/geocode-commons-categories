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
 * Extract search_path from DATABASE_URL options parameter
 * Example: postgresql://user:pass@host/db?options=-c%20search_path%3Dschema1,schema2
 */
function extractSearchPath(databaseUrl: string): string | undefined {
  try {
    const url = new URL(databaseUrl)
    const options = url.searchParams.get('options')

    if (!options) {
      return undefined
    }

    // URL decode the options parameter
    const decodedOptions = decodeURIComponent(options)

    // Extract search_path value from "-c search_path=schema1,schema2"
    const match = decodedOptions.match(/-c\s+search_path=(\w+(?:,\w+)*)/)

    return match ? match[1] : undefined
  } catch {
    return undefined
  }
}

/**
 * Run all migration files in order
 */
export const runMigrations = (): Effect.Effect<void, Error, never> => {
  return Effect.gen(function* () {
    const migrationsDir = join(process.cwd(), 'migrations')
    const databaseUrl = Bun.env.DATABASE_URL

    if (!databaseUrl) {
      yield* Effect.fail(new Error('DATABASE_URL environment variable is required'))
    }

    // Extract search_path from DATABASE_URL
    const searchPath = extractSearchPath(databaseUrl)

    if (searchPath) {
      console.log(`Using search_path from DATABASE_URL: ${searchPath}`)
    } else {
      console.log('No search_path found in DATABASE_URL, using database default')
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

        let sql = yield* tryAsync(
          async () => await Bun.file(filePath).text(),
          `Failed to read ${file}`,
        )

        // Prepend SET search_path if found in DATABASE_URL
        if (searchPath) {
          sql = `SET search_path TO ${searchPath};\n\n${sql}`
        }

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
