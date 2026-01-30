# Import System Architecture

High-level architecture, component relationships, and system configuration for the data import pipeline.

## System Architecture Overview

```mermaid
graph TB
    subgraph "Configuration Layer"
        ENV[Environment Variables]
        CONSTANTS[Constants]
    end

    subgraph "Import Pipeline"
        ORCHESTRATOR[Main Orchestrator<br/>src/scripts/import/index.ts]

        subgraph "Stage 1: Fetch"
            OSM[OSM Fetcher<br/>fetch-osm.ts]
        end

        subgraph "Stage 2: Enrich"
            EXTRACT[ID Extractor]
            WIKIDATA[Wikidata Client<br/>wikidata-api.ts]
        end

        subgraph "Stage 3: Transform"
            TRANSFORM[Transformer<br/>transform.ts]
            VALIDATE[Geometry Validator]
        end

        subgraph "Stage 4: Persist"
            DATABASE[Database Layer<br/>database/]
            VERIFY[Verifier]
        end
    end

    subgraph "External APIs"
        OVERPASS[Overpass API<br/>OSM Boundaries]
        WD_API[Wikidata REST API<br/>Commons Categories]
    end

    subgraph "Storage"
        POSTGRES[(PostgreSQL<br/>PostGIS)]
        FILES[File System<br/>Intermediate Files]
    end

    subgraph "Utilities"
        EFFECT[Effect Helpers<br/>effect.ts]
        BATCH[Batch Processor<br/>batch.ts]
        LOGGING[Logging<br/>logging.ts]
    end

    ENV --> ORCHESTRATOR
    CONSTANTS --> ORCHESTRATOR

    ORCHESTRATOR --> OSM
    OSM --> OVERPASS
    OVERPASS --> OSM
    OSM --> FILES

    ORCHESTRATOR --> EXTRACT
    EXTRACT --> WIKIDATA
    WIKIDATA --> WD_API
    WD_API --> WIKIDATA

    ORCHESTRATOR --> TRANSFORM
    TRANSFORM --> VALIDATE

    ORCHESTRATOR --> DATABASE
    DATABASE --> POSTGRES
    DATABASE --> VERIFY
    VERIFY --> POSTGRES

    OSM -.-> EFFECT
    WIKIDATA -.-> EFFECT
    DATABASE -.-> EFFECT

    WIKIDATA -.-> BATCH
    DATABASE -.-> BATCH

    ORCHESTRATOR -.-> LOGGING
```

## Component Hierarchy

```mermaid
graph TD
    A[Import Orchestrator] --> B[Fetch Stage]
    A --> C[Enrich Stage]
    A --> D[Transform Stage]
    A --> E[Persist Stage]

    B --> B1[Build Overpass Query]
    B --> B2[Execute API Request]
    B --> B3[Parse Response]
    B --> B4[Save to File]

    C --> C1[Extract Wikidata IDs]
    C --> C2[Process in Batches]
    C --> C3[Fetch Categories]
    C --> C4[Build Category Map]

    D --> D1[Merge OSM + Wikidata]
    D --> D2[Validate Geometries]
    D --> D3[Remove Duplicates]
    D --> D4[Convert to EWKT]

    E --> E1[Connect to Database]
    E --> E2[Batch Transactions]
    E --> E3[Insert Records]
    E --> E4[Verify Results]

```

## Module Responsibilities

### File Structure

```mermaid
graph LR
    subgraph "src/scripts/"
        IMPORT[import/]
        UTILS[utils/]
        CONST[constants.ts]
    end

    subgraph "import/"
        INDEX[index.ts<br/>Orchestrator]
        FETCH[fetch-osm.ts<br/>OSM Fetcher]
        TRANSFORM[transform.ts<br/>Transformer]
        DB_DIR[database/<br/>DB Layer]
    end

    subgraph "utils/"
        EFFECT[effect.ts<br/>Effect Helpers]
        BATCH[batch.ts<br/>Batch Processor]
        WD_API[wikidata-api.ts<br/>Wikidata Client]
        LOG[logging.ts<br/>Logger]
    end

    CONST --> INDEX
    INDEX --> FETCH
    INDEX --> TRANSFORM
    INDEX --> DB_DIR
    FETCH --> EFFECT
    DB_DIR --> WD_API
    DB_DIR --> BATCH
    INDEX --> LOG

```

## Configuration Architecture

### Environment Variable Flow

```mermaid
graph TD
    ENV[Bun.env] --> VALIDATE{Validation}
    VALIDATE -->|Missing| ERROR[Error: Required vars missing]
    VALIDATE -->|Present| PARSE[Parse Types]

    PARSE --> COUNTRY["COUNTRY_CODE: string"]
    PARSE --> LEVELS["ADMIN_LEVELS: array"]
    PARSE --> BATCH["BATCH_SIZE: number"]
    PARSE --> OUTPUT["OUTPUT_DIR: string"]
    PARSE --> SKIP["SKIP_WIKIDATA: boolean"]

    COUNTRY --> CONFIG[ImportConfig]
    LEVELS --> CONFIG
    BATCH --> CONFIG
    OUTPUT --> CONFIG
    SKIP --> CONFIG

    CONFIG --> ORCH[Orchestrator]

```

### Constants Configuration

```mermaid
graph LR
    subgraph "Internal Constants"
        RETRY[RETRY_CONFIG<br/>maxAttempts: 3<br/>baseDelayMs: 1000]
        BATCH_WD[WIKIDATA_BATCH_SIZE<br/>50 IDs]
        BATCH_DB[DATABASE_BATCH_SIZE<br/>1000 records]
        DELAY[RATE_LIMIT_DELAY_MS<br/>100ms]
    end

    subgraph "Usage Locations"
        OSM[fetch-osm.ts]
        WD[wikidata-api.ts]
        DB[database/]
    end

    RETRY --> OSM
    RETRY --> WD
    BATCH_WD --> WD
    BATCH_DB --> DB
    DELAY --> WD
```

