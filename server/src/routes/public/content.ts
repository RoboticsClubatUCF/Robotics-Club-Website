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
// And again, twice over. The front page's copy and the about page's are written
// from two more officer routers, and this file answers both reads — so the
// shapes come from the files that own them rather than being restated here.
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
 * What the club means by "an active member" — the landing page's headline count
 * and the roster's default chip, which are the same question asked twice.
 *
 * `role` is the club's ladder rather than a permission label — `membershipSweep`
 * puts a lapsed MEMBER back down to GUEST and `routes/member/dues.ts` promotes
 * them again — so "not a GUEST" is dues standing. `active` is the alumni flag.
 * See `.claude/docs/membership.md`; nothing here is a permission check.
 *
 * **`GET /members` defaults to exactly this**, and it has been wrong in both
 * directions to get here. The roster was once
 * `{ slug: { not: null }, role: { not: 'GUEST' } }` — a person reached the
 * public page only by being given a `slug` by hand, and **no route on this site
 * has ever written that column**, so a page headed "who is in the club" listed
 * sixty of six hundred and eighty-eight accounts with no way in the product to
 * add the sixty-first. Dropping the slug was right; defaulting to *everybody,
 * guests included* was the overcorrection, because the club's own answer to who
 * is in it is who has paid. EVERYONE is still one chip away for anybody who
 * wants the whole table.
 *
 * So the strip's cell and the page it links to agree again, and the exception
 * the strip used to document is gone — see
 * `web/src/components/home/StatStrip.tsx`.
 */
const activeMembers = { active: true, role: { not: 'GUEST' } } as const

/**
 * Having sat on the board and left it, in the club's own archive.
 *
 * **The officers desk is why this is here.** Officer alumni used to be the
 * Discord role and nothing else, and the argument for that was reach:
 * `OfficerTerm` only knew about the people who had rotated off since the sync
 * started, which was a few months of a fifty-year club, while the guild's
 * `Officer Alumni` role goes back as far as the server does. That argument is
 * spent — `/dashboard/officer/officers` writes closed terms by hand now, so the
 * archive goes back as far as somebody is willing to type, and a club with no
 * Discord at all can still say who used to run it.
 *
 * It is a *second source*, not a replacement, and deliberately not a second
 * writer. Nothing here writes `User.officerAlumnus`; `discordAlumni.ts` still
 * owns that column outright and this is read beside it. A column with two
 * owners is the bug this codebase keeps paying for — see the note on `active`
 * in that file.
 */
const servedOnTheBoard: UserWhereInput = {
  officerTerms: { some: { endedAt: { not: null } } },
}

/**
 * What the roster's three chips mean.
 *
 * **ACTIVE MEMBERS is `activeMembers` itself**, shared rather than copied. The
 * landing page's cell counts that clause and links here, so the number somebody
 * presses has to be the list they land on; two spellings of one rule is how
 * that stops being true without anybody noticing.
 *
 * **ALUMNI is two facts, either of which is enough**: the club's Discord
 * *Officer Alumni* role, mirrored into `User.officerAlumnus` by
 * `discord/discordAlumni.ts`, or a term in the club's own archive that has
 * ended — see `servedOnTheBoard` above. It is not `active`, which the chip used
 * to read and which is a different fact with a different owner —
 * `membershipUpdateFor` sets `active` back to `true` on every payment, so it
 * can never be made to mean "used to run the club".
 *
 * **The three are not a partition and are not trying to be.** The first two
 * overlap on purpose: a past president who still pays dues is under both, and
 * one of the twenty-seven people carrying the role in the club's guild is a
 * sitting officer. ACTIVE MEMBERS used to negate both halves of ALUMNI to keep
 * them disjoint, which had the effect that paying dues could not put somebody
 * on the list of people who pay dues. A guest who signed up and went no further
 * is in neither and appears under EVERYONE alone, which is the honest answer
 * for them.
 */
const rosterStatus = {
  active: activeMembers,
  alumni: { OR: [{ officerAlumnus: true }, servedOnTheBoard] },
  all: {},
} satisfies Record<'active' | 'alumni' | 'all', UserWhereInput>

