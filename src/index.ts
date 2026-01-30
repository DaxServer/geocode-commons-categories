import { Effect } from 'effect'
import { Elysia, t } from 'elysia'
import { config } from './config/env'
import { reverseGeocode } from './services/geocode.service'
import { NotFoundError } from './types/errors'
import { coordinateSchema, geocodeResponseSchema } from './types/geocode.types'

new Elysia()
  .get(
    '/geocode',
    async ({ query }) => await Effect.runPromise(reverseGeocode(query.lat, query.lon)),
    {
      query: coordinateSchema,
      response: geocodeResponseSchema,
    },
  )
  .post(
    '/geocode',
    async ({ body }) => {
      const results = []

      for (const coords of body) {
        const result = await Effect.runPromise(
          Effect.catchAll(() => Effect.succeed(null))(reverseGeocode(coords.lat, coords.lon)),
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
    console.error('Error:', error)
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
  .listen(config.port, ({ hostname, port }) => {
    console.log(`🦊 Elysia is running at http://${hostname}:${port}`)
  })
