import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
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
} from '../../generated/prisma/models.js'
import {
  asPublicEvent,
  expandMeetings,
  meetingProjectSelect,
} from '../../projects/meetings.js'
import { currentTerm } from '../../membership/semester.js'
// Same rule as `documentSelect` below: the desk that writes the front page's
// slideshow owns the shape of a slide, and this read borrows it rather than
// restating six columns that would then be free to disagree.
import { heroSlideSelect } from '../officer/heroSlides.js'
// The same rule again: the desk that writes the sponsor page owns the shape of
// everything on it, and these three reads borrow those shapes rather than
// restating columns that would then be free to disagree. `TIERS` comes with
// them because the club's ranking is the enum's declaration order and this
// route must not keep a second copy of it.
import {
  inKindSelect,
  sheetFootnotes,
  sponsorSelect,
  tierOfferSelect,
  TIERS,
} from '../officer/sponsorsAdmin.js'
// The documentation shape, from the router that writes it. Imported rather
// than restated so the public read and the lead's editor cannot answer with
// two different objects — the same reason `projectManage.ts` imports
// `managedProjectSelect` from the officer desk.
import { documentSelect, wireDocument } from '../projects/projectManage.js'

/**
 * Public, read-only content for the website. Everything here is reachable
 * without auth, so each query filters out unpublished rows and no select
 * reaches for a column the public shouldn't see.
 */
export const content = new Hono()

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * What the club means by "an active member", and the landing page's headline
 * count is now the only thing that asks.
 *
 * `role` is the club's ladder rather than a permission label — `membershipSweep`
 * puts a lapsed MEMBER back down to GUEST and `routes/member/dues.ts` promotes
 * them again — so "not a GUEST" is dues standing. `active` is the alumni flag.
 * See `.claude/docs/membership.md`; nothing here is a permission check.
 *
 * **This deliberately no longer matches `GET /members`.** The roster used to be
 * `{ slug: { not: null }, role: { not: 'GUEST' } }`, shared by the listing, the
 * stat and the subteam counts. A person reached the public page only by being
 * given a `slug` by hand — and **no route on this site has ever written that
 * column**. The result was a page headed "who is in the club" listing sixty of
 * six hundred and eighty-eight accounts, with no way in the product to add the
 * sixty-first. The listing is everybody now; this count is still the club.
 *
 * The strip's cell is labelled ACTIVE MEMBERS for exactly that reason: it is a
 * count of the club, not a count of the page it links to. That is the one place
 * the "each stat matches its listing" rule is broken, and it is broken on
 * purpose — see `web/src/components/home/StatStrip.tsx`.
 */
const activeMembers = { active: true, role: { not: 'GUEST' } } as const

/**
 * What the roster's three chips mean.
 *
 * **ALUMNI is the club's Discord *Officer Alumni* role**, mirrored into
 * `User.officerAlumnus` by `discord/discordAlumni.ts`. It is not `active`,
 * which the chip used to read and which is a different fact with a different
 * owner — `membershipUpdateFor` sets `active` back to `true` on every payment,
 * so it can never be made to mean "used to run the club".
 *
 * **The three are not a strict partition, and cannot be.** `active: false` is a
 * third state: nothing in the product writes it and the legacy import set it on
 * a handful of rows, so those people appear under EVERYONE alone. That is the
 * honest answer — they are neither current nor officer alumni — and it is why
 * this is a lookup rather than the `active: status === 'active'` one-liner it
 * replaced, which quietly assumed two states.
 *
 * An officer alumnus who still pays dues appears under ALUMNI and not CURRENT,
 * and still counts towards `activeMembers` above. One of the twenty-seven
 * people carrying the role in the club's guild is also a sitting officer.
 */
const rosterStatus = {
  active: { active: true, officerAlumnus: false },
  alumni: { officerAlumnus: true },
  all: {},
} as const

