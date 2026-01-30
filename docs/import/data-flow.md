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

    subgraph "Stage 2: Extract Wikidata IDs"
        A8 --> B1[Extract Wikidata IDs from Tags]
        B1 --> B2[Format IDs<br/>Strip URL and Q prefix]
        B2 --> B3{Has IDs?}
        B3 -->|No| B4[Skip Wikidata Stage]
        B3 -->|Yes| B5[Pass to Stage 3]
    end

    subgraph "Stage 3: Fetch Wikidata Categories"
        B5 --> C1[Split into Batches of 50]
        C1 --> C2[For Each Batch]
        C2 --> C3[GET Wikidata API]
        C3 --> C4[Extract P373 Property]
        C4 --> C5[Add to Category Map]
        C5 --> C6{More Batches?}
        C6 -->|Yes| C7[Wait 100ms]
        C7 --> C2
        C6 -->|No| C8[Complete Category Map]
    end

    subgraph "Stage 4: Transform"
        B4 --> D1[Read OSM Boundaries]
        C8 --> D1
        D1 --> D2[For Each Boundary]
        D2 --> D3{Has Wikidata Tag?}
        D3 -->|No| D4[Skip Record]
        D3 -->|Yes| D5{Has Category?}
        D5 -->|No| D4
        D5 -->|Yes| D6[Validate Geometry]
        D6 --> D7{Valid?}
        D7 -->|No| D4
        D7 -->|Yes| D8[Convert to EWKT]
        D8 --> D9[Add to Results]
        D9 --> D10{More Records?}
        D10 -->|Yes| D2
        D10 -->|No| D11[Remove Duplicates]
        D11 --> D12[Final Dataset]
    end

    subgraph "Stage 5: Database Insert"
        D12 --> E1[Connect to PostgreSQL]
        E1 --> E2[Split into Batches of 1000]
        E2 --> E3[For Each Batch]
        E3 --> E4[Begin Transaction]
        E4 --> E5[Insert Records<br/>ON CONFLICT DO UPDATE]
        E5 --> E6{Success?}
        E6 -->|Yes| E7[Commit Transaction]
        E6 -->|No| E8[Rollback]
        E8 --> E9[Log Error]
        E7 --> E10{More Batches?}
        E10 -->|Yes| E3
        E10 -->|No| E11[Close Connection]
    end

    subgraph "Stage 6: Verification"
        E11 --> F1[Query Total Count]
        F1 --> F2[Group by Admin Level]
        F2 --> F3[Check for NULLs]
        F3 --> F4[Validate Geometries]
        F4 --> F5[Display Statistics]
        F5 --> F6[Import Complete]
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

    Note over Orch: Stage 2: Extract Wikidata IDs
    Orch->>Orch: Extract and format IDs

    Note over Orch,Wikidata: Stage 3: Fetch Wikidata Categories
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

    Note over Orch,Transform: Stage 4: Transform Data
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

    Note over Orch,DB: Stage 5: Insert to Database
    Orch->>DB: batchInsertBoundaries(data)
    activate DB
    loop For each batch of 1000 records
        DB->>PG: BEGIN TRANSACTION
        DB->>PG: INSERT INTO admin_boundaries
        PG-->>DB: Result
        DB->>PG: COMMIT
    end
    DB-->>Orch: Import result
    deactivate DB

    Note over Orch,PG: Stage 6: Verification
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
    Note over Fetch: out:json timeout:90<br/>relation admin_level filter<br/>wikidata tag required<br/>out geom

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
            DB->>PG: INSERT INTO admin_boundaries<br/>(wikidata_id, commons_category,<br/>admin_level, name, geom)<br/>VALUES ($1, $2, $3, $4, $5)<br/>ON CONFLICT DO UPDATE
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

    FetchingOSM --> ExtractingIDs: OSM data ready

    state ExtractingIDs {
        [*] --> ParseWikidataTags
        ParseWikidataTags --> FormatIDs
        FormatIDs --> [*]
    }

    ExtractingIDs --> FetchingWikidata: Has IDs
    ExtractingIDs --> SkippingWikidata: No IDs or SKIP_WIKIDATA

    state FetchingWikidata {
        [*] --> CreateBatches
        CreateBatches --> ProcessingBatches

        ProcessingBatches --> FetchBatch: Next batch
        FetchBatch --> ExtractCategories
        ExtractCategories --> RateLimitDelay
        RateLimitDelay --> ProcessingBatches: More batches?
        ProcessingBatches --> [*]: All batches done
    }

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
