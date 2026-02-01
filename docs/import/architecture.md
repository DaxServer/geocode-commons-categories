# Import System Architecture

High-level architecture, component relationships, and system configuration.

## System Architecture Overview

```mermaid
graph TB
    subgraph "Configuration Layer"
        ENV[Bun.env<br/>COUNTRY_CODE, ADMIN_LEVEL_START/END]
        CONSTANTS[constants.ts<br/>Batch sizes, delays, retry config]
    end

    subgraph "Import Commands"
        CMD1[bun import<br/>OSM-only]
        CMD2[bun import:data<br/>Full pipeline]
    end

    subgraph "Import Pipeline"
        ORCH[index.ts<br/>Orchestrator]

        subgraph "Stage 1: OSM Import"
            IMPORT[import.ts<br/>Hierarchical fetch]
            OVERPASS[overpass-import.ts<br/>API client]
        end

        subgraph "Stage 2-3: Wikidata"
            WD_FETCH[wikidata-api.ts<br/>Batch client]
        end

        subgraph "Stage 4: Transform"
            TRANSFORM[transform.ts<br/>Enrich & validate]
        end

        subgraph "Stage 5-6: Database"
            DB_INSERT[database/insert.ts<br/>Batch insert]
            VERIFY[verification.ts<br/>Verify results]
        end
    end

    subgraph "External APIs"
        OVERPASS_API[Overpass API<br/>Relation & geometry fetch]
        WD_API[Wikidata REST API<br/>Commons categories]
    end

    subgraph "Database Tables"
        OSM_REL[(osm_relations<br/>Raw OSM data)]
        ADMIN_BND[(admin_boundaries<br/>Enriched API data)]
        PROGRESS[(import_progress<br/>Progress tracking)]
    end

    ORCH --> PROGRESS
    PROGRESS --> OSM_REL

    ENV --> CMD1
    ENV --> CMD2
    CONSTANTS --> CMD1
    CONSTANTS --> CMD2

    CMD1 --> IMPORT
    CMD2 --> ORCH

    ORCH --> IMPORT
    IMPORT --> OVERPASS
    OVERPASS --> OVERPASS_API
    OVERPASS_API --> OSM_REL

    ORCH --> WD_FETCH
    WD_FETCH --> WD_API
    WD_API --> WD_FETCH

    ORCH --> TRANSFORM
    TRANSFORM --> OSM_REL
    TRANSFORM --> WD_FETCH

    ORCH --> DB_INSERT
    DB_INSERT --> ADMIN_BND
    ORCH --> VERIFY
    VERIFY --> ADMIN_BND
```

## Two-Table Architecture

```mermaid
graph LR
    subgraph "OSM-Only Import"
        A1[Overpass API] --> A2[Hierarchical Fetch]
        A2 --> A3[osm_relations<br/>Raw OSM data]
    end

    subgraph "Full Pipeline"
        A3 --> B1[Extract Wikidata IDs]
        B1 --> B2[Wikidata API]
        B2 --> B3[Transform & Enrich]
        B3 --> B4[admin_boundaries<br/>Enriched API data]
    end

    subgraph "API Usage"
        B4 --> C1[geocode API endpoint]
    end
```

## Database Schema

### osm_relations Table (Raw OSM Data)

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial | Auto-increment primary key |
| `relation_id` | bigint | OSM relation ID (unique with country_code) |
| `country_code` | varchar(3) | ISO 3166-1 alpha-3 country code |
| `admin_level` | int | Administrative level (2-11) |
| `name` | varchar | Display name |
| `wikidata_id` | varchar(20) | Wikidata ID (Q123 format, nullable) |
| `geometry` | geometry | PostGIS polygon (SRID=4326) |
| `tags` | jsonb | OSM tags as JSON |
| `fetched_at` | timestamp | When the data was fetched |

**Indexes:**
- GIST spatial index on `geometry`
- B-tree indexes on `relation_id`, `country_code`, `admin_level`, `wikidata_id`

