# Scripts Refactoring Plan

## Overview

Refactor scripts in `src/scripts/` to eliminate code duplication, improve maintainability, and follow single responsibility principle.

## Issues Identified

### 1. Repeated Error Handling Pattern (High Priority)
**Problem**: Every `Effect.tryPromise` uses identical catch block
```typescript
catch: (error) => new Error(error instanceof Error ? error.message : String(error))
```

**Impact**: 50+ lines of duplicated code across multiple files

**Solution**: Create shared utility function in `src/scripts/utils/effect.ts`

### 2. Monolithic runImport Function (High Priority)
**Problem**: `runImport` in `src/scripts/import/index.ts` handles 9+ responsibilities:
- Configuration display
- Directory creation
- OSM data fetching
- Wikidata processing
- Category validation
- Data transformation
- Database insertion
- Import verification
- Summary reporting

**Impact**: Hard to test, hard to maintain, unclear single purpose

**Solution**: Break into smaller focused functions using pipeline pattern

### 3. Nested Effect.gen Blocks (Medium Priority)
**Problem**: `batch.ts` has unnecessary nesting (lines 31-63)

**Impact**: Reduced readability, harder to reason about control flow

**Solution**: Flatten structure and extract inner logic

### 4. Duplicated Batch Processing Logic (Medium Priority)
**Problem**: Similar patterns in:
- wikidata-api.ts (lines 47-111)
- wikimedia-commons-api.ts (lines 65-88)
- database/index.ts (lines 34-49)

**Impact**: Repeated code for looping, processing, rate limiting, logging

**Solution**: Create generic batch processor utility

### 5. Hardcoded Magic Numbers (Low Priority)
**Problem**: Magic numbers scattered throughout:
- Retry counts: `3`
- Delays: `100`, `1000`
- Batch sizes: `50`, `1000`

**Impact**: Hard to tune behavior, unclear intent

**Solution**: Create constants file

### 6. Inconsistent Error Types (Low Priority)
**Problem**: Functions return `Effect<T, never>` vs `Effect<T, Error>`

**Impact**: Unclear error expectations

**Solution**: Standardize error handling approach

### 7. Transform Pipeline Pattern (Low Priority)
**Problem**: Variable reassignment instead of pipeline

**Solution**: Use `pipe` from Effect for functional composition

## Implementation Plan

### Phase 1: Create Utility Foundations (High Priority)

#### 1.1 Create Effect Utilities
**File**: `src/scripts/utils/effect.ts`

```typescript
/**
 * Convert unknown error to Error instance
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Wrap async operation in Effect with standard error handling
 */
export function tryAsync<T>(
  tryFn: () => Promise<T>,
  context?: string,
): Effect.Effect<T, Error> {
  return Effect.tryPromise({
    try: tryFn,
    catch: (error) => {
      const err = toError(error)
      return context ? new Error(`${context}: ${err.message}`) : err
    },
  })
}
```

#### 1.2 Create Logging Utilities
**File**: `src/scripts/utils/logging.ts`

```typescript
export function logSection(title: string): void {
  console.log(`\n▶ ${title}`)
  console.log('━'.repeat(60))
}

export function logHeader(title: string): void {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log(`║ ${title.padEnd(58)} ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
}

