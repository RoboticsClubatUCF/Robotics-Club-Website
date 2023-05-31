// app.d.ts
/// <reference types="lucia-auth" />

import type { PrismaClient } from '@prisma/client';

// app.d.ts
/// <reference types="@sveltejs/kit" />
declare namespace App {
  type AuthRequest = import('lucia-auth').AuthRequest;
  // Locals must be an interface and not a type
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Locals extends AuthRequest {}
}

declare global {
  namespace App {
    let prisma: PrismaClient;
  }
}
