# RCCF server

Postgres 18 in Docker, Prisma 7 and a Hono JSON API.

## Setup

```bash
cd server
cp .env.example .env    # fill in POSTGRES_PASSWORD and DATABASE_URL
npm install
npm run db:up           # start Postgres and wait until healthy
npx prisma migrate dev  # apply migrations and generate the client
npx prisma db seed      # optional development data
npm run dev             # API on http://localhost:4000/api
```

## Running it locally

Run from `server/`, with Postgres already up. Nothing below starts it.

| What | Command | Where |
| --- | --- | --- |
| Postgres | `npm run db:up` | localhost:5433 |
| API | `npm run dev` | http://localhost:4000/api |
| Prisma Studio | `npm run studio` | http://localhost:5555 |
| pgAdmin | `docker compose --profile tools up -d` | http://localhost:5050 |

`npm run dev` is `tsx watch src/index.ts`: it restarts on save and has no build
step. `npm start` runs once without watching, as the container does. The port is
`PORT` in `.env` (default 4000).

```bash
curl http://localhost:4000/api/health
# {"status":"ok","database":"up"}
```

`"database":"down"` means Postgres isn't reachable; run `npm run db:up`.

### Prisma Studio

A spreadsheet view of every model: browse, edit, add and delete rows, follow
relations. Start it from `server/`, where the schema and `.env` are. It only
knows the Prisma schema, so it can't show indexes, query plans or roles.

### pgAdmin

Behind the `tools` profile, so it doesn't start with the database. Sign in as
`admin@example.com` / `admin` (override with `PGADMIN_EMAIL` and
`PGADMIN_PASSWORD`; a `.local` email makes pgAdmin crash-loop). Register the
server with the Docker-network values:

| Field | Value | Why |
| --- | --- | --- |
| Host | `postgres` | The compose service name; `localhost` would be pgAdmin's own container |
| Port | `5432` | The container port; 5433 is only the host mapping |
| Database | `rccf` | `POSTGRES_DB` |
| Username | `rccf` | `POSTGRES_USER` |
| Password | from `.env` | `POSTGRES_PASSWORD` |

Use it for SQL, indexes, query plans, enum ordering and roles.

### psql

```bash
docker exec -it rccf-v13-postgres psql -U rccf -d rccf
```

## Editing data by hand

### Pointing the tools at a deployed database

Studio, pgAdmin and psql are clients. `docker-compose.yml` publishes Postgres on
the host's `POSTGRES_PORT`, so a deployed database is a connection string away.

```bash
npm run studio -- --url "postgresql://USER:PASSWORD@HOST:5433/rccf?schema=public"
```

- Pass `--url`. Never put a deployed URL in `.env`: Vitest reads the same file,
  and the sweep tests select every candidate row, so the next `npm test` would
  write to real people.
- Use an SSH tunnel unless the port is private, and bind the local end to
  anything but 5433 (your dev Postgres). A tunnel that failed to open would
  otherwise connect you to seed data that looks real.

  ```bash
  ssh -N -L 5434:localhost:5433 user@host
  ```

  Binding the published port as `127.0.0.1:5433:5432` keeps tunnels working and
  closes it to the network.
- Check out the commit the server runs. Studio reads your local
  `schema.prisma`, and newer columns make every table error.
- Dump first. Studio commits a cell when it loses focus, with no confirmation or
  undo.

  ```bash
  docker exec <postgres-container> pg_dump -U rccf rccf > backup.sql
  ```

### What a hand edit keeps

Several columns are rewritten by the ten-minute sweeps.

| Edit | Result |
| --- | --- |
| `role` → `ADMIN` | Sticks. Nothing writes or clears it |
| `role` → `MEMBER` / `GUEST` | Reverted by the membership sweep; `dues_paid_through` decides |
| `role` → `OFFICER` | Reverted from the Discord officer role |
| `officer_alumnus` | Overwritten from the Discord Officer Alumni role |
| `active` | Set back to `true` by the next payment |
| `survey_completed_at` cleared | Puts the survey prompt back up; locks nothing |
| `survey_prompt_dismissed_at` cleared | Starts asking someone who said stop |

To comp a term, use the roles desk, not `dues_paid_through`. `grantMembership`
also records the zero-amount payment, promotes a `GUEST`, stamps `joinedAt` and
notes who granted it.

### When Save seems to do nothing

The write was rejected and Studio silently restored the cell. The error is in
the failing request's response body (devtools → Network on the Studio tab).

The common case is changing `email`, which is `String? @unique`, when another
account of the same person already has it. Set that one to null first (the
column allows any number of nulls).

- Store emails lowercase. Signup, login and the account route lowercase before
  querying, and the unique index is case-sensitive, so a capitalised address
  can't sign in and nothing reports why.
- Delete any pending `email_changes` row for the account, or following its link
  overwrites your fix.
- In psql, `updated_at` has no database default, so a raw `UPDATE` must set
  `updated_at = now()`.

## People and roles

Three separate questions:

- `UserRole` is what someone is in the club: `ADMIN` (full control, exempt from
  the dues gate), `OFFICER`, `MEMBER`, `GUEST` (the signup default).
- `ProjectMember.rank` is what they run in one project: `PROJECT_LEAD`,
  `TEAM_LEAD`, `MEMBER`.
- `duesPaidThrough` is whether their membership is current.

Declaration order of `UserRole` is both the permission ranking and the roster
sort, since Postgres sorts enums by declaration order.

How roles move:

