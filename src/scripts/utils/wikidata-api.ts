/**
 * Wikidata REST API client for fetching Commons categories
 */

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
export async function fetchWikimediaCategoriesBatch(
  wikidataIds: string[],
  batchSize = 50,
): Promise<Map<string, string>> {
  const categoryMap = new Map<string, string>()
  const uniqueIds = [...new Set(wikidataIds)].filter((id) => id && id.length > 0)

  console.log(`Fetching Commons categories for ${uniqueIds.length} unique Wikidata IDs...`)

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(uniqueIds.length / batchSize)

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} IDs)...`)

    try {
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
        console.error(
          `Failed to fetch batch ${batchNum}: ${response.status} ${response.statusText}`,
        )
        continue
      }

      const data = (await response.json()) as WikidataApiResponse

      if (!data.entities) {
        console.warn(`No entities in batch ${batchNum} response`)
        continue
      }

      for (const [id, entity] of Object.entries(data.entities)) {
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

      console.log(`Batch ${batchNum} complete: ${categoryMap.size} categories fetched so far`)
    } catch (error) {
      console.error(`Error processing batch ${batchNum}:`, error)
    }

    // Rate limiting delay between batches
    if (i + batchSize < uniqueIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  console.log(`Total Commons categories fetched: ${categoryMap.size}/${uniqueIds.length}`)

  return categoryMap
}
