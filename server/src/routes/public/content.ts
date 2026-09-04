import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { prisma } from '../../core/db.js'
import {
  EventType,
  OfficerPosition,
  ProjectStatus,
  SponsorTier,
  UserRole,
} from '../../generated/prisma/enums.js'
import type {
  EventSelect,
  OfficerTermSelect,
  PostSelect,
  ProjectSelect,
  UserSelect,
  UserWhereInput,
} from '../../generated/prisma/models.js'
import {
  asPublicEvent,
  expandMeetings,
  meetingProjectSelect,
} from '../../projects/meetings.js'
import { currentTerm } from '../../membership/semester.js'
// The desk that writes the front page's slideshow owns the shape of a slide;
// this read borrows it rather than restating six columns that could disagree.
import { heroSlideSelect } from '../officer/heroSlides.js'
// Same rule for the sponsor page. `TIERS` comes with them because the club's
// ranking is the enum's declaration order and this route must not keep a copy.
import {
  inKindSelect,
  sheetFootnotes,
  sponsorSelect,
  tierOfferSelect,
  TIERS,
} from '../officer/sponsorsAdmin.js'
// And again: the front page's copy and the about page's are written from two
// more officer routers, so the shapes come from the files that own them.
import {
  aboutCopySelect,
  ABOUT_ROW,
  milestoneSelect,
} from '../officer/aboutPage.js'
import {
  faqSelect,
  frontPageCopySelect,
  FRONT_PAGE_ROW,
  partnerSelect,
} from '../officer/frontPage.js'
// The documentation shape, from the router that writes it — imported so the
// public read and the lead's editor can't answer with two different objects.
import { documentSelect, wireDocument } from '../projects/projectManage.js'

/**
 * Public, read-only content. Everything here is reachable without auth, so each
 * query filters out unpublished rows and no select reaches for a column the
 * public shouldn't see.
 */
export const content = new Hono()

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * What the club means by "an active member" — the landing page's headline count
 * and the roster's default chip, which are one question asked twice.
 *
 * `role` is the club's ladder rather than a permission label (the sweep drops a
 * lapsed MEMBER to GUEST and dues promote them back), so "not a GUEST" is dues
 * standing. `active` is the alumni flag. See `.claude/docs/membership.md`;
 * nothing here is a permission check.
 *
 * `GET /members` defaults to exactly this, and it has been wrong both ways. The
 * roster once required a `slug` set by hand, which no route on this site has
 * ever written — so a page headed "who is in the club" listed sixty of 688.
 * Defaulting to everybody, guests included, was the overcorrection. EVERYONE is
 * one chip away.
 */
const activeMembers = { active: true, role: { not: 'GUEST' } } as const

/**
 * Having sat on the board and left it, in the club's own archive.
 *
 * A second source for officer alumni, not a replacement: the Discord role used
 * to be the only one because `OfficerTerm` reached back only as far as the sync,
 * and the officers desk spent that argument by letting closed terms be typed in.
 *
 * Deliberately not a second writer. `discordAlumni.ts` owns `User.officerAlumnus`
 * outright and this is read beside it — a column with two owners is the bug this
 * codebase keeps paying for.
 */
const servedOnTheBoard: UserWhereInput = {
  officerTerms: { some: { endedAt: { not: null } } },
}

/**
 * What the roster's three chips mean.
 *
 * ACTIVE MEMBERS is `activeMembers` itself, shared rather than copied: the
 * landing page's cell counts that clause and links here, so the number somebody
 * presses has to be the list they land on.
 *
 * ALUMNI is two facts, either enough — the Discord role mirrored into
 * `User.officerAlumnus`, or an ended term in the archive. Not `active`, which
 * every payment sets back to true and so can never mean "used to run the club".
 *
 * The three are not a partition and aren't trying to be. The first two overlap
 * on purpose: a past president who still pays dues is under both. ACTIVE MEMBERS
 * used to negate the alumni halves, which meant paying dues couldn't put you on
 * the list of people who pay dues.
 */
const rosterStatus = {
  active: activeMembers,
  alumni: { OR: [{ officerAlumnus: true }, servedOnTheBoard] },
  all: {},
} satisfies Record<'active' | 'alumni' | 'all', UserWhereInput>