- Paying, or claiming the free window, promotes `GUEST` to `MEMBER` and stamps
  `joinedAt` in the same transaction (`membershipUpdateFor` in
  `src/routes/member/dues.ts`). It never overwrites an officer-chosen role or
  creates a `slug`.
- A lapsed `MEMBER` returns to `GUEST`. `demoteIfLapsed` runs during session
  resolution; `sweepLapsedMembers` on the ten-minute timer catches the rest. Both
  touch only `MEMBER` accounts with a payment on record, and the sweep skips runs
  when UCF's calendar couldn't be read.
- Officers follow a Discord role. `refreshOfficerStanding` in
  `src/discord/discordOfficers.ts` checks the one person signing in or calling
  `/api/auth/me` (throttled to once per five minutes) and can promote or demote;
  demotion requires confirming the configured role exists. `syncDiscordOfficers`
  checks the whole guild every ten minutes.
- `src/discord/discordAlumni.ts` mirrors the Officer Alumni role into
  `User.officerAlumnus`. Never add that role to the site-written roles below; it
  sits under the bot, so a sweep would remove it from everyone.
- `src/discord/discordRoles.ts` hands out Members, Project Leads, Team Leads and
  each project's own role (`Project.discordRoleId`) on the same tick, after the
  two sweeps above. The site never writes the Officers role. Each role id is
  optional, unmatched guild members are never touched, and
  `DISCORD_ROLE_SYNC_DRY_RUN` logs changes without making them.
- `ADMIN` is set by hand and nothing changes it automatically.

Access is `duesPaidThrough > now`, checked by `requireCurrentDues` and
`requireDuesForRoute` in `src/auth/authz.ts`. `ADMIN` is the only exemption.
With dues owed, a member keeps `/api/dues/*` and `/api/me/*` and loses printing,
borrowing and every management tool. A lapsed lead or officer keeps the rank and
loses the tools. The member survey gates nothing.

Project authority is `ProjectMember.rank`, per project:

| Rank | May |
| --- | --- |
| `PROJECT_LEAD` | Everything in that project: teams, ranks, events, tasks, the project |
| `TEAM_LEAD` | Their own team's roster, events and tasks |
| `MEMBER` | Read the project; move tasks assigned to them |

- Officers and admins pass every project check.
- At most one `PROJECT_LEAD` per project (zero is normal). The appointment route
  answers 409 naming the incumbent; `src/projects/projectLead.ts` locks the
  project row. Not a database constraint, since Prisma can't express a partial
  unique index.
- Officers appoint project leads. A project lead appoints team leads through
  `PATCH /api/projects/:id/members/:userId`, which officers can also use.
- Only officers create projects.
- `ProjectMember.title` is free text and grants nothing.
- A task with no `projectId` is the club's own work: officers only, with at least
  one assignee.

`src/auth/authz.ts` makes every decision and `src/auth/authz.test.ts` is the
matrix.

## API

Public reads filter unpublished rows. Write routes are rate-limited per IP per
ten minutes: 5 for actions that cost something (an email, an account), 30 for
calls a page makes while someone works (the Discord handle check,
`/dues/sync`). Sign-in allows 20 per caller and 10 per account, because one
campus IP can be a whole lecture hall and password spraying never trips a
per-IP limit.

List routes take `?limit=` (max 100) and `?offset=`.

### Public

| Route | Notes |
| --- | --- |
| `GET /api/health` | Also pings the database |
| `GET /api/stats` | Landing page counts. Each equals its listing's default length; `members` is `activeMembers` (`active`, not `GUEST`) |
| `GET /api/members` | Active members by default. `?status=alumni` is the Officer Alumni role or a closed officer term; `?status=all` is every account. Also `?role=`. `limit` up to 1000 so the page can search the whole club. Includes `profileUrl` |
| `GET /api/members/:slug` | Adds the member's projects |
| `GET /api/officers` | `{ seats, officers }`: every seat in enum order and who holds one. `photoUrl` prefers the linked account's photo |
| `GET /api/officers/past` | The archive, `{ terms, older }`. `?years=` (default 2), `&all=1` |
| `GET /api/projects` | `?status= &season= &featured=true &term=current\|other &cover=true &images=true &description=true`. `term` is resolved from the academic calendar; `other` is everything not current, newest first. `cover=true` adds the first gallery image, `images=true` the whole gallery, `description=true` the write-up. Cover columns and section headings are always included |
| `GET /api/projects/:slug` | Adds description and credited members |
| `GET /api/terms/current` · `/api/terms/:year/:season` | A term's start, end and finals week as instants, for the meeting date picker. Years more than one from now are a 404 |
| `GET /api/events` | `?when=upcoming\|past\|all &type= &from= &to=`. Published rows, plus project meetings (from `src/projects/meetings.ts`) when both `from` and `to` are given and the project has `meetingsPublic`. Windows match by overlap. Meeting ids start `meeting:` and can't be edited |
| `GET /api/events/:slug` | Published only |
| `GET /api/posts` · `/posts/:slug` | Published, not future-dated; the list omits the body |
| `GET /api/sponsors` | `?tier=`. Active only, ordered by tier |
| `GET /api/sponsorship` | `{ tiers, inKind, footnotes }`. Only tiers that have been written |
| `GET /api/hero-slides` | Landing page photographs in order, max eight. Empty is valid |
| `GET /api/front-page` | `{ headline, headlineAccent, lede, partnersIntro, faqs, partners }`. Falls back to the shipped wording if the row doesn't exist |
| `GET /api/about` | The about page, including `storyNotice` (null once the history is real) |
| `GET /api/lab` | `{ open, changedAt, buildingOpen }`. `open` is already masked by building hours (8am to 10pm Orlando time). Outside the cached block, with its own `s-maxage=30`. Never says who opened it |
| `GET /api/files/:id` | Images public and immutable; print models owner or officer only, `no-store` |
| `GET /api/contact` | Whether this visitor may still send a message. `no-store` |
| `POST /api/contact` | `{ name, email, subject?, message }` → 201. Two per visitor per day |

