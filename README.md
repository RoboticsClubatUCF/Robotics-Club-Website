# RCCF Website

Web app for the Robotics Club of Central Florida (UCF). Member registration, project teams, sponsorships, and Discord/Stripe/Postmark integrations.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | SvelteKit 2 + Svelte 5 (runes) |
| Language | TypeScript 6 strict |
| Styling | Tailwind CSS 4 + DaisyUI 5 |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Database | PostgreSQL |
| Auth | bcrypt + UUID tokens |
| Payments | Stripe |
| Email | Postmark |
| Deploy | adapter-node + Docker |

## Dev Setup

**Prerequisites:** Node.js 18+, Docker Desktop

```bash
# 1. Install dependencies
npm install

# 2. Create .env (see Environment Variables below)

# 3. Start the database container
npm run db

# 4. Apply migrations
npm run prisma:migrate:dev

# 5. Start the dev server
npm run dev
```

App runs at `http://localhost:5173`. Default admin login: `admin` / `admin`.

## Environment Variables

Create a `.env` file in this directory:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/RCCF

SECRET_STRIPE_KEY=sk_test_...
PUBLIC_STRIPE_KEY=pk_test_...

POSTMARK_API_TOKEN=...

DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_MEMBER_ROLE_ID=...
DISCORD_PROJECT_LEAD_ROLE_ID=...
DISCORD_TEAM_LEAD_ROLE_ID=...
```

## Commands

```bash
npm run dev                  # Vite dev server
npm run build                # Production build
npm run preview              # Preview production build
npm run check                # Type-check (svelte-check)
npm run format               # Prettier auto-format
npm run lint                 # Prettier format check

npm run db                   # Start postgres_rccf container only
npm run services             # Start all Docker services
npm run studio               # Open Prisma Studio GUI

npm run prisma:generate      # Generate Prisma client
npm run prisma:migrate:dev   # Create + apply a new migration (dev)
npm run prisma:migrate       # Deploy existing migrations (prod)
```

## Docker

```bash
docker compose up -d           # Start all services
docker compose up -d --build   # Rebuild and start
```

Services: `web_rccf` (port 4173, vite preview) and `postgres_rccf` (port 5432). HAProxy sits in front with custom error pages in `haproxy/errors/`.

## Project Structure

```
src/
├── lib/
│   ├── components/     # Shared Svelte components
│   └── server/         # Server-only utilities (Prisma, Stripe, email, auth)
└── routes/
    ├── (app)/          # Authenticated app routes
    ├── (auth)/         # Sign in, sign up, password reset
    └── (main)/         # Public-facing pages
prisma/
├── schema.prisma
└── migrations/
static/                 # Fonts, images, favicon
```