/**
 * Contact details stay private — no `email` or `passwordHash` here.
 *
 * `slug` is still sent and is still null for almost everybody. It means "has a
 * public profile URL" and nothing else now: `GET /members/:slug` is the only
 * reader, and the roster cards link nowhere until that page exists.
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
  active: true,
  // What the card's ALUMNI badge is drawn from under the EVERYONE chip. Sent
  // rather than inferred from `active`, which is a different fact — see
  // `rosterStatus`.
  officerAlumnus: true,
  subteam: { select: { slug: true, name: true, color: true } },
} satisfies UserSelect

const projectSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  season: true,
  // The label and the term both. A multi-semester build is several rows now,
  // one per term, so a list that printed only the free-text `season` would show
  // the same title three times with nothing to tell them apart.
  termYear: true,
  termSeason: true,
  competition: true,
  status: true,
  coverUrl: true,
  repoUrl: true,
  featured: true,
  startedAt: true,
  completedAt: true,
} satisfies ProjectSelect

/**
 * A project's gallery, in the order its lead arranged it.
 *
 * Two readers — the detail route, which always carries it, and the listing when
 * a caller asks with `images=true`. One declaration because the two must answer
 * with the same object: the browser draws both through the same component, and
 * a framing column present on one and missing on the other is a picture that
 * silently reverts to a centred crop on one page and not the other.
 */
const gallerySelect = {
  orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  select: {
    id: true,
    url: true,
    caption: true,
    // How the picture sits in the frame. Public because the public page is what
    // draws it — without these every gallery reverts to a plain centred crop
    // for the visitors it was framed for.
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
 * Hasn't finished by `at`. `endsAt` is optional, so a one-day event falls back
 * to its start.
 *
 * Two callers want this same predicate for different reasons: "upcoming" is
 * "hasn't finished by now", and the calendar's lower range bound is "hasn't
 * finished by the 1st of the month" — which is what keeps a competition that
 * started in July on the August grid.
 */
const unfinishedBy = (at: Date) => ({
  OR: [{ endsAt: { gte: at } }, { endsAt: null, startsAt: { gte: at } }],
})

/**
 * An event counts as past only once it has finished, so a multi-day competition
 * keeps showing as upcoming while it runs. Shared by the event listing and the
 * stats count so the two can never disagree about what "upcoming" means.
 */
const upcoming = unfinishedBy

const past = (now: Date) => ({
  OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: now } }],
})

// -------------------------------------------------------------------- stats

/**
 * Counts for the landing page's headline strip.
 *
 * Each cell up there links to a listing page, and two of the three count
 * exactly what that listing shows by default — the number you read is the
 * number of rows you find when you land. Change one and change the other.
 *
 * **`members` is the deliberate exception.** `GET /members` lists every account
 * including guests; this counts the club's active membership, which is a much
 * smaller and much more meaningful number for a front page. The cell is
 * labelled ACTIVE MEMBERS so the two are not read as the same claim. See
 * `activeMembers` above for why the roster stopped filtering.
 *
 * They run in a transaction so the three numbers describe a single snapshot
 * rather than three separate moments, and `count` never loads the rows.
 */
content.get('/stats', async (c) => {
  const now = new Date()

  const [projects, members, events] = await prisma.$transaction([
    // Matches GET /projects, which does not filter by status by default.
    prisma.project.count(),
    // Does *not* match GET /members, on purpose — see above.
    prisma.user.count({ where: activeMembers }),
    // Matches GET /events, which defaults to when=upcoming.
    prisma.event.count({ where: { published: true, ...upcoming(now) } }),
  ])

  return c.json({ projects, members, events })
})

// ----------------------------------------------------------------- subteams

content.get('/subteams', async (c) => {
  const subteams = await prisma.subteam.findMany({
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      color: true,
      // Matches `GET /members?subteam=…` at its default `status=active`, which
      // is where `/about` sends a reader who presses this number — hence
      // `rosterStatus.active` itself rather than a copy of its two conditions.
      // The two moved together when the roster stopped filtering on `slug`: a
      // count that still said "has a slug" would now under-report every subteam
      // on the page, against a list that shows everybody.
      _count: { select: { members: { where: rosterStatus.active } } },
    },
  })

  return c.json(
    subteams.map(({ _count, ...subteam }) => ({
      ...subteam,
      memberCount: _count.members,
    })),
  )
})

// ------------------------------------------------------------------ members