`/api/auth`, `/api/dues` and every signed-in route are mounted before the cached
public block in `src/app.ts`, so no shared-cache headers reach them.

### Signup and sign-in

| Route | Notes |
| --- | --- |
| `POST /api/signup/start` | `{ email, acknowledged }` → 202, emails a link |
| `POST /api/signup/verify` | `{ token }` → `{ email }` |
| `POST /api/signup/discord-check` | `{ discordUsername }` → `{ status }` |
| `POST /api/signup/complete` | `{ token, firstName, lastName, password, discordUsername, acknowledgementAccepted }` → 201 |
| `POST /api/auth/login` | `{ email, password }` → `{ user }` and the session cookie |
| `POST /api/auth/logout` | Ends the session, including from a stale cookie |
| `GET /api/auth/me` | `{ user }` or `{ user: null }`, 200 either way |
| `POST /api/auth/password/forgot` | `{ email }` → 202 whatever it finds. Limited per caller, per address and by a 30-second floor. Works for accounts with no password yet |
| `POST /api/auth/password/reset` | `{ token, password }` → 200. Bad, expired or used tokens are one 410. Ends every session on the account |

### Signed in

| Route | Notes |
| --- | --- |
| `GET /api/account` | Editable profile, plus `passwordSet` and `pendingEmail` |
| `PATCH /api/account/profile` | `{ fullName, bio, gradYear, title? }` → `{ user }`. `title` is the line under their name on `/members`, up to 80 characters; blank clears it. 400 for an obscene title, an office without officer standing, or a lead title from somebody who leads nothing (`src/membership/titles.ts`). A former officer may name a seat they held with its years, like "Treasurer, 2022–2023" |
| `PATCH /api/account/profile-link` | `{ profileUrl }`, null to clear. Checked against an allowlist of platforms (`socialUrl` in `src/core/validate.ts`) because it's printed in a public `href` |
| `POST /api/account/discord-check` | Signup's check, excusing the caller's own handle |
| `POST /api/account/discord` | `{ discordUsername }` → `{ user }`. 422 `not_found`, 503 `unavailable` |
| `POST /api/account/photo` | Multipart image plus `focalX`/`focalY`/`zoom` in the same body. Replaces and deletes the old photo; framing always written |
| `PATCH /api/account/photo` | `{ focalX?, focalY?, zoom? }` reframes the current photo. 409 with no photo |
| `DELETE /api/account/photo` | Removes the photo and resets framing |
| `POST /api/account/password` | `{ currentPassword, newPassword }`. Ends every other session |
| `POST /api/account/email` | `{ password, email }` → 202, mails the new address. Nothing changes until confirmed |
| `POST /api/account/email/confirm` | `{ token }` → `{ user }`. Unauthenticated; the token is the proof |
| `DELETE /api/account` | `{ password }`. Refused while equipment is out or an officer term is open. Deletes stored files and strips site-managed Discord roles |
| `GET /api/survey` | The current questions, this member's answers or null, and `gradYear`. Retired options they picked are included and flagged. Not dues-gated |
| `POST /api/survey` | `{ answers, gradYear }`. Once; 409 if already answered. Stamps `surveyCompletedAt`, clears `surveyPromptDismissedAt`. A required question left out is a 400 |
| `POST /api/survey/dismiss` | "Don't ask me again". Idempotent |
| `PUT /api/survey` | Corrects answers; never moves `surveyCompletedAt`. `gradYear` optional; 409 if none sent and none on file |
| `GET /api/dues/status` | Membership, prices, coverage dates, history, plus `surveyPending` and `surveyPromptDismissed` (which lock nothing) |
| `POST /api/dues/checkout` | `{ plan: SEMESTER\|YEAR }` → a Stripe payment intent |
| `POST /api/dues/sync` | `{ paymentIntentId }` → asks Stripe how it went |
| `POST /api/dues/activate` | Claims the free window; promotes a `GUEST` like paying |
| `GET /api/me/projects` | Memberships with rank, team and a `current` term flag |
| `GET /api/me/events` | `?from= &to=`. Published events, this member's projects' unpublished ones, visible meetings, and task deadlines they opted into (`task:` ids) |
| `GET /api/me/tasks` | `?scope=mine\|managed\|all &status=open\|all &limit=`. `open` means not `DONE` or `CANCELED` |
| `GET /api/me/print-requests` | Newest first, drafts left out; `fileId` null once settled |
| `GET /api/me/print-allowance` | Grams left this term, computed |
| `GET /api/me/loans` | Borrowed and requested items |
| `POST /api/print` · `DELETE /api/print/:id` | Current dues. A resin print: multipart `.stl`/`.step`, size-capped and sniffed; an FDM body is a 409 (filament goes through the slicer). `quantity` 1 to 50; `projectId` needs a real membership. Withdrawing deletes every file the request holds |
| `GET /api/print/workspace` | Current dues and the slicer training. The offered printers (bed, processes and each process's own values), the filaments with the printers they fit, limits, and whether a slicer worker is up. 503 while no printer or filament is offered |
| `GET /api/print/drafts` · `POST /api/print/drafts` | My drafts; a new draft from its first upload, which needs the slicer training (multipart `file`, `settings` JSON, `object` placement JSON). `PRINT_DRAFT_MAX` each |
| `GET /api/print/drafts/:id` · `PATCH` · `DELETE` | The plate: models, copies, profile ids and labels, settings, `revision`, slice state. `PATCH { revision, printerId?, processId?, filamentId?, overrides?, objects? }` replaces the copies; a stale revision is a 409, and so is a profile that's hidden, gone, still being resolved, or doesn't fit the printer. An edit only checks the profiles it changes |
| `POST /api/print/drafts/:id/models` | Multipart: add a model and one copy, naming the revision. A STEP waits for the worker to mesh it |
| `POST /api/print/drafts/:id/slice` | `{ revision }`. Queues the plate for the worker, or reuses a slice of the identical plate. 503 with no worker; 409 unless all three profiles are usable; `PRINT_SLICES_PER_HOUR`, one plate slicing per member |
| `GET /api/print/drafts/:id/preview` · `GET /api/print/models/:id/mesh` | The gzipped layer preview and a model's STL, for the owner (and officers once sent). `no-store` |
| `POST /api/print/drafts/:id/submit` · `POST /api/print/:id/unsubmit` | Send a plate whose slice is current (`{ revision, projectId?, notes? }`); copies Orca's estimate onto the request. Unsubmit takes a waiting plate back to a draft |
| `POST /api/print/training` | Signed in, no dues needed. Records the slicer training as finished (`slicerTrainedAt`, once). The workspace read and making, editing, slicing, sending or unsubmitting a plate answer 403 until it's set; reading and discarding drafts don't |
| `GET /api/equipment` | Current dues. The catalogue with live `available` counts and `maxLoanDays` |
| `POST /api/equipment/:id/loans` · `POST /api/equipment/loans/:id/cancel` | One open loan per person per item. `requestedDueAt` required; a future `startAt` makes a booking; capped at `maxLoanDays` |

### Projects, events and tasks

| Route | Notes |
| --- | --- |
| `POST /api/projects/:id/join` | Requires current dues |
| `DELETE /api/projects/:id/members/me` | Leave. The only lead may leave; officers get a DM |
| `GET /api/projects/:id/team` | Members only. Teams and roster, no emails |
| `PATCH /api/projects/:id` | Project lead. Slug and `featured` aren't editable. Takes the meeting schedule (a `meetingRepeat` pattern with its fields and both times, plus `meetingTimes` for days on other hours, or `meetingRepeat: null` to clear it), `meetingsPublic` (officers only), `discordRoleId` (pushes role changes immediately), the cover and its framing, and section headings. Returns `managedProjectSelect` plus `description` |
| `GET /api/projects/:id/meetings` | Project lead. The rest of the term's meetings from the start of today, cancelled ones marked |
| `PUT /api/projects/:id/meetings/:date/cancel` · `DELETE` | Project lead. Calls off, or restores, the meeting on one campus date (`YYYY-MM-DD`) with an optional `reason`. 404 if the schedule has no meeting that day |
| `POST /api/projects/:id/cover` | Project lead. Multipart; replaces and deletes the old upload |
| `POST /api/projects/:id/images` · `/images/upload` | Project lead. By URL or file, max 12, framing accepted with the picture |
| `PATCH /api/projects/:id/images/order` | Project lead. The complete list of ids or it's refused |
| `PATCH` / `DELETE /api/projects/:id/images/:imageId` | Project lead. Caption and framing (each only if sent), or remove |
| `PATCH /api/projects/:id/links` | Project lead. Replaces the resources list, max 10 |
| `POST /api/projects/:id/documents` · `PATCH`/`DELETE /documents/:docId` · `POST /documents/:docId/file` | Project lead. Publish, edit, withdraw or revise a document |
| `DELETE /api/projects/:id` | Project lead. Deletes uploaded gallery images and the cover too |
| `POST /api/projects/:id/teams` · `PATCH`/`DELETE /api/teams/:id` | Project lead |
| `PATCH` / `DELETE /api/projects/:id/members/:userId` | Project lead (officers too). Rank up to `TEAM_LEAD`; `title` is free text under the same rules as the profile's, with a lead title needing a lead rank on this project. A lead may change their own row's title, nothing else on it |
| `POST` / `DELETE /api/teams/:id/members/:userId` | Team lead, own team, plain members only |
| `POST /api/events` · `PATCH`/`DELETE /api/events/:id` | The team's lead, the project's lead, or an officer for club-wide events (no `projectId`). Created unpublished; only officers publish. Can't move between projects |
| `GET`/`POST /api/projects/:id/tasks` · `PATCH`/`DELETE /api/tasks/:id` | Leads, scoped to their team. `POST` refuses a project not running this term (409, checked before permissions). Edits and deletes aren't restricted |
| `POST /api/tasks` | Officers only. A task with no project; at least one assignee, also enforced on edit |
| `POST /api/tasks/:id/status` | Assignees and leads. Any of `OPEN`, `IN_PROGRESS`, `DELAYED`, `DONE`, `CANCELED`. Only `DONE` sets `completedBy`/`completedAt` |
| `POST /api/tasks/:id/calendar` | `{ onCalendar }`. Assignees only, per person. 403 for others |

### Officer desks

All officer-only (`requireOfficer`, which includes the dues check).

| Route | Notes |
| --- | --- |
| `POST /api/officer/projects` | Create. `summary` and the meeting schedule are required. `discordRoleId` goes through `assertUsableRole`, which refuses the club's own roles and ids that aren't roles in the guild (skipped if Discord is down) |
| `POST /api/officer/projects/:id/duplicate` | Copies writing, schedule, links, gallery bytes and Discord role to a new term; not people, teams, tasks or events. Resets status and `featured` |
| `PATCH /api/officer/projects/:id/members/:userId/rank` | `PROJECT_LEAD` or `MEMBER`. 409 naming the incumbent |
| `GET /api/officer/members` | `?query=` (2+ characters), matching name, email or Discord handle; ten results |
| `POST /api/officer/members/:id/membership` | Grant a term with no money: a zero-amount `DuesPayment` recording who granted it |
| `PATCH /api/officer/members/:id/title` | `{ title }`, null or blank to clear. Overwrites the title a member set on their profile; they can still change it afterwards. The profile's rules apply to the person being titled, so the desk can't hand out an office or a lead title either |
| `GET /api/officer/survey` · `/survey/export.csv` | Tallies per live question with every option including zeroes, plus responded/outstanding counts. The CSV has names and contacts, is `no-store`, and prefixes cells starting `=`, `+`, `-` or `@` with an apostrophe |
| `GET`/`POST /api/officer/survey/questions` · `PUT`/`DELETE /questions/:id` | `PUT` takes the whole question and its ordered options; missing options are retired if answered, deleted otherwise. Changing `kind` after answers is a 409. `DELETE` returns `{ removed: 'archived' \| 'deleted' }` |
| `POST /api/officer/survey/questions/:id/restore` · `POST /survey/reorder` | Restore appends to the end. Reorder needs the full live set (409 otherwise) |
| `POST /api/officer/hero-slides` · `/hero-slides/upload` | Add by link or file, framing optional. 409 at eight |
| `PATCH /api/officer/hero-slides/order` | Full list of ids (409 otherwise). Registered before `/:id` |
| `PATCH` / `DELETE /api/officer/hero-slides/:id` | Caption and framing, each only if sent. No URL change; replace by removing and adding. Deleting removes uploaded bytes only |
| `PUT /api/officer/front-page/copy` | Headline (both lines), lede, partner intro, together. No clearing route |
| `POST /api/officer/front-page/faqs` · `PATCH`/`DELETE /faqs/:id` · `PATCH /faqs/order` | Max twenty. The edit schema is written out, not `.partial()`, so `steps` isn't reset |
| `POST /api/officer/front-page/partners` · `PATCH`/`DELETE /partners/:id` · `PATCH /partners/order` | Max six. `href` through `webUrl`. An empty list hides the section |
| `POST` / `DELETE /api/officer/front-page/partners/:id/image` | Upload or replace the card image |
| `PUT /api/officer/about` | The whole about page in one transaction; the timeline is replaced. The API's only unfiltered `deleteMany` |
| `GET /api/officer/sponsors` | `{ sponsors, tiers, inKind }`, including hidden sponsors and an entry for every tier |
| `POST /api/officer/sponsors` · `PATCH`/`DELETE /sponsors/:id` | Names unique case-insensitively. The PATCH schema has no defaults. `active: false` hides; `DELETE` is for mistakes |
| `POST` / `DELETE /api/officer/sponsors/:id/logo` | Upload or replace the logo. A logo link goes through the PATCH |
| `PUT` / `DELETE /api/officer/sponsors/tiers/:tier` | Upsert a tier's price sheet. An omitted `blurb` clears it. The row existing is the publication |
| `PUT /api/officer/sponsors/sheet` | `{ footnotes }`; empty string clears |
| `POST /api/officer/sponsors/in-kind` · `PATCH`/`DELETE /in-kind/:id` · `PATCH /in-kind/order` | Max six. Full list for reorder. Registered before `/:id` |
| `GET /api/officer/print-queue?status=&all=` · `PATCH /api/officer/print/:id` | Drafts never appear. `all=1` returns every status. Settling deletes every file the request holds. On a sliced plate `DONE` charges `ceil(estimatedGrams)` unless `gramsUsed` is sent, and `printed` is refused; otherwise `gramsUsed` is required for a personal `DONE`. `overAllowance` to exceed the cap. Moving to `PRINTING` stamps `startedAt` |
| `GET /api/officer/print/:id/slice-file` | The sliced plate's `.3mf`, for desktop OrcaSlicer |
| `GET /api/officer/slicer-profiles` | Every printer with its processes, and every filament: state, the worker's refusal, what it read out of each, and how many drafts and unsettled requests name it |
| `POST /api/officer/slicer-profiles/inspect` | Multipart `file`: the presets in an Orca export (`.orca_printer`, `.orca_filament`, a zip, one `.json`). Saves nothing |
| `POST /api/officer/slicer-profiles` | Multipart `file`, `entries` (JSON list), `printerId` for processes whose printer isn't in the file. Adds them QUEUED for the worker. One printer per upload; names are unique per kind (per printer for a process); `MAX_PROFILES` in all |
| `PATCH /api/officer/slicer-profiles/:id` · `PATCH .../order` | `{ label?, description?, offered? }`; `{ ids }` is one whole list in its new order |
| `POST /api/officer/slicer-profiles/:id/replace` · `DELETE .../:id` | A newer export of the same kind (`file`, `entry` when it holds several), queued again; a printer's processes are queued with it. Deleting takes a printer's processes; drafts' columns go null |
| `GET`/`POST /api/officer/equipment` · `PATCH /api/officer/equipment/:id` | `maxLoanDays` defaults to 7 on create; PATCH has no defaults. Names unique case-insensitively |
| `DELETE /api/officer/equipment/:id` | Deletes the item and its loans. Refused while a unit is out. Retiring is the reversible option |
| `GET /api/officer/loans?status=&all=` · `PATCH /api/officer/loans/:id` | Availability re-checked in the transaction. No `REQUESTED` → `CHECKED_OUT`. `dueAt` defaults to the member's date or the item's cap |
| `GET /api/officer/terms` · `PATCH /api/officer/terms/seat` | Today's board. Taking a held seat is a 409 naming the incumbent unless `takeOver: true`, which closes their term as "Succeeded by …" in the same transaction. Terms created here are `MANUAL` and the sync won't close them. `position: null` clears a seat |
| `DELETE /api/officer/terms/:userId` | Closes the open term, publishing it to `/officers`. The sync reopens one if they still hold the Discord role |
| `GET /api/officer/archive` · `POST` · `PATCH`/`DELETE /archive/:id` | Every officer term. `userId` optional; `fullName` stored on the term. The one-per-seat 409 applies to open terms. PATCH treats absent fields as unchanged and checks dates on the resulting row. `source` isn't writable |
| `POST` / `DELETE /api/officer/archive/:id/photo` | A term headshot, shown only when no account is linked |
| `GET /api/officer/semesters/:year` | The three terms and their source (`override`, `calendar`, `fallback`), plus finals dates and source (null when unset) |
| `PUT` / `DELETE /api/officer/semesters/:year/:season` | Club dates that override UCF's feed. Finals dates both or neither, inside the term. Flushes the semester cache. Affects future payments only |
| `PATCH /api/lab` | `{ open }`. Opening is a 409 between 10pm and 8am Orlando time; closing always works; no-op writes nothing. Renames the Discord channel first and writes the row only if that worked: a 429 carries the rename cooldown (two per ten minutes), a 502 names Manage Channels. The sign in the channel is edited in place either way, and mentions nobody |

### Webhooks

| Route | Notes |
| --- | --- |
| `POST /api/stripe/webhook` | Stripe's deliveries. Signature-verified, never authenticated |
| `POST /api/discord/interactions` | Button presses when an Interactions Endpoint URL is registered; otherwise presses arrive over the gateway (`src/discord/discordGateway.ts`). Ed25519 over the raw body with `DISCORD_PUBLIC_KEY`; 401 on a bad signature, which Discord requires. Officers only, by Discord role or site role; dues aren't checked. Replies are ephemeral and deferred when work is needed |

### Stored files

Uploads are `bytea` rows served from `/api/files/<id>`. An image column holding
that prefix is an upload and gets cleaned up; anything else is an external URL
and is never touched.

- A request's files (a resin model, a plate's models and STEP meshes, its
  `.3mf` and preview) are deleted when it's settled, withdrawn, discarded or
  expired, in the same transaction (`src/printing/printLifecycle.ts`). The
  request keeps its name, size and outcome. `.3mf` and preview files are never
  served from `/api/files`.
