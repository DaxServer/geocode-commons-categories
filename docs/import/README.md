# Import System Documentation

Complete documentation for the geocode-commons-categories data import pipeline.

## Overview

The import system is a multi-stage pipeline that:
1. Fetches administrative boundary data from OpenStreetMap via hierarchical import
2. Stores raw OSM data in `osm_relations` table with full geometries
3. Enriches the data with Wikimedia Commons categories via Wikidata
4. Transforms and validates the data for PostgreSQL/PostGIS
5. Inserts enriched data to `admin_boundaries` table for the API

## Documentation Structure

- **[Import Guide](./IMPORT_GUIDE.md)** - Complete walkthrough of the import process with examples and troubleshooting
- **[Architecture](./architecture.md)** - High-level system architecture, component relationships, and configuration
- **[Data Flow](./data-flow.md)** - Complete data flow diagrams, sequence diagrams, and state transitions
- **[API Interactions](./api-interactions.md)** - External API integration details (Overpass, Wikidata)
- **[Error Handling](./error-handling.md)** - Retry logic, error recovery, and failure handling

## Quick Start

```bash
# Set required environment variables
export COUNTRY_CODE="USA"
export DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"

# Run the full import pipeline
bun import:data

# Test the API (note: endpoint is /geocode, not /)
curl "http://localhost:3000/geocode?lat=40.7128&lon=-74.0060" | jq .
```

## Key Concepts

### Two-Table Architecture

The import system uses two database tables:

1. **`osm_relations`** - Raw OSM hierarchical data
   - Populated by hierarchical import (`bun import:hierarchical`)
   - Full geometries from Overpass API
   - Parent-child relationships between admin levels

2. **`admin_boundaries`** - Enriched data for API
   - Populated by main orchestrator (`bun import:data`)
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

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COUNTRY_CODE` | Yes | - | ISO 3166-1 alpha-2 country code |
| `ADMIN_LEVEL_START` | Yes | - | Start admin level for hierarchical import |
| `ADMIN_LEVEL_END` | Yes | - | End admin level for hierarchical import |
| `BATCH_SIZE` | Yes | - | Database batch size |
| `OUTPUT_DIR` | No | "./output" | Intermediate file output directory |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |

## Performance Characteristics

- **Hierarchical Import**: Uses Overpass API for discovery and geometry fetch
- **Wikidata API**: 50 IDs per request, 100ms delay between batches
- **Database Insert**: 1000 records per transaction
- **Typical Import Time**: 5-15 minutes for medium-sized countries

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
- ✅ Accurate boundary representations
- ✅ No overlapping bounding boxes
- ⚠️ Slower than bounding box approximation
- ⚠️ May timeout for very large countries (use admin level range to limit)

## Troubleshooting

See individual documentation sections for:
- API rate limiting issues → [API Interactions](./api-interactions.md)
- Database connection problems → [Architecture](./architecture.md)
- Data validation failures → [Data Flow](./data-flow.md)
- Retry mechanism details → [Error Handling](./error-handling.md)
