# Error Handling Documentation

Complete error handling patterns, retry logic, and failure recovery mechanisms for the import pipeline.

## Error Handling Overview

```mermaid
graph TB
    subgraph "Error Types"
        NET[Network Errors]
        API[API Errors]
        DATA[Data Errors]
        DB[Database Errors]
        VALID[Validation Errors]
    end

    subgraph "Handling Strategies"
        RETRY[Retry with Backoff]
        SKIP[Skip & Continue]
        LOG[Log & Warn]
        FAIL[Fail Fast]
    end

    subgraph "Effect TS Integration"
        EFFECT[Effect.Effect<T, E>]
        CATCH[catchTag for typed errors]
        RECOVER[Effect recovery]
    end

    NET --> RETRY
    API --> RETRY
    DATA --> SKIP
    DB --> LOG
    VALID --> SKIP

    RETRY --> EFFECT
    SKIP --> EFFECT
    LOG --> EFFECT

    EFFECT --> CATCH
    EFFECT --> RECOVER

```

## Error Taxonomy

### Error Class Hierarchy

```mermaid
classDiagram
    Error <|-- ImportError
    Error <|-- NetworkError
    Error <|-- ValidationError
    Error <|-- DatabaseError

    ImportError <|-- APITimeoutError
    ImportError <|-- RateLimitError
    ImportError <|-- ParseError

    NetworkError <|-- ConnectionError
    NetworkError <|-- DNSSError

    ValidationError <|-- GeometryError
    ValidationError <|-- MissingDataError

    class Error {
        +string message
        +string stack
        +unknown cause
    }

    class ImportError {
        +string _tag
        +string stage
        +string context
    }

    class NetworkError {
        +string _tag
        +number statusCode
        +string url
    }

    class ValidationError {
        +string _tag
        +string field
        +any value
    }

    class DatabaseError {
        +string _tag
        +string query
        +any params
    }

    class APITimeoutError {
        +number timeout
        +string api
    }

    class RateLimitError {
        +number retryAfter
        +string api
    }

    class GeometryError {
        +string geometryType
        +string reason
    }

    class MissingDataError {
        +string field
        +string entity
    }
```

### Error Categories by Stage

```mermaid
graph TD
    ROOT[Import Pipeline Errors]

    ROOT --> STAGE1[Stage 1: OSM Fetch]
    ROOT --> STAGE2[Stage 2: Wikidata]
    ROOT --> STAGE3[Stage 3: Transform]
    ROOT --> STAGE4[Stage 4: Database]
    ROOT --> STAGE5[Stage 5: Verify]

    STAGE1 --> E1A[Network timeout]
    STAGE1 --> E1B[API rate limit]
    STAGE1 --> E1C[Invalid JSON]
    STAGE1 --> E1D[Empty response]

    STAGE2 --> E2A[Invalid Wikidata ID]
    STAGE2 --> E2B[Missing P373 property]
    STAGE2 --> E2C[Network error]
    STAGE2 --> E2D[Entity not found]

    STAGE3 --> E3A[Invalid geometry]
    STAGE3 --> E3B[Missing wikidata tag]
    STAGE3 --> E3C[Duplicate entry]
    STAGE3 --> E3D[Malformed data]

    STAGE4 --> E4A[Connection pool full]
    STAGE4 --> E4B[Transaction failed]
    STAGE4 --> E4C[Constraint violation]
    STAGE4 --> E4D[Insert timeout]

    STAGE5 --> E5A[Verification query failed]
    STAGE5 --> E5B[Unexpected counts]

```

## Retry Logic

### Retry Configuration

