# API Interactions Documentation

Detailed documentation of external API integrations (Overpass API and Wikidata REST API) used in the import pipeline.

## Overview

The import system integrates with two external APIs:

```mermaid
graph LR
    subgraph "Import Pipeline"
        IMPORT[Import System]
    end

    subgraph "External APIs"
        OVERPASS[Overpass API<br/>OpenStreetMap]
        WIKIDATA[Wikidata REST API<br/>Wikimedia]
    end

    IMPORT -->|Fetch boundaries| OVERPASS
    IMPORT -->|Fetch categories| WIKIDATA

```

## Overpass API Integration

### Purpose

Fetch administrative boundary data from OpenStreetMap with geometry and metadata.

### API Details

```mermaid
graph TB
    subgraph "Overpass API"
        ENDPOINT[Endpoint<br/>https://overpass-api.de/api/interpreter]
        METHOD[Method<br/>POST]
        FORMAT[Format<br/>JSON]
        TIMEOUT[Timeout<br/>90 seconds]
    end

    subgraph "Query Format"
        QL[Overpass QL<br/>Query Language]
    end

    subgraph "Response"
        JSON[JSON Array<br/>of Elements]
    end

    ENDPOINT --> METHOD
    METHOD --> FORMAT
    FORMAT --> TIMEOUT
    TIMEOUT --> QL
    QL --> JSON

```

### Query Construction

```mermaid
graph TD
    START[Build Query] --> BASE[Set base parameters]
    BASE --> OUT[out:json]
    OUT --> TIMEOUT_Q[timeout:90]

    TIMEOUT_Q --> FILTER[Build filters]
    FILTER --> ADMIN[admin_level filter]
    ADMIN --> COUNTRY[Country bounding box]

    COUNTRY --> TAGS[Required tags]
    TAGS --> WD_TAG[wikidata tag]
    WD_TAG --> NAME_TAG[name tag]

    NAME_TAG --> OUTPUT[Output format]
    OUTPUT --> OUT_GEOM[out geom]

    OUT_GEOM --> COMPLETE[Complete Query]

```

### Example Query

```mermaid
graph LR
    subgraph "Overpass QL Query"
        Q1["out:json"]
        Q2["timeout:25"]
        Q3["area ISO3166-1 US"]
        Q4["relation admin_level 4/6/8"]
        Q5["out geom"]
    end

    Q1 --> Q2 --> Q3 --> Q4 --> Q5

```

### Request Flow

```mermaid
sequenceDiagram
    participant Client as Import Script
    participant Builder as Query Builder
    participant API as Overpass API
    participant Parser as Response Parser

    Client->>Builder: Build query for country/admin levels
    activate Builder

    Builder->>Builder: Add [out:json]
    Builder->>Builder: Add [timeout:25]
    Builder->>Builder: Add area filter for country
    Builder->>Builder: Add relation filters
    Builder->>Builder: Add admin_level filter (4, 6, 8)
    Builder->>Builder: Add ["wikidata"] tag requirement
    Builder->>Builder: Add [out geom]

    Builder-->>Client: Complete Overpass QL query
    deactivate Builder

    Client->>API: POST /api/interpreter
    Note over Client,API: Content-Type: text/plain<br/>Body: Overpass QL query
    activate API

    API->>API: Execute query
    API->>API: Gather results from OSM database
    API->>API: Convert to GeoJSON format
    API-->>Client: JSON response
    deactivate API

    Client->>Parser: Parse JSON
    activate Parser
    Parser->>Parser: Extract elements array
    Parser->>Parser: Convert to OSMBoundary[]
    Parser-->>Client: OSMBoundary[]
    deactivate Parser
```

### Response Structure

```mermaid
graph TD
    ROOT[Overpass Response]

    ROOT --> VERSION[version: 0.6]
    ROOT --> ELEMENTS[elements: Array]

    ELEMENTS --> E1[Element 1]
    ELEMENTS --> E2[Element 2]
    ELEMENTS --> EN[Element N]

    E1 --> TYPE[type: relation]
    E1 --> ID[id: 12345]
    E1 --> TAGS[tags]
    E1 --> GEOM[members]

    TAGS --> WD[wikidata: Q123]
    TAGS --> NAME[name: Paris]
    TAGS --> ADMIN[admin_level: 6]

    GEOM --> G1[Member 1]
    GEOM --> G2[Member 2]
    GEOM --> GN[Member N]

    G1 --> ROLE[role: outer]
    G1 --> GEOM_DATA[geometry: Array]

    GEOM_DATA --> P1[Point 1]
    GEOM_DATA --> P2[Point 2]

    P1 --> LAT[lat: 48.8566]
    P1 --> LON[lon: 2.3522]

```

### Retry Logic