- A replaced image is deleted immediately, including when swapped for an
  external URL.
- Cascades delete rows, not bytes. Nothing in Postgres knows `/api/files/...` is
  a reference, so `DELETE /api/projects/:id` removes gallery files by hand first.
  Any new table with an image column needs the same. `files.test.ts` checks it.

### Printing allowance

Each member gets `PERSONAL_PRINT_GRAMS` (default 500) per term for personal
prints; project prints are uncapped. The balance is never stored:
`src/printing/printAllowance.ts` sums `grams_used` on the member's `DONE`,
project-less requests for the term.

- The term is stamped when the request is sent.
- It uses `currentTerm`, so summer counts as a term.
- Only the officer route writes `grams_used`. On a sliced plate it defaults to
  Orca's estimate rounded up; otherwise it's required for a personal `DONE`.
  It's refused on a decline.
- Exceeding the cap needs `overAllowance: true`, and the balance can go
  negative.
- Billing a print to a project needs a real membership row; officers get no
  exception.

### Queues and borrowing

- Both officer queues take `?all=1` (a literal `'1'`; `z.coerce.boolean()` reads
  `"false"` as true) so the search box can find settled rows. Live work sorts
  oldest first; settled work newest first, since `take` cuts at a hundred.
- An officer approves before an item leaves and checks it back in.
- `requestedDueAt` and `startAt` are the member's and stay beside the officer's
  `dueAt`.
