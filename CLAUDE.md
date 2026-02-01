# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript/Bun/Elysia API that reverse geocodes coordinates to administrative boundaries with Wikimedia Commons and Wikidata metadata. The project uses **Effect TS** for predictable error handling and functional composition throughout the business logic layer.

## Development Commands

### Running the Application

```bash
bun dev          # Start the server (entry: src/index.ts)
bun install      # Install dependencies
bun add <package>  # Add dependencies
```

### Code Quality

```bash
bun typecheck    # TypeScript strict mode checking
bun lint         # Run Biome linter
bun format       # Auto-format code with Biome
bun format:check # Format and lint (applies auto-fixes)
```

### Data Import

```bash
bun import:data     # Run full import pipeline (orchestrator)
bun import:osm      # Fetch OSM data only
bun import:database # Batch insert to database only
```

### Biome Workflow

- Use `bun biome check --write --unsafe .` to apply all auto-fixes (format + lint)
- Import type declarations must precede value imports
- Use single quotes for strings

## Project Structure

```
src/
├── config/env.ts          # Environment configuration (use Bun.env, not process.env)
├── index.ts               # Elysia app entry point with Effect.runPromise() bridge
├── services/              # Business logic layer - returns Effect types
│   ├── database.service.ts    # PostgreSQL connection & queries (Effect-wrapped)
│   └── geocode.service.ts     # Core reverse geocoding logic
├── types/                 # TypeScript type definitions
│   ├── errors.ts              # Custom error classes with _tag discriminator
│   ├── geocode.types.ts       # API schemas and types
│   └── import.types.ts        # Data import system types
└── scripts/               # Data import system
    ├── constants.ts           # Import configuration constants
    ├── import/
    │   ├── index.ts           # Main orchestrator
    │   ├── fetch-osm.ts       # Fetch OSM boundaries via Overpass API
    │   └── database/          # Batch insert operations
    └── utils/
        ├── effect.ts          # Effect TS helpers (tryAsync, toError)
        ├── batch.ts           # Batch processing utilities
        ├── wikidata-api.ts    # Wikidata REST API client
        └── logging.ts         # Logging utilities
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

### Effect Utilities

Use helpers from `src/scripts/utils/effect.ts`:
- `tryAsync(tryFn, context?)` - Wrap async operations with standard error handling
- `toError(error)` - Convert unknown errors to Error instances

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

## Data Import Scripts

### Import Architecture

- **OSM data**: Fetched via Overpass API with wikidata tags already present
  - Uses `out bb;` query format to get bounding boxes (minlat, minlon, maxlat, maxlon)
  - Converts bounding boxes to GeoJSON Polygon (4 corner points)
  - **Known limitation**: Bounding boxes are approximations, may overlap at borders
- **Wikidata data**: Uses Wikidata REST API (`wbgetentities` action) - simpler than SPARQL
- **Batch processing**: Up to 50 IDs per request with 100ms rate limiting
- **Error resilience**: Continues processing even with partial failures
- **Progress tracking**: Logs statistics and skipped entities

### Import Scripts Structure

```
src/scripts/
├── constants.ts        # BATCH_SIZE, RATE_LIMIT_MS, admin levels
├── import/
│   ├── index.ts        # Orchestrator: fetch → transform → insert
│   ├── fetch-osm.ts    # Overpass API integration
│   └── database/       # Batch insert with transaction support
└── utils/
    ├── effect.ts       # Effect TS helpers
    ├── batch.ts        # Batch processing logic
    ├── wikidata-api.ts # REST API client
    └── logging.ts      # Progress logging
