# Error Handling Documentation

Error handling patterns, retry logic, and failure recovery for the import pipeline.

## Retry Configuration

```mermaid
graph TB
    subgraph "Retry Constants"
        MAX[MAX_ATTEMPTS: 3]
        BASE[BASE_DELAY_MS: 1000]
        EXP[EXPONENTIAL_BASE: 2]
    end

    subgraph "Retry Delays"
        D1[Attempt 1: 1000ms]
        D2[Attempt 2: 2000ms]
        D3[Attempt 3: 4000ms]
    end

    MAX --> D1
    BASE --> D1
    EXP --> D2
    D2 --> D3
```

**Retry Formula:** `delay = BASE_DELAY_MS × EXPONENTIAL_BASE^(attempt-1)`

## Retry Logic Flow

```mermaid
graph TD
    START[Execute Operation] --> RESPONSE{Response Status}

    RESPONSE -->|Success 200| SUCCESS[Return result]
    RESPONSE -->|Error 429| RATE_LIMIT[Rate limit]
    RESPONSE -->|Error 5xx| SERVER_ERROR[Server error]
    RESPONSE -->|Network Error| NETWORK[Network error]

    RATE_LIMIT --> CHECK_ATTEMPTS{Attempt < 3?}
    SERVER_ERROR --> CHECK_ATTEMPTS
    NETWORK --> CHECK_ATTEMPTS

    CHECK_ATTEMPTS -->|Yes| CALC_DELAY[Calculate backoff]
    CHECK_ATTEMPTS -->|No| FAIL[Failed: Max retries]

    CALC_DELAY --> WAIT[Wait delay ms]
    WAIT --> RETRY[Retry operation]
    RETRY --> RESPONSE

    SUCCESS --> END[Complete]
    FAIL --> END
```

## Effect TS Error Handling

### tryAsync Helper

```typescript
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

## Stage-Specific Error Handling

### Stage 1: OSM Fetch Errors

| Error Type | Retryable | Handling |
|------------|-----------|----------|
| Network timeout | Yes | Retry with exponential backoff |
| 429 Rate limit | Yes | Retry with delay |
| 5xx Server error | Yes | Retry with backoff |
| 4xx Client error | No | Fail fast |
| Invalid JSON | No | Fail fast |

### Stage 2: Wikidata ID Extraction

| Error Type | Retryable | Handling |
|------------|-----------|----------|
| Database connection error | Yes | Retry connection |
| Query timeout | Yes | Retry query |
| Empty result | No | Return empty array (continue) |

### Stage 3: Wikidata API Errors

| Error Type | Retryable | Handling |
|------------|-----------|----------|
| Network error | No | Log warning, skip batch |
| Timeout | No | Log warning, skip batch |
| 429 Rate limit | Yes | Retry with delay |
| 5xx Server error | Yes | Retry with backoff |
| Invalid response | No | Log error, skip batch |

**Key Behavior:** Wikidata batch failures don't stop the pipeline - they log warnings and continue with remaining batches.

### Stage 4: Transform Errors

| Error Type | Handling |
|------------|----------|
| Missing wikidata_id | Skip record, log debug |
| No Commons category | Skip record, log debug |
| Invalid geometry | Skip record, log warning |
| Duplicate wikidata_id | Remove duplicate, log info |

**Key Behavior:** Transform stage gracefully skips invalid records rather than failing.

### Stage 5: Database Insert Errors

| Error Type | Handling |
|------------|----------|
| Connection pool full | Retry connection |
| Transaction failed | Rollback batch, log error |
| Constraint violation | Log error, continue with next batch |
| Insert timeout | Rollback, retry batch |

## Error Recovery Patterns

### Pattern 1: Retry with Backoff

```mermaid
graph LR
    OP[Operation] --> ERROR{Error?}
    ERROR -->|No| SUCCESS[Success]
    ERROR -->|Yes| RETRY{Retryable?}
    RETRY -->|No| FAIL[Fail]
    RETRY -->|Yes| BACKOFF{Max attempts?}
    BACKOFF -->|Yes| WAIT[Wait]
    WAIT --> OP
    BACKOFF -->|No| FAIL
```

**Used by:**
- Overpass API requests (relation discovery, geometry fetch)
- Wikidata API requests (batch entity fetch)
- Database connection attempts

### Pattern 2: Graceful Degradation

```mermaid
graph LR
    OP[Operation] --> ERROR{Error?}
    ERROR -->|No| SUCCESS[Success]
    ERROR -->|Yes| LOG[Log warning]
    LOG --> DEFAULT[Return default/empty]
    DEFAULT --> CONTINUE[Continue pipeline]
```

**Used by:**
- Wikidata batch failures (skip batch, continue with next)
- Transform validation failures (skip record, continue processing)
- Missing Commons categories (skip record, log debug)

### Pattern 3: Fail Fast

```mermaid
graph LR
    OP[Operation] --> ERROR{Error?}
    ERROR -->|No| SUCCESS[Success]
    ERROR -->|Yes| FAIL[Fail immediately]
```

**Used by:**
- Missing required environment variables
- Invalid Wikidata ID format
- Database connection initialization failures

## Common Error Scenarios

### Scenario 1: Overpass API Timeout

```
Error: Overpass API error: 504 Gateway Timeout
```

**Resolution:**
- Retry with exponential backoff (max 3 attempts)
- If all retries fail: Reduce admin level range or import smaller country

### Scenario 2: Wikidata Batch Failure

```
Error processing batch 15: Failed to fetch batch: 429
Batch 15 complete: 0 categories fetched
```

**Resolution:**
- Log warning, skip batch, continue with remaining batches
- Final category map will have missing entries for this batch
- Import completes but some records may lack Commons categories

### Scenario 3: Invalid Geometry

```
Invalid polygon coordinates for: Paris
Invalid geometries: 5
```

**Resolution:**
- Skip records with invalid geometries
- Log warnings for each skipped record
- Import completes with fewer records

### Scenario 4: Database Transaction Failure

```
Error: Failed to commit transaction
Batch failed, rolling back
```

**Resolution:**
- Rollback current batch
- Log error
- Continue with next batch
- Import completes but some records may be missing

## Logging Levels

| Level | Usage |
|-------|-------|
| `console.error()` | Critical failures that stop the pipeline |
| `console.warn()` | Non-critical issues (batch failures, validation errors) |
| `console.log()` | Progress updates, statistics |
| `console.debug()` | Detailed diagnostics (disabled in production) |