```mermaid
graph TB
    subgraph "Retry Constants"
        MAX[MAX_ATTEMPTS: 3]
        BASE[BASE_DELAY_MS: 1000]
        EXP[EXPONENTIAL_BASE: 2]
        MAX_D[MAX_DELAY_MS: 10000]
    end

    subgraph "Retry Formula"
        FORMULA[delay = BASE_DELAY_MS × EXPONENTIAL_BASE^(attempt-1)]
    end

    subgraph "Example Delays"
        D1[Attempt 1: 1000ms]
        D2[Attempt 2: 2000ms]
        D3[Attempt 3: 4000ms]
    end

    MAX --> FORMULA
    BASE --> FORMULA
    EXP --> FORMULA

    FORMULA --> D1
    FORMULA --> D2
    FORMULA --> D3

```

### Retry State Machine

```mermaid
stateDiagram-v2
    [*] --> StartRequest: Execute operation

    StartRequest --> CheckResponse: API response

    CheckResponse --> Success: Status 200
    CheckResponse --> IsRetryable: Error status

    IsRetryable --> CalculateDelay: 429, 5xx, network error
    IsRetryable --> Failure: 4xx client error

    CalculateDelay --> CheckMaxAttempts: Compute backoff
    CheckMaxAttempts --> WaitDelay: attempt < 3
    CheckMaxAttempts --> Failure: attempt >= 3

    WaitDelay --> IncrementAttempt: Sleep
    IncrementAttempt --> StartRequest: Retry

    Success --> [*]: Return result
    Failure --> [*]: Throw error

    note right of IsRetryable
        Retryable errors: 429, 5xx, network error, timeout
    end note

    note right of Failure
        Non-retryable: 400, 401, 403, 404
    end note
```

### Retry Flow Diagram

```mermaid
graph TD
    START[Start Operation] --> EXECUTE[Execute function]
    EXECUTE --> RESULT{Result}

    RESULT -->|Success| RETURN[Return value]
    RESULT -->|Error| CHECK_RETRY{Is retryable?}

    CHECK_RETRY -->|No| THROW[Throw error]
    CHECK_RETRY -->|Yes| INCREMENT[increment attempt counter]

    INCREMENT --> CHECK_MAX{attempt <= MAX_ATTEMPTS?}

    CHECK_MAX -->|No| THROW
    CHECK_MAX -->|Yes| CALC_DELAY[Calculate delay]

    CALC_DELAY --> WAIT[Wait delay ms]
    WAIT --> EXECUTE

    RETURN --> END[End]
    THROW --> END

```

### Retry Implementation

```mermaid
sequenceDiagram
    participant Caller as Calling Code
    participant Retry as Retry Logic
    participant Func as Function to Retry
    participant API as External API

    Caller->>Retry: executeWithRetry(func)
    activate Retry
    Retry->>Retry: attempt = 1

    loop Max 3 attempts
        Retry->>Func: Call function
        activate Func
        Func->>API: Make request
        API-->>Func: Response
        Func-->>Retry: Result or Error
        deactivate Func

        alt Success
            Retry-->>Caller: Success result
            break Exit loop
            break
        else Error
            Retry->>Retry: Check if retryable
            alt Not retryable
                Retry-->>Caller: Throw error
                break Exit loop
                break
            else Retryable
                Retry->>Retry: Check attempt count
                alt attempt >= 3
                    Retry-->>Caller: Throw error (max retries)
                    break Exit loop
                    break
                else attempt < 3
                    Retry->>Retry: Calculate delay
                    Retry->>Retry: Wait (1000, 2000, 4000ms)
                    Retry->>Retry: increment attempt
                end
            end
        end
    end
    deactivate Retry
```

## Error Recovery Strategies

### Strategy Decision Tree

