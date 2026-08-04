# Robotics Club of Central Florida — Website

**Vite + React + Tailwind** on the front, **Postgres + Prisma + Hono** on the
back.

```
.
├── package.json     one command to run everything
├── web/             frontend  — Vite 8, React 19, Tailwind 4, DaisyUI 5
└── server/          backend   — Postgres 18, Prisma 7, Hono 4
```

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

### 3. Run it

```bash
npm run dev
```

One command. It starts Postgres if it isn't already up, then runs the API and
the site together, output interleaved and labelled `[api]` and `[web]`. Ctrl+C
stops both.

Open **http://localhost:5173**.

### 4. Confirm it worked

The stat strip below the hero should read real numbers — `5 PROJECTS`,
`6 MEMBERS`, `2 OPPORTUNITIES` — with five projects listed underneath.

If those show `—` instead, the API isn't reachable. The browser console will say
so outright. Check that `[api]` in your terminal didn't fail to start.

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
| `npm run typecheck` | Typecheck both packages                           |
| `npm run lint`      | Oxlint                                            |
| `npm run format`    | Prettier across both packages                     |
| `npm run studio`    | Prisma Studio — the content editor — on :5555     |
| `npm run db:up`     | Just Postgres, on :5433                           |
| `npm run db:down`   | Stop Postgres                                     |
| `npm run db:reset`  | **Destroys the database volume and all its data** |

To run one side alone: `npm run dev:web` or `npm run dev:api`. Each package also
has its own scripts — see [`web/README.md`](web/README.md) and
[`server/README.md`](server/README.md).

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
since the data is whatever the last seed left behind. The two that matter:

- every count from `/api/stats` equals the length of the listing it links to, so
  a filter added to one side and not the other fails the build;
- no public route ever returns an `email` or a `passwordHash` — logins and
  roster entries share one table, so that is one careless spread away.

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
- **Never commit a `.env`.** Only the `.env.example` files belong in the
  repository; real credentials stay on the machine that uses them.

---

Each package's own README carries the rest: [`web/README.md`](web/README.md) for
the styling system and the frontend's conventions,
[`server/README.md`](server/README.md) for the API route table, pgAdmin, psql
and the scaling notes.
