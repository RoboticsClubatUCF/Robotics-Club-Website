import { PrismaPg } from '@prisma/adapter-pg'
import { env } from './env.js'
import { PrismaClient } from '../generated/prisma/client.js'

// Prisma 7 talks to Postgres through a driver adapter rather than the old Rust
// query engine, so the pool is ours to size. The ceiling matters once more than
// one instance is running: each holds its own pool against the same server.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
})

// One client per process. Without this, every hot reload in dev opens a fresh
// pool and Postgres runs out of connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
