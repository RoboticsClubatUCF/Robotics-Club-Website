import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'
import { FRONT_PAGE_ROW, MAX_PARTNERS } from './frontPage.js'

/**
 * The landing page's words.
 *
 * Every table this writes is global, which puts it in the same company as `heroSlides.test.ts`
 * borrowing the slideshow: a fixture here is a real question on the club's real front page for the
 * length of a test. Four things keep that safe:
 *
 * - Every fixture question, program name and program link carries `PREFIX`, and cleanup deletes
 *   exactly those.
 * - The rows are cleared in `beforeEach` as well as `afterAll`, so a run that dies half way leaves
 *   nothing the next run doesn't sweep up.
 * - The reorder cases rewrite `sort_order` on every row there is, the club's own included, so both
 *   orders are read before each test and put back in `afterEach`.
 * - `front_page` is one row keyed `current` and can't be namespaced at all, so it's borrowed the
 *   way `sponsorship_sheet` is: read before each test, put back after, and deleted if there was
 *   none — a state a freshly migrated database is genuinely in.
 *
 * Nothing counts absolutely. The cap case fills the room that's actually left rather than assuming
 * six slots are free.
 */

const PREFIX = 'test-front-'
/** Fixture links, and half of the "is this ours" test the cleanup runs on. */
const LINK = `https://${PREFIX}programs.invalid/`
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Paid through, because every route here ends in `requireCurrentDues`. */
const PAID_THROUGH = new Date(2099, 11, 31)
/** The gate in front of that one. A fixture missing it is refused for the wrong
    reason, and the refusal reads exactly like a missing payment. */
const SURVEYED = new Date('2035-09-01T00:00:00')

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'officer:' } },
        { key: { startsWith: 'front-page:' } },
      ],
    },
  })

const clearRows = async () => {
  await prisma.faq.deleteMany({ where: { question: { startsWith: PREFIX } } })
  await prisma.partnerProgram.deleteMany({
    where: { name: { startsWith: PREFIX } },
  })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

let officerCookie = ''
let memberCookie = ''

/** The order both lists were in before this suite touched them. */
let faqOrder: { id: string; sortOrder: number }[] = []
let partnerOrder: { id: string; sortOrder: number }[] = []
/** The club's own copy, or null when nobody has written any. */
let borrowedCopy: Awaited<ReturnType<typeof prisma.frontPage.findUnique>> = null

const post = (path: string, body: unknown, cookie = officerCookie) =>
  app.request(`/api/officer/front-page${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: env.allowedOrigins[0] ?? 'http://localhost:5173',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  })

const write = (
  method: 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  cookie = officerCookie,
) =>
  app.request(`/api/officer/front-page${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: env.allowedOrigins[0] ?? 'http://localhost:5173',
      Cookie: cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** The landing page as the public route answers it, which is what both the
    page and the desk read. */
type WirePage = {
  headline: string
  headlineAccent: string
  lede: string
  partnersIntro: string
  faqs: WireFaq[]
  partners: WirePartner[]
}

type WireFaq = { id: string; question: string; answer: string; steps: string[] }

type WirePartner = {
  id: string
  name: string
  blurb: string
  href: string
  imageUrl: string | null
}

const page = async () =>
  (await (await app.request('/api/front-page')).json()) as WirePage

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: string }).error

const addFaq = async (question: string, extra: object = {}) => {
  const response = await post('/faqs', {
    question: `${PREFIX}${question}`,
    answer: 'Because it does.',
    ...extra,
  })
  expect(response.status).toBe(201)
  return (await response.json()) as WireFaq
}

const addPartner = async (name: string) => {
  const response = await post('/partners', {
    name: `${PREFIX}${name}`,
    audience: 'ANYBODY',
    blurb: 'A program.',
    href: `${LINK}${name}`,
    linkLabel: `Visit ${name}`,
  })
  expect(response.status).toBe(201)
  return (await response.json()) as WirePartner
}

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

  faqOrder = await prisma.faq.findMany({ select: { id: true, sortOrder: true } })
  partnerOrder = await prisma.partnerProgram.findMany({
    select: { id: true, sortOrder: true },
  })
  borrowedCopy = await prisma.frontPage.findUnique({
    where: { id: FRONT_PAGE_ROW },
  })

  const [officer, member] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Front Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Front Member',
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

  // Whatever the reorder cases did to the club's own rows, undone. Only rows
  // that still exist: this suite's are gone by now, and a question an officer
  // removed mid-run is not this suite's to put back.
  for (const row of faqOrder) {
    await prisma.faq.updateMany({
      where: { id: row.id },
      data: { sortOrder: row.sortOrder },
    })
  }
  for (const row of partnerOrder) {
    await prisma.partnerProgram.updateMany({
      where: { id: row.id },
      data: { sortOrder: row.sortOrder },
    })
  }

  // The singleton, back as it was — including back to *absent*, which is the
  // state a freshly migrated database is in and one a restore that only knew
  // how to write would quietly end.
  if (borrowedCopy) {
    const { id, updatedAt, ...copy } = borrowedCopy
    void updatedAt
    await prisma.frontPage.upsert({
      where: { id },
      create: borrowedCopy,
      update: copy,
    })
  } else {
    await prisma.frontPage.deleteMany({ where: { id: FRONT_PAGE_ROW } })
  }
})

