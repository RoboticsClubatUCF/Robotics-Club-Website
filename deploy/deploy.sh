#!/usr/bin/env bash
#
# Bring the box up to whatever is on main, if main is green.
#
# The club's box has no public address — it sits on a LAN and a Cloudflare
# Tunnel on another machine reaches it at :4173 — so GitHub cannot push a
# deployment to it and there is no webhook to receive. This pulls instead: a
# systemd timer runs it every couple of minutes, it asks GitHub what main points
# at, and if that is something new and CI passed on it, it deploys.
#
# **Pull rather than a self-hosted Actions runner, and the repository being
# public is the whole reason.** A runner executes workflow files that arrive
# with a pull request, and this box holds the club's live Discord bot token,
# live Stripe keys and a database of real members. Nothing here runs code from
# GitHub except the code that is already on main and already passed CI.
#
# What it does with a change depends on what changed:
#
#   web/**            rebuild the bundle and sync it into the nginx root
#   server/**         rebuild the API image and bring the stack up (migrations
#                     run first — the compose `migrate` service is a dependency
#                     of `api`, so this is not something to sequence here)
#   server/nginx.conf recreate the web container, which mounts it
#
# Anything else — the docs, this script, CI — reaches the checkout and does
# nothing else, which is correct.
#
# Usage:
#   deploy.sh              one tick: deploy if there is something to deploy
#   deploy.sh --force      redeploy whatever main points at, green or not,
#                          changed or not. The manual override.
#   deploy.sh --dry-run    say what it would do and touch nothing
#
# **The whole body is a function called on the last line, and that is load
# bearing.** The unit runs this file straight out of the git checkout, so a
# deploy that updates this script rewrites the file bash is reading. Bash reads
# a script incrementally as it executes, so a plain top-to-bottom script can be
# swapped underneath itself mid-run and continue into whatever bytes now sit at
# that offset. Parsing the lot first makes that harmless.

# `-E` matters as much as `-e` here. Without it an ERR trap set in `main` is not
# inherited by the functions `main` calls, so a build that failed inside
# `deploy_web` would exit without ever recording the commit as failed — and the
# timer would then rebuild that same broken commit every two minutes all night.
set -Eeuo pipefail

