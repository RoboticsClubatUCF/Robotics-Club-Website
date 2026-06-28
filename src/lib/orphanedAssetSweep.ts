import { db } from '$lib/db';
import { keyFromSrc } from '$lib/imageRef';
import { UPLOAD_DIR, deleteUploadFile, safeDeletePhysical } from '$lib/server/assets';
import { readdir } from 'node:fs/promises';

// Authoritative garbage-collection backstop for uploaded image files. Mirrors the
// membershipSweep pattern (see $lib/membershipSweep). Two passes:
//   1. delete files in UPLOAD_DIR that nothing in the DB references
//   2. delete Picture rows that no record references (and their files)
export async function sweepOrphanedAssets(): Promise<string[]> {
  const lines: string[] = [`Asset sweep started at ${new Date().toISOString()}`];

  // 1. Collect every upload key referenced anywhere.
  const referenced = new Set<string>();
  const add = (v: string | null | undefined) => {
    const k = keyFromSrc(v);
    if (k) referenced.add(k);
  };

  for (const p of await db.picture.findMany({
    where: { storageKey: { not: null } },
    select: { storageKey: true }
  })) {
    if (p.storageKey) referenced.add(p.storageKey);
  }
  for (const r of await db.webSponsor.findMany({ select: { imageUrl: true } })) add(r.imageUrl);
  for (const r of await db.member.findMany({ select: { profilePictureUrl: true } })) add(r.profilePictureUrl);
  for (const r of await db.siteContent.findMany({ select: { value: true } })) add(r.value);

  // 2. Remove files on disk that nothing references.
  let files: string[] = [];
  try {
    files = await readdir(UPLOAD_DIR);
  } catch {
    files = [];
  }
  let removedFiles = 0;
  for (const f of files) {
    if (!referenced.has(f)) {
      await deleteUploadFile(f);
      removedFiles++;
      lines.push(`Deleted orphan file ${f}`);
    }
  }
  lines.push(`Removed ${removedFiles} orphan file(s) of ${files.length} on disk.`);

  // 3. Remove Picture rows that no record references (and their backing files).
  const orphanPics = await db.picture.findMany({
    where: {
      Article: { none: {} },
      BlogPost: { none: {} },
      Project: { none: {} },
      Item: { none: {} },
      Tags: { none: {} }
    },
    select: { id: true, storageKey: true }
  });
  for (const pic of orphanPics) {
    await db.picture.delete({ where: { id: pic.id } });
    await safeDeletePhysical(pic.storageKey, { exceptPictureId: pic.id });
    lines.push(`Deleted orphan Picture ${pic.id}`);
  }
  lines.push(`Removed ${orphanPics.length} orphan Picture row(s).`);

  lines.push('Done.');
  return lines;
}