```mermaid
graph TD
    START[Execute API Request] --> RESPONSE{Response Status}

    RESPONSE -->|Success 200| PARSE[Parse JSON]
    RESPONSE -->|Error 429| RATE_LIMIT[Rate limit hit]
    RESPONSE -->|Error 5xx| SERVER_ERROR[Server error]
    RESPONSE -->|Error 4xx| CLIENT_ERROR[Client error]

    PARSE --> VALIDATE{Valid JSON?}
    VALIDATE -->|Yes| SUCCESS[Return data]
    VALIDATE -->|No| PARSE_ERROR[Parse error]

    RATE_LIMIT --> CHECK_ATTEMPTS_1{Attempts < 3?}
    SERVER_ERROR --> CHECK_ATTEMPTS_2{Attempts < 3?}

    CHECK_ATTEMPTS_1 -->|Yes| BACKOFF_1[Wait 2^attempt seconds]
    CHECK_ATTEMPTS_2 -->|Yes| BACKOFF_2[Wait 2^attempt seconds]

    BACKOFF_1 --> RETRY_1[Retry request]
    BACKOFF_2 --> RETRY_2[Retry request]

    RETRY_1 --> RESPONSE
    RETRY_2 --> RESPONSE

    CHECK_ATTEMPTS_1 -->|No| FAIL_1[Failed: Max retries]
    CHECK_ATTEMPTS_2 -->|No| FAIL_2[Failed: Max retries]

    CLIENT_ERROR --> FAIL_3[Failed: Client error]
    PARSE_ERROR --> FAIL_4[Failed: Invalid response]

    SUCCESS --> END[Complete]
    FAIL_1 --> END
    FAIL_2 --> END
    FAIL_3 --> END
    FAIL_4 --> END

```

### Rate Limiting Strategy

```mermaid
graph LR
    subgraph "Overpass API Limits"
        L1[No official rate limit]
        L2[Server-side load balancing]
        L3[Timeout: 90s default]
    end

    subgraph "Client Strategy"
        S1[Retry with exponential backoff]
        S2[Max 3 attempts]
        S3[1s, 2s, 4s delays]
    end

    L1 --> S1
    L2 --> S1
    L3 --> S2

    S1 --> S3

```

## Wikidata REST API Integration

### Purpose

Fetch Wikimedia Commons category names for administrative boundaries using Wikidata entity IDs.

### API Details

```mermaid
graph TB
    subgraph "Wikidata REST API"
        ENDPOINT[Endpoint<br/>https://www.wikidata.org/w/api.php]
        ACTION[Action<br/>wbgetentities]
        FORMAT[Format<br/>json]
        PROPS[Properties<br/>claims]
    end

    subgraph "Property of Interest"
        P373[P373<br/>Commons category]
    end

    ENDPOINT --> ACTION
    ACTION --> FORMAT
    FORMAT --> PROPS
    PROPS --> P373

```

### Request Format

```mermaid
graph LR
    subgraph "HTTP GET Request"
        URL[https://www.wikidata.org/w/api.php]
        PARAMS[Query Parameters]
    end

    subgraph "Parameters"
        P1[action=wbgetentities]
        P2["ids: Q1 to Q50"]
        P3[props=claims]
        P4[format=json]
    end

    URL --> PARAMS
    PARAMS --> P1 --> P2 --> P3 --> P4

```

### Batch Processing Flow

```mermaid
graph TD
    START[Start Wikidata Fetch] --> INPUT[Input: Array of Q IDs]

    INPUT --> SPLIT[Split into batches]
    SPLIT --> BATCH_SIZE[50 IDs per batch]

    BATCH_SIZE --> PROCESS[Process each batch]

    PROCESS --> BUILD_REQUEST[Build API request]
    BUILD_REQUEST --> API_CALL[Call Wikidata API]

    API_CALL --> CHECK_ERROR{Error?}

    CHECK_ERROR -->|No| PARSE[Parse response]
    CHECK_ERROR -->|Yes| LOG_ERROR[Log error]
    LOG_ERROR --> CONTINUE_1[Continue to next batch]

    PARSE --> EXTRACT[Extract P373 property]

    EXTRACT --> HAS_P373{Has P373?}

    HAS_P373 -->|Yes| STORE[Store in map]
    HAS_P373 -->|No| SKIP[Skip entity]

    STORE --> CONTINUE_2[Continue]
    SKIP --> CONTINUE_2

    CONTINUE_1 --> MORE_BATCHES{More batches?}
    CONTINUE_2 --> MORE_BATCHES

    MORE_BATCHES -->|Yes| DELAY[Wait 100ms]
    DELAY --> PROCESS

    MORE_BATCHES -->|No| COMPLETE[Return category map]

```

### Request/Response Sequence