main() {
  # ------------------------------------------------------------------ config
  #
  # Everything is overridable from /etc/rccf-deploy.conf so the paths on the box
  # are not baked into a file that lives in a public repository.
  REPO="${REPO:-RoboticsClubatUCF/Robotics-Club-Website}"
  BRANCH="${BRANCH:-main}"
  # The persistent checkout. **Not a fresh clone per deploy**: `server/.env` and
  # `web/.env.production` live in it, are gitignored, and are the only copy of
  # the club's keys. `git reset --hard` leaves ignored files alone, which is why
  # this is safe — and why nothing below ever runs `git clean -x`.
  REPO_DIR="${REPO_DIR:-/srv/rccf/app}"
  # What nginx serves, bind-mounted read-only into the web container.
  WEB_ROOT="${WEB_ROOT:-/srv/rccf/web}"
  STATE_DIR="${STATE_DIR:-/var/lib/rccf-deploy}"
  # The port the compose `web` service publishes; the tunnel points at it.
  WEB_PORT="${WEB_PORT:-4173}"
  # The workflow that has to be green. A file name rather than a display name:
  # renaming the workflow should not silently disable the gate.
  CI_WORKFLOW="${CI_WORKFLOW:-ci.yml}"
  # Optional. Unauthenticated GitHub API reads are capped at 60/hour per
  # address, which is plenty here — the API is only asked when main has actually
  # moved — but a token raises it and costs nothing.
  GITHUB_TOKEN="${GITHUB_TOKEN:-}"
  # How long to wait for the API to answer its health check after a restart.
  HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
  # Asset chunks older than this are pruned. See the sync step for why they are
  # not simply deleted the moment they stop being referenced.
  ASSET_KEEP_DAYS="${ASSET_KEEP_DAYS:-14}"

  # shellcheck source=/dev/null
  [[ -f /etc/rccf-deploy.conf ]] && . /etc/rccf-deploy.conf

  local force=0 dry=0
  for arg in "$@"; do
    case "$arg" in
      --force) force=1 ;;
      --dry-run) dry=1 ;;
      -h | --help)
        sed -n '3,40p' "$0"
        return 0
        ;;
      *)
        log "unknown argument: $arg"
        return 2
        ;;
    esac
  done

  need git
  need curl
  need jq
  need rsync
  need docker
  # The frontend is built here, so node is a hard dependency of this box rather
  # than of CI. Checked up front, and up front matters: without it the first
  # sign of a missing node was a failed deploy two minutes into a build, with
  # the commit already written off as broken.
  need npm
  # util-linux, so present on any Debian box — but checked here so a missing one
  # fails with a sentence rather than at the redirection below.
  need flock

  [[ -d $REPO_DIR/.git ]] || die "no git checkout at $REPO_DIR"
  mkdir -p "$STATE_DIR"

  # One deploy at a time. The timer fires on a schedule and a build can outrun
  # the interval; two of these in the same tree at once would interleave a
  # `git reset` with a running `npm run build`.
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || {
    log "another deploy is running; leaving this tick alone"
    return 0
  }

  # --------------------------------------------------------- what is on main

  git -C "$REPO_DIR" fetch --quiet --prune origin "$BRANCH"
  local target
  target=$(git -C "$REPO_DIR" rev-parse "origin/$BRANCH")

  local deployed=""
  [[ -f $STATE_DIR/deployed ]] && deployed=$(<"$STATE_DIR/deployed")

  if [[ $force -eq 0 ]]; then
    [[ $target == "$deployed" ]] && return 0

    # A commit that has already been tried and failed is not retried until main
    # moves again. Without this the timer would rebuild a broken commit every
    # two minutes for as long as it stayed at the head of main.
    if [[ -f $STATE_DIR/failed && $target == "$(<"$STATE_DIR/failed")" ]]; then
      return 0
    fi

    case "$(ci_verdict "$target")" in
      success) ;;
      pending)
        note_once pending "$target" "CI still running for ${target:0:8}; waiting"
        return 0
        ;;
      *)
        note_once skipped "$target" "CI is not green for ${target:0:8}; not deploying"
        return 0
        ;;
    esac
  fi

  # ------------------------------------------------------- what has changed
  #
  # Worked out before the reset, so it is a comparison between what is running
  # and what is about to. An unknown or missing previous commit — a first run, a
  # rewritten history — means everything is treated as changed, which is the
  # safe direction to be wrong in.
  local changed
  if [[ -n $deployed ]] && git -C "$REPO_DIR" cat-file -e "$deployed^{commit}" 2>/dev/null; then
    changed=$(git -C "$REPO_DIR" diff --name-only "$deployed" "$target")
  else
    log "no known previous deploy; treating everything as changed"
    changed=$(git -C "$REPO_DIR" ls-tree -r --name-only "$target")
  fi

  local do_web do_api do_nginx
  read -r do_web do_api do_nginx <<<"$(classify "$changed")"

  if [[ $force -eq 1 ]]; then
    do_web=1
    do_api=1
    do_nginx=1
  fi

  if [[ $dry -eq 1 ]]; then
    log "would deploy ${target:0:8} — web=$do_web api=$do_api nginx=$do_nginx"
    log "dry run; stopping here"
    return 0
  fi

  # **The checkout follows the branch even when nothing needs rebuilding, and
  # this has to happen before the early return below.**
  #
  # It used to sit after it, so a commit that changed only documentation, CI or
  # *this script* was recorded as deployed while the working tree stayed on the
  # commit before it — the state file claiming a version the box was not on. The
  # bite is specific: `deploy/**` classifies as nothing-to-rebuild by design,
  # because the unit runs this file straight out of the checkout and a changed
  # script needs no build. Which means an improvement to the deploy agent was
  # exactly the kind of commit that never reached the disk, and would sit unused
  # until some unrelated change to web/ or server/ happened to drag it in.
  #
  # `--hard` and deliberately no `clean -x`: the two .env files are ignored, so
  # they survive this, and they are the only copy of the club's keys on the box.
  git -C "$REPO_DIR" reset --quiet --hard "$target"

  if [[ $do_web -eq 0 && $do_api -eq 0 && $do_nginx -eq 0 ]]; then
    log "${target:0:8} changes nothing that is served; checkout updated"
    printf '%s\n' "$target" >"$STATE_DIR/deployed"
    return 0
  fi

  log "deploying ${target:0:8} — web=$do_web api=$do_api nginx=$do_nginx"

  # From here on a failure is recorded against this commit, so the timer does
  # not spend the rest of the afternoon rebuilding it.
  trap 'printf "%s\n" "$target" >"$STATE_DIR/failed"; log "DEPLOY FAILED at ${target:0:8}"' ERR

  [[ $do_web -eq 1 ]] && deploy_web "$changed"
  [[ $do_api -eq 1 ]] && deploy_api
  [[ $do_nginx -eq 1 ]] && deploy_nginx

  health_check

  trap - ERR
  printf '%s\n' "$target" >"$STATE_DIR/deployed"
  rm -f "$STATE_DIR/failed" "$STATE_DIR/pending" "$STATE_DIR/skipped"
  log "deployed ${target:0:8}"
}

