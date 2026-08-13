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
user, jump straight to their subteam). It serves on **http://localhost:5555**
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
  Both paths go through `membershipUpdateFor` in `src/routes/dues.ts`, and
  neither ever overwrites a role an officer chose or invents a `slug`.
- **A lapsed `MEMBER` goes back to `GUEST`, live.** `demoteIfLapsed` runs inside
  session resolution, so it lands on their next request; `sweepLapsedMembers` on
  the ten-minute timer is the backstop for everybody who has stopped turning up.
  Both: only `MEMBER`, only accounts with a payment on record, and the sweep
  never runs when UCF's calendar could not be read.

**The role is not the gate; the standing is.** What somebody may *do* is decided
by `membershipStanding` at the moment of the request. With dues owed the
dashboard is `/api/dues/*` and `/api/me/*` — your payment page and the projects
you are already on — and everything else is refused: 3D printing, equipment
borrowing and every management tool. See `requireCurrentDues` and
`requireDuesForRoute` in `src/authz.ts`. A lapsed lead or officer keeps their
rank and loses the tools. `ADMIN` is exempt, always. `discordUsername` hangs off the same row for the Discord
integration.

Two things follow from that, and both are easy to get wrong:

- **Declaration order is load-bearing twice.** It is the permission ranking, and
  because Postgres sorts an enum by declaration order it is also the roster
  display order that `orderBy: { role: 'asc' }` depends on.
- **A slug is what makes someone public.** `slug`, `email` and `passwordHash`
  are all optional: a roster entry may have no login, and a login may have no
  roster entry. Public routes list users with a slug whose role isn't `GUEST`;
  everyone else is invisible to the site. Nothing generates a slug — not even
  paying dues, which grants the role and stops there. Publishing somebody's name
  and photo is a decision for a person, and it stays one.

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
| `MEMBER`       | Read the project, tick tasks assigned to them                    |

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
there. No value of `UserRole` says anything about any project. `src/authz.ts` is
the only place any of this is decided, and `src/authz.test.ts` is the matrix
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
| `GET /api/stats`         | The landing page's counts — each equals the listing it links to |
| `GET /api/subteams`      | Includes an active-member count                     |
| `GET /api/members`       | The roster. `?subteam= &role= &status=active\|alumni\|all` |
| `GET /api/officers`      | The board, in seat order — see below                |
| `GET /api/members/:slug` | Adds the member's projects                          |
| `GET /api/projects`      | `?status= &season= &featured=true`                  |
| `GET /api/projects/:slug`| Adds description and the credited members           |
| `GET /api/events`        | `?when=upcoming\|past\|all &type= &from= &to=` — published only |
| `GET /api/events/:slug`  | Published only                                      |
| `GET /api/posts`         | Published and not future-dated; no body             |
| `GET /api/posts/:slug`   | Adds the body                                       |
| `GET /api/sponsors`      | `?tier=` — active only, ordered by tier             |
| `POST /api/contact`      | `{ name, email, subject?, message }` → 201          |
| `POST /api/signup/start` | `{ email, acknowledged }` → 202, and emails a link   |
| `POST /api/signup/verify`| `{ token }` → `{ email }`                           |
| `POST /api/signup/discord-check` | `{ discordUsername }` → `{ status }`        |
| `POST /api/signup/complete` | `{ token, firstName, lastName, password, discordUsername, acknowledgementAccepted }` → 201 |
| `POST /api/auth/login`   | `{ email, password }` → `{ user }`, and sets the session cookie |
| `POST /api/auth/logout`  | Ends the session; works from a stale cookie too      |
| `GET /api/auth/me`       | `{ user }` or `{ user: null }` — **200 either way**  |
| `GET /api/dues/status`   | Signed in. Membership, prices, coverage dates, history |
| `POST /api/dues/checkout`| Signed in. `{ plan: SEMESTER\|YEAR }` → a Stripe payment intent |
| `POST /api/dues/sync`    | Signed in. `{ paymentIntentId }` → asks Stripe how it went |
| `POST /api/dues/activate`| Signed in. Claims the free summer or between-terms break — promotes a `GUEST` to `MEMBER`, same as paying |
| `POST /api/stripe/webhook` | Stripe's own deliveries. Signature-verified, never authenticated |

Then the dashboard's own surfaces. Every one of them is signed in, answers
per-caller, and is mounted **before** the public routes in `src/app.ts` so the
shared-cache headers never touch them.