```mermaid
graph TD
    ERROR[Error Occurred] --> CLASSIFY{Classify Error}

    CLASSIFY -->|Network| NETWORK_STRATEGY[Network Strategy]
    CLASSIFY -->|API| API_STRATEGY[API Strategy]
    CLASSIFY -->|Data| DATA_STRATEGY[Data Strategy]
    CLASSIFY -->|Database| DB_STRATEGY[Database Strategy]

    NETWORK_STRATEGY --> RETRY_NET[Retry with backoff]
    NETWORK_STRATEGY --> LOG_NET[Log context]

    API_STRATEGY --> CHECK_STATUS{Status Code}

    CHECK_STATUS -->|429| RETRY_429[Retry after delay]
    CHECK_STATUS -->|5xx| RETRY_5XX[Retry with backoff]
    CHECK_STATUS -->|4xx| FAIL_4XX[Fail fast]

    RETRY_429 --> LOG_API[Log rate limit]
    RETRY_5XX --> LOG_API
    FAIL_4XX --> LOG_API

    DATA_STRATEGY --> CHECK_DATA{Data Error Type}

    CHECK_DATA -->|Missing field| SKIP_RECORD[Skip record]
    CHECK_DATA -->|Invalid geometry| SKIP_RECORD
    CHECK_DATA -->|Duplicate| SKIP_RECORD
    CHECK_DATA -->|Malformed| SKIP_RECORD

    SKIP_RECORD --> LOG_DATA[Log skip reason]
    LOG_DATA --> CONTINUE[Continue processing]

    DB_STRATEGY --> CHECK_DB{DB Error Type}

    CHECK_DB -->|Connection error| RETRY_DB[Retry connection]
    CHECK_DB -->|Transaction error| ROLLBACK[Rollback batch]
    CHECK_DB -->|Constraint error| LOG_DB[Log and skip]

    RETRY_NET --> HANDLE
    LOG_API --> HANDLE
    LOG_NET --> HANDLE
    CONTINUE --> HANDLE
    ROLLBACK --> HANDLE
    LOG_DB --> HANDLE

    HANDLE[Handle Result] --> NEXT[Continue or Fail]

```

### Effect TS Error Handling

```mermaid
graph TB
    subgraph "Effect Error Types"
        E1[NotFoundError]
        E2[DatabaseError]
        E3[ValidationError]
    end

    subgraph "Effect Operations"
        OP1[Effect.tryPromise]
        OP2[Effect.catchTag]
        OP3[Effect.catchAll]
    end

    subgraph "Error Recovery"
        R1[Retry operation]
        R2[Provide default]
        R3[Log and continue]
    end

    E1 --> OP2
    E2 --> OP2
    E3 --> OP2

    OP1 -->|Throws| E1
    OP1 -->|Throws| E2
    OP1 -->|Throws| E3

    OP2 -->|On match| R1
    OP2 -->|On match| R2
    OP2 -->|On match| R3

    OP3 -->|Catch all| R3

```

### Example: Database Error Recovery

```mermaid
sequenceDiagram
    participant Import as Import Script
    participant Effect as Effect Layer
    participant DB as Database Layer
    participant PG as PostgreSQL

    Import->>Effect: Execute insert operation
    activate Effect

    Effect->>DB: Effect.tryPromise(insert)
    activate DB

    DB->>PG: BEGIN TRANSACTION
    PG-->>DB: Transaction started

    DB->>PG: INSERT records...
    PG-->>DB: ERROR: constraint violation

    DB-->>Effect: DatabaseError
    deactivate DB

    Effect->>Effect: Effect.catchTag("DatabaseError")

    Effect->>Effect: Log error
    Effect->>Effect: Check if recoverable

    alt Recoverable error
        Effect->>Effect: Rollback transaction
        Effect->>Import: Skip batch, continue
    else Non-recoverable
        Effect->>Import: Fail with error
    end

    deactivate Effect
```

## Stage-Specific Error Handling

### Stage 1: OSM Fetch Errors