# ------------------------------------------------------- which half is it, then
#
# A newline-separated list of changed paths in, three flags out: "web api nginx".
#
# Its own function so it can be reasoned about — and tested — without a box, a
# clone or a Docker daemon. Every rule in it is a claim about how the site is
# actually served, and the comments are which claim.
classify() {
  local changed=$1
  local web=0 api=0 nginx=0

  # The bundle is a build artefact of web/, and nothing else produces it.
  if grep -qE '^web/' <<<"$changed"; then web=1; fi

  # Anything under server/ goes into the API image — except nginx.conf, which is
  # not in the image at all. It is bind-mounted into the *web* container, so it
  # must not be what triggers an API rebuild, and an API rebuild must not be
  # what is relied on to pick it up. `grep -v` would be wrong here: it asks
  # "is any line not nginx.conf", which is true for every commit that touches
  # two files. Strip the ones that are not the API's and look at what is left.
  if grep -E '^server/' <<<"$changed" | grep -qvE '^server/(nginx\.conf)$'; then api=1; fi

  if grep -qE '^server/nginx\.conf$' <<<"$changed"; then nginx=1; fi

  # The compose file defines both halves, so a change to it touches both.
  if grep -qE '^server/docker-compose\.yml$' <<<"$changed"; then
    api=1
    nginx=1
  fi

  printf '%s %s %s\n' "$web" "$api" "$nginx"
}

# --------------------------------------------------------------- the frontend

