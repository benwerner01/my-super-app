#!/bin/zsh
# launchd entry point for the local dashboard.
#
#   lib/run-dashboard.sh
#
# Serves the production build of apps/dashboard on 127.0.0.1 and stays in the
# foreground so launchd's KeepAlive can restart it. The build is not made here:
# a rebuilt dashboard only appears after `pnpm dashboard:build` followed by
# `launchctl kickstart -k gui/$UID/ch.benwerner.dashboard`.
set -o pipefail

root="${0:A:h:h}"
cd "$root" || exit 1
mkdir -p "$root/.local/dashboard"

# launchd provides a bare PATH with no node, so resolve the nvm default first
export NVM_DIR="$HOME/.nvm"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh" --no-use >/dev/null 2>&1
  nvm use default >/dev/null 2>&1
fi
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) cannot start dashboard: pnpm not found on PATH" >&2
  exit 127
fi

if [[ ! -d "$root/apps/dashboard/.next" ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) no production build: run pnpm dashboard:build" >&2
  exit 78
fi

exec pnpm dashboard:start