| Route                    | Notes                                              |
| ------------------------ | -------------------------------------------------- |
| `GET /api/me/projects`   | My memberships: project, rank, team                 |
| `GET /api/me/events`     | `?from= &to=` — published events plus my projects' unpublished ones |
| `GET /api/me/tasks`      | The open tasks assigned to me, nearest deadline first |
| `GET /api/me/print-requests` | Mine, newest first. `fileId` is null once settled |
| `GET /api/me/print-allowance` | Grams left for my own prints this term. Counted, never stored |
| `GET /api/me/loans`      | What I have borrowed and asked for                  |
| `POST /api/projects/:id/join` | Refused unless `membershipStanding().hasAccess` |
| `DELETE /api/projects/:id/members/me` | Leave. **Including the only project lead**, which leaves the project leaderless and DMs the officers so somebody knows — the old refusal told them to have an officer appoint another first, which nothing can satisfy now a project has one lead. Writes no roles at all: leaving changes what you run, not what you are |
| `GET /api/projects/:id/team` | Members-only. Teams and roster, no email addresses |
| `PATCH /api/projects/:id` | Project lead. Slug and `featured` are not editable. Answers with `managedProjectSelect` **plus `description`** — the editor rebuilds its state from the write rather than re-reading the publicly cached page, so a column this route accepts and does not answer with comes back `undefined` and leaves the form permanently unsaved |
| `POST /api/projects/:id/cover` | Project lead. Multipart image; replaces and deletes the old upload |
| `POST /api/projects/:id/images` · `/images/upload` | Project lead. The public page's gallery, by URL or as a file. Capped at 12 a project; uploads are sniffed and size-capped, and the browser shrinks them first. Both take `focalX`/`focalY`/`zoom` **at add time** — a gallery assembled on the create page is framed before the project exists, and framing arriving separately could fail on its own and leave a photo sitting wrong. The upload reads them off the multipart body, ignoring anything unparseable |
| `PATCH /api/projects/:id/images/order` | Project lead. The whole order, as a list of ids — refused unless the set matches exactly, which is what stops one tab dropping another's newest photo |
| `PATCH`/`DELETE /api/projects/:id/images/:imageId` | Project lead. Caption and framing (`focalX`/`focalY`/`zoom` — CSS at display time, never baked into the file), or removal. Every field is applied only when sent, so a caption edit cannot re-centre a framed picture. Removing an upload deletes the file with it |
| `PATCH /api/projects/:id/links` | Project lead. The `/ RESOURCES` list, replaced wholesale. Max 10; an empty array clears it |
| `DELETE /api/projects/:id` | Project lead. Sweeps every uploaded gallery picture as well as the cover |
| `POST /api/projects/:id/teams` · `PATCH`/`DELETE /api/teams/:id` | Project lead |
| `PATCH`/`DELETE /api/projects/:id/members/:userId` | Project lead. Rank up to `TEAM_LEAD` only — and **this is the route officers use to appoint a team lead too**, since `requireProjectLead` waves them through. `title` is the free-text display string, renamed from `role`; zod strips unknown keys, so a caller still sending `role` gets a 200 that stores nothing |
| `POST`/`DELETE /api/teams/:id/members/:userId` | Team lead, own team, plain members only |
| `POST /api/events` · `PATCH`/`DELETE /api/events/:id` | Leads. Created unpublished; only officers may publish |
| `GET`/`POST /api/projects/:id/tasks` · `PATCH`/`DELETE /api/tasks/:id` | Leads, scoped to their team |
| `POST /api/tasks/:id/status` | Assignees **and** leads — the one looser check      |
| `POST /api/print` · `DELETE /api/print/:id` | **Members only** — a `GUEST` is refused whatever their standing. Multipart `.stl`/`.step`, size-capped, sniffed. Settings paired FDM/SLA; `quantity` 1–50, default 1; `projectId` needs a real membership |
| `GET /api/equipment`     | **Members only.** The catalogue with a live `available` count and each item's `maxLoanDays` |
| `POST /api/equipment/:id/loans` · `POST /api/equipment/loans/:id/cancel` | One open loan per person per item. `requestedDueAt` is **required**; `startAt` in the future makes it a booking. The window is refused past the item's `maxLoanDays` |
| `GET /api/files/:id`     | Images public and immutable; print models owner-or-officer, `no-store` |
| `POST /api/officer/projects` | Officers only, without limit, naming a lead or leaving it for later. `summary` is required; `description` and `repoUrl` are accepted here because they are columns on the project, which is part of what lets the desk fill the whole thing in on one page — pictures and links are held in the browser and sent straight after |
| `PATCH /api/officer/projects/:id/members/:userId/rank` | Appoint or stand down a project lead, `PROJECT_LEAD` or `MEMBER`. **409 naming the incumbent** if the project already has a lead — stand them down first; re-appointing the sitting lead is a no-op 200. Writes no roles: appointing yourself as an officer costs you nothing by construction |
| `GET /api/officer/members` | `?query=` — the people picker. Matches name, email **and Discord handle**, because an account may carry a handle and no email |
| `GET /api/officer/print-queue?status=&all=` · `PATCH /api/officer/print/:id` | `all=1` returns every status, for the browser's search. Settling **deletes the uploaded model**. `gramsUsed` required for a personal DONE; `overAllowance` to go past the cap. Moving to `PRINTING` stamps `startedAt`, which is what later tells a cancelled print from a declined request |
| `GET`/`POST /api/officer/equipment` · `PATCH /api/officer/equipment/:id` | `maxLoanDays` defaults to 7 on create; the PATCH schema carries **no** defaults, so a partial edit cannot reset a field it did not name. Name collisions are **case-insensitive** and answered with what to do instead |
| `DELETE /api/officer/equipment/:id` | Really deletes, cascading every loan against it. Refused while a unit is out. Retiring (`active: false`) is the reversible one |
| `GET /api/officer/loans?status=&all=` · `PATCH /api/officer/loans/:id` | `all=1` returns every status. Availability re-checked inside the transaction. **No REQUESTED → CHECKED_OUT**: approval comes first. A move that holds a unit fills `dueAt` in when the officer types none — from the member's date, or the item's cap |

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

