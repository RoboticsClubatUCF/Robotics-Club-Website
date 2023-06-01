// app.d.ts
/// <reference types="lucia-auth" />

import type { PrismaClient } from '@prisma/client';
declare namespace App {
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

declare global {
  namespace App {
    let prisma: PrismaClient;
  }
}
