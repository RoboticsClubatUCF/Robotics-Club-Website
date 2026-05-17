import 'dotenv/config';
import pkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt';

const { PrismaClient } = pkg;

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL is required to seed the database.');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const roles = [
	{ name: 'admin', permissionLevel: 999 },
	{ name: 'officer', permissionLevel: 10 },
	{ name: 'project lead', permissionLevel: 8 },
	{ name: 'team lead', permissionLevel: 6 },
	{ name: 'member', permissionLevel: 4 },
	{ name: 'guest', permissionLevel: 0 }
];

async function main() {
	for (const role of roles) {
		await db.role.upsert({
			where: { name: role.name },
			create: role,
			update: { permissionLevel: role.permissionLevel }
		});
	}

	if (await db.user.findFirst({ select: { id: true } })) return;

	const adminPassword = process.env.SEED_ADMIN_PASSWORD;
	if (!adminPassword) {
		console.log(
			'No users found and SEED_ADMIN_PASSWORD is not set; skipping default admin creation.'
		);
		return;
	}
	if (adminPassword.length < 12) {
		throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters long.');
	}

	console.log('No users found; creating default admin account.');
	await db.user.create({
		data: {
			ucfEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
			discordUserName: process.env.SEED_ADMIN_DISCORD ?? 'admin',
			firstName: process.env.SEED_ADMIN_FIRST_NAME ?? 'admin',
			lastName: process.env.SEED_ADMIN_LAST_NAME ?? null,
			passwordHash: await hash(adminPassword, 12),
			roleName: 'admin'
		}
	});
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
