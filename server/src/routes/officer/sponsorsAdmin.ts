import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { deleteIfStored, looksLikeImage, storeFile } from '../../files/files.js'
import { FileKind, SponsorTier } from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import { validate, webUrl } from '../../core/validate.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * The sponsor desk: everything `/sponsors` shows, written by officers.
 *
 *   GET    /api/officer/sponsors                 -> the whole page, in one read
 *   POST   /api/officer/sponsors                 -> list a sponsor
 *   PATCH  /api/officer/sponsors/:id             -> edit one, or hide it
 *   DELETE /api/officer/sponsors/:id             -> remove one outright
 *   POST   /api/officer/sponsors/:id/logo        -> upload or replace its logo
 *   DELETE /api/officer/sponsors/:id/logo        -> take the logo off
 *   PUT    /api/officer/sponsors/tiers/:tier     -> publish what a level costs
 *   DELETE /api/officer/sponsors/tiers/:tier     -> take that level off the sheet
 *   PUT    /api/officer/sponsors/sheet           -> the fine print under the grid
 *   POST   /api/officer/sponsors/in-kind         -> add a way to help
 *   PATCH  /api/officer/sponsors/in-kind/order   -> reorder that list
 *   PATCH  /api/officer/sponsors/in-kind/:id     -> edit one
 *   DELETE /api/officer/sponsors/in-kind/:id     -> remove one
 *
 * Three tables, one desk, because they're one page. A visitor reading `/sponsors` can't
 * tell which of the three answered any part of it, and an officer writing that page is
 * thinking about what it says rather than about tables.
 *
 * The public reads aren't here. `GET /api/sponsors` and `GET /api/sponsorship` are in
 * `content.ts`, on the cached side of `app.ts`; this file exports the `select`s they
 * answer with, so the desk and the page can't describe a sponsor two different ways.
 *
 * Its own file rather than a section of `officer.ts` because it owns a path underneath
 * `/api/officer` and has to be mounted before it.
 *
 * Nothing here is a permission decision of its own: `requireOfficer` is the whole gate.
 */
export const sponsorsAdmin = new Hono<AuthEnv>()

/**
 * How many ways-to-help the page will carry.
 *
 * Six, against a section that draws three across. It's the last thing before the contact
 * form and it's skimmed rather than read, so the cap is about what somebody will actually
 * finish rather than about storage.
 *
 * Mirrored in `web/src/lib/sponsorship.ts` so the desk can't offer what this refuses.
 */
export const MAX_IN_KIND = 6

/**
 * How many benefits one tier may list.
 *
 * Eight, and having a number matters more than which one: these print as a column beside
 * three other cards, and a tier with fourteen lines against one with two stops being a
 * comparison and becomes a wall.
 */
export const MAX_BENEFITS = 8

/** What a sponsor is on the public side. `content.ts` answers with this. */
export const sponsorSelect = {
  id: true,
  name: true,
  tier: true,
  logoUrl: true,
  websiteUrl: true,
  blurb: true,
} as const

/**
 * The same, plus the two columns only the desk cares about.
 *
 * `active` is the whole difference between the two lists: the public read filters on it
 * and this one doesn't, because a hidden sponsor that vanished from the desk as well
 * would be a row nobody could bring back.
 */
const managedSponsorSelect = {
  ...sponsorSelect,
  active: true,
  createdAt: true,
} as const

/** A tier's sheet, as both sides answer it. */
export const tierOfferSelect = {
  tier: true,
  amount: true,
  blurb: true,
  benefits: true,
} as const

/** A way to help that is not money. */
export const inKindSelect = {
  id: true,
  title: true,
  blurb: true,
} as const

/**
 * The fine print, from the one row there is.
 *
 * Answered as a bare string rather than the row, because the row is an implementation
 * detail of "there is exactly one sponsorship page" — and it may not exist at all, which
 * is the same answer as an empty one. Both sides call this so neither has to know that.
 */
export async function sheetFootnotes(): Promise<string | null> {
  const sheet = await prisma.sponsorshipSheet.findUnique({
    where: { id: SHEET_ROW },
    select: { footnotes: true },
  })

  return sheet?.footnotes ?? null
}

