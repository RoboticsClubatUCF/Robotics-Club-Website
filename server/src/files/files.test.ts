import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app.js'
import { prisma } from '../core/db.js'
import { env } from '../core/env.js'
import {
  looksLikeDocument,
  looksLikeImage,
  looksLikePrintModel,
  storedUrl,
} from './files.js'
import {
  FileKind,
  ProjectMemberRank,
  Season,
  UserRole,
} from '../generated/prisma/enums.js'
import { createSession } from '../auth/session.js'

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
let leadId: string
let projectId: string

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const lead = await prisma.user.create({
    data: {
      fullName: 'Files Lead',
      email: `${PREFIX}lead@ucf.edu`,
      role: UserRole.MEMBER,
      // Pinned to 2035, per `testing.md`: every fixture that has to get through a gate needs both
      // dates now. These suites used to pass without a dues date because the summer and a term's
      // opening weeks let everybody in — exactly the accident that rule was written to stop.
      duesPaidThrough: new Date('2035-12-31T00:00:00'),
      surveyCompletedAt: new Date('2035-09-01T00:00:00'),
    },
  })

  const project = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'Files Rover',
      // Every project needs a term now. A year nothing real uses, so a
      // fixture can never collide with the club's own rows.
      termYear: 2035,
      termSeason: Season.FALL,
      members: {
        create: { userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      },
    },
  })
  projectId = project.id
  leadId = lead.id

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
   * The one this suite exists for. `ProjectImage`'s cascade takes the rows when a project goes;
   * nothing in Postgres knows the `url` column is a reference, so without the hand-written sweep in
   * the delete route these files would sit in `stored_files` for ever with no way to find them.
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
 * The cache boundary that used to leak. `publicApi`'s cache middleware runs for anything
 * registered after it, and it once wrapped the whole API — `/api/auth/me` went out
 * `public, s-maxage=300`, which is one CDN away from serving somebody their predecessor's session.
 * Registration order in `app.ts` is the fix, and this is the tripwire on it.
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
    const stats = await app.request('/api/stats')
    expect(stats.status).toBe(200)
    expect(stats.headers.get('Cache-Control')).toContain('s-maxage')
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

  it('knows a PDF from a text file wearing its extension', () => {
    expect(looksLikeDocument('a.pdf', encode('%PDF-1.7'))).toBe(true)
    expect(looksLikeDocument('a.pdf', encode('Dear committee,'))).toBe(false)
    // Right bytes, wrong extension — the form's promise comes first, as it
    // does for models.
    expect(looksLikeDocument('a.txt', encode('%PDF-1.7'))).toBe(false)
  })

  it('refuses a zip that is not a Word document', () => {
    const zip = (firstEntry: string) => {
      const bytes = new Uint8Array(30 + firstEntry.length)
      bytes.set([0x50, 0x4b, 0x03, 0x04], 0)
      new DataView(bytes.buffer).setUint16(26, firstEntry.length, true)
      bytes.set(encode(firstEntry), 30)
      return bytes
    }

    expect(looksLikeDocument('a.docx', zip('[Content_Types].xml'))).toBe(true)
    // Every zip in the world would pass on the `PK` header alone, which is why
    // the first entry's name is checked as well.
    expect(looksLikeDocument('a.docx', zip('holiday.jpg'))).toBe(false)
    expect(looksLikeDocument('a.docx', encode('PK'))).toBe(false)
  })
})

/**
 * Documents are the one kind this route serves **inline**, which is what makes
 * the headers on them a security question rather than a preference: an
 * `<iframe>` renders a PDF on this origin, the origin the session cookie lives
 * on, and PDF viewers run script. These are the tripwires on that.
 */
describe('serving documents', () => {
  const encode = (text: string) => new TextEncoder().encode(text)

  /** A stored document, with whatever `mimeType` the test wants to claim. */
  async function store(originalName: string, mimeType = 'application/pdf') {
    return prisma.storedFile.create({
      data: {
        kind: FileKind.DOCUMENT,
        mimeType,
        byteSize: 8,
        originalName,
        data: encode('%PDF-1.7'),
        createdById: leadId,
      },
    })
  }

  it('serves a PDF inline, sandboxed, to anybody', async () => {
    const stored = await store('design-review.pdf')

    // No cookie: the documentation page is as public as the project page.
    const response = await app.request(storedUrl(stored.id))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toContain('inline')
    expect(response.headers.get('Content-Disposition')).toContain(
      'design-review.pdf',
    )
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe('sandbox')
    expect(response.headers.get('Cache-Control')).toContain('immutable')

    await prisma.storedFile.delete({ where: { id: stored.id } })
  })

  it('makes a DOCX a download, since no browser renders one', async () => {
    const stored = await store('handover.docx', 'application/octet-stream')

    const response = await app.request(storedUrl(stored.id))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(response.headers.get('Content-Disposition')).toContain('attachment')

    await prisma.storedFile.delete({ where: { id: stored.id } })
  })

  it('ignores a lying mimeType and never serves HTML', async () => {
    // The column is whatever the uploading browser claimed. Echoed back on an
    // inline response it would be a stored XSS on the API's own origin.
    const stored = await store('trap.pdf', 'text/html')

    const response = await app.request(storedUrl(stored.id))

    expect(response.headers.get('Content-Type')).toBe('application/pdf')

    await prisma.storedFile.delete({ where: { id: stored.id } })
  })

  it('will not let a filename smuggle a second header parameter', async () => {
    const stored = await store('a";attachment;name="b.pdf')

    const response = await app.request(storedUrl(stored.id))

    expect(response.headers.get('Content-Disposition')).toBe(
      'inline; filename="a;attachment;name=b.pdf"',
    )

    await prisma.storedFile.delete({ where: { id: stored.id } })
  })

  /**
   * `<a download>` is ignored on a cross-origin link, and the site and the API
   * are always different origins — so the only thing that can turn a viewable
   * PDF into a saved one is this header, asked for in the query string.
   */
  it('saves rather than shows a PDF when asked to', async () => {
    const stored = await store('design-review.pdf')

    const response = await app.request(`${storedUrl(stored.id)}?download=1`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
    expect(response.headers.get('Content-Disposition')).toContain(
      'design-review.pdf',
    )
    // Still a PDF, still hardened: the flag changes where it goes, not what it
    // is or what it may do on the way.
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Security-Policy')).toBe('sandbox')

    await prisma.storedFile.delete({ where: { id: stored.id } })
  })

  it('ignores anything but an exact download=1', async () => {
    const stored = await store('design-review.pdf')

    for (const query of ['?download=0', '?download=yes', '?download']) {
      const response = await app.request(`${storedUrl(stored.id)}${query}`)
      expect(response.headers.get('Content-Disposition')).toContain('inline')
    }

    await prisma.storedFile.delete({ where: { id: stored.id } })
  })

})
