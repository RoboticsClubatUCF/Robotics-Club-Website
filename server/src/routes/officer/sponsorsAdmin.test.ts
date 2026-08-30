import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { SponsorTier, UserRole } from '../../generated/prisma/enums.js'
import { clearCalendarCache } from '../../membership/semester.js'
import { createSession } from '../../auth/session.js'
import { MAX_IN_KIND } from './sponsorsAdmin.js'

/**
 * The sponsor desk, and the two public reads it feeds.
 *
 * **Three global tables, isolated three different ways**, and none of them is
 * optional — a fixture here is a real company on the club's real front page, or
 * a real price on the sheet a real business is reading, for the length of a test.
 *
 * - `sponsors` is namespaced. Every fixture's name starts with the prefix and
 *   cleanup deletes exactly those. Nothing selects "all sponsors".
 * - `sponsor_tier_offers` **cannot be namespaced** — it is four rows keyed by
 *   the enum, and they are the club's. So this suite borrows exactly one of
 *   them, `ALUMINUM_ALLY`, reads it before each test and puts it back (or
 *   deletes it, if there was none) after. Same shape as `lab.test.ts` borrowing
 *   the one lab row, and the reason it is one tier rather than four: clearing
 *   the table would be cheaper to write and would leave the club with no price
 *   list at all if a run died in the middle.
 * - `in_kind_offers` is namespaced by title **and** its order is borrowed, for
 *   the reason `heroSlides.test.ts` borrows the slideshow's: the reorder route
 *   rewrites `sort_order` on every row there is, the club's included.
 * - `sponsorship_sheet` is the club's fine print in a single row keyed
 *   `current`, so it is borrowed outright — the same as the tier, and the same
 *   as `lab.test.ts` with the lab row. "Absent" is one of the states it is
 *   restored to, because a club that has written no footnotes has no row.
 *
 * **Nothing counts absolutely.** The club may have sponsors listed and ways to
 * help written; the cap case fills the room that is actually left rather than
 * assuming six slots are free, and the listing cases assert on this suite's own
 * rows.
 *
 * Nothing here reaches Discord — no route on this desk messages anybody or
 * writes a role — but `fetch` is stubbed to fail all the same, because
 * `requireCurrentDues` reads UCF's calendar and session resolution can ask
 * Discord about an officer's standing.
 */

const PREFIX = 'test-sponsor-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Paid through, because every route here ends in `requireCurrentDues`. */
const PAID_THROUGH = new Date(2099, 11, 31)
/** The gate in front of that one. A fixture missing it is refused for the wrong
    reason, and the refusal reads exactly like a missing payment. */
const SURVEYED = new Date('2035-09-01T00:00:00')

/**
 * The one tier this suite is allowed to write, and the bottom of the ladder on
 * purpose: it is the level the club is least likely to have priced, and the one
 * a half-finished restore would do least damage to.
 */
const BORROWED = SponsorTier.ALUMINUM_ALLY

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'officer:' } },
        { key: { startsWith: 'sponsor-logo:' } },
      ],
    },
  })

