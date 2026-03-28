/**
 * Database import operations - orchestrates batch insertion
 */

import { Effect } from 'effect'
import { BATCH_SIZES } from '@/import/constants'
import { processBatch } from '@/import/database/batch'
import { closePool, getPool, testConnection } from '@/import/database/connection'
import { verifyImport } from '@/import/database/verification'
import { processInBatches } from '@/import/utils/batch'
import { tryAsync } from '@/import/utils/effect-helpers'
import type { AdminBoundaryImport, ImportStats } from '@/types/import.types'

export const batchInsertBoundaries = (
  boundaries: AdminBoundaryImport[],
  batchSize: number = BATCH_SIZES.DATABASE,
): Effect.Effect<ImportStats, Error> => {
  return Effect.gen(function* () {
    const startTime = Date.now()
    const stats: ImportStats = {
      osmRecords: 0,
      wikidataRecords: boundaries.length,
      matchedRecords: boundaries.length,
      insertedRecords: 0,
      skippedRecords: 0,
      errors: [],
    }

    console.log('[Database] Inserting boundaries into database')
    console.log(`[Database] Total boundaries: ${boundaries.length}, batch size: ${batchSize}`)

    yield* testConnection()
    console.log('[Database] Connection established')

    const batchResults = yield* processInBatches(
      boundaries,
      batchSize,
      (batch, batchNum) =>
        processBatch(getPool(), batch, batchNum).pipe(
          Effect.map((result) => ({ success: true, result })),
          Effect.catchAll((error) => {
            console.error(`[Database] Batch ${batchNum} failed:`, error)
            return Effect.succeed({ success: false, error })
          }),
        ),
      {
        onProgress: (batchNum, totalBatches) =>
          console.log(`[Database] Processing batch ${batchNum}/${totalBatches}`),
      },
    )

    for (const batchResult of batchResults) {
      if ('result' in batchResult) {
        stats.insertedRecords += batchResult.result.insertedRecords
        stats.errors.push(...batchResult.result.errors)
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[Database] Insert complete: ${stats.insertedRecords} inserted (${duration}s)`)
    console.log(`[Database] Errors: ${stats.errors.length}`)

    if (stats.errors.length > 0) {
      console.log('[Database] First 10 errors:')
      stats.errors.slice(0, 10).forEach(({ record, error }) => {
        console.log(`[Database]   - ${record}: ${error}`)
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
