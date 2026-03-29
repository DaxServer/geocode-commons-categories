# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript/Bun/Elysia API that reverse geocodes coordinates to administrative boundaries with Wikimedia Commons and Wikidata metadata. The project uses **Effect TS** for predictable error handling and functional composition throughout the business logic layer.

## Development Commands

### Code Quality

```bash
bun typecheck    # TypeScript strict mode checking
bun lint         # Run Biome linter
bun format       # Auto-format code with Biome
```

### Testing

```bash
bun test                           # Run all tests
bun test src/import/utils/retry.test.ts  # Run single test file
bun test --only                   # Run only test.only() marked tests
bun test -t "pattern"             # Run tests matching name pattern
bun test --coverage               # Run with coverage report
```

Tests use Bun's built-in test runner with `bun:test`:

```typescript
import { describe, expect, mock, test } from 'bun:test'
import { Effect } from 'effect'

describe('fetchWithRetry', () => {
  test('should succeed on first attempt', async () => {
    const result = await Effect.runPromise(fetchWithRetry({ url: '...' }))
    expect(result).toEqual({ /* expected */ })
  })
})
```

### Biome Workflow

- Use `bun biome check --write --unsafe .` to apply all auto-fixes (format + lint)
- Import type declarations must precede value imports
- Use single quotes for strings
- `noUnusedVariables` is disabled for `*.vue` files (Biome can't see template usage from `<script setup>`)

## Project Structure

```
packages/
├── backend/                # Backend (Elysia API)
│   ├── src/
│   │   ├── config/env.ts   # Environment configuration (use Bun.env, not process.env)
│   │   ├── index.ts        # Elysia app entry point with Effect.runPromise() bridge
│   │   ├── services/       # Business logic layer - returns Effect types
│   │   │   └── nominatim.service.ts # Reverse geocoding with Nominatim
│   │   └── types/          # TypeScript type definitions
│   │       ├── errors.ts   # Custom error classes with _tag discriminator
│   │       └── geocode.types.ts     # API schemas and types
│   └── tsconfig.json       # TypeScript config for backend
└── dashboard/             # Frontend (Vue 3 + PrimeVue)
    ├── src/
    │   ├── components/     # Vue components
    │   └── stores/         # Pinia stores
    └── tsconfig.vue.json   # Vue-specific TypeScript config
```

## Effect TS Integration

### Core Pattern

All service layer functions return `Effect.Effect<Success, ErrorType>` for error-safe operations:

```typescript
export const reverseGeocode = (
  lat: number,
  lon: number,
): Effect.Effect<GeocodeResponse, NotFoundError | DatabaseError> => {
  return Effect.map(findAdminBoundary(lat, lon), (boundary) => ({
    // ... transformation
  }))
}
```

### Running Effects in HTTP Handlers

Bridge Effect to async/await at the HTTP layer:

```typescript
app.get('/', async ({ query }) => {
  return Effect.runPromise(
    reverseGeocode(query.lat, query.lon)
  )
})
```

### Database Queries

Wrap database operations in `Effect.tryPromise`:

```typescript
return Effect.tryPromise({
  try: async () => {
    const result = await pool.query('SELECT ...')
    if (!result.rows[0]) {
      throw new NotFoundError('Location not found')
    }
    return result.rows[0]
  },
  catch: (error) => new DatabaseError('Database query failed', error)
})
```

### Key Effect Patterns

- **Error composition**: Use pipe operators and combinators (`Effect.map`, `Effect.flatMap`)
- **Resource cleanup**: Use `Effect.ensuring()` for guaranteed cleanup
- **Error recovery**: Use `Effect.catchAll()` or `Effect.catchTag()` for typed error handling
- **Generator syntax**: Use `Effect.gen()` for sequential async operations

## Error Handling

### Custom Error Types

All errors have a `_tag` discriminator for Effect.catchTag:

```typescript
export class NotFoundError extends Error {
  readonly _tag = 'NotFoundError'
  readonly status = 404
}

export class DatabaseError extends Error {
  readonly _tag = 'DatabaseError'
  readonly status = 500
  readonly originalError?: unknown
}
```

### Error Handling Flow

1. Service layer throws custom errors (NotFoundError, DatabaseError)
2. Effect.tryPromise catches and wraps them in Effect
3. HTTP handler runs Effect and maps errors to HTTP responses
4. Elysia global error handler converts Error to HTTP status codes

## Code Style Patterns

- Use `type` aliases instead of `interface` declarations for type definitions
- Access properties on `Record<string, string>` index signatures with bracket notation: `obj['key']` (required by TypeScript strict mode)
- Biome's `useLiteralKeys` rule is disabled to avoid conflicts with TypeScript index signature requirements
- **Functional composition preferred** over imperative control flow in business logic
- **Path aliases required**:
  - `@backend/` - backend internal imports (use this instead of relative paths within backend)
  - `@frontend/` - backend imports from frontend (if needed)
  - Never use relative imports like `../../` across packages

### Naming Conventions
- PascalCase for types and classes: `GeocodeResponse`, `NotFoundError`
- camelCase for variables and functions: `reverseGeocode`, `fetchWithRetry`
- UPPER_SNAKE_CASE for constants: `MAX_ATTEMPTS`, `DELAYS`
- Do NOT prefix interfaces with `I` - use descriptive names instead

## API Endpoint

Reverse geocoding endpoint is `/geocode?lat={lat}&lon={lon}`, not root path
- Correct: `curl "http://localhost:3000/geocode?lat=50.85&lon=4.35"`
- Incorrect: `curl "http://localhost:3000/?lat=50.85&lon=4.35"` (returns 404)

## Wikidata ID Handling

**CRITICAL**: Always preserve "Q" prefix in Wikidata IDs:
- OSM tags: `wikidata="Q240"` → extract as-is
- Wikidata API: Query with "Q240"
- Database: Store as "Q240"
- Never strip with `.replace('Q', '')` - breaks entire pipeline

## Runtime Environment

- **Runtime**: Bun (required - specified in `package.json` engines field)
- **Language**: TypeScript with ESNext target
- **Module System**: ES modules (type: "module" in package.json)
- **Framework**: Elysia (type-safe web framework)
- **Functional Library**: Effect TS (error handling and composition)
- **Database**: PostgreSQL with PostGIS extension

## TypeScript Configuration

The project uses strict TypeScript configuration with several safety features enabled:

- Strict mode with additional type safety checks
- `noUncheckedIndexedAccess` - prevents accidental undefined access when indexing
- `noImplicitOverride` - requires explicit override keyword for overridden methods
- `noFallthroughCasesInSwitch` - prevents switch statement fallthrough errors
- `verbatimModuleSyntax` - requires explicit type imports

The root `tsconfig.json` handles both backend and frontend packages via `include`, while `packages/dashboard/tsconfig.vue.json` provides Vue-specific configuration.

## Docker Development

```bash
docker compose up -d      # Start all services (postgres, app)
docker compose down       # Stop services
docker compose down -v    # Stop and remove volumes (fresh start)
docker compose ps         # Check service status
docker compose logs app   # View app logs
docker compose exec postgres psql -U geocode -d geocode  # Connect to DB
```

## Environment Variables

Env var types are declared in `env.d.ts` (project root) via `declare module 'bun' { interface Env { ... } }`. Add new env vars there — required vars typed as `string`, optional as `string | undefined`. **`env.d.ts` already exists — never recreate it, only add to it.**

Use `Bun.env.VARIABLE_NAME` - never `process.env`.

## Nominatim Integration

The `/geocode` endpoint queries a Nominatim PostgreSQL instance directly at runtime — no pre-import needed.

### Connection
- Configure via `NOMINATIM_DATABASE_URL` environment variable
- Queries the `placex` table (Nominatim's main places table)

### Core Query Pattern
- `ST_Contains(geometry, ST_SetSRID(ST_MakePoint(lon, lat), 4326))` — point-in-polygon
- `extratags ? 'wikidata'` — only rows with a Wikidata ID
- `linked_place_id IS NULL` — exclude duplicates linked to a parent place
- `ORDER BY ST_Area(geometry) ASC` — smallest (most specific) boundary first
- **Do not cast to `::geography`** for `ST_Area` in ORDER BY — it's 2x slower with no benefit for relative ordering

### Commons Category Resolution
- `extratags->'wikimedia_commons'` contains the category **with** `Category:` prefix — strip it before use
- If absent, fall back to Wikidata API (P373 claim, then commonswiki sitelink)
- Wikidata results are cached in-memory (`categoryCache` Map)

### Logging
- Uses `@bogeychan/elysia-logger` (pino) — `ctx.log` available in route handlers
- Use `log.child({ lat, lon })` to bind request coordinates to all downstream log calls
- `log` is not available in Elysia's `onError` handler — use `console.error` there

## Working with Temporary Files

- Create temporary files in `.tmp/` directory within project (outside project root is forbidden)
- Clean up temporary files after use: `rm .tmp/filename`
- Use Write tool for file creation, not Bash echo redirection
