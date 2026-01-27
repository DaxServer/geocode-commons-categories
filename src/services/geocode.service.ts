import type { GeocodeResponse } from '../types/geocode.types'
import { findAdminBoundary } from './database.service'

export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResponse | null> {
  const boundary = await findAdminBoundary(lat, lon)
  if (!boundary) {
    return null
  }

  const result: GeocodeResponse = {
    admin_level: boundary.admin_level,
    commons_cat: {
      title: boundary.commons_category,
      url: `https://commons.wikimedia.org/wiki/Category:${boundary.commons_category}`,
    },
    coords: { lat, lon },
    wikidata: boundary.wikidata_id,
  }

  return result
}
