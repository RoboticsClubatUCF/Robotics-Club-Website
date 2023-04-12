// lucia.ts
import lucia from 'lucia-auth';
import prisma from '@lucia-auth/adapter-prisma';

export const auth = lucia({
	adapter: prisma(prisma), // TODO: initialize Prisma client
	env: 'DEV' // "PROD" if in prod
});

export type Auth = typeof auth;
