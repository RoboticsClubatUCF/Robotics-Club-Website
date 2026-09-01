# Deploying

The box pulls. Nothing pushes to it.

Push to `main`, CI runs in GitHub, and within a couple of minutes the box
notices the branch moved, checks that CI went green on that exact commit, and
updates whichever half of the site actually changed. No SSH, no tarball, no
`scp`.

```
   push ──▶ GitHub ──▶ CI: web │ server │ deploy   (three parallel jobs, ~2 min)
                             │
                             ▼  all green?
   box ──▶ every 2 min: git fetch ──▶ ask GitHub ──▶ deploy what changed
```

**`main` is production.** There is no approval step and nobody is watching.

## Why it pulls

The box has no public address. It sits on the LAN and a Cloudflare Tunnel on
another machine reaches it at `:4173`, so GitHub cannot open a connection to it
and there is no webhook to receive.

A self-hosted Actions runner would solve that — it dials out — but **this
repository is public**, and a runner executes workflow files that arrive with a
pull request. This box holds the club's live Discord bot token, live Stripe keys
and a database of real members. Pulling means nothing from GitHub runs here
except code that is already on `main` and already passed CI.

## What it does with a change

Worked out from the diff between what is running and what is being deployed.
The rules are `classify` in `deploy.sh` and every one of them is tested by
`classify.test.sh`:

| Changed | What happens |
| --- | --- |
| `web/**` | rebuild the bundle, sync it into the nginx root |
| `server/**` | rebuild the API image, `compose up -d` (migrations run first) |
| `server/nginx.conf` | recreate the web container, which mounts it |
| `server/docker-compose.yml` | both of the above |
| anything else | the checkout moves to the commit; nothing is rebuilt |

That last row still moves the working tree, which matters more than it sounds:
`deploy/**` classifies as nothing-to-rebuild by design — the unit runs the
script straight out of the checkout, so a changed script needs no build — and if
the checkout did not follow, an improvement to the deploy agent would be exactly
the kind of commit that never reached the disk.

Migrations are not sequenced here on purpose: `docker-compose.yml` makes `api`
depend on the `migrate` service completing, so `prisma migrate deploy` runs
exactly once, before any API process starts, however many replicas there are.

## Setting it up

On the box, and **every command needs `sudo`** — the checkout is root-owned, and
`sudo` on the first line of a pasted block does not cover the second.

**1. Dependencies.** Docker is already there.

```sh
sudo apt install -y git curl jq rsync
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

`sudo -E` on the NodeSource line, not just `sudo` on the `apt` line after it —
the setup script does its own `apt update` and fails without root.

**2. Docker at boot.** This is the half of "survives a reboot" that brings the
site back; the timer only brings the *deploys* back.

```sh
sudo systemctl enable --now docker
```

**3. The checkout.** One persistent clone, not a fresh one per deploy — the two
env files live in it:

```sh
sudo mkdir -p /srv/rccf
sudo git clone https://github.com/RoboticsClubatUCF/Robotics-Club-Website.git /srv/rccf/app
```

**4. The env files.** Both are gitignored, so `git reset --hard` leaves them
alone — that is what makes a persistent checkout safe.

**Copy them from a deployment that already works.** Retyping a live Discord
token and Stripe keys by hand is how one character goes missing:

```sh
cd ~/rccf/website/Robotics-Club-Website
sudo cp server/.env /srv/rccf/app/server/.env
sudo cp web/.env /srv/rccf/app/web/.env
```

- `server/.env` — the API's configuration. `server/.env.example` lists every
  key. `WEB_ROOT` and `WEB_PORT` in it are also what compose mounts and
  publishes, so they have to agree with step 5.
- `web/.env` — `VITE_API_URL` and `VITE_STRIPE_PUBLISHABLE_KEY`. **Baked into
  the bundle at build time**, which is the reason the frontend is built on the
  box rather than in CI: CI would need the club's keys to produce a correct
  bundle, and they are not going into GitHub secrets to save a minute.

**`VITE_API_URL` is `https://rccf.club`** — the site's own origin, with no
`api.` in front of it. Both halves are served from one origin and nginx proxies
`/api/`; there is no separate API host, and a bundle pointing at one loads fine
and fails every request. `assert_api_url` in the script refuses an unset or
localhost value and logs what it is about to bake in, so the journal says
`bundle will call …` on every frontend deploy. Read that line.

**5. Configuration.** Only if the defaults are wrong for this box — they are
`BRANCH=main`, `REPO_DIR=/srv/rccf/app`, `WEB_ROOT=/srv/rccf/web`,
`WEB_PORT=4173`, which is what the club's box already uses.

```sh
sudo tee /etc/rccf-deploy.conf >/dev/null <<'EOF'
BRANCH=main
WEB_ROOT=/srv/rccf/web
WEB_PORT=4173
# Optional: raises the GitHub API limit from 60/hour. A fine-grained token with
# read-only Actions access on this one repository is enough.
# GITHUB_TOKEN=github_pat_...
EOF
sudo chmod 600 /etc/rccf-deploy.conf
```