afterAll(async () => {
  await clearRows()
  await clearWindows()
})

describe('the copy', () => {
  it('writes the headline and reads it back on the public route', async () => {
    const response = await write('PUT', '/copy', {
      headline: 'Building Something,',
      headlineAccent: 'One Weld at a Time.',
      lede: 'A paragraph under the headline.',
      partnersIntro: 'For everybody who is not at UCF.',
    })

    expect(response.status).toBe(200)

    const saved = await page()

    expect(saved.headline).toBe('Building Something,')
    expect(saved.headlineAccent).toBe('One Weld at a Time.')
    expect(saved.lede).toBe('A paragraph under the headline.')
  })

  it('upserts, so a second save is an edit rather than a conflict', async () => {
    const body = {
      headline: 'First,',
      headlineAccent: 'Second.',
      lede: 'A lede.',
      partnersIntro: 'An intro.',
    }

    expect((await write('PUT', '/copy', body)).status).toBe(200)
    const second = await write('PUT', '/copy', { ...body, headline: 'Third,' })

    expect(second.status).toBe(200)
    expect(((await second.json()) as WirePage).headline).toBe('Third,')
  })

  it('refuses an empty headline rather than publishing a blank hero', async () => {
    const response = await write('PUT', '/copy', {
      headline: '   ',
      headlineAccent: 'Second.',
      lede: 'A lede.',
      partnersIntro: 'An intro.',
    })

    expect(response.status).toBe(400)
  })

  it('answers the shipped wording when nobody has written any', async () => {
    await prisma.frontPage.deleteMany({ where: { id: FRONT_PAGE_ROW } })

    const shipped = await page()

    // Not the exact sentence — that would be this test asserting the club's
    // marketing copy. What matters is that a database with no row still serves
    // a headline rather than an empty one.
    expect(shipped.headline.length).toBeGreaterThan(0)
    expect(shipped.headlineAccent.length).toBeGreaterThan(0)
    expect(shipped.lede.length).toBeGreaterThan(0)
  })

  it('refuses a member, and a caller with no session at all', async () => {
    const body = {
      headline: 'Nope,',
      headlineAccent: 'Nope.',
      lede: 'A lede.',
      partnersIntro: 'An intro.',
    }

    expect((await write('PUT', '/copy', body, memberCookie)).status).toBe(403)
    expect((await write('PUT', '/copy', body, '')).status).toBe(401)
  })
})

