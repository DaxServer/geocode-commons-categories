/**
 * Wikidata REST API client for fetching Commons categories
 */

import { Effect } from 'effect'
import { BATCH_SIZES, DELAYS } from '../constants'
import { processInBatches } from './batch'
import { tryAsync } from './effect-helpers'

const WIKIDATA_API_ENDPOINT = 'https://www.wikidata.org/w/api.php'
const USER_AGENT =
  'Wikimedia Commons / User:DaxServer / geocode-commons-categories/1.0 (https://github.com/DaxServer/geocode-commons-categories)'

/**
 * Wikidata API entity response
 */
type WikidataEntity = {
  claims?: {
    P373?: Array<{
      mainsnak: {
        datavalue?: {
          value: string
        }
      }
    }>
  }
}

/**
 * Wikidata API response structure
 */
type WikidataApiResponse = {
  entities?: Record<string, WikidataEntity | { missing: string }>
}

/**
 * Fetch Commons categories for a batch of Wik IDs
 */
export const fetchWikimediaCategoriesBatch = (
  wikidataIds: string[],
  batchSize = BATCH_SIZES.WIKIDATA,
): Effect.Effect<Map<string, string>, Error> => {
  const uniqueIds = [...new Set(wikidataIds)].filter((id) => id && id.length > 0)

  return Effect.gen(function* () {
    console.log(`Fetching Commons categories for ${uniqueIds.length} unique Wikidata IDs...`)

    const batchResults = yield* processInBatches(
      uniqueIds,
      batchSize,
      (batch, batchNum) =>
        Effect.gen(function* () {
          const categoryMap = new Map<string, string>()

          const batchResult = yield* tryAsync(async () => {
            const url = new URL(WIKIDATA_API_ENDPOINT)
            url.searchParams.set('action', 'wbgetentities')
            url.searchParams.set('format', 'json')
            url.searchParams.set('formatversion', '2')
            url.searchParams.set('ids', batch.join('|'))

            const response = await fetch(url.toString(), {
              headers: {
                'User-Agent': USER_AGENT,
              },
            })

            if (!response.ok) {
              throw new Error(
                `Failed to fetch batch ${batchNum}: ${response.status} ${response.statusText}`,
              )
            }

            return (await response.json()) as WikidataApiResponse
          }).pipe(
            Effect.catchAll((error) => {
              console.error(`Error processing batch ${batchNum}:`, error)
              return Effect.succeed({ entities: {} })
            }),
          )

          if (!batchResult.entities) {
            console.warn(`No entities in batch ${batchNum} response`)
            return categoryMap
          }

          for (const [id, entity] of Object.entries(batchResult.entities)) {
            if ('missing' in entity) {
              console.debug(`Wikidata entity ${id} not found`)
              continue
            }

            const commonsClaim = entity.claims?.P373?.[0]
            const category = commonsClaim?.mainsnak?.datavalue?.value

            if (category) {
              categoryMap.set(id, category)
            } else {
              console.debug(`No Commons category (P373) for ${id}`)
            }
          }

          console.log(`Batch ${batchNum} complete: ${categoryMap.size} categories fetched`)
          return categoryMap
        }),
      {
        delayMs: DELAYS.RATE_LIMIT_MS,
        onProgress: (batchNum, totalBatches) =>
          console.log(`Processing batch ${batchNum}/${totalBatches}...`),
      },
    )

    const finalMap = new Map<string, string>()
    for (const map of batchResults) {
      for (const [key, value] of map) {
        finalMap.set(key, value)
      }
    }

    console.log(`Total Commons categories fetched: ${finalMap.size}/${uniqueIds.length}`)
    return finalMap
  })
}
