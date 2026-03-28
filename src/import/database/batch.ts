/**
 * Batch processing with transaction management
 */

import { Effect } from 'effect'
import type { Pool, PoolClient } from 'pg'
import {
  beginTransaction,
  commitTransaction,
  connectClient,
  insertBoundary,
  releaseClient,
  rollbackTransaction,
} from '@/import/database/queries'
import type { AdminBoundaryImport } from '@/types/import.types'

export type BatchResult = {
  insertedRecords: number
  errors: Array<{ record: string; error: string }>
}

export function processBatchWithClient(
  client: PoolClient,
  batch: AdminBoundaryImport[],
  batchNum: number,
): Effect.Effect<BatchResult, Error> {
  return Effect.gen(function* () {
    const startTime = Date.now()
    console.log(`[Database] Batch ${batchNum}: Processing ${batch.length} boundaries`)

    const errors: Array<{ record: string; error: string }> = []
    let insertedRecords = 0

    yield* beginTransaction(client)

    for (const boundary of batch) {
      const insertResult = yield* Effect.either(insertBoundary(client, boundary))

      if (insertResult._tag === 'Right') {
        insertedRecords++
      } else {
        errors.push({
          record: boundary.name,
          error: insertResult.left.message,
        })
      }
    }

    yield* commitTransaction(client)

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(
      `[Database] Batch ${batchNum} committed: ${insertedRecords} inserted (${duration}s)`,
    )

    if (errors.length > 0) {
      console.warn(`[Database] Batch ${batchNum} had ${errors.length} errors`)
    }

    return { insertedRecords, errors }
  })
}

export function processBatch(
  pool: Pool,
  batch: AdminBoundaryImport[],
  batchNum: number,
): Effect.Effect<BatchResult, Error> {
  return Effect.gen(function* () {
    const client = yield* connectClient(pool)

    return yield* processBatchWithClient(client, batch, batchNum).pipe(
      Effect.tapError(() => Effect.catchAll(() => Effect.void)(rollbackTransaction(client))),
      Effect.ensuring(releaseClient(client)),
    )
  })
}
