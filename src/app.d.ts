// app.d.ts

import type { PrismaClient } from '@prisma/client';

declare module '*.postcss';
declare module '*.css';


declare global {
  namespace App {
    const prisma: PrismaClient;
    interface Locals {
      member: {
        fname: string;
        lname: string | null;
        permissions: {
          name: string;
          level: number;
        };
        email: string;
      };
    }
  }
}