### admin_boundaries Table (Enriched API Data)

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial | Auto-increment primary key |
| `wikidata_id` | varchar | Wikidata ID (Q123 format, unique) |
| `commons_category` | varchar | Wikimedia Commons category |
| `admin_level` | int | Administrative level (1-10) |
| `name` | varchar | Display name |
| `geom` | geometry | PostGIS polygon (SRID=4326) |
| `created_at` | timestamp | Creation timestamp |

**Indexes:**
- GIST spatial index on `geom`
- B-tree indexes on `wikidata_id`, `admin_level`

### import_progress Table (Progress Tracking)

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial | Auto-increment primary key |
| `country_code` | varchar(3) | ISO country code (unique) |
| `current_admin_level` | int | Current admin level being processed |
| `status` | varchar(20) | Status: 'pending', 'in_progress', 'completed', 'failed' |
| `relations_fetched` | int | Number of relations fetched so far |
| `errors` | int | Number of errors encountered |
| `started_at` | timestamp | When import started |
| `completed_at` | timestamp | When import completed (null if pending/failed) |
| `last_error` | text | Last error message (null if no errors) |

**Indexes:**
- B-tree index on `status`
- Unique constraint on `country_code`

### Schema Relationship

```mermaid
erDiagram
    osm_relations {
        serial id PK
        bigint relation_id UK
        varchar country_code
        int admin_level
        varchar name
        varchar wikidata_id
        geometry geometry
        jsonb tags
        timestamp fetched_at
    }

    admin_boundaries {
        serial id PK
        varchar wikidata_id UK
        varchar commons_category
        int admin_level
        varchar name
        geometry geom
        timestamp created_at
    }

    import_progress {
        serial id PK
        varchar country_code UK
        int current_admin_level
        varchar status
        int relations_fetched
        int errors
        timestamp started_at
        timestamp completed_at
        text last_error
    }
```

**Schema Notes:**
- **osm_relations**: Raw OSM data with full geometries
- **admin_boundaries**: Enriched data for API
- **Populated by**:
  - `bun import` → osm_relations only
  - `bun import:data` → osm_relations + admin_boundaries

## Module Structure

```mermaid
graph LR
    subgraph "src/import/"
        INDEX[index.ts<br/>Main orchestrator]
        IMPORT[import.ts<br/>OSM import entry]
        CONSTANTS[constants.ts<br/>Configuration]

        subgraph "fetch/"
            REL[relations.ts<br/>Relation discovery]
            GEOM[geometry.ts<br/>Geometry fetch]
        end

        subgraph "database/"
            CONN[connection.ts<br/>Connection pool]
            INSERT[insert.ts<br/>Batch insert]
            QUERIES[queries.ts<br/>All DB queries]
        end

        subgraph "utils/"
            EFFECT[effect-helpers.ts]
            BATCH[batch.ts]
            WD_API[wikidata-api.ts]
            OVER[overpass-import.ts]
            LOG[logging.ts]
        end

        subgraph "transform/"
            TRANSFORM[transform.ts<br/>Enrich & validate]
            GEOM[parent-linking.ts<br/>Geometry conversion]
        end
    end
```

## Key Implementation Details

### Hierarchical Discovery

The import system discovers administrative boundaries hierarchically:

1. **Level 2 (Country):** Fetched by `ISO3166-1:alpha3` tag
   ```typescript
   relation["boundary"="administrative"]["admin_level"="2"]["ISO3166-1:alpha3"="BEL"]
   ```

2. **Level 3+ (Children):** Fetched as children within previous level's area
   ```typescript
   // Convert relation ID to Overpass area ID
   const areaId = 3600000000 + relationId

   // Query for children within parent area
   relation["boundary"="administrative"]["admin_level"="3"](area:areaId)
   ```

**Note:** The `parent_id` column was removed in migration 003 as it's not used by the API.

### Overpass API Queries

**Discovery Query (out ids):**
```overpass
[out:json][timeout:90];
(
  relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-1:alpha3"="BEL"];
);
out ids;
```