/**
 * Everybody with an account, guests included.
 *
 * **The only filter left is the alumni one**, and that is a `status=` the page
 * offers rather than something applied behind the reader's back. There is no
 * roster to be on any more — see `activeMembers` for what this used to be and
 * why sixty of six hundred and eighty-eight was not a roster anybody could
 * maintain.
 *
 * `limit` is its own ceiling here rather than `listQuery`'s hundred. The page
 * filters by subteam and by name in the browser on purpose — a club roster is a
 * list too long to *scan*, not one too long to send — and that only works if
 * one request carries the whole thing. A thousand rows of these columns is a
 * few hundred kilobytes before compression, cached at the edge for five
 * minutes, and read once by anybody who visits `/members`. If the club ever
 * passes a thousand this becomes real pagination *and* server-side search,
 * because either without the other is a search box that lies.
 */
content.get(
  '/members',
  zValidator(
    'query',
    listQuery.extend({
      subteam: z.string().optional(),
      role: z.enum(UserRole).optional(),
      /** Current people by default; `alumni` and `all` opt out of that. */
      status: z.enum(['active', 'alumni', 'all']).default('active'),
      limit: z.coerce.number().int().min(1).max(1000).default(1000),
    }),
  ),
  async (c) => {
    const { subteam, role, status, limit, offset } = c.req.valid('query')

    const members = await prisma.user.findMany({
      where: {
        ...rosterStatus[status],
        ...(subteam ? { subteam: { slug: subteam } } : {}),
        ...(role ? { role } : {}),
      },
      // Leadership first, then alphabetical — the order the team page wants.
      // UserRole is declared most permission to least, and Postgres sorts an
      // enum by declaration order, so ascending role is descending seniority.
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      select: rosterSelect,
      take: limit,
      skip: offset,
    })

    return c.json(members)
  },
)

/**
 * The officer board and the officer archive — the same rows, split on one column.
 *
 * `OfficerTerm` is who sat on the board, in which seat, between which dates, and
 * **an open term — `endedAt` null — is what "currently an officer" means.** That
 * is deliberately not `User.role`: the ladder there says what somebody may *do*
 * and `ADMIN` outranks `OFFICER` on it, so it cannot express an admin who also
 * sits on the board. A term can, and does. See `schema.prisma` and
 * `.claude/docs/membership.md`.
 *
 * Its own route rather than `/members?role=OFFICER` for the reason it always
 * was: the faculty advisor sits on the board as a plain `MEMBER`, so a role
 * filter would both miss them and sweep up officers holding no named seat.
 *
 * **The photo is coalesced here rather than left to the page.** A term may
 * carry a headshot from its own year, and where it does not, the linked roster
 * entry's current one is the next best thing — but which of the two answered is
 * not a decision the browser should be making, so this settles it and sends one
 * field. Nothing else about the linked user comes back.
 *
 * Both are unpaginated, deliberately. The whole archive is eight seats a year
 * against a fifty-year club; the page searches and filters it in the browser for
 * the same reason `web/src/lib/equipment/catalogue.ts` does — a list too long to *scan*,
 * not one too long to send. The day those become the same problem this wants
 * `?q=` and `?year=`, not a bigger `take`.
 */
const termSelect = {
  id: true,
  position: true,
  startedAt: true,
  endedAt: true,
  fullName: true,
  photoUrl: true,
  user: { select: { photoUrl: true } },
} satisfies OfficerTermSelect

type SelectedTerm = {
  photoUrl: string | null
  user: { photoUrl: string | null } | null
}

const asOfficer = <T extends SelectedTerm>({ user, photoUrl, ...term }: T) => ({
  ...term,
  photoUrl: photoUrl ?? user?.photoUrl ?? null,
})

/**
 * The seats there are, in board order, straight out of the enum.
 *
 * `OfficerPosition` is declared in `schema.prisma` in the order the site shows
 * it, and Prisma generates the object in that order — so this needs no list
 * beside it and no sort. It is sent to the browser because **how many seats the
 * club has is the database's answer, not the frontend's**: adding a ninth to
 * the enum has to put a ninth on the page without anybody editing a constant.
 */
const SEATS = Object.values(OfficerPosition)

/** The distinct seats among some terms, in board order. */
const seatsAmong = (terms: { position: OfficerPosition | null }[]) => {
  const held = new Set(terms.flatMap((term) => (term.position ? [term.position] : [])))
  return SEATS.filter((seat) => held.has(seat))
}

