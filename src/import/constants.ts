export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 5,
  BASE_DELAY_MS: 1000,
} as const

export const BATCH_SIZES = {
  WIKIDATA: 50,
  DATABASE: 1000,
  // Reduced batch size to prevent large query timeouts and reduce execution time
  // Smaller batches = faster execution = shorter cool down period
  OVERPASS_GEOMETRY: 25,
} as const

export const DELAYS = {
  RATE_LIMIT_MS: 100,
  RETRY_EXPONENTIAL_BASE: 2,
  // Overpass API requires longer delays: execution time + cool down time
  // Large geometry queries can take 5-10s, cool down can be 2-3x execution time
  OVERPASS_GEOMETRY_MS: 8000, // 8 seconds between geometry batches
  OVERPASS_RELATION_MS: 2000, // 2 seconds between relation ID fetches
  COUNTRY_BATCH_MS: 10000, // 10 seconds between country batches
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
