import { t } from 'elysia'

export const coordinateSchema = t.Object({
  lat: t.Number(),
  lon: t.Number(),
})

export type Coordinate = typeof coordinateSchema.static

export const geocodeResponseSchema = t.Object({
  admin_level: t.Number(),
  commons_cat: t.Object({
    title: t.String(),
    url: t.String(),
  }),
  coords: t.Object({
    lat: t.Number(),
    lon: t.Number(),
  }),
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
  commons_cat: t.Object({
    title: t.String(),
    url: t.String(),
  }),
  coords: t.Object({
    lat: t.Number(),
    lon: t.Number(),
  }),
  wikidata: t.String(),
})

export type EdwardBettsResponse = typeof edwardBettsResponseSchema.static

export const geocodeCompareSchema = t.Object({
  ours: t.Nullable(geocodeResponseSchema),
  edwardBetts: t.Nullable(edwardBettsResponseSchema),
  diff: t.Object({
    wikidata_match: t.Boolean(),
    commons_match: t.Boolean(),
    admin_level_match: t.Boolean(),
    wikidata: t.Object({
      ours: t.Nullable(t.String()),
      theirs: t.Nullable(t.String()),
    }),
    commons: t.Object({
      ours: t.Nullable(t.String()),
      theirs: t.Nullable(t.String()),
    }),
    admin_level: t.Object({
      ours: t.Nullable(t.Number()),
      theirs: t.Nullable(t.Number()),
    }),
  }),
})

export type GeocodeCompareResponse = typeof geocodeCompareSchema.static