describe('the FAQ', () => {
  it('adds a question, and it comes back on the public route', async () => {
    const added = await addFaq('why?')

    const mine = (await page()).faqs.find((faq) => faq.id === added.id)

    expect(mine?.question).toBe(`${PREFIX}why?`)
    expect(mine?.steps).toEqual([])
  })

  it('keeps the numbered steps, blank lines dropped by the schema', async () => {
    const added = await addFaq('how?', {
      steps: ['Sign up', 'Fill in the survey', 'Pay'],
    })

    expect(added.steps).toEqual(['Sign up', 'Fill in the survey', 'Pay'])
  })

  it('edits the question without flattening the steps', async () => {
    const added = await addFaq('how?', { steps: ['Sign up', 'Pay'] })

    const response = await write('PATCH', `/faqs/${added.id}`, {
      question: `${PREFIX}how, really?`,
    })

    expect(response.status).toBe(200)

    const body = (await response.json()) as WireFaq
    expect(body.question).toBe(`${PREFIX}how, really?`)
    // The trap this route is written around: a `.partial()` off the create
    // schema would have carried the `[]` default in under the optional key and
    // deleted the procedure on the way past.
    expect(body.steps).toEqual(['Sign up', 'Pay'])
  })

  it('appends, so a new question lands under the last one', async () => {
    const first = await addFaq('first?')
    const second = await addFaq('second?')

    const ids = (await page()).faqs.map((faq) => faq.id)

    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id))
  })

  it('reorders the whole list at once', async () => {
    const first = await addFaq('first?')
    const second = await addFaq('second?')

    const held = await prisma.faq.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })

    // The club's own questions travel with them: the route takes the whole
    // order, which is why this suite hands the old one back afterwards.
    const ids = held.map((row) => row.id)
    const moved = [second.id, ...ids.filter((id) => id !== second.id)]

    const response = await write('PATCH', '/faqs/order', { ids: moved })
    expect(response.status).toBe(200)

    const after = ((await response.json()) as WireFaq[]).map((faq) => faq.id)
    expect(after.indexOf(second.id)).toBeLessThan(after.indexOf(first.id))
  })

  it('refuses an order that does not name every question', async () => {
    const added = await addFaq('lonely?')

    const response = await write('PATCH', '/faqs/order', { ids: [added.id] })

    expect(response.status).toBe(409)
  })

  it('removes one', async () => {
    const added = await addFaq('temporary?')

    expect((await write('DELETE', `/faqs/${added.id}`)).status).toBe(200)
    expect(await prisma.faq.findUnique({ where: { id: added.id } })).toBeNull()
  })

  it('refuses a member', async () => {
    const response = await post(
      '/faqs',
      { question: `${PREFIX}no`, answer: 'no' },
      memberCookie,
    )

    expect(response.status).toBe(403)
  })
})

describe('the partner programs', () => {
  it('adds one, and the link keeps the scheme it was given', async () => {
    const added = await addPartner('vex')

    const mine = (await page()).partners.find(
      (program) => program.id === added.id,
    )

    expect(mine?.name).toBe(`${PREFIX}vex`)
    expect(mine?.href).toBe(`${LINK}vex`)
    expect(mine?.imageUrl).toBeNull()
  })

  it('adds the scheme to a link somebody typed without one', async () => {
    const response = await post('/partners', {
      name: `${PREFIX}bare`,
      audience: 'ANYBODY',
      blurb: 'A program.',
      href: `${PREFIX}bare.invalid/programs`,
      linkLabel: 'Visit it',
    })

    expect(response.status).toBe(201)
    expect(((await response.json()) as WirePartner).href).toBe(
      `https://${PREFIX}bare.invalid/programs`,
    )
  })

  it('refuses a javascript: link', async () => {
    const response = await post('/partners', {
      name: `${PREFIX}nasty`,
      audience: 'ANYBODY',
      blurb: 'A program.',
      // Printed straight into an `href` on the landing page, so the scheme
      // check in `webUrl` is the whole of what stops this.
      href: 'javascript:alert(1)',
      linkLabel: 'Visit it',
    })

    expect(response.status).toBe(400)
  })

  it('clears the artwork without touching the blurb', async () => {
    const added = await addPartner('artful')

    await write('PATCH', `/partners/${added.id}`, {
      imageUrl: `${LINK}logo.png`,
    })
    const cleared = await write('DELETE', `/partners/${added.id}/image`)

    expect(cleared.status).toBe(200)

    const body = (await cleared.json()) as WirePartner
    expect(body.imageUrl).toBeNull()
    expect(body.blurb).toBe('A program.')
  })

  it('refuses once the section is full', async () => {
    // The room that is actually left, not six: the club's own programs are in
    // this table and `assertRoom` counts them.
    const held = await prisma.partnerProgram.count()
    const room = MAX_PARTNERS - held

    for (let index = 0; index < room; index += 1) {
      await addPartner(`filler${index}`)
    }

    const response = await post('/partners', {
      name: `${PREFIX}one-too-many`,
      audience: 'ANYBODY',
      blurb: 'A program.',
      href: `${LINK}too-many`,
      linkLabel: 'Visit it',
    })

    expect(response.status).toBe(409)
    expect(await errorOf(response)).toContain(String(MAX_PARTNERS))
  })

  it('removes one', async () => {
    const added = await addPartner('temporary')

    expect((await write('DELETE', `/partners/${added.id}`)).status).toBe(200)
    expect(
      await prisma.partnerProgram.findUnique({ where: { id: added.id } }),
    ).toBeNull()
  })

  it('404s on a program that is not there', async () => {
    const response = await write(
      'PATCH',
      '/partners/00000000-0000-7000-8000-000000000000',
      { blurb: 'Nothing to edit.' },
    )

    expect(response.status).toBe(404)
  })
})
