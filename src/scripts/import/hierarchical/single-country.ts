/**
 * Single country import script for testing
 * Usage: COUNTRY_CODE="BEL" bun run src/scripts/import/hierarchical/single-country.ts
 */

import { Effect } from 'effect'
import { importSingleCountry } from './index'

const countryCode = Bun.env['COUNTRY_CODE']

if (!countryCode) {
  console.error('Error: COUNTRY_CODE environment variable is required')
  console.error(
    'Usage: COUNTRY_CODE="BEL" bun run src/scripts/import/hierarchical/single-country.ts',
  )
  process.exit(1)
}

console.log(`Starting single country import for: ${countryCode}`)

Effect.runPromise(importSingleCountry(countryCode))