const clearRows = async () => {
  await prisma.sponsor.deleteMany({ where: { name: { startsWith: PREFIX } } })
  await prisma.inKindOffer.deleteMany({ where: { title: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

let officerCookie = ''
let memberCookie = ''

/** The club's own row for the borrowed tier, if it has one. */
let borrowedOffer: {
  tier: SponsorTier
  amount: string
  blurb: string | null
  benefits: string[]
} | null = null

/** The club's own fine print, if it has written any. */
let borrowedFootnotes: string | null = null

/** The order the ways-to-help were in before this suite touched them. */
let order: { id: string; sortOrder: number }[] = []

beforeEach(async () => {
  // `requireCurrentDues` reads UCF's calendar. Stubbed to fail, which puts the
  // fixed fallback dates in play — the fixtures are paid through 2099, so what
  // the term turns out to be cannot decide any of these cases. It also catches
  // anything session resolution would otherwise send to Discord.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
  )
  clearCalendarCache()

  await clearWindows()
  await clearRows()

  borrowedOffer = await prisma.sponsorTierOffer.findUnique({
    where: { tier: BORROWED },
    select: { tier: true, amount: true, blurb: true, benefits: true },
  })
  await prisma.sponsorTierOffer.deleteMany({ where: { tier: BORROWED } })

  // The other singleton, borrowed the same way. `null` covers both "the row
  // says nothing" and "there is no row", and the restore below puts back
  // whichever it was.
  borrowedFootnotes = await prisma.sponsorshipSheet
    .findUnique({ where: { id: 'current' }, select: { footnotes: true } })
    .then((sheet) => sheet?.footnotes ?? null)
  await prisma.sponsorshipSheet.deleteMany({ where: { id: 'current' } })

  order = await prisma.inKindOffer.findMany({ select: { id: true, sortOrder: true } })

  const [officer, member] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Sponsor Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Sponsor Member',
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

  // The borrowed tier, exactly as it was — including having been absent, which
  // is a state the club is genuinely in for three of its four levels.
  if (borrowedOffer) {
    await prisma.sponsorTierOffer.upsert({
      where: { tier: BORROWED },
      create: borrowedOffer,
      update: borrowedOffer,
    })
  } else {
    await prisma.sponsorTierOffer.deleteMany({ where: { tier: BORROWED } })
  }

  if (borrowedFootnotes === null) {
    await prisma.sponsorshipSheet.deleteMany({ where: { id: 'current' } })
  } else {
    await prisma.sponsorshipSheet.upsert({
      where: { id: 'current' },
      create: { id: 'current', footnotes: borrowedFootnotes },
      update: { footnotes: borrowedFootnotes },
    })
  }

  // Whatever the reorder case did to the club's own rows, undone. Only rows that
  // still exist: this suite's are gone by now, and an entry an officer removed
  // mid-run is not this suite's to put back.
  for (const row of order) {
    await prisma.inKindOffer.updateMany({
      where: { id: row.id },
      data: { sortOrder: row.sortOrder },
    })
  }
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

// ------------------------------------------------------------------ the wire

type WireSponsor = {
  id: string
  name: string
  tier: SponsorTier
  logoUrl: string | null
  websiteUrl: string | null
  blurb: string | null
  active: boolean
}

type WireOffer = {
  tier: SponsorTier
  amount: string
  blurb: string | null
  benefits: string[]
}

type WireInKind = { id: string; title: string; blurb: string }

type WireDesk = {
  sponsors: WireSponsor[]
  tiers: { tier: SponsorTier; offer: WireOffer | null }[]
  inKind: WireInKind[]
  footnotes: string | null
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

const deskOf = async (cookie = officerCookie): Promise<WireDesk> => {
  const response = await app.request('/api/officer/sponsors', { headers: { cookie } })

  expect(response.status).toBe(200)

  return (await response.json()) as WireDesk
}

/** The public list — no cookie, because that is the point of it. */
const publicSponsors = async (): Promise<WireSponsor[]> => {
  const response = await app.request('/api/sponsors?limit=100')

  expect(response.status).toBe(200)

  return (await response.json()) as WireSponsor[]
}

type WirePitch = {
  tiers: WireOffer[]
  inKind: WireInKind[]
  footnotes: string | null
}

const publicPitch = async (): Promise<WirePitch> => {
  const response = await app.request('/api/sponsorship')

  expect(response.status).toBe(200)

  return (await response.json()) as WirePitch
}

/** Adds one and hands back the row, for the cases that are about what follows. */
const addSponsor = async (
  name: string,
  body: Record<string, unknown> = {},
): Promise<WireSponsor> => {
  const response = await send('POST', '/api/officer/sponsors', officerCookie, {
    name: `${PREFIX}${name}`,
    ...body,
  })

  expect(response.status).toBe(201)

  return (await response.json()) as WireSponsor
}

const addWay = async (name: string): Promise<WireInKind> => {
  const response = await send(
    'POST',
    '/api/officer/sponsors/in-kind',
    officerCookie,
    { title: `${PREFIX}${name}`, blurb: 'Something useful.' },
  )

  expect(response.status).toBe(201)

  return (await response.json()) as WireInKind
}

describe('the sponsor desk', () => {
  it('refuses everyone but an officer', async () => {
    const asMember = await app.request('/api/officer/sponsors', {
      headers: { cookie: memberCookie },
    })
    expect(asMember.status).toBe(403)

    const asStranger = await app.request('/api/officer/sponsors')
    expect(asStranger.status).toBe(401)

    const written = await send('POST', '/api/officer/sponsors', memberCookie, {
      name: `${PREFIX}nope`,
    })
    expect(written.status).toBe(403)
  })

  /**
   * The property the desk's whole tier section leans on: an unwritten level is
   * the row an officer needs in order to write it, so it has to come back.
   */
  it('answers with every tier, written or not', async () => {
    const desk = await deskOf()

    expect(desk.tiers.map(({ tier }) => tier)).toEqual(Object.values(SponsorTier))
    expect(desk.tiers.find(({ tier }) => tier === BORROWED)?.offer).toBeNull()
  })

  it('lists a new sponsor on the desk and on the public page', async () => {
    const sponsor = await addSponsor('northgate', {
      tier: SponsorTier.CIRCUIT_SUPPORTER,
      blurb: 'Machining.',
    })

    expect(sponsor.tier).toBe(SponsorTier.CIRCUIT_SUPPORTER)
    expect((await deskOf()).sponsors.some((row) => row.id === sponsor.id)).toBe(true)
    expect((await publicSponsors()).some((row) => row.id === sponsor.id)).toBe(true)
  })

  /**
   * Postgres is case-sensitive about a unique text column and the club is not:
   * two rows for one company is how a sponsor ends up thanked twice on the front
   * page.
   */
  it('refuses the same company under a different capitalisation', async () => {
    await addSponsor('northgate')

    const again = await send('POST', '/api/officer/sponsors', officerCookie, {
      name: `${PREFIX}NORTHGATE`,
    })

    expect(again.status).toBe(409)
    expect(await again.text()).toContain('already on the list')
  })

  it('hides a sponsor from the site and keeps it on the desk', async () => {
    const sponsor = await addSponsor('lakeside')

    const hidden = await send(
      'PATCH',
      `/api/officer/sponsors/${sponsor.id}`,
      officerCookie,
      { active: false },
    )
    expect(hidden.status).toBe(200)

    expect((await publicSponsors()).some((row) => row.id === sponsor.id)).toBe(false)
    expect((await deskOf()).sponsors.some((row) => row.id === sponsor.id)).toBe(true)
  })

  /**
   * The `.partial()` trap the equipment desk paid for once: a schema whose
   * optional keys still carry their defaults answers a one-field patch by
   * writing every field. Hiding a top-tier sponsor must not demote them.
   */
  it('leaves the tier alone when the patch only says hide', async () => {
    const sponsor = await addSponsor('meridian', {
      tier: SponsorTier.PROCESSOR_PATRON,
    })

    const response = await send(
      'PATCH',
      `/api/officer/sponsors/${sponsor.id}`,
      officerCookie,
      { active: false },
    )

    expect(((await response.json()) as WireSponsor).tier).toBe(
      SponsorTier.PROCESSOR_PATRON,
    )
  })

  it('deletes a sponsor outright', async () => {
    const sponsor = await addSponsor('typo')

    const gone = await send(
      'DELETE',
      `/api/officer/sponsors/${sponsor.id}`,
      officerCookie,
    )
    expect(gone.status).toBe(200)

    expect((await deskOf()).sponsors.some((row) => row.id === sponsor.id)).toBe(false)
  })
})

describe('the tier sheet', () => {
  const publish = (body: Record<string, unknown>) =>
    send('PUT', `/api/officer/sponsors/tiers/${BORROWED}`, officerCookie, body)

  it('publishes a tier and puts it on the public page', async () => {
    const response = await publish({
      amount: '$500 a season',
      blurb: 'For anyone chipping in.',
      benefits: ['Named on the site', 'A sticker'],
    })

    expect(response.status).toBe(200)

    const { tiers } = await publicPitch()
    const published = tiers.find((offer) => offer.tier === BORROWED)

    expect(published?.amount).toBe('$500 a season')
    expect(published?.benefits).toEqual(['Named on the site', 'A sticker'])
  })

  /** The same route writes and rewrites — there is one row per level and the
      enum is its key, so an upsert needs no "does it exist yet" round trip. */
  it('rewrites a published tier rather than refusing it', async () => {
    await publish({ amount: 'first', blurb: 'first', benefits: ['one'] })
    const again = await publish({ amount: 'second', blurb: 'second', benefits: [] })

    expect(again.status).toBe(200)

    const { tiers } = await publicPitch()
    const published = tiers.find((offer) => offer.tier === BORROWED)

    expect(published?.amount).toBe('second')
    // An amount and a sentence is a whole offer; the list is what is optional.
    expect(published?.benefits).toEqual([])
  })

  /**
   * The point of the move off hardcoded copy: an unpriced level is absent from
   * the sheet rather than quoting a figure nobody agreed to — while still being
   * a row the desk can see, so somebody can price it.
   */
  it('leaves an unpublished tier off the public sheet and on the desk', async () => {
    await publish({ amount: '$500', blurb: 'For anyone.', benefits: [] })

    const gone = await send(
      'DELETE',
      `/api/officer/sponsors/tiers/${BORROWED}`,
      officerCookie,
    )
    expect(gone.status).toBe(200)

    const { tiers } = await publicPitch()
    expect(tiers.some((offer) => offer.tier === BORROWED)).toBe(false)

    const desk = await deskOf()
    expect(desk.tiers.find(({ tier }) => tier === BORROWED)?.offer).toBeNull()

    // And unpublishing something already unpublished is a 404, not a silent yes.
    const twice = await send(
      'DELETE',
      `/api/officer/sponsors/tiers/${BORROWED}`,
      officerCookie,
    )
    expect(twice.status).toBe(404)
  })

  /**
   * The club's own sheet is an amount and a list of what you get, with nothing
   * between them — which is why the column stopped being required. A tier
   * refused for want of a sentence is a tier somebody invents a sentence for.
   */
  it('publishes a tier with no blurb at all', async () => {
    const response = await publish({
      amount: '$5,000+',
      benefits: ['Acknowledgments in social media posts'],
    })

    expect(response.status).toBe(200)

    const { tiers } = await publicPitch()
    expect(tiers.find((offer) => offer.tier === BORROWED)?.blurb).toBeNull()
  })

  /** `PUT` is the whole of the thing, so an omitted blurb clears the one there. */
  it('clears a blurb the rewrite leaves out', async () => {
    await publish({ amount: '$500', blurb: 'For anyone.', benefits: [] })
    await publish({ amount: '$500', benefits: [] })

    const { tiers } = await publicPitch()
    expect(tiers.find((offer) => offer.tier === BORROWED)?.blurb).toBeNull()
  })

  it('refuses more benefits than a card can carry', async () => {
    const response = await publish({
      amount: '$500',
      blurb: 'For anyone.',
      benefits: Array.from({ length: 20 }, (_, index) => `benefit ${index}`),
    })

    expect(response.status).toBe(400)
  })

  it('refuses a member', async () => {
    const response = await send(
      'PUT',
      `/api/officer/sponsors/tiers/${BORROWED}`,
      memberCookie,
      { amount: '$1', blurb: 'no', benefits: [] },
    )

    expect(response.status).toBe(403)
  })
})

/**
 * The fine print under the grid — one row, keyed `current`, and **this suite
 * borrows it the way it borrows a tier**. It is the club's own footnotes, and a
 * run that left them rewritten would have a business reading a note the club did
 * not write.
 */
describe('the fine print', () => {
  it('writes the footnotes and puts them on the public page', async () => {
    const response = await send('PUT', '/api/officer/sponsors/sheet', officerCookie, {
      footnotes: '* Logo size determined by donation amount',
    })

    expect(response.status).toBe(200)
    expect((await publicPitch()).footnotes).toBe(
      '* Logo size determined by donation amount',
    )
    expect((await deskOf()).footnotes).toBe(
      '* Logo size determined by donation amount',
    )
  })

  /** Clearing is a normal thing to do: the grid printed none before this row. */
  it('treats an empty string as no fine print at all', async () => {
    await send('PUT', '/api/officer/sponsors/sheet', officerCookie, {
      footnotes: 'something',
    })

    const cleared = await send('PUT', '/api/officer/sponsors/sheet', officerCookie, {
      footnotes: '',
    })

    expect(cleared.status).toBe(200)
    expect((await publicPitch()).footnotes).toBeNull()
  })

  it('refuses a member', async () => {
    const response = await send('PUT', '/api/officer/sponsors/sheet', memberCookie, {
      footnotes: 'no',
    })

    expect(response.status).toBe(403)
  })
})

describe('the other ways to help', () => {
  it('adds one, edits it and takes it off again', async () => {
    const way = await addWay('machine-time')

    expect((await publicPitch()).inKind.some((row) => row.id === way.id)).toBe(true)

    const edited = await send(
      'PATCH',
      `/api/officer/sponsors/in-kind/${way.id}`,
      officerCookie,
      { blurb: 'An afternoon of somebody else’s shop.' },
    )
    expect(edited.status).toBe(200)
    expect(((await edited.json()) as WireInKind).blurb).toBe(
      'An afternoon of somebody else’s shop.',
    )

    const gone = await send(
      'DELETE',
      `/api/officer/sponsors/in-kind/${way.id}`,
      officerCookie,
    )
    expect(gone.status).toBe(200)
    expect((await publicPitch()).inKind.some((row) => row.id === way.id)).toBe(false)
  })

  /**
   * The route takes the whole order, so this sends every row there is — the
   * club's included, which is exactly why `afterEach` puts their `sort_order`
   * back.
   */
  it('reorders the list', async () => {
    const first = await addWay('one')
    const second = await addWay('two')

    const held = await prisma.inKindOffer.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })

    const swapped = held
      .map((row) => row.id)
      .filter((id) => id !== first.id && id !== second.id)
      .concat([second.id, first.id])

    const response = await send(
      'PATCH',
      '/api/officer/sponsors/in-kind/order',
      officerCookie,
      { ids: swapped },
    )
    expect(response.status).toBe(200)

    const { inKind } = await publicPitch()
    const positions = inKind
      .map((row) => row.id)
      .filter((id) => id === first.id || id === second.id)

    expect(positions).toEqual([second.id, first.id])
  })

  /** The lost-update guard. Two officers in two tabs, not one person in two. */
  it('refuses an order that no longer matches the list', async () => {
    const way = await addWay('stale')

    const response = await send(
      'PATCH',
      '/api/officer/sponsors/in-kind/order',
      officerCookie,
      { ids: [way.id] },
    )

    // Unless the club's list is empty and this is genuinely the only row, in
    // which case a one-id order is correct and the guard has nothing to catch.
    const held = await prisma.inKindOffer.count()
    expect(response.status).toBe(held === 1 ? 200 : 409)
  })

  /** Fills the room that is actually left — the club's own entries count too. */
  it('refuses to add past the cap', async () => {
    const held = await prisma.inKindOffer.count()
    const room = MAX_IN_KIND - held

    for (let index = 0; index < room; index += 1) {
      await addWay(`filler-${index}`)
    }

    const response = await send(
      'POST',
      '/api/officer/sponsors/in-kind',
      officerCookie,
      { title: `${PREFIX}one-too-many`, blurb: 'Nope.' },
    )

    expect(response.status).toBe(409)
    expect(await response.text()).toContain(String(MAX_IN_KIND))
  })
})
