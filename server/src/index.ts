import { serve } from '@hono/node-server'
import { app } from './app.js'
import { prisma } from './db.js'
import { env } from './env.js'
import { sweepRateLimits } from './rateLimit.js'

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/api`)
})

// Closed rate-limit windows are dead rows. Every instance sweeps; the deletes
// are idempotent, so overlapping runs are harmless. unref() keeps the timer
// from holding the process open during shutdown.
const sweep = setInterval(
  () => {
    void sweepRateLimits().catch((error: unknown) => {
      console.error('rate limit sweep failed', error)
    })
  },
  10 * 60 * 1000,
)
sweep.unref()

// Stop accepting connections, let in-flight requests finish, then drop the pool.
// Without this a rolling deploy cuts requests off mid-write.
let shuttingDown = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true

    clearInterval(sweep)
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0))
    })

    // Don't let a stuck connection hold the deploy open forever.
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
