import { Effect } from 'effect'
import type { DatabaseError, NotFoundError } from '../types/errors'
import type { GeocodeResponse } from '../types/geocode.types'
import { findAdminBoundary } from './database.service'

export const reverseGeocode = (
  lat: number,
  lon: number,
): Effect.Effect<GeocodeResponse, NotFoundError | DatabaseError> => {
  return Effect.map(findAdminBoundary(lat, lon), (boundary) => ({
    admin_level: boundary.admin_level,
    commons_cat: {
      title: boundary.commons_category,
      url: `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(boundary.commons_category)}`,
    },
    coords: { lat, lon },
    wikidata: boundary.wikidata_id,
  }))
}
