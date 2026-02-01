import { Effect } from 'effect'

/**
 * Generic batch processor
 */
export function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[], batchNum: number) => Effect.Effect<R, Error>,
  options?: {
    delayMs?: number
    onProgress?: (batchNum: number, totalBatches: number) => void
  },
): Effect.Effect<R[], Error> {
  return Effect.gen(function* () {
    const results: R[] = []
    const totalBatches = Math.ceil(items.length / batchSize)

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const batchNum = Math.floor(i / batchSize) + 1

      if (options?.onProgress) {
        options.onProgress(batchNum, totalBatches)
      }

      const result = yield* processor(batch, batchNum)
      results.push(result)

      if (options?.delayMs && i + batchSize < items.length) {
        yield* Effect.sleep(`${options.delayMs} millis`)
      }
    }

    return results
  })
}
