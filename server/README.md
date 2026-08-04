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

There is one `users` table for everyone the site knows about — the roster, the
people who can sign in, and anyone who has only signed up. `UserRole` is a
single ladder, most permission to least:

| Role           | Is                                                       |
| -------------- | -------------------------------------------------------- |
| `ADMIN`        | Full control, including other users                       |
| `OFFICER`      | Club leadership: captain, treasurer, and so on            |
| `PROJECT_LEAD` | Runs one project                                          |
| `TEAM_LEAD`    | Runs one subteam                                          |
| `MEMBER`       | On the roster                                             |
| `MENTOR`       | Faculty or industry mentor — on the roster, not in charge |
| `ALUMNUS`      | Was on the roster                                         |
| `GUEST`        | Signed up, nothing granted yet — **the default**          |

Joining the club is account signup, not a form submission — someone signs up,
lands at `GUEST`, and is promoted from there. `discordUsername` hangs off the
same row for the Discord integration that comes later.

Two things follow from that, and both are easy to get wrong:

- **Declaration order is load-bearing twice.** It is the permission ranking, and
  because Postgres sorts an enum by declaration order it is also the roster
  display order that `orderBy: { role: 'asc' }` depends on.
- **A slug is what makes someone public.** `slug`, `email` and `passwordHash`
  are all optional: a roster entry may have no login, and a login may have no
  roster entry. Public routes list users with a slug whose role isn't `GUEST`;
  everyone else is invisible to the site.

## API

Read routes are public and filter out anything unpublished. The one write route
is rate limited to 5 submissions per IP per 10 minutes.

| Route                    | Notes                                              |
| ------------------------ | -------------------------------------------------- |
| `GET /api/health`        | Also pings the database                             |
| `GET /api/subteams`      | Includes an active-member count                     |
| `GET /api/members`       | The roster. `?subteam= &role= &status=active\|alumni\|all` |
| `GET /api/members/:slug` | Adds the member's projects                          |
| `GET /api/projects`      | `?status= &season= &featured=true`                  |
| `GET /api/projects/:slug`| Adds description and the credited members           |
| `GET /api/events`        | `?when=upcoming\|past\|all &type=` — published only |
| `GET /api/events/:slug`  | Published only                                      |
| `GET /api/posts`         | Published and not future-dated; no body             |
| `GET /api/posts/:slug`   | Adds the body                                       |
| `GET /api/sponsors`      | `?tier=` — active only                              |
| `POST /api/contact`      | `{ name, email, subject?, message }` → 201          |

List routes take `?limit=` (max 100) and `?offset=`.

Email addresses and password hashes are never returned by the public API, and
neither are users who aren't on the roster. Post authors expose only a name.

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

- **Port 5433, not 5432.** The older stack in `Documents/RCCF-V13` holds 5432. The
  compose project is named `rccf-v13` so the two never share containers or volumes.
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
