/**
 * Batch processing with transaction management
 */

import { Effect } from 'effect'
// biome-ignore lint/style/useImportType: pg is used in type annotations
import pg from 'pg'
import type { AdminBoundaryImport } from '@/types/import.types'
import {
  beginTransaction,
  commitTransaction,
  connectClient,
  insertBoundary,
  releaseClient,
  rollbackTransaction,
} from './queries'

export type BatchResult = {
  insertedRecords: number
  errors: Array<{ record: string; error: string }>
}

export function processBatchWithClient(
  client: pg.PoolClient,
  batch: AdminBoundaryImport[],
  batchNum: number,
): Effect.Effect<BatchResult, Error> {
  return Effect.gen(function* () {
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

    console.log(`Batch ${batchNum} committed: ${insertedRecords} total inserted`)

    return { insertedRecords, errors }
  })
}

export function processBatch(
  pool: pg.Pool,
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
