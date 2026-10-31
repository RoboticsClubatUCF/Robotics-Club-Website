# Robotics Club of Central Florida website

The club's public site and its members' dashboard: signup, dues by card, 3D
print requests, equipment borrowing, project pages, and the officer
desks that run it.

```
.
├── package.json     runs both packages together
├── web/             frontend: Vite 8, React 19, Tailwind 4, DaisyUI 5
├── server/          backend: Postgres 18, Prisma 7, Hono 4
└── deploy/          what puts main on the live site
```

## Getting it running

You need Node.js 24+ and Docker Desktop, running (Postgres lives in a
container).

```bash
git clone https://github.com/RoboticsClubatUCF/Robotics-Club-Website.git
cd Robotics-Club-Website
cp server/.env.example server/.env
npm run setup
npm run dev
```

`npm run setup` installs both packages, starts Postgres, applies the schema,
generates the Prisma client and seeds development data. The first run pulls the
Postgres image (about 100 MB).

`server/.env` needs `POSTGRES_PASSWORD` and a matching `DATABASE_URL`; the rest
is optional and documented in the file. `web/.env` is optional too: copy
`web/.env.example` when you have a Stripe publishable key or the API isn't on
`localhost:4000`.

`npm run dev` starts Postgres if needed, then the API and the site with output
labelled `[api]` and `[web]`. Ctrl+C stops both. Open http://localhost:5173.

The stat strip under the hero should show numbers. A `—` means the API isn't
reachable; check the `[api]` output and the browser console. Sign in at
`/login` as `admin@rccf.local` with `SEED_ADMIN_PASSWORD` (default `changeme`)
to see the dashboard.

## What the site does

- Public pages: the landing page, projects, events, members, sponsors, the
  officer archive and the about page. Read-only and cacheable.
- Joining: `/join` takes a `@ucf.edu` address, emails a link, then collects a
  name, password, Discord handle and the member acknowledgement. New accounts
  start as `GUEST`.
- Signing in: `/login`, with a server-side session in an httpOnly cookie, and
  password reset at `/reset-password`.
- The dashboard: dues, 3D printing, equipment borrowing, project pages,
  and officer desks for roles, the officer archive, semester dates, the member
  survey, the front page, sponsors, projects, events and the print and equipment
  queues. `/about` and each project page are edited in place.

### Dues

Paid by card through Stripe. The server enforces the rules:

| Plan | Covers |
| --- | --- |
| $25 | the current semester, ending with it (between terms, the next one) |
| $50 | that semester and the next fall or spring |
| Free window | from the end of one fall/spring term to three weeks into the next, including summer; claimed with one press on the dues page |

Paying or claiming promotes a `GUEST` to `MEMBER`; a membership that runs out
drops back to `GUEST`. A member already covered is sold the next uncovered term.

Term dates come from UCF's academic calendar, with fixed fallback dates when it
can't be reached and officer overrides on the semesters desk.

## Optional services

Postmark, Discord and Stripe are each optional, and the server says at startup
which are on. Each is all-or-nothing: part of a set and the server refuses to
start.

| Unset | Effect |
| --- | --- |
| `POSTMARK_TOKEN` and friends | Contact messages are stored but not emailed. Signup works in development (the link goes to the API log) and is refused in production. |
| `DISCORD_BOT_TOKEN` and guild id | Discord handles are stored unchecked. No DMs, role syncing or lab-sign messages. |
| `STRIPE_SECRET_KEY` | The dues page says card payments are off and points at an officer. |

Set `STRIPE_WEBHOOK_SECRET` in production. Without it a member who pays and
closes the tab isn't credited until they reopen the dues page.

## Commands

From the repo root:

| Command | Does |
| --- | --- |
| `npm run dev` | Postgres, API and site together (`dev:api` or `dev:web` for one) |
| `npm run setup` | Install, migrate, generate, seed |
| `npm test` | Both test suites (`test:web`, `test:api` for one) |
| `npm run build` | Production build of the site |
| `npm run typecheck` | Server `tsc --noEmit` plus the web build |
| `npm run lint` | Oxlint |
| `npm run format` | Prettier in both packages |
| `npm run studio` | Prisma Studio on :5555 |
| `npm run db:up` / `db:down` | Start or stop Postgres (port 5433) |
| `npm run db:reset` | Delete the database volume and all its data |

`npm run typecheck` uses the web build because `tsc -b` follows project
references into the test files, which `tsc --noEmit` skips. CI catches what the
bare `tsc` misses.

## Deploying

Pushing to `main` deploys. The club's server polls `main` every couple of
minutes and, once CI passes on that commit, rebuilds whatever changed:
`web/**` rebuilds the bundle, `server/**` rebuilds the API and applies
migrations. It pulls because the server has no public address, and because a
self-hosted runner on a public repository would run pull-request workflows on a
machine holding live keys.

CI runs three parallel jobs (`web`, `server`, `deploy`) in about two minutes, and
all three must pass. [`deploy/README.md`](deploy/README.md) has the details. For
contributors: open a pull request; merging it ships it.

## Editing content

Most content is edited on the site by officers. What's left:

- Nav labels, stat strip cells and social links are in `web/src/content/home.ts`
  and need a deploy.
- Anything without a desk is edited in Prisma Studio (`npm run studio`). Read
  "Editing data by hand" in [`server/README.md`](server/README.md) first; several
  columns are rewritten by background jobs.
- A member's public profile slug is set by hand. Nothing generates one.
- A refund doesn't shorten a membership. The webhook records it and an officer
  decides.

## Testing

```bash
npm test
```

`web` tests run in jsdom with a stubbed `fetch` and need nothing running. They
check each remote read while loading, on success and when the API is down.

`server` tests run the real app in-process against the development database, so
Postgres must be up. They assert invariants, not counts:

- every `/api/stats` count equals the length of the listing it links to;
- no public route returns an `email` or `passwordHash`;
- every failed sign-in gives the same answer;
- one payment credits one semester however many times it's reported;
- a reminder DM goes out at most once per deadline, even with two instances.

No test calls Stripe, Discord, Postmark or UCF's calendar. Webhook tests sign
their own deliveries, since signature checking is that route's authentication.
Stripe's own card form isn't tested; it needs a real browser.

## Side Notes

- Postgres listens on 5433, so a local Postgres on 5432 doesn't collide.
- Run `npm --prefix server run generate` after pulling a schema change. The
  Prisma client is generated into `server/src/generated` and isn't committed.
- `docker compose down` stops the whole project. Use
  `docker compose stop <service>` for one.
- Keep `TRUST_PROXY=false` unless a proxy in front sets `X-Forwarded-For`, or
  anyone can dodge the rate limits.
- A key added to `server/.env` needs an API restart; `tsx watch` watches `src/`
  only. Touch a file under `server/src/`. Vite restarts on a `web/.env` change,
  but the browser still needs a reload.
- Test payments send no receipt email. Stripe only emails receipts in live mode;
  the site links Stripe's hosted receipt instead.
- Never commit a `.env`. Only the `.env.example` files belong in git.

More in [`web/README.md`](web/README.md) (frontend conventions),
[`server/README.md`](server/README.md) (API routes, database tools, scaling) and
[`deploy/README.md`](deploy/README.md) (the deploy agent).

## License

Free software under the GNU Affero General Public License, version 3 only
([`LICENSE`](LICENSE)). Anyone who runs a modified copy where people use it
over a network has to offer those people its source (section 13).

The slicer's toolbar icons are OrcaSlicer's artwork, also under the AGPL v3:
[`web/public/licenses/orcaslicer/NOTICE.md`](web/public/licenses/orcaslicer/NOTICE.md).