/** The singleton's key. A column default in the schema; named here so the two routes
    that touch it can't disagree about the spelling. */
const SHEET_ROW = 'current'

/**
 * The levels there are, in the club's own ranking, straight out of the enum.
 *
 * Sent to the browser for the reason `SEATS` is in `content.ts`: how many tiers the club
 * has is the database's answer. A fifth added to `SponsorTier` gets a fifth row on this
 * desk and a fifth card on the page with nothing edited in `web/`.
 */
export const TIERS = Object.values(SponsorTier)

/** Shares the officer desk's budget rather than opening one of its own. */
const writes = rateLimit('officer', 60)

/** Logos get the smaller upload budget, the same shape the hero desk uses. */
const uploads = rateLimit('sponsor-logo', 20)

const sponsorFields = {
  name: z.string().trim().min(1).max(120),
  tier: z.enum(SponsorTier),
  /**
   * A logo somebody else is hosting. The file route below is the other way in, and how
   * nearly every one of these actually arrives — a company sends a PNG, not a URL that
   * will still resolve next year.
   */
  logoUrl: webUrl().nullable().optional(),
  websiteUrl: webUrl().nullable().optional(),
  blurb: z.string().trim().max(300).nullable().optional(),
}

const createSponsor = z.object({
  ...sponsorFields,
  tier: sponsorFields.tier.default(SponsorTier.ALUMINUM_ALLY),
})

/**
 * The same fields, all optional, and without the default.
 *
 * Not `createSponsor.partial()`: that makes a key optional and leaves the default under
 * it, so a patch saying only `active: false` parses to a tier as well and quietly demotes
 * the sponsor on its way past. The equipment desk paid for that lesson already.
 */
const editSponsor = z
  .object(sponsorFields)
  .partial()
  .extend({ active: z.boolean().optional() })

const tierOffer = z.object({
  amount: z.string().trim().min(1).max(60),
  /**
   * Optional, because the club's own sheet has none — an amount and a list of what you
   * get, with nothing between. It was required for exactly as long as it took to type the
   * real tiers in, at which point the only way to satisfy it was to invent four lines of
   * marketing copy.
   */
  blurb: z.string().trim().max(300).nullable().optional(),
  /**
   * Trimmed and emptied here rather than in the browser, because the desk edits these as
   * one box a line at a time and a trailing newline isn't a benefit. An empty list is
   * allowed: a tier whose whole offer is an amount and a sentence is a real thing.
   */
  benefits: z
    .array(z.string().trim().min(1).max(120))
    .max(MAX_BENEFITS)
    .default([]),
})

const inKindFields = {
  title: z.string().trim().min(1).max(80),
  blurb: z.string().trim().min(1).max(300),
}

/**
 * Whether something is already listed under this name, ignoring case.
 *
 * `name` is unique in Postgres and Postgres is case-sensitive: "Northgate Manufacturing"
 * and "northgate manufacturing" are two rows to the database and one company to the club,
 * and the second is how a sponsor ends up thanked twice on the front page.
 */
const nameTaken = (name: string, exceptId?: string) =>
  prisma.sponsor.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true, active: true },
  })

const ALREADY_LISTED = (other: { name: string; active: boolean }) =>
  other.active
    ? `“${other.name}” is already on the list. Edit that row rather than adding a second one.`
    : `“${other.name}” is already on the list, hidden from the site. Show that row again rather than adding a second one.`

async function getSponsor(id: string) {
  const sponsor = await prisma.sponsor.findUnique({ where: { id } })
  if (!sponsor) throw new HTTPException(404, { message: 'No such sponsor.' })
  return sponsor
}

/**
 * Everything the desk draws, in one read.
 *
 * One route rather than three because the page is one page, and three fetches would be
 * three loading states for a screen that's meaningless with any of them missing. `tiers`
 * carries one entry per level whether or not anybody has written it — an unpublished tier
 * is the row an officer has to see in order to publish.
 */