/**
 * Contact details stay private — no `email` or `passwordHash` here.
 *
 * `slug` is still sent and is still null for almost everybody. It means "has a
 * public profile URL" and nothing else now: `GET /members/:slug` is the only
 * reader, and it is an officer's to set.
 *
 * `profileUrl` is the member's own answer to the same question and needs
 * nobody's permission — the roster card's photograph is a link to it where
 * there is one. It has already been through the allowlist in
 * `src/core/validate.ts` by the time it is stored, which is what makes it safe
 * to print into an `href` on a page with several hundred faces on it.
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
  // What the card's ALUMNI badge is drawn from under the EVERYONE chip. Sent
  // rather than inferred from `active`, which is a different fact — see
  // `rosterStatus`.
  officerAlumnus: true,
  // The archive's half of the same answer, as one row or none. `take: 1`
  // because the question is "did they ever", and somebody who held five terms
  // is no more an alumnus than somebody who held one — `asRosterEntry` below
  // only asks whether the array is empty. A relation probe rather than a
  // `_count`: Prisma cannot filter a `_count` and select a scalar from the same
  // relation in one go, and this shape reads as what it is.
  officerTerms: { where: { endedAt: { not: null } }, select: { id: true }, take: 1 },
} satisfies UserSelect

/**
 * `officerAlumnus` as the browser sees it: the Discord flag **or** a term that
 * has ended.
 *
 * Collapsed here rather than sent as two fields, because every reader of it —
 * the card's badge, the ALUMNI chip's own filter — wants the same OR, and two
 * fields is two places for that OR to be written differently. The probe relation
 * does not go out at all; it is scaffolding for this line.
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
  // The label and the term both. A multi-semester build is several rows now,
  // one per term, so a list that printed only the free-text `season` would show
  // the same title three times with nothing to tell them apart.
  termYear: true,
  termSeason: true,
  competition: true,
  status: true,
  // The cover and how it is framed, plus the switch that says whether either is
  // read at all. Six small scalars, sent unconditionally: `coverOf` in the
  // browser is one rule over all of them, and a flag that sent half would make
  // the listing and the project's own page disagree about the same picture.
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
 * Each cell up there links to a listing page and counts exactly what that
 * listing shows by default — the number you read is the number of rows you find
 * when you land. Change one and change the other.
 *
 * **`members` was the exception until the roster made this its default.**
 * `GET /members` used to list every account including guests, so the cell had to
 * carry the difference in its label. It defaults to `rosterStatus.active`, which
 * *is* `activeMembers`, and the two are one rule again. The label stays ACTIVE
 * MEMBERS because that is what the number is, not because it is a caveat.
 *
 * They run in a transaction so the three numbers describe a single snapshot
 * rather than three separate moments, and `count` never loads the rows.
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
 * **The default is `rosterStatus.active`, which is `activeMembers`** — the same
 * clause the landing page's cell counts. The other two states are a `status=`
 * the page offers rather than something applied behind the reader's back.
 *
 * **There is no `slug` filter and there must never be one again.** It was how
 * this page came to show sixty of six hundred and eighty-eight accounts, and no
 * route on this site has ever written that column; see `activeMembers`.
 *
 * `limit` is its own ceiling here rather than `listQuery`'s hundred. The page
 * searches by name in the browser on purpose — a club roster is a list too long
 * to *scan*, not one too long to send — and that only works if one request
 * carries the whole thing. A thousand rows of these columns is a
 * few hundred kilobytes before compression, cached at the edge for five
 * minutes, and read once by anybody who visits `/members`. If the club ever
 * passes a thousand this becomes real pagination *and* server-side search,
 * because either without the other is a search box that lies.
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
      // Leadership first, then alphabetical — the order the team page wants.
      // UserRole is declared most permission to least, and Postgres sorts an
      // enum by declaration order, so ascending role is descending seniority.
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
 * **The photo is coalesced here rather than left to the page, and the account's
 * own photograph is what wins.** A term may also carry a headshot stored on the
 * row, and that used to be preferred — an officer was shown as they were in the
 * year they served. It is the fallback now, because a photograph filed against
 * one term is a copy that nothing keeps up to date: somebody who replaces the
 * picture on their account expects the board to follow, and no page on this
 * site has ever written `officer_terms.photo_url`, so in practice the winner
 * was a column only an import could fill. The stored one still answers for
 * every term with no account behind it, which is most of the archive.
 *
 * `profileUrl` rides along from the same place for the same reason the roster
 * sends it: the card's photograph is a link where the officer has given one.
 * There is no per-term copy of *that* and there should not be — a link is a
 * live address rather than a record of a year. Nothing else about the linked
 * user comes back.
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
       * The one picture a card draws, which is `images` capped at a single row.
       *
       * Separate from `images=true` rather than a smarter version of it: this
       * route answers up to a hundred rows and `/projects` is the only caller
       * that wants pictures at all, but it wants exactly one per project now
       * that a card is a still rather than a slideshow. Twelve times the payload
       * for eleven pictures nothing draws is the thing the flag exists to avoid,
       * and a caller that genuinely wants whole galleries still has `images`.
       *
       * It answers on the same `images` key, so the browser reads
       * `project.images[0]` either way and `coverOf` needs no second shape.
       */
      cover: z.enum(['true', 'false']).optional(),
      /**
       * The write-up, on the same terms and for the same reason: it is a
       * 20,000-character column and this route answers a hundred rows, so it is
       * asked for rather than sent.
       *
       * **`/projects` no longer asks for it.** The list prints `summary` and
       * only `summary` — the field the schema calls the one-liner for cards —
       * because a card is a cover and a line beside it, and a whole write-up set
       * under six of them was a page of grey text. The flag stays for any caller
       * that wants the prose; it simply has none today.
       */
      description: z.enum(['true', 'false']).optional(),
      featured: z.enum(['true', 'false']).optional(),
    }),
  ),
  async (c) => {
    const { status, season, term, images, cover, description, featured, limit, offset } =
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
      // The heavy parts, each only when asked for. Spread rather than nested
      // ternaries: they are independent of one another.
      //
      // `images` wins over `cover` when both are sent, because it is the
      // superset — a caller that asked for the whole gallery has already been
      // given the first picture, and taking `take: 1` as the later spread would
      // silently hand them one row for a flag that promises twelve.
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
        /**
         * **`rank` is on the wire now, and `User.title` is off it.**
         *
         * The roster used to print two free-text columns and no rank at all, so
         * the person running the build was indistinguishable from anybody else
         * on it — the ordering above put them first and said nothing about why.
         * `rank` plus the team's name is what the page draws instead, and it is
         * the one label here that means something: it is the column every
         * permission on this project is decided by.
         *
         * `User.title` is gone because it is the club-wide title — "Lab
         * Manager" — written by nothing in the product, only by the seed and the
         * legacy import. An officer's club seat has no bearing on what they do
         * on somebody's rover, and printing it beside their name on a project
         * page said it did.
         *
         * `ProjectMember.title` stays: it is the project-scoped one, free text,
         * grants nothing, and is now written by the page's own editor.
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
  validate(
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

/**
 * What the landing page says, as opposed to what it lists.
 *
 * **One read for the whole of the page's copy**, and the browser makes it once:
 * `HomePage` fetches this and hands the pieces to the hero, the partner section
 * and the FAQ. Three routes would be three round trips for one document that is
 * meaningless in pieces — the hero's lede and the FAQ are not two subjects, they
 * are the top and the bottom of one page somebody wrote in one sitting. The
 * sections still fetch their own *data* (the slideshow, the events, the board,
 * the sponsors); this is the writing around it.
 *
 * `FRONT_PAGE_COPY` below is why the row may be absent. Every other singleton on
 * this API can be empty because empty is a state its page is built for — no fine
 * print under the tier grid, no lab status ever set. A landing page with no
 * headline is not one of those, and a database that has only just been migrated
 * is exactly where that would show up. So the shipped wording is the floor, and
 * an officer's first save replaces it.
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
      // `sortOrder` is dense but not unique — the reorder route rewrites the
      // whole block in one transaction — so `createdAt` is what makes a
      // half-applied write a deterministic order rather than a random one.
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: faqSelect,
    }),
    prisma.partnerProgram.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: partnerSelect,
    }),
  ])

  // Both lists may be empty and both sections are built for it: the FAQ prints
  // its heading and the contact form beside it, and the partner section takes
  // itself off the page entirely. Neither is a failure the browser has to tell
  // apart from a request that did not land.
  return c.json({ ...(copy ?? FRONT_PAGE_COPY), faqs, partners })
})

// ------------------------------------------------------------- the about page

/**
 * What `/about` says about the club.
 *
 * The same shape and the same reasoning as the front page above: one read for a
 * page that is one document, and a floor under the singleton so a freshly
 * migrated database serves the page rather than a heading-shaped hole.
 *
 * **`storyNotice` being null is the club having written its own history.** The
 * page carried that admission as a hardcoded panel, which meant the only way to
 * retire it was a deploy — so an unwritten history and a written one looked the
 * same to everybody except the person who could tell the difference.
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