**Child Discovery Query:**
```overpass
[out:json][timeout:90];
(
  relation["boundary"="administrative"]["admin_level"="5"](area:3600012345);
);
out ids;
```

**Geometry Fetch Query:**
```overpass
[out:json][timeout:90];
(
  relation(id:123,456,789);
  way(r);
);
out geom;
```

### Wikidata API Integration

**Request Format:**
```
GET /w/api.php?action=wbgetentities&ids=Q1|Q2|...|Q50&props=claims&format=json
```

**P373 Property Extraction:**
```typescript
// Navigate to Commons category
const category = entity.claims?.P373?.[0]?.mainsnak?.datavalue?.value
// Returns: "Category:Brussels-Capital Region"
```

### Constants Reference

| Constant | Value | Description |
|----------|-------|-------------|
| `BATCH_SIZES.WIKIDATA` | 50 | Max IDs per Wikidata API request |
| `BATCH_SIZES.DATABASE` | 1000 | Records per database transaction |
| `BATCH_SIZES.OVERPASS_GEOMETRY` | 100 | Relations per geometry fetch |
| `DELAYS.RATE_LIMIT_MS` | 100 | Delay between Wikidata batches |
| `DELAYS.OVERPASS_GEOMETRY_MS` | 250 | Delay between Overpass geometry requests |
| `DELAYS.RETRY_EXPONENTIAL_BASE` | 2 | Exponential base for retry delays |
| `DELAYS.COUNTRY_BATCH_MS` | 5000 | Delay between country batches (multi-country) |
| `RETRY_CONFIG.MAX_ATTEMPTS` | 3 | Max retry attempts for API calls |
| `RETRY_CONFIG.BASE_DELAY_MS` | 1000 | Base delay for exponential backoff |
| `IMPORT.COUNTRY_BATCH_SIZE` | 5 | Countries per batch (multi-country) |
| `IMPORT.OVERPASS_TIMEOUT` | 90 | Overpass query timeout (seconds) |

**Retry Delay Formula:** `delay = BASE_DELAY_MS × RETRY_EXPONENTIAL_BASE^(attempt-1)`
- Attempt 1: 1000ms
- Attempt 2: 2000ms
- Attempt 3: 4000ms

### Effect TS Error Handling

```typescript
// Standard error wrapper
export const tryAsync = <T>(
  tryFn: () => Promise<T>,
  context?: string
): Effect.Effect<T, Error> => {
  return Effect.tryPromise({
    try: tryFn,
    catch: (error) => new Error(`${context}: ${error}`)
  })
}
```

### Data Transform Pipeline

```mermaid
graph LR
    OSM[osm_relations rows] --> ENRICH[Enrich with Wikidata]
    ENRICH --> VALID[Validate geometries]
    VALID --> DEDUP[Deduplicate by wikidata_id]
    DEDUP --> ADMIN[admin_boundaries insert]
```

**Transform Steps:**
1. **Enrich:** Match `wikidata_id` with Commons category map
2. **Validate:** Check EWKT format and polygon structure
3. **Deduplicate:** Remove duplicate `wikidata_id` entries
4. **Filter:** Exclude records without categories or invalid geometries

## Technology Stack

```mermaid
graph TB
    subgraph "Runtime"
        BUN[Bun 1.3.8]
        TS[TypeScript ESNext]
    end

    subgraph "Core Libraries"
        EFFECT[Effect TS 3.19.15<br/>Error handling]
        PG[pg 8.17.2<br/>PostgreSQL client]
    end

    subgraph "External APIs"
        OVER[Overpass API]
        WIKI[Wikidata REST API]
    end

    subgraph "Database"
        POSTGRES[PostgreSQL 17]
        POSTGIS[PostGIS 3.4]
    end

    BUN --> TS
    TS --> EFFECT
    TS --> PG

    EFFECT --> OVER
    EFFECT --> WIKI

    PG --> POSTGRES
    POSTGRES --> POSTGIS
```
