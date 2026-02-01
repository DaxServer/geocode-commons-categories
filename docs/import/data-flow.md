# Data Flow Documentation

Data flow diagrams for the import pipeline showing how data moves through each stage.

## Complete Pipeline Flow

```mermaid
graph TB
    START[Start Import] --> S1[Stage 1: Fetch OSM]

    subgraph "Stage 1: Fetch OSM Data"
        S1_1[Discover Relations by Admin Level]
        S1_2[Fetch Child Relations Hierarchically]
        S1_3[Fetch Full Geometries]
        S1_4[Store in osm_relations]
    end

    S1_4 --> S2[Stage 2: Extract Wikidata IDs]

    subgraph "Stage 2: Extract Wikidata IDs"
        S2_1[Query osm_relations Table]
        S2_2[Filter NULL Values]
        S2_3[Return Unique ID Array]
    end

    S2_3 --> S3[Stage 3: Fetch Wikidata Categories]

    subgraph "Stage 3: Fetch Wikidata Categories"
        S3_1[Split into Batches of 50]
        S3_2[Fetch via wbgetentities API]
        S3_3[Extract P373 Property]
        S3_4[Build Category Map]
    end

    S3_4 --> S4[Stage 4: Transform and Enrich]

    subgraph "Stage 4: Transform and Enrich"
        S4_1[Merge OSM + Wikidata Data]
        S4_2[Validate Geometries]
        S4_3[Remove Duplicates]
        S4_4[Filter Missing Categories]
    end

    S4_4 --> S5[Stage 5: Database Insert]

    subgraph "Stage 5: Database Insert"
        S5_1[Split into Batches of 1000]
        S5_2[Insert with ON CONFLICT]
        S5_3[Commit Transaction]
    end

    S5_3 --> S6[Stage 6: Verification]

    subgraph "Stage 6: Verification"
        S6_1[Query Total Count]
        S6_2[Group by Admin Level]
        S6_3[Validate Geometries]
    end

    S6_3 --> COMPLETE[Import Complete]
```

## OSM Fetch Sequence (Stage 1)

```mermaid
sequenceDiagram
    participant CLI as CLI
    participant Import as import.ts
    participant Overpass as Overpass API
    participant DB as osm_relations Table

    CLI->>Import: bun import (COUNTRY_CODE=BEL)
    activate Import

    Note over Import: Level 4: Country Relations
    Import->>Overpass: POST (buildCountryLevelQuery)
    Note over Overpass: relation["boundary"="administrative"]<br/>["admin_level"="4"]<br/>["ISO3166-1:alpha3"="BEL"]
    Overpass-->>Import: Relation IDs [123, 456, 789]

    Import->>Overpass: POST (buildGeometryQuery)
    Note over Overpass: relation(id:123,456,789)<br/>way(r)<br/>out geom
    Overpass-->>Import: GeoJSON Polygons

    Import->>DB: INSERT INTO osm_relations
    Note over DB: id, wikidata_id, admin_level,<br/>name, geom, iso3

    loop For each admin level
        Import->>Import: Use previous level as parent search area
        Import->>Overpass: POST (buildChildQuery)
        Note over Overpass: relation(admin_level=N)<br/>(area:3600000000+parentId)
        Overpass-->>Import: Child Relation IDs
    end

    Import-->>CLI: OSM fetch complete
    deactivate Import
```

## Wikidata Fetch Sequence (Stage 3)

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant WD as wikidata-api.ts
    participant API as Wikidata API
    participant Map as Category Map

    Orch->>WD: fetchWikimediaCategoriesBatch(ids)
    activate WD

    WD->>WD: Deduplicate IDs (3000 → 2500 unique)

    loop For each batch of 50 IDs
        WD->>API: GET /w/api.php
        Note over API: action=wbgetentities<br/>ids=Q1|Q2|...|Q50<br/>props=claims

        API-->>WD: JSON Response
        Note over WD: entities: {<br/>  Q123: {claims: {P373: [...]}},<br/>  Q456: {claims: {P373: [...]}}<br/>}

        WD->>WD: Extract P373 values
        WD->>Map: Add entries ("Q123" → "Category:Paris")

        WD->>WD: Wait 100ms (rate limit)
    end

    WD-->>Orch: Map<string, string> (2000 entries)
    deactivate WD
