import { join } from 'node:path'
import { closeNominatimPool, reverseGeocode } from '@backend/services/nominatim.service'
import { NotFoundError } from '@backend/types/errors'
import {
  coordinateSchema,
  type EdwardBettsResponse,
  type GeocodeCompareResponse,
  geocodeCompareSchema,
  geocodeResponseSchema,
} from '@backend/types/geocode.types'
import { logger } from '@bogeychan/elysia-logger'
import { staticPlugin } from '@elysiajs/static'
import { Effect } from 'effect'
import { Elysia, t } from 'elysia'

const DASHBOARD_DIST = join(import.meta.dir, '../../dashboard/dist')

// Helper to run Effect and return null on any error
const runOrNull = async <A, E>(effect: Effect.Effect<A, E>): Promise<A | null> => {
  return await Effect.runPromise(Effect.catchAll(() => Effect.succeed(null))(effect))
}

export const app = new Elysia()
  .use(logger())
  .get(
    '/geocode',
    async ({ query, log }) => await Effect.runPromise(reverseGeocode(query.lat, query.lon, log)),
    {
      query: coordinateSchema,
      response: geocodeResponseSchema,
    },
  )
  .post(
    '/geocode',
    async ({ body, log }) => {
      const results = await Promise.all(
        body.map((coords) => runOrNull(reverseGeocode(coords.lat, coords.lon, log))),
      )
      return results.filter((r) => r !== null)
    },
    {
      body: t.Array(coordinateSchema),
      response: t.Array(geocodeResponseSchema),
    },
  )
  .get(
    '/geocode/compare',
    async ({ query, log }): Promise<GeocodeCompareResponse> => {
      const lat = query.lat
      const lon = query.lon

      const ourResult = await runOrNull(
        Effect.tapError((error) => {
          log.warn({ error }, 'Our geocode failed')
          return Effect.void
        })(reverseGeocode(lat, lon, log)),
      )

      const edwardBettsUrl = `https://edwardbetts.com/geocode/?lat=${lat}&lon=${lon}`
      let edwardBettsResult: EdwardBettsResponse | null = null
      try {
        const response = await fetch(edwardBettsUrl)
        if (response.ok) {
          edwardBettsResult = (await response.json()) as EdwardBettsResponse
        } else {
          log.warn({ status: response.status }, 'Edward Betts request failed')
        }
      } catch (error) {
        log.warn({ error }, 'Failed to fetch from Edward Betts')
      }

      const diff = {
        wikidata: {
          ours: ourResult?.wikidata ?? null,
          theirs: edwardBettsResult?.wikidata ?? null,
          match: ourResult?.wikidata === edwardBettsResult?.wikidata,
        },
        commons: {
          ours: ourResult?.commons_cat?.title ?? null,
          theirs: edwardBettsResult?.commons_cat?.title ?? null,
          match: ourResult?.commons_cat?.title === edwardBettsResult?.commons_cat?.title,
        },
        admin_level: {
          ours: ourResult?.admin_level ?? null,
          theirs: edwardBettsResult?.admin_level ?? null,
          match: ourResult?.admin_level === edwardBettsResult?.admin_level,
        },
      }

      return {
        ours: ourResult,
        edwardBetts: edwardBettsResult,
        diff,
      }
    },
    {
      query: coordinateSchema,
      response: geocodeCompareSchema,
    },
  )
  .use(staticPlugin({ assets: DASHBOARD_DIST, prefix: '/' }))
  .get('/*', ({ headers, set }) => {
    if (headers['accept']?.includes('text/html')) {
      return Bun.file(join(DASHBOARD_DIST, 'index.html'))
    }
    set.status = 404
    return { error: 'Not Found' }
  })
  .error({
    NOT_FOUND: NotFoundError,
  })
  .onError(({ code, error, set }) => {
    console.error('Request error', { code, error })
    if (code === 'NOT_FOUND') {
      set.status = 404
      return { error: 'Location not found' }
    }
    set.status = 500
    return { error: 'Internal server error' }
  })
  .listen(3000, ({ hostname, port }) => {
    console.log(`🦊 Elysia is running at http://${hostname}:${port}`)
  })

export type App = typeof app

let forceExitTimer: ReturnType<typeof setTimeout> | null = null

const shutdown = async (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`)

  forceExitTimer = setTimeout(() => {
    console.error('Forced exit after timeout')
    process.exit(1)
  }, 10000)

  await closeNominatimPool()
  await app.stop()

  if (forceExitTimer) {
    clearTimeout(forceExitTimer)
  }

  console.log('Shutdown complete')
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
