# Data Flow Documentation

Complete data flow diagrams, sequence diagrams, and state transitions for the import pipeline.

## Complete Data Flow Overview

```mermaid
graph TB
    subgraph "Stage 1: Fetch OSM Data"
        A1[Start Import] --> A2[Build Overpass QL Query]
        A2 --> A3[POST to Overpass API]
        A3 --> A4{Retry on Failure?}
        A4 -->|Yes| A5[Exponential Backoff]
        A5 --> A3
        A4 -->|No| A6[Parse JSON Response]
        A6 --> A7["Convert to OSMBoundary array"]
        A7 --> A8["Save to output/osm-country.json"]
    end

    subgraph "Stage 2: Extract & Enrich"
        A8 --> B1[Extract Wikidata IDs]
        B1 --> B2{Has IDs?}
        B2 -->|No| B3[Skip Wikidata Stage]
        B2 -->|Yes| B4[Split into Batches of 50]
        B4 --> B5[For Each Batch]
        B5 --> B6[POST to Wikidata API]
        B6 --> B7[Extract P373 Property]
        B7 --> B8[Add to Category Map]
        B8 --> B9{More Batches?}
        B9 -->|Yes| B10[Wait 100ms]
        B10 --> B5
        B9 -->|No| B11[Complete Category Map]
    end

    subgraph "Stage 3: Transform"
        B3 --> C1[Read OSM Boundaries]
        B11 --> C1
        C1 --> C2[For Each Boundary]
        C2 --> C3{Has Wikidata Tag?}
        C3 -->|No| C4[Skip Record]
        C3 -->|Yes| C5{Has Category?}
        C5 -->|No| C4
        C5 -->|Yes| C6[Validate Geometry]
        C6 --> C7{Valid?}
        C7 -->|No| C4
        C7 -->|Yes| C8[Convert to EWKT]
        C8 --> C9[Add to Results]
        C9 --> C10{More Records?}
        C10 -->|Yes| C2
        C10 -->|No| C11[Remove Duplicates]
        C11 --> C12[Final Dataset]
    end

    subgraph "Stage 4: Database Insert"
        C12 --> D1[Connect to PostgreSQL]
        D1 --> D2[Split into Batches of 1000]
        D2 --> D3[For Each Batch]
        D3 --> D4[Begin Transaction]
        D4 --> D5[Insert Records]
        D5 --> D6{Success?}
        D6 -->|Yes| D7[Commit Transaction]
        D6 -->|No| D8[Rollback]
        D8 --> D9[Log Error]
        D7 --> D10{More Batches?}
        D10 -->|Yes| D3
        D10 -->|No| D11[Close Connection]
    end

    subgraph "Stage 5: Verification"
        D11 --> E1[Query Total Count]
        E1 --> E2[Group by Admin Level]
        E2 --> E3[Check for NULLs]
        E3 --> E4[Validate Geometries]
        E4 --> E5[Display Statistics]
        E5 --> E6[Import Complete]
    end

```

## Sequence Diagrams

### Main Import Pipeline Sequence

