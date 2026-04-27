import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
const db = new PrismaClient();

const roles = [
  { name: 'admin',     level: 999 },
  { name: 'officer',   level: 10  },
  { name: 'lead',      level: 8   },
  { name: 'committee', level: 6   },
  { name: 'member',    level: 4   },
  { name: 'guest',     level: 0   }
];

async function main() {
  // Ensure all roles exist
  for (const role of roles) {
    await db.role.upsert({
      where: { name: role.name },
      create: { name: role.name, permissionLevel: role.level },
      update: { permissionLevel: role.level }
    });
  }

  if (!(await db.member.findFirst({}))) {
    console.log('No members found — creating default admin account.');
    await db.member.create({
      data: {
        email: 'admin@admin.com',
        discordProfileName: 'admin',
        firstName: 'admin',
        lastName: 'admin',
        passwordHash: await hash('admin', 12),
        role: { connect: { name: 'admin' } }
      }
    });
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
