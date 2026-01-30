# Visual Overview

Visual diagrams and summaries of the complete import pipeline.

## Complete Import Pipeline at a Glance

```mermaid
graph TB
    subgraph "🌍 External Data Sources"
        OSM_API[Overpass API<br/>OpenStreetMap]
        WD_API[Wikidata REST API<br/>Wikimedia]
    end

    subgraph "📥 Import Pipeline"
        STAGE1[Stage 1: Fetch OSM<br/>Overpass QL queries<br/>Retry with backoff]
        STAGE2[Stage 2: Fetch Wikidata<br/>Batch 50 IDs<br/>100ms delay]
        STAGE3[Stage 3: Transform<br/>Validate geometries<br/>Remove duplicates]
        STAGE4[Stage 4: Database<br/>Batch 1000 records<br/>Transaction safety]
        STAGE5[Stage 5: Verify<br/>Count records<br/>Check integrity]
    end

    subgraph "💾 Storage"
        CACHE["File Cache<br/>osm-country.json"]
        POSTGRES[(PostgreSQL<br/>PostGIS Extension)]
    end

    OSM_API --> STAGE1
    STAGE1 --> CACHE
    STAGE1 --> STAGE2
    WD_API --> STAGE2
    STAGE2 --> STAGE3
    STAGE3 --> STAGE4
    STAGE4 --> POSTGRES
    STAGE4 --> STAGE5
    STAGE5 --> POSTGRES

```

## Component Interaction Map

```mermaid
graph LR
    subgraph "Configuration"
        C1[Environment Variables]
        C2[Constants]
    end

    subgraph "Pipeline"
        P1[Fetch OSM]
        P2[Fetch Wikidata]
        P3[Transform]
        P4[Database]
    end

    subgraph "External APIs"
        A1[Overpass]
        A2[Wikidata]
    end

    subgraph "Storage"
        S1[Files]
        S2[PostgreSQL]
    end

    C1 --> P1
    C2 --> P1
    C1 --> P2
    C1 --> P4

    P1 --> A1
    P2 --> A2
    P1 --> S1
    P4 --> S2

```

## Data Volume Flow

```mermaid
graph TD
    INPUT[Input<br/>Country Code]

    INPUT --> OSM[OSM Fetch<br/>~1000-10000 boundaries]

    OSM --> WD_IDS[Wikidata IDs<br/>~1000-10000 Q IDs]

    WD_IDS --> WD_CAT[Categories<br/>~60-80% match rate]

    WD_CAT --> VALID[Validated<br/>~95% geometries valid]

    VALID --> DEDUP[Deduplicated<br/>~1-5% duplicates removed]

    DEDUP --> FINAL[Final Dataset<br/>~60-75% of original]

    FINAL --> DB[Database<br/>All records inserted]

```

## Timing Diagram

```mermaid
gantt
    title Import Pipeline Timeline
    dateFormat X
    axisFormat %s

    section Fetch OSM
    Query Overpass API     :0, 5
    Parse Response         :5, 10
    Save to File           :10, 12

    section Fetch Wikidata
    Extract IDs            :12, 13
    Batch Processing       :13, 50
    Build Category Map     :50, 52

    section Transform
    Enrich Data            :52, 60
    Validate Geometries    :60, 70
    Remove Duplicates      :70, 72

    section Database
    Batch Insert           :72, 80
    Verification           :80, 82
```

## Error Recovery Flow

```mermaid
graph LR
    START[Operation] --> ERROR{Error?}

    ERROR -->|No| SUCCESS[Success]
    ERROR -->|Yes| RETRYABLE{Retryable?}

    RETRYABLE -->|No| LOG[Log error]
    RETRYABLE -->|Yes| ATTEMPTS{Attempts < 3?}

    ATTEMPTS -->|No| LOG
    ATTEMPTS -->|Yes| DELAY[Wait backoff]

    DELAY --> RETRY[Retry operation]
    RETRY --> ERROR

    SUCCESS --> END[Complete]
    LOG --> CONTINUE{Continue?}

    CONTINUE -->|Yes| END
    CONTINUE -->|No| FAIL[Fail operation]

```

## Configuration Matrix

```mermaid
graph TB
    subgraph "Required Config"
        R1[COUNTRY_CODE ✅]
        R2[DATABASE_URL ✅]
    end

    subgraph "Optional Config"
        O1[ADMIN_LEVELS<br/>default: 4,6,8]
        O2[BATCH_SIZE<br/>default: 1000]
        O3[OUTPUT_DIR<br/>default: ./output]
        O4[SKIP_WIKIDATA<br/>default: false]
    end

    subgraph "Internal Config"
        I1[WIKIDATA_BATCH_SIZE<br/>fixed: 50]
        I2[RATE_LIMIT_MS<br/>fixed: 100]
        I3[MAX_RETRIES<br/>fixed: 3]
        I4[BASE_DELAY_MS<br/>fixed: 1000]
    end

    R1 --> VALID[Validation]
    R2 --> VALID
    O1 --> VALID
    VALID --> IMPORT[Import Process]

    IMPORT --> I1
    IMPORT --> I2
    IMPORT --> I3
    IMPORT --> I4

```

## Performance Characteristics