/**
 * Contact details stay private — no `email` or `passwordHash`.
 *
 * `slug` means "has a public profile URL" and nothing else; it's null for almost
 * everybody and is an officer's to set.
 *
 * `profileUrl` is the member's own answer to the same question and needs nobody's
 * permission. It has already been through the allowlist in `src/core/validate.ts`
 * by the time it's stored, which is what makes it safe in an `href`.
 */
const rosterSelect = {
  id: true,
  slug: true,
  fullName: true,
  role: true,
  title: true,
  gradYear: true,
  bio: true,
  photoUrl: true,
  profileUrl: true,
  active: true,
  // What the card's ALUMNI badge is drawn from. Sent rather than inferred from
  // `active`, which is a different fact — see `rosterStatus`.
  officerAlumnus: true,
  // The archive's half of the same answer, as one row or none. `take: 1` because
  // the question is "did they ever". A relation probe rather than a `_count`:
  // Prisma can't filter a `_count` and select a scalar from one relation at once.
  officerTerms: { where: { endedAt: { not: null } }, select: { id: true }, take: 1 },
} satisfies UserSelect

/**
 * `officerAlumnus` as the browser sees it: the Discord flag or an ended term.
 *
 * Collapsed here rather than sent as two fields, because every reader wants the
 * same OR and two fields is two places to write it differently. The probe
 * relation doesn't go out at all.
 */
const asRosterEntry = <
  T extends { officerAlumnus: boolean; officerTerms: unknown[] },
>({
  officerTerms,
  ...member
}: T) => ({
  ...member,
  officerAlumnus: member.officerAlumnus || officerTerms.length > 0,
})

const projectSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  season: true,
  // The label and the term both. A multi-semester build is one row per term, so
  // printing only the free-text `season` would show one title three times.
  termYear: true,
  termSeason: true,
  competition: true,
  status: true,
  // The cover, its framing, and the switch saying whether either is read. Six
  // scalars sent unconditionally: `coverOf` is one rule over all of them, and
  // sending half would make the listing and the project's page disagree.
  coverUrl: true,
  coverFromGallery: true,
  coverFocalX: true,
  coverFocalY: true,
  coverZoom: true,
  // What this project calls its sections. Null almost everywhere, and the pages
  // fall back to the standing label.
  galleryHeading: true,
  resourcesHeading: true,
  teamHeading: true,
  featured: true,
  startedAt: true,
  completedAt: true,
} satisfies ProjectSelect

/**
 * A project's gallery, in the order its lead arranged it.
 *
 * One declaration for two readers — the detail route and the listing under
 * `images=true` — because they must answer with the same object: a framing column
 * on one and missing from the other is a picture that silently reverts to a
 * centred crop on one page.
 */
const gallerySelect = {
  orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  select: {
    id: true,
    url: true,
    caption: true,
    // How the picture sits in the frame. Public because the public page draws it
    // — without these every gallery reverts to a plain centred crop.
    focalX: true,
    focalY: true,
    zoom: true,
  },
} satisfies ProjectSelect['images']

const eventSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  type: true,
  location: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  registrationUrl: true,
} satisfies EventSelect

/** List view omits `body` so the payload stays small. */
const postListSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverUrl: true,
  publishedAt: true,
  author: { select: { fullName: true } },
} satisfies PostSelect

function notFound(what: string): never {
  throw new HTTPException(404, { message: `No such ${what}` })
}

/**
 * Hasn't finished by `at`. `endsAt` is optional, so a one-day event falls back to
 * its start.
 *
 * Two callers want the same predicate: "upcoming" is "hasn't finished by now",
 * and the calendar's lower bound is "hasn't finished by the 1st" — which keeps a
 * competition that started in July on the August grid.
 */
const unfinishedBy = (at: Date) => ({
  OR: [{ endsAt: { gte: at } }, { endsAt: null, startsAt: { gte: at } }],
})

/**
 * An event is past only once it has finished, so a multi-day competition stays
 * upcoming while it runs. Shared by the listing and the stats count so the two
 * can't disagree about what "upcoming" means.
 */
const upcoming = unfinishedBy

const past = (now: Date) => ({
  OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: now } }],
})

// -------------------------------------------------------------------- stats