```mermaid
sequenceDiagram
    participant Client as Import Script
    participant Batch as Batch Processor
    participant API as Wikidata API
    participant Map as Category Map

    Client->>Batch: fetchCategories(ids)
    activate Batch

    Batch->>Batch: Split 250 IDs into 5 batches

    loop For each batch of 50 IDs
        Batch->>API: GET wbgetentities with 50 IDs
        activate API

        API->>API: Lookup entities
        API->>API: Extract claims
        API-->>Batch: JSON response
        deactivate API

        Batch->>Batch: Parse response

        loop For each entity in batch
            Batch->>Batch: Check for P373 claim
            alt P373 exists
                Batch->>Map: Map["Q123"] = "Category:Name"
            else P373 missing
                Batch->>Batch: Skip entity (graceful)
            end
        end

        Batch->>Batch: Wait 100ms (rate limit)
    end

    Batch-->>Client: Map<string, string>
    deactivate Batch

    Note over Map: Returns map of<br/>Q ID → Commons category
```

### Response Structure

```mermaid
graph TD
    ROOT[Wikidata Response]

    ROOT --> ENTITIES[entities: Object]

    ENTITIES --> E1[Q123: Object]
    ENTITIES --> E2[Q456: Object]
    ENTITIES --> EN[Q789: Object]

    E1 --> PAGEID[pageid: 1234]
    E1 --> NS[ns: 0]
    E1 --> TITLE[title: Q123]
    E1 --> LASTREV[lastrevid: 5678]
    E1 --> MODIFIED[modified: 2024-01-01]
    E1 --> TYPE[type: item]
    E1 --> ID[id: Q123]
    E1 --> CLAIMS[claims: Object]

    CLAIMS --> P373[P373: Array]

    P373 --> CLAIM_1[Claim 1]
    CLAIM_1 --> MAINSNAK[mainsnak]
    MAINSNAK --> DATATYPE[datatype: string]
    MAINSNAK --> DATAVALUE[datavalue]

    DATAVALUE --> VALUE[value: Category:Paris]
    DATAVALUE --> TYPE[type: string]

```

### Property Extraction

```mermaid
graph TD
    START[Extract P373] --> NAV[Navigate to entity]
    NAV --> CHECK_CLAIMS{Has claims?}

    CHECK_CLAIMS -->|No| SKIP[Skip entity]
    CHECK_CLAIMS -->|Yes| CHECK_P373{Has P373?}

    CHECK_P373 -->|No| SKIP
    CHECK_P373 -->|Yes| GET_ARRAY[Get P373 array]

    GET_ARRAY --> CHECK_NOT_EMPTY{Array not empty?}

    CHECK_NOT_EMPTY -->|No| SKIP
    CHECK_NOT_EMPTY -->|Yes| GET_FIRST[Get first claim]

    GET_FIRST --> GET_MAINSNAK[Get mainsnak]

    GET_MAINSNAK --> CHECK_VALUE{Has datavalue?}

    CHECK_VALUE -->|No| SKIP
    CHECK_VALUE -->|Yes| EXTRACT[Extract value string]

    EXTRACT --> VALIDATE{Valid category?}

    VALIDATE -->|No| SKIP
    VALIDATE -->|Yes| RETURN[Return category]

    RETURN --> END[Complete]
    SKIP --> END

```

### Error Handling

```mermaid
graph TD
    START[Wikidata API Request] --> RESPONSE{Response Status}

    RESPONSE -->|Success 200| PARSE[Parse JSON]
    RESPONSE -->|Error 429| RATE_LIMIT
    RESPONSE -->|Error 5xx| SERVER_ERROR
    RESPONSE -->|Error 4xx| CLIENT_ERROR
    RESPONSE -->|Network Error| NETWORK_ERROR

    PARSE --> VALID_JSON{Valid JSON?}
    VALID_JSON -->|Yes| EXTRACT[Extract entities]
    VALID_JSON -->|No| PARSE_ERROR

    EXTRACT --> HAS_ENTITIES{Has entities?}
    HAS_ENTITIES -->|Yes| PROCESS[Process each entity]
    HAS_ENTITIES -->|No| EMPTY[Return empty map]

    PROCESS --> FOR_EACH[For each entity]

    FOR_EACH --> HAS_P373{Has P373?}
    HAS_P373 -->|Yes| ADD[Add to map]
    HAS_P373 -->|No| SKIP_ENTITY[Skip entity]

    ADD --> MORE_ENTITIES{More entities?}
    SKIP_ENTITY --> MORE_ENTITIES

    MORE_ENTITIES -->|Yes| FOR_EACH
    MORE_ENTITIES -->|No| SUCCESS[Return map]

    RATE_LIMIT --> LOG_1[Log warning]
    SERVER_ERROR --> LOG_2[Log warning]
    CLIENT_ERROR --> LOG_3[Log error]
    NETWORK_ERROR --> LOG_4[Log error]
    PARSE_ERROR --> LOG_5[Log error]

    LOG_1 --> CONTINUE[Continue with remaining batches]
    LOG_2 --> CONTINUE
    LOG_3 --> CONTINUE
    LOG_4 --> CONTINUE
    LOG_5 --> CONTINUE

    SUCCESS --> END[Complete]
    EMPTY --> END
    CONTINUE --> END

```