```mermaid
graph TD
    START[Fetch OSM Data] --> API_CALL[Call Overpass API]

    API_CALL --> RESPONSE{Response Type}

    RESPONSE -->|Timeout| TIMEOUT[Network timeout]
    RESPONSE -->|429| RATE_LIMIT[Rate limit]
    RESPONSE -->|5xx| SERVER_ERROR[Server error]
    RESPONSE -->|4xx| CLIENT_ERROR[Client error]
    RESPONSE -->|Success| PARSE[Parse JSON]

    TIMEOUT --> RETRY_1[Retry with backoff]
    RATE_LIMIT --> RETRY_2[Retry with delay]
    SERVER_ERROR --> RETRY_3[Retry with backoff]

    RETRY_1 --> CHECK_ATTEMPTS{Attempts < 3?}
    RETRY_2 --> CHECK_ATTEMPTS
    RETRY_3 --> CHECK_ATTEMPTS

    CHECK_ATTEMPTS -->|Yes| API_CALL
    CHECK_ATTEMPTS -->|No| FAIL_1[Failed: Max retries]

    CLIENT_ERROR --> FAIL_2[Failed: Client error]

    PARSE --> VALID_JSON{Valid JSON?}

    VALID_JSON -->|No| FAIL_3[Failed: Invalid JSON]
    VALID_JSON -->|Yes| CHECK_DATA{Has data?}

    CHECK_DATA -->|No| FAIL_4[Failed: Empty response]
    CHECK_DATA -->|Yes| SUCCESS[Success]

    SUCCESS --> END[Return OSM data]
    FAIL_1 --> END
    FAIL_2 --> END
    FAIL_3 --> END
    FAIL_4 --> END

```

### Stage 2: Wikidata Errors

```mermaid
graph TD
    START[Fetch Categories] --> BATCH_START[Process batch]

    BATCH_START --> API_CALL[Call Wikidata API]

    API_CALL --> RESPONSE{Response Type}

    RESPONSE -->|Network Error| NETWORK[Network error]
    RESPONSE -->|Timeout| TIMEOUT[Request timeout]
    RESPONSE -->|Success| PARSE[Parse response]

    NETWORK --> LOG_1[Log warning]
    TIMEOUT --> LOG_2[Log warning]

    LOG_1 --> SKIP_BATCH[Skip this batch]
    LOG_2 --> SKIP_BATCH

    SKIP_BATCH --> CONTINUE[Continue to next batch]

    PARSE --> PARSE_ERROR{Parse error?}

    PARSE_ERROR -->|Yes| LOG_3[Log error]
    PARSE_ERROR -->|No| EXTRACT[Extract entities]

    LOG_3 --> SKIP_BATCH

    EXTRACT --> HAS_ENTITIES{Has entities?}

    HAS_ENTITIES -->|No| EMPTY[Return empty map]
    HAS_ENTITIES -->|Yes| PROCESS[Process entities]

    PROCESS --> ENTITY_LOOP{For each entity}

    ENTITY_LOOP --> HAS_P373{Has P373?}

    HAS_P373 -->|Yes| ADD[Add to map]
    HAS_P373 -->|No| SKIP_ENTITY[Skip entity]

    ADD --> MORE_ENTITIES{More entities?}
    SKIP_ENTITY --> MORE_ENTITIES

    MORE_ENTITIES -->|Yes| ENTITY_LOOP
    MORE_ENTITIES -->|No| COMPLETE[Return map]

    EMPTY --> NEXT_BATCH{More batches?}
    COMPLETE --> NEXT_BATCH

    NEXT_BATCH -->|Yes| WAIT[Wait 100ms]
    WAIT --> BATCH_START

    NEXT_BATCH -->|No| DONE[Complete]

    CONTINUE --> NEXT_BATCH

```

### Stage 3: Transform Errors