/**
 * Counts for the landing page's headline strip.
 *
 * Each cell links to a listing page and counts exactly what that listing shows by
 * default — the number you read is the number of rows you find. Change one and
 * change the other. `members` was the exception until the roster made
 * `rosterStatus.active` its default; the two are one rule again.
 *
 * They run in a transaction so the three numbers describe one snapshot, and
 * `count` never loads the rows.
 */
content.get('/stats', async (c) => {
  const now = new Date()

  const [projects, members, events] = await prisma.$transaction([
    // Matches GET /projects, which does not filter by status by default.
    prisma.project.count(),
    // The clause GET /members defaults to, shared rather than restated.
    prisma.user.count({ where: activeMembers }),
    // Matches GET /events, which defaults to when=upcoming.
    prisma.event.count({ where: { published: true, ...upcoming(now) } }),
  ])

  return c.json({ projects, members, events })
})

// ------------------------------------------------------------------ members

/**
 * The club's active membership by default, and every account behind a chip.
 *
 * The default is `rosterStatus.active`, the same clause the landing page counts.
 * The other two are a `status=` the page offers rather than something applied
 * behind the reader's back.
 *
 * There is no `slug` filter and there must never be one again — see
 * `activeMembers` for what that cost.
 *
 * `limit` is its own ceiling rather than `listQuery`'s hundred. The page searches
 * by name in the browser on purpose: a roster is too long to scan, not too long
 * to send, and that only works if one request carries the whole thing. Past a
 * thousand this becomes real pagination and server-side search — either without
 * the other is a search box that lies.
 */
content.get(
  '/members',
  validate(
    'query',
    listQuery.extend({
      role: z.enum(UserRole).optional(),
      /** The club's membership by default; `alumni` and `all` opt out of that. */
      status: z.enum(['active', 'alumni', 'all']).default('active'),
      limit: z.coerce.number().int().min(1).max(1000).default(1000),
    }),
  ),
  async (c) => {
    const { role, status, limit, offset } = c.req.valid('query')

    const members = await prisma.user.findMany({
      where: {
        ...rosterStatus[status],
        ...(role ? { role } : {}),
      },
      // Leadership first, then alphabetical. UserRole is declared most permission
      // to least and Postgres sorts an enum by declaration order, so ascending
      // role is descending seniority.
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      select: rosterSelect,
      take: limit,
      skip: offset,
    })

    return c.json(members.map(asRosterEntry))
  },
)

/**
 * The officer board and the officer archive — the same rows, split on one column.
 *
 * An open term (`endedAt` null) is what "currently an officer" means. Deliberately
 * not `User.role`, where `ADMIN` outranks `OFFICER` and so can't express an admin
 * who also sits on the board. Its own route rather than `/members?role=OFFICER`
 * because the faculty advisor sits on the board as a plain `MEMBER`.
 *
 * The photo is coalesced here and the account's own wins. A term may carry a
 * headshot, and that used to be preferred — an officer as they were that year —
 * but a photo filed against one term is a copy nothing keeps up to date, and no
 * page has ever written `officer_terms.photo_url`. The stored one still answers
 * for every term with no account behind it, which is most of the archive.
 *
 * `profileUrl` rides along for the reason the roster sends it. There's no
 * per-term copy of that and shouldn't be — a link is a live address, not a record
 * of a year.
 *
 * Both are unpaginated: eight seats a year against a fifty-year club, searched in
 * the browser. The day that stops working it wants `?q=` and `?year=`, not a
 * bigger `take`.
 */
const termSelect = {
  id: true,
  position: true,
  startedAt: true,
  endedAt: true,
  fullName: true,
  photoUrl: true,
  user: { select: { photoUrl: true, profileUrl: true } },
} satisfies OfficerTermSelect

type SelectedTerm = {
  photoUrl: string | null
  user: { photoUrl: string | null; profileUrl: string | null } | null
}

const asOfficer = <T extends SelectedTerm>({ user, photoUrl, ...term }: T) => ({
  ...term,
  photoUrl: user?.photoUrl ?? photoUrl,
  profileUrl: user?.profileUrl ?? null,
})

/**
 * The seats there are, in board order, straight out of the enum.
 *
 * `OfficerPosition` is declared in board order and Prisma generates the object in
 * that order, so this needs no list beside it and no sort. Sent to the browser
 * because how many seats the club has is the database's answer: a ninth in the
 * enum has to put a ninth on the page with nothing edited in `web/`.
 */
