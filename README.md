
# Robotics Club of Central Florida — Website

The source code for the [RCCF website](https://rccf.club/). Additional documentation and internal guides are on the [RCCF Secret Library](https://secretlibrary.rccf.club/shelves/rccf-website). To join the web team, DM the web team lead on the RCCF [Discord](https://discord.gg/Dpe7gjESmy).

## Requirements

- **Node.js** >= 19 — [download](https://nodejs.org/en/download/)
- **Docker** — [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows, [lazydocker](https://github.com/jesseduffield/lazydocker) recommended on Linux

## Local Development Setup

```bash
# 1. Install Node dependencies
npm i

# 2. Start the PostgreSQL database container
docker compose up -d

# 3. Generate the Prisma client
npx prisma generate

# 4. Apply database migrations
npx prisma migrate dev --name RCCF

# 5. Start the dev server (hot-reload)
npm run dev

# 6. Open prisma studio | database GUI (optional)
npm run studio
```

## Useful Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server with hot-reload |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run services` | Start all Docker services (web + postgres) |
| `npm run db` | Start only the postgres Docker container |
| `npm run migrate` | Generate Prisma client and apply migrations |
| `npm run studio` | Open Prisma Studio (database GUI) at `localhost:5555` |
| `npm run check` | Run svelte-check type checking |
| `npm run format` | Format code with Prettier |

## Production Deployment

The app is containerized. To run the full stack:

```bash
docker compose up -d
```

This starts both the SvelteKit web server (port `4173`) and the PostgreSQL database. The web container builds the app using `npm run build` via the `dockerfile`.

## Environment Variables

`.env` fill in the values:

```env
# Dev database (localhost); use postgres_rccf hostname for production container
DATABASE_URL="postgresql://postgres:password@localhost:5432/RCCF"

SECRET_STRIPE_KEY=""        # Stripe secret key (sk_...)
PUBLIC_STRIPE_KEY=""        # Stripe publishable key (pk_...)
POSTMARK_API_TOKEN=""       # Postmark server API token

DISCORD_BOT_TOKEN=""        # Discord bot token
DISCORD_GUILD_ID=""         # RCCF Discord server ID
DISCORD_MEMBER_ROLE_ID=""   # Role assigned to paid members
DISCORD_PROJECT_LEAD_ROLE_ID=""  # Role for project leads
DISCORD_TEAM_LEAD_ROLE_ID=""     # Role for team leads
```

For production, set `DATABASE_URL` to use the Docker service hostname:

```env
DATABASE_URL="postgresql://postgres:password@postgres_rccf:5432/RCCF"
```

## Database Schema Overview

Key models in `prisma/schema.prisma`:

- **Member** — user accounts with roles, survey, profile, and membership expiration
- **Role** — permission levels (member, project lead, team lead, admin)
- **Survey** — member intake form data (major, year, allergies, discovery source)
- **Project** — club projects with budget, teams, articles, and Discord role mapping
- **Account** / **Record** / **ExpendatureRequest** — financial tracking
- **WebSponsor** / **Sponsor** — sponsor listings and tiers
- **SiteContent** — CMS key-value store for editable site content

## License

[MIT](https://choosealicense.com/licenses/mit/)
