import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { storedUrl } from '../../files/files.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'
import { MAX_HERO_SLIDES } from './heroSlides.js'

/**
 * The front page's slideshow.
 *
 * `hero_slides` is a global table and this suite writes it, which puts it in the same company as
 * `lab.test.ts` borrowing the one lab row: a fixture here is a real photograph on the club's real
 * landing page for the length of a test. Three things keep that safe:
 *
 * - Every linked fixture's URL starts with `LINK`, every uploaded one is a `stored_files` row
 *   whose `original_name` starts with the same prefix, and cleanup deletes exactly those.
 * - The rows are cleared in `beforeEach` as well as `afterAll`, so a run that dies half way
 *   leaves nothing the next run doesn't sweep up.
 * - The reorder case rewrites `sort_order` on every row there is, the club's own included, so the
 *   order is read before each test and put back in `afterEach`.
 *
 * Nothing counts absolutely. The cap case fills the room that's actually left rather than
 * assuming eight are free.
 */

const PREFIX = 'test-hero-'
/** Fixture links, and the "is this ours" test the cleanup runs on. */
const LINK = `https://${PREFIX}photos.invalid/`
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Paid through, because every route here ends in `requireCurrentDues`. */
const PAID_THROUGH = new Date(2099, 11, 31)
/** The gate in front of that one. A fixture missing it is refused for the wrong
    reason, and the refusal reads exactly like a missing payment. */
const SURVEYED = new Date('2035-09-01T00:00:00')

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [{ key: { startsWith: 'officer:' } }, { key: { startsWith: 'hero:' } }],
    },
  })

/**
 * The suite's own rows and nothing else.
 *
 * Uploaded fixtures are found by `original_name` rather than through the officer who uploaded
 * them: `stored_files.created_by_id` is `SetNull`, so a run that died after creating the file and
 * before deleting the user leaves bytes with no owner, and an owner-based sweep would never find
 * them again.
 */
const clearRows = async () => {
  const files = await prisma.storedFile.findMany({
    where: { originalName: { startsWith: PREFIX } },
    select: { id: true },
  })

  await prisma.heroSlide.deleteMany({
    where: {
      OR: [
        { url: { startsWith: LINK } },
        { url: { in: files.map((file) => storedUrl(file.id)) } },
      ],
    },
  })
  await prisma.storedFile.deleteMany({
    where: { originalName: { startsWith: PREFIX } },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

let officerCookie = ''
let memberCookie = ''

/** The order the slideshow was in before this suite touched it. */
let order: { id: string; sortOrder: number }[] = []

beforeEach(async () => {
  // `requireCurrentDues` reads UCF's calendar. Stubbed to fail, which puts the
  // fixed fallback dates in play — the fixtures are paid through 2099, so what
  // the term turns out to be cannot decide any of these cases.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
  )
  clearCalendarCache()

  await clearWindows()
  await clearRows()

  order = await prisma.heroSlide.findMany({ select: { id: true, sortOrder: true } })

  const [officer, member] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Hero Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Hero Member',
        email: email('member'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
  ])

  officerCookie = `${env.SESSION_COOKIE_NAME}=${(await createSession(officer.id)).token}`
  memberCookie = `${env.SESSION_COOKIE_NAME}=${(await createSession(member.id)).token}`
})

afterEach(async () => {
  vi.unstubAllGlobals()

  // Whatever the reorder case did to the club's own rows, undone. Only rows that
  // still exist: this suite's are gone by now, and a photograph an officer
  // removed mid-run is not this suite's to put back.
  for (const slide of order) {
    await prisma.heroSlide.updateMany({
      where: { id: slide.id },
      data: { sortOrder: slide.sortOrder },
    })
  }
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

// ----------------------------------------------------------------- the wire

type WireSlide = {
  id: string
  url: string
  caption: string | null
  focalX: number
  focalY: number
  zoom: number
}

const send = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      cookie,
      origin: env.SITE_URL,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** The public read — no cookie, because that is the point of it. */
const list = async (): Promise<WireSlide[]> => {
  const response = await app.request('/api/hero-slides')

  expect(response.status).toBe(200)

  return (await response.json()) as WireSlide[]
}

const addLink = (name: string, body: Record<string, unknown> = {}) =>
  send('POST', '/api/officer/hero-slides', officerCookie, {
    url: `${LINK}${name}.jpg`,
    ...body,
  })

/** Adds one and hands back the row, for the cases that are about what follows. */
const added = async (name: string, body?: Record<string, unknown>) => {
  const response = await addLink(name, body)

  expect(response.status).toBe(201)

  return (await response.json()) as WireSlide
}

/** The smallest thing that passes the PNG sniff. */
const pngBytes = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

// `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: the default type parameter
// is `ArrayBufferLike`, which admits `SharedArrayBuffer`, and `File` will not
// take one of those.
function upload(
  name = `${PREFIX}photo.png`,
  bytes: Uint8Array<ArrayBuffer> = pngBytes(),
  fields: Record<string, string> = {},
) {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type: 'image/png' }))
  for (const [field, value] of Object.entries(fields)) {
    form.append(field, value)
  }

  return app.request('/api/officer/hero-slides/upload', {
    method: 'POST',
    body: form,
    headers: { cookie: officerCookie },
  })
}