const SEATS = Object.values(OfficerPosition)

/** The distinct seats among some terms, in board order. */
const seatsAmong = (terms: { position: OfficerPosition | null }[]) => {
  const held = new Set(terms.flatMap((term) => (term.position ? [term.position] : [])))
  return SEATS.filter((seat) => held.has(seat))
}

/**
 * Today's board: one entry per sitting officer, not one per seat.
 *
 * It used to be one per seat with the frontend holding the list of eight. Two
 * things were wrong: the count was a constant, so a seat added to the enum didn't
 * appear until somebody edited `web/`; and an officer holding no named seat —
 * exactly what the Discord sync creates — couldn't be drawn at all.
 *
 * `seats` rides along so the page can still draw the empty chairs.
 */
content.get('/officers', async (c) => {
  const terms = await prisma.officerTerm.findMany({
    where: { endedAt: null },
    // Postgres sorts an enum by declaration order and OfficerPosition is declared
    // in board order, so this is president-first without a lookup. Nulls sort
    // last, which puts the seatless officers after the seated ones.
    orderBy: [{ position: 'asc' }, { startedAt: 'asc' }],
    select: termSelect,
  })

  return c.json({ seats: SEATS, officers: terms.map(asOfficer) })
})

/**
 * Which academic year a term began in, in SQL.
 *
 * August is the cut-over, and this has to agree with `academicYearOf` in
 * `web/src/lib/officerTerms.ts` — the browser groups cards under a heading
 * computed that way, so a different rule here arrives half-empty with no way for
 * the page to know. `officers.test.ts` pins the two together.
 */
const ACADEMIC_YEAR = `(EXTRACT(YEAR FROM started_at)::int
  - CASE WHEN EXTRACT(MONTH FROM started_at) >= 8 THEN 0 ELSE 1 END)`

/**
 * Everyone who has left the board. Seatless terms are kept — somebody who served
 * without a named chair still served.
 *
 * Two academic years by default, not the whole archive: a fifty-year club is a
 * few hundred rows and every one carries a headshot the page then asks for.
 * `?all=1` fetches everything, which is what "show earlier years" sends.
 *
 * The window is the two most recent years that have terms, not the two most
 * recent years — a club that hasn't rotated since 2025 would otherwise get an
 * empty page, which looks broken and is the one thing a default must never do.
 */
content.get(
  '/officers/past',
  validate(
    'query',
    z.object({
      years: z.coerce.number().int().min(1).max(50).default(2),
      all: z.coerce.boolean().default(false),
    }),
  ),
  async (c) => {
    const { years, all } = c.req.valid('query')

    /**
     * The oldest academic year to include, read off the data rather than the
     * clock. One cheap grouped query; the alternative is loading every term to
     * find out which two years to load.
     */
    const present = all
      ? []
      : await prisma.$queryRawUnsafe<{ ay: number }[]>(
          `SELECT DISTINCT ${ACADEMIC_YEAR} AS ay
           FROM officer_terms WHERE ended_at IS NOT NULL
           ORDER BY ay DESC LIMIT $1`,
          years,
        )

    const oldest = present.at(-1)?.ay ?? null

    // 1 August of that year is where it begins — the same boundary the SQL above
    // divides on, as a date so the query can use the index on `started_at`.
    const from = oldest === null ? null : new Date(Date.UTC(oldest, 7, 1))

    const where = {
      endedAt: { not: null },
      ...(from ? { startedAt: { gte: from } } : {}),
    }

    const [terms, older] = await Promise.all([
      prisma.officerTerm.findMany({
        where,
        // Newest first, board order inside a start date. `endedAt` breaks the tie
        // between a term that ran one year and one that ran eight from the same day.
        orderBy: [{ startedAt: 'desc' }, { endedAt: 'desc' }, { position: 'asc' }],
        select: termSelect,
      }),
      // Whether the page should offer to go further back. A count rather than
      // the rows: the answer is a button, not a list.
      from
        ? prisma.officerTerm.count({
            where: { endedAt: { not: null }, startedAt: { lt: from } },
          })
        : Promise.resolve(0),
    ])

    // The seats this window actually used, in board order, so the page's chip
    // row needs no list of its own — the same rule as its year chips.
    return c.json({ terms: terms.map(asOfficer), older, seats: seatsAmong(terms) })
  },
)

