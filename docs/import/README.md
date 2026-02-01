# Import System Documentation

Complete documentation for the geocode-commons-categories data import pipeline.

## Overview

The import system is a multi-stage pipeline that:
1. Fetches administrative boundary data from OpenStreetMap via hierarchical discovery
2. Stores raw OSM data in `osm_relations` table
3. Enriches the data with Wikimedia Commons categories via Wikidata
4. Transforms and validates the data for PostgreSQL/PostGIS
5. Inserts enriched data to `admin_boundaries` table for the API

## Quick Start

```bash
# Set required environment variables
export COUNTRY_CODE="USA"
export DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"

# Option 1: Run full pipeline (recommended)
bun import:data

# Option 2: OSM-only import
bun import

# Test the API
curl "http://localhost:3000/geocode?lat=40.7128&lon=-74.0060" | jq .
```

## Import Commands

| Command | Description | Tables Affected |
|---------|-------------|-----------------|
| `bun import` | Fetch OSM data only | `osm_relations` |
| `bun import:data` | Full pipeline (OSM + Wikidata) | `osm_relations` + `admin_boundaries` |

### Single-Country vs Multi-Country Mode

**Single-Country Mode** (default with `COUNTRY_CODE` set):
```bash
export COUNTRY_CODE=BEL
bun import  # Imports only Belgium
```

**Multi-Country Mode** (no `COUNTRY_CODE` set):
```bash
bun import  # Imports all ~250 countries in batches
```

Multi-country mode:
- Processes 5 countries in parallel
- Uses 5-second delays between batches
- Tracks progress to skip already-completed countries
- Can be resumed if interrupted

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COUNTRY_CODE` | Yes | - | ISO 3166-1 alpha-3 code (e.g., USA, BEL, FRA) |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `ADMIN_LEVEL_START` | No | 4 | Start admin level (2-11) |
| `ADMIN_LEVEL_END` | No | 11 | End admin level (2-11) |

## Documentation Structure

- **[Import Guide](./IMPORT_GUIDE.md)** - Complete walkthrough with examples and troubleshooting
- **[Architecture](./architecture.md)** - System design, components, and configuration
- **[Data Flow](./data-flow.md)** - Pipeline sequences and diagrams
- **[API Interactions](./api-interactions.md)** - External API integration (Overpass, Wikidata)
- **[Error Handling](./error-handling.md)** - Retry logic and error recovery
- **[Visual Overview](./visual-overview.md)** - Visual diagrams and summaries

## Key Concepts

### Two-Table Architecture

1. **`osm_relations`** - Raw OSM data
   - Populated by `bun import` or `bun import:data`
   - Full geometries from Overpass API
   - Discovered hierarchically using parent area queries

2. **`admin_boundaries`** - Enriched data for API
   - Populated by `bun import:data` only
   - Enriched with Wikimedia Commons categories
   - Used by reverse geocoding endpoint

### Effect TS Integration

The import system uses **Effect TS** for predictable error handling:
- All async operations return `Effect.Effect<T, E>`
- Automatic error propagation and recovery
- Resource cleanup guarantees with `Effect.ensuring()`
- Typed error handling with `_tag` discriminators

### Batch Processing

Two levels of batch processing:
- **Wikidata API**: 50 IDs per request with 100ms delays
- **Database**: 1000 records per transaction

### Data Enrichment Pipeline

```mermaid
graph LR
    A[OSM Relations] --> B[Extract Wikidata IDs]
    B --> C[Fetch Commons Categories]
    C --> D[Enrich Boundaries]
    D --> E[Validate Geometries]
    E --> F[Insert to admin_boundaries]
```

## Implementation Details

### Hierarchical Discovery

The import system discovers administrative boundaries hierarchically:

1. **Level 2 (Country):** Fetched by `ISO3166-1:alpha3` tag
2. **Level 3+ (Children):** Fetched as children within previous level's area using Overpass area queries

**Overpass Area ID Conversion:**
```typescript
const areaId = 3600000000 + relationId
```

### Geometry Format

**EWKT (Extended Well-Known Text) format:**
- Prefix: `SRID=4326;`
- Example: `SRID=4326;POLYGON((4.35 50.85,4.36 50.85,...))`

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
| `IMPORT.COUNTRY_BATCH_SIZE` | 5 | Countries per batch (multi-country) |
| `IMPORT.OVERPASS_TIMEOUT` | 90 | Overpass query timeout (seconds) |

**Retry Formula:** `delay = BASE_DELAY_MS × RETRY_EXPONENTIAL_BASE^(attempt-1)`

## Performance Characteristics

- **Hierarchical Import:** Uses Overpass API for discovery and geometry fetch
- **Wikidata API:** 50 IDs per request, 100ms delay between batches
- **Database Insert:** 1000 records per transaction
- **Typical Import Time:** 5-15 minutes for medium-sized countries

## Data Validation

The import system validates:
- ✅ All boundaries have valid geometries (PostGIS `ST_IsValid`)
- ✅ Wikidata IDs are properly formatted with "Q" prefix (Q\d+)
- ✅ Commons categories are extracted from P373 property
- ✅ No duplicate wikidata_id entries in admin_boundaries
- ✅ admin_level values are within expected range

## Known Limitations

### Geometries

The import fetches full geometries from Overpass API using `out geom;`:
- ✅ Accurate boundary representations (full polygon geometries)
- ✅ No overlapping bounding boxes
- ⚠️ May timeout for very large countries (use admin level range to limit)

**Note:** The system uses `out geom` to fetch complete polygon geometries, not `out ids` or `out bb`. This provides accurate boundaries but may be slower for very large regions.

## Troubleshooting

See individual documentation sections for:
- API rate limiting issues → [API Interactions](./api-interactions.md)
- Database connection problems → [Architecture](./architecture.md)
- Data validation failures → [Data Flow](./data-flow.md)
- Retry mechanism details → [Error Handling](./error-handling.md)