- Every loan date goes through `loanDate`, which bounds dates to ten years;
  `z.coerce.date()` alone accepts year `+275760`.
- Retire with `active: false` to keep history. `DELETE` cascades through the
  loans and is refused while a unit is out.
- Each item's `max_loan_days` (default a week) caps the member's request, not the
  officer. `src/equipment/loanWindow.ts` counts whole days, mirrored by
  `web/src/lib/equipment/borrowing.ts`.
- A reservation holds its unit from approval, not from its start date.
- `src/equipment/equipmentReminder.ts` DMs borrowers when a loan is due within
  `RETURN_REMINDER_LEAD_HOURS` (default 36). `equipment_loans.reminded_for` holds
  the deadline named, which deduplicates and re-arms if the date moves. Overdue
  loans aren't chased.

### Tasks

`src/routes/projects/tasks.ts` decides permissions; `src/discord/taskReminder.ts`
is the reminder.

- Five statuses, sorted by declaration order: `OPEN`, `IN_PROGRESS`, `DELAYED`,
  `DONE`, `CANCELED`.
- A new task may only go on a project running this term (`requireCurrentProject`,
  exact match with `currentTerm()`). Editing, ticking and deleting aren't
  affected, nor are project-less tasks. Officers are refused too.
- `task_assignees.on_calendar` is per person. Opted-in deadlines appear only on
  that member's `/api/me/events` as `task:` entries.