/**
 * One person's profile, for a page that doesn't exist yet.
 *
 * `slug` is the whole condition now. It used to also require not being a GUEST,
 * which was the roster's rule rather than this route's. A slug is set by hand by
 * an officer either way, so having one is the decision to publish a profile.
 */
content.get('/members/:slug', async (c) => {
  const member = await prisma.user.findFirst({
    where: { slug: c.req.param('slug') },
    select: {
      ...rosterSelect,
      joinedAt: true,
      projects: {
        select: {
          title: true,
          project: { select: { slug: true, title: true, season: true } },
        },
      },
    },
  })

  return member ? c.json(asRosterEntry(member)) : notFound('member')
})

// ----------------------------------------------------------------- projects

content.get(
  '/projects',
  validate(
    'query',
    listQuery.extend({
      status: z.enum(ProjectStatus).optional(),
      season: z.string().optional(),
      /**
       * Which term, computed rather than named — the caller can't say which one,
       * on purpose: a page asking for the current term has no way to know what
       * that is without a second round trip, and one that hard-codes a guess goes
       * quietly empty in August.
       *
       * `other` is everything that is not the current term, not everything before
       * it. A strict "past" would leave a project stamped for a term that hasn't
       * started — a fall build entered in spring — on neither list and so on no
       * page at all. Newest term first, so such a row arrives at the top.
       */
      term: z.enum(['current', 'other']).optional(),
      /**
       * Opt-in, because the gallery is otherwise the detail route's alone. This
       * list answers up to a hundred rows and renders none of their pictures, so
       * the flag exists for the one caller that renders all of them: `/projects`
       * asks for the current term and draws a slideshow per project.
       */
      images: z.enum(['true', 'false']).optional(),
      /**
       * The one picture a card draws, which is `images` capped at a single row.
       *
       * Separate from `images=true` rather than a smarter version of it:
       * `/projects` is the only caller that wants pictures and now wants exactly
       * one per project, since a card is a still rather than a slideshow. Twelve
       * times the payload for eleven pictures nothing draws is what this avoids.
       *
       * It answers on the same `images` key, so the browser reads
       * `project.images[0]` either way and `coverOf` needs no second shape.
       */
      cover: z.enum(['true', 'false']).optional(),
      /**
       * The write-up, on the same terms: a 20,000-character column against a
       * hundred rows, so it's asked for rather than sent.
       *
       * `/projects` no longer asks for it — the list prints `summary` only,
       * because a card is a cover and a line beside it, and a whole write-up under
       * six of them was a page of grey text. The flag stays for any caller that
       * wants the prose; it simply has none today.
       */
      description: z.enum(['true', 'false']).optional(),
      featured: z.enum(['true', 'false']).optional(),
    }),
  ),
  async (c) => {
    const { status, season, term, images, cover, description, featured, limit, offset } =
      c.req.valid('query')

    const now = term ? await currentTerm() : null

    // The pair, either way round. `other` is the negation rather than a `<`,
    // which is why it's spelled `other`: two columns compared as one value have
    // no `<` in Prisma anyway, and a hand-rolled "earlier year, or this year and
    // an earlier season" would be the strict version this deliberately isn't.
    const termWhere =
      now === null
        ? {}
        : term === 'current'
          ? { termYear: now.year, termSeason: now.season }
          : { NOT: { termYear: now.year, termSeason: now.season } }

    const projects = await prisma.project.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(season ? { season } : {}),
        ...termWhere,
        ...(featured ? { featured: featured === 'true' } : {}),
      },
      // The archive is read by term and nothing else. `startedAt` is written by no
      // route here and `featured` is landing-page curation, neither of which says
      // anything about a list somebody opened to find last year's rover.
      orderBy:
        term === 'other'
          ? [{ termYear: 'desc' }, { termSeason: 'desc' }, { title: 'asc' }]
          : [{ featured: 'desc' }, { startedAt: 'desc' }, { title: 'asc' }],
      // The heavy parts, each only when asked for. Spread rather than nested
      // ternaries: they're independent.
      //
      // `images` wins over `cover` when both are sent, because it's the superset
      select: {
        ...projectSelect,
        ...(description === 'true' && { description: true }),
        ...(cover === 'true' && { images: { ...gallerySelect, take: 1 } }),
        ...(images === 'true' && { images: gallerySelect }),
      },
      take: limit,
      skip: offset,
    })

    return c.json(projects)
  },
)

