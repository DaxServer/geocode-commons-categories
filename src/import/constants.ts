export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 5,
  BASE_DELAY_MS: 1000,
  PENALTY_ENABLED: true,
  PENALTY_ONLY_ON_429: true,
} as const

export const BATCH_SIZES = {
  WIKIDATA: 50,
  DATABASE: 1000,
  // Smaller batches for faster individual request execution
  OVERPASS_GEOMETRY: 15,
} as const

export const DELAYS = {
  RATE_LIMIT_MS: 100,
  RETRY_EXPONENTIAL_BASE: 2,
  // Ultra-conservative delays to prevent any rate limiting
  OVERPASS_GEOMETRY_MS: 30000, // 30 seconds between geometry batches
  OVERPASS_RELATION_MS: 30000, // 30 seconds between relation ID fetches
  COUNTRY_BATCH_MS: 30000, // 30 seconds between country batches
  // Penalty cooldown when we do hit a rate limit
  RATE_LIMIT_PENALTY_MS: 120000, // 2 minutes cooldown after any 429
} as const

export const IMPORT = {
  COUNTRY_BATCH_SIZE: 5,
  OVERPASS_TIMEOUT: 90,
} as const

export const USER_AGENT =
  'Wikimedia Commons / User:DaxServer / geocode-commons-categories/1.0 (https://github.com/DaxServer/geocode-commons-categories)'

/**
 * Get admin level range from environment variables
 */
export function getAdminLevelRange(): { min: number; max: number } {
  const min = parseInt(Bun.env.ADMIN_LEVEL_START, 10)
  const max = parseInt(Bun.env.ADMIN_LEVEL_END, 10)

  return { min, max }
}
