// app.d.ts
/// <reference types="lucia-auth" />

import type { PrismaClient } from '@prisma/client';

declare global {
  namespace App {
    let prisma: PrismaClient;
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