sponsorsAdmin.get('/', requireAuth, requireOfficer, async (c) => {
  const [sponsors, offers, inKind, footnotes] = await Promise.all([
    prisma.sponsor.findMany({
      // Hidden ones last, then the club's ranking, then alphabetical — the public list's
      // order with the hidden rows pushed under it, so the desk and the page read top to
      // bottom the same way.
      orderBy: [{ active: 'desc' }, { tier: 'asc' }, { name: 'asc' }],
      select: managedSponsorSelect,
    }),
    prisma.sponsorTierOffer.findMany({ select: tierOfferSelect }),
    prisma.inKindOffer.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: inKindSelect,
    }),
    sheetFootnotes(),
  ])

  const written = new Map(offers.map((offer) => [offer.tier, offer]))

  return c.json({
    sponsors,
    tiers: TIERS.map((tier) => ({ tier, offer: written.get(tier) ?? null })),
    inKind,
    footnotes,
  })
})

// ------------------------------------------------------- the tier price list
//
// Registered before `/:id` below, and that isn't tidiness: `tiers` is a perfectly good
// hole for a wildcard to fall into, and a price list answered by the sponsor routes would
// be a 404 that reads like a company having vanished.

/**
 * Publish what a level costs, or rewrite it. An upsert keyed on the tier in the path,
 * because there's exactly one sheet per level and the enum is the key — so this needs no
 * "does it exist yet" round trip and no separate create route.
 *
 * `PUT` rather than `PATCH`: the body is the whole of the thing, and a half-written tier
 * — a new amount with last year's benefits still under it — is worse than an absent one.
 */
sponsorsAdmin.put(
  '/tiers/:tier',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('param', z.object({ tier: z.enum(SponsorTier) })),
  validate('json', tierOffer),
  async (c) => {
    const { tier } = c.req.valid('param')
    const { amount, blurb, benefits } = c.req.valid('json')

    // `?? null` rather than spread-when-present: `PUT` is the whole of the thing, so a
    // body that omits the blurb is asking for a tier without one, not asking to keep the
    // one that's there.
    const offer = await prisma.sponsorTierOffer.upsert({
      where: { tier },
      create: { tier, amount, blurb: blurb ?? null, benefits },
      update: { amount, blurb: blurb ?? null, benefits },
      select: tierOfferSelect,
    })

    return c.json(offer)
  },
)

/**
 * The fine print under the grid — the footnote markers a benefit cites, and the club's
 * note about a sponsorship being tax-deductible.
 *
 * `PUT` on a path with no id, because there's one sponsorship page: the row is keyed
 * `current` by a column default and this upserts it, so "has anybody written the fine
 * print yet" is never a question this route has to ask.
 *
 * An empty string clears it, and clearing is normal — the grid printed no fine print
 * before this row existed and prints none again.
 */
sponsorsAdmin.put(
  '/sheet',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate(
    'json',
    z.object({ footnotes: z.string().trim().max(1000).nullable() }),
  ),
  async (c) => {
    const { footnotes } = c.req.valid('json')
    const text = footnotes === null || footnotes === '' ? null : footnotes

    const sheet = await prisma.sponsorshipSheet.upsert({
      where: { id: SHEET_ROW },
      create: { id: SHEET_ROW, footnotes: text },
      update: { footnotes: text },
      select: { footnotes: true },
    })

    return c.json(sheet)
  },
)

/**
 * Take a level off the published sheet.
 *
 * Not a soft delete and not a `published` column: the row existing is the publication,
 * which keeps "we haven't settled this yet" and "here is what it costs" from being two
 * states one column has to hold. Sponsors already in the tier are untouched.
 */
sponsorsAdmin.delete(
  '/tiers/:tier',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('param', z.object({ tier: z.enum(SponsorTier) })),
  async (c) => {
    const { tier } = c.req.valid('param')

    const held = await prisma.sponsorTierOffer.findUnique({ where: { tier } })
    if (!held) {
      throw new HTTPException(404, { message: 'That tier is not published.' })
    }

    await prisma.sponsorTierOffer.delete({ where: { tier } })

    return c.json({ deleted: true })
  },
)

// ---------------------------------------------------- the other ways to help

/** Refuses once the section is full, and says the number rather than "too many". */
async function assertInKindRoom() {
  const held = await prisma.inKindOffer.count()
  if (held >= MAX_IN_KIND) {
    throw new HTTPException(409, {
      message: `The page shows up to ${MAX_IN_KIND} of these. Remove one before adding another.`,
    })
  }
}

