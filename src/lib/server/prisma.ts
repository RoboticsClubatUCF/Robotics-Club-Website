import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import pg from 'pg';

declare global {
	var __prisma: PrismaClient | undefined;
}

function createClient() {
	if (!env.DATABASE_URL) {
		throw new Error('DATABASE_URL is required to initialize Prisma');
	}

	const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
	const adapter = new PrismaPg(pool);
	return new PrismaClient({ adapter });
}

let prismaClient = globalThis.__prisma;

function getClient() {
	if (!prismaClient) {
		prismaClient = createClient();
		if (dev) {
			globalThis.__prisma = prismaClient;
		}
	}

	return prismaClient;
}

const prisma = new Proxy({} as PrismaClient, {
	get(_target, prop) {
		const client = getClient();
		const value = client[prop as keyof PrismaClient];
		return typeof value === 'function' ? value.bind(client) : value;
	}
});

export { prisma };
