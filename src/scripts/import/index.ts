/**
 * Main import orchestrator - coordinates the entire import pipeline
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportConfig } from '../../types/import.types'
import { batchValidateCommonsCategories } from '../utils/sparql'
import { fetchWikimediaCategoriesBatch } from '../utils/wikidata-api'
import { batchInsertBoundaries, verifyImport } from './database'
import { fetchOSMData } from './fetch-osm'
import { transformBoundaries } from './transform'

/**
 * Run the complete import pipeline
 */
export async function runImport(config: ImportConfig): Promise<void> {
  const { countryCode, skipWikidata, outputDir } = config

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║   Administrative Boundary Data Import System            ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log()
  console.log(`Configuration:`)
  console.log(`  Country: ${countryCode || 'Global (not yet supported)'}`)
  console.log(`  Admin levels: ${config.adminLevels?.join(', ') || 'All'}`)
  console.log(`  Batch size: ${config.batchSize || 1000}`)
  console.log(`  Skip Wikidata: ${skipWikidata ? 'Yes' : 'No'}`)
  console.log()

  // Create output directory if specified
  if (outputDir) {
    await mkdir(outputDir, { recursive: true })
  }

  try {
    // Step 1: Fetch OSM data
    console.log('\n▶ Step 1: Fetching OSM boundary data')
    console.log('━'.repeat(60))
    const osmBoundaries = await fetchOSMData(config)

    if (osmBoundaries.length === 0) {
      console.error('No OSM boundaries fetched. Aborting import.')
      return
    }

    // Step 2: Extract Wikidata IDs and fetch Commons categories
    let wikidataCategories: Map<string, string> = new Map()
    if (!skipWikidata) {
      console.log('\n▶ Step 2: Extracting Wikidata IDs from OSM data')
      console.log('━'.repeat(60))

      const wikidataIds = osmBoundaries
        .map((b) => b.tags?.['wikidata'])
        .filter((id): id is string => id !== undefined)
        .map((id) => id.replace('http://www.wikidata.org/entity/', '').replace('Q', ''))

      console.log(`Found ${wikidataIds.length} unique Wikidata IDs in OSM data`)

      console.log('\n▶ Step 3: Fetching Commons categories from Wikidata')
      console.log('━'.repeat(60))
      wikidataCategories = await fetchWikimediaCategoriesBatch(wikidataIds)

      if (wikidataCategories.size === 0) {
        console.warn('No Commons categories fetched. Continuing without Wikidata data.')
      }
    }

    // Step 4: Optionally validate Commons categories
    if (Bun.env.VALIDATE_COMMONS === 'true' && wikidataCategories.size > 0) {
      console.log('\n▶ Step 4: Validating Commons categories')
      console.log('━'.repeat(60))
      const categories = Array.from(wikidataCategories.values())
      const validCategories = await batchValidateCommonsCategories(categories)

      // Filter out invalid categories
      const filteredCategories = new Map<string, string>()
      for (const [wikidataId, category] of wikidataCategories.entries()) {
        if (validCategories.has(category)) {
          filteredCategories.set(wikidataId, category)
        }
      }

      console.log(
        `Validated: ${filteredCategories.size}/${wikidataCategories.size} categories exist`,
      )
      wikidataCategories = filteredCategories
    }

    // Step 5: Transform and enrich data
    console.log('\n▶ Step 5: Transforming and enriching data')
    console.log('━'.repeat(60))

    const transformedBoundaries = transformBoundaries(osmBoundaries, wikidataCategories)

    if (transformedBoundaries.length === 0) {
      console.error('No transformed boundaries. Aborting import.')
      return
    }

    // Save transformed data for debugging
    if (outputDir) {
      const filename = countryCode || 'global'
      const outputPath = join(outputDir, `transformed-${filename}.json`)
      await Bun.write(outputPath, JSON.stringify(transformedBoundaries, null, 2))
      console.log(`Saved transformed data to ${outputPath}`)
    }

    // Step 6: Insert into database
    console.log('\n▶ Step 6: Inserting data into database')
    console.log('━'.repeat(60))
    const stats = await batchInsertBoundaries(transformedBoundaries, config.batchSize)

    // Step 7: Verification
    if (stats.errors.length === 0) {
      console.log('\n▶ Step 7: Verifying import')
      console.log('━'.repeat(60))
      await verifyImport()
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════╗')
    console.log('║                      Import Summary                        ║')
    console.log('╚════════════════════════════════════════════════════════════╝')
    console.log(`OSM boundaries fetched:    ${osmBoundaries.length}`)
    console.log(`Wikidata IDs found:       ${wikidataCategories.size}`)
    console.log(`Matched records:          ${transformedBoundaries.length}`)
    console.log(`Successfully inserted:     ${stats.insertedRecords}`)
    console.log(`Errors:                   ${stats.errors.length}`)
    console.log()

    if (stats.errors.length > 0) {
      console.log('⚠️  Import completed with errors')
      process.exit(1)
    } else {
      console.log('✅ Import completed successfully!')
    }
  } catch (error) {
    console.error('\n❌ Import failed:', error)
    process.exit(1)
  }
}

/**
 * Main function for CLI execution
 */
export async function main() {
  // Parse command line arguments and environment variables
  const countryCode = Bun.env.COUNTRY_CODE
  const adminLevelsStr = Bun.env.ADMIN_LEVELS
  const batchSizeStr = Bun.env.BATCH_SIZE
  const skipWikidataStr = Bun.env.SKIP_WIKIDATA
  const outputDir = Bun.env.OUTPUT_DIR

  const config: ImportConfig = {
    countryCode,
    adminLevels: adminLevelsStr?.split(',').map(Number) || [],
    batchSize: batchSizeStr ? parseInt(batchSizeStr, 10) : undefined,
    skipWikidata: skipWikidataStr === 'true',
    outputDir,
  }

  await runImport(config)
}

// Run if executed directly
if (import.meta.path === Bun.main) {
  main()
}