sponsorsAdmin.post(
  '/in-kind',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', z.object(inKindFields)),
  async (c) => {
    const data = c.req.valid('json')

    await assertInKindRoom()

    // Appends: a new one lands at the end, where somebody just added it.
    const { _max } = await prisma.inKindOffer.aggregate({
      _max: { sortOrder: true },
    })

    const added = await prisma.inKindOffer.create({
      data: { ...data, sortOrder: (_max.sortOrder ?? -1) + 1 },
      select: inKindSelect,
    })

    return c.json(added, 201)
  },
)

/**
 * The whole order at once, as a list of ids.
 *
 * The set check is the lost-update guard, and it earns more here than on a project's
 * gallery: this is one global list, so the two tabs it protects against are two different
 * officers rather than one person in two windows.
 *
 * Registered before `/in-kind/:id` for the reason the tier routes are registered first.
 */
sponsorsAdmin.patch(
  '/in-kind/order',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', z.object({ ids: z.array(z.uuid()).min(1).max(MAX_IN_KIND) })),
  async (c) => {
    const { ids } = c.req.valid('json')

    const held = await prisma.inKindOffer.findMany({ select: { id: true } })

    const sent = new Set(ids)
    const stale =
      sent.size !== ids.length ||
      held.length !== ids.length ||
      held.some((row) => !sent.has(row.id))

    if (stale) {
      throw new HTTPException(409, {
        message:
          'That list changed while you were editing it. Reload the page and try again.',
      })
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.inKindOffer.update({ where: { id }, data: { sortOrder: index } }),
      ),
    )

    const rows = await prisma.inKindOffer.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: inKindSelect,
    })

    return c.json(rows)
  },
)

sponsorsAdmin.patch(
  '/in-kind/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', z.object(inKindFields).partial()),
  async (c) => {
    const id = c.req.param('id')
    const patch = c.req.valid('json')

    const held = await prisma.inKindOffer.findUnique({ where: { id } })
    if (!held) throw new HTTPException(404, { message: 'No such entry.' })

    const updated = await prisma.inKindOffer.update({
      where: { id },
      data: patch,
      select: inKindSelect,
    })

    return c.json(updated)
  },
)

sponsorsAdmin.delete(
  '/in-kind/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const id = c.req.param('id')

    const held = await prisma.inKindOffer.findUnique({ where: { id } })
    if (!held) throw new HTTPException(404, { message: 'No such entry.' })

    await prisma.inKindOffer.delete({ where: { id } })

    return c.json({ deleted: true })
  },
)

// ------------------------------------------------------------------ the list

sponsorsAdmin.post(
  '/',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', createSponsor),
  async (c) => {
    const { name, tier, logoUrl, websiteUrl, blurb } = c.req.valid('json')

    // The club's real duplicate isn't a unique-constraint violation, it's the same company
    // added twice by two officers in one week. Answered with what to do about it rather
    // than with the fact — and it says when the other row is hidden, which is the case
    // where "already on the list" reads as a lie.
    const taken = await nameTaken(name)
    if (taken) throw new HTTPException(409, { message: ALREADY_LISTED(taken) })

    const sponsor = await prisma.sponsor.create({
      data: {
        name,
        tier,
        logoUrl: logoUrl ?? null,
        websiteUrl: websiteUrl ?? null,
        blurb: blurb ?? null,
      },
      select: managedSponsorSelect,
    })

    return c.json(sponsor, 201)
  },
)

/**
 * Edit, or hide.
 *
 * `active: false` takes a sponsor off both public lists and keeps the row, which is what a
 * sponsorship that has simply run out wants — the club's record of who backed it shouldn't
 * be erased by a year ending. The `DELETE` below is the other case.
 *
 * Every nullable field tells absent from cleared, so the name box and the blurb box can
 * write independently without either flattening the other.
 */
