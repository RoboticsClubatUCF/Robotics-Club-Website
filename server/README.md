# RCCF server

Postgres 18 in Docker, Prisma 7, and a Hono JSON API.

## Setup

```bash
cd server
cp .env.example .env    # then fill in POSTGRES_PASSWORD and DATABASE_URL
npm install
npm run db:up           # starts Postgres, waits for healthy
npx prisma migrate dev  # applies migrations + regenerates the client
npx prisma db seed      # optional placeholder content
npm run dev             # API on http://localhost:4000/api
```

## Running it locally

Every command below is run from `server/`, and assumes Postgres is already up
(`npm run db:up`). None of them start the database for you.

| What                | Command                        | Where                  |
| ------------------- | ------------------------------ | ---------------------- |
| Postgres            | `npm run db:up`                | localhost:5433         |
| API                 | `npm run dev`                  | http://localhost:4000/api |
| Data GUI (Prisma)   | `npm run studio`               | http://localhost:5555  |
| Admin GUI (pgAdmin) | `docker compose --profile tools up -d` | http://localhost:5050 |

### `npm run dev` — the API

Runs `tsx watch src/index.ts`: the server restarts on every save, no build step.
It holds the terminal until Ctrl+C. Use `npm start` for a single run without the
watcher — that's what the container does.

The port comes from `PORT` in `.env` (4000 by default). Quick check that it came
up, and that it can reach the database:

```bash
curl http://localhost:4000/api/health
# {"status":"ok","database":"up"}
```

A `"database":"down"` here means the API is fine but Postgres isn't reachable —
run `npm run db:up`.

### `npm run studio` — the data GUI

An alias for `prisma studio`. Prisma ships a small web app that reads
`schema.prisma` and gives you a spreadsheet-style view of every model: browse
rows, edit cells, add and delete records, and click through relations (open a
project, jump straight to its teams). It serves on **http://localhost:5555**
and opens a browser tab itself.

It runs in the foreground; Ctrl+C stops it. It must be started from `server/`,
since that's where the schema and `DATABASE_URL` live.

This is the one to reach for day to day — checking what the seed created, fixing
a typo in a member's title, clearing a spam contact message. It only knows what
is in the Prisma schema, so it can't show you indexes, query plans, or roles.

### pgAdmin — the admin GUI

Defined in `docker-compose.yml` but behind a profile, so it does *not* start with
the database:

```bash
docker compose --profile tools up -d     # start
docker compose --profile tools down      # stop
```

Open **http://localhost:5050** and sign in as `admin@example.com` / `admin`.
Those are compose defaults, not values in `.env` — set `PGADMIN_EMAIL` and
`PGADMIN_PASSWORD` there to override them. If you change the email, don't use a
`.local` domain: pgAdmin validates the address against reserved TLDs and
crash-loops on startup rather than reporting a clear error. Then
register the server — the connection details are *not* the ones you'd use from
Windows:

| Field    | Value      | Why                                                     |
| -------- | ---------- | ------------------------------------------------------- |
| Host     | `postgres` | The compose service name. pgAdmin connects from inside the Docker network, so `localhost` would mean the pgAdmin container itself. |
| Port     | `5432`     | The container's own port. 5433 is only the host mapping. |
| Database | `rccf`     | `POSTGRES_DB`                                            |
| Username | `rccf`     | `POSTGRES_USER`                                          |
| Password | see `.env` | `POSTGRES_PASSWORD`                                      |

Use this when you need actual database work: writing SQL, inspecting indexes and
query plans, checking enum ordering, managing roles.

### psql — fastest for a one-off query

No GUI, no container to start:

```bash
docker exec -it rccf-v13-postgres psql -U rccf -d rccf
```

`\dt` lists tables, `\d users` describes one, `\q` quits.

### Pointing these at a deployed database

All three are clients: they need a connection string, not an install on the
server. `docker-compose.yml` publishes Postgres on the host's `POSTGRES_PORT`,
so reading a deployed database is a URL and a route to it. Studio takes one on
the command line, and that is the flag to use:

```bash
npm run studio -- --url "postgresql://USER:PASSWORD@HOST:5433/rccf?schema=public"
```

**Never put a deployed URL in `.env` instead.** Prisma takes the datasource from
`prisma.config.ts`, which reads that file — and so does Vitest. The backend
suite runs against whatever database it finds, and its sweep tests select every
*candidate row* rather than a fixture's, so a production URL left in `.env` is
one `npm test` away from writing to real people. `--url` overrides the datasource
for a single process and leaves nothing behind to forget about.

**Reach it over an SSH tunnel unless that port is already private.** Publishing
5433 on `0.0.0.0` means anything that can route to the host may try the password;
binding it as `127.0.0.1:5433:5432` closes that off and leaves tunnelling
working.

```bash
ssh -N -L 5434:localhost:5433 user@host
```

Then point the URL at `localhost:5434`. **The local end must not be 5433**,
whatever else it is: 5433 is your own development Postgres, so a tunnel that
quietly failed to open leaves the identical command connected to seed data,
which looks close enough to real to edit for a while before anything says
otherwise.

**Check out the commit the server is running, first.** Studio reads
`schema.prisma` rather than the database, so a working tree ahead of what is
deployed asks for columns that do not exist there and every table errors on
open.

**Take a dump before editing anything.** Studio commits a cell when it loses
focus: no confirmation, no undo, and nothing recording who changed what.

```bash
docker exec <postgres-container> pg_dump -U rccf rccf > backup.sql
```

