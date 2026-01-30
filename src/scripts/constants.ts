export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,
} as const

export const BATCH_SIZES = {
  WIKIDATA: 50,
  DATABASE: 1000,
} as const

export const DELAYS = {
  RATE_LIMIT_MS: 100,
  RETRY_EXPONENTIAL_BASE: 2,
} as const
