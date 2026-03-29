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
    P910?: Array<{
      mainsnak: { datavalue?: { value: { 'entity-type': string; 'numeric-id': number } } }
    }>
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

  // First pass: fetch entities and check for direct P373 or sitelink
  // Also collect entities that need P910 fallback
  const needsP910Fallback: Array<{ originalId: string; p910Id: string }> = []

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
    try {
      const response = await fetch(url.toString(), { headers: { 'User-Agent': USER_AGENT } })
      if (!response.ok) {
        log.warn({ status: response.status, ids: chunk }, 'Wikidata API batch request failed')
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
              // Check for P910 fallback
              const p910Value = entity.claims?.P910?.[0]?.mainsnak?.datavalue?.value
              if (p910Value) {
                const p910Id = `Q${p910Value['numeric-id']}`
                log.debug({ wikidataId: id, p910Id }, 'No direct category, trying P910 fallback')
                needsP910Fallback.push({ originalId: id, p910Id })
              } else {
                log.warn({ wikidataId: id }, 'No Commons category found in batch')
                categoryCache.set(id, null)
              }
            }
          }
        }
      }
      log.debug({ ids: chunk.length, ms: Date.now() - t0 }, 'Wikidata batch request complete')
    } catch (error) {
      log.warn({ error, ids: chunk }, 'Wikidata API network error')
      for (const id of chunk) {
        categoryCache.set(id, null)
      }
    }
  }

  // Second pass: fetch P910 entities and resolve their categories
  if (needsP910Fallback.length > 0) {
    const p910Ids = [...new Set(needsP910Fallback.map((x) => x.p910Id))]
    const p910Map = new Map<string, string[]>()
    for (const { originalId, p910Id } of needsP910Fallback) {
      const existing = p910Map.get(p910Id)
      if (existing) {
        existing.push(originalId)
      } else {
        p910Map.set(p910Id, [originalId])
      }
    }

    for (let i = 0; i < p910Ids.length; i += CHUNK_SIZE) {
      const chunk = p910Ids.slice(i, i + CHUNK_SIZE)
      const url = new URL(WIKIDATA_API_ENDPOINT)
      url.searchParams.set('action', 'wbgetentities')
      url.searchParams.set('format', 'json')
      url.searchParams.set('formatversion', '2')
      url.searchParams.set('ids', chunk.join('|'))
      url.searchParams.set('props', 'claims|sitelinks')

      log.info({ ids: chunk.length }, 'Fetching P910 fallback entities from Wikidata (batch)')
      try {
        const response = await fetch(url.toString(), { headers: { 'User-Agent': USER_AGENT } })
        if (!response.ok) {
          log.warn(
            { status: response.status, ids: chunk },
            'P910 Wikidata API batch request failed',
          )
          for (const p910Id of chunk) {
            for (const originalId of p910Map.get(p910Id) ?? []) {
              categoryCache.set(originalId, null)
            }
          }
          continue
        }

        const data = (await response.json()) as WikidataApiResponse
        const entities = data.entities ?? {}

        for (const p910Id of chunk) {
          const entity = entities[p910Id]
          let category: string | null = null
          if (entity && entity.missing === undefined) {
            const p373Value = entity.claims?.P373?.[0]?.mainsnak?.datavalue?.value
            if (p373Value) {
              category = p373Value
            } else {
              const sitelink = entity.sitelinks?.commonswiki?.title
              category = stripCategoryPrefix(sitelink)
            }
          }
          for (const originalId of p910Map.get(p910Id) ?? []) {
            if (category) {
              log.debug({ originalId, p910Id, commons: category }, 'Resolved via P910 fallback')
              categoryCache.set(originalId, category)
            } else {
              log.debug({ originalId, p910Id }, 'P910 fallback had no category')
              categoryCache.set(originalId, null)
            }
          }
        }
      } catch (error) {
        log.warn({ error, ids: chunk }, 'P910 Wikidata API network error')
        for (const p910Id of chunk) {
          for (const originalId of p910Map.get(p910Id) ?? []) {
            categoryCache.set(originalId, null)
          }
        }
      }
    }
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
          COALESCE(name->'name:en', name->'name') AS name
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
        if (commonsCategory) {
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