## Database Architecture

### Schema Design

```mermaid
erDiagram
    admin_boundaries ||--o| admin_boundaries : "parent-child"
    admin_boundaries {
        int id PK
        varchar wikidata_id UK "Q123 format"
        varchar commons_category "Category:Name"
        int admin_level "4, 6, 8"
        varchar name "Display name"
        geometry geom "PostGIS polygon"
        timestamp created_at
    }

    Note over admin_boundaries
        PostGIS Extension Enabled
        GIST Index on geom
        B-tree Index on wikidata_id
        B-tree Index on admin_level
    end Note
```

**Note**: PostGIS Extension Enabled, GIST Index on geom, B-tree Index on wikidata_id and admin_level

### Connection Pool Architecture

```mermaid
graph TB
    subgraph "Application Layer"
        IMPORT[Import Scripts]
    end

    subgraph "Connection Pool"
        POOL[Singleton Pool<br/>max: 10 connections<br/>idle: 10ms timeout]
    end

    subgraph "PostgreSQL"
        CONN1[Connection 1]
        CONN2[Connection 2]
        CONN3[Connection 3]
        CONN_N[Connection N]
    end

    IMPORT -->|Request Connection| POOL
    POOL -->|Assign| CONN1
    POOL -->|Assign| CONN2
    POOL -->|Assign| CONN3
    POOL -->|Assign| CONN_N

    CONN1 -->|Return| POOL
    CONN2 -->|Return| POOL
    CONN3 -->|Return| POOL
    CONN_N -->|Return| POOL

    POOL -->|Reuse| IMPORT

```

## Data Models

### Type Hierarchy

```mermaid
classDiagram
    class OSMBoundary {
        +string wikidata
        +string name
        +number admin_level
        +GeoJSONGeometry geometry
        +GeoJSONProperties tags
    }

    class AdminBoundaryImport {
        +string wikidata_id
        +string commons_category
        +number admin_level
        +string name
        +string geom EWKT
    }

    class ImportConfig {
        +string country
        +number[] adminLevels
        +number batchSize
        +string outputDir
        +boolean skipWikidata
    }

    class ImportStats {
        +number osmFetched
        +number wikidataIds
        +number categoriesMatched
        +number dbInserted
        +number errors
    }

    OSMBoundary --> AdminBoundaryImport : transforms
    ImportConfig --> ImportStats : produces
```

### State Management

```mermaid
stateDiagram-v2
    [*] --> Idle: System initialized

    Idle --> Fetching: Start import
    Fetching --> Enriching: OSM data received
    Enriching --> Transforming: Categories fetched
    Transforming --> Persisting: Data validated
    Persisting --> Verifying: Batch complete
    Verifying --> Idle: Import finished

    note right of Fetching
        Calls Overpass API
        Saves intermediate file
    end note

    note right of Enriching
        Batch processes 50 IDs
        Rate limited 100ms
    end note

    note right of Transforming
        Validates geometries
        Removes duplicates
    end note

    note right of Persisting
        Transaction batches
        1000 records each
    end note

    Verifying --> [*] : On success
    Persisting --> [*] : On error
```

## Execution Models

### Sequential Pipeline Execution

```mermaid
graph LR
    A[Start] --> B[Stage 1: Fetch OSM]
    B --> C[Stage 2: Extract Wikidata IDs]
    C --> D[Stage 3: Fetch Wikidata]
    D --> E[Stage 4: Transform]
    E --> F[Stage 5: Insert DB]
    F --> G[Stage 6: Verify]
    G --> H[End]

```

### Parallel Batch Processing (Wikidata)

```mermaid
graph TD
    INPUT[All Wikidata IDs] --> SPLIT[Split into Batches<br/>50 IDs each]

    SPLIT --> B1[Batch 1]
    SPLIT --> B2[Batch 2]
    SPLIT --> B3[Batch 3]
    SPLIT --> BN[Batch N]

    B1 --> API1[Fetch from API]
    B2 --> API2[Fetch from API]
    B3 --> API3[Fetch from API]
    BN --> APIN[Fetch from API]

    API1 --> DELAY1[Wait 100ms]
    API2 --> DELAY2[Wait 100ms]
    API3 --> DELAY3[Wait 100ms]
    APIN --> DELAYN[Wait 100ms]

    DELAY1 --> MERGE[Merge Results]
    DELAY2 --> MERGE
    DELAY3 --> MERGE
    DELAYN --> MERGE

    MERGE --> OUTPUT[Category Map]

```

## Technology Stack

```mermaid
graph TB
    subgraph "Runtime & Language"
        BUN[Bun 1.3.8]
        TS[TypeScript ESNext]
    end

    subgraph "Core Libraries"
        EFFECT[Effect TS 3.19.15<br/>Error handling]
        PG[pg 8.17.2<br/>PostgreSQL client]
    end

    subgraph "APIs"
        OVERPASS_API[Overpass API<br/>OSM data]
        WIKIDATA_API[Wikidata REST API<br/>Categories]
    end

    subgraph "Database"
        POSTGRES_DB[PostgreSQL 17]
        POSTGIS[PostGIS 3.4<br/>Spatial extension]
    end

    BUN --> TS
    TS --> EFFECT
    TS --> PG

    EFFECT --> OVERPASS_API
    EFFECT --> WIKIDATA_API

    PG --> POSTGRES_DB
    POSTGRES_DB --> POSTGIS

```