export function logSummary(label: string, value: string | number): void {
  console.log(`${label.padEnd(25)} ${value}`)
}
```

### Phase 2: Refactor runImport Function (High Priority)

**File**: `src/scripts/import/index.ts`

Split into focused steps:

```typescript
function displayConfig(config: ImportConfig): void
function setupOutputDirectory(config: ImportConfig): Effect.Effect<void, Error>
function fetchOSMBoundaries(config: ImportConfig): Effect.Effect<OSMBoundary[], Error>
function fetchWikidataCategories(boundaries: OSMBoundary[], skip: boolean): Effect.Effect<Map<string, string>, Error>
function validateCategories(categories: Map<string, string>): Effect.Effect<Map<string, string>, Error>
function transformAndInsertBoundaries(
  osmBoundaries: OSMBoundary[],
  wikidataCategories: Map<string, string>,
  config: ImportConfig
): Effect.Effect<ImportStats, Error>
function displaySummary(stats: ImportStats, osmCount: number, wikidataCount: number): void
```

Main orchestrator becomes:

```typescript
export const runImport = (config: ImportConfig): Effect.Effect<void, Error> => {
  return Effect.gen(function* () {
    displayConfig(config)
    yield* setupOutputDirectory(config)

    const osmBoundaries = yield* fetchOSMBoundaries(config)
    const wikidataCategories = yield* fetchWikidataCategories(osmBoundaries, config.skipWikidata)
    const validCategories = yield* validateCategories(wikidataCategories)

    const stats = yield* transformAndInsertBoundaries(osmBoundaries, validCategories, config)
    displaySummary(stats, osmBoundaries.length, wikidataCategories.size)
  })
}
```

### Phase 3: Update All Effect.tryPromise Calls (High Priority)

Replace all instances of:

```typescript
Effect.tryPromise({
  try: async () => operation(),
  catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
})
```

With:

```typescript
tryAsync(() => operation(), "Operation context")
```

**Files to update**:
- src/scripts/import/database/queries.ts
- src/scripts/import/database/connection.ts
- src/scripts/import/database/verification.ts
- src/scripts/import/fetch-osm.ts
- src/scripts/utils/overpass.ts
- src/scripts/utils/wikidata-api.ts
- src/scripts/utils/wikimedia-commons-api.ts

### Phase 4: Flatten Nested Effect.gen (Medium Priority)

**File**: `src/scripts/import/database/batch.ts`

Extract transaction handling logic to separate function:

```typescript
function processBatchWithClient(
  client: pg.PoolClient,
  batch: AdminBoundaryImport[],
  batchNum: number,
): Effect.Effect<BatchResult, Error>
```

### Phase 5: Create Generic Batch Processor (Medium Priority)

**File**: `src/scripts/utils/batch.ts`

```typescript
export function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[], batchNum: number) => Effect.Effect<R, Error>,
  options?: {
    delayMs?: number
    onProgress?: (batchNum: number, totalBatches: number) => void
  }
): Effect.Effect<R[], Error>
```

Replace batch processing loops in:
- wikidata-api.ts
- wikimedia-commons-api.ts
- database/index.ts

### Phase 6: Create Constants File (Low Priority)

**File**: `src/scripts/constants.ts`

```typescript
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,
} as const

export const BATCH_SIZES = {
  WIKIDATA: 50,
  DATABASE: 1000,
  COMMONS_VALIDATION: 50,
} as const

export const DELAYS = {
  RATE_LIMIT_MS: 100,
  RETRY_EXPONENTIAL_BASE: 2,
} as const
```

### Phase 7: Use Pipe Pattern for Transform (Low Priority)

**File**: `src/scripts/import/transform.ts`

```typescript
import { pipe } from 'effect'

export function transformBoundaries(
  osmBoundaries: OSMBoundary[],
  wikidataCategories: Map<string, string>,
): AdminBoundaryImport[] {
  return pipe(
    osmBoundaries,
    (boundaries) => enrichWithWikidataData(boundaries, wikidataCategories),
    validateGeometries,
    deduplicateBoundaries,
  )
}
```

### Phase 8: Standardize Error Types (Low Priority)

Review all functions returning `Effect<T, never>` and determine if they should:
- Return `Effect<T, Error>` with proper error handling
- Keep `never` if they truly cannot fail (use sparingly)

## Files to Modify

| Priority | File | Changes |
|----------|------|---------|
| High | `src/scripts/utils/effect.ts` | NEW - Error handling utilities |
| High | `src/scripts/utils/logging.ts` | NEW - Logging utilities |
| High | `src/scripts/import/index.ts` | Split runImport into focused functions |
| High | `src/scripts/import/database/queries.ts` | Use tryAsync utility |
| High | `src/scripts/import/database/connection.ts` | Use tryAsync utility |
| High | `src/scripts/import/database/verification.ts` | Use tryAsync utility |
| High | `src/scripts/import/fetch-osm.ts` | Use tryAsync utility |
| High | `src/scripts/utils/overpass.ts` | Use tryAsync utility |
| High | `src/scripts/utils/wikidata-api.ts` | Use tryAsync utility |
| High | `src/scripts/utils/wikimedia-commons-api.ts` | Use tryAsync utility |
| Medium | `src/scripts/import/database/batch.ts` | Flatten nested Effect.gen |
| Medium | `src/scripts/utils/batch.ts` | NEW - Generic batch processor |
| Medium | `src/scripts/utils/wikidata-api.ts` | Use generic batch processor |
| Medium | `src/scripts/utils/wikimedia-commons-api.ts` | Use generic batch processor |
| Medium | `src/scripts/import/database/index.ts` | Use generic batch processor |
| Low | `src/scripts/constants.ts` | NEW - Constants file |
| Low | `src/scripts/import/transform.ts` | Use pipe pattern |
| Low | All files | Standardize error types |

## Testing Checklist

After each phase:
- [ ] Run type checks: `bun typecheck`
- [ ] Run linter: `bun format:check`
- [ ] Verify imports are correct
- [ ] Ensure no unused imports

## Benefits

- **Reduced duplication**: ~100 lines of duplicated error handling removed
- **Improved readability**: Smaller, focused functions
- **Better testability**: Each step can be tested independently
- **Easier maintenance**: Changes to error handling or logging happen in one place
- **Type safety**: Consistent error handling patterns
