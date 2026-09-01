#!/usr/bin/env bash
#
# What `classify` in deploy.sh decides, for the commits it will actually see.
#
# This is the one piece of the deploy agent that can be tested without a box, a
# Docker daemon or a clone — and it is also the piece most likely to be quietly
# wrong, because every rule in it is a claim about how the site is served rather
# than about the code. Getting it wrong is not loud: too eager rebuilds
# something that did not change and costs a minute, too shy leaves the box
# serving the previous version of a file somebody has just fixed.
#
# Run it directly, or let CI do it:  bash deploy/classify.test.sh

set -Eeuo pipefail

# SCRIPTDIR so this resolves the same whether shellcheck is run from the repo
# root (CI does) or from deploy/ (a person does).
# shellcheck source-path=SCRIPTDIR
# shellcheck source=deploy.sh
. "$(dirname "${BASH_SOURCE[0]}")/deploy.sh"

failed=0

check() {
  local description=$1 expected=$2 paths=$3 got
  got=$(classify "$paths")

  if [[ $got == "$expected" ]]; then
    printf '  ok   %-44s %s\n' "$description" "$got"
  else
    printf '  FAIL %-44s %s (expected %s)\n' "$description" "$got" "$expected"
    failed=1
  fi
}

printf 'classify: web api nginx\n'

check 'frontend only'             '1 0 0' 'web/src/pages/public/ProjectPage.tsx'
check 'backend only'              '0 1 0' 'server/src/routes/public/content.ts'
check 'a migration'               '0 1 0' 'server/prisma/migrations/20260101_x/migration.sql'
check 'both halves'               '1 1 0' $'web/src/App.tsx\nserver/src/app.ts'

# nginx.conf is under server/ and is not in the API image — it is mounted into
# the *web* container. It has to move the nginx flag and nothing else.
check 'nginx.conf alone'          '0 0 1' 'server/nginx.conf'

# The case the obvious implementation gets wrong. `grep -v` over the whole list
# asks "is any line not nginx.conf", which is true the moment a commit touches
# two files — so a frontend change shipped alongside an nginx tweak would
# rebuild the API image for no reason.
check 'nginx.conf + frontend'     '1 0 1' $'web/src/App.tsx\nserver/nginx.conf'
check 'nginx.conf + backend'      '0 1 1' $'server/nginx.conf\nserver/src/app.ts'

# The compose file defines both halves.
check 'compose alone'             '0 1 1' 'server/docker-compose.yml'

# Nothing that is served changes, so nothing should be rebuilt. The deploy
# script updating itself is the interesting one: it reaches the checkout and
# takes effect on the next tick, with no restart of anything.
check 'docs only'                 '0 0 0' $'README.md\n.claude/docs/testing.md'
check 'the deploy script itself'  '0 0 0' 'deploy/deploy.sh'
check 'CI workflow'               '0 0 0' '.github/workflows/ci.yml'

exit $failed