```mermaid
sequenceDiagram
    participant CLI as CLI
    participant Orch as Orchestrator
    participant OSM as OSM Fetcher
    participant Overpass as Overpass API
    participant WD as Wikidata Client
    participant Wikidata as Wikidata API
    participant Transform as Transformer
    participant DB as Database Layer
    participant PG as PostgreSQL

    CLI->>Orch: importData(config)
    activate Orch

    Note over Orch,OSM: Stage 1: Fetch OSM Data
    Orch->>OSM: fetchOSMData(config)
    activate OSM
    loop Retry up to 3 times
        OSM->>Overpass: POST query (Overpass QL)
        Overpass-->>OSM: JSON response
    end
    OSM->>OSM: Parse and convert to OSMBoundary[]
    OSM->>OSM: Save to file (if OUTPUT_DIR set)
    OSM-->>Orch: OSMBoundary[]
    deactivate OSM

    Note over Orch,WD: Stage 2: Fetch Wikidata Categories
    Orch->>Orch: Extract Wikidata IDs
    Orch->>WD: fetchWikimediaCategoriesBatch(ids)
    activate WD
    loop For each batch of 50 IDs
        WD->>Wikidata: GET /w/api.php (wbgetentities)
        Wikidata-->>WD: Entity data with P373
        WD->>WD: Extract Commons category
        WD->>WD: Wait 100ms (rate limit)
    end
    WD-->>Orch: Map<string, string>
    deactivate WD

    Note over Orch,Transform: Stage 3: Transform Data
    Orch->>Transform: transformBoundaries(osmData, categories)
    activate Transform
    loop For each OSM boundary
        Transform->>Transform: Match Wikidata category
        Transform->>Transform: Validate geometry
        Transform->>Transform: Convert to EWKT
    end
    Transform->>Transform: Remove duplicates
    Transform-->>Orch: AdminBoundaryImport[]
    deactivate Transform

    Note over Orch,DB: Stage 4: Insert to Database
    Orch->>DB: batchInsertBoundaries(data)
    activate DB
    loop For each batch of 1000 records
        DB->>PG: BEGIN TRANSACTION
        DB->>PG: INSERT INTO boundaries
        PG-->>DB: Result
        DB->>PG: COMMIT
    end
    DB-->>Orch: Import result
    deactivate DB

    Note over Orch,PG: Stage 5: Verification
    Orch->>PG: SELECT COUNT(*)
    PG-->>Orch: Total count
    Orch->>PG: SELECT admin_level, COUNT(*)
    PG-->>Orch: Counts by level
    Orch->>CLI: Display statistics
    deactivate Orch
```

### OSM Fetch Sequence

```mermaid
sequenceDiagram
    participant Script as Import Script
    participant Fetch as fetchOSMData
    participant Retry as Retry Logic
    participant Overpass as Overpass API
    participant File as File System

    Script->>Fetch: fetchOSMData(config)
    activate Fetch

    Fetch->>Fetch: Build Overpass QL query
    Note over Fetch: out:json timeout:25<br/>relation admin_level filter<br/>wikidata tag required<br/>out geom

    Fetch->>Retry: Execute with retry
    activate Retry

    loop Max 3 attempts
        Retry->>Overpass: POST /api/interpreter
        activate Overpass
        Overpass-->>Retry: JSON Response
        deactivate Overpass

        Retry->>Retry: Check for errors
        alt Error detected
            Retry->>Retry: Calculate exponential backoff
            Retry->>Retry: Wait (1s, 2s, 4s...)
        end
    end

    Retry-->>Fetch: Parsed data
    deactivate Retry

    Fetch->>Fetch: Convert to OSMBoundary[]
    Note over Fetch: Extract wikidata, name,<br/>admin_level, geometry

    alt OUTPUT_DIR configured
        Fetch->>File: Write osm-country.json file
        File-->>Fetch: Confirmation
    end

    Fetch-->>Script: OSMBoundary[]
    deactivate Fetch
```

### Wikidata Enrichment Sequence

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant WD as Wikidata Client
    participant Batch as Batch Processor
    participant API as Wikidata API
    participant Result as Category Map

    Orch->>WD: fetchWikimediaCategoriesBatch(ids)
    activate WD

    WD->>WD: Split IDs into batches of 50
    Note over WD: Example: 250 IDs → 5 batches

    WD->>Batch: processInBatches(ids, batchSize=50)
    activate Batch

    loop For each batch
        Batch->>Batch: Build API request
        Note over Batch: wbgetentities<br/>50 IDs per request<br/>props=claims

        Batch->>API: GET /w/api.php
        activate API
        API-->>Batch: JSON response
        deactivate API

        Batch->>Batch: Parse entities
        loop For each entity
            Batch->>Batch: Extract P373 property
            alt P373 exists
                Batch->>Batch: Store category in map
            else P373 missing
                Batch->>Batch: Skip entity (no error)
            end
        end

        Batch->>Batch: Wait 100ms (rate limit)
        Batch->>Batch: Log progress
    end

    Batch-->>WD: Map<string, string>
    deactivate Batch

    WD-->>Orch: Category Map
    deactivate WD

    Note over Result: Map structure:<br/>{<br/>  "Q123": "Category:Name1",<br/>  "Q456": "Category:Name2"<br/>}
