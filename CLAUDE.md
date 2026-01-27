# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript/Bun/Elysia API that reverse geocodes coordinates to administrative boundaries with Wikimedia Commons and Wikidata metadata.

## Development Commands

### Running the Application

```bash
bun dev          # Start the server (entry: src/index.ts)
bun install          # Install dependencies
bun add <package>    # Add dependencies
```

### Code Quality

```bash
bun typecheck    # TypeScript strict mode checking
bun lint         # Run Biome linter
bun format       # Auto-format code with Biome
bun format:check # Format and lint (applies auto-fixes)
```

### Biome Workflow

- Use `bun biome check --write --unsafe .` to apply all auto-fixes (format + lint)
- Import type declarations must precede value imports
- Use single quotes for strings

## Project Structure

```
src/
├── config/env.ts          # Environment configuration (use Bun.env, not process.env)
├── index.ts               # Elysia app entry point
├── services/
│   ├── database.service.ts    # PostgreSQL connection & queries
│   └── geocode.service.ts     # Core business logic
└── types/
    ├── errors.ts              # Custom error classes
    └── geocode.types.ts       # TypeScript types & Elysia schemas
```

## Key Patterns

- **Environment variables**: Access via `Bun.env` (Bun-native, not process.env)

## Runtime Environment

- **Runtime**: Bun 1.3.7 (required - specified in `package.json` engines field)
- **Language**: TypeScript with ESNext target
- **Module System**: ES modules (type: "module" in package.json)
- **Framework**: Elysia (type-safe web framework)
- **Database**: PostgreSQL with PostGIS extension

## TypeScript Configuration

The project uses strict TypeScript configuration with several safety features enabled:

- Strict mode with additional type safety checks
- `noUncheckedIndexedAccess` - prevents accidental undefined access when indexing
- `noImplicitOverride` - requires explicit override keyword for overridden methods
- `noFallthroughCasesInSwitch` - prevents switch statement fallthrough errors
- `verbatimModuleSyntax` - requires explicit type imports

## Database Setup

1. Run migration: `psql -d your_database -f migrations/001_initial_schema.sql`
2. Configure `DATABASE_URL` in `.env` (see `.env.example`)
3. Import boundary data from Wikidata/OpenStreetMap (future work)