### Two gates, and why they are separate

`requireCurrentDues` asks whether somebody's dues are current, from
`membershipStanding` and never from the role. `requireClubMember` adds a second,
independent question — whether they are a member at all — and refuses a `GUEST`
outright. Both are in `src/authz.ts`; only 3D printing and equipment borrowing
use the second.

The reason they cannot be one check: the summer, the break between terms and the
trial fortnight all report `hasAccess: true` for **everyone**, because that is
what makes those periods free. Standing alone would therefore let an account
created ten minutes ago order prints and borrow tools. Nothing is lost by the
stricter gate — paying promotes a guest to member, and so does claiming a free
window, which costs nothing and is one press.

### The 3D printing material allowance

Every member gets `PERSONAL_PRINT_GRAMS` — 500 by default — of material for
their **own** prints in one term, filament and resin together. A print marked
for a project costs nothing against it: the club's decision was that project
prints are uncapped, on the honour system and the officer's discretion.

**The balance is never stored.** It is the club's figure minus the summed
`grams_used` of that member's `DONE`, project-less requests stamped with the
term — counted when asked, exactly the way equipment availability is counted.
`src/printAllowance.ts` is the only place that arithmetic lives, and a column
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
counted in floored whole days by `src/loanWindow.ts`, which the browser mirrors
in `web/src/lib/borrowing.ts` so the form never offers something the route will
refuse.

**A reservation holds its unit from approval, not from its start date.** A drill
booked for next month is off the shelf as soon as an officer says yes. That is a
real cost, deliberately taken: the availability count is a count, and overlapping
windows to work out whether the drill is back in time would promise a physical
object on the strength of a date somebody typed. The club can lend the same drill
twice by hand; it cannot un-lend one.

**The bot gives a day's notice.** `src/equipmentReminder.ts` runs on the
ten-minute timer and DMs anybody whose checked-out loan falls due inside
`RETURN_REMINDER_LEAD_HOURS` — 36 by default, because a due date is the *end* of
the day it names and a flat 24 would fire around midnight. The claim is
`equipment_loans.reminded_for`, which holds **the deadline the message named**:
that one value deduplicates across instances and restarts, and re-arms itself
when an officer moves the date. Nothing chases an already-overdue loan; that
needs an officer, not a robot.

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
year cannot depend on somebody else's uptime. `src/semester.ts` is the whole of
that logic and the rules it encodes:

- Summer is free, and so is the gap between one term ending and the next
  beginning.
