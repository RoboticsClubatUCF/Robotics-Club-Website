import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { prisma } from './db.js'
import { env } from './env.js'
import { looksLikeImage, looksLikePrintModel, storedUrl } from './files.js'
import {
  FileKind,
  ProjectMemberRank,
  UserRole,
} from './generated/prisma/enums.js'
import { createSession } from './session.js'

/**
 * The storage rules, where they could quietly rot: an uploaded image is
 * deleted the moment a replacement lands, and an external URL is never
 * touched by any of it. Plus the two sniffers, which are pure functions and
 * tested as such.
 */

const PREFIX = 'test-files-'

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'upload:' } },
        { key: { startsWith: 'manage:' } },
        { key: { startsWith: 'gallery:' } },
      ],
    },
  })

const clearRows = async () => {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.storedFile.deleteMany({
    where: { createdById: { in: users.map((u) => u.id) } },
  })
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

let leadCookie: string
let projectId: string

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const lead = await prisma.user.create({
    data: {
      fullName: 'Files Lead',
      email: `${PREFIX}lead@ucf.edu`,
      role: UserRole.MEMBER,
    },
  })

  const project = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'Files Rover',
      members: {
        create: { userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      },
    },
  })
  projectId = project.id

  const { token } = await createSession(lead.id)
  leadCookie = `${env.SESSION_COOKIE_NAME}=${token}`
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

/** The smallest thing that passes the PNG sniff. */
const pngBytes = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

// `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: the default type
// parameter is `ArrayBufferLike`, which admits `SharedArrayBuffer`, and `File`
// will not take one of those.
function uploadCover(
  name = 'cover.png',
  bytes: Uint8Array<ArrayBuffer> = pngBytes(),
) {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type: 'image/png' }))

  return app.request(`/api/projects/${projectId}/cover`, {
    method: 'POST',
    body: form,
    headers: { cookie: leadCookie },
  })
}

/** The gallery's own upload, same shape as the cover's. */
function uploadGalleryImage(
  name = 'slide.png',
  bytes: Uint8Array<ArrayBuffer> = pngBytes(),
  framing?: Record<string, string>,
) {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type: 'image/png' }))
  for (const [field, value] of Object.entries(framing ?? {})) {
    form.append(field, value)
  }

  return app.request(`/api/projects/${projectId}/images/upload`, {
    method: 'POST',
    body: form,
    headers: { cookie: leadCookie },
  })
}