sponsorsAdmin.patch(
  '/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', editSponsor),
  async (c) => {
    const sponsor = await getSponsor(c.req.param('id'))
    const { name, tier, logoUrl, websiteUrl, blurb, active } = c.req.valid('json')

    if (name && name !== sponsor.name) {
      const taken = await nameTaken(name, sponsor.id)
      if (taken) throw new HTTPException(409, { message: ALREADY_LISTED(taken) })
    }

    const updated = await prisma.sponsor.update({
      where: { id: sponsor.id },
      data: {
        ...(name === undefined ? {} : { name }),
        ...(tier === undefined ? {} : { tier }),
        ...(logoUrl === undefined ? {} : { logoUrl: logoUrl ?? null }),
        ...(websiteUrl === undefined ? {} : { websiteUrl: websiteUrl ?? null }),
        ...(blurb === undefined ? {} : { blurb: blurb ?? null }),
        ...(active === undefined ? {} : { active }),
      },
      select: managedSponsorSelect,
    })

    // Pasting a link over an uploaded logo is a replacement, so the bytes go with it.
    // After the row is written, so a failure leaves an orphaned file rather than a card
    // pointing at nothing — and only when the column actually moved, because
    // `deleteIfStored` would happily delete the file a patch about the blurb just kept.
    if (logoUrl !== undefined && updated.logoUrl !== sponsor.logoUrl) {
      await deleteIfStored(sponsor.logoUrl)
    }

    return c.json(updated)
  },
)

/**
 * Remove a sponsor outright.
 *
 * Hiding is the right way off the list nearly every time; this is the other case — a typo,
 * a duplicate, a company added to the wrong club. Nothing references a sponsor, so unlike
 * the equipment desk's delete this needs no warning about what it costs.
 */
sponsorsAdmin.delete(
  '/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const sponsor = await getSponsor(c.req.param('id'))

    await prisma.sponsor.delete({ where: { id: sponsor.id } })

    // The reference goes before the bytes — see the note on the hero desk's delete.
    // Somebody else's hosting isn't ours to clean up, and `deleteIfStored` knows that.
    await deleteIfStored(sponsor.logoUrl)

    return c.json({ deleted: true })
  },
)

/**
 * The logo as a file, which is how a logo actually arrives: a company sends a PNG.
 * `PATCH` above takes a link, for the rarer case where they have a URL that will still
 * resolve next year.
 *
 * Upload and replace in one route, because a sponsor is a row that has a logo rather than
 * a picture with a name attached — the hero desk's remove-then-add would mean deleting the
 * sponsor to change its artwork.
 */
sponsorsAdmin.post(
  '/:id/logo',
  originGuard,
  requireAuth,
  requireOfficer,
  bodyLimit({
    maxSize: env.MAX_IMAGE_FILE_MB * 1024 * 1024 + 64 * 1024,
    onError: () => {
      throw new HTTPException(413, {
        message: `That image is too big — the cap is ${env.MAX_IMAGE_FILE_MB} MB.`,
      })
    },
  }),
  uploads,
  async (c) => {
    const user = c.get('user')
    const sponsor = await getSponsor(c.req.param('id'))

    const body = await c.req.parseBody()
    const file = body['file']

    if (!(file instanceof File) || file.size === 0) {
      throw new HTTPException(400, { message: 'Attach the logo itself.' })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!looksLikeImage(bytes)) {
      throw new HTTPException(400, {
        message:
          'That file is not an image the site can show. PNG, JPEG, GIF or WebP.',
      })
    }

    const { url } = await storeFile(FileKind.IMAGE, file, user.id)

    const updated = await prisma.sponsor.update({
      where: { id: sponsor.id },
      data: { logoUrl: url },
      select: managedSponsorSelect,
    })

    // The row points at the new bytes before the old ones go, so a failure costs an
    // orphaned file rather than a card with a broken picture on it.
    await deleteIfStored(sponsor.logoUrl)

    return c.json(updated)
  },
)

/** Back to the `[ LOGO ]` well, which every card here is built to survive. */
sponsorsAdmin.delete(
  '/:id/logo',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const sponsor = await getSponsor(c.req.param('id'))

    const updated = await prisma.sponsor.update({
      where: { id: sponsor.id },
      data: { logoUrl: null },
      select: managedSponsorSelect,
    })

    await deleteIfStored(sponsor.logoUrl)

    return c.json(updated)
  },
)