```

### Environment Variables for Import

- `COUNTRY_CODE` - ISO country code (required)
- `ADMIN_LEVELS` - Comma-separated admin levels (default: "4,6,8")
- `BATCH_SIZE` - Wikidata API batch size (default: 50)
- `RATE_LIMIT_MS` - Delay between batches (default: 100)
- `OUTPUT_DIR` - Optional intermediate file output (code handles null safely)
- `DATABASE_URL` - PostgreSQL connection string (required for database operations)

## Import System Gotchas

### Wikidata ID Format
**CRITICAL**: Always preserve "Q" prefix in Wikidata IDs (e.g., "Q240" not "240")
- OSM tags: `wikidata="Q240"` - extract as-is (only strip URL prefix)
- Wikidata API: Query with "Q240" - receives category data
- Database: Store as "Q240" - used for lookups
- Bug pattern: `.replace('Q', '')` breaks the entire pipeline

### Overpass API Query Format
Use `out bb;` for bounding boxes (fast, simple rectangles)
- Alternative `out geom;` doesn't return geometry for relations
- Alternative `out body; >; out skel qt;` times out for complex countries (too much data)
- Trade-off: Bounding boxes may overlap at borders, causing inaccurate matches

### API Endpoint
Reverse geocoding endpoint is `/geocode?lat={lat}&lon={lon}`, not root path
- Correct: `curl "http://localhost:3000/geocode?lat=50.85&lon=4.35"`
- Incorrect: `curl "http://localhost:3000/?lat=50.85&lon=4.35"` (returns 404)

### Docker Workflow After Import
After running `bun import:data`, restart the app container to refresh database connection pool
- Connection pool initializes before import completes
- `docker compose restart app` fixes "Location not found" errors post-import

## Runtime Environment

- **Runtime**: Bun 1.3.8 (required - specified in `package.json` engines field)
- **Language**: TypeScript with ESNext target
- **Module System**: ES modules (type: "module" in package.json)
- **Framework**: Elysia 1.4.22 (type-safe web framework)
- **Functional Library**: Effect TS 3.19.15 (error handling and composition)
- **Database**: PostgreSQL with PostGIS extension
- **Testing**: None currently implemented

## TypeScript Configuration

The project uses strict TypeScript configuration with several safety features enabled:

- Strict mode with additional type safety checks
- `noUncheckedIndexedAccess` - prevents accidental undefined access when indexing
- `noImplicitOverride` - requires explicit override keyword for overridden methods
- `noFallthroughCasesInSwitch` - prevents switch statement fallthrough errors
- `verbatimModuleSyntax` - requires explicit type imports

## Database Setup

1. Run migration: `psql -d your_database -f migrations/001_initial_schema.sql`
2. Configure `DATABASE_URL` in environment variables (see `.env.example`)
3. Import boundary data: `bun import:data` (requires COUNTRY_CODE and other env vars)

### Database Schema

- **boundaries** table with PostGIS geometry column
- **Indexes**: GIST spatial index, admin_level, wikidata_id
- **Spatial queries**: ST_Contains() for point-in-polygon checks
- **Connection pooling**: Singleton pattern in `getPool()`

## Docker Development

```bash
docker compose up -d      # Start all services (postgres, app)
docker compose down       # Stop services
docker compose down -v    # Stop and remove volumes (fresh start)
docker compose ps         # Check service status
docker compose logs app   # View app logs
docker compose exec postgres psql -U geocode -d geocode  # Connect to DB
```

### Docker Services

- **postgres**: PostgreSQL 17 + PostGIS 3.4 Alpine, exposes port 5432
- **app**: Bun API server, exposes port 3000

### Docker Compose Patterns

- Use `docker compose` (modern syntax, not `docker-compose`)
- Migrations in `migrations/` directory mount to `/docker-entrypoint-initdb.d` and run automatically on postgres start
- Use `IF NOT EXISTS` in migrations for idempotency (safe to re-run with fresh volumes)
- Always test Docker changes with `docker compose down -v && docker compose up -d` before committing

## GitButler Workflow

This project uses GitButler CLI (`but`) for all version control operations - **never use standard git commands**
- `but status` - Check unstaged changes and branch status
- `but commit -c -m "message" branch-name` - Create new branch and commit unassigned changes
- `but commit -m "message" branch-name` - Add commit to existing branch (stage files first with `but stage`)
- `but push branch-name` - Push branch to remote
- `but pr new branch-name -t` - Create PR using commit message for title

## Hierarchical Import System

New import system in `src/scripts/import/hierarchical/` for fetching administrative boundaries at multiple levels:
- `bun import:hierarchical` - Run hierarchical import (set COUNTRY_CODE for single country)
- `ADMIN_LEVEL_START` and `ADMIN_LEVEL_END` - Required env vars to specify admin level range
- **Overpass area IDs**: Use `3600000000 + relationId` to convert relation IDs to area IDs for spatial queries
- **Skip logic**: Use `continue` not `break` when admin level is empty - preserves parent chain for next level search
- Two database tables: `osm_relations` (hierarchical import) and `admin_boundaries` (legacy import, used by main API)

## Working with Temporary Files

- Create temporary files in `.tmp/` directory within project (outside project root is forbidden)
- Clean up temporary files after use: `rm .tmp/filename`
- Use Write tool for file creation, not Bash echo redirection