/** Where this suite's rows sit in the public answer, in order. */
const positionsOf = (slides: WireSlide[], ids: string[]) =>
  slides
    .map((slide) => slide.id)
    .filter((id) => ids.includes(id))

describe('the front page slideshow', () => {
  it('is public to read and refuses everyone but an officer to write', async () => {
    const slide = await added('one')

    // No cookie at all: the landing page is read by strangers.
    expect((await list()).some((row) => row.id === slide.id)).toBe(true)

    const asMember = await send('POST', '/api/officer/hero-slides', memberCookie, {
      url: `${LINK}sneaky.jpg`,
    })
    expect(asMember.status).toBe(403)

    const asStranger = await send('POST', '/api/officer/hero-slides', '', {
      url: `${LINK}stranger.jpg`,
    })
    expect(asStranger.status).toBe(401)

    // And the same for the two that name a row, which is the pair a check on
    // the list route alone would miss.
    expect((await send('PATCH', `/api/officer/hero-slides/${slide.id}`, memberCookie, { caption: 'mine now' })).status).toBe(403)
    expect((await send('DELETE', `/api/officer/hero-slides/${slide.id}`, memberCookie)).status).toBe(403)
  })

  it('appends new photos and answers in the order the officers set', async () => {
    const first = await added('first')
    const second = await added('second')
    const third = await added('third')

    const mine = [first.id, second.id, third.id]
    expect(positionsOf(await list(), mine)).toEqual(mine)

    // The whole list, this suite's three reversed and everything else left where
    // it was — the route takes every id, so the club's own rows travel with it.
    const everything = (await list()).map((slide) => slide.id)
    const reversed = everything.map((id) =>
      mine.includes(id) ? mine[mine.length - 1 - mine.indexOf(id)] : id,
    )

    const response = await send(
      'PATCH',
      '/api/officer/hero-slides/order',
      officerCookie,
      { ids: reversed },
    )
    expect(response.status).toBe(200)

    expect(positionsOf(await list(), mine)).toEqual([third.id, second.id, first.id])
  })

  /**
   * The lost-update guard. Two officers with the page open would otherwise let
   * the one who pressed last silently drop the other's photograph.
   */
  it('refuses an order that is not the whole list', async () => {
    const first = await added('first')
    await added('second')

    const response = await send(
      'PATCH',
      '/api/officer/hero-slides/order',
      officerCookie,
      { ids: [first.id] },
    )

    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toContain(
      'changed while you were editing',
    )
  })

  it('takes a caption and framing, and keeps each one when the other is written', async () => {
    const slide = await added('framed', { focalX: 20, zoom: 2 })

    // Sent with the picture, because the desk opens the framing tool the moment
    // one lands and an officer may drag it into place before anything else.
    expect(slide.focalX).toBe(20)
    expect(slide.zoom).toBe(2)
    expect(slide.focalY).toBe(50)

    const captioned = await send(
      'PATCH',
      `/api/officer/hero-slides/${slide.id}`,
      officerCookie,
      { caption: '  Rover on the field  ' },
    )
    expect(captioned.status).toBe(200)

    // The framing survived a write that did not mention it, which is the whole
    // reason none of those fields carry a `.default()`.
    const after = (await captioned.json()) as WireSlide
    expect(after.caption).toBe('Rover on the field')
    expect(after.focalX).toBe(20)
    expect(after.zoom).toBe(2)

    const reframed = await send(
      'PATCH',
      `/api/officer/hero-slides/${slide.id}`,
      officerCookie,
      { focalY: 15 },
    )
    expect(((await reframed.json()) as WireSlide).caption).toBe('Rover on the field')

    // And clearing is a different request from not mentioning it.
    const cleared = await send(
      'PATCH',
      `/api/officer/hero-slides/${slide.id}`,
      officerCookie,
      { caption: null },
    )
    expect(((await cleared.json()) as WireSlide).caption).toBeNull()
  })

  it('stores an uploaded photo and destroys the bytes when it is removed', async () => {
    const response = await upload(`${PREFIX}photo.png`, pngBytes(), {
      focalY: '80',
      caption: 'Build night',
    })
    expect(response.status).toBe(201)

    const slide = (await response.json()) as WireSlide
    expect(slide.url.startsWith('/api/files/')).toBe(true)
    expect(slide.caption).toBe('Build night')
    // Framing off a multipart body, where every field arrives as a string.
    expect(slide.focalY).toBe(80)

    const fileId = slide.url.slice('/api/files/'.length)
    expect(await prisma.storedFile.count({ where: { id: fileId } })).toBe(1)

    expect(
      (await send('DELETE', `/api/officer/hero-slides/${slide.id}`, officerCookie))
        .status,
    ).toBe(200)

    expect(await prisma.storedFile.count({ where: { id: fileId } })).toBe(0)
    expect((await list()).some((row) => row.id === slide.id)).toBe(false)
  })

  /** Somebody else's hosting is not ours to delete, and never was. */
  it('leaves a linked photo alone at the other end', async () => {
    const slide = await added('linked')
    const before = await prisma.storedFile.count()

    expect(
      (await send('DELETE', `/api/officer/hero-slides/${slide.id}`, officerCookie))
        .status,
    ).toBe(200)

    expect(await prisma.storedFile.count()).toBe(before)
  })

  it('refuses a file that is not an image, whatever it is called', async () => {
    const response = await upload(
      `${PREFIX}model.png`,
      new Uint8Array([0x73, 0x6f, 0x6c, 0x69, 0x64, 0x20, 0x70, 0x61, 0x72, 0x74]),
    )

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toContain(
      'not an image',
    )
  })

  /**
   * The cap counts every row there is, so this fills whatever room is actually
   * left rather than assuming the club has no photographs up. With the hero
   * already full it adds none and the refusal below is the first request.
   */
  it('refuses one past the cap and says the number', async () => {
    const room = MAX_HERO_SLIDES - (await prisma.heroSlide.count())

    for (let index = 0; index < room; index += 1) {
      expect((await addLink(`fill-${index}`)).status).toBe(201)
    }

    const response = await addLink('one-too-many')

    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toContain(
      String(MAX_HERO_SLIDES),
    )
  })

  /** `order` is a uuid-shaped hole for the wildcard route to fall into. */
  it('answers a reorder with the reorder route, not the caption one', async () => {
    const slide = await added('routing')

    const response = await send(
      'PATCH',
      '/api/officer/hero-slides/order',
      officerCookie,
      { ids: (await list()).map((row) => row.id) },
    )

    expect(response.status).toBe(200)
    expect(
      ((await response.json()) as WireSlide[]).some((row) => row.id === slide.id),
    ).toBe(true)
  })
})
