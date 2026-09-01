# Deploying

The box pulls. Nothing pushes to it.

Push to the deploy branch, CI runs in GitHub, and within a couple of minutes the
box notices the branch moved, checks that CI went green on that exact commit,
and updates whichever half of the site actually changed. No SSH, no tarball, no
`scp`.

```
   push ──▶ GitHub ──▶ CI (lint, typecheck, build, tests, migration drift,
                           secret scan, image build, this script)
                             │
                             ▼  green?
   box ──▶ every 2 min: git fetch ──▶ ask GitHub ──▶ deploy what changed
```

## Why it pulls

The box has no public address. It sits on the LAN and a Cloudflare Tunnel on
another machine reaches it at `:4173`, so GitHub cannot open a connection to it
and there is no webhook to receive.

A self-hosted Actions runner would solve that — it dials out — but **this
repository is public**, and a runner executes workflow files that arrive with a
pull request. This box holds the club's live Discord bot token, live Stripe keys
and a database of real members. Pulling means nothing from GitHub runs here
except code that is already on the deploy branch and already passed CI.

## What it does with a change

Worked out from the diff between what is running and what is being deployed:

| Changed | What happens |
| --- | --- |
| `web/**` | rebuild the bundle, sync it into the nginx root |
| `server/**` | rebuild the API image, `compose up -d` (migrations run first) |
| `server/nginx.conf` | recreate the web container, which mounts it |
| `server/docker-compose.yml` | both of the above |
| anything else | nothing is served differently, so nothing is done |

Migrations are not sequenced here on purpose: `docker-compose.yml` makes `api`
depend on the `migrate` service completing, so `prisma migrate deploy` runs
exactly once, before any API process starts, however many replicas there are.

## One-time setup

Everything below is on the box, as root.

**1. Dependencies.** Docker is already there. The rest:

```sh
apt install -y git curl jq rsync
# Node 24 for the frontend build — the bundle is built here, not in CI
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
```

**2. The checkout.** One persistent clone, not a fresh one per deploy — the two
env files live in it:

```sh
mkdir -p /srv/rccf
git clone https://github.com/RoboticsClubatUCF/Robotics-Club-Website.git /srv/rccf/app
```

**3. The env files.** Both are gitignored, so `git reset --hard` leaves them
alone — that is what makes a persistent checkout safe. Put them in place:

- `/srv/rccf/app/server/.env` — the API's configuration. `server/.env.example`
  lists every key.
- `/srv/rccf/app/web/.env.production` — `VITE_API_URL` and
  `VITE_STRIPE_PUBLISHABLE_KEY`. **These are baked into the bundle at build
  time**, which is the reason the frontend is built on the box rather than in
  CI: CI would need the club's keys to produce a correct bundle, and they are
  not going into GitHub secrets to save a minute of build time.

`VITE_API_URL` is the site's own origin (`https://rccf.club`) — both halves are
served from one origin, so it is not a separate host.

**4. Configuration.** Only if the defaults are wrong for this box:

```sh
cat >/etc/rccf-deploy.conf <<'EOF'
BRANCH=main
REPO_DIR=/srv/rccf/app
WEB_ROOT=/srv/rccf/web
WEB_PORT=4173
# Optional: raises the GitHub API limit from 60/hour. A fine-grained token with
# read-only Actions access on this one repository is enough.
# GITHUB_TOKEN=github_pat_...
EOF
chmod 600 /etc/rccf-deploy.conf
```

`WEB_ROOT` must match what `docker-compose.yml` mounts into the web container —
it reads `${WEB_ROOT:-/srv/rccf/web}` from `server/.env`, so if you change one,
change both.

**5. The timer.**

```sh
cp /srv/rccf/app/deploy/rccf-deploy.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now rccf-deploy.timer
```

**6. First deploy.** The state directory starts empty, so the first run treats
everything as changed and builds both halves:

```sh
bash /srv/rccf/app/deploy/deploy.sh --force
```

## Using it

```sh
systemctl list-timers rccf-deploy.timer   # when it next fires
journalctl -u rccf-deploy -f              # watch a deploy happen
journalctl -u rccf-deploy -n 50           # what it did last
bash /srv/rccf/app/deploy/deploy.sh --dry-run   # what would it do
bash /srv/rccf/app/deploy/deploy.sh --force     # redeploy now, CI or no CI
```

State lives in `/var/lib/rccf-deploy`: `deployed` is the commit currently
serving, `failed` is one that broke.

## Things worth knowing before you rely on it

**A commit with no CI run is never deployed, and never gives up waiting.** The
gate asks GitHub for the `ci.yml` run against that exact SHA; "no run yet" and
"still running" are the same answer, because a few seconds after a push they are
indistinguishable. That is the safe direction to be wrong in, but it means a
branch whose head predates the CI workflow — or was pushed with Actions
disabled — sits there forever with `CI still running` in the journal. Deploy it
once with `--force`, or push a commit CI will pick up.

**A commit that fails to deploy is not retried.** It is recorded in
`/var/lib/rccf-deploy/failed` and skipped until the branch moves again — without
that the timer would rebuild a broken commit every two minutes all night. So the
fix for a failed deploy is another commit, or `--force` once you know why.

**There is no automatic rollback.** If the health check fails after a deploy the
script stops and says so, loudly, in the journal — but the new containers are
already up. Rolling back is `git -C /srv/rccf/app checkout <good-sha>` and
`--force`. Adding real rollback means keeping the previous image tagged and
swapping back, which is worth doing if this ever bites.

**Old asset chunks are kept for a fortnight, not deleted.** The frontend splits
its routes with `lazy()`, so a member with the dashboard open when a deploy
lands is holding an `index.html` that names the *previous* build's chunks.
Deleting those turns their next click into a failed import. Filenames are
content-hashed, so keeping them costs a few hundred kilobytes.

**index.html is synced last.** It names the hashed chunks, so copying it first
would leave a window where the browser is handed an index pointing at files that
are not on disk yet.

**Nothing here touches the database beyond migrations**, and those are the
compose `migrate` service's job. There is no seed on deploy — the production
database has real members in it.