`sudo tee`, not `sudo cat > file` — the redirect is performed by your own shell
before sudo is involved, so that fails with `Permission denied`.

**6. The timer.**

```sh
sudo cp /srv/rccf/app/deploy/rccf-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rccf-deploy.timer
```

Enable the **timer**, never the service. The service has no `[Install]` section
precisely so that `systemctl enable rccf-deploy.service` fails rather than
quietly adding a second trigger at every boot.

**7. First deploy.** Rehearse, then do it:

```sh
sudo bash /srv/rccf/app/deploy/deploy.sh --dry-run --force
sudo bash /srv/rccf/app/deploy/deploy.sh --force
```

The dry run prints the plan and touches nothing. The real one ends with
`health checks passed` and `deployed <sha>`.

**8. Confirm it survives a reboot.** Two things must be true, and neither needs
an actual reboot to check:

```sh
systemctl is-enabled rccf-deploy.timer   # enabled
systemctl is-enabled docker              # enabled
systemctl list-timers rccf-deploy.timer  # next fire time
```

`enabled` means a symlink in `timers.target.wants`, which is what makes systemd
start it at boot; `OnBootSec=2min` resumes the cycle two minutes in. The
containers come back on their own because compose marks them
`restart: unless-stopped`, which is why the Docker line matters as much.

## Using it

```sh
journalctl -u rccf-deploy -f              # watch a deploy happen
journalctl -u rccf-deploy -n 50           # what it did last
sudo bash /srv/rccf/app/deploy/deploy.sh --dry-run   # what would it do
sudo bash /srv/rccf/app/deploy/deploy.sh --force     # deploy now, CI or no CI
```

State lives in `/var/lib/rccf-deploy`: `deployed` is the commit currently
serving, `failed` is one that broke.

`git` in `/srv/rccf/app` needs `sudo` too, or it refuses with
`detected dubious ownership` — the clone is root-owned and you are not root.
Do not add a `safe.directory` exception to make that go away: the agent runs as
root, root owns the repository, and the check never fires for it.

## Things worth knowing before you rely on it

**A commit with no CI run is never deployed, and never gives up waiting.** The
gate asks GitHub for the `ci.yml` run against that exact SHA *on that branch*;
"no run yet" and "still running" are the same answer, because seconds after a
push they are indistinguishable. That is the safe direction to be wrong in, but
a branch whose head predates the workflow sits there forever with
`CI still running` in the journal. Deploy it once with `--force`.

The branch matters: one commit can carry runs from several branches — develop on
a feature branch, fast-forward `main` onto it, and that SHA now has one of each.
Asking by SHA alone and taking the newest would make the verdict depend on which
push landed last.

**A commit that fails to deploy is not retried.** It is recorded in
`/var/lib/rccf-deploy/failed` and skipped until the branch moves again — without
that, the timer would rebuild a broken commit every two minutes all night. The
fix is another commit, or `--force` once you know why.

**There is no automatic rollback.** If the health check fails the script stops
and says so, loudly, in the journal — but the new containers are already up.
Rolling back is `sudo git -C /srv/rccf/app checkout <good-sha>` and `--force`.

**Nothing here brings the stack up if it is down.** The agent acts on *changes*,
so a tick with nothing new to deploy exits before it health-checks anything.

**Old asset chunks are kept for a fortnight, not deleted.** The frontend splits
its routes with `lazy()`, so a member with the dashboard open when a deploy
lands is holding an `index.html` that names the *previous* build's chunks.
Deleting those turns their next click into a failed import. Filenames are
content-hashed, so keeping them costs a few hundred kilobytes.

**`index.html` is synced last**, after every other file, because it names those
chunks — copying it first leaves a window where the browser is handed an index
pointing at files that are not on disk yet.

**Both compose profiles are named on every call.** The stack splits into `app`
(postgres, migrate, api) and `web` (nginx), and `web` declares `depends_on: api`
across that boundary — so a command naming one profile describes a project in
which the other half does not exist, and compose refuses the lot:
`service "web" depends on undefined service "api": invalid compose project`.
That is in the `compose` helper rather than at the call sites, and
`classify.test.sh` asserts it stays there.

**Nothing touches the database beyond migrations**, and those are the compose
`migrate` service's job. There is no seed on deploy — the production database
has real members in it.

## Cloudflare is in front of all of this

It is not only a CDN. A WAF rule matching `/join` once served a managed
challenge to `POST /api/projects/:id/join`, and members could not join projects:
a `403` with `cf-mitigated: challenge`, from the edge, never reaching the server.
When something works locally and not on the live site, check whether the request
is arriving at all — `curl -sD - -o /dev/null https://rccf.club/<path>` and look
for `cf-mitigated`.
