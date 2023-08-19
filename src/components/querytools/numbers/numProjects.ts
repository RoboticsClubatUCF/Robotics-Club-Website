import { db } from '$lib/db';

export default async () => {
  return await db.project.count();
};
