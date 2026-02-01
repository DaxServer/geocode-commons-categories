# Visual Overview

Visual diagrams and summaries of the import pipeline.

## Complete Import Pipeline

```mermaid
graph TB
    subgraph "External APIs"
        OSM_API[Overpass API<br/>OSM data]
        WD_API[Wikidata API<br/>Commons categories]
    end

    subgraph "Import Pipeline"
        S1[Stage 1: Fetch OSM<br/>Discover relations → Fetch geometries]
        S2[Stage 2: Extract IDs<br/>Query osm_relations]
        S3[Stage 3: Fetch Wikidata<br/>Batch 50 IDs, 100ms delay]
        S4[Stage 4: Transform<br/>Enrich → Validate → Deduplicate]
        S5[Stage 5: Insert<br/>Batch 1000, transactions]
        S6[Stage 6: Verify<br/>Count and validate]
    end

    subgraph "Database"
        OSM_TBL[(osm_relations<br/>Raw OSM data)]
        ADMIN_TBL[(admin_boundaries<br/>Enriched data)]
    end

    OSM_API --> S1
    S1 --> OSM_TBL
    S1 --> S2
    S2 --> S3
    WD_API --> S3
    S3 --> S4
    S4 --> S5
    S5 --> ADMIN_TBL
    S5 --> S6
    S6 --> ADMIN_TBL
```

## Import Commands

```mermaid
graph TB
    CLI[bun command] --> DECISION{Which command?}

    DECISION -->|bun import| OSM[OSM-Only Import]
    DECISION -->|bun import:data| FULL[Full Pipeline]

    OSM --> FETCH[Fetch OSM → osm_relations]
    FETCH --> OSM_DONE[Complete]

    FULL --> FETCH
    OSM_DONE --> EXTRACT[Extract Wikidata IDs]
    EXTRACT --> WD_CATS[Fetch Commons Categories]
    WD_CATS --> TRANSFORM[Transform & Enrich]
    TRANSFORM --> INSERT[Insert to admin_boundaries]
    INSERT --> VERIFY[Verify Results]
    VERIFY --> FULL_DONE[Complete]
```

## Data Flow Summary

```mermaid
graph LR
    OSM[OSM Fetch<br/>3000 relations] --> WD[Wikidata IDs<br/>3000 unique Q IDs]
    WD --> CATS[Categories<br/>2500 matched]
    CATS --> VALID[Validated<br/>2450 pass]
    VALID --> FINAL[admin_boundaries<br/>2450 inserted]
```

**Typical Attrition:**
- OSM relations: 100%
- Wikidata matched: ~80%
- Validated: ~98%
- Final insert: ~75-80% of original

## Configuration Matrix

```mermaid
graph TB
    subgraph "Required Environment Variables"
        R1[COUNTRY_CODE ✅]
        R2[DATABASE_URL ✅]
    end

    subgraph "Optional Environment Variables"
        O1[ADMIN_LEVEL_START<br/>default: 4]
        O2[ADMIN_LEVEL_END<br/>default: 11]
    end

    subgraph "Internal Constants"
        I1[BATCH_SIZES.WIKIDATA = 50]
        I2[BATCH_SIZES.DATABASE = 1000]
        I3[RETRY_CONFIG.MAX_ATTEMPTS = 3]
        I4[DELAYS.RATE_LIMIT_MS = 100]
    end

    R1 --> IMPORT[Import Process]
    R2 --> IMPORT
    O1 --> IMPORT
    O2 --> IMPORT

    IMPORT --> I1
    IMPORT --> I2
    IMPORT --> I3
    IMPORT --> I4
```

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

## Two-Table Architecture

```mermaid
graph LR
    subgraph "OSM Import"
        A1[Overpass API] --> A2[osm_relations<br/>Raw OSM data]
    end

    subgraph "Full Pipeline"
        A2 --> B1[Wikidata Enrichment]
        B1 --> B2[admin_boundaries<br/>API data]
    end

    subgraph "API"
        B2 --> C1[geocode API endpoint]
    end
```

## Key Characteristics

**Pipeline Features:**
- ✅ **Effect TS** for error-safe operations
- ✅ **Batch processing** (50 IDs for Wikidata, 1000 for DB)
- ✅ **Retry logic** (exponential backoff, max 3 attempts)
- ✅ **Graceful degradation** (continues on non-critical errors)
- ✅ **Transaction safety** (atomic batch commits)
- ✅ **Hierarchical discovery** (uses parent areas for child search)

**Implementation Details:**
- Overpass area IDs: `3600000000 + relationId`
- Wikidata ID format: Preserves "Q" prefix
- Geometry format: EWKT with SRID=4326
- Admin level skip: Uses `continue` not `break`

**For detailed information, see:**
- [Import Guide](./IMPORT_GUIDE.md) - Complete walkthrough
- [Architecture](./architecture.md) - System design
- [Data Flow](./data-flow.md) - Pipeline sequences
- [API Interactions](./api-interactions.md) - External APIs
- [Error Handling](./error-handling.md) - Retry logic
