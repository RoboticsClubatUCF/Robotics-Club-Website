import 'dotenv/config';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const roles = [
  { name: 'admin',        permissionLevel: 999 },
  { name: 'officer',      permissionLevel: 10  },
  { name: 'project lead', permissionLevel: 8   },
  { name: 'team lead',    permissionLevel: 6   },
  { name: 'member',       permissionLevel: 4   },
  { name: 'guest',        permissionLevel: 0   }
];

async function main() {
  for (const role of roles) {
    await db.role.upsert({
      where:  { name: role.name },
      create: role,
      update: { permissionLevel: role.permissionLevel }
    });
  }

  if (!(await db.user.findFirst({}))) {
    console.log('No users found — creating default admin account.');
    await db.user.create({
      data: {
        ucfEmail:        'admin@admin.com',
        discordUserName: 'admin',
        firstName:       'admin',
        lastName:        'admin',
        passwordHash:    await hash('admin', 12),
        roleName:        'admin'
      }
    });
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