deploy_web() {
  local changed=$1

  assert_api_url

  # `npm ci` wipes and reinstalls from the lockfile, which takes a minute or so
  # and is only actually needed when the lockfile moved. Most frontend commits
  # do not touch it.
  if grep -qE '^web/package-lock\.json$' <<<"$changed" || [[ ! -d $REPO_DIR/web/node_modules ]]; then
    log "installing web dependencies"
    npm --prefix "$REPO_DIR/web" ci
  fi

  log "building the bundle"
  # Reads web/.env.production for VITE_API_URL and the Stripe publishable key.
  # Both are baked into the bundle at this moment and cannot be changed
  # afterwards without another build — which is why the build happens here, on
  # the box that has the file, rather than in CI.
  npm --prefix "$REPO_DIR/web" run build

  local dist="$REPO_DIR/web/dist"
  [[ -f $dist/index.html ]] || die "build produced no index.html"

  mkdir -p "$WEB_ROOT"

  # **Three passes, in this order, and the order is the whole point.**
  #
  # index.html names the hashed chunks it needs. Copy it first and there is a
  # window — however short — where the browser is handed an index referring to
  # assets that are not on disk yet, and the site is blank. So: everything else
  # first, then index.html, which is the moment the new version goes live.
  log "syncing the bundle into $WEB_ROOT"
  rsync -a --exclude=index.html "$dist/" "$WEB_ROOT/"
  rsync -a "$dist/index.html" "$WEB_ROOT/index.html"

  # **The old chunks stay for a fortnight rather than being deleted now**, and
  # that is not untidiness. The app splits its routes with `lazy()`, so a member
  # who had the dashboard open when this ran has an index.html in memory naming
  # the *previous* build's chunks; deleting them turns their next click into a
  # failed import. Filenames are content-hashed, so keeping them costs a few
  # hundred kilobytes and nothing else.
  find "$WEB_ROOT/assets" -type f -mtime "+$ASSET_KEEP_DAYS" -delete 2>/dev/null || true
}