```mermaid
graph TD
    START[Transform Data] --> RECORD_LOOP{For each record}

    RECORD_LOOP --> CHECK_WD{Has wikidata<br/>tag?}

    CHECK_WD -->|No| SKIP_1[Skip: No wikidata]
    CHECK_WD -->|Yes| LOOKUP[Lookup category]

    LOOKUP --> HAS_CAT{Has category?}

    HAS_CAT -->|No| SKIP_2[Skip: No category]
    HAS_CAT -->|Yes| VALIDATE_GEOM[Validate geometry]

    SKIP_1 --> LOG_SKIP_1[Log skip]
    SKIP_2 --> LOG_SKIP_2[Log skip]

    LOG_SKIP_1 --> COUNT_SKIP_1[Increment skip count]
    LOG_SKIP_2 --> COUNT_SKIP_2[Increment skip count]

    VALIDATE_GEOM --> IS_VALID{Valid geometry?}

    IS_VALID -->|No| SKIP_3[Skip: Invalid geometry]
    IS_VALID -->|Yes| CONVERT[Convert to EWKT]

    SKIP_3 --> LOG_SKIP_3[Log skip]
    LOG_SKIP_3 --> COUNT_SKIP_3[Increment skip count]

    CONVERT --> CHECK_DUP{Duplicate<br/>wikidata_id?}

    CHECK_DUP -->|Yes| SKIP_4[Skip: Duplicate]
    CHECK_DUP -->|No| ADD[Add to results]

    SKIP_4 --> LOG_SKIP_4[Log skip]
    LOG_SKIP_4 --> COUNT_SKIP_4[Increment skip count]

    ADD --> MORE_RECORDS{More records?}
    COUNT_SKIP_1 --> MORE_RECORDS
    COUNT_SKIP_2 --> MORE_RECORDS
    COUNT_SKIP_3 --> MORE_RECORDS
    COUNT_SKIP_4 --> MORE_RECORDS

    MORE_RECORDS -->|Yes| RECORD_LOOP
    MORE_RECORDS -->|No| REPORT[Report statistics]

    REPORT --> END[Return results]

```

### Stage 4: Database Errors

```mermaid
graph TD
    START[Insert Data] --> CONNECT[Get connection]

    CONNECT --> CONN_OK{Connection<br/>OK?}

    CONN_OK -->|No| RETRY_CONN[Retry connection]
    CONN_OK -->|Yes| SPLIT[Split into batches]

    RETRY_CONN --> CONN_OK

    SPLIT --> BATCH_LOOP{For each batch}

    BATCH_LOOP --> BEGIN_TX[BEGIN transaction]

    BEGIN_TX --> INSERT_LOOP{For each record}

    INSERT_LOOP --> INSERT[INSERT record]

    INSERT --> INSERT_OK{Insert OK?}

    INSERT_OK -->|No| CHECK_ERROR{Error type}

    CHECK_ERROR -->|Constraint| LOG_CONSTRAINT[Log constraint error]
    CHECK_ERROR -->|Connection| LOG_CONN[Log connection error]
    CHECK_ERROR -->|Timeout| LOG_TIMEOUT[Log timeout]

    LOG_CONSTRAINT --> SKIP_RECORD[Skip record]
    LOG_CONN --> ROLLBACK[Rollback transaction]
    LOG_TIMEOUT --> ROLLBACK

    SKIP_RECORD --> MORE_INSERTS{More records?}

    INSERT_OK -->|Yes| MORE_INSERTS

    MORE_INSERTS -->|Yes| INSERT_LOOP
    MORE_INSERTS -->|No| COMMIT[COMMIT transaction]

    ROLLBACK --> LOG_BATCH[Log batch failure]
    LOG_BATCH --> CHECK_RETRY{Retry batch?}

    CHECK_RETRY -->|Yes| BATCH_LOOP
    CHECK_RETRY -->|No| MORE_BATCHES{More batches?}

    COMMIT --> MORE_BATCHES

    MORE_BATCHES -->|Yes| BATCH_LOOP
    MORE_BATCHES -->|No| REPORT[Report summary]

    REPORT --> END[Return results]

```

## Error Logging

### Log Levels

