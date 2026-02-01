# Data Import Guide

Complete walkthrough of the administrative boundary data import process.

## Table of Contents

- [Overview](#overview)
- [What Gets Imported](#what-gets-imported)
- [Import Commands](#import-commands)
- [Pipeline Stages](#pipeline-stages)
- [Prerequisites](#prerequisites)
- [Step-by-Step Process](#step-by-step-process)
- [Implementation Details](#implementation-details)
- [Common Issues](#common-issues)
- [Verification](#verification)

## Overview

The import system uses a **two-command approach**:

1. **`bun import`** - Fetch OSM data → `osm_relations` table
2. **`bun import:data`** - Full pipeline: OSM → Wikidata → `admin_boundaries` table

The system uses a **two-table architecture**:
- **`osm_relations`** - Raw OSM data with full geometries
- **`admin_boundaries`** - Enriched data with Wikimedia Commons categories for the API

## What Gets Imported

- Administrative boundaries (regions, provinces, municipalities)
- Wikidata IDs for each boundary (preserving "Q" prefix)
- Wikimedia Commons categories (P373 property)
- Full geometries for accurate spatial queries

## Import Commands

### Command 1: OSM-Only Import

```bash
# Set required environment variables
export COUNTRY_CODE=BEL
export ADMIN_LEVEL_START=4
export ADMIN_LEVEL_END=8
export DATABASE_URL=postgresql://geocode:geocode@localhost:5432/geocode

# Run OSM data fetch (populates osm_relations table)
bun import
```

**What it does:**
- Discovers relation IDs from Overpass API by admin level
- Fetches full geometries using hierarchical area queries
- Stores raw OSM data in `osm_relations` table
- No Wikidata enrichment

**When to use:**
- You want to populate `osm_relations` table only
- You're debugging the OSM fetch stage
- You want to separate OSM and Wikidata stages

### Command 2: Full Pipeline Import

```bash
# Set required environment variables
export COUNTRY_CODE=BEL
export DATABASE_URL=postgresql://geocode:geocode@localhost:5432/geocode

# Run complete import pipeline (includes OSM fetch + Wikidata enrichment)
bun import:data
```

**What it does:**
- Runs OSM fetch (same as `bun import`)
- Extracts Wikidata IDs from `osm_relations`
- Fetches Wikimedia Commons categories from Wikidata API
- Transforms and enriches data
- Inserts into `admin_boundaries` table
- Verifies import results

**When to use:**
- Normal production workflow
- You want complete enriched data in `admin_boundaries` table

## Pipeline Stages

The full pipeline (`bun import:data`) executes **6 stages**:

### Stage 1: Fetch OSM Data (→ osm_relations)

1. **Discover relation IDs** by querying Overpass API for each admin level
2. **Fetch child relations** within parent area using Overpass area queries
3. **Fetch full geometries** using `out geom;` query
4. **Store in osm_relations** table

**Key Implementation Details:**
- Uses `out ids;` for discovery (faster than fetching geometries)
- Uses `out geom;` for geometry fetch (full polygon data)
- Overpass area IDs: `3600000000 + relationId` for spatial queries
- Admin level skip logic: `continue` (not `break`) to preserve parent chain

**Console Output:**
```
=== Starting single country import for BEL ===
Fetching level 4 relations for BEL...
Found 50 unique relations at level 4
Fetched 50 geometries for BEL at level 4
Inserted 50 and updated 0 relations for BEL at level 4
```

### Stage 2: Extract Wikidata IDs

1. **Query osm_relations** table for `wikidata_id` values
2. **Filter NULL values** and extract unique IDs
3. **Return ID array** for Wikidata API batch processing

**Console Output:**
```
Step 2: Extracting Wikidata IDs from OSM relations
Found 3000 OSM relations with Wikidata IDs
Extracted 3000 unique Wikidata IDs
```

### Stage 3: Fetch Wikidata Categories

1. **Split IDs into batches** of 50 (Wikidata API limit)
2. **Fetch entity data** from Wikidata REST API (`wbgetentities` action)
3. **Extract P373 property** (Commons category) for each entity
4. **Build category map** (Wikidata ID → Category name)
5. **Apply rate limiting** (100ms delay between batches)

**Wikidata ID Format:**
- OSM tags: `wikidata="Q240"` - extract as-is (only strip URL prefix)
- Wikidata API: Query with "Q240" - receives category data
- **CRITICAL:** Always preserve "Q" prefix throughout pipeline

**Console Output:**
```
Step 3: Fetching Commons categories from Wikidata
Processing batch 1/60...
Batch 1 complete: 48 categories fetched
Total Commons categories fetched: 2950/3000
```

### Stage 4: Transform and Enrich

1. **Query osm_relations** with geometry data
2. **Merge OSM data** with Wikidata categories via `wikidata_id`
3. **Validate geometries** (check EWKT format and polygon structure)
4. **Remove duplicates** by `wikidata_id`
5. **Filter out records** without Commons categories

**Console Output:**
```
Step 4: Transforming and enriching data
Found 3000 OSM relations in database
=== Enriching Database Rows with Wikidata Data ===
Enriched: 2950 boundaries
Skipped: 50 rows (no wikidata_id or Commons category)
=== Validating Geometries ===
Valid geometries: 2950
=== Deduplicating Boundaries ===
Duplicates removed: 0
Unique boundaries: 2950
```

### Stage 5: Database Insert

1. **Split into batches** of 1000 records
2. **Open transaction** for each batch
3. **Insert records** with `ON CONFLICT (wikidata_id) DO UPDATE` for idempotency
4. **Commit or rollback** based on success/failure

**Console Output:**
```
Step 5: Inserting data into admin_boundaries table
=== Inserting Boundaries into Database ===
Processing batch 1/3
Batch 1 committed: 1000 total inserted
Successfully inserted: 2950
Errors: 0
```

### Stage 6: Verification

1. **Query total record count** in `admin_boundaries` table
2. **Group by admin_level** to verify distribution
3. **Validate geometries** with PostGIS functions
4. **Display summary statistics**

**Console Output:**
```
Step 6: Verifying import
=== Verifying Import ===
Total records in database: 2950

Records by admin level:
  Level 4: 50
  Level 6: 300
  Level 8: 2600

Invalid geometries: 0
✅ Import completed successfully!
```

## Prerequisites

### 1. Database Setup

```bash
# Start PostgreSQL with PostGIS
docker compose up -d postgres

# Run migration
docker compose exec postgres psql -U geocode -d geocode -f migrations/001_initial_schema.sql
```

### 2. Environment Variables

Create a `.env` file:

```bash
# Required
DATABASE_URL=postgresql://geocode:geocode@localhost:5432/geocode
COUNTRY_CODE=BEL  # ISO 3166-1 alpha-3 code

# Optional (defaults shown)
ADMIN_LEVEL_START=4  # Start admin level (default: 4)
ADMIN_LEVEL_END=11   # End admin level (default: 11)
```

### 3. Verify Database is Ready

```bash
docker compose exec postgres psql -U geocode -d geocode -c "SELECT 1;"
docker compose exec postgres psql -U geocode -d geocode -c "\d osm_relations"
docker compose exec postgres psql -U geocode -d geocode -c "\d admin_boundaries"
```

## Step-by-Step Process

### Option 1: Full Pipeline (Recommended)

```bash
# Set environment variables
export COUNTRY_CODE=BEL
export ADMIN_LEVEL_START=4
export ADMIN_LEVEL_END=8
export DATABASE_URL=postgresql://geocode:geocode@localhost:5432/geocode

# Run complete pipeline (OSM + Wikidata + Transform + Insert)
bun import:data
```

### Option 2: Separate OSM and Wikidata Stages

```bash
# Step 1: Fetch OSM data only
bun import

# Step 2: Manually run the rest of the pipeline
# (this is what bun import:data does internally)
```

## Implementation Details

### Progress Tracking

The import system includes comprehensive progress tracking for resumable imports:

**Progress Table Schema:**
| Column | Type | Description |
|--------|------|-------------|
| `country_code` | varchar(3) | ISO country code (unique) |
| `current_admin_level` | int | Current admin level being processed |
| `status` | varchar(20) | 'pending', 'in_progress', 'completed', 'failed' |
| `relations_fetched` | int | Number of relations fetched so far |
| `errors` | int | Number of errors encountered |
| `started_at` | timestamp | When import started |
| `completed_at` | timestamp | When import completed |
| `last_error` | text | Last error message |

**Progress Tracking Functions:**
- `initializeProgress(countryCode)` - Start tracking a new import
- `updateProgress(countryCode, updates)` - Update progress during import
- `markCompleted(countryCode)` - Mark import as successful
- `markFailed(countryCode, error)` - Mark import as failed with error
- `getPendingCountries(allCountryCodes)` - Get countries that need importing
- `getAllProgress()` - Get progress for all countries

This enables resumable imports if the process is interrupted.

### Batch Processing

The system processes data in multiple layers of batches for performance:

**Wikidata API Batching:**
- Batch size: 50 IDs per request (`BATCH_SIZES.WIKIDATA`)
- Delay: 100ms between batches (`DELAYS.RATE_LIMIT_MS`)
- Purpose: Comply with Wikidata API rate limits

**Database Insert Batching:**
- Batch size: 1000 records per transaction (`BATCH_SIZES.DATABASE`)
- Purpose: Balance transaction size with memory usage

**Overpass Geometry Batching:**
- Batch size: 100 relations per request (`BATCH_SIZES.OVERPASS_GEOMETRY`)
- Delay: 250ms between requests (`DELAYS.OVERPASS_GEOMETRY_MS`)
- Purpose: Avoid overwhelming Overpass API

**Country Batching (Multi-Country Import Only):**
- Batch size: 5 countries processed in parallel (`IMPORT.COUNTRY_BATCH_SIZE`)
- Delay: 5000ms between batches (`DELAYS.COUNTRY_BATCH_MS`)
- Purpose: Control parallel load when importing many countries

### Retry Logic with Exponential Backoff

API requests use exponential backoff for retries:

**Retry Configuration:**
- Max attempts: 3 (`RETRY_CONFIG.MAX_ATTEMPTS`)
- Base delay: 1000ms (`RETRY_CONFIG.BASE_DELAY_MS`)
- Exponential base: 2 (`RETRY_CONFIG.RETRY_EXPONENTIAL_BASE`)

**Retry Delays:**
- Attempt 1: 1000ms
- Attempt 2: 2000ms (1000 × 2)
- Attempt 3: 4000ms (1000 × 2²)

Applies to: Overpass API requests, Wikidata API requests, database connections

### Parallel Country Processing

When importing multiple countries (no `COUNTRY_CODE` set):
- Processes 5 countries in parallel using `Effect.all()`
- Uses progress tracking to skip already-completed countries
- 5-second delay between batches to control load

### Optional JSON Output

The import system can save intermediate results to JSON files:
- Set `OUTPUT_DIR` environment variable to enable
- Saves relation data with geometries to `.json` files
- Useful for debugging or data inspection

## Hierarchical Discovery

The import system discovers administrative boundaries hierarchically:

1. **Level 2 (Country):** Fetched by `ISO3166-1:alpha3` tag
2. **Level 3+ (Children):** Fetched as children within previous level's area using Overpass area queries

**Overpass Area ID Conversion:**
```typescript
// Convert relation ID to area ID for spatial search
const areaId = 3600000000 + relationId
```

**Note:** The hierarchical fetch uses parent areas to discover children, but `parent_id` is not stored in the database (removed in migration 003).

### Admin Level Skip Logic

When an admin level has no relations, use `continue` (not `break`):

```typescript
if (uniqueChildIds.length === 0) {
  console.log(`No relations found at level ${level}, skipping`)
  continue  // Preserves parentRelations for next level search
}
```

This preserves the parent chain for searching at the next admin level.

### Geometry Format

**EWKT (Extended Well-Known Text) format:**
- Prefix: `SRID=4326;`
- Example: `SRID=4326;POLYGON((4.35 50.85,4.36 50.85,4.36 50.86,4.35 50.86,4.35 50.85))`

**Complex Way Merging:**
- Overpass returns ways that must be merged into polygons
- Inner rings represent holes in the geometry
- Simplified to max 500 points per ring to avoid PostGIS limits

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `BATCH_SIZES.WIKIDATA` | 50 | Max IDs per Wikidata API request |
| `BATCH_SIZES.DATABASE` | 1000 | Records per database transaction |
| `BATCH_SIZES.OVERPASS_GEOMETRY` | 100 | Relations per geometry fetch |
| `DELAYS.RATE_LIMIT_MS` | 100 | Delay between Wikidata batches |
| `DELAYS.OVERPASS_GEOMETRY_MS` | 250 | Delay between Overpass geometry requests |
| `DELAYS.RETRY_EXPONENTIAL_BASE` | 2 | Exponential base for retry delays |
| `DELAYS.COUNTRY_BATCH_MS` | 5000 | Delay between country batches |
| `RETRY_CONFIG.MAX_ATTEMPTS` | 3 | Max retry attempts for API calls |
| `RETRY_CONFIG.BASE_DELAY_MS` | 1000 | Base delay for exponential backoff |
| `IMPORT.COUNTRY_BATCH_SIZE` | 5 | Countries per batch (for multi-country imports) |
| `IMPORT.OVERPASS_TIMEOUT` | 90 | Overpass query timeout (seconds) |

**Retry Formula:** `delay = BASE_DELAY_MS × RETRY_EXPONENTIAL_BASE^(attempt-1)`

## Common Issues

### Issue: OSM Import Timeout

**Symptoms:** `Error: Overpass API error: 504 Gateway Timeout`

**Solutions:**
- Reduce admin level range: `ADMIN_LEVEL_START=4 ADMIN_LEVEL_END=6`
- Import smaller countries first
- Check Overpass API status: https://overpass-api.de/

### Issue: No Commons Categories Found

**Symptoms:** `Total Commons categories fetched: 0/3000`

**Causes:**
- Wikidata IDs missing "Q" prefix (fixed in current version)
- Network connectivity issues
- Wikidata API rate limiting

**Solution:**
- Check Wikidata ID format in logs (should be "Q240", not "240")
- Verify internet connection
- Check for API error messages in console

### Issue: Invalid Geometries

**Symptoms:** `Invalid geometries: 50` in verification stage

**Causes:**
- Malformed EWKT format
- Polygon with less than 4 points
- Geometry simplification removed too many points

**Solution:**
- Geometries are automatically validated during transform stage
- Invalid geometries are skipped with warning logs
- Check console for specific geometry validation errors

## Verification

After import completes, verify with these queries:

### Check Record Counts

```sql
-- Check osm_relations (raw OSM data)
SELECT admin_level, COUNT(*)
FROM osm_relations
WHERE iso3 = 'BEL'
GROUP BY admin_level
ORDER BY admin_level;

-- Check admin_boundaries (enriched API data)
SELECT admin_level, COUNT(*)
FROM admin_boundaries
GROUP BY admin_level
ORDER BY admin_level;
```

### Check Data Quality

```sql
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN wikidata_id IS NULL THEN 1 END) as missing_wikidata,
  COUNT(CASE WHEN commons_category IS NULL THEN 1 END) as missing_category,
  COUNT(CASE WHEN name IS NULL THEN 1 END) as missing_name
FROM admin_boundaries;
```

### Test Reverse Geocoding

```bash
# Test known coordinates
curl "http://localhost:3000/geocode?lat=50.8503&lon=4.3517" | jq .
```

**Expected response:**
```json
{
  "admin_level": 4,
  "commons_cat": {
    "title": "Brussels-Capital Region",
    "url": "https://commons.wikimedia.org/wiki/Category:Brussels-Capital%20Region"
  },
  "coords": {
    "lat": 50.8503,
    "lon": 4.3517
  },
  "wikidata": "Q240"
}
```
