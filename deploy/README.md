# Deploying

The server pulls; nothing pushes to it. Push to `main`, CI runs on GitHub, and
within a couple of minutes the server sees the branch moved, checks CI passed on
that exact commit, and updates whichever half of the site changed.

```
   push ──▶ GitHub ──▶ CI: web │ server │ deploy   (parallel, ~2 min)
                             │
                             ▼  all green?
   server ──▶ every 2 min: git fetch ──▶ ask GitHub ──▶ deploy what changed
```

`main` is production. There's no approval step.

## Why it pulls

The server has no public address. It sits on the club's LAN, and a Cloudflare
Tunnel on another machine reaches it at `:4173`, so GitHub can't connect to it.

A self-hosted Actions runner would connect outward, but this repository is
public and a runner executes workflow files from pull requests. This server
holds the live Discord bot token, Stripe keys and the members database. Pulling
means only code already on `main` and already through CI runs here.

## What it does with a change

The diff between the running commit and the new one decides. The rules are
`classify` in `deploy.sh`, all tested by `classify.test.sh`:

| Changed | Action |
| --- | --- |
| `web/**` | rebuild the bundle, sync it into the nginx root |
| `server/**` | rebuild the API image, `compose up -d` (migrations run first) |
| `server/nginx.conf` | recreate the web container |
| `server/docker-compose.yml` | both of the above |
| anything else | move the checkout to the commit; rebuild nothing |

The checkout always moves, because the service runs `deploy.sh` straight from
it, so a change to `deploy/**` takes effect without a build.

Migrations aren't sequenced here. In `docker-compose.yml`, `api` depends on the
`migrate` service completing, so `prisma migrate deploy` runs once before any API
process starts.

## Setting it up

Run everything on the server with `sudo`. The checkout is root-owned, and `sudo`
on the first line of a pasted block doesn't cover the next.

1. Dependencies (Docker is already installed):

   ```sh
   sudo apt install -y git curl jq rsync
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
   sudo apt install -y nodejs
   node -v && npm -v
   ```

   The NodeSource script runs its own `apt update`, so it needs `sudo -E`.

2. Start Docker at boot, which is what brings the site back after a reboot:

   ```sh
   sudo systemctl enable --now docker
   ```

3. One persistent checkout, which holds the env files:

   ```sh
   sudo mkdir -p /srv/rccf
   sudo git clone https://github.com/RoboticsClubatUCF/Robotics-Club-Website.git /srv/rccf/app
   ```

4. The env files. Both are gitignored, so `git reset --hard` leaves them alone.
   Copy them from a working deployment rather than retyping keys:

   ```sh
   cd ~/rccf/website/Robotics-Club-Website
   sudo cp server/.env /srv/rccf/app/server/.env
   sudo cp web/.env /srv/rccf/app/web/.env
   ```

   - `server/.env` configures the API; `server/.env.example` lists every key.
     Its `WEB_ROOT` and `WEB_PORT` must match step 5.
   - `web/.env` holds `VITE_API_URL` and `VITE_STRIPE_PUBLISHABLE_KEY`, baked into
     the bundle at build time. That's why the frontend builds here and not in
     CI, which would otherwise need the club's keys.

   `VITE_API_URL` is `https://rccf.club`, the site's own origin. nginx proxies
   `/api/` on the same origin; there's no `api.` host, and a bundle pointing at
   one loads and fails every request. `assert_api_url` refuses an unset or
   localhost value and logs `bundle will call …` on every frontend deploy.

5. Configuration, only if the defaults (`BRANCH=main`, `REPO_DIR=/srv/rccf/app`,
   `WEB_ROOT=/srv/rccf/web`, `WEB_PORT=4173`) are wrong:

   ```sh
   sudo tee /etc/rccf-deploy.conf >/dev/null <<'EOF'
   BRANCH=main
   WEB_ROOT=/srv/rccf/web
   WEB_PORT=4173
   # Optional: raises the GitHub API limit from 60/hour. A fine-grained token with
   # read-only Actions access on this repository is enough.
   # GITHUB_TOKEN=github_pat_...
   EOF
   sudo chmod 600 /etc/rccf-deploy.conf
   ```

   Use `sudo tee`. With `sudo cat > file`, your own shell opens the file and gets
   `Permission denied`.

