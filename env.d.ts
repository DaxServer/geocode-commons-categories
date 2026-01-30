declare module 'bun' {
  interface Env {
    DATABASE_URL: string
    PORT?: string
    HOST?: string
    // Import script environment variables
    COUNTRY_CODE: string
    ADMIN_LEVELS: string
    BATCH_SIZE: string
    SKIP_WIKIDATA: string
    OUTPUT_DIR: string
    INPUT_FILE: string
  }
}
