import { Effect } from 'effect'
import { Pool } from 'pg'
import type { Logger } from 'pino'
import { config } from '@/config/env'
import { USER_AGENT, WIKIDATA_API_ENDPOINT } from '@/import/constants'
import { DatabaseError, NotFoundError } from '@/types/errors'
import type { GeocodeResponse } from '@/types/geocode.types'

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
    nominatimPool = new Pool({ connectionString: config.nominatimDatabaseUrl })
  }
  return nominatimPool
}

function stripCategoryPrefix(category?: string | null): string | null {
  return category?.startsWith(COMMONS_PREFIX) ? category.slice(COMMONS_PREFIX.length) : null
}

const categoryCache = new Map<string, string | null>()

async function fetchCommonsCategory(wikidataId: string, log: Logger): Promise<string | null> {
  if (categoryCache.has(wikidataId)) {
    log.debug({ wikidataId }, 'Wikidata cache hit')
    return categoryCache.get(wikidataId) ?? null
  }

  log.info({ wikidataId }, 'Fetching Commons category from Wikidata')

  const url = new URL(WIKIDATA_API_ENDPOINT)
  url.searchParams.set('action', 'wbgetentities')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  url.searchParams.set('ids', wikidataId)
  url.searchParams.set('props', 'claims|sitelinks')

  const response = await fetch(url.toString(), { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) {
    log.warn({ wikidataId, status: response.status }, 'Wikidata API request failed')
    categoryCache.set(wikidataId, null)
    return null
  }

  const data = (await response.json()) as WikidataApiResponse
  const entity = data.entities?.[wikidataId]
  if (!entity || entity.missing !== undefined) {
    log.warn({ wikidataId }, 'Wikidata entity not found')
    categoryCache.set(wikidataId, null)
    return null
  }

  const p373Value = entity.claims?.P373?.[0]?.mainsnak?.datavalue?.value
  if (p373Value) {
    log.debug({ wikidataId, commons: p373Value }, 'Resolved via P373 claim')
    categoryCache.set(wikidataId, p373Value)
    return p373Value
  }

  const sitelink = entity.sitelinks?.commonswiki?.title
  const cat = stripCategoryPrefix(sitelink)
  if (cat) {
    log.debug({ wikidataId, commons: cat }, 'Resolved via Commons sitelink')
  } else {
    log.warn({ wikidataId }, 'No Commons category found')
  }
  categoryCache.set(wikidataId, cat)

  return cat
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
      const result = await getNominatimPool().query<PlacexRow>(
        `SELECT
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
        LIMIT 1`,
        [lon, lat],
      )
      childLog.debug({ ms: Date.now() - t0 }, 'Nominatim query complete')

      const row = result.rows[0]
      if (!row) {
        childLog.info('No boundary found')
        throw new NotFoundError()
      }

      childLog.info({ wikidata: row.wikidata_id, name: row.name }, 'Boundary matched')

      const rawCommons = stripCategoryPrefix(row.commons_category)
      const commonsCategory = rawCommons ?? (await fetchCommonsCategory(row.wikidata_id, childLog))
      if (!commonsCategory) {
        childLog.info({ wikidata: row.wikidata_id }, 'No Commons category resolved')
        throw new NotFoundError()
      }

      return {
        admin_level: row.admin_level ?? 0,
        commons_cat: {
          title: commonsCategory,
          url: `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(commonsCategory)}`,
        },
        coords: { lat, lon },
        wikidata: row.wikidata_id,
      } satisfies GeocodeResponse
    },
    catch: (error) => {
      if (error instanceof NotFoundError) return error
      return new DatabaseError('Nominatim query failed', error)
    },
  })