```

## Transform Sequence (Stage 4)

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant DB as osm_relations
    participant Transform as transform.ts
    participant Categories as Category Map
    participant Result as AdminBoundaryImport[]

    Orch->>DB: SELECT * FROM osm_relations WHERE geom IS NOT NULL
    DB-->>Orch: 3000 rows

    Orch->>Transform: transformDatabaseRows(rows, categories)
    activate Transform

    loop For each row
        Transform->>Transform: Check wikidata_id
        alt No wikidata_id
            Transform->>Transform: Skip row
        else Has wikidata_id
            Transform->>Categories: Get(category)
            Categories-->>Transform: "Category:Name" or undefined

            alt No category
                Transform->>Transform: Skip row
            else Has category
                Transform->>Transform: Validate EWKT format
                Transform->>Transform: Check polygon structure

                alt Invalid geometry
                    Transform->>Transform: Skip row
                else Valid geometry
                    Transform->>Result: Add AdminBoundaryImport
                end
            end
        end
    end

    Transform->>Result: Remove duplicates (by wikidata_id)
    Transform-->>Orch: 2500 AdminBoundaryImport[]
    deactivate Transform
```

## Database Insert Sequence (Stage 5)

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant DB as database/insert.ts
    participant PG as PostgreSQL

    Orch->>DB: batchInsertBoundaries(boundaries, 1000)
    activate DB

    DB->>DB: Split into 3 batches (2950 records)

    loop For each batch
        DB->>PG: BEGIN TRANSACTION

        loop For each record
            DB->>PG: INSERT INTO admin_boundaries
            Note over PG: ON CONFLICT (wikidata_id) DO UPDATE<br/>SET commons_category, admin_level,<br/>name, geom
        end

        alt Success
            DB->>PG: COMMIT
            Note over DB: Batch committed: 1000 records
        else Error
            DB->>PG: ROLLBACK
            Note over DB: Batch failed, logging error
        end
    end

    DB-->>Orch: {inserted: 2950, errors: []}
    deactivate DB
```

## Verification Sequence (Stage 6)

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant Verify as verification.ts
    participant PG as PostgreSQL

    Orch->>Verify: verifyImport()
    activate Verify

    Verify->>PG: SELECT COUNT(*) FROM admin_boundaries
    PG-->>Verify: 2950

    Verify->>PG: SELECT admin_level, COUNT(*) FROM admin_boundaries GROUP BY admin_level
    PG-->>Verify: [{level:4, count:50}, {level:6, count:300}, {level:8, count:2600}]

    Verify->>PG: SELECT COUNT(*) FROM admin_boundaries WHERE geom IS NULL
    PG-->>Verify: 0

    Verify->>PG: SELECT COUNT(*) FROM admin_boundaries WHERE NOT ST_IsValid(geom)
    PG-->>Verify: 0

    Verify-->>Orch: Display summary statistics
    deactivate Verify
```

## Data Volume Flow

```mermaid
graph LR
    OSM[OSM Fetch<br/>3000 relations] --> WD[Wikidata IDs<br/>3000 unique Q IDs]

    WD --> WD_CATS[Categories Fetched<br/>2500 matched]

    WD_CATS --> VALID[Validated<br/>2450 pass]

    VALID --> DEDUP[Deduplicated<br/>2450 unique]

    DEDUP --> FINAL[admin_boundaries<br/>2450 inserted]

    classDef skip fill:#f88,stroke:#f00,color:#000
    class osmSkip,wdSkip,validSkip skip

    OSM -.->|Skipped: 0| osmSkip
    WD -.->|Unmatched: 500| wdSkip
    VALID -.->|Invalid: 0| validSkip
```

## Import Commands Flow

```mermaid
graph TB
    CLI[bun command] --> DECISION{Which command?}

    DECISION -->|bun import| OSM_ONLY[OSM-Only Import]
    DECISION -->|bun import:data| FULL_PIPELINE[Full Pipeline]

    OSM_ONLY --> S1[Fetch OSM → osm_relations]
    S1 --> OSM_DONE[Complete: osm_relations populated]

    FULL_PIPELINE --> S1
    OSM_DONE --> S2[Extract Wikidata IDs]
    S2 --> S3[Fetch Categories]
    S3 --> S4[Transform & Enrich]
    S4 --> S5[Insert to admin_boundaries]
    S5 --> S6[Verify Results]
    S6 --> PIPELINE_DONE[Complete: Both tables populated]
```