6. The timer:

   ```sh
   sudo cp /srv/rccf/app/deploy/rccf-deploy.{service,timer} /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now rccf-deploy.timer
   ```

   Enable the timer, never the service. The service has no `[Install]` section,
   so enabling it fails instead of adding a second trigger at boot.

7. First deploy. Rehearse, then run it:

   ```sh
   sudo bash /srv/rccf/app/deploy/deploy.sh --dry-run --force
   sudo bash /srv/rccf/app/deploy/deploy.sh --force
   ```

   The dry run prints the plan. The real run ends with `health checks passed`
   and `deployed <sha>`.

8. Confirm it survives a reboot:

   ```sh
   systemctl is-enabled rccf-deploy.timer   # enabled
   systemctl is-enabled docker              # enabled
   systemctl list-timers rccf-deploy.timer  # next fire time
   ```

   `OnBootSec=2min` restarts the cycle after boot, and the containers come back
   through `restart: unless-stopped`.

## Using it

```sh
journalctl -u rccf-deploy -f                         # watch a deploy
journalctl -u rccf-deploy -n 50                      # the last run
sudo bash /srv/rccf/app/deploy/deploy.sh --dry-run   # what it would do
sudo bash /srv/rccf/app/deploy/deploy.sh --force     # deploy now, CI or not
```

State is in `/var/lib/rccf-deploy`: `deployed` is the commit being served,
`failed` is one that broke.

`git` in `/srv/rccf/app` needs `sudo`, or it refuses with
`detected dubious ownership`. Don't add a `safe.directory` exception; the agent
runs as root and never hits the check.

## Before you rely on it

- A commit with no CI run is never deployed and waits forever. The gate asks
  GitHub for the `ci.yml` run on that SHA and that branch; "no run yet" and
  "still running" look the same. A branch whose head predates the workflow sits
  at `CI still running`. Deploy it once with `--force`. The branch matters
  because one SHA can have runs on several branches.
- A failed deploy isn't retried. The commit goes in
  `/var/lib/rccf-deploy/failed` and is skipped until the branch moves. Push a
  fix, or `--force` once you know why.
- There's no automatic rollback. A failed health check stops loudly with the new
  containers already running. Roll back with
  `sudo git -C /srv/rccf/app checkout <good-sha>` and `--force`.
- Nothing brings a stopped stack back up. The agent only acts on changes.
- Old asset chunks are kept for two weeks. Routes are split with `lazy()`, and a
  member with the dashboard open holds an `index.html` naming the previous
  build's chunks.
- `index.html` syncs last, after the chunks it references.
- Every compose call names both profiles, `app` (postgres, migrate, api, the
  slicer worker) and `web` (nginx). `web` depends on `api`, so naming one gives
  `service "web" depends on undefined service "api": invalid compose project`.
  The `compose` helper handles this and `classify.test.sh` checks it.
- Nothing touches the database except migrations. There's no seed on deploy.
- A `server/**` change rebuilds the slicer worker image too (`server/orca/Dockerfile`:
  OrcaSlicer 2.4.2 on Ubuntu, about 1.6 GB). The first build downloads Orca;
  later ones reuse the layers. The worker may use 2 GB of memory and 512 MB of
  tmpfs scratch, so the box needs that headroom. After each build the agent
  prunes dangling images carrying the slicer's label, nothing else. The worker
  reaches only Postgres, on its own internal network, and gets no `.env`.

## Cloudflare

Cloudflare fronts the site with a WAF. A rule matching `/join` once challenged
`POST /api/projects/:id/join`, and members couldn't join projects: a `403` with
`cf-mitigated: challenge` that never reached the server. If something works
locally but not live, check the request arrives:
`curl -sD - -o /dev/null https://rccf.club/<path>` and look for `cf-mitigated`.
