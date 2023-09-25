// app.d.ts

import type { PrismaClient } from '@prisma/client';

declare global {
  namespace App {
    const prisma: PrismaClient;
    interface Locals {
      member: {
        fname: string;
        permissions: {
          name: string;
          level: number;
        };
        email: string;
      };
    }
  }
}
