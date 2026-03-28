import { logger } from '@bogeychan/elysia-logger'
import { Effect } from 'effect'
import { Elysia, t } from 'elysia'
import { config } from '@/config/env'
import { runMigrationsIfNeeded } from '@/db/migrate'
import { reverseGeocode } from '@/services/nominatim.service'
import { NotFoundError } from '@/types/errors'
import { coordinateSchema, geocodeResponseSchema } from '@/types/geocode.types'

new Elysia()
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
      const results = []

      for (const coords of body) {
        const result = await Effect.runPromise(
          Effect.catchAll(() => Effect.succeed(null))(reverseGeocode(coords.lat, coords.lon, log)),
        )
        if (result) {
          results.push(result)
        }
      }

      return results
    },
    {
      body: t.Array(coordinateSchema),
      response: t.Array(geocodeResponseSchema),
    },
  )
  .error({
    NOT_FOUND: NotFoundError,
  })
  .onError(({ code, error }) => {
    console.error('Request error', { code, error })
    if (code === 'NOT_FOUND') {
      return new Response(JSON.stringify({ error: 'Location not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  .listen(config.port, async ({ hostname, port }) => {
    await runMigrationsIfNeeded()
    console.log(`🦊 Elysia is running at http://${hostname}:${port}`)
  })
