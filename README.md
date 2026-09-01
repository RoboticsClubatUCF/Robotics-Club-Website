# Robotics Club of Central Florida — Website

**Vite + React + Tailwind** on the front, **Postgres + Prisma + Hono** on the
back.

```
.
├── package.json     one command to run everything
├── web/             frontend  — Vite 8, React 19, Tailwind 4, DaisyUI 5
├── server/          backend   — Postgres 18, Prisma 7, Hono 4
└── deploy/          what puts main on the live box
```

The public site, plus the members' half: signing up, signing in, and paying dues
by card. Club content is edited in Prisma Studio; there is no admin UI yet.

---

## Getting it running from nothing

### 1. Prerequisites

| Tool               | Version | Check with         |
| ------------------ | ------- | ------------------ |
| **Node.js**        | 24+     | `node --version`   |
| **Docker Desktop** | any     | `docker --version` |

Docker must actually be **running**, not just installed — the whale icon in the
system tray. Postgres runs inside it; nothing else needs it.

### 2. Set up

```bash
git clone https://github.com/RoboticsClubatUCF/Robotics-Club-Website.git
cd Robotics-Club-Website
cp server/.env.example server/.env
npm run setup
```

`npm run setup` installs all three packages, starts Postgres, creates the
schema, generates the Prisma client, and seeds content. The first run pulls the
Postgres image (~100 MB), so give it a minute.

