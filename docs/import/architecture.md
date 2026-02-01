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

        subgraph "Stage 1: Hierarchical Import"
            HIER[Hierarchical Import<br/>hierarchical/index.ts]
            OVERPASS[Overpass API]
        end

        subgraph "Stage 2: Extract & Enrich"
            EXTRACT[ID Extractor<br/>from osm_relations]
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
        OVERPASS_API[Overpass API<br/>Relation Discovery & Geometries]
        WD_API[Wikidata REST API<br/>Commons Categories]
    end

    subgraph "Storage"
        POSTGRES[(PostgreSQL<br/>PostGIS)]
        OSM_REL[(osm_relations<br/>Raw OSM Data)]
        ADMIN_BND[(admin_boundaries<br/>Enriched API Data)]
        FILES[File System<br/>Intermediate Files]
    end

    subgraph "Utilities"
        EFFECT[Effect Helpers<br/>effect-helpers.ts]
        BATCH[Batch Processor<br/>batch.ts]
        LOGGING[Logging<br/>logging.ts]
    end

    ENV --> ORCHESTRATOR
    CONSTANTS --> ORCHESTRATOR

    ORCHESTRATOR --> HIER
    HIER --> OVERPASS
    OVERPASS --> OVERPASS_API
    OVERPASS_API --> OSM_REL

    ORCHESTRATOR --> EXTRACT
    EXTRACT --> OSM_REL

    ORCHESTRATOR --> WIKIDATA
    WIKIDATA --> WD_API
    WD_API --> WIKIDATA

    ORCHESTRATOR --> TRANSFORM
    TRANSFORM --> VALIDATE
    TRANSFORM --> OSM_REL
    TRANSFORM --> WIKIDATA

    ORCHESTRATOR --> DATABASE
    DATABASE --> ADMIN_BND
    DATABASE --> VERIFY
    VERIFY --> POSTGRES

    HIER -.-> EFFECT
    WIKIDATA -.-> EFFECT
    DATABASE -.-> EFFECT

    WIKIDATA -.-> BATCH
    DATABASE -.-> BATCH

    ORCHESTRATOR -.-> LOGGING
```

## Two-Table Architecture

```mermaid
graph LR
    subgraph "Hierarchical Import"
        A1[Overpass API] --> A2[Discover Relations]
        A2 --> A3[Fetch Relation IDs]
        A3 --> A4[Fetch Geometries]
        A4 --> A5[Store in osm_relations]
    end

    subgraph "Main Pipeline"
        A5 --> B1[Extract Wikidata IDs]
        B1 --> B2[Wikidata API]
        B2 --> B3[Fetch Categories]
        B3 --> B4[Transform & Validate]
        B4 --> B5[Store in admin_boundaries]
    end

    subgraph "API Usage"
        B5 --> C1[Reverse Geocoding]
        C1 --> C2[/geocode endpoint]
    end
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
        HIER[hierarchical/<br/>Hierarchical Import]
        TRANSFORM[transform.ts<br/>Transformer]
        DB_DIR[database/<br/>DB Layer]
    end

    subgraph "hierarchical/"
        H_INDEX[index.ts<br/>Entry Point]
        FETCH_REL[fetch-relations.ts<br/>Overpass Client]
        FETCH_GEOM[fetch-geometry.ts<br/>Overpass Client]
        H_DB[database/<br/>OSM Relations DB]
    end

    subgraph "utils/"
        EFFECT[effect-helpers.ts<br/>Effect Helpers]
        BATCH[batch.ts<br/>Batch Processor]
        WD_API[wikidata-api.ts<br/>Wikidata Client]
        LOG[logging.ts<br/>Logger]
    end

    CONST --> INDEX
    INDEX --> HIER
    INDEX --> TRANSFORM
    INDEX --> DB_DIR
    HIER --> EFFECT
    DB_DIR --> WD_API
    DB_DIR --> BATCH
    INDEX --> LOG

    H_INDEX --> FETCH_REL
    H_INDEX --> FETCH_GEOM
    H_INDEX --> H_DB
```

## Database Architecture

### Schema Design

```mermaid
erDiagram
    osm_relations ||--o| osm_relations : "parent-child"
    osm_relations {
        bigint id PK "OSM Relation ID"
        varchar wikidata_id UK "Q123 format"
        int admin_level "2-11"
        varchar name "Display name"
        geometry geom "PostGIS polygon"
        varchar iso3 "ISO3 code"
        bigint parent_id FK "Parent relation"
        timestamp created_at
    }

    admin_boundaries {
        int id PK
        varchar wikidata_id UK "Q123 format"
        varchar commons_category "Category:Name"
        int admin_level "4, 6, 8"
        varchar name "Display name"
        geometry geom "PostGIS polygon"
        timestamp created_at
    }

    Note over osm_relations,admin_boundaries
        osm_relations: Raw OSM data with full geometries
        admin_boundaries: Enriched data for API
        Populated by hierarchical import → main pipeline
    end Note
```

**Indexes**:
- `osm_relations`: GIST on geom, b-tree on wikidata_id, admin_level, iso3
- `admin_boundaries`: GIST on geom, b-tree on wikidata_id, admin_level

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
    class OSMRelation {
        +string id
        +string wikidata_id
        +number admin_level
        +string name
        +string geom EWKT
        +string iso3
        +string parent_id
    }

    class AdminBoundaryImport {
        +string wikidata_id
        +string commons_category
        +number admin_level
        +string name
        +string geom EWKT
    }

    class ImportConfig {
        +string countryCode
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

    OSMRelation --> AdminBoundaryImport : transforms
    ImportConfig --> ImportStats : produces
```

## Execution Models

### Sequential Pipeline Execution

```mermaid
graph LR
    A[Start] --> B[Stage 1: Hierarchical Import]
    B --> C[Stage 2: Extract Wikidata IDs]
    C --> D[Stage 3: Fetch Wikidata]
    D --> E[Stage 4: Transform]
    E --> F[Stage 5: Insert DB]
    F --> G[Stage 6: Verify]
    G --> H[End]
```

### Hierarchical Import Flow

```mermaid
graph TD
    START[Start Hierarchical Import] --> INIT[Initialize Progress]

    INIT --> FETCH_REL[Fetch Relation IDs<br/>from Overpass]
    FETCH_REL --> LOOP_REL{For Each Admin Level}

    LOOP_REL --> FETCH_GEOM[Fetch Geometries<br/>from Overpass]
    FETCH_GEOM --> STORE[Store in osm_relations]
    STORE --> UPDATE[Update Progress]
    UPDATE --> LOOP_REL

    LOOP_REL --> COMPLETE[Mark Complete]
    COMPLETE --> END[End]
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
        OVERPASS_API[Overpass API<br/>Relation discovery & geometries]
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
