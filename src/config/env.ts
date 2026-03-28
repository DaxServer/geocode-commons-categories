export const config = {
  databaseUrl: Bun.env.DATABASE_URL,
  nominatimDatabaseUrl: Bun.env.NOMINATIM_DATABASE_URL,
  port: Number(Bun.env.PORT) || 3000,
  host: Bun.env.HOST || '0.0.0.0',
} as const