- The reminder DMs assignees of an unsettled task once `dueAt` is more than
  `TASK_OVERDUE_GRACE_MINUTES` (default 30) past. `TASK_OVERDUE_LOOKBACK_DAYS`
  stops the first run after a deploy chasing old tasks. `tasks.reminded_for`
  holds the deadline named. Recipients are resolved before claiming, so a Discord
  outage just retries. One message per person, not per task.

### Officers and seats

- `/api/officers` is separate from `/api/members?role=OFFICER`. A seat isn't a
  permission: the faculty advisor holds a seat as a `MEMBER`.
- `/officers` and `/officers/past` are `officer_terms` split on `ended_at`.
  Terms store the holder's name because most past officers have no account.
- The seats come from the `OfficerPosition` enum, so a new seat needs no
  frontend change. Officers with no seat are included.
- Seats are set on `/api/officer/terms/seat`, the archive on
  `/api/officer/archive`, and officer roles come from Discord. `source` records
  which wrote a term, and the sync only closes terms it opened.

### General

- The public API never returns emails, password hashes or users off the roster.
  Post authors expose only a name.
- `/auth/me` answers 200 with a null user when signed out.
- `/auth` and `/dues` are outside the cached block because their answers depend
  on the caller.

## Sessions and dues

Sessions are rows in `sessions` so they can be ended; only a SHA-256 of the
cookie is stored. The expiry is an idle timeout that authenticated requests roll
forward.