/**
 * The gallery, the resource links and the documentation ride on the detail route
 * and nowhere else — the listing answers up to a hundred rows and renders none of
 * them, so carrying them there would ship every gallery in the club to every
 * visitor of `/projects`.
 *
 * `sortOrder` deliberately doesn't go on the wire. The array order is the order;
 * sending both invites the client to disagree with itself.
 *
 * Documents come back on the project rather than from a route of their own
 * because they're read twice: `/projects/:slug/docs` shows them, and
 * `/projects/:slug` needs only to know whether there are any.
 */
content.get('/projects/:slug', async (c) => {
  const project = await prisma.project.findUnique({
    where: { slug: c.req.param('slug') },
    select: {
      ...projectSelect,
      description: true,
      members: {
        // Leads first, then alphabetical — the same order `GET /projects/:id/team`
        // uses, for a reason the private route doesn't have: this list is re-read
        // in place when somebody joins or leaves, and an unordered read lets the
        // planner reshuffle every name on a refetch meant to add one.
        orderBy: [{ rank: 'asc' }, { user: { fullName: 'asc' } }],
        /**
         * `rank` is on the wire and `User.title` is off it.
         *
         * The roster used to print two free-text columns and no rank, so the person
         * running the build was indistinguishable from anybody else on it. `rank`
         * plus the team's name is what the page draws instead, and it's the one
         * label here that means something.
         *
         * `User.title` is the club-wide one — "Lab Manager" — written by nothing in
         * the product. An officer's club seat has no bearing on what they do on
         * somebody's rover, and printing it beside their name said it did.
         *
         * `ProjectMember.title` stays: project-scoped, free text, grants nothing.
         */
        select: {
          title: true,
          rank: true,
          team: { select: { name: true } },
          user: { select: { slug: true, fullName: true, photoUrl: true } },
        },
      },
      images: gallerySelect,
      links: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, label: true, url: true },
      },
      documents: {
        // Upload order, with no sort column to override it. `id` breaks the tie
        // because uuid7 is time-ordered, so two documents published in the same
        // millisecond still come back in a stable order.
        orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        select: documentSelect,
      },
    },
  })

  return project
    ? c.json({ ...project, documents: project.documents.map(wireDocument) })
    : notFound('project')
})

// ------------------------------------------------------------------- events