# Refuse to build a bundle that points at the visitor's own machine.
#
# `VITE_API_URL` is baked in at build time, and unset it falls back to
# `http://localhost:4000` — so a build with no env file in place produces a site
# where every request goes to whatever is on port 4000 of the *reader's*
# computer. Nothing fails: the build succeeds, the sync succeeds, the health
# check passes because nginx is serving something, and the site is broken for
# everybody with a console full of connection refusals.
#
# The build already notices and prints a warning. A warning is the wrong shape
# for this: nobody is watching at two in the morning, and the whole point of
# this script is that nobody has to be. Same test as `reportApiUrl` in
# `web/vite.config.ts` — keep the two in step.
#
# Vite reads `.env` first and `.env.production` over the top, so the last match
# in that order is the one that wins.
assert_api_url() {
  local url
  url=$(cat "$REPO_DIR/web/.env" "$REPO_DIR/web/.env.production" 2>/dev/null |
    grep -E '^[[:space:]]*VITE_API_URL[[:space:]]*=' |
    tail -1 |
    cut -d= -f2- |
    tr -d '"'\''[:space:]' || true)

  # `|| die`, the same shape as every other check in this file, so the failure
  # propagates through errexit rather than through anything clever.
  [[ -n $url ]] ||
    die "VITE_API_URL is not set in $REPO_DIR/web/.env or .env.production — a bundle built now would call the visitor's own machine"

  [[ $url != *localhost* && $url != *127.0.0.1* ]] ||
    die "VITE_API_URL is $url — that is a local build and must not be deployed"

  log "bundle will call $url"
}

# ---------------------------------------------------------------- the backend

deploy_api() {
  log "rebuilding the API image and bringing the stack up"
  # The compose file makes `api` depend on `migrate` completing successfully, so
  # `prisma migrate deploy` runs against the database exactly once, before any
  # API process starts — there is nothing for this script to sequence and it
  # must not try.
  compose up -d --build
}

deploy_nginx() {
  log "recreating the web container"
  # nginx.conf is a read-only bind mount, so a changed file on disk means
  # nothing until the container is recreated.
  compose up -d --force-recreate web
}

# **Both profiles, on every call, and that is not belt-and-braces.**
#
# The stack is split into `app` (postgres, migrate, api) and `web` (nginx), and
# `web` declares `depends_on: api`. A command naming only one profile therefore
# describes a project in which the other half's services do not exist, and
# compose refuses the whole thing rather than ignoring the dangling reference:
#
#   service "web" depends on undefined service "api": invalid compose project
#
# Which is exactly what `--profile web up -d --force-recreate web` did on the
# first real deploy. Naming both is the documented way to drive this stack — see
# the comment above the `web` service — and it costs nothing: `up -d` against a
# service whose configuration has not changed leaves it alone.
compose() {
  docker compose \
    --project-directory "$REPO_DIR/server" \
    -f "$REPO_DIR/server/docker-compose.yml" \
    --profile app --profile web \
    "$@"
}

# ------------------------------------------------------------- did it survive

health_check() {
  # Both halves, through the port the tunnel actually uses, so this is the same
  # path a visitor takes rather than a container talking to itself.
  local deadline=$((SECONDS + HEALTH_TIMEOUT))

  # `-fs` and not `-fsS` in the loop: a refused connection here is the *normal*
  # first result, because the container it is asking for was recreated seconds
  # ago. Printing curl's complaint for each attempt puts `curl: (56) Recv
  # failure: Connection reset by peer` in the journal immediately above
  # `health checks passed`, which reads like something went wrong when nothing
  # did. The timeout below is what reports a real failure, in a sentence.
  until curl -fs -o /dev/null --max-time 5 "http://localhost:$WEB_PORT/api/health"; do
    ((SECONDS < deadline)) || die "the API never answered /api/health in ${HEALTH_TIMEOUT}s"
    sleep 3
  done

  curl -fsS -o /dev/null --max-time 5 "http://localhost:$WEB_PORT/" ||
    die "nginx is not serving the site"

  log "health checks passed"
}

# ------------------------------------------------------------------- the gate

# Whether CI passed on a commit: `success`, `pending` or `failed`.
#
# Asked of the workflow *file* rather than of the commit's combined status,
# because a commit can carry check runs from anything and only this one means
# "the tests ran and the bundle built".
#
# **Filtered by branch as well as by commit, and that is not belt-and-braces.**
# One commit can have several runs: develop on a branch, fast-forward main onto
# it, and that SHA now has a run against each. Asking only by SHA and taking the
# newest means the verdict depends on which push happened to land last — so a
# commit whose run went red on a feature branch and green on main, or the
# reverse, could be read either way. The question this has to answer is "did CI
# pass for what is about to be deployed", and that is one branch's run.
ci_verdict() {
  local sha=$1 url response run
  url="https://api.github.com/repos/$REPO/actions/workflows/$CI_WORKFLOW/runs?head_sha=$sha&branch=$BRANCH&per_page=1"

  local -a auth=()
  [[ -n $GITHUB_TOKEN ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")

  response=$(curl -fsS --max-time 20 \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${auth[@]}" "$url" 2>/dev/null) || {
    # A rate limit or a network blip is not a red build. Reporting it as pending
    # means the next tick asks again rather than this commit being written off.
    log "could not reach the GitHub API; will ask again next tick"
    echo pending
    return 0
  }

  run=$(jq -r '.workflow_runs[0] // empty' <<<"$response")
  # No run yet is normal for a few seconds after a push.
  [[ -z $run ]] && {
    echo pending
    return 0
  }

  local status conclusion
  status=$(jq -r '.status' <<<"$run")
  conclusion=$(jq -r '.conclusion // ""' <<<"$run")

  if [[ $status != completed ]]; then
    echo pending
  elif [[ $conclusion == success ]]; then
    echo success
  else
    echo "failed:$conclusion"
  fi
}

# ----------------------------------------------------------------- plumbing

# Log a thing once per commit, so a red main does not write the same line into
# the journal every two minutes forever.
note_once() {
  local kind=$1 sha=$2 message=$3
  local marker="$STATE_DIR/$kind"
  [[ -f $marker && $(<"$marker") == "$sha" ]] && return 0
  printf '%s\n' "$sha" >"$marker"
  log "$message"
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is not installed"
}

log() {
  # No timestamp: journald puts one on every line and two is noise.
  printf 'rccf-deploy: %s\n' "$*"
}

die() {
  log "$*"
  return 1
}

# Guarded so `classify.test.sh` can source this file for its functions without
# running a deploy. Everything else is inside a function, so a source defines
# and does nothing.
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
