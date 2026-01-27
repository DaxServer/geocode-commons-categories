import { t } from 'elysia'

export const coordinateSchema = t.Object({
  lat: t.Number(),
  lon: t.Number(),
})

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

export interface GeocodeResponse {
  admin_level: number
  commons_cat: {
    title: string
    url: string
  }
  coords: {
    lat: number
    lon: number
  }
  wikidata: string
}

export interface AdminBoundaryRow {
  wikidata_id: string
  commons_category: string
  admin_level: number
  name: string
}
