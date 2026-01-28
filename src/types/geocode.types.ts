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
})

export type GeocodeResponse = typeof geocodeResponseSchema.static

export type AdminBoundaryRow = {
  wikidata_id: string
  commons_category: string
  admin_level: number
  name: string
}
