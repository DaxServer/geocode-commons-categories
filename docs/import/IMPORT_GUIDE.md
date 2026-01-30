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

The import system fetches administrative boundary data for a country, enriches it with Wikimedia Commons categories, and stores it in a PostGIS-enabled PostgreSQL database for reverse geocoding.

**What gets imported:**
- Administrative boundaries (regions, provinces, municipalities)
- Wikidata IDs for each boundary
- Wikimedia Commons categories
- Geometries for spatial queries

## What Happens During Import

The import pipeline goes through **6 stages**:

### Stage 1: Fetch OSM Data
1. **Builds Overpass QL query** for the target country and admin levels
2. **Calls Overpass API** to fetch boundary relations
3. **Converts response** to structured OSMBoundary objects
4. **Saves intermediate file** (optional, if `OUTPUT_DIR` is set)

**What you'll see:**
```
=== Fetching OSM Boundary Data ===
Fetching boundaries for BE...
Found 584 boundaries
```

### Stage 2: Extract Wikidata IDs
1. **Scans all OSM boundaries** for `wikidata` tags
2. **Formats IDs** by removing URL prefixes but keeping the "Q" prefix
3. **Counts unique IDs** for batch processing

**What you'll see:**
```
Found 584 unique Wikidata IDs in OSM data
```

### Stage 3: Fetch Commons Categories
1. **Splits IDs into batches** of 50 (Wikidata API limit)
2. **Fetches entity data** from Wikidata REST API
3. **Extracts P373 property** (Commons category) for each entity
4. **Builds category map** (Wikidata ID → Category name)
5. **Applies rate limiting** (100ms delay between batches)

**What you'll see:**
```
Processing batch 1/12...
Batch 1 complete: 49 categories fetched
...
Total Commons categories fetched: 580/584
```

### Stage 4: Transform and Enrich
1. **Merges OSM data** with Wikidata categories
2. **Validates geometries** (PostGIS `ST_IsValid`)
3. **Converts to EWKT** (Extended Well-Known Text) format
4. **Removes duplicates** by Wikidata ID
5. **Filters out records** without Commons categories

**What you'll see:**
```
=== Enriching OSM Boundaries with Wikidata Data ===
Enriched: 580 boundaries
Skipped: 4 boundaries (no wikidata tag or Commons category)
=== Validating Geometries ===
Valid geometries: 580
Invalid geometries: 0
=== Deduplicating Boundaries ===
Unique boundaries: 580
```

### Stage 5: Database Insert
1. **Connects to PostgreSQL** via connection pool
2. **Splits into batches** of 1000 records
3. **Opens transaction** for each batch
4. **Inserts records** with `ON CONFLICT` handling
5. **Commits or rolls back** based on success/failure

**What you'll see:**
```
=== Inserting Boundaries into Database ===
Processing batch 1/12
Batch 1 committed: 50 total inserted
...
Successfully inserted: 580
Errors: 0
```

### Stage 6: Verification
1. **Queries total record count**
2. **Groups by admin_level** to verify distribution
3. **Checks for NULL values** in required fields
4. **Validates geometries** with PostGIS functions

**What you'll see:**
```
=== Verifying Import ===
Total records in database: 580

Records by admin level:
  Level 4: 4
  Level 6: 12
  Level 8: 564

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
COUNTRY_CODE=BE  # ISO country code
ADMIN_LEVELS=4,6,8

# Optional
BATCH_SIZE=50
RATE_LIMIT_MS=100
OUTPUT_DIR=./output
SKIP_WIKIDATA=false
```

### 3. Verify Database is Ready

```bash
docker compose exec postgres psql -U geocode -d geocode -c "SELECT 1;"
docker compose exec postgres psql -U geocode -d geocode -c "\d admin_boundaries"
```

## Step-by-Step Process

### Full Import (Recommended)

```bash
# Set environment variables
export COUNTRY_CODE=BE
export ADMIN_LEVELS=4,6,8
export DATABASE_URL=postgresql://geocode:geocode@localhost:5432/geocode

# Run complete pipeline
bun import:data
```

### Stage-by-Stage Import

```bash
# 1. Fetch OSM data only
bun import:osm

# 2. Insert from file (requires INPUT_FILE)
export INPUT_FILE=./output/osm-be.json
bun import:database
```

### With Output Files

```bash
# Enable intermediate file output
export OUTPUT_DIR=./output

# Run import (saves osm-{country}.json and transformed-{country}.json)
bun import:data
```

## Data Sources

### OpenStreetMap (via Overpass API)

**Query format:**
```overpass
[out:json][timeout:90];
area["ISO3166-1"="{COUNTRY_CODE}"]->.searchArea;
(
  relation["boundary"="administrative"]["admin_level"~"^({ADMIN_LEVELS})$"](area.searchArea);
);
out bb;
```

**Response includes:**
- OSM relation ID
- Name (`name` tag)
- Admin level (`admin_level` tag)
- Wikidata ID (`wikidata` tag)
- Bounding box (`bounds`)

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

### Issue: Overpass API Timeout

**Symptoms:** `Error: Overpass API error: 504 Gateway Timeout`

**Solution:**
- Use `out bb;` instead of `out body; >;`
- Reduce admin levels (fewer boundaries)
- Import smaller countries first

### Issue: No Commons Categories Found

**Symptoms:** `Total Commons categories fetched: 0/584`

**Causes:**
- Wikidata IDs missing "Q" prefix (fixed in current version)
- Network connectivity issues
- Wikidata API rate limiting

**Solution:**
- Check Wikidata ID format in logs
- Verify internet connection
- Check for API error messages

### Issue: Import Completes but API Returns 404

**Symptoms:**
```
Import complete: 580 records
curl "http://localhost:3000/geocode?lat=50.85&lon=4.35"
# Returns: {"error": "Location not found"}
```

**Causes:**
- App service needs restart (database connection pool)
- Bounding box geometry inaccuracy (known limitation)

**Solution:**
```bash
docker compose restart app
# Wait 10 seconds for startup
curl "http://localhost:3000/geocode?lat=50.85&lon=4.35"
```

### Issue: Wrong Location Returned

**Symptoms:** Query returns wrong admin boundary

**Cause:** Bounding box overlap (known limitation)

**Example:**
- Query for Ghent, Belgium returns Hauts-de-France, France
- Their bounding boxes overlap at the border

**Solution:** This is a known trade-off. For accurate results, implement full polygon geometry.

## Import Verification

After import completes, verify with these queries:

### Check Record Counts
```sql
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

## Performance Benchmarks

**Typical import times (Belgium example):**

| Stage | Duration | Notes |
|-------|----------|-------|
| Fetch OSM | ~30 seconds | 584 boundaries |
| Fetch Wikidata | ~2 minutes | 12 batches, 580 categories |
| Transform | <1 second | In-memory processing |
| Database Insert | ~5 seconds | 12 batches |
| **Total** | **~3 minutes** | Belgium (584 records) |

**Expected scaling:**
- Small countries (< 100 records): 1-2 minutes
- Medium countries (100-1000 records): 3-5 minutes
- Large countries (> 1000 records): 10+ minutes

## Next Steps

After successful import:

1. **Test the API** with various coordinates
2. **Verify data quality** using the verification queries above
3. **Document any issues** specific to your country
4. **Consider improvements:**
   - Full polygon geometry implementation
   - Incremental updates for boundary changes
   - Multiple country imports