```mermaid
graph TB
    subgraph "Log Levels"
        ERROR[ERROR<br/>Critical failures]
        WARN[WARN<br/>Non-critical issues]
        INFO[INFO<br/>Progress updates]
        DEBUG[DEBUG<br/>Detailed diagnostics]
    end

    subgraph "Error Scenarios"
        E1[API failure after retries]
        E2[Invalid geometry]
        E3[Missing category]
        E4[Batch insert failure]
        E5[Successful import]
        E6[Batch progress]
    end

    E1 --> ERROR
    E2 --> WARN
    E3 --> WARN
    E4 --> WARN
    E5 --> INFO
    E6 --> INFO

```

### Error Message Format

```mermaid
graph LR
    subgraph "Error Message Components"
        COMP1[Timestamp]
        COMP2[Level]
        COMP3[Stage]
        COMP4[Error Type]
        COMP5[Context]
        COMP6[Message]
    end

    subgraph "Example"
        MSG[2024-01-30 10:30:45 ERROR Stage1: NetworkTimeout - Failed to fetch OSM data after 3 attempts]
    end

    COMP1 --> MSG
    COMP2 --> MSG
    COMP3 --> MSG
    COMP4 --> MSG
    COMP5 --> MSG
    COMP6 --> MSG

```

## Graceful Degradation

### Degradation Strategies

```mermaid
graph TD
    START[Import Process] --> HEALTH_CHECK{System Health}

    HEALTH_CHECK -->|All good| FULL[Full import]
    HEALTH_CHECK -->|Partial| DEGRADED[Degraded mode]

    DEGRADED --> CHECK_1{OSM API<br/>down?}

    CHECK_1 -->|Yes| USE_CACHE[Use cached OSM data]
    CHECK_1 -->|No| CHECK_2{Wikidata API<br/>down?}

    USE_CACHE --> CONTINUE_IMPORT[Continue import]
    CHECK_2 -->|Yes| SKIP_WIKIDATA[Skip Wikidata stage]
    CHECK_2 -->|No| CHECK_3{Database<br/>slow?}

    SKIP_WIKIDATA --> LOG_DEGRADED[Log degraded mode]
    CHECK_3 -->|Yes| REDUCE_BATCH[Reduce batch size]

    REDUCE_BATCH --> LOG_DEGRADED
    LOG_DEGRADED --> CONTINUE_IMPORT

    FULL --> IMPORT[Execute full pipeline]
    CONTINUE_IMPORT --> IMPORT

    IMPORT --> COMPLETE[Import complete]

```

### Data Quality on Errors

```mermaid
graph TB
    subgraph "Data Quality Levels"
        L1[Level 1: Full Quality<br/>All stages successful]
        L2[Level 2: Partial Quality<br/>Some records skipped]
        L3[Level 3: Degraded<br/>Some stages skipped]
        L4[Level 4: Minimal<br/>Only critical data]
    end

    subgraph "Error Impact"
        E1[No errors]
        E2[10% records skipped]
        E3[Wikidata unavailable]
        E4[API rate limited]
    end

    E1 --> L1
    E2 --> L2
    E3 --> L3
    E4 --> L3

```

## Error Recovery Summary

```mermaid
mindmap
  root((Error Handling))
    Strategies
      Retry with backoff
      Skip and continue
      Fail fast
      Graceful degradation
    Stages
      OSM Fetch
        Network errors: retry
        API errors: retry
        Parse errors: fail
      Wikidata
        Network errors: skip batch
        Missing entities: skip
        Parse errors: log
      Transform
        Missing fields: skip
        Invalid geometry: skip
        Duplicates: skip
      Database
        Connection errors: retry
        Transaction errors: rollback
        Constraint errors: skip
    Effect TS
      Effect.tryPromise
      Effect.catchTag
      Effect.recover
    Logging
      ERROR: Critical failures
      WARN: Non-critical issues
      INFO: Progress updates
```
