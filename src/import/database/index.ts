/**
 * Database import operations - orchestrates batch insertion
 */

import { Effect } from 'effect'
import { BATCH_SIZES } from '@/import/constants'
import { processBatch } from '@/import/database/batch'
import { closePool, getPool, testConnection } from '@/import/database/connection'
import { processInBatches } from '@/import/utils/batch'
import { tryAsync } from '@/import/utils/effect-helpers'
import type { AdminBoundaryImport, ImportStats } from '@/types/import.types'

export const batchInsertBoundaries = (
  boundaries: AdminBoundaryImport[],
  batchSize: number = BATCH_SIZES.DATABASE,
): Effect.Effect<ImportStats, Error> => {
  return Effect.gen(function* () {
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

    yield* testConnection()
    console.log('Database connection established')

    const batchResults = yield* processInBatches(
      boundaries,
      batchSize,
      (batch, batchNum) =>
        processBatch(getPool(), batch, batchNum).pipe(
          Effect.map((result) => ({ success: true, result })),
          Effect.catchAll((error) => {
            console.error(`Batch ${batchNum} failed:`, error)
            return Effect.succeed({ success: false, error })
          }),
        ),
      {
        onProgress: (batchNum, totalBatches) =>
          console.log(`\nProcessing batch ${batchNum}/${totalBatches}`),
      },
    )

    for (const batchResult of batchResults) {
      if ('result' in batchResult) {
        stats.insertedRecords += batchResult.result.insertedRecords
        stats.errors.push(...batchResult.result.errors)
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

    return stats
  })
}

/**
 * Main function for standalone execution
 */
export async function main() {
  const inputFile = Bun.env.INPUT_FILE

  const { verifyImport } = await import('./verification')

  const program = Effect.gen(function* () {
    const boundaries = yield* tryAsync(async () => {
      const file = Bun.file(inputFile)
      return (await file.json()) as AdminBoundaryImport[]
    }, 'Failed to read input file')

    const stats = yield* batchInsertBoundaries(boundaries)

    if (stats.errors.length === 0) {
      yield* verifyImport()
    }
  }).pipe(
    Effect.ensuring(
      Effect.catchAll((error) => Effect.sync(() => console.error('Failed to close pool:', error)))(
        closePool(),
      ),
    ),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error('Import failed:', error)
        process.exit(1)
      }),
    ),
  )

  await Effect.runPromise(program)
}

// Run if executed directly
if (import.meta.path === Bun.main) {
  await main()
}
