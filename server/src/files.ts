import { prisma } from './db.js'
import type { FileKind } from './generated/prisma/enums.js'

/**
 * Stored files: bytes in Postgres, addressed as `/api/files/<id>`.
 *
 * The prefix is load-bearing. Image columns (`Project.coverUrl` and friends)
 * hold either an external URL somebody typed or the address of an upload, and
 * the difference matters exactly once: when a replacement arrives, the old
 * value is deleted **only if it was ours**. `deleteIfStored` is that rule in
 * one place, so no route re-implements it slightly differently.
 */

export const STORED_PREFIX = '/api/files/'

/** The served address of a stored file — what goes into an image column. */
export const storedUrl = (id: string) => `${STORED_PREFIX}${id}`

export async function storeFile(
  kind: FileKind,
  file: File,
  createdById: string | null,
): Promise<{ id: string; url: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  const stored = await prisma.storedFile.create({
    data: {
      kind,
      // The browser's word for it, good enough for a Content-Type header. The
      // things that matter — kind, size, magic bytes for prints — are checked
      // by the routes, not taken on faith from here.
      mimeType: file.type || 'application/octet-stream',
      byteSize: bytes.byteLength,
      originalName: file.name.slice(0, 200) || 'upload',
      data: bytes,
      createdById,
    },
    select: { id: true },
  })

  return { id: stored.id, url: storedUrl(stored.id) }
}

/**
 * The bytes behind a URL, copied, if the URL is one of ours.
 *
 * The mirror of `deleteIfStored`, and it exists because of it. Duplicating a
 * project could copy the image *rows* alone in one line and would look right in
 * every test — both galleries render, because both point at the same file. It
 * breaks on deletion: every route that removes an image calls `deleteIfStored`
 * by hand, so deleting either project takes the pictures out of the other one,
 * months later, with nothing to connect the two events. Bytes are cheap and a
 * gallery is a handful of them; a shared row is a bug with a long fuse.
 *
 * External URLs fall straight through unchanged, exactly as they do on the way
 * out — somebody else's hosting is not ours to copy or to delete.
 */
export async function copyIfStored(
  url: string,
  createdById: string | null,
): Promise<string> {
  if (!url.startsWith(STORED_PREFIX)) return url

  const id = url.slice(STORED_PREFIX.length)
  if (!id) return url

  const source = await prisma.storedFile.findUnique({
    where: { id },
    select: {
      kind: true,
      mimeType: true,
      byteSize: true,
      originalName: true,
      data: true,
    },
  })

  // A URL of ours whose file is gone. Copying nothing is right: the caller gets
  // the same dangling address the original carries, which renders the same
  // broken image rather than failing the whole duplication over it.
  if (!source) return url

  const copy = await prisma.storedFile.create({
    data: { ...source, createdById },
    select: { id: true },
  })

  return storedUrl(copy.id)
}

/**
 * Delete the file behind a URL, if the URL is one of ours. External URLs fall
 * straight through — they are somebody else's hosting and none of our
 * business. `deleteMany` so a URL whose file is already gone (or was never
 * real) is a no-op rather than an error; deleting is cleanup, and cleanup
 * that can fail the request it rides on is worse than a stray row.
 */
export async function deleteIfStored(url: string | null | undefined): Promise<void> {
  if (!url?.startsWith(STORED_PREFIX)) return

  const id = url.slice(STORED_PREFIX.length)
  if (!id) return

  await prisma.storedFile.deleteMany({ where: { id } })
}

/**
 * Whether a file is plausibly the 3D model it claims to be.
 *
 * Extension first — that is the promise the form made — then a cheap look at
 * the actual bytes, because "report.pdf renamed to part.stl" is the failure
 * an extension check alone waves through:
 *
 *   - STEP files open with an `ISO-10303-21` header;
 *   - ASCII STL opens with the word `solid`;
 *   - binary STL has an 80-byte header, a 4-byte little-endian triangle
 *     count, and then exactly 50 bytes per triangle — so the length is
 *     arithmetic, and checking it is as close to parsing as this needs to be.
 *
 * Not a parser, deliberately. A malformed-but-well-prefixed file gets caught
 * by the slicer, by a person, at no risk; the check here only has to stop the
 * obviously mislabeled.
 */
export function looksLikePrintModel(name: string, bytes: Uint8Array): boolean {
  const lower = name.toLowerCase()

  if (lower.endsWith('.step') || lower.endsWith('.stp')) {
    return ascii(bytes, 32).trimStart().startsWith('ISO-10303-21')
  }

  if (lower.endsWith('.stl')) {
    if (ascii(bytes, 6).trimStart().toLowerCase().startsWith('solid')) return true

    if (bytes.byteLength < 84) return false
    const triangles = new DataView(
      bytes.buffer,
      bytes.byteOffset + 80,
      4,
    ).getUint32(0, true)
    return bytes.byteLength === 84 + triangles * 50
  }

  return false
}

/**
 * Whether bytes open like one of the image formats browsers actually render.
 * Magic numbers only — same philosophy as the print check: stop the renamed
 * PDF, let a merely broken image be a broken image.
 */
export function looksLikeImage(bytes: Uint8Array): boolean {
  const startsWith = (...magic: number[]) =>
    magic.every((byte, index) => bytes[index] === byte)

  return (
    startsWith(0x89, 0x50, 0x4e, 0x47) || // PNG
    startsWith(0xff, 0xd8, 0xff) || // JPEG
    startsWith(0x47, 0x49, 0x46, 0x38) || // GIF8
    // RIFF….WEBP
    (startsWith(0x52, 0x49, 0x46, 0x46) &&
      ascii(bytes.slice(8, 12), 4) === 'WEBP')
  )
}

const ascii = (bytes: Uint8Array, length: number) =>
  new TextDecoder('ascii').decode(bytes.slice(0, length))