const addGalleryUrl = (url: string) =>
  app.request(`/api/projects/${projectId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: leadCookie },
    body: JSON.stringify({ url }),
  })

const patchProject = (body: unknown) =>
  app.request(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie: leadCookie },
    body: JSON.stringify(body),
  })

const storedIdOf = (url: string) => url.split('/').pop()!

describe('cover uploads', () => {
  it('stores the image and serves it publicly, immutable', async () => {
    const response = await uploadCover()
    expect(response.status).toBe(200)

    const { coverUrl } = (await response.json()) as { coverUrl: string }
    expect(coverUrl).toMatch(/^\/api\/files\//)

    const served = await app.request(coverUrl)
    expect(served.status).toBe(200)
    expect(served.headers.get('Cache-Control')).toContain('immutable')
  })

  it('refuses a file that is not actually an image', async () => {
    const response = await uploadCover('cover.png', new TextEncoder().encode('<svg>'))
    expect(response.status).toBe(400)
  })

  /** The storage rule: replacement deletes the replaced upload, immediately. */
  it('deletes the previous upload the moment a replacement lands', async () => {
    const first = (await (await uploadCover()).json()) as { coverUrl: string }
    const firstId = storedIdOf(first.coverUrl)

    const second = (await (await uploadCover()).json()) as { coverUrl: string }

    expect(second.coverUrl).not.toBe(first.coverUrl)
    expect(await prisma.storedFile.count({ where: { id: firstId } })).toBe(0)
    expect(
      await prisma.storedFile.count({
        where: { id: storedIdOf(second.coverUrl) },
      }),
    ).toBe(1)
  })

  it('deletes a stored cover when the URL is swapped for an external one', async () => {
    const uploaded = (await (await uploadCover()).json()) as { coverUrl: string }
    const storedId = storedIdOf(uploaded.coverUrl)

    const response = await patchProject({
      coverUrl: 'https://example.com/rover.jpg',
    })

    expect(response.status).toBe(200)
    expect(await prisma.storedFile.count({ where: { id: storedId } })).toBe(0)
  })

  /** The other half of the rule: external URLs are never ours to delete. */
  it('never touches anything when one external URL replaces another', async () => {
    await patchProject({ coverUrl: 'https://example.com/old.jpg' })
    const before = await prisma.storedFile.count()

    const response = await patchProject({
      coverUrl: 'https://example.com/new.jpg',
    })

    expect(response.status).toBe(200)
    expect(await prisma.storedFile.count()).toBe(before)
  })

  it('deleting the project takes its uploaded cover with it', async () => {
    const uploaded = (await (await uploadCover()).json()) as { coverUrl: string }
    const storedId = storedIdOf(uploaded.coverUrl)

    const response = await app.request(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: { cookie: leadCookie },
    })

    expect(response.status).toBe(200)
    expect(await prisma.storedFile.count({ where: { id: storedId } })).toBe(0)
  })
})

describe('gallery uploads', () => {
  it('stores the image and serves it publicly, immutable', async () => {
    const response = await uploadGalleryImage()
    expect(response.status).toBe(201)

    const { url } = (await response.json()) as { url: string }
    expect(url).toMatch(/^\/api\/files\//)

    const served = await app.request(url)
    expect(served.status).toBe(200)
    expect(served.headers.get('Cache-Control')).toContain('immutable')
  })

  it('refuses a file that is not actually an image', async () => {
    const response = await uploadGalleryImage(
      'slide.png',
      new TextEncoder().encode('<svg>'),
    )
    expect(response.status).toBe(400)
  })

  /**
   * Multipart carries no types, so the framing arrives as strings. It travels
   * with the upload because a gallery filled in on the create page is framed
   * before the project exists — see `publishDraft` on the browser side.
   */
  it('reads framing off the multipart body', async () => {
    const response = await uploadGalleryImage('framed.png', pngBytes(), {
      focalX: '20',
      focalY: '80',
      zoom: '2',
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ focalX: 20, focalY: 80, zoom: 2 })
  })

  /**
   * An untouched box arrives as `''`, and `Number('')` is 0 — which would pin
   * every upload to the top-left corner if the blank check came second.
   */
  it('centres an upload whose framing boxes came through blank', async () => {
    const response = await uploadGalleryImage('blank.png', pngBytes(), {
      focalX: '',
      focalY: '',
      zoom: 'not a number',
    })

    expect(await response.json()).toMatchObject({ focalX: 50, focalY: 50, zoom: 1 })
  })

  it('takes the bytes with the picture when one is removed', async () => {
    const image = (await (await uploadGalleryImage()).json()) as {
      id: string
      url: string
    }
    const storedId = storedIdOf(image.url)

    const response = await app.request(
      `/api/projects/${projectId}/images/${image.id}`,
      { method: 'DELETE', headers: { cookie: leadCookie } },
    )

    expect(response.status).toBe(200)
    expect(await prisma.storedFile.count({ where: { id: storedId } })).toBe(0)
  })

  /** The other half of the rule: somebody else's hosting is not ours to clean up. */
  it('touches nothing when the picture removed was an external URL', async () => {
    const image = (await (
      await addGalleryUrl('https://example.com/slide.jpg')
    ).json()) as { id: string }
    const before = await prisma.storedFile.count()

    const response = await app.request(
      `/api/projects/${projectId}/images/${image.id}`,
      { method: 'DELETE', headers: { cookie: leadCookie } },
    )

    expect(response.status).toBe(200)
    expect(await prisma.storedFile.count()).toBe(before)
  })

  /**
   * The one this suite exists for. `ProjectImage`'s cascade takes the rows when
   * a project goes; nothing in Postgres knows the `url` column is a reference,
   * so without the hand-written sweep in the delete route these files would sit
   * in `stored_files` forever with nothing pointing at them and no way to find
   * them again.
   */
  it('deleting the project takes every uploaded gallery picture with it', async () => {
    const [one, two] = await Promise.all([
      uploadGalleryImage('one.png'),
      uploadGalleryImage('two.png'),
    ])
    const ids = await Promise.all(
      [one, two].map(async (response) =>
        storedIdOf(((await response.json()) as { url: string }).url),
      ),
    )
    // An external one alongside them, to prove the sweep is discriminating
    // rather than enthusiastic.
    await addGalleryUrl('https://example.com/external.jpg')
    const cover = (await (await uploadCover()).json()) as { coverUrl: string }

    expect(await prisma.storedFile.count({ where: { id: { in: ids } } })).toBe(2)

    const response = await app.request(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: { cookie: leadCookie },
    })

    expect(response.status).toBe(200)
    expect(await prisma.storedFile.count({ where: { id: { in: ids } } })).toBe(0)
    expect(
      await prisma.storedFile.count({ where: { id: storedIdOf(cover.coverUrl) } }),
    ).toBe(0)
  })
})

describe('storedUrl round-trip', () => {
  it('serves what storeFile stored, at the address it returned', async () => {
    const stored = await prisma.storedFile.create({
      data: {
        kind: FileKind.IMAGE,
        mimeType: 'image/png',
        byteSize: pngBytes().byteLength,
        originalName: 'direct.png',
        data: pngBytes(),
      },
    })

    const response = await app.request(storedUrl(stored.id))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')

    await prisma.storedFile.delete({ where: { id: stored.id } })
  })
})

/**
 * The cache boundary that used to leak. `publicApi`'s cache middleware runs
 * for anything registered after it, and it once wrapped the whole API —
 * `/api/auth/me` went out `public, s-maxage=300`, which is one CDN away from
 * serving somebody their predecessor's session. Registration order in
 * `app.ts` is the fix, and this is the tripwire on it.
 */
describe('cache boundaries', () => {
  it('keeps per-caller answers out of shared caches', async () => {
    const me = await app.request('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.headers.get('Cache-Control') ?? '').not.toContain('public')

    const mine = await app.request('/api/me/projects', {
      headers: { cookie: leadCookie },
    })
    expect(mine.status).toBe(200)
    expect(mine.headers.get('Cache-Control') ?? '').not.toContain('public')
  })

  it('still marks genuinely public content cacheable', async () => {
    const subteams = await app.request('/api/subteams')
    expect(subteams.status).toBe(200)
    expect(subteams.headers.get('Cache-Control')).toContain('s-maxage')
  })
})

describe('the sniffers', () => {
  const encode = (text: string) => new TextEncoder().encode(text)

  it('knows the three model shapes and refuses impostors', () => {
    expect(looksLikePrintModel('a.stl', encode('solid part'))).toBe(true)
    expect(looksLikePrintModel('a.step', encode('ISO-10303-21;'))).toBe(true)
    expect(looksLikePrintModel('a.stp', encode('ISO-10303-21;'))).toBe(true)

    const binary = new Uint8Array(84 + 100)
    new DataView(binary.buffer).setUint32(80, 2, true)
    expect(looksLikePrintModel('a.stl', binary)).toBe(true)

    // Right prefix, wrong extension — the form's promise comes first.
    expect(looksLikePrintModel('a.obj', encode('solid part'))).toBe(false)
    // Right extension, wrong bytes.
    expect(looksLikePrintModel('a.stl', encode('%PDF-1.4'))).toBe(false)
    // Binary STL whose length does not match its triangle count.
    const short = new Uint8Array(84 + 49)
    new DataView(short.buffer).setUint32(80, 1, true)
    expect(looksLikePrintModel('a.stl', short)).toBe(false)
  })

  it('knows the four image magics and refuses text', () => {
    expect(looksLikeImage(pngBytes())).toBe(true)
    expect(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
    expect(looksLikeImage(encode('GIF89a'))).toBe(true)
    expect(looksLikeImage(encode('RIFF0000WEBP'))).toBe(true)
    expect(looksLikeImage(encode('<svg xmlns='))).toBe(false)
    expect(looksLikeImage(encode('solid part'))).toBe(false)
  })
})
