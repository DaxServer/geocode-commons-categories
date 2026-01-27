# Geocode Commons Categories API

A TypeScript/Bun/Elysia API that reverse geocodes coordinates to administrative boundaries with Wikimedia Commons and Wikidata metadata.

## Features

- **GET `/geocode`** - Reverse geocode a single location
- **POST `/geocode`** - Reverse geocode multiple locations
- Returns admin level, Commons category, and Wikidata ID
- Built with Elysia for type-safe validation
- PostGIS for spatial queries

## Setup

### Install dependencies

```bash
bun install --frozen-lockfile
```

### Database setup

1. Create a PostgreSQL database with PostGIS extension
2. Run the migration:

```bash
psql -d your_database -f migrations/001_initial_schema.sql
```

3. Import boundary data from Wikidata/OpenStreetMap (data import script to be implemented)

### Environment

Create a `.env` file (see `.env.example`):

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
PORT=3000
HOST=0.0.0.0
```

## Running

```bash
bun src/index.ts
```

## API Endpoints

### GET `/geocode`

Query params:
- `lat` (number) - Latitude
- `lon` (number) - Longitude

Response:

```json
{
  "admin_level": 6,
  "commons_cat": {
    "title": "Brighton and Hove",
    "url": "https://commons.wikimedia.org/wiki/Category:Brighton and Hove"
  },
  "coords": {
    "lat": 50.832633,
    "lon": -0.268933
  },
  "wikidata": "Q22989"
}
```

### POST `/geocode`

Body: Array of `{ lat: number; lon: number }`

Response: Array of geocode responses

## Development

### Type check

```bash
bun typecheck
```

### Type checking

The project uses strict TypeScript configuration. All types are explicitly defined (no `any` types).
