/**
 * Batch insert administrative boundaries into PostGIS database
 */

import pg from 'pg'
import type { AdminBoundaryImport, ImportStats } from '../../types/import.types'

const { Pool } = pg

/**
 * Initialize database connection pool
 */
function getPool(): pg.Pool {
  return new Pool({
    connectionString: Bun.env.DATABASE_URL,
    max: 10, // Maximum number of clients in the pool
  })
}

/**
 * Batch insert boundaries using COPY command
 */
export async function batchInsertBoundaries(
  boundaries: AdminBoundaryImport[],
  batchSize = 1000,
): Promise<ImportStats> {
  const stats: ImportStats = {
    osmRecords: 0,
    wikidataRecords: boundaries.length,
    matchedRecords: boundaries.length,
    insertedRecords: 0,
    skippedRecords: 0,
    errors: [],
  }

  console.log('=== Inserting Boundaries into Database ===')
  console.log(`Total boundaries to insert: ${boundaries.length}`)
  console.log(`Batch size: ${batchSize}`)

  const pool = getPool()

  try {
    // Test connection
    await pool.query('SELECT 1')
    console.log('Database connection established')

    // Process in batches
    for (let i = 0; i < boundaries.length; i += batchSize) {
      const batch = boundaries.slice(i, i + batchSize)
      const batchNum = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(boundaries.length / batchSize)

      console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${batch.length} records)`)

      try {
        const client = await pool.connect()

        try {
          await client.query('BEGIN')

          // Actually, let's use parameterized INSERT for simplicity
          // It's slower but more reliable with the pg library
          await client.query('ROLLBACK') // Rollback the COPY attempt

          await client.query('BEGIN')

          const insertQuery = `
            INSERT INTO admin_boundaries (wikidata_id, commons_category, admin_level, name, geom)
            VALUES ($1, $2, $3, $4, ST_GeomFromEWKT($5))
            ON CONFLICT (wikidata_id) DO UPDATE
              SET commons_category = EXCLUDED.commons_category,
                  admin_level = EXCLUDED.admin_level,
                  name = EXCLUDED.name,
                  geom = EXCLUDED.geom
          `

          for (const boundary of batch) {
            try {
              await client.query(insertQuery, [
                boundary.wikidata_id,
                boundary.commons_category,
                boundary.admin_level,
                boundary.name,
                boundary.geom,
              ])
              stats.insertedRecords++
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error)
              console.error(`Error inserting ${boundary.name}:`, errorMessage)
              stats.errors.push({
                record: boundary.name,
                error: errorMessage,
              })
            }
          }

          await client.query('COMMIT')
          console.log(`Batch ${batchNum} committed: ${stats.insertedRecords} total inserted`)
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      } catch (error) {
        console.error(`Batch ${batchNum} failed:`, error)
        // Continue with next batch
      }
    }

    console.log(`\n=== Import Complete ===`)
    console.log(`Successfully inserted: ${stats.insertedRecords}`)
    console.log(`Errors: ${stats.errors.length}`)

    if (stats.errors.length > 0) {
      console.log('\nFirst 10 errors:')
      stats.errors.slice(0, 10).forEach(({ record, error }) => {
        console.log(`  - ${record}: ${error}`)
      })
    }
  } finally {
    await pool.end()
  }

  return stats
}

/**
 * Verify imported data
 */
export async function verifyImport(): Promise<void> {
  console.log('=== Verifying Import ===')

  const pool = getPool()

  try {
    // Count total records
    const countResult = await pool.query('SELECT COUNT(*) as count FROM admin_boundaries')
    console.log(`Total records in database: ${countResult.rows[0].count}`)

    // Count by admin_level
    const levelResult = await pool.query(`
      SELECT admin_level, COUNT(*) as count
      FROM admin_boundaries
      GROUP BY admin_level
      ORDER BY admin_level
    `)
    console.log('\nRecords by admin level:')
    levelResult.rows.forEach((row) => {
      console.log(`  Level ${row.admin_level}: ${row.count}`)
    })

    // Check for NULL critical fields
    const nullResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE wikidata_id IS NULL) as null_wikidata,
        COUNT(*) FILTER (WHERE commons_category IS NULL) as null_commons,
        COUNT(*) FILTER (WHERE name IS NULL) as null_name,
        COUNT(*) FILTER (WHERE geom IS NULL) as null_geom
      FROM admin_boundaries
    `)
    console.log('\nNULL field counts:')
    console.log(`  Wikidata ID: ${nullResult.rows[0].null_wikidata}`)
    console.log(`  Commons category: ${nullResult.rows[0].null_commons}`)
    console.log(`  Name: ${nullResult.rows[0].null_name}`)
    console.log(`  Geometry: ${nullResult.rows[0].null_geom}`)

    // Validate geometries
    const invalidGeomResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM admin_boundaries
      WHERE ST_IsValid(geom) = false
    `)
    console.log(`\nInvalid geometries: ${invalidGeomResult.rows[0].count}`)
  } finally {
    await pool.end()
  }
}

/**
 * Main function for standalone execution
 */
export async function main() {
  const inputFile = Bun.env.INPUT_FILE

  if (!inputFile) {
    console.error('INPUT_FILE environment variable is required')
    process.exit(1)
  }

  try {
    // Read transformed data from file
    const file = Bun.file(inputFile)
    const boundaries = (await file.json()) as AdminBoundaryImport[]

    const stats = await batchInsertBoundaries(boundaries)

    if (stats.errors.length === 0) {
      await verifyImport()
    }
  } catch (error) {
    console.error('Import failed:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.path === Bun.main) {
  await main()
}
