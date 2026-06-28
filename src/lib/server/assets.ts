// Server-only helpers for storing, serving, and garbage-collecting uploaded image
// files on local disk (persisted via a Docker volume). See src/lib/imageRef.ts for the
// stored-string format and prisma Picture.storageKey for the upload reference.
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { isValidStorageKey } from '$lib/imageRef';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import path from 'node:path';

/** Directory uploaded files live in. Configurable per-deployment; defaults to <cwd>/uploads. */
export const UPLOAD_DIR = env.UPLOAD_DIR
  ? path.resolve(env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

/** Max accepted upload size. Keep below the adapter-node BODY_SIZE_LIMIT (see Dockerfile). */
export const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// MIME -> file extension allowlist. SVG is allowed but sanitized on the way in and served
// with a locked-down CSP (it is only ever rendered via <img>, which never runs SVG script).
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg'
};

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml'
};

export class UploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Sniff the real image type from magic bytes; SVG is detected from its text head. */
function detectMime(bytes: Uint8Array, declared: string): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
    return 'image/webp';
  // SVG: no binary magic — look for an <svg root in the leading text.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 1024)).trimStart();
  if ((head.startsWith('<?xml') || head.startsWith('<svg') || head.includes('<svg')) && declared.includes('svg'))
    return 'image/svg+xml';
  return null;
}

/** Best-effort SVG hardening: drop scripts, event handlers, and javascript: URIs. */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*script[^>]*\/?\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, '');
}

export interface SavedUpload {
  storageKey: string;
  mimeType: string;
  size: number;
}

/** Validate and persist an uploaded File, returning its storage key + metadata. */
export async function saveUpload(file: File): Promise<SavedUpload> {
  if (file.size === 0) throw new UploadError('Empty file.');
  if (file.size > MAX_BYTES) throw new UploadError('File too large (max 5 MB).', 413);

  const buf = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectMime(buf, file.type || '');
  if (!mimeType || !(mimeType in MIME_EXT)) {
    throw new UploadError('Unsupported image type. Allowed: PNG, JPEG, WEBP, GIF, SVG.');
  }

  let data: Uint8Array = buf;
  if (mimeType === 'image/svg+xml') {
    const cleaned = sanitizeSvg(new TextDecoder('utf-8', { fatal: false }).decode(buf));
    data = new TextEncoder().encode(cleaned);
  }

  const ext = MIME_EXT[mimeType];
  const storageKey = `${randomUUID()}.${ext}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, storageKey), data);

  return { storageKey, mimeType, size: data.byteLength };
}

/** Map a storage key to its Content-Type for the serving route. */
export function mimeTypeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

export function uploadPath(key: string): string {
  return path.join(UPLOAD_DIR, key);
}

/** Remove a file from disk. Idempotent — a missing file is not an error. */
export async function deleteUploadFile(key: string | null | undefined): Promise<void> {
  if (!key || !isValidStorageKey(key)) return;
  try {
    await unlink(path.join(UPLOAD_DIR, key));
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      // Swallow — the orphan sweep is the authoritative GC backstop.
      console.warn(`deleteUploadFile failed for ${key}:`, e);
    }
  }
}

/**
 * Is an uploaded file still referenced by any surface? Optionally ignore one Picture row
 * (used when the caller is about to repoint/delete that specific Picture).
 */
export async function isKeyReferenced(
  key: string,
  opts: { exceptPictureId?: number } = {}
): Promise<boolean> {
  if (!isValidStorageKey(key)) return true; // never delete on a malformed key
  const needle = `/uploads/${key}`;
  const [pic, sponsor, member, content] = await Promise.all([
    db.picture.findFirst({
      where: {
        storageKey: key,
        ...(opts.exceptPictureId ? { NOT: { id: opts.exceptPictureId } } : {})
      },
      select: { id: true }
    }),
    db.webSponsor.findFirst({ where: { imageUrl: { contains: needle } }, select: { id: true } }),
    db.member.findFirst({ where: { profilePictureUrl: { contains: needle } }, select: { id: true } }),
    db.siteContent.findFirst({ where: { value: { contains: needle } }, select: { id: true } })
  ]);
  return !!(pic || sponsor || member || content);
}

/** Count how many records reference a Picture row across every relation that can. */
export async function pictureReferenceCount(pictureId: number): Promise<number> {
  const [proj, art, blog, item, tag] = await Promise.all([
    db.project.count({ where: { pictureId } }),
    db.article.count({ where: { pictureId } }),
    db.blogPost.count({ where: { pictureId } }),
    db.item.count({ where: { pictureId } }),
    db.tag.count({ where: { pictureId } })
  ]);
  return proj + art + blog + item + tag;
}

/** Delete a file from disk only if nothing else still references its key. */
export async function safeDeletePhysical(
  key: string | null | undefined,
  opts: { exceptPictureId?: number } = {}
): Promise<void> {
  if (!key || !isValidStorageKey(key)) return;
  if (await isKeyReferenced(key, opts)) return;
  await deleteUploadFile(key);
}
