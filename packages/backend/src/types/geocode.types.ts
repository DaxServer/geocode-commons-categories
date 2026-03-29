import { t } from 'elysia'

export const coordinateSchema = t.Object({
  lat: t.Number(),
  lon: t.Number(),
})

export type Coordinate = typeof coordinateSchema.static

// Reusable shared schemas
const commonsCategorySchema = t.Object({
  title: t.String(),
  url: t.String(),
})

const coordsSchema = t.Object({
  lat: t.Number(),
  lon: t.Number(),
})

// Helper for diff field comparisons (ours vs theirs with match flag)
const diffFieldSchema = <T extends ReturnType<typeof t.String | typeof t.Number>>(valueSchema: T) =>
  t.Object({
    ours: t.Nullable(valueSchema),
    theirs: t.Nullable(valueSchema),
    match: t.Boolean(),
  })

export const geocodeResponseSchema = t.Object({
  admin_level: t.Number(),
  commons_cat: commonsCategorySchema,
  coords: coordsSchema,
  wikidata: t.String(),
  name: t.Nullable(t.String()),
})

export type GeocodeResponse = typeof geocodeResponseSchema.static

export type AdminBoundaryRow = {
  wikidata_id: string
  commons_category: string
  admin_level: number
  name: string
}

export const edwardBettsResponseSchema = t.Object({
  admin_level: t.Number(),
  commons_cat: commonsCategorySchema,
  coords: coordsSchema,
  wikidata: t.String(),
})

export type EdwardBettsResponse = typeof edwardBettsResponseSchema.static

export const geocodeCompareSchema = t.Object({
  ours: t.Nullable(geocodeResponseSchema),
  edwardBetts: t.Nullable(edwardBettsResponseSchema),
  diff: t.Object({
    wikidata: diffFieldSchema(t.String()),
    commons: diffFieldSchema(t.String()),
    admin_level: diffFieldSchema(t.Number()),
  }),
})

export type GeocodeCompareResponse = typeof geocodeCompareSchema.static