Two settings make cookies work once deployed, and both fail silently:
`SESSION_COOKIE_SAMESITE` stays `lax` while site and API share a registrable
domain (`none` only when they differ, which needs https), and CORS sends
`credentials: true` to match the frontend's `credentials: 'include'`.

Dues follow UCF's academic calendar from `calendar.ucf.edu`, cached a day, with
fixed fallback dates. `src/membership/semester.ts` holds the rules:

- Access is `duesPaidThrough > now`, for the website, the API and the Discord
  bot alike.
- The free window runs from the end of one dues-bearing term to three weeks into
  the next, covering summer, and is claimed. One claim covers May to September.
- $25 covers the current term; $50 covers it and the next fall or spring.
- A payment buys the term it's made in and ends with it (`billableTerm`); no
  rollover. Between terms it buys the next.

Money is credited only from Stripe's own record. The webhook and
`POST /api/dues/sync` both call `applyPayment`, idempotent on
`dues_payments.stripe_payment_intent_id`, since the two race and Stripe
re-delivers.

## Signup

Two requests with an email between them: `start` mails a link, `complete`
brings the token and the rest. Nothing about the person is stored until the
address is proved.

- Only `@ucf.edu`. The retired `@knights.ucf.edu` isn't accepted.
- The link goes to the frontend (`SITE_URL` + `/join`), which POSTs the token,
  so mail scanners following the link don't spend it.
- `SITE_URL` sets the site's address in one place, including the CORS
  allow-list. `CORS_ORIGINS` adds extra origins.
- For https: set `TRUST_PROXY=true` when TLS terminates at a proxy (or every
  visitor shares one rate-limit bucket), and build the frontend with an https
  `VITE_API_URL` (or the browser blocks calls as mixed content). The server warns
  about the first and the site logs the second. HSTS and the https redirect
  belong to the proxy.
- `acknowledgementAccepted` must be `true`, and the time is saved in
  `User.acknowledgementAcceptedAt`. The text is
  `web/src/assets/sample_aknowledgement.txt`.
- The email is hand-built HTML in `src/email/emails.ts` (tables and inline styles
  for Outlook), with link tracking off so the token isn't rewritten.
- The token is stored as a SHA-256 hash. Without Postmark the link is logged in
  development and signup is refused in production.
- The Discord handle is checked against the club's guild over REST
  (`src/discord/discord.ts`), matching `user.username`, not `global_name`. The
  bot needs the Server Members Intent. Without a bot token the handle is stored
  as typed.
- Email and handle are both unique, and the error names which was taken. New
  accounts are `GUEST` with no slug. Passwords are hashed with scrypt
  (`src/auth/password.ts`).

## Deploying

