# Data Import Guide

Complete walkthrough of the administrative boundary data import process.

## Table of Contents
- [Overview](#overview)
- [What Happens During Import](#what-happens-during-import)
- [Prerequisites](#prerequisites)
- [Step-by-Step Process](#step-by-step-process)
- [Data Sources](#data-sources)
- [Common Issues](#common-issues)

## Overview

The import system fetches administrative boundary data for a country using a two-table approach:
1. **Hierarchical import** → `osm_relations` table (raw OSM data with full geometries)
2. **Main pipeline** → `admin_boundaries` table (enriched with Wikimedia Commons categories)

**What gets imported:**
- Administrative boundaries (regions, provinces, municipalities)
- Wikidata IDs for each boundary
- Wikimedia Commons categories
- Full geometries for accurate spatial queries

## What Happens During Import

The import pipeline goes through **6 stages**:

### Stage 1: Hierarchical Import
1. **Discovers relation IDs** by querying Overpass API for admin_level
2. **Fetches geometries** from Overpass API using `out geom;`
3. **Inserts to osm_relations** table with full geometries

**What you'll see:**
```
=== Starting hierarchical import for USA ===
Admin level range: 4 to 8
Fetching level 4 relations for USA...
Found 50 unique relations at level 4
Fetched 50 geometries for USA at level 4
```

### Stage 2: Extract Wikidata IDs
1. **Queries osm_relations** table for wikidata_id values
2. **Filters NULL values** and counts unique IDs

**What you'll see:**
```
Step 2: Extracting Wikidata IDs from OSM relations
Found 3000 OSM relations with Wikidata IDs
Extracted 3000 unique Wikidata IDs
```

### Stage 3: Fetch Commons Categories
1. **Splits IDs into batches** of 50 (Wikidata API limit)
2. **Fetches entity data** from Wikidata REST API
3. **Extracts P373 property** (Commons category) for each entity
4. **Builds category map** (Wikidata ID → Category name)
5. **Applies rate limiting** (100ms delay between batches)

**What you'll see:**
```
Step 3: Fetching Commons categories from Wikidata
Processing batch 1/60...
Batch 1 complete: 48 categories fetched
...
Total Commons categories fetched: 2950/3000
```

### Stage 4: Transform and Enrich
1. **Queries osm_relations** with geometry data
2. **Merges OSM data** with Wikidata categories
3. **Validates EWKT format** of geometries
4. **Removes duplicates** by Wikidata ID
5. **Filters out records** without Commons categories

**What you'll see:**
```
Step 4: Transforming and enriching data
=== Enriching Database Rows with Wikidata Data ===
Enriched: 2950 boundaries
Skipped: 50 rows (no wikidata_id or Commons category)
=== Validating Geometries ===
Valid geometries: 2950
=== Deduplicating Boundaries ===
Unique boundaries: 2950
```

### Stage 5: Database Insert
1. **Connects to PostgreSQL** via connection pool
2. **Splits into batches** of 1000 records
3. **Opens transaction** for each batch
4. **Inserts records** with `ON CONFLICT` handling
5. **Commits or rolls back** based on success/failure

**What you'll see:**
```
Step 5: Inserting data into admin_boundaries table
=== Inserting Boundaries into Database ===
Processing batch 1/3
Batch 1 committed: 1000 total inserted
...
Successfully inserted: 2950
Errors: 0
```

### Stage 6: Verification
1. **Queries total record count**
2. **Groups by admin_level** to verify distribution
3. **Checks for NULL values** in required fields
4. **Validates geometries** with PostGIS functions

**What you'll see:**
```
Step 6: Verifying import
=== Verifying Import ===
Total records in database: 2950

Records by admin level:
  Level 4: 50
  Level 6: 300
  Level 8: 2600

Invalid geometries: 0
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
COUNTRY_CODE=BEL  # ISO country code

# Optional - for hierarchical import
ADMIN_LEVEL_START=4  # Start admin level (default: 4)
ADMIN_LEVEL_END=8    # End admin level (default: 11)

# Optional - for Wikidata enrichment
BATCH_SIZE=50
RATE_LIMIT_MS=100

# Optional - for debugging
OUTPUT_DIR=./output
```

### 3. Verify Database is Ready

```bash
docker compose exec postgres psql -U geocode -d geocode -c "SELECT 1;"
docker compose exec postgres psql -U geocode -d geocode -c "\d osm_relations"
docker compose exec postgres psql -U geocode -d geocode -c "\d admin_boundaries"
```

## Step-by-Step Process

### Full Import (Recommended)

```bash
# Set environment variables
export COUNTRY_CODE=BEL
export ADMIN_LEVEL_START=4
export ADMIN_LEVEL_END=8
export DATABASE_URL=postgresql://geocode:geocode@localhost:5432/geocode

# Run complete pipeline
bun import:data
```

### Hierarchical Import Only

```bash
# Run hierarchical import to populate osm_relations table
bun import:hierarchical
```

### With Output Files

```bash
# Enable intermediate file output
export OUTPUT_DIR=./output

# Run import (saves transformed-{country}.json)
bun import:data
```

## Data Sources

### OpenStreetMap (via Overpass API)

**Overpass API** - Relation Discovery:
```overpass
[out:json][timeout:90];
area["ISO3166-1"="{country_code}"]->.searchArea;
(
  relation["boundary"="administrative"]["admin_level"="{level}"](area.searchArea);
);
out ids;
```

**Overpass API** - Geometry Fetch:
```overpass
[out:json][timeout:90];
(
  id_{relation_id};
);
out geom;
```

**Response includes:**
- OSM relation ID
- Name (`name` tag)
- Admin level (`admin_level` tag)
- Wikidata ID (`wikidata` tag)
- Full geometry (polygon with all coordinates)

### Wikimedia Commons (via Wikidata API)

**API endpoint:** `https://www.wikidata.org/w/api.php`

**Action:** `wbgetentities`

**Parameters:**
- `ids`: Comma-separated Wikidata IDs (max 50)
- `props`: `claims`
- `format`: `json`

**Response processing:**
1. Extract `P373` property (Commons category)
2. Store as `Category:Name` format
3. Build lookup map: `Q123 → Category:Name`

## Common Issues

### Issue: Hierarchical Import Timeout

**Symptoms:** `Error: Overpass API error: 504 Gateway Timeout`

**Solution:**
- Reduce admin level range (e.g., `ADMIN_LEVEL_START=4 ADMIN_LEVEL_END=6`)
- Import smaller countries first
- Use `COUNTRY_CODE` for single country instead of global import

### Issue: No Commons Categories Found

**Symptoms:** `Total Commons categories fetched: 0/3000`

**Causes:**
- Wikidata IDs missing "Q" prefix (fixed in current version)
- Network connectivity issues
- Wikidata API rate limiting

**Solution:**
- Check Wikidata ID format in logs
- Verify internet connection
- Check for API error messages

## Import Verification

After import completes, verify with these queries:

### Check Record Counts
```sql
-- Check osm_relations (raw data)
SELECT admin_level, COUNT(*)
FROM osm_relations
WHERE iso3 = 'BEL'
GROUP BY admin_level
ORDER BY admin_level;

-- Check admin_boundaries (enriched data)
SELECT admin_level, COUNT(*)
FROM admin_boundaries
GROUP BY admin_level
ORDER BY admin_level;
```

### Check Data Quality
```sql
SELECT COUNT(*) as total,
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

Expected response:
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
