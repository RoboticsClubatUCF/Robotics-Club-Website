import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const isGenerate = process.argv.includes('generate');
const databaseUrl =
	process.env.DATABASE_URL ??
	(isGenerate ? 'postgresql://postgres:postgres@localhost:5432/RCCF' : undefined);

if (!databaseUrl) {
	throw new Error('DATABASE_URL is required for Prisma commands that connect to the database.');
}

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations',
		seed: 'node prisma/seed.js'
	},
	datasource: {
		url: databaseUrl
	}
});
