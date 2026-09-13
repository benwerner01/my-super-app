#!/bin/zsh
# launchd entry point. Notifies only when something changed or broke.
set -o pipefail

here="${0:A:h}"
root="${here:h:h}"
cd "$root" || exit 1

state="$root/.local/mr-green-calendar"
mkdir -p "$state"
log="$state/run.log"

notify() {
  /usr/bin/osascript -e "display notification \"${1//\"/\\\"}\" with title \"Mr. Green Calendar\"" >/dev/null 2>&1
  printf 'NOTIFIED: %s\n' "$1" >>"$log"
}

# launchd provides a bare PATH with no node, so resolve the nvm default first
export NVM_DIR="$HOME/.nvm"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh" --no-use >/dev/null 2>&1
  nvm use default >/dev/null 2>&1
fi
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v pnpm >/dev/null 2>&1; then
  printf '\n=== %s ===\npnpm not on PATH\n' "$(date -Iseconds)" >>"$log"
  notify "Cannot run: pnpm not found on PATH"
  exit 127
fi

out_file="$state/last-run.out"
err_file="$state/last-run.err"

pnpm --silent mr-green:calendar sync >"$out_file" 2>"$err_file"
exit_code=$?

{
  printf '\n=== %s (exit %s) ===\n' "$(date -Iseconds)" "$exit_code"
  cat "$out_file"
  [[ -s "$err_file" ]] && cat "$err_file"
} >>"$log"

message="$(
  MR_GREEN_STDOUT="$(cat "$out_file")" \
  MR_GREEN_STDERR="$(cat "$err_file")" \
  MR_GREEN_STATUS="$exit_code" \
  node "$here/notice.mjs"
)"

[[ -n "$message" ]] && notify "$message"

exit $exit_code