content.get(
  '/events',
  validate(
    'query',
    listQuery.extend({
      when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
      type: z.enum(EventType).optional(),
      /**
       * Half-open window `[from, to)`, for the landing page's calendar: it asks for
       * one month at a time and pairs these with `when=all`, since a grid has to
       * show days that have been and gone.
       *
       * An event is inside the window if any part of it overlaps, so a multi-day
       * competition appears on every month it touches.
       */
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    }),
  ),
  async (c) => {
    const { when, type, from, to, limit, offset } = c.req.valid('query')
    const now = new Date()

    // `unfinishedBy` and `upcoming` both compile to an `OR` and an object can hold
    // only one, so the conditions go into an `AND` array.
    const events = await prisma.event.findMany({
      where: {
        published: true,
        AND: [
          ...(when === 'upcoming'
            ? [upcoming(now)]
            : when === 'past'
              ? [past(now)]
              : []),
          ...(from ? [unfinishedBy(new Date(from))] : []),
        ],
        ...(to ? { startsAt: { lt: new Date(to) } } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { startsAt: when === 'past' ? 'desc' : 'asc' },
      select: eventSelect,
      take: limit,
      skip: offset,
    })

    const meetings = await publicMeetings(from, to, type)

    // Nothing to merge unless a window was asked for — see `publicMeetings`.
    if (meetings.length === 0) return c.json(events)

    const merged = [...events, ...meetings].sort((a, b) => {
      const order =
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      return when === 'past' ? -order : order
    })

    return c.json(merged)
  },
)

/**
 * The project meetings the public calendar carries, for one window.
 *
 * Only when both ends are named, and that's the rule rather than an optimisation:
 * a meeting is a recurrence, not a row, and "the next 50 upcoming events" has no
 * answer for a rule that repeats until December. Every caller that wants meetings
 * is a calendar and every calendar asks for a month. So `?when=upcoming` gets the
 * stored rows it always got, and `GET /stats` stays consistent with this endpoint
 * without knowing anything about meetings.
 *
 * `meetingsPublic` is the whole gate. `Event.published` guards stored rows and is
 * untouched by any of this: a lead scheduling meetings still can't put an event on
 * the front page.
 */
async function publicMeetings(
  from: string | undefined,
  to: string | undefined,
  type: EventType | undefined,
) {
  if (!from || !to) return []
  // The one filter that can exclude every meeting outright — they are all
  // MEETING — so it is worth answering before touching the database.
  if (type && type !== EventType.MEETING) return []

  const projects = await prisma.project.findMany({
    where: { meetingsPublic: true, meetingWeekdays: { isEmpty: false } },
    select: meetingProjectSelect,
  })

  return (await expandMeetings(projects, new Date(from), new Date(to))).map(
    asPublicEvent,
  )
}

content.get('/events/:slug', async (c) => {
  const event = await prisma.event.findFirst({
    where: { slug: c.req.param('slug'), published: true },
    select: eventSelect,
  })

  return event ? c.json(event) : notFound('event')
})

// -------------------------------------------------------------------- posts

content.get('/posts', validate('query', listQuery), async (c) => {
  const { limit, offset } = c.req.valid('query')

  const posts = await prisma.post.findMany({
    // A null publishedAt is a draft; a future one is scheduled. Neither is public.
    where: { publishedAt: { not: null, lte: new Date() } },
    orderBy: { publishedAt: 'desc' },
    select: postListSelect,
    take: limit,
    skip: offset,
  })

  return c.json(posts)
})

content.get('/posts/:slug', async (c) => {
  const post = await prisma.post.findFirst({
    where: {
      slug: c.req.param('slug'),
      publishedAt: { not: null, lte: new Date() },
    },
    select: { ...postListSelect, body: true },
  })

  return post ? c.json(post) : notFound('post')
})

// ----------------------------------------------------------------- sponsors

content.get(
  '/sponsors',
  validate('query', listQuery.extend({ tier: z.enum(SponsorTier).optional() })),
  async (c) => {
    const { tier, limit, offset } = c.req.valid('query')

    const sponsors = await prisma.sponsor.findMany({
      where: { active: true, ...(tier ? { tier } : {}) },
      // Tier descends by declaration order, so "the top N sponsors" is the first N
      // rows — the landing page takes five and needs no notion of "top". Name
      // breaks ties so the order is stable between requests.
      orderBy: [{ tier: 'asc' }, { name: 'asc' }],
      select: sponsorSelect,
      take: limit,
      skip: offset,
    })

    return c.json(sponsors)
  },
)

/**
 * The pitch half of `/sponsors`: what a level costs, and what a sponsor can give
 * that isn't money.
 *
 * Only the tiers somebody has actually written. All four were hardcoded
 * placeholder copy until officers got a desk, and the point of the move is that
 * nothing here is a figure the club didn't agree to — so an unwritten tier is
 * absent rather than defaulted. A tier with sponsors and no sheet still appears in
 * the list above, which is the honest way round.
 *
 * `tiers` is ordered by the enum, which is the club's ranking, so the page prints
 * it as it arrives. No `limit`: four levels and at most `MAX_IN_KIND` of the other.
 *
 * Its own route rather than a field on `/sponsors` because the two answer
 * different questions — who backs the club, and what backing it would mean.
 */
content.get('/sponsorship', async (c) => {
  const [offers, inKind, footnotes] = await Promise.all([
    prisma.sponsorTierOffer.findMany({ select: tierOfferSelect }),
    prisma.inKindOffer.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: inKindSelect,
    }),
    sheetFootnotes(),
  ])

  // Ordered here rather than in the query: Postgres would sort the enum correctly,
  // but reading the order off `TIERS` makes the ranking one fact rather than two.
  const byTier = new Map(offers.map((offer) => [offer.tier, offer]))

  return c.json({
    tiers: TIERS.flatMap((tier) => {
      const offer = byTier.get(tier)
      return offer ? [offer] : []
    }),
    inKind,
    // Null when nobody has written any, which is what the page drew before this
    // row existed — the same "empty is a real answer" the slideshow relies on.
    footnotes,
  })
})