```

### Database Insert Sequence

```mermaid
sequenceDiagram
    participant Import as Import Script
    participant DB as Database Layer
    participant Pool as Connection Pool
    participant PG as PostgreSQL
    participant Tx as Transaction

    Import->>DB: batchInsertBoundaries(data)
    activate DB

    DB->>Pool: Get connection
    activate Pool
    Pool-->>DB: Connection
    deactivate Pool

    DB->>DB: Split data into batches (1000 records)
    Note over DB: Example: 5000 records → 5 batches

    loop For each batch
        DB->>PG: BEGIN
        activate Tx

        loop For each record
            DB->>PG: INSERT INTO boundaries<br/>(wikidata_id, commons_category,<br/>admin_level, name, geom)<br/>VALUES ($1, $2, $3, $4, $5)
            PG-->>DB: Insert result
        end

        alt All inserts successful
            DB->>PG: COMMIT
            PG-->>DB: Commit success
            DB->>DB: Track successful inserts
        else Error occurred
            DB->>PG: ROLLBACK
            PG-->>DB: Rollback complete
            DB->>DB: Log error for this batch
        end

        deactivate Tx
    end

    DB->>Pool: Release connection
    activate Pool
    Pool-->>DB: Released
    deactivate Pool

    DB-->>Import: Import result summary
    deactivate DB
```

### Transform and Validation Sequence

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant Transform as Transformer
    participant OSM as OSM Boundary
    participant Wiki as Category Map
    participant Valid as Validator
    participant Result as Final Dataset

    Orch->>Transform: transformBoundaries(osmData, categories)
    activate Transform

    Transform->>Result: Initialize empty array

    loop For each OSM boundary
        Transform->>OSM: Get boundary data
        activate OSM
        OSM-->>Transform: {wikidata, name, admin_level, geometry, tags}
        deactivate OSM

        Transform->>Transform: Check for wikidata tag
        alt No wikidata tag
            Transform->>Transform: Skip (log warning)
        else Has wikidata tag
            Transform->>Wiki: Lookup category
            activate Wiki
            Wiki-->>Transform: category name or undefined
            deactivate Wiki

            alt No category found
                Transform->>Transform: Skip (log warning)
            else Category found
                Transform->>Valid: Validate geometry
                activate Valid

                Valid->>Valid: Check if polygon is valid
                Valid->>Valid: Convert GeoJSON → EWKT
                Valid-->>Transform: EWKT geometry
                deactivate Valid

                alt Invalid geometry
                    Transform->>Transform: Skip (log error)
                else Valid geometry
                    Transform->>Result: Add AdminBoundaryImport
                    Note over Result: wikidata_id,<br/>commons_category,<br/>admin_level,<br/>name, geom (EWKT)
                end
            end
        end
    end

    Transform->>Result: Remove duplicates
    Note over Result: Deduplicate by wikidata_id<br/>Keep first occurrence

    Transform-->>Orch: AdminBoundaryImport[]
    deactivate Transform
```

## State Diagrams

### Import Process State Machine