You need a `POSTGRES_PASSWORD` and a matching `DATABASE_URL` in
`server/.env`; everything else in it is optional and documented in place. The
site runs with no Postmark, Discord or Stripe credentials at all — see
[Optional services](#optional-services).

`web/.env` is optional too: copy `web/.env.example` only when you have a Stripe
publishable key to put in it, or when the API is somewhere other than
`localhost:4000`.

### 3. Run it

```bash
npm run dev
```

One command. It starts Postgres if it isn't already up, then runs the API and
the site together, output interleaved and labelled `[api]` and `[web]`. Ctrl+C
stops both.

Open **http://localhost:5173**.

### 4. Confirm it worked

The stat strip below the hero should read real numbers rather than `—`. What the
numbers *are* depends on what is in your database; that they are numbers at all
is what says the API answered.

If they show `—`, the API isn't reachable. The browser console will say so
outright. Check that `[api]` in your terminal didn't fail to start.

Then sign in at **/login** as `admin@rccf.local` with the password from
`SEED_ADMIN_PASSWORD` (`changeme` if you haven't set one). That gets you the
dashboard and the dues page, which is the half of the site a visitor never sees.

---

## What the site does

**Public** — the landing page, and the sections it links to. Read-only, cached,
and safe to serve to anybody.

**Joining** — `/join`. Signing up *is* joining the club: it takes a UCF address,
mails a link to prove it, then collects a name, a password, a Discord handle and
the member acknowledgement. Accounts land at `GUEST` with no public profile; an
officer promotes from there by hand.

**Signing in** — `/login`, against a server-side session in an httpOnly cookie.
`/dashboard` is the member's own page.

**Dues** — `/dues`, paid by card through Stripe. The club's rules, which the
server enforces rather than the page:

| What | Covers |
| ----------------------------- | ------------------------------------------------------------------- |
| **$25** | the semester being charged for — in summer, that's the coming fall |
| **$50** | that semester and the next chargeable one: fall then spring, or spring then fall |
| **Summer** | free for everybody |
| **Between one term and the next** | free for everybody |
| **First two weeks of a term** | a free trial, for everybody |

Buying a second semester while the first is still running rolls forward instead
of selling the same weeks twice.

Term dates come from **UCF's own academic calendar**, not a table somebody has
to update each August, with fixed fallback dates for when that feed cannot be
reached — the club's dues year should not depend on somebody else's uptime.
When a member's free trial runs out, the club's Discord bot sends them one
message: exactly one, ever, per term.

---

## Optional services

Three outside services are wired in, and **all three are optional as a set**.
The site runs without any of them and says so at startup; nothing half-works
quietly.

| Unset | What you lose |
| ------------------------------- | --------------------------------------------------------------- |
| `POSTMARK_TOKEN` and friends | Contact messages are stored but not emailed. Signup still works in development — the verification link goes to the API's log — but is refused in production. |
| `DISCORD_BOT_TOKEN` + guild id | Discord handles are stored exactly as typed, unconfirmed, and no trial-end message is sent. |
| `STRIPE_SECRET_KEY` | The dues page says card payments aren't switched on and points at an officer, rather than showing a dead button. |

Each set is all-or-nothing: two of Postmark's three values and the server
refuses to start, because a half-configured mailer accepts messages, reports
success and delivers nothing.

`STRIPE_WEBHOOK_SECRET` is the one worth a second look. Without it a payment is
still credited — the dues page asks Stripe directly when the member lands back
on it — but a member who pays and *closes the tab* is not credited until they
open the page again. In production that is the difference between a payment and
a support message.

---

## Commands

All from the repo root. Each fans out to the right package, so you rarely need
to `cd` anywhere.

| Command             | Does                                              |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | **Postgres + API + site**, together               |
| `npm run setup`     | Install everything, migrate, generate, seed       |
| `npm test`          | Every test in both packages                       |
| `npm run build`     | Production build of the site                      |
| `npm run typecheck` | Typecheck both packages — **see below**           |
| `npm run lint`      | Oxlint                                            |
| `npm run format`    | Prettier across both packages                     |
| `npm run studio`    | Prisma Studio — the content editor — on :5555     |
| `npm run db:up`     | Just Postgres, on :5433                           |
| `npm run db:down`   | Stop Postgres                                     |
| `npm run db:reset`  | **Destroys the database volume and all its data** |

To run one side alone: `npm run dev:web` or `npm run dev:api`. Each package also
has its own scripts — see [`web/README.md`](web/README.md) and
[`server/README.md`](server/README.md).

**`npm run typecheck` is the server's `tsc --noEmit` plus the web *build*, and
that second half is deliberate.** `web`'s build is `tsc -b && vite build`, and
`-b` walks the project references, which include the tests. Running
`tsc --noEmit -p tsconfig.json` inside `web/` covers a smaller set and will call
a tree clean that CI then fails on — an unused parameter in a test file is how
that shows up. Check the frontend with the build.

---

## Deploying

**Pushing to `main` deploys to the live site.** Nothing else to run.

The club's box polls `main` every couple of minutes and, once CI is green on
that exact commit, rebuilds whichever half the diff touched — `web/**` rebuilds
the bundle, `server/**` rebuilds the API image and applies migrations. It pulls
rather than being pushed to because the box has no public address, and because
this repository is public and a self-hosted runner would execute workflow files
arriving with a pull request on a machine holding live keys.

CI is three parallel jobs — `web`, `server` and `deploy` — and takes about two
minutes. Green means all three; that is what the box gates on.

The whole mechanism, the one-time setup and the failure modes are in
[`deploy/README.md`](deploy/README.md). The short version for anybody sending a
change: open a pull request, and when it merges it ships.

---

## Editing content

There is no admin UI yet. Projects, members, events and sponsors live in the
database and are edited through **Prisma Studio**, a spreadsheet-style GUI:

```bash
npm run studio      # http://localhost:5555
```

The site picks up changes on refresh. Page *copy* — the headline, meeting
details, nav labels — is not in the database; it lives in
`web/src/content/home.ts` and changing it needs a deploy.

Three member-facing jobs are also manual edits here, because nothing on the site
does them yet:

- **Putting a member on the public roster** — give the user a `slug`. Paying
  dues already moves the account off `GUEST` and stamps `joinedAt`, so most of
  the promotion happens on its own; the slug is what makes a name and a photo
  public, and nothing generates one, because being published is a decision a
  person should make. A member with no slug is invisible to the site and has
  their dashboard regardless.
- **Resetting a password** — there is no reset flow. The login page says so and
  points at an officer.
- **Correcting dues** — `users.dues_paid_through` is the single date that says
  whether somebody is covered. A refund does *not* shorten it automatically; the
  webhook records the refund, logs loudly, and leaves the decision to a person.

---

## Testing

```bash
npm test
```

**`web`** tests run in jsdom with Testing Library and a stubbed `fetch`, so they
need nothing running. They cover what a build can't: that each remote read
renders correctly while loading, on success, and when the API is unreachable.

**`server`** tests drive the real Hono app in-process against the real database,
so **Postgres must be up**. They assert invariants rather than fixed numbers,
since the data is whatever the last seed left behind. The ones that carry their
weight:

- every count from `/api/stats` equals the length of the listing it links to, so
  a filter added to one side and not the other fails the build;
- no public route ever returns an `email` or a `passwordHash` — logins and
  roster entries share one table, so that is one careless spread away;
- every way of failing to sign in gives the same answer, or the login form
  becomes a way to ask whether a given student is a member;
- one successful payment credits **one** semester however many times it arrives
  — Stripe retries webhooks, and the member's browser confirms in parallel;
- the trial-end message is sent at most once per person per term, including when
  two API instances sweep at the same moment.

No test calls Stripe, Discord, Postmark or UCF's calendar. The webhook tests do
sign their own deliveries with the real signing secret, because signature
verification *is* the authentication on that route and stubbing it would leave
the only interesting part untested.

**The one thing nothing covers is Stripe's own payment form**, which renders in
an iframe on stripe.com. Everything either side of it is tested; typing a card
number needs a real browser.

---

## Gotchas

- **Postgres listens on 5433, not the default 5432.** Set in `server/.env`, so a
  Postgres already installed on the machine won't collide with it.
- **Run `npm --prefix server run generate` after any schema change** — and after
  pulling one. The Prisma client is generated TypeScript in
  `server/src/generated`, which is gitignored, so a fresh clone has none until
  you generate it. `npm run setup` does this for you.
- **`docker compose down` stops the whole project**, not just the profile you
  named. Use `docker compose stop <service>` to stop one thing.
- **`TRUST_PROXY` must stay `false`** unless there is a proxy in front of the
  API. Otherwise anyone can forge `X-Forwarded-For` and walk past the rate limit.
- **Adding a key to `server/.env` needs the API restarted.** `tsx watch` watches
  `src/`, not `.env`, so a new Stripe or Discord key changes nothing until the
  process comes back — and the server keeps reporting the feature as
  unconfigured, which looks exactly like a key that doesn't work. Touch any file
  under `server/src/` to force it. Vite restarts itself on a `web/.env` change,
  but the browser still needs a reload.
- **No receipt email arrives from a test payment, and that is not a bug.**
  Stripe sends automatic receipts in live mode only, and only with "Successful
  payments" switched on in its Dashboard. The site doesn't claim otherwise — it
  links Stripe's hosted receipt, which every successful charge has in both
  modes.
- **Never commit a `.env`.** Only the `.env.example` files belong in the
  repository; real credentials stay on the machine that uses them. That now
  includes a Stripe secret key, which can move real money.

---

Each package's own README carries the rest: [`web/README.md`](web/README.md) for
the styling system and the frontend's conventions,
[`server/README.md`](server/README.md) for the API route table, pgAdmin, psql
and the scaling notes, and [`deploy/README.md`](deploy/README.md) for how a
merge to `main` becomes the live site.