/**
 * Today's board: **one entry per sitting officer**, not one per seat.
 *
 * It used to be one per seat, with the frontend holding the list of eight and
 * the response only filling them in. Two things were wrong with that. The count
 * was a constant in `content/home.ts`, so a seat added to the enum did not
 * appear until somebody edited the frontend; and an officer holding *no* named
 * seat — which is exactly what the Discord sync creates, before anybody has
 * given them a chair — could not be drawn at all, so a real officer was
 * invisible on the front page.
 *
 * `seats` rides along so the page can still draw the chairs nobody is sitting
 * in, and that list now comes from the database too.
 */
content.get('/officers', async (c) => {
  const terms = await prisma.officerTerm.findMany({
    where: { endedAt: null },
    // Postgres sorts an enum by declaration order and OfficerPosition is
    // declared in board order, so this is president-first without a lookup.
    // Nulls sort last, which puts the seatless officers after the seated ones.
    orderBy: [{ position: 'asc' }, { startedAt: 'asc' }],
    select: termSelect,
  })

  return c.json({ seats: SEATS, officers: terms.map(asOfficer) })
})

/**
 * Which academic year a term began in, in SQL.
 *
 * **August is the cut-over, and this has to agree with `academicYearOf` in
 * `web/src/lib/officerTerms.ts`.** The browser groups the cards under a heading
 * computed that way; if this windowed on a different rule, a year would arrive
 * half-empty and the page would have no way to know. `officers.test.ts` pins
 * the two together.
 */
const ACADEMIC_YEAR = `(EXTRACT(YEAR FROM started_at)::int
  - CASE WHEN EXTRACT(MONTH FROM started_at) >= 8 THEN 0 ELSE 1 END)`

/**
 * Everyone who has left the board. Seatless terms are kept — somebody who
 * served without a named chair still served.
 *
 * **Two academic years by default, not the whole archive.** A fifty-year club
 * is a few hundred rows and every one of them carries a headshot the page then
 * asks for; opening `/officers` should not be a request for the lot. `?all=1`
 * fetches everything, which is what the page's own "show earlier years" sends —
 * the same idiom as the print and borrowing queues.
 *
 * **The window is the two most recent years that *have* terms, not the two most
 * recent years.** A club that has not rotated since 2025 would get an empty
 * page from a window counted off today's date, which looks broken and is the
 * one thing a default must never do.
 */