**Most columns worth reaching for have a machine writer, and it wins.** `role`,
`active` and `officerAlumnus` are owned by the dues loop and the Discord syncs
described under [People and roles](#people-and-roles), all of which run on the
ten-minute timer — so `role` set to `MEMBER` by hand is undone by the next
sweep, and `duesPaidThrough` is what actually decides. `ADMIN` is the one value
on that ladder nothing in the codebase writes or clears in either direction,
which is the edit Studio is genuinely for. Comping a term is the officer roles
desk rather than a date typed into `duesPaidThrough`: `grantMembership` writes
the zero-amount payment, the promotion and the record of who granted it, and the
hand edit writes none of those. Clearing `surveyCompletedAt` locks nobody out —
it puts the dashboard's survey prompt back up and drops that person back into
the officer desk's "still to go" count.

**When Save appears to do nothing, it is a rejected write rather than a dead
button** — Studio puts the old value back without surfacing the error. The
response body of the failing request carries the message; devtools → Network on
the Studio tab is where to read it. Correcting somebody's address is the common
case: `email` is `String? @unique`, and a second account the same person made
already holds it. Clear it there first — the column is nullable and Postgres
allows any number of NULLs under a unique index.

Two further things about that column. **Store it lowercase**: the unique index
is case-sensitive `TEXT` while signup, login and the account route all lowercase
before querying, so a capitalised address is a row nobody can sign in to and
nothing anywhere reports as wrong. And **a pending `EmailChange` overwrites it**
when its link is followed, so delete that row when fixing an address by hand.

psql above is the way through a write Studio will not take. `updated_at` is
`NOT NULL` with no database default — Prisma is what sets it — so a raw `UPDATE`
has to write `updated_at = now()` itself or leave a timestamp that lies.

## People and roles

**There are two role systems, and telling them apart is the whole model.**
`UserRole` says what somebody is *in the club*; `ProjectMemberRank` says what
they run *inside one project*. A third thing, `duesPaidThrough`, says whether
their membership is current. Confusing any two of them is the bug class this
section exists to prevent.

There is one `users` table for everyone the site knows about — the roster, the
people who can sign in, and anyone who has only signed up. `UserRole` is a
single ladder, most permission to least, and it has four values:

| Role      | Is                                               |
| --------- | ------------------------------------------------ |
| `ADMIN`   | Full control, and exempt from the dues gate       |
| `OFFICER` | Club leadership: captain, treasurer, and so on    |
| `MEMBER`  | Has joined the club                               |
| `GUEST`   | Signed up, nothing granted yet — **the default**  |

It carried four more until the two systems were separated. `PROJECT_LEAD` and
`TEAM_LEAD` were roster labels spelled identically to `ProjectMemberRank`'s
values and granting nothing, kept in step with the real ranks by a whole file
(`src/rosterLabel.ts`, now deleted); `MENTOR` and `ALUMNUS` said things
`User.title` and `User.active` already say. All four now read `MEMBER`.

Joining the club is account signup, not a form submission — someone signs up,
lands at `GUEST`, and is promoted from there. **Dues are what move somebody up
and down this ladder**, and the loop has two halves:

- **Paying, or claiming the free summer/break, promotes a `GUEST` to `MEMBER`**
  and stamps `joinedAt`, in the same transaction that moves `duesPaidThrough`.
  Both paths go through `membershipUpdateFor` in `src/routes/member/dues.ts`, and
  neither ever overwrites a role an officer chose or invents a `slug`.
- **A lapsed `MEMBER` goes back to `GUEST`, live.** `demoteIfLapsed` runs inside
  session resolution, so it lands on their next request; `sweepLapsedMembers` on
  the ten-minute timer is the backstop for everybody who has stopped turning up.
  Both: only `MEMBER`, only accounts with a payment on record, and the sweep
  never runs when UCF's calendar could not be read.
- **An officer gains the role live, and loses it on the sweep.**
  `refreshOfficerStanding` in `src/discord/discordOfficers.ts` asks Discord about the
  one account that is signing in, and about the one behind `/api/auth/me` — the
  read every page of a signed-in browser makes — so somebody handed the officer
  role in Discord has their desks by their next page load rather than within
  ten minutes. It **only promotes**: from a single member's role list, a
  mistyped role id, a deleted role and somebody who was never an officer are
  identical, so demotion stays with `syncDiscordOfficers`, which sees the whole
  guild and has four refusals built on exactly that. It costs one member lookup,
  throttled to one per person every five minutes and skipped outright for anyone
  already an `OFFICER` or `ADMIN`.
- **Who used to run the club comes off Discord too.** `src/discord/discordAlumni.ts`
  reads the guild's **Officer Alumni** role into `User.officerAlumnus` on the
  same tick, which is what `/members?status=alumni` answers with. Deliberately
  not `active` — that column means "still around" and `membershipUpdateFor`
  writes it back to true on every payment, so a sweep owning it too would make
  the two undo each other every ten minutes; and somebody can be a paid-up
  member *and* an officer alumnus. It refuses in the officer sync's three ways
  plus a fourth: a sweep that would clear every alumnus and mark nobody stands
  down. **Never list its id among the roles below** — it sits under the bot in
  the hierarchy, so unlike Officers nothing at Discord's end would refuse.
- **And the Discord roles follow, in the other direction.** `src/discord/discordRoles.ts`
  gives out the Members, Project Leads and Team Leads roles plus each project's
  own — `Project.discordRoleId` — on the same ten-minute tick, chained *after*
  the two sweeps above so Postgres has settled before Discord is told. The
  Officers role goes the opposite way and the site never writes it
  (`src/discord/discordOfficers.ts`). Each role id is independently optional and unset
  means never touched; a guild member the site cannot match to a `User` row is
  never written to at all; and `DISCORD_ROLE_SYNC_DRY_RUN` names every change
  without making one. The Members role is the literal `duesPaidThrough` date,
  which is now exactly what `membershipStanding().hasAccess` means — this file
  got there first and the rest of the site came to meet it.

**There is one gate and it is dues.** There were briefly two: `requireSurvey`
ran as the first statement of `requireCurrentDues`, so nothing opened — the dues
page included — until `User.surveyCompletedAt` was set, which meant the club
could not take somebody's money before it had their shirt size. That gate is
gone, and **nothing refuses an unanswered survey**. The dashboard asks instead:
`GET /api/dues/status` carries `surveyPending` and `surveyPromptDismissed`, and
`POST /api/survey/dismiss` is the *don't ask me again* checkbox on the prompt.

**The role is not the gate; the standing is.** What somebody may *do* is decided
by `membershipStanding` at the moment of the request. With dues owed the
dashboard is `/api/dues/*` and `/api/me/*` — your payment page and the projects
you are already on — and everything else is refused: 3D printing, equipment
borrowing and every management tool. See `requireCurrentDues` and
`requireDuesForRoute` in `src/auth/authz.ts`. A lapsed lead or officer keeps their
rank and loses the tools. `ADMIN` is exempt, always. `discordUsername` hangs off the same row for the Discord
integration.

Two things follow from that, and both are easy to get wrong:

- **Declaration order is load-bearing twice.** It is the permission ranking, and
  because Postgres sorts an enum by declaration order it is also the roster
  display order that `orderBy: { role: 'asc' }` depends on.
- **A slug is a profile page, not a place on the roster.** `slug`, `email` and
  `passwordHash` are all optional: a roster entry may have no login, and a login
  may have no roster entry. `GET /members` lists **every** user, guests
  included; the only filter is the ALUMNI one the page offers, which reads
  `officerAlumnus` — the club's Discord Officer Alumni role, mirrored in by
  `syncOfficerAlumni`. Deliberately **not** `active`: that column means "still
  around", `membershipUpdateFor` sets it back to true on every payment, and
  somebody can be a current member *and* an officer alumnus.

  It used to want a slug *and* a role above `GUEST`, and nothing generates a
  slug — so the public page listed sixty of six hundred and eighty-eight
  accounts with no way in the product to add the sixty-first. What a slug still
  buys is `GET /members/:slug`, and it is still set by hand, because giving
  somebody a page of their own is a decision for a person.

  **The one query that still narrows people is `activeMembers`** — `active` and
  not `GUEST` — which is the landing page's headline count. Its cell is labelled
  ACTIVE MEMBERS rather than MEMBERS precisely because it no longer matches the
  length of the page it links to.

### Project roles are the other system

Only `ADMIN` and `OFFICER` grant anything through `UserRole`, and even they
grant it by being the club's officers rather than by saying anything about a
project. Everything about running a project — editing it, making teams,
appointing team leads, scheduling, assigning tasks — is decided by
`ProjectMember.rank`, scoped to one project by the join table's primary key:

| Rank           | May                                                              |
| -------------- | ---------------------------------------------------------------- |
| `PROJECT_LEAD` | Everything inside that project: teams, ranks, events, tasks, the project itself |
| `TEAM_LEAD`    | Their own team's roster, events and tasks — and nothing outside it |
| `MEMBER`       | Read the project, and move tasks assigned to them between labels |

**A task belongs to a project or to a person, and the second kind is the
officers'.** `POST /api/tasks` writes one with no `projectId` — the club's own
work rather than any build's — and refuses everybody below an officer, because
a lead's authority is derived from a membership row and there is none to read.
It must name an assignee: with neither a project nor a person a task belongs to
nothing and appears on no page.

**A project has at most one `PROJECT_LEAD`, and any number of `TEAM_LEAD`s.**
Zero leads is normal — the board agrees to run something before it settles who
runs it, and the lead of a project may walk out without a replacement lined up.
The single-lead rule is enforced by `PATCH /api/officer/projects/:id/members/:userId/rank`,
which answers **409 naming the incumbent** rather than swapping them out; the
officer stands that person down first. It is not a database constraint, because
Prisma cannot express a partial unique index and the next generated migration
would drop one.

Who appoints whom: **project leads are appointed by officers and admins only**;
**team leads by the project lead inside their own project**, through
`PATCH /api/projects/:id/members/:userId` — which officers reach as readily,
because `requireProjectLead` returns early for them.

Somebody leading Project S.T.O.R.M. is a plain member on SumoBots and gets a 403
there. No value of `UserRole` says anything about any project. `src/auth/authz.ts` is
the only place any of this is decided, and `src/auth/authz.test.ts` is the matrix
that keeps it honest.

`ProjectMember.title` beside it is free text — "Software Lead" — and grants
nothing. It is the project-scoped twin of `User.title`, and it was called `role`
until these two systems were told apart.

Projects themselves are created by officers, who may name the first lead in the
same request. That is the whole audience: a `PROJECT_LEAD` roster label briefly
bought the right to start one project of your own, and both the label and the
delegation are gone.

## API

Read routes are public and filter out anything unpublished. The write routes are
rate limited per IP per 10 minutes: 5 for anything that costs something — an
email sent, an account created — and 30 for the ones a page calls on the
visitor's behalf while they are still working, such as the Discord handle check
and `/dues/sync`.

Sign-in is the exception, at 20 per caller and **10 per account**. A login is a
whole building behind one campus address, so a per-caller limit of five would
bite a lecture theatre and not one attacker; the budget that actually protects
somebody is the one keyed on the account being guessed at, because a password
sprayed across every account in turn never trips a per-IP limit.

| Route                    | Notes                                              |
| ------------------------ | -------------------------------------------------- |
| `GET /api/health`        | Also pings the database                             |
| `GET /api/stats`         | The landing page's counts. Each equals the listing it links to; `members` is `activeMembers` (active, not `GUEST`), which is what `GET /api/members` defaults to and why that cell reads ACTIVE MEMBERS |
| `GET /api/members`       | **The club's active membership by default**; `?status=alumni` is the Discord **Officer Alumni** role (`officerAlumnus`) or a closed `OfficerTerm`, `?status=all` is every account, guests included. The first two overlap — a paid-up past president is on both. Also `?role=`. Carries `profileUrl`, where the card's photograph points — allowlisted on the way in, so it is safe in an `href`. `limit` runs to 1000 here rather than 100 — the page searches by name in the browser, which only works if one request carries the whole club |
| `GET /api/officers`      | `{ seats, officers }` — the seats there are, and who is in one. `photoUrl` is coalesced server-side and the **linked account's wins**, with the term's own as the fallback for a row with nobody behind it; `profileUrl` comes off the same account, so the card's photograph can be a link |
| `GET /api/officers/past` | The archive. `?years=` (default **2**) `&all=1`. Answers `{ terms, older }` |
| `GET /api/members/:slug` | Adds the member's projects                          |
| `GET /api/projects`      | `?status= &season= &featured=true &term=current\|other &cover=true &images=true &description=true`. `term` is resolved against the academic calendar rather than named by the caller — a page that hard-coded a term goes quietly empty every August — and **`other` is the negation of `current`, not everything before it**, so a build stamped for a term that has not started lands on the archive rather than on no page at all. `other` comes back newest term first. Three opt-in flags, because this answers up to a hundred rows: `cover=true` adds the gallery **capped at one row**, which is what a card draws; `images=true` adds the whole gallery and wins over `cover` when both are sent; `description=true` adds the write-up. **`/projects` asks for `cover` alone** — a card is a still and the line its lead wrote, and `summary` is the column the schema means for exactly that. The cover columns themselves (`coverUrl`, `coverFromGallery`, the framing) and the section headings ride on every row, because `coverOf` in the browser reads them together and a flag that sent half would make the list and a project's own page disagree about one picture |
| `GET /api/projects/:slug`| Adds description and the credited members           |
| `GET /api/events`        | `?when=upcoming\|past\|all &type= &from= &to=` — published rows only, **plus the project meetings** `src/projects/meetings.ts` expands. Meetings are merged in only when **both** `from` and `to` are given: a recurrence has no answer to "the next 50 events", so a bare `?when=upcoming` still gets stored rows and `limit`/`offset`/`GET /stats` keep meaning what they meant. A meeting shows here only if its project has `meetingsPublic`; it repeats to the end of the project's term and skips finals week. Its `id` is prefixed `meeting:` — **there is no row behind it**, so nothing may `PATCH` or `DELETE` one |
| `GET /api/events/:slug`  | Published only                                      |
| `GET /api/posts`         | Published and not future-dated; no body             |
| `GET /api/posts/:slug`   | Adds the body                                       |
| `GET /api/sponsors`      | `?tier=` — active only, ordered by tier. Hidden rows (`active: false`) are a sponsorship that has run out, kept on the officer desk and off both public lists |
| `GET /api/sponsorship`   | `{ tiers, inKind, footnotes }` — what a level costs, what a sponsor can give that is not money, and the fine print under the grid. **Only the tiers somebody has written**: this was four hardcoded objects in `web/src/content/sponsorship.ts` marked PLACEHOLDER, and an unpriced level is now absent rather than quoting a figure nobody agreed to. `blurb` is null on most of them — the club's sheet is an amount over a list of what you get, with no sentence between. Ordered by the enum, which is the club's ranking. No paging — four levels and at most six of the other thing |
| `GET /api/hero-slides`   | The photographs beside the landing page's headline, in the order officers set. No paging and no filter — it is one curated list capped at eight, and the browser wants all of it to run the slideshow. **An empty array is a real answer**: the hero draws the rings and the wireframe trace it had before this table existed, so the page never has to tell "none yet" from "the API is down" |
| `GET /api/front-page`    | What the landing page **says**: `{ headline, headlineAccent, lede, partnersIntro, faqs, partners }`. One read for the whole page's copy, because it is one document somebody wrote in one sitting — the browser makes it once, in `HomePage`, and hands each section its slice. The headline is two fields because the break between them is a `<br>` the hero's type scale is tuned around. **The copy is never empty**: `front_page` is one row keyed `current` and may be absent, and rather than serve a blank headline this answers with the wording the site shipped with until an officer saves over it. Both lists may be empty and both sections are built for it — the partner section takes itself off the page entirely |
| `GET /api/about`         | The whole of `/about`: the heading, the lede, the story, the address and the timeline. Same shape of answer and the same floor under the singleton as the front page above. **`storyNotice` is the club's own admission that the history is placeholder text**, and null is what finishing it looks like — it was a hardcoded panel in the component until this table existed, so the only way to retire it was a deploy |
| `GET /api/lab`           | `{ open, changedAt, buildingOpen }` — is the lab open. `open` is **already masked by the building's hours** (8am–10pm Orlando time), so it is the answer to act on rather than the row; `buildingOpen` is what tells "nobody has opened it" from "nobody can". **Not in the cached half of the API**: it carries its own `s-maxage=30`, because a five-minute-old answer to this is the one that sends somebody across campus for nothing. `changedAt` is null until an officer has flipped it. Never says *who* — that is in the database and in the club's own Discord channel, not on an endpoint anybody can read |
| `POST /api/contact`      | `{ name, email, subject?, message }` → 201          |
| `POST /api/signup/start` | `{ email, acknowledged }` → 202, and emails a link   |
| `POST /api/signup/verify`| `{ token }` → `{ email }`                           |
| `POST /api/signup/discord-check` | `{ discordUsername }` → `{ status }`        |
| `POST /api/signup/complete` | `{ token, firstName, lastName, password, discordUsername, acknowledgementAccepted }` → 201 |
| `POST /api/auth/login`   | `{ email, password }` → `{ user }`, and sets the session cookie |
| `POST /api/auth/logout`  | Ends the session; works from a stale cookie too      |
| `GET /api/auth/me`       | `{ user }` or `{ user: null }` — **200 either way**  |
| `POST /api/auth/password/forgot` | `{ email }` → **202 whatever it finds**. A different answer for an unknown address would make this a membership lookup, one address at a time. Two budgets, and the tighter one is keyed on the *address*, because this endpoint sends mail to somebody else's inbox. Works for a roster entry that has never had a password — that is how one becomes a login |
| `POST /api/auth/password/reset`  | `{ token, password }` → 200. Expired, unknown and already-spent are one 410. Ends **every** session the account had: whoever is resetting has none to keep, and if somebody else got in, leaving them signed in is what this flow exists to prevent |
| `GET /api/survey`        | Signed in. **The questions the club is currently asking**, this member's answers or `null`, plus their `User.gradYear` so the form can pre-fill. **Never gated**, like everything else on this router — it reads and writes one person's own answers, and the club would rather have a shirt size from somebody who has stopped paying than not. A question's options are the live ones **plus any this member picked before it was retired**, flagged `retired`: a write replaces every answer, so an option the form could not draw would be dropped on the way past |
| `POST /api/survey`       | Signed in. `{ answers, gradYear }`. Answers it, once. Stamps `User.surveyCompletedAt`, clears `surveyPromptDismissedAt` and writes `gradYear` in the same transaction; **409** if it is already set. **Sending an entry at all is what "answered" means** — a tick-any question with a NONE box is answered by an *empty* `optionIds`, so a required question that was left out entirely is a **400** naming it |
| `POST /api/survey/dismiss` | Signed in. The **don't ask me again** checkbox on the dashboard's survey prompt: stamps `User.surveyPromptDismissedAt`, and the dashboard stops raising the dialog and drops the rail's MEMBER SURVEY row. Idempotent — filtered on the null, so a second press does not move the first timestamp — and not a toggle: the way back is answering the survey, which clears it. The overview's panel and the account page's still offer the form |
| `PUT /api/survey`        | Signed in. Corrects the answers afterwards, from `/dashboard/survey` or the account page's SURVEY panel. Deliberately does **not** move `surveyCompletedAt` — being *asked* once is the promise, not being stuck with a shirt size, and **an officer adding a question does not move it either**. `gradYear` is **optional** here and required on the `POST`: the account page's ABOUT YOU panel owns that field, so the survey panel beside it sends no year, and an absent one means "leave it alone". **409** when there is nothing to leave alone — no year sent and none on file would save a survey with a hole in it, so it is refused with a sentence naming where to set one |
| `GET /api/dues/status`   | Signed in. Membership, prices, coverage dates, history. Also carries `surveyPending` and `surveyPromptDismissed`, which are not facts about dues and ride here because this is the one call the dashboard rail makes on every page. **Neither locks anything** |
| `POST /api/dues/checkout`| Signed in. `{ plan: SEMESTER\|YEAR }` → a Stripe payment intent |
| `POST /api/dues/sync`    | Signed in. `{ paymentIntentId }` → asks Stripe how it went |
| `POST /api/dues/activate`| Signed in. Claims the free summer or between-terms break — promotes a `GUEST` to `MEMBER`, same as paying |
| `POST /api/stripe/webhook` | Stripe's own deliveries. Signature-verified, never authenticated |
| `POST /api/discord/interactions` | Somebody pressing the button under the lab sign — **only when the application has an Interactions Endpoint URL registered.** Without one, presses arrive down the gateway instead (`src/discord/discordGateway.ts`) and this route is never called; the two are mutually exclusive by configuration. Signature-verified (Ed25519 over the raw body, `DISCORD_PUBLIC_KEY`), never authenticated, and **401 on a bad signature is Discord's requirement** — it probes a new endpoint URL with a deliberately invalid one and will not save the URL unless that is the answer. Only officers may press, checked against `DISCORD_OFFICER_ROLE_ID` on the interaction itself or against the site's own role; **dues are deliberately not checked**, unlike `PATCH /api/lab`. Everything it says back is ephemeral — the refusal, the curfew, the rename cooldown. Discord allows three seconds, so a press that needs work is deferred and answered with a private follow-up |

Then the dashboard's own surfaces. Every one of them is signed in, answers
per-caller, and is mounted **before** the public routes in `src/app.ts` so the
shared-cache headers never touch them.

| Route                    | Notes                                              |
| ------------------------ | -------------------------------------------------- |
| `GET /api/account`       | The editable profile, plus `passwordSet` and `pendingEmail` — two facts the page needs and cannot derive. Never the password hash |
| `PATCH /api/account/profile` | `{ fullName, bio, gradYear }` → `{ user }`. All three are on the public roster, which is why they are the member's own. `title` and `slug` are not here: a club title is the board's to award, and a slug gives somebody a profile page of their own |
| `PATCH /api/account/profile-link` | `{ profileUrl }` → `{ profileUrl }`, null to clear. Where the member's photograph points on `/members` and the officer board. **The only column an ordinary member writes that ends up in an `href` on a public page**, so it is checked against an allowlist of known platforms — `socialUrl` in `src/core/validate.ts` — rather than merely parsed; `javascript:`, credentials in the authority and a lookalike host are all refused. Its own route rather than a fourth field on `/profile`: it is a separate decision with a separate save, and the one here that can be refused on its content. Answers with the stored address rather than `{ user }`, since nothing on the session draws it |
| `POST /api/account/discord-check` | Signup's check with the caller excused — otherwise re-saving your own handle is refused by yourself. Which row to excuse comes from the session, never from the body |
| `POST /api/account/discord` | `{ discordUsername }` → `{ user }`. Signup's refusals exactly: `not_found` is 422, `unavailable` is 503 rather than a guess. Stores Discord's own spelling and the snowflake when it answered; leaves `discordId` alone when no bot is configured, since renaming does not change the account |
| `POST /api/account/photo` | Multipart image, sniffed and size-capped like a project cover; replacing deletes the old upload. **Takes `focalX`/`focalY`/`zoom` in the same body**, because the browser frames the picture *before* sending it — an avatar replaces, so a mis-picked file has to cost nothing until somebody has looked at it, and framing arriving as a second request could fail on its own and leave the new photo cropped by the old one's numbers. Framing is written every time, defaults included: a new photo must not inherit a crop chosen against a different picture |
| `PATCH /api/account/photo` | `{ focalX?, focalY?, zoom? }` — move the crop on the photo already on file, with no bytes sent. The other half of framing being metadata rather than a crop baked in. Each field applies only when sent, so adjusting zoom alone cannot silently re-centre a photo. 409 when there is no photo |
| `DELETE /api/account/photo` | Removes it and its stored bytes, and resets the framing — those numbers belong to a picture that is gone |
| `POST /api/account/password` | `{ currentPassword, newPassword }` → 200. Ends every *other* session and keeps this one — signing this browser out would answer "change my password" with a login form |
| `POST /api/account/email` | `{ password, email }` → 202, and mails the **new** address. Nothing moves until the link is followed: a typo written straight onto an existing account is a member locked out of a site they belong to. No `@ucf.edu` rule, unlike signup — hand-entered roster accounts are real logins on other domains |
| `POST /api/account/email/confirm` | `{ token }` → `{ user }`. **Deliberately unauthenticated**: the token is the proof and it arrives in an inbox, usually on a phone that has never signed in here |
| `DELETE /api/account`    | `{ password }` → 200. Refused while club equipment is out, or while an officer term is open — both are cases where deleting leaves the club holding a problem it cannot see. Everything else cascades, and the route deletes the stored files the account still points at by hand, because `StoredFile.createdById` is `SetNull`. Site-managed Discord roles are stripped from the snowflake read *before* the delete, since nothing afterwards can match a row that is gone |
| `GET /api/me/projects`   | My memberships: project, rank, team                 |
| `GET /api/me/events`     | `?from= &to=` — published events plus my projects' unpublished ones, plus the project meetings I should see: every public one and every one on a project of mine. Officers get every *event* here and not every *meeting* — an unpublished event is a thing awaiting their decision, a meeting on a project switched off the public calendar is a settled answer. Same window rule as the public route |
| `GET /api/me/tasks`      | `?scope=mine\|managed\|all &status=open\|all &limit=` — my tasks, the ones I run, or both. `scope=managed` is `manageableTaskFilter` in `routes/projects/tasks.ts`, the same rule `requireTaskManager` enforces per row, so the page cannot offer an EDIT the server then refuses. **`status=open` means not DONE and not CANCELED**, which is what "open" means now there are five labels; the overview card takes the defaults |
| `GET /api/me/print-requests` | Mine, newest first. `fileId` is null once settled |
| `GET /api/me/print-allowance` | Grams left for my own prints this term. Counted, never stored |
| `GET /api/me/loans`      | What I have borrowed and asked for                  |
| `POST /api/projects/:id/join` | Refused unless `membershipStanding().hasAccess` |
| `DELETE /api/projects/:id/members/me` | Leave. **Including the only project lead**, which leaves the project leaderless and DMs the officers so somebody knows — the old refusal told them to have an officer appoint another first, which nothing can satisfy now a project has one lead. Writes no roles at all: leaving changes what you run, not what you are |
| `GET /api/projects/:id/team` | Members-only. Teams and roster, no email addresses |
| `PATCH /api/projects/:id` | Project lead. Slug and `featured` are not editable. Takes the meeting schedule — `meetingWeekdays`, `meetingStartTime`, `meetingEndTime`, `meetingLocation` — and holds the days-and-times-together rule against the **resulting** row, so clearing half of one is a 400; an empty `meetingWeekdays` with both times null clears it outright. `meetingsPublic` is accepted here and **refused from a non-officer**, the same split as `published` on an event: a lead sets when the project meets, an officer decides whether the front page carries it. Accepts `discordRoleId`, which is the one field here that changes something outside this site — setting it hands the role to every member of the project and clearing it takes it back, so the route pushes all of them straight away rather than waiting for the sweep. Also takes the cover — `coverUrl`, `coverFromGallery` and the three `cover*` framing fields — and the three per-project section headings. Answers with `managedProjectSelect` **plus `description`** — the editor rebuilds its state from the write rather than re-reading the publicly cached page, so a column this route accepts and does not answer with comes back `undefined` and leaves the form permanently unsaved |
| `POST /api/projects/:id/cover` | Project lead. Multipart image; replaces and deletes the old upload |
| `POST /api/projects/:id/images` · `/images/upload` | Project lead. The public page's gallery, by URL or as a file. Capped at 12 a project; uploads are sniffed and size-capped, and the browser shrinks them first. Both take `focalX`/`focalY`/`zoom` **at add time** — a gallery assembled on the create page is framed before the project exists, and framing arriving separately could fail on its own and leave a photo sitting wrong. The upload reads them off the multipart body, ignoring anything unparseable |
| `PATCH /api/projects/:id/images/order` | Project lead. The whole order, as a list of ids — refused unless the set matches exactly, which is what stops one tab dropping another's newest photo |
| `PATCH`/`DELETE /api/projects/:id/images/:imageId` | Project lead. Caption and framing (`focalX`/`focalY`/`zoom` — CSS at display time, never baked into the file), or removal. Every field is applied only when sent, so a caption edit cannot re-centre a framed picture. Removing an upload deletes the file with it |
| `PATCH /api/projects/:id/links` | Project lead. The `/ RESOURCES` list, replaced wholesale. Max 10; an empty array clears it |
| `DELETE /api/projects/:id` | Project lead. Sweeps every uploaded gallery picture as well as the cover |
| `POST /api/projects/:id/teams` · `PATCH`/`DELETE /api/teams/:id` | Project lead |
| `PATCH`/`DELETE /api/projects/:id/members/:userId` | Project lead. Rank up to `TEAM_LEAD` only — and **this is the route officers use to appoint a team lead too**, since `requireProjectLead` waves them through. `title` is the free-text display string, renamed from `role`; zod strips unknown keys, so a caller still sending `role` gets a 200 that stores nothing |
| `POST`/`DELETE /api/teams/:id/members/:userId` | Team lead, own team, plain members only |
| `POST /api/events` · `PATCH`/`DELETE /api/events/:id` | Leads, and officers. Where the event hangs decides the rank: a team's lead, a project's lead, or — with **no `projectId` at all** — an officer, which is the club's own calendar and what the events desk is largely for. Created unpublished whoever made it, and only officers may publish. `registrationUrl` is settable by anybody who may write the event — it was readable and unsettable for a long time, so the only rows carrying one were the seed’s. Edits cannot move an event between projects: that is a delete and a create, which keeps the permission question one-dimensional |
| `GET`/`POST /api/projects/:id/tasks` · `PATCH`/`DELETE /api/tasks/:id` | Leads, scoped to their team. **`POST` refuses a project that is not running this semester** — 409 naming both terms, checked before any permission is read, so a lead of last term's build gets the sentence about the calendar rather than one about their rank. `PATCH`, `DELETE` and the status route are unaffected: closing out work already on a finished board is how a semester ends |
| `POST /api/tasks` | **Officers only.** A task belonging to no project — the club's own work. At least one assignee, refused otherwise on this route *and* on the edit route, since that one can empty a list this one insisted on |
| `POST /api/tasks/:id/status` | Assignees **and** leads — the one looser check. Five labels now (`OPEN`, `IN_PROGRESS`, `DELAYED`, `DONE`, `CANCELED`), and an assignee may set any of them: somebody asked to do something is entitled to say it is not going to happen, and CANCELED on a row the lead can see is how they say it. Only `DONE` stamps `completedBy`/`completedAt`; every other label clears the pair, cancelling included |
| `POST /api/tasks/:id/calendar` | `{ onCalendar }`. **Assignees only, and it is per person** — a lead may put work on somebody's list, not in their week. A non-assignee matches no row and gets a 403 rather than a 404 that would confirm the task exists. Opted-in deadlines appear on that member's `/api/me/events` as `task:…` entries and reach no other calendar, public or otherwise |
| `POST /api/print` · `DELETE /api/print/:id` | **Members only** — a `GUEST` is refused whatever their standing. Multipart `.stl`/`.step`, size-capped, sniffed. Settings paired FDM/SLA; `quantity` 1–50, default 1; `projectId` needs a real membership |
| `GET /api/equipment`     | **Members only.** The catalogue with a live `available` count and each item's `maxLoanDays` |
| `POST /api/equipment/:id/loans` · `POST /api/equipment/loans/:id/cancel` | One open loan per person per item. `requestedDueAt` is **required**; `startAt` in the future makes it a booking. The window is refused past the item's `maxLoanDays` |
| `GET /api/files/:id`     | Images public and immutable; print models owner-or-officer, `no-store` |
| `POST /api/officer/projects` | Officers only, without limit. `summary` is required; `description` is accepted here because it is a column on the project, which is part of what lets the desk fill the whole thing in on one page — pictures and links are held in the browser and sent straight after, the repository among them now that it is a link rather than a column. `discordRoleId` is the crew's Discord role and goes through `assertUsableRole` before the write, which refuses two things. It must not be **one of the club's own roles** — Members, Project Lead, Team Lead, Officers, Officer Alumni: a project's role is added and removed as people join and leave it, so pointing one at a club-wide role takes it off the first person who leaves. And it must be **a role that exists**, since a mistyped snowflake is not an error at Discord and would match nobody for ever. The first is read off `env` and holds while Discord is down; the second is skipped during an outage, deliberately. **The meeting schedule is required here** — `meetingWeekdays` plus both times — unlike everywhere else it is optional: the columns went unfilled for months while this route ignored them, and a project’s meeting time is the one thing a prospective member actually wants. The edit route lets it be cleared |
| `PATCH /api/officer/projects/:id/members/:userId/rank` | Appoint or stand down a project lead, `PROJECT_LEAD` or `MEMBER`. **409 naming the incumbent** if the project already has a lead — stand them down first; re-appointing the sitting lead is a no-op 200. Writes no roles: appointing yourself as an officer costs you nothing by construction |
| `GET /api/officer/survey` · `GET /api/officer/survey/export.csv` | The member survey's results, in `routes/officer/surveyAdmin.ts` rather than `officer.ts`. The first is a tally per live question plus a `responded`/`outstanding` count, every option returned **including the zeroes** — a list that omits the sizes nobody picked reads as "we need none of those" — and a retired option too **when anybody picked it**, or the column would not add up. NONE is its own number rather than an option row, because there is no NONE option. The second is the raw rows, one column per question, with names and contact details: `no-store`, and every free-text cell starting `=`, `+`, `-` or `@` is apostrophe-prefixed, because that file gets opened in Excel |
| `GET`/`POST /api/officer/survey/questions` · `PUT`/`DELETE /api/officer/survey/questions/:id` | What the club asks. `PUT` takes the **whole** question including its ordered option list — options present by `id` are updated and un-retired, absent ones are retired if anybody picked them and deleted otherwise, and an `id` belonging to another question is a 400. **Changing `kind` once anybody has answered is a 409**: forty ticks against a question that now wants a sentence are forty rows nothing can render. `DELETE` answers `{ removed: 'archived' \| 'deleted' }` — archived whenever answers exist, because "stop asking this" is not "throw away what forty people told us" |
| `POST /api/officer/survey/questions/:id/restore` · `POST /api/officer/survey/reorder` | Restore puts a retired question back at the **end**, since its old position was vacated the moment anything else moved. Reorder takes the whole live set or nothing: a partial list would leave the questions it omits colliding with the ones it names, so a stale one is a **409** rather than a half-applied write |
| `POST /api/officer/hero-slides` · `POST /api/officer/hero-slides/upload` | The front page's slideshow, in `routes/officer/heroSlides.ts` rather than `officer.ts` — the framing helpers come from `projectManage.ts`, which imports from `officer.ts`, and putting these there would close an import cycle. By link or by file, the same split the gallery makes; framing may be sent **with** the picture, because the desk opens the framing tool the moment one lands. 409 naming the cap once eight are up |
| `PATCH /api/officer/hero-slides/order` | The whole order as a list of ids, **registered before `/:id`** or a reorder would be answered by the caption route. A list that is not the complete set is a **409**: this is one global list, so the two tabs that guard against are two different officers |
| `GET /api/officer/sponsors` | The whole sponsor page in one read — `{ sponsors, tiers, inKind }`, in `routes/officer/sponsorsAdmin.ts`. `sponsors` includes the hidden ones, which the public list filters out; **`tiers` carries one entry per level whether or not anybody has written it**, because the row an officer needs in order to publish a tier is exactly the one a filtered list would hide |
| `POST /api/officer/sponsors` · `PATCH`/`DELETE /api/officer/sponsors/:id` | Name collisions are **case-insensitive** and answered with what to do instead — two rows for one company is how a sponsor gets thanked twice on the front page. The PATCH schema carries **no** defaults, so `{ active: false }` cannot demote a top-tier sponsor on its way past. `active: false` is the ordinary way off the list and keeps the record; `DELETE` is for a typo |
| `POST`/`DELETE /api/officer/sponsors/:id/logo` | The logo as a file — upload *and* replace in one route, unlike the hero desk's remove-then-add, because a sponsor is a row that has a logo rather than a picture with a name. Same shape as `POST /api/account/photo`. A link goes through the PATCH above, which deletes the upload it replaces |
| `PUT`/`DELETE /api/officer/sponsors/tiers/:tier` | What a level costs. An upsert keyed on the tier in the path — one row per level, the enum is the key — and `PUT` rather than `PATCH` because a half-written tier is worse on a price list than an absent one, which also means **an omitted `blurb` clears the one that is there**. `DELETE` takes the level off the public sheet; **the row existing is the publication**, so there is no `published` column and no draft state |
| `PUT /api/officer/sponsors/sheet` | `{ footnotes }` — the fine print under the grid, on the one row there is. No id in the path because there is one sponsorship page: it upserts a row keyed `current` by a column default, the same singleton `PATCH /api/lab` owns. An empty string clears it, and clearing is normal — the grid printed no fine print before the row existed |
| `POST /api/officer/sponsors/in-kind` · `PATCH`/`DELETE /api/officer/sponsors/in-kind/:id` · `PATCH /api/officer/sponsors/in-kind/order` | The ways to help that are not money, capped at six. The order route takes the whole list and **409**s on a set that is not complete, for the reason the hero desk's does. All of these are registered **before** `/:id`, or `tiers` and `in-kind` are perfectly good holes for the wildcard to fall into |
| `PATCH`/`DELETE /api/officer/hero-slides/:id` | Caption and framing, each applied only when sent, so the framing tool and the caption box cannot flatten each other. There is no way to change `url` in place — replacing a photo is remove-then-add, which keeps `deleteIfStored` at two call sites. `DELETE` takes the bytes with the row when the photo was uploaded here, and leaves somebody else's hosting alone |
| `PUT /api/officer/front-page/copy` | The headline's two lines, the lede and the line above the partner cards, in `routes/officer/frontPage.ts` — the words half of the front-page desk, next door to `heroSlides.ts`, which owns the photographs. `PUT` rather than `PATCH` because the two headline lines read as one sentence and a request that could carry the second without the first is a half-written hero. It upserts the row keyed `current`; **there is no route to clear it**, because a landing page with no headline is not a state anything here is built for |
| `POST /api/officer/front-page/faqs` · `PATCH`/`DELETE /api/officer/front-page/faqs/:id` · `PATCH /api/officer/front-page/faqs/order` | The front page's questions, capped at twenty. The edit schema is **written out rather than `.partial()`ed** off the create one: `steps` carries a `.default([])`, and a partial would leave that default under an optional key — so a patch about the question alone would delete the procedure on its way past. The order route takes the whole list and **409**s on a set that is not complete, for the reason the hero desk's does, and is registered **before** `/:id` |
| `POST /api/officer/front-page/partners` · `PATCH`/`DELETE /api/officer/front-page/partners/:id` · `PATCH /api/officer/front-page/partners/order` | The programs for people the club cannot sign up, capped at six. `href` goes through `webUrl`, which adds a missing scheme and refuses `javascript:` — it is printed straight into an `href` on the landing page. **Emptying the list takes the section off the front page**, which is supported and which the desk says out loud |
| `POST`/`DELETE /api/officer/front-page/partners/:id/image` | The card's artwork as a file — upload *and* replace in one route, the sponsor logo's shape rather than the hero desk's remove-then-add, because a program is a row that has a picture rather than a picture with a name. A link goes through the PATCH above, which deletes the upload it replaces |
| `PUT /api/officer/about` | **The whole of `/about` in one body and one transaction**, in `routes/officer/aboutPage.ts`: the copy upserted onto the row keyed `current`, the timeline replaced. That is the only unfiltered `deleteMany` on this API, and it is safe because the request carries the whole timeline — what it deletes is what the next statement puts back, and a failure rolls both away. It is also why there is no `POST /milestones`: the editor is a form **on the public page**, with one SAVE and one CANCEL, and a line that wrote itself the moment it was dragged would mean CANCEL keeping half of what it just undid. The lab's four fields are nullable as a set; an empty box and an absent field both mean nothing to print, the map link included |
| `GET /api/officer/members` | `?query=` — the people picker. Matches name, email **and Discord handle**, because an account may carry a handle and no email |
| `GET /api/officer/print-queue?status=&all=` · `PATCH /api/officer/print/:id` | `all=1` returns every status, for the browser's search. Settling **deletes the uploaded model**. `gramsUsed` required for a personal DONE; `overAllowance` to go past the cap. Moving to `PRINTING` stamps `startedAt`, which is what later tells a cancelled print from a declined request |
| `GET`/`POST /api/officer/equipment` · `PATCH /api/officer/equipment/:id` | `maxLoanDays` defaults to 7 on create; the PATCH schema carries **no** defaults, so a partial edit cannot reset a field it did not name. Name collisions are **case-insensitive** and answered with what to do instead |
| `DELETE /api/officer/equipment/:id` | Really deletes, cascading every loan against it. Refused while a unit is out. Retiring (`active: false`) is the reversible one |
| `GET /api/officer/loans?status=&all=` · `PATCH /api/officer/loans/:id` | `all=1` returns every status. Availability re-checked inside the transaction. **No REQUESTED → CHECKED_OUT**: approval comes first. A move that holds a unit fills `dueAt` in when the officer types none — from the member's date, or the item's cap |
| `GET /api/officer/terms` · `PATCH /api/officer/terms/seat` | Today's board, seatless officers included. Setting a seat another open term holds is a **409 naming the incumbent** — a partial unique index over open terms is not expressible through Prisma, so the route is what enforces one per seat. `takeOver: true` overrides that: it closes the incumbent's term as `Succeeded by …` and seats the successor **in one transaction**, and answers with `succeeded`. Off by default, because the 409 is the protection. A term created here is `MANUAL` and the Discord sync will not close it. `position: null` clears the seat and leaves them on the board |
| `DELETE /api/officer/terms/:userId` | Stand somebody down: closes the open term, which is what publishes them to `/officers`. The sync reopens one if they still carry the Discord role, which is correct — this is not a way to overrule the club's own answer |
| `GET /api/officer/archive` | **Every tenure the club has recorded**, open and closed alike, in `routes/officer/officerArchive.ts` — the officers desk, and the only thing that can write a term that has already ended. Unpaginated for the reason `/api/officers/past` is: eight seats a year against a fifty-year club is a list too long to *scan*, not one too long to send, and the desk filters it in the browser with the same helpers the public archive uses. `seats` rides along so the picker's options come from the enum |
| `POST /api/officer/archive` · `PATCH`/`DELETE /api/officer/archive/:id` | Add, correct, remove. `userId` is **optional and usually null** — most past officers predate the site and have no row in `users`, which is why `fullName` is stored on the term rather than read through the relation. One person may hold **any number** of terms; nothing here is keyed on a person. The one-per-seat 409 applies to **open** terms only, because forty people have been president, and there is no `takeOver` — a handover is `PATCH /api/officer/terms/seat`, which does all three writes in one transaction. `PATCH` treats absent as unchanged, so fixing a date cannot wipe the succession note, and checks the dates against the **resulting** row rather than the body. `source` is not writable: it decides who may close the term, and the sync only closes what the sync opened. `DELETE` really deletes — it is for the row that should never have existed; a tenure that simply ended gets an end date |
| `POST`/`DELETE /api/officer/archive/:id/photo` | A headshot filed against the term. Same shape as the sponsor logo route — upload *and* replace in one. `GET /api/officers` prefers the **linked account's** picture, so this only draws for a term with nobody behind it, which is most of the archive and the whole reason the column exists |
| `GET /api/officer/semesters/:year` | The three terms and **which of the three sources dated each**: `override`, `calendar`, `fallback`. Carries `finalsStartAt`/`finalsEndAt`/`finalsSource` beside them — all three null when nobody has said, which is a state the term dates never have because those always fall back |
| `PATCH /api/lab` | Officers only. `{ open }` → `{ open, changedAt, buildingOpen }`. **Opening is a 409 between 10pm and 8am Orlando time** — closing is always allowed, because an officer realising at 22:05 that they left it open is the last person to argue with; the ten-minute sweep locks up on the club's behalf otherwise. Setting it to the state it is already in is a **200 that writes nothing**. **Discord is written first and the row only if that landed**: the channel is renamed `lab-status-🟢`/`🔴`, and that rename is limited by Discord to **two per ten minutes**, so the third press in a window is a **429 carrying the cooldown** and the lab is left exactly as it was (a refused rename is a 502 naming Manage Channels). The sign is **one message in the channel that still pings**, via post-new-then-delete-old: **opening posts** a fresh message — that post is the `@Members` ping — and deletes the one it replaces, while closing, the curfew and every sweep retry **edit**. Nothing re-announces, so a retry can never ping the club twice for one evening |
| `PUT`/`DELETE /api/officer/semesters/:year/:season` | The club's own term dates, ahead of UCF's feed. Refuses `startsAt >= endsAt`. Also takes `finalsStartsAt`/`finalsEndsAt` — when the club puts every project on halt — both or neither, refused inverted, and refused outside the term, since a finals window outside its own term matches nothing and would silently do nothing. Null hands finals back to the feed, which counts it as everything after the last day of classes. Flushes the cache in `semester.ts`, which every dues read goes through. Changes what the *next* payment buys and nothing already sold — a payment stores its own `coversThrough` |

### Files, and when they stop existing

Uploads live in Postgres as `bytea` and are served from `/api/files/<id>`. That
prefix is the whole "is this ours" test: an image column holding one is an
upload and gets cleaned up, anything else is somebody's external URL and is
never touched.

Two rules the club asked for, both enforced server-side rather than by whoever
remembers:

- **A print model is deleted when its request is settled.** Marking one `DONE`
  or `REJECTED` drops the `stored_files` row in the same transaction as the
  status change. The request survives — name, size, notes, outcome — so the
  member's history reads properly with nothing left to download.
- **A replaced image is deleted immediately.** Uploading a new project cover
  stores the new one, points the column at it, and then drops the old row.
  Swapping an upload for an external URL deletes it too; swapping one external
  URL for another touches nothing. A gallery picture works the same way, except
  that there is no replace — removing and adding is the only edit, which keeps
  `deleteIfStored` to one call site for the gallery instead of three that would
  have to agree.

**The cascade takes rows, never bytes**, and that is the thing to remember when
adding another table with an image column in it. `project_images` cascades from
`projects`, so deleting a project takes its gallery rows — but nothing in
Postgres knows a string beginning `/api/files/` is a reference, so
`DELETE /api/projects/:id` reads those URLs and sweeps them by hand first.
Without that, the files would sit in `stored_files` forever with nothing
pointing at them and no way to find them again. `files.test.ts` is the tripwire.

### One gate

`requireCurrentDues` in `src/auth/authz.ts`, and it asks one question:
`duesPaidThrough > now`. `ADMIN` is the only exemption — officers included.
Every check in that file ends with it, `requireDuesForRoute` is the same thing
as middleware, and 3D printing, equipment borrowing and every management tool
sit behind it equally.

There used to be a second, stricter gate, `requireClubMember`, which also
refused a `GUEST` outright. It was necessary while the summer, the break between
terms and the opening weeks reported `hasAccess: true` for **everyone** —
standing alone would then have let an account created ten minutes ago order
prints. Access is the dues date now, and nothing sets that date without
promoting the account in the same transaction, so the role check could never
fail for anybody who had already passed the date check. Two gates that always
agree are one gate and a place for them to stop agreeing.

The refusal still carries three different sentences, chosen from the date rather
than the role: a free window running, a date that ran out, or no date ever.

### The 3D printing material allowance

Every member gets `PERSONAL_PRINT_GRAMS` — 500 by default — of material for
their **own** prints in one term, filament and resin together. A print marked
for a project costs nothing against it: the club's decision was that project
prints are uncapped, on the honour system and the officer's discretion.

**The balance is never stored.** It is the club's figure minus the summed
`grams_used` of that member's `DONE`, project-less requests stamped with the
term — counted when asked, exactly the way equipment availability is counted.
`src/printing/printAllowance.ts` is the only place that arithmetic lives, and a column
would be a number that goes wrong quietly while the per-semester reset became a
sweep somebody has to remember to run.

Four things follow from that, and each has bitten a design somewhere:

- **The term is frozen on the request when it is made**, mirroring
  `DuesPayment`. A print asked for in December and finished in January is
  charged to the fall, and the over-cap check looks at the fall's balance too.
- **The term is `currentTerm`, not `billableTerm`** — the one place on the site
  where summer is a term of its own. Dues skip summer because the club does not
  charge for it; the allowance resets each semester, and summer is one.
- **Only the officer route writes `grams_used`**, which is what makes the sum
  trustworthy. It is required to mark a personal print `DONE` and refused on a
  decline, because nothing was printed.
- **Going over is allowed and deliberate.** The route answers 409 with both
  numbers in it unless the officer passes `overAllowance: true`. The balance is
  then permitted to read negative — clamping it at zero would hide the case the
  override exists for.

Attributing a print to a project requires a real `project_members` row and
deliberately does **not** use `requireProjectMember`, which waves officers
through: that exemption would let an officer bill any print to any project and
never touch their own allowance.

### Both officer queues take `?all=1`

It exists for one thing: the browser's search box on the LIVE view is meant to
reach a print or a loan that has already been settled, and it cannot search
rows it was never sent. It is a **literal `'1'`**, not a coerced boolean —
`z.coerce.boolean()` reads the string `"false"` as true, which is the kind of
bug that only shows up in the one case somebody bothered to be explicit.

Ordering follows from the same place. Live work reads oldest-first, because
that is the queue: whoever asked first is served first. Anything settled reads
**newest-first**, and it has to — `take` cuts at a hundred, and the oldest
hundred rows of a club's archive are the least useful hundred there are. A
search across them would answer about last September while missing this
morning.

### Borrowing, and the dates on it

**An officer approves before anything leaves the lab, and an officer checks it
back in.** `REQUESTED → CHECKED_OUT` used to be a legal move, for the officer
standing at the shelf; it is gone, because a lifecycle with a shortcut around
approval cannot record that an approval happened. Handing something over on the
spot is APPROVE then HAND OVER.

**The member says when.** `requestedDueAt` is required on an ask, and a
`startAt` in the future turns it into a booking. Both are kept beside the
officer's `dueAt` rather than being overwritten by it — the same discipline
`print_requests.printed_*` follows, so "asked for a fortnight, due back Friday"
is a sentence the queue can say.

**Every date on a loan goes through `loanDate`.** `z.coerce.date()` alone
accepts `+275760-09-13` and `9999-12-31`, and a date box will hand you either
from a mistyped year — the HTML grammar allows four *or more* digits. The range
checks below would refuse those anyway, but for being longer than a week rather
than for being wrong. `loanDate` bounds both ends of a loan to within ten years
and says so.

**Retiring keeps the history; deleting does not.** `active: false` takes
something off the members' list and leaves every record of who borrowed it,
which is right for a tool that broke or stopped being lent. `DELETE` is for a
row that should never have existed — it cascades through `equipment_loans` and
takes the item's whole borrowing history with it, so the browser's warning
names the count before the click. It is **refused while a unit is out**:
deleting the row that says Rowan has the drill does not get the drill back, it
loses the only record of where it is.

**Duplicate names are matched without case.** Postgres's unique index is not,
so "cordless drill" and "Cordless drill" are two rows to the database and one
drill to the club — which is how a lending list ends up counting the same thing
twice and telling two people there is one free. The 409 says what to do instead
of stating the collision, because what the officer nearly always wanted was to
change the number on the row that already exists.

**Each item caps its own loans.** `equipment.max_loan_days`, a week by default.
It binds the *member's* ask and not the officer's date: a form being filled in
is checked, and a person with authority making a decision is not. The window is
counted in floored whole days by `src/equipment/loanWindow.ts`, which the browser mirrors
in `web/src/lib/equipment/borrowing.ts` so the form never offers something the route will
refuse.

**A reservation holds its unit from approval, not from its start date.** A drill
booked for next month is off the shelf as soon as an officer says yes. That is a
real cost, deliberately taken: the availability count is a count, and overlapping
windows to work out whether the drill is back in time would promise a physical
object on the strength of a date somebody typed. The club can lend the same drill
twice by hand; it cannot un-lend one.

**The bot gives a day's notice.** `src/equipment/equipmentReminder.ts` runs on the
ten-minute timer and DMs anybody whose checked-out loan falls due inside
`RETURN_REMINDER_LEAD_HOURS` — 36 by default, because a due date is the *end* of
the day it names and a flat 24 would fire around midnight. The claim is
`equipment_loans.reminded_for`, which holds **the deadline the message named**:
that one value deduplicates across instances and restarts, and re-arms itself
when an officer moves the date. Nothing chases an already-overdue loan; that
needs an officer, not a robot.

## Tasks

A checklist a lead writes and a member works through, at `/dashboard/tasks` and
on each project's board. `src/routes/projects/tasks.ts` owns who may write what;
`src/discord/taskReminder.ts` is the bot's half.

**Five labels, and the declaration order is the sort order.** `OPEN`,
`IN_PROGRESS`, `DELAYED`, `DONE`, `CANCELED` — Postgres sorts an enum by
declaration order and the board orders on it, so unsettled work sits above work
nobody has to think about again. It was two labels, and the comment on the enum
argued for keeping it that way; what changed is that the bot now asks, and a
member with a deadline behind them needs a way to answer other than silence.
`CANCELED` is deliberately a label rather than a delete: a task called off is
still a record that somebody was asked.

**A task belongs to a project or to a person.** The second kind has no
`projectId`, is the officers' alone, and must name an assignee — see the
permission table above.

**A new task may only go on a project running this semester.** A project belongs
to a term and a build that ran three semesters is three rows, so without this a
lead opening last spring's manage page could add work to a project nobody meets
for any more — and it would land on somebody's dashboard looking exactly like
this week's. `requireCurrentProject` is the guard, `isCurrentTerm` against
`currentTerm()` is the test, and it is **exact equality**: a project stamped for
a term that has not started is refused too, which is the same thing "current"
means everywhere else on the site.

Three things it deliberately does not do. It does not touch **editing, ticking
or deleting** — a board that froze on the last day of term would strand every
unticked row on it. It does not apply to a **task with no project**, which has
no term to be out of. And it refuses **officers** as well: this is the calendar,
not a permission.

**The calendar opt-in is the member's, one at a time.**
`task_assignees.on_calendar` rather than a column on the task, because two
people share "CAD the chassis" and only one of them wants it in their week. An
opted-in deadline appears on that member's `/api/me/events` as a generated
`task:…` entry — the same convention project meetings use, and for the same
reason: there is no row behind it, so nothing may offer to edit one. It reaches
no other calendar and never the public one.

**The bot asks about a deadline that has gone past.**
`src/discord/taskReminder.ts` runs on the ten-minute timer and DMs everyone
assigned to an unsettled task whose `dueAt` is more than
`TASK_OVERDUE_GRACE_MINUTES` old — 30 by default, so a message lands 30 to 40
minutes past the deadline. `TASK_OVERDUE_LOOKBACK_DAYS` is the floor that stops
the first sweep after a deploy asking the club about last semester.

Three properties of it are worth keeping:

- **The claim is `tasks.reminded_for`**, holding the deadline the message named
  — the same choice `equipment_loans.reminded_for` makes. It deduplicates across
  instances and restarts, and re-arms itself when a lead moves the due date.
- **Recipients are resolved before the claim**, so a briefly unreachable Discord
  costs a task nothing: it stays a candidate and the next run tries again.
- **One message per person, not per task.** Somebody who let three things slip
  on the same evening has had one bad week, so the loop claims and the sending
  happens afterwards, grouped. That is why `sent` in the report counts messages
  while `claimed` counts tasks.

List routes take `?limit=` (max 100) and `?offset=`.

`/events` accepts an ISO `from`/`to` window, which is what the landing page's
calendar asks for one month at a time. The window is half-open and matches on
*overlap*, not on start: an event that begins in July and ends in August comes
back for both months, so a multi-day competition never falls off a grid. Pair it
with `when=all` — a calendar has to draw the days that have already gone.

`/officers` is separate from `/members?role=OFFICER` because a seat on the board
and a permission level are different things: the faculty advisor holds a seat and
is a plain `MEMBER` — sitting on the board is not a reason to hand somebody the
print queue — so a role filter would both miss them and sweep up officers who
hold no named seat. Unfilled seats are simply absent from the response — the site
draws a card per seat and labels the empty ones itself.

`/officers` and `/officers/past` are **one table split on one column**.
`officer_terms` holds who sat on the board, in which seat, between which dates;
an open term — `ended_at` null — is the board, and a closed one is the archive.
There is no `users.officer_position` any more: a column on a person could only
ever describe today, and it could not describe an admin who is also an officer
at all, since `UserRole` has one slot with `ADMIN` above `OFFICER`.

**How many seats there are is the database's answer.** `/officers` sends the
`OfficerPosition` enum in declaration order alongside the sitting officers, so a
seat added to the schema reaches the front page with no frontend change — the
count used to be a list in `web/src/content/home.ts`. The same response carries
officers holding *no* seat, which the sync creates the moment somebody gains the
Discord role and which the old fixed board could not draw at all.

A term carries the holder's name itself, because most past officers predate this
site and have no account; where one does link a roster entry, the route falls
back to that person's headshot and settles which of the two answered rather than
leaving it to the browser. Both are unpaginated: eight seats a year against a
fifty-year club is a list too long to scan, not one too long to send.

Officer *seats* are set on `/api/officer/terms/seat` and the whole tenure
archive on `/api/officer/archive`; officer *roles* come from
Discord. Neither writes the other. `officer_terms.source` says which put a term
there, and **the sync only ever closes what the sync opened** — which is what
keeps the faculty advisor, who carries no Discord role at all, on the board.

Email addresses and password hashes are never returned by the public API, and
neither are users who aren't on the roster. Post authors expose only a name.

`/auth/me` answers 200 with a null user rather than 401 when nobody is signed
in. Not being signed in is the ordinary state of the front page, and treating it
as a failure puts a red line in every visitor's console on every load.

The `/auth` and `/dues` routes sit outside the cached public API, because they
answer differently depending on who is asking — a cached "what do I owe" served
to the next visitor would be somebody else's membership.

## Signing in and dues

Sessions are rows in `sessions`, not signed tokens, because the thing the club
will want one day is to *end* one. Only a SHA-256 of the cookie is stored, the
same way signup stores its verification token. The expiry is an idle timeout:
every authenticated request rolls it forward, so a member who turns up to build
nights is never signed out mid-term, while a browser left on a lab machine still
goes stale.

Two things about the cookie decide whether any of it works once deployed, and
both fail silently. `SESSION_COOKIE_SAMESITE` must stay `lax` while the site and
the API share a registrable domain, and only becomes `none` — which needs https
— when they genuinely differ. And the API's CORS middleware sends
`credentials: true`, which the frontend matches with `credentials: 'include'`;
drop either half and every authenticated request arrives anonymous with no error
anywhere.

Dues follow UCF's academic calendar, read from `calendar.ucf.edu` and cached for
a day, with fixed fallback dates for when it cannot be reached — the club's dues
year cannot depend on somebody else's uptime. `src/membership/semester.ts` is the whole of
that logic and the rules it encodes:

- **Access is `duesPaidThrough > now`, and nothing else.** The website, this
  API and the Discord bot all ask that one question.
- **The free window runs from the end of one dues-bearing term to three weeks
  into the next**, and it is *claimed*, not given. One press covers the gap, all
  of Summer C, the next gap and the opening weeks — May to September on one
  claim. Summer is not special-cased; it is free because it sits inside this.
- $25 covers the term it was bought against; $50 covers that term and the next
  dues-bearing one — fall then spring, or spring then fall.
- **A payment buys the term it is made in and ends with it** (`billableTerm`).
  There is no rollover: dues paid in week eleven cover weeks eleven to sixteen,
  not the term after. Between terms there is no current term to buy, so the
  money goes to the one ahead — which is `currentTerm`'s ordinary behaviour
  during a break rather than a rule of its own.

Money is only ever credited from Stripe's own account of a payment, never from
the browser. The webhook and `POST /api/dues/sync` both funnel into one
`applyPayment`, which is idempotent on `dues_payments.stripe_payment_intent_id`
— the two routinely race on a fast card, and Stripe re-delivers besides.

## Signup

Joining the club is creating an account, and it is two requests with an email in
between. `start` takes an address and mails a link; `complete` arrives with that
link's token and everything else. Nothing about a person is stored until the
address is proved, so an abandoned signup leaves one row in
`signup_verifications` that expires on its own.

- **Only `@ucf.edu`.** Membership is for current UCF students. The retired
  `@knights.ucf.edu` domain is deliberately not accepted.
- **The link points at the frontend**, `SITE_URL` + `/join`, not at this API.
  The join page there posts the token back, so the token is spent by a POST
  rather than by the GET that opens the URL — mail scanners follow every link in
  an incoming message, and against a GET endpoint that uses the verification up
  before the student ever clicks it.
- **`SITE_URL` is the only place the site's address is set.** The CORS
  allow-list is derived from it too, so moving to a real domain is one line.
  `CORS_ORIGINS` adds *extra* origins on top — a preview deploy, or `:4173` for
  `vite preview` — and the site's own origin can no longer be left out of it by
  accident.
- **Moving to `https://` is that line plus two more.** `TRUST_PROXY` has to
  become true if TLS terminates at a proxy, or every visitor arrives from the
  proxy's address and shares one rate-limit bucket; and the web package's
  `VITE_API_URL` has to be https, or the browser blocks every call from the site
  as mixed content. This server warns about the first at startup and the site
  logs the second; neither is fatal, because TLS terminating in Node is a real
  configuration. HSTS and the http→https redirect belong to the proxy — a
  `Strict-Transport-Security` header cannot be taken back for the length of its
  `max-age`.
- **The member acknowledgement is required and recorded.**
  `acknowledgementAccepted` must be exactly `true`, and the time it was accepted
  is written to `User.acknowledgementAcceptedAt`. The agreement covers lab
  equipment, batteries and conduct, so a checkbox nobody kept a record of would
  not have done its job. The text lives in the frontend, at
  `web/src/assets/sample_aknowledgement.txt`.
- **The email is hand-built HTML** in `src/email/emails.ts`, themed like the site:
  tables and inline styles, because Outlook renders through Word. Link tracking
  is turned off explicitly — it would rewrite a token-bearing URL through a
  redirect on the one email asking someone to trust the link.
- **The token is stored as a SHA-256 hash** and never appears in a response.
  With no Postmark token configured the API logs the link instead, in
  development only; in production it refuses to start a signup at all, because
  an address nobody can confirm is an account nobody can finish.
- **The Discord username is checked against the club's guild** by a bot, over
  REST — see `src/discord/discord.ts`. It matches `user.username` and never
  `global_name`, because typing the display name is the mistake nearly everyone
  makes. `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` are optional as a set; with
  them unset the handle is stored exactly as typed and the API says so at
  startup. The bot must be in the guild and needs the Server Members Intent.
- **Both the address and the handle are unique**, and the route reports which of
  the two was taken. The account is created at the default `GUEST` role with no
  slug, which keeps it off the public roster until an officer promotes it.
- **Nothing signs in yet.** The password is hashed with scrypt
  (`src/auth/password.ts`) and stored; there is still no login route to check it
  against.

## Deploying

**A merge to `main` puts this on the live site by itself**, migrations included —
the box polls the branch and rebuilds the API image once CI is green. The whole
mechanism is in [`../deploy/README.md`](../deploy/README.md); what matters here
is that a change under `server/` restarts the API against the **real database**
with no human in the loop, so a migration lands the moment its commit does.

Reading or correcting the live data is a connection string rather than anything
installed on the box — see
[Pointing these at a deployed database](#pointing-these-at-a-deployed-database),
and the warning there about never putting that URL in `.env`.

**Name both profiles on any compose command that touches the live stack.** The
services split into `app` (postgres, migrate, api) and `web` (nginx), and `web`
declares `depends_on: api` across that boundary — so a command naming only one
describes a project in which the other half's services do not exist, and compose
refuses the whole thing rather than ignoring the dangling reference:

```
service "web" depends on undefined service "api": invalid compose project
```

So it is `docker compose --profile app --profile web up -d`, which is also what
the deploy agent runs. `--profile tools` is separate and additive; pgAdmin
depends on nothing but Postgres.

## Scaling

The API holds no state of its own, so it scales by running more copies:

```bash
docker compose --profile app --profile web up -d --scale api=3
```

A one-shot `migrate` service applies migrations before any instance starts, so
replicas never race on the migration table. Replicas publish onto the
`4000-4004` host range; put a real reverse proxy in front before exposing this.

What makes more than one instance safe:

- **Rate limit windows live in Postgres**, not process memory (`src/core/rateLimit.ts`).
  Counting in memory would hand an abuser N times the allowance across N
  replicas and reset the count on every deploy. The counter is a single atomic
  upsert, so simultaneous requests can't lose an increment.
- **`X-Forwarded-For` is only trusted when `TRUST_PROXY=true`.** The header is
  client-supplied; honouring it with nothing in front lets a script put a fresh
  fake IP on each request and never hit a limit. Turn it on only once a proxy
  overwrites it.
- **Pool size is explicit.** `instances × DATABASE_POOL_MAX` must stay under the
  server's `max_connections` (100 by default). Three instances at the default 10
  is 30. Add PgBouncer before that maths stops working.
- **Public GETs carry `Cache-Control` with `s-maxage` plus an ETag.** A CDN or
  reverse proxy in front absorbs read traffic, which is nearly all of it — this
  is the change that actually matters when a competition drives a traffic spike.
  Repeat visitors get a 304 with no body.
- **Shutdown is graceful.** `SIGTERM` stops accepting connections, drains
  in-flight requests, then closes the pool, so rolling deploys don't sever
  writes.

The one thing that is *not* instance-safe, and is deliberately left that way:

- **The lab sign serialises its Discord writes in process.** Two presses a
  second apart on the same instance queue behind each other, which is what stops
  them both finding no message and posting one each. Across instances there is
  no such lock — the backstop is the ten-minute reconcile, which reads the
  message back, corrects every row to whatever Discord ended up saying, and
  deletes every message of the bot's that is not the sign. So a duplicate posted
  by a second instance is cleared within a tick rather than living in the
  channel; a distributed lock for a light switch is not a trade worth making.

What is deliberately *not* built, because the row counts don't justify it: no
Redis, no read replicas, no cursor pagination. Members, projects, and events
stay in the hundreds for a club — `limit`/`offset` is fine there, and swapping
it out would add complexity for no measurable gain. Revisit if `posts` ever
reaches tens of thousands of rows.

## Layout

| Path                  | What it is                                                   |
| --------------------- | ------------------------------------------------------------ |
| `docker-compose.yml`  | Postgres on 5433; `app` profile adds migrate + api, `web` adds nginx, `tools` adds pgAdmin |
| `nginx.conf`          | Mounted into the `web` container — the bundle, and `/api/` proxied to this API |
| `Dockerfile`          | API image; runs `prisma generate` at build so client matches schema |
| `prisma/schema.prisma`| Models                                                        |
| `prisma/migrations/`  | Migration history — commit these                              |
| `prisma.config.ts`    | Prisma 7 config; reads `DATABASE_URL` from `.env` via dotenv  |
| `src/generated/prisma`| Generated client. Not committed; run `prisma generate`        |

### `src/` — a folder per thing the club does

Two files stay at the top because they are the way in: `index.ts` starts the
process — the startup banner, the sweep timers, the Discord gateway — and
`app.ts` is the middleware chain and the list of what is mounted where. Read
`app.ts` first; it is the map, and the order it mounts things in is load-bearing.

```
src/
├── index.ts          the process: listen, log what is configured, arm the sweeps
├── app.ts            the middleware chain and every mount, in cache-boundary order
├── core/             env.ts (validated `.env`), db.ts (the one Prisma client),
│                     rateLimit.ts (the Postgres-backed limiter), validate.ts
│                     (the zod validator every route imports, and `webUrl`)
├── auth/             session.ts (cookie + middleware), password.ts (hashing),
│                     authz.ts (who may do what — see membership docs)
├── discord/          discord.ts (the bot's HTTP surface), discordGateway.ts (the
│                     WebSocket), discordRoles.ts, discordOfficers.ts,
│                     discordAlumni.ts, discordRecipient.ts, officerNotify.ts
├── email/            mail.ts (Postmark, optional), emails.ts (the HTML itself)
├── lab/              labStatus.ts (the sign, the curfew, the sweep),
│                     labInteraction.ts (what a button press means)
├── membership/       semester.ts (UCF's terms), membershipSweep.ts
├── printing/         printAllowance.ts (the per-term balance), printSettings.ts
├── equipment/        loanWindow.ts (how long a loan runs), equipmentReminder.ts
├── projects/         meetings.ts (recurrence expanded), projectMeeting.ts,
│                     projectTerm.ts
├── files/            files.ts — stored bytes, and the rule about deleting them
├── payments/         stripe.ts — the client, optional like the other two
└── routes/           grouped by who is allowed to call them, below
```

`routes/` splits the same way `app.ts` mounts them, which is by audience rather
than by feature — the cache boundary and the gates both follow that line, so a
file's folder tells you what is already true when your handler runs:

| Folder | Who reaches it | Files |
| --- | --- | --- |
| `routes/public/` | anybody, unauthenticated | `content.ts`, `forms.ts`, `files.ts`, `lab.ts` |
| `routes/account/` | somebody managing their own row | `auth.ts`, `signup.ts`, `account.ts` |
| `routes/member/` | a signed-in member, behind the dues gate (`survey.ts` excepted — it gates nothing and is gated by nothing) | `me.ts`, `dues.ts`, `survey.ts`, `print.ts`, `equipment.ts` |
| `routes/projects/` | project members and leads, per project | `projectManage.ts`, `tasks.ts`, `eventManage.ts` |
| `routes/officer/` | the officer desks | `officer.ts`, `surveyAdmin.ts`, `heroSlides.ts`, `frontPage.ts`, `sponsorsAdmin.ts`, `aboutPage.ts`, `officerArchive.ts` |
| `routes/webhooks/` | Stripe and Discord, verified by signature | `stripeWebhook.ts`, `discordInteractions.ts` |

`routes/public/` is about *reachability*, not about writes: `lab.ts` is a public
read with an officer-only `PATCH` on the same file, and it is mounted ahead of
the cached block on purpose. See the comments in `app.ts`.

**And `routes/officer/` is not about where a form is drawn.** `aboutPage.ts` is
written from `/about` itself, by an officer pressing EDIT on the public page —
it is in this folder because `requireOfficer` is the whole gate on it, which is
the only thing the folder has ever meant.

**Tests sit beside what they test**, in the same folder — `authz.test.ts` next to
`auth/authz.ts`. Vitest's default glob walks the tree, so a new folder needs no
config change. **They run against the real development database**, so a new one
namespaces its fixtures and deletes by that prefix; nothing here selects "all
rows of a kind".

## Scripts

| Script             | What it does                                                |
| ------------------ | ----------------------------------------------------------- |
| `npm run dev`      | API with watch-reload — see [Running it locally](#running-it-locally) |
| `npm start`        | API, single run, no watcher                                  |
| `npm run studio`   | Prisma Studio, the data GUI on :5555                         |
| `npm run db:up`    | Start Postgres in the background                             |
| `npm run db:down`  | Stop it, keeping data                                        |
| `npm run db:reset` | **Destroys the volume** and starts fresh                     |
| `npm run db:logs`  | Tail Postgres logs                                           |
| `npm run migrate`  | `prisma migrate dev` — create and apply a migration          |
| `npm run generate` | Regenerate the client into `src/generated/prisma`            |
| `npm run seed`     | Load placeholder content (safe to re-run)                    |
| `npm run typecheck`| `tsc --noEmit`                                               |

## Notes

- **Port 5433, not 5432**, so a Postgres already installed on the machine can't
  collide with it. The compose project is named `rccf-v13`, which is what keeps
  its containers and volumes to itself.
- **Postgres 18 volume mount.** The volume mounts at `/var/lib/postgresql`, not
  `/var/lib/postgresql/data` — 18+ images refuse to start otherwise. Don't add a
  `PGDATA` override to work around it; that writes to the container layer and the
  data is lost when the container is removed.
- **Prisma 7 uses driver adapters.** There's no Rust query engine, so `PrismaClient`
  is constructed with `PrismaPg`. See `src/core/db.ts`.
- The client generates into `src/generated/prisma`, so run `prisma generate` after
  pulling schema changes.
- **Enum order is load-bearing for `UserRole`.** Postgres sorts an enum by
  declaration order and Prisma only diffs the value *set*, so reordering values
  in `schema.prisma` silently produces an empty migration. If you reorder them,
  write the `CREATE TYPE` / `ALTER TABLE ... USING` swap by hand — see
  `migrations/20260803215037_merge_member_into_user`.
- The frontend calls this cross-origin, allowed via `CORS_ORIGINS`. If you'd
  rather use same-origin paths, add a `/api` proxy to `vite.config.ts` instead.
