import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DATABASE_URL } from '$env/static/private';
import { dev } from '$app/environment';
import pg from 'pg';

declare global {
	var __prisma: PrismaClient | undefined;
}

function createClient() {
	if (!DATABASE_URL) {
		throw new Error('DATABASE_URL is required to initialize Prisma');
	}

	const pool = new pg.Pool({ connectionString: DATABASE_URL });
	const adapter = new PrismaPg(pool);
	return new PrismaClient({ adapter });
}

const prisma = globalThis.__prisma ?? createClient();

if (dev) {
	globalThis.__prisma = prisma;
}

export { prisma };