```mermaid
graph LR
    subgraph "Throughput"
        T1[Overpass: 1 request<br/>~5-30s]
        T2[Wikidata: 20 requests<br/>~2s/batch]
        T3[Transform: 1000s records<br/>~5s]
        T4[Database: 10 batches<br/>~1s/batch]
    end

    subgraph "Bottlenecks"
        B1[Overpass API latency]
        B2[Wikidata rate limiting]
    end

    subgraph "Optimizations"
        O1[Retry with backoff]
        O2[Batch processing]
        O3[Connection pooling]
        O4[Transaction batching]
    end

    T1 --> B1
    T2 --> B2

    O1 --> T1
    O2 --> T2
    O3 --> T4
    O4 --> T4

```

## Data Quality Metrics

```mermaid
graph TD
    subgraph "Quality Checks"
        Q1[Geometry Validation]
        Q2[Wikidata Match]
        Q3[Category Coverage]
        Q4[Deduplication]
    end

    subgraph "Typical Results"
        R1[95% valid geometries]
        R2[100% have wikidata tags]
        R3[60-80% have categories]
        R4[1-5% duplicates]
    end

    subgraph "Actions"
        A1[Skip invalid]
        A2[Skip missing tags]
        A3[Skip missing categories]
        A4[Remove duplicates]
    end

    Q1 --> R1
    Q2 --> R2
    Q3 --> R3
    Q4 --> R4

    R1 --> A1
    R2 --> A2
    R3 --> A3
    R4 --> A4

```

## Key Metrics Dashboard

```mermaid
graph TB
    subgraph "Import Statistics"
        M1[Records Fetched]
        M2[Wikidata IDs]
        M3[Categories Matched]
        M4[Geometries Valid]
        M5[After Dedup]
        M6[Database Insert]
        M7[Errors Logged]
    end

    M1 --> M2
    M2 --> M3
    M3 --> M4
    M4 --> M5
    M5 --> M6
    M6 --> M7

```

## Technology Stack

```mermaid
graph TB
    subgraph "Runtime"
        BUN[Bun 1.3.8]
        TS[TypeScript ESNext]
    end

    subgraph "Core Libraries"
        EFFECT[Effect TS 3.19.15]
        ELYSIA[Elysia 1.4.22]
        PG[pg 8.17.2]
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
    TS --> ELYSIA
    TS --> PG

    EFFECT --> OVER
    EFFECT --> WIKI

    PG --> POSTGRES
    POSTGRES --> POSTGIS

```

## Documentation Navigation

```mermaid
mindmap
  root((Import System<br/>Documentation))
    README[Getting Started]
      Quick Start Guide
      Environment Variables
      Key Concepts
      Troubleshooting
    ARCH[Architecture]
      System Overview
      Module Responsibilities
      Configuration
      Database Design
      Technology Stack
    FLOW[Data Flow]
      Pipeline Overview
      Sequence Diagrams
      State Transitions
      Entity Flows
      Filter Logic
    API[API Interactions]
      Overpass API
      Wikidata API
      Request/Response
      Rate Limiting
      Best Practices
    ERROR[Error Handling]
      Error Taxonomy
      Retry Logic
      Recovery Strategies
      Stage-Specific
      Logging
    VISUAL[Visual Overview]
      Pipeline at a Glance
      Component Map
      Timing Diagram
      Performance
      Metrics
```

## Quick Reference Card

```mermaid
graph TB
    subgraph "Commands"
        CMD1[bun import:data<br/>Full pipeline]
        CMD2[bun import:osm<br/>Fetch OSM only]
        CMD3[bun import:database<br/>Insert to DB]
    end

    subgraph "Required Env Vars"
        ENV1[COUNTRY_CODE]
        ENV2[DATABASE_URL]
    end

    subgraph "Key Files"
        F1[src/scripts/import/index.ts<br/>Orchestrator]
        F2[src/scripts/import/fetch-osm.ts<br/>OSM fetcher]
        F3[src/scripts/utils/wikidata-api.ts<br/>Wikidata client]
        F4[src/scripts/import/database/<br/>Database layer]
    end

    subgraph "Batch Sizes"
        BS1[Wikidata: 50 IDs]
        BS2[Database: 1000 records]
    end

    subgraph "Delays"
        D1[Wikidata: 100ms]
        D2[Retry: 1s, 2s, 4s]
    end

    CMD1 --> ENV1
    CMD1 --> ENV2

```

## Summary

The import system is a **four-stage pipeline** that:

1. **Fetches** administrative boundaries from OpenStreetMap via Overpass API
2. **Enriches** them with Wikimedia Commons categories via Wikidata
3. **Transforms and validates** data for database insertion
4. **Persists** to PostgreSQL with PostGIS spatial extension

Key characteristics:
- ✅ **Effect TS** for error-safe operations
- ✅ **Batch processing** for API efficiency (50 IDs) and database throughput (1000 records)
- ✅ **Retry logic** with exponential backoff (max 3 attempts)
- ✅ **Graceful degradation** - continues on non-critical errors
- ✅ **Transaction safety** - atomic batch commits
- ✅ **Data validation** - geometry checks, deduplication
- ✅ **Progress tracking** - detailed logging and statistics

For detailed information, see:
- [Architecture](./architecture.md) - System design and components
- [Data Flow](./data-flow.md) - Pipeline sequences and state transitions
- [API Interactions](./api-interactions.md) - External API integration
- [Error Handling](./error-handling.md) - Error recovery and retry logic
