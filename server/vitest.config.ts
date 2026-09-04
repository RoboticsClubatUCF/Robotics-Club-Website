import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Integration tests: they run the real Hono app against the real database, because every public
    // route is a query and mocking Prisma would only prove the mock works. Postgres has to be up
    // (`npm run db:up`).
    //
    // Run in one process. Several tests count rows and compare them against a listing of the same
    // rows; parallel files writing to the same database would make that a race.
    fileParallelism: false,
    // The first query pays for the connection pool warming up.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