A merge to `main` deploys this, migrations included: the server polls the
branch and rebuilds the API image once CI passes, then restarts against the real
database with nobody watching. See [`../deploy/README.md`](../deploy/README.md).
For editing live data, see [Editing data by hand](#editing-data-by-hand).

Name both profiles on any compose command for the live stack. `web` (nginx)
depends on `api` in `app` (postgres, migrate, api), so naming one fails with
`service "web" depends on undefined service "api": invalid compose project`:

```bash
docker compose --profile app --profile web up -d
```

`--profile tools` (pgAdmin) is separate.

## Scaling

The API is stateless and scales by running copies:

```bash
docker compose --profile app --profile web up -d --scale api=3
```

A one-shot `migrate` service runs before any instance. Replicas publish on
`4000-4004`; put a reverse proxy in front before exposing them.

- Rate-limit windows are in Postgres (`src/core/rateLimit.ts`), counted with an
  atomic upsert, so they hold across replicas and deploys.
- `X-Forwarded-For` is trusted only with `TRUST_PROXY=true`.
- `instances × DATABASE_POOL_MAX` must stay under Postgres's `max_connections`
  (100). Three instances at the default 10 use 30. Add PgBouncer beyond that.
- Public GETs send `Cache-Control` with `s-maxage` and an ETag, so a CDN absorbs
  reads and repeat visitors get a 304.
- `SIGTERM` stops new connections, drains requests, then closes the pool.

Not instance-safe, deliberately: the lab sign serialises its Discord writes
within one process only. Across instances, the ten-minute reconcile reads the
message back, corrects the row and deletes stray bot messages.

Not built, since the data is small: Redis, read replicas, cursor pagination.
Revisit if `posts` reaches tens of thousands of rows.

## Layout

| Path | What |
| --- | --- |
| `docker-compose.yml` | Postgres on 5433; `app` adds migrate and api, `web` adds nginx, `tools` adds pgAdmin |
| `nginx.conf` | The `web` container: the bundle, with `/api/` proxied to the API |
| `Dockerfile` | API image; runs `prisma generate` at build |
| `prisma/schema.prisma` | Models |
| `prisma/migrations/` | Migration history; commit these |
| `prisma.config.ts` | Prisma 7 config; reads `DATABASE_URL` through dotenv |
| `src/generated/prisma` | Generated client, not committed |

### `src/`

`index.ts` starts the process (startup banner, sweep timers, Discord gateway).
`app.ts` is the middleware chain and every mount; read it first, since mount
order sets the cache boundary.

```
src/
├── index.ts          listen, log configuration, start the sweeps
├── app.ts            middleware and mounts, in cache-boundary order
├── core/             env.ts, db.ts (the one Prisma client), rateLimit.ts, validate.ts
├── auth/             session.ts, password.ts, authz.ts
├── discord/          discord.ts (REST), discordGateway.ts, discordRoles.ts,
│                     discordOfficers.ts, discordAlumni.ts, discordRecipient.ts,
│                     officerNotify.ts, taskReminder.ts
├── email/            mail.ts (Postmark), emails.ts (HTML)
├── lab/              labStatus.ts (sign, curfew, sweep), labInteraction.ts
├── membership/       semester.ts, membershipSweep.ts
├── printing/         printAllowance.ts, printSettings.ts, printLifecycle.ts, and the
│                     slicer: processSettings.ts, plateTransform.ts, sliceJobs.ts,
│                     orcaRunner.ts, orcaProject.ts, sliceArchive.ts, gcodePreview.ts,
│                     profiles.ts, profileResolve.ts, profileJobs.ts, profileWork.ts
├── worker.ts         the slicer worker's process (orca/Dockerfile)
├── equipment/        loanWindow.ts, equipmentReminder.ts
├── projects/         meetings.ts, projectMeeting.ts, projectTerm.ts, projectLead.ts
├── files/            files.ts: stored bytes and when they're deleted
├── payments/         stripe.ts
└── routes/           grouped by who may call them
```

| Folder | Who reaches it | Files |
| --- | --- | --- |
| `routes/public/` | anyone | `content.ts`, `forms.ts`, `files.ts`, `lab.ts` |
| `routes/account/` | someone managing their own account | `auth.ts`, `signup.ts`, `account.ts` |
| `routes/member/` | signed-in members, behind the dues gate (`survey.ts` excepted) | `me.ts`, `dues.ts`, `survey.ts`, `print.ts`, `printDrafts.ts`, `equipment.ts` |
| `routes/projects/` | project members and leads | `projectManage.ts`, `tasks.ts`, `eventManage.ts` |
| `routes/officer/` | officers | `officer.ts`, `surveyAdmin.ts`, `heroSlides.ts`, `frontPage.ts`, `sponsorsAdmin.ts`, `aboutPage.ts`, `officerArchive.ts` |
| `routes/webhooks/` | Stripe and Discord, by signature | `stripeWebhook.ts`, `discordInteractions.ts` |

The folders follow reachability. `lab.ts` is a public read with an officer-only
`PATCH` and is mounted ahead of the cached block. `aboutPage.ts` is in
`officer/` because `requireOfficer` is its gate, though its form is on `/about`.

Tests sit beside what they test. They run against the real development
database, so each suite prefixes its fixtures and deletes by that prefix.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | API with watch reload |
| `npm start` | API, single run |
| `npm run studio` | Prisma Studio on :5555 |
| `npm run db:up` | Start Postgres |
| `npm run db:down` | Stop it, keeping data |
| `npm run db:reset` | Delete the volume and start fresh |
| `npm run db:logs` | Tail Postgres logs |
| `npm run migrate` | `prisma migrate dev` |
| `npm run generate` | Regenerate the client |
| `npm run seed` | Load development data (safe to re-run; refuses a real database without `--force`) |
| `npm test` | Tests against the dev database |
| `npm run typecheck` | `tsc --noEmit` |

## Notes

- Port 5433, not 5432, so a local Postgres doesn't collide. The compose project
  is `rccf-v13`.
- The Postgres 18 volume mounts at `/var/lib/postgresql`, not `.../data`; 18+
  refuses to start otherwise. Don't work around it with `PGDATA`, which writes to
  the container layer.
- Prisma 7 uses driver adapters (no Rust engine), so `PrismaClient` is built with
  `PrismaPg` in `src/core/db.ts`.
- Run `prisma generate` after pulling schema changes.
- Enum order matters. Postgres sorts by declaration order and Prisma only diffs
  the set, so reordering in `schema.prisma` yields an empty migration. Write the
  `CREATE TYPE` / `ALTER TABLE ... USING` swap by hand.
- Locally the frontend calls this API cross-origin. To use same-origin paths,
  add an `/api` proxy to `vite.config.ts`.
