import { DatabaseError, NotFoundError } from '@backend/types/errors'
import type { GeocodeResponse } from '@backend/types/geocode.types'
import { USER_AGENT, WIKIDATA_API_ENDPOINT } from '@backend/utils/constants'
import { Effect } from 'effect'
import { Pool } from 'pg'
import type { Logger } from 'pino'

const COMMONS_PREFIX = 'Category:'

type WikidataEntity = {
  missing?: string
  claims?: {
    P373?: Array<{ mainsnak: { datavalue?: { value: string } } }>
  }
  sitelinks?: {
    commonswiki?: { title: string }
  }
}

type WikidataApiResponse = {
  entities?: Record<string, WikidataEntity>
}

let nominatimPool: Pool

function getNominatimPool(): Pool {
  if (!nominatimPool) {
    nominatimPool = new Pool({ connectionString: Bun.env.NOMINATIM_DATABASE_URL })
  }
  return nominatimPool
}

export async function closeNominatimPool(): Promise<void> {
  await nominatimPool?.end()
}

function stripCategoryPrefix(category?: string | null): string | null {
  return category?.startsWith(COMMONS_PREFIX) ? category.slice(COMMONS_PREFIX.length) : null
}

const categoryCache = new Map<string, string | null>()
const CHUNK_SIZE = 50

async function fetchCommonsCategories(wikidataIds: string[], log: Logger): Promise<void> {
  // Check cache first and only fetch missing ids
  const missingIds = wikidataIds.filter((id) => !categoryCache.has(id))
  if (missingIds.length === 0) return

  // Process in chunks to avoid URL length limits and be respectful to the API
  for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
    const chunk = missingIds.slice(i, i + CHUNK_SIZE)
    const url = new URL(WIKIDATA_API_ENDPOINT)
    url.searchParams.set('action', 'wbgetentities')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('ids', chunk.join('|'))
    url.searchParams.set('props', 'claims|sitelinks')

    log.info({ ids: chunk.length }, 'Fetching Commons categories from Wikidata (batch)')
    const t0 = Date.now()
    const response = await fetch(url.toString(), { headers: { 'User-Agent': USER_AGENT } })
    if (!response.ok) {
      log.warn({ status: response.status, ids: chunk }, 'Wikidata API batch request failed')
      // Set all missing ids in this chunk to null in cache
      for (const id of chunk) {
        categoryCache.set(id, null)
      }
      continue
    }

    const data = (await response.json()) as WikidataApiResponse
    const entities = data.entities ?? {}

    for (const id of chunk) {
      const entity = entities[id]
      if (!entity || entity.missing !== undefined) {
        log.warn({ wikidataId: id }, 'Wikidata entity not found in batch')
        categoryCache.set(id, null)
      } else {
        const p373Value = entity.claims?.P373?.[0]?.mainsnak?.datavalue?.value
        if (p373Value) {
          log.debug({ wikidataId: id, commons: p373Value }, 'Resolved via P373 claim (batch)')
          categoryCache.set(id, p373Value)
        } else {
          const sitelink = entity.sitelinks?.commonswiki?.title
          const cat = stripCategoryPrefix(sitelink)
          if (cat) {
            log.debug({ wikidataId: id, commons: cat }, 'Resolved via Commons sitelink (batch)')
            categoryCache.set(id, cat)
          } else {
            log.warn({ wikidataId: id }, 'No Commons category found in batch')
            categoryCache.set(id, null)
          }
        }
      }
    }
    log.debug({ ids: chunk.length, ms: Date.now() - t0 }, 'Wikidata batch request complete')
  }
}

type PlacexRow = {
  wikidata_id: string
  commons_category: string | null
  admin_level: number | null
  name: string | null
}

export const reverseGeocode = (
  lat: number,
  lon: number,
  log: Logger,
): Effect.Effect<GeocodeResponse, NotFoundError | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const childLog = log.child({ lat, lon })
      const t0 = Date.now()
      // Fetch up to 10 smallest boundaries that contain the point
      const result = await getNominatimPool().query<PlacexRow>(
        `
        SELECT
          extratags->'wikidata' AS wikidata_id,
          extratags->'wikimedia_commons' AS commons_category,
          admin_level,
          name->'name' AS name
        FROM placex
        WHERE
          ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          AND extratags ? 'wikidata'
          AND (
            (class = 'boundary' AND type = 'administrative')
            OR class = 'place'
          )
          AND linked_place_id IS NULL
        ORDER BY ST_Area(geometry) ASC
        LIMIT 10
        `,
        [lon, lat],
      )
      childLog.debug(
        { ms: Date.now() - t0, rowCount: result.rows.length },
        'Nominatim query complete',
      )

      const rows = result.rows
      if (rows.length === 0) {
        childLog.info('No boundary found')
        throw new NotFoundError()
      }

      // Collect wikidata_ids that are not in cache
      const wikidataIdsToFetch: string[] = []
      for (const row of rows) {
        if (row.wikidata_id && !categoryCache.has(row.wikidata_id)) {
          wikidataIdsToFetch.push(row.wikidata_id)
        }
      }

      // Fetch missing categories in batch (chunked)
      if (wikidataIdsToFetch.length > 0) {
        await fetchCommonsCategories(wikidataIdsToFetch, childLog)
      }

      // Find the first row (smallest area) that has a commons category
      for (const row of rows) {
        if (!row.wikidata_id) continue
        const commonsCategory = categoryCache.get(row.wikidata_id)
        if (commonsCategory !== null && commonsCategory !== undefined) {
          childLog.info(
            { wikidata: row.wikidata_id, name: row.name, commons: commonsCategory },
            'Boundary matched',
          )
          return {
            admin_level: row.admin_level ?? 0,
            commons_cat: {
              title: commonsCategory,
              url: `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(commonsCategory)}`,
            },
            coords: { lat, lon },
            wikidata: row.wikidata_id,
            name: row.name,
          } satisfies GeocodeResponse
        }
      }

      childLog.info('No boundary with Commons category found')
      throw new NotFoundError()
    },
    catch: (error) => {
      if (error instanceof NotFoundError) return error
      return new DatabaseError('Nominatim query failed', error)
    },
  })