```mermaid
stateDiagram-v2
    [*] --> Initializing: Load config

    Initializing --> FetchingOSM: Config validated

    state FetchingOSM {
        [*] --> BuildQuery
        BuildQuery --> CallAPI
        CallAPI --> ParsingResponse
        ParsingResponse --> SavingFile
        SavingFile --> [*]
    }

    FetchingOSM --> FetchingWikidata: OSM data ready

    state FetchingWikidata {
        [*] --> ExtractIDs
        ExtractIDs --> CreateBatches
        CreateBatches --> ProcessingBatches

        ProcessingBatches --> FetchBatch: Next batch
        FetchBatch --> ExtractCategories
        ExtractCategories --> RateLimitDelay
        RateLimitDelay --> ProcessingBatches: More batches?
        ProcessingBatches --> [*]: All batches done
    }

    FetchingWikidata --> SkippingWikidata: No IDs or SKIP_WIKIDATA

    state SkippingWikidata {
        [*] --> LogSkip
        LogSkip --> [*]
    }

    SkippingWikidata --> Transforming
    FetchingWikidata --> Transforming

    state Transforming {
        [*] --> ProcessingRecords
        ProcessingRecords --> ValidateRecord: Next record
        ValidateRecord --> Enriching
        Enriching --> CheckingGeometry
        CheckingGeometry --> ProcessingRecords: More records?
        ProcessingRecords --> Deduplicating
        Deduplicating --> [*]
    }

    Transforming --> InsertingDatabase

    state InsertingDatabase {
        [*] --> CreatingBatches
        CreatingBatches --> ProcessingBatch: Next batch
        ProcessingBatch --> BeginTransaction
        BeginTransaction --> InsertingRecords
        InsertingRecords --> Committing
        Committing --> ProcessingBatch: More batches?
        ProcessingBatch --> [*]: All done
    }

    InsertingDatabase --> Verifying

    state Verifying {
        [*] --> CountingRecords
        CountingRecords --> GroupingByLevel
        GroupingByLevel --> CheckingNulls
        CheckingNulls --> ValidatingGeometries
        ValidatingGeometries --> [*]
    }

    Verifying --> [*]: Complete

    Initializing --> [*]: Config error
    FetchingOSM --> [*]: API failure
    InsertingDatabase --> [*]: Database error
```

### Data Transformation States

```mermaid
stateDiagram-v2
    [*] --> RawOSM: From Overpass API

    state RawOSM {
        [*] --> ParsedJSON
        ParsedJSON --> GeoJSONFeatures
    }

    RawOSM --> Enriched: Wikidata lookup

    state Enriched {
        [*] --> CategoryMatched
        CategoryMatched --> MetadataMerged
    }

    Enriched --> Validated: Geometry check

    state Validated {
        [*] --> GeometryChecked
        GeometryChecked --> EWKTConverted
    }

    Validated --> Deduplicated: Remove duplicates

    state Deduplicated {
        [*] --> UniqueByWikidataID
        UniqueByWikidataID --> FinalDataset
    }

    Deduplicated --> DatabaseReady: For insertion

    state DatabaseReady {
        [*] --> Batched
        Batched --> TransactionWrapped
    }

    DatabaseReady --> [*]: Inserted

    note right of RawOSM
        GeoJSON format
        From Overpass API
    end note

    note right of Enriched
        Has Commons category
        From Wikidata P373
    end note

    note right of Validated
        EWKT format
        ST_IsValid() checked
    end note

    note right of DatabaseReady
        AdminBoundaryImport[]
        Ready for INSERT
    end note
```

## Entity Flow Diagrams

### Data Entity Transformations

```mermaid
graph LR
    subgraph "Overpass API Response"
        OSM[Overpass JSON]
    end

    subgraph "Intermediate Types"
        GEO[GeoJSON Feature]
        OSMB[OSMBoundary]
    end

    subgraph "Enriched Types"
        ENRICH[EnrichedBoundary]
        VALID[ValidatedBoundary]
    end

    subgraph "Database Types"
        IMPORT[AdminBoundaryImport]
        ROW[Database Row]
    end

    OSM -->|Parse| GEO
    GEO -->|Extract| OSMB
    OSMB -->|Add category| ENRICH
    ENRICH -->|Validate| VALID
    VALID -->|Convert EWKT| IMPORT
    IMPORT -->|INSERT| ROW

```

### Data Enrichment Flow