- The first two weeks of a fall or spring term are free for everybody.
- $25 covers the term it was bought against; $50 covers that term and the next
  dues-bearing one — fall then spring, or spring then fall.

Money is only ever credited from Stripe's own account of a payment, never from
the browser. The webhook and `POST /api/dues/sync` both funnel into one
`applyPayment`, which is idempotent on `dues_payments.stripe_payment_intent_id`
— the two routinely race on a fast card, and Stripe re-delivers besides.

The "your free trial has ended" message is sent by the Discord bot, once per
person per term. The sweep claims a row in `trial_notices` — the primary key is
`(user, year, season)` — *before* sending, so a second API instance collides and
does nothing. That makes it at-most-once rather than at-least-once, deliberately:
somebody who hears nothing finds out from the dues page, and somebody who hears
four times has been annoyed by the club's own robot.

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
- **The email is hand-built HTML** in `src/emails.ts`, themed like the site:
  tables and inline styles, because Outlook renders through Word. Link tracking
  is turned off explicitly — it would rewrite a token-bearing URL through a
  redirect on the one email asking someone to trust the link.
- **The token is stored as a SHA-256 hash** and never appears in a response.
  With no Postmark token configured the API logs the link instead, in
  development only; in production it refuses to start a signup at all, because
  an address nobody can confirm is an account nobody can finish.
- **The Discord username is checked against the club's guild** by a bot, over
  REST — see `src/discord.ts`. It matches `user.username` and never
  `global_name`, because typing the display name is the mistake nearly everyone
  makes. `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` are optional as a set; with
  them unset the handle is stored exactly as typed and the API says so at
  startup. The bot must be in the guild and needs the Server Members Intent.
- **Both the address and the handle are unique**, and the route reports which of
  the two was taken. The account is created at the default `GUEST` role with no
  slug, which keeps it off the public roster until an officer promotes it.
- **Nothing signs in yet.** The password is hashed with scrypt
  (`src/password.ts`) and stored; there is still no login route to check it
  against.

## Scaling

The API holds no state of its own, so it scales by running more copies:

```bash
docker compose --profile app up -d --scale api=3
```

A one-shot `migrate` service applies migrations before any instance starts, so
replicas never race on the migration table. Replicas publish onto the
`4000-4004` host range; put a real reverse proxy in front before exposing this.

What makes more than one instance safe:

- **Rate limit windows live in Postgres**, not process memory (`src/rateLimit.ts`).
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

What is deliberately *not* built, because the row counts don't justify it: no
Redis, no read replicas, no cursor pagination. Members, projects, and events
stay in the hundreds for a club — `limit`/`offset` is fine there, and swapping
it out would add complexity for no measurable gain. Revisit if `posts` ever
reaches tens of thousands of rows.

## Layout

| Path                  | What it is                                                   |
| --------------------- | ------------------------------------------------------------ |
| `docker-compose.yml`  | Postgres on 5433; `app` profile adds migrate + api, `tools` adds pgAdmin |
| `Dockerfile`          | API image; runs `prisma generate` at build so client matches schema |
| `prisma/schema.prisma`| Models                                                        |
| `prisma/migrations/`  | Migration history — commit these                              |
| `prisma.config.ts`    | Prisma 7 config; reads `DATABASE_URL` from `.env` via dotenv  |
| `src/app.ts`          | Middleware chain and route mounting                           |
| `src/env.ts`          | Validated env — the process refuses to start on a bad `.env`  |
| `src/rateLimit.ts`    | Postgres-backed limiter shared by every instance              |
| `src/db.ts`           | The shared `prisma` client — import this, never construct one |
| `src/generated/prisma`| Generated client. Not committed; run `prisma generate`        |

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
  is constructed with `PrismaPg`. See `src/db.ts`.
- The client generates into `src/generated/prisma`, so run `prisma generate` after
  pulling schema changes.
- **Enum order is load-bearing for `UserRole`.** Postgres sorts an enum by
  declaration order and Prisma only diffs the value *set*, so reordering values
  in `schema.prisma` silently produces an empty migration. If you reorder them,
  write the `CREATE TYPE` / `ALTER TABLE ... USING` swap by hand — see
  `migrations/20260803215037_merge_member_into_user`.
- The frontend calls this cross-origin, allowed via `CORS_ORIGINS`. If you'd
  rather use same-origin paths, add a `/api` proxy to `vite.config.ts` instead.
