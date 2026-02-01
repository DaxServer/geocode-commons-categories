export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,
} as const

export const BATCH_SIZES = {
  WIKIDATA: 50,
  DATABASE: 1000,
  OVERPASS_GEOMETRY: 100,
} as const

export const DELAYS = {
  RATE_LIMIT_MS: 100,
  RETRY_EXPONENTIAL_BASE: 2,
  OVERPASS_GEOMETRY_MS: 250,
  COUNTRY_BATCH_MS: 5000,
} as const

export const IMPORT = {
  COUNTRY_BATCH_SIZE: 5,
  OVERPASS_TIMEOUT: 90,
} as const

/**
 * Get admin level range from environment variables
 */
export function getAdminLevelRange(): { min: number; max: number } {
  const min = parseInt(Bun.env.ADMIN_LEVEL_START, 10)
  const max = parseInt(Bun.env.ADMIN_LEVEL_END, 10)

  return { min, max }
}