```mermaid
graph TD
    subgraph "Input Data"
        OSM1[OSM Boundary 1<br/>wikidata=Q123<br/>name=Paris<br/>admin_level=6]
        OSM2[OSM Boundary 2<br/>wikidata=Q456<br/>name=Lyon<br/>admin_level=6]
        OSM3[OSM Boundary 3<br/>wikidata=Q789<br/>name=Marseille<br/>admin_level=6]
    end

    subgraph "Wikidata Lookup"
        CAT1[Q123 → Category:Paris]
        CAT2[Q456 → Category:Lyon]
        CAT3[Q789 → Category:Marseille]
    end

    subgraph "Enriched Data"
        ENR1[Paris + Category:Paris]
        ENR2[Lyon + Category:Lyon]
        ENR3[Marseille + Category:Marseille]
    end

    subgraph "Validation"
        V1[✓ Valid geometry]
        V2[✓ Valid geometry]
        V3[✓ Valid geometry]
    end

    subgraph "Output"
        OUT1[AdminBoundaryImport 1]
        OUT2[AdminBoundaryImport 2]
        OUT3[AdminBoundaryImport 3]
    end

    OSM1 --> CAT1
    OSM2 --> CAT2
    OSM3 --> CAT3

    CAT1 --> ENR1
    CAT2 --> ENR2
    CAT3 --> ENR3

    ENR1 --> V1
    ENR2 --> V2
    ENR3 --> V3

    V1 --> OUT1
    V2 --> OUT2
    V3 --> OUT3

```

## Filter and Decision Flows

### Record Filtering Logic

```mermaid
graph TD
    START[Process OSM Boundary] --> CHECK_WD{Has wikidata tag?}

    CHECK_WD -->|No| SKIP1[❌ Skip: No Wikidata ID]
    CHECK_WD -->|Yes| CHECK_CAT{Has Commons<br/>category?}

    CHECK_CAT -->|No| SKIP2[❌ Skip: No category]
    CHECK_CAT -->|Yes| CHECK_GEOM{Valid<br/>geometry?}

    CHECK_GEOM -->|No| SKIP3[❌ Skip: Invalid geometry]
    CHECK_GEOM -->|Yes| CHECK_DUP{Duplicate<br/>wikidata_id?}

    CHECK_DUP -->|Yes| SKIP4[❌ Skip: Duplicate]
    CHECK_DUP -->|No| SUCCESS[✓ Include in import]

    SKIP1 --> LOG1[Log: Missing wikidata tag]
    SKIP2 --> LOG2[Log: No category found]
    SKIP3 --> LOG3[Log: Invalid geometry]
    SKIP4 --> LOG4[Log: Duplicate entry]

    LOG1 --> END[End of record processing]
    LOG2 --> END
    LOG3 --> END
    LOG4 --> END

    SUCCESS --> IMPORT[Add to import batch]

```

### Batch Processing Flow

```mermaid
graph TD
    START[Start Batch Processing] --> SIZE{Determine<br/>Batch Size}

    SIZE -->|Wikidata API| BATCH_WD[50 IDs]
    SIZE -->|Database| BATCH_DB[1000 records]

    BATCH_WD --> SPLIT_WD[Split into chunks]
    BATCH_DB --> SPLIT_DB[Split into chunks]

    SPLIT_WD --> LOOP_WD[For each chunk]
    SPLIT_DB --> LOOP_DB[For each chunk]

    LOOP_WD --> PROCESS_WD[Process batch]
    LOOP_DB --> PROCESS_DB[Process batch]

    PROCESS_WD --> DELAY_WD[Wait 100ms]
    PROCESS_DB --> NO_DELAY[No delay]

    DELAY_WD --> MORE_WD{More chunks?}
    NO_DELAY --> MORE_DB{More chunks?}

    MORE_WD -->|Yes| LOOP_WD
    MORE_DB -->|Yes| LOOP_DB

    MORE_WD -->|No| COMPLETE_WD[Complete]
    MORE_DB -->|No| COMPLETE_DB[Complete]

    COMPLETE_WD --> END[End]
    COMPLETE_DB --> END

```