content.get(
  '/officers/past',
  zValidator(
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

    // 1 August of that year is where it begins — the same boundary the SQL
    // above divides on, expressed as a date so the query below can use the
    // index on `started_at`.
    const from = oldest === null ? null : new Date(Date.UTC(oldest, 7, 1))

    const where = {
      endedAt: { not: null },
      ...(from ? { startedAt: { gte: from } } : {}),
    }

    const [terms, older] = await Promise.all([
      prisma.officerTerm.findMany({
        where,
        // Newest first, board order inside a start date. `endedAt` breaks the
        // tie between a term that ran one year and one that ran eight from the
        // same day.
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
 * One person's profile, for a page that does not exist yet.
 *
 * `slug` is the whole condition now. It used to also require not being a GUEST,
 * which was the roster rule rather than this route's — and with the listing
 * showing guests, a card whose profile 404s purely because they have not paid
 * would be the odd one out. A slug is set by hand and by an officer either way,
 * so having one *is* the decision to publish a profile.
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

  return member ? c.json(member) : notFound('member')
})

// ----------------------------------------------------------------- projects

content.get(
  '/projects',
  zValidator(
    'query',
    listQuery.extend({
      status: z.enum(ProjectStatus).optional(),
      season: z.string().optional(),
      /**
       * Which term, computed rather than named — the caller cannot say *which*
       * one, on purpose. A page asking for the current term has no way to know
       * what that is without a second round trip, and one that hard-codes a
       * guess is a page that goes quietly empty in August. `season` above stays
       * for the free-text label; this is the real term.
       *
       * **`other` is everything that is not the current term, not everything
       * before it.** The public list shows this semester and puts the rest
       * behind a button, so a strict "past" would leave a project stamped for a
       * term that has not started — a fall build entered in spring, which
       * `currentTerm` makes an ordinary thing to have — on neither list and
       * therefore on no page at all. It sorts newest term first, so such a row
       * arrives at the top carrying its own term label rather than vanishing.
       */
      term: z.enum(['current', 'other']).optional(),
      /**
       * Opt-in, because the gallery is otherwise the detail route's alone — see
       * the note on `/projects/:slug`. This list answers up to a hundred rows
       * and renders none of their pictures, so the flag exists for the one
       * caller that renders all of them: `/projects` asks for the current term,
       * which is a handful of projects, and draws a slideshow per project.
       */
      images: z.enum(['true', 'false']).optional(),
      /**
       * The write-up, on the same terms and for the same reason: it is a
       * 20,000-character column and this route answers a hundred rows, so it is
       * asked for rather than sent. `summary` is the field meant for a list —
       * "one-liner for cards", says the schema — but **no project the club has
       * ever created has one**, and every one of them has a write-up, so a
       * listing that prints only `summary` prints nothing at all.
       */
      description: z.enum(['true', 'false']).optional(),
      featured: z.enum(['true', 'false']).optional(),
    }),
  ),
  async (c) => {
    const { status, season, term, images, description, featured, limit, offset } =
      c.req.valid('query')

    const now = term ? await currentTerm() : null

    // The pair, either way round. `other` being the negation rather than a
    // `<` is the whole reason it is spelled `other`: two columns compared as
    // one value has no `<` in Prisma anyway — an enum takes no range filter —
    // and a hand-rolled "earlier year, or this year and an earlier season"
    // would be the strict version this deliberately is not.
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
      // The archive is read by term and nothing else, so it is ordered by term
      // — `startedAt` is written by no route here and `featured` is curation
      // for the landing page, neither of which says anything about a list
      // somebody opened to find last year's rover.
      orderBy:
        term === 'other'
          ? [{ termYear: 'desc' }, { termSeason: 'desc' }, { title: 'asc' }]
          : [{ featured: 'desc' }, { startedAt: 'desc' }, { title: 'asc' }],
      // The two heavy columns, each only when asked for. Spread rather than
      // nested ternaries: they are independent, and the archive wants the
      // write-up without the pictures.
      select: {
        ...projectSelect,
        ...(description === 'true' && { description: true }),
        ...(images === 'true' && { images: gallerySelect }),
      },
      take: limit,
      skip: offset,
    })

    return c.json(projects)
  },
)

/**
 * The gallery, the resource links and the documentation ride on the *detail*
 * route and nowhere else. The listing above answers up to a hundred rows and
 * renders none of them, so carrying them there would ship every gallery in the
 * club to every visitor of `/projects`.
 *
 * `sortOrder` deliberately does not go on the wire. The array order *is* the
 * order — sending both invites the client to disagree with itself, and the
 * reorder route takes ids in order anyway.
 *
 * Documents come back on the project rather than from a route of their own, and
 * they are read twice: `/projects/:slug/docs` is the page that shows them, and
 * `/projects/:slug` needs to know only whether there are any, so it can draw
 * the row in `/ RESOURCES` that leads there. One fetch answers both.
 */
content.get('/projects/:slug', async (c) => {
  const project = await prisma.project.findUnique({
    where: { slug: c.req.param('slug') },
    select: {
      ...projectSelect,
      description: true,
      members: {
        // Leads first, then alphabetical — the same order `GET /projects/:id/team`
        // uses, and for a reason the private route does not have: this list is
        // re-read in place when somebody joins or leaves, and an unordered read
        // lets the planner reshuffle every name on a refetch that was only ever
        // meant to add one.
        orderBy: [{ rank: 'asc' }, { user: { fullName: 'asc' } }],
        // Two `title`s, at two levels, and they are different things: the outer
        // one is what this person is called *on this project* ("Software
        // Lead"), the inner one is their club title. Both are free text and
        // neither grants anything.
        select: {
          title: true,
          user: {
            select: { slug: true, fullName: true, photoUrl: true, title: true },
          },
        },
      },
      images: gallerySelect,
      links: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, label: true, url: true },
      },
      documents: {
        // Upload order, and there is no sort column to override it — see the
        // model's comment. `id` breaks the tie because uuid7 is time-ordered,
        // so two documents published in the same millisecond still come back
        // in a stable order rather than whichever way the planner felt.
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
  zValidator(
    'query',
    listQuery.extend({
      when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
      type: z.enum(EventType).optional(),
      /**
       * Half-open window `[from, to)`, for the landing page's calendar: it asks
       * for one month at a time and pairs these with `when=all`, since a grid
       * has to show the days that have already been and gone.
       *
       * An event counts as inside the window if any part of it overlaps —
       * starts before `to` and hasn't finished by `from` — so a multi-day
       * competition appears on every month it touches rather than only the one
       * it began in.
       */
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    }),
  ),
  async (c) => {
    const { when, type, from, to, limit, offset } = c.req.valid('query')
    const now = new Date()

    // `unfinishedBy` and `upcoming` both compile to an `OR`, and an object can
    // hold only one of those, so the conditions go into an `AND` array instead
    // of being spread into a single `where`.
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
 * **Only when both ends of the window are named**, and that is the rule rather
 * than an optimisation. A meeting is a recurrence, not a row: "the next 50
 * upcoming events" has an answer for stored rows and no answer at all for a
 * rule that repeats until December. Every caller that wants meetings is a
 * calendar and every calendar asks for a month. A bare `?when=upcoming` gets
 * the stored rows it has always got, `?limit` and `?offset` keep meaning what
 * they mean, and `GET /stats` — which counts the same unwindowed default — stays
 * consistent with this endpoint without knowing anything about meetings.
 *
 * `meetingsPublic` is the whole gate. `Event.published` guards stored rows and
 * is deliberately untouched by any of this: a lead scheduling meetings still
 * cannot put an *event* on the front page.
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

content.get('/posts', zValidator('query', listQuery), async (c) => {
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
  zValidator('query', listQuery.extend({ tier: z.enum(SponsorTier).optional() })),
  async (c) => {
    const { tier, limit, offset } = c.req.valid('query')

    const sponsors = await prisma.sponsor.findMany({
      where: { active: true, ...(tier ? { tier } : {}) },
      // Tier descends by declaration order, so "the top N sponsors" is just the
      // first N rows of this — the landing page takes five and needs no notion
      // of "top" of its own. Name breaks ties so the order is stable between
      // requests rather than left to the planner.
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
 * that is not money.
 *
 * **Only the tiers somebody has actually written.** All four of these were
 * hardcoded placeholder copy in `web/src/content/sponsorship.ts` until the
 * officers got a desk for them, and the whole point of the move is that nothing
 * on this page is a figure the club did not agree to — so an unwritten tier is
 * absent from the price list rather than defaulted to something. A tier with
 * sponsors in it and no sheet still appears in the list above, which is the
 * honest way round and the behaviour `SponsorsPage` was already built for.
 *
 * `tiers` is ordered by the enum, which is the club's ranking, so the page
 * prints it in the order it arrives — the same trust `/sponsors` asks for. It
 * carries no `limit`: there are four levels and at most `MAX_IN_KIND` of the
 * other thing, and paginating that would be machinery for nothing.
 *
 * Its own route rather than a field on `/sponsors` because the two answer
 * different questions for different readers — who backs the club, and what
 * backing it would mean — and the front page's marquee wants only the first.
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

  // Ordered here rather than in the query: Postgres would sort the enum
  // correctly, but reading the order off `TIERS` is what makes the ranking one
  // fact rather than two that agree today.
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
 * The photographs beside the landing page's headline, in the order the officers
 * put them in.
 *
 * No `limit`/`offset` and no filter: it is one short curated list, capped at
 * `MAX_HERO_SLIDES` by the desk that writes it, and the browser wants all of it
 * to run the slideshow. Paginating a list of six would be machinery for nothing.
 *
 * **An empty answer is a real answer**, not a failure and not a page with a hole
 * in it: the hero draws the rings and the wireframe trace when this comes back
 * empty, which is what the right half of it was before this table existed. The
 * browser therefore never has to tell "no photos yet" from "the API is down" —
 * both end up in the same place, which is the one case where that is right.
 */
content.get('/hero-slides', async (c) => {
  const slides = await prisma.heroSlide.findMany({
    // `sortOrder` is dense but not unique — the reorder route rewrites the whole
    // block in one transaction — so `createdAt` is what makes a half-applied
    // write a deterministic order rather than a random one.
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: heroSlideSelect,
  })

  return c.json(slides)
})
