import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
const db = new PrismaClient();
import config from '../src/config';

async function main() {
  if (await db.member.findFirst({})) {
    // no user exists, we need to make one
    console.log('Creating a new user!');

    await db.member.create({
      data: {
        email: 'admin@admin.com',
        discordProfileName: 'admin',
        firstName: 'admin',
        lastName: 'admin',
        passwordHash: await hash('admin', 12),
        role: {
          connectOrCreate: {
            where: {
              name: config.roles.officer.name
            },
            create: {
              name: config.roles.officer.name,
              permissionLevel: config.roles.officer.level
            }
          }
        }
      }
    });
  }
}