// ------------------------------------------------------------ the front page

/**
 * The photographs beside the landing page's headline, in the officers' order.
 *
 * No `limit`/`offset` and no filter: one short curated list, capped at
 * `MAX_HERO_SLIDES` by the desk that writes it, and the browser wants all of it.
 *
 * An empty answer is a real answer, not a page with a hole in it — the hero draws
 * its rings and wireframe trace instead. So the browser never has to tell "no
 * photos yet" from "the API is down", which is the one case where that's right.
 */
content.get('/hero-slides', async (c) => {
  const slides = await prisma.heroSlide.findMany({
    // `sortOrder` is dense but not unique — the reorder route rewrites the whole
    // block in one transaction — so `createdAt` is what makes a half-applied write
    // deterministic rather than random.
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: heroSlideSelect,
  })

  return c.json(slides)
})

/**
 * What the landing page says, as opposed to what it lists.
 *
 * One read for the whole of the page's copy, made once by `HomePage` and handed to
 * the hero, the partner section and the FAQ. Three routes would be three round
 * trips for one document that's meaningless in pieces. The sections still fetch
 * their own data; this is the writing around it.
 *
 * `FRONT_PAGE_COPY` below is why the row may be absent. Every other singleton here
 * can be empty because empty is a state its page is built for; a landing page with
 * no headline isn't one of those, and a freshly migrated database is exactly where
 * that would show up. So the shipped wording is the floor.
 */
const FRONT_PAGE_COPY = {
  headline: 'Building Our Future,',
  headlineAccent: 'One Robot at a Time.',
  lede: "Ready to dive into hands-on engineering? Whether you are a master at CAD, an experienced coder, or just eager to learn how to build complex systems from the ground up, there's a place for you on our team. Get involved and start building with us today.",
  partnersIntro:
    'Club membership is UCF students only. These programs we work with are open to everybody else.',
} as const

content.get('/front-page', async (c) => {
  const [copy, faqs, partners] = await Promise.all([
    prisma.frontPage.findUnique({
      where: { id: FRONT_PAGE_ROW },
      select: frontPageCopySelect,
    }),
    prisma.faq.findMany({
      // `sortOrder` is dense but not unique — the reorder route rewrites the whole
      // block in one transaction — so `createdAt` is what makes a half-applied
      // write deterministic rather than random.
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: faqSelect,
    }),
    prisma.partnerProgram.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: partnerSelect,
    }),
  ])

  // Both lists may be empty and both sections are built for it: the FAQ prints its
  // heading and the contact form, and the partner section takes itself off the
  // page. Neither is a failure the browser has to tell from a request that didn't land.
  return c.json({ ...(copy ?? FRONT_PAGE_COPY), faqs, partners })
})

// ------------------------------------------------------------- the about page

/**
 * What `/about` says about the club.
 *
 * Same shape and reasoning as the front page: one read for a page that is one
 * document, and a floor under the singleton so a freshly migrated database serves
 * the page rather than a heading-shaped hole.
 *
 * `storyNotice` being null is the club having written its own history. The page
 * carried that admission as a hardcoded panel, so the only way to retire it was a
 * deploy.
 */
const ABOUT_COPY = {
  heading: 'Building robots at UCF since 1972.',
  lede: 'The Robotics Club of Central Florida is a student organisation at UCF. Members design, build and compete with robots — and, more of the time than anybody admits, take apart the ones that stopped working. No experience is needed to join a project, and none of the people running it started with any.',
  storyNotice: null,
  story: [],
  labBuilding: null,
  labStreet: null,
  labCity: null,
  labMapUrl: null,
  onlineBlurb:
    'Discord is where the club actually talks — meeting times, build threads and the lab sign all land there first.',
} as const

content.get('/about', async (c) => {
  const [copy, milestones] = await Promise.all([
    prisma.aboutPage.findUnique({
      where: { id: ABOUT_ROW },
      select: aboutCopySelect,
    }),
    prisma.aboutMilestone.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: milestoneSelect,
    }),
  ])

  return c.json({ ...(copy ?? ABOUT_COPY), milestones })
})
