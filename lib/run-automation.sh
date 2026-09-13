#!/bin/zsh
# Generic launchd entry point for any automation in this repo.
#
#   lib/run-automation.sh <automation-name> <pnpm-script> [args...]
#
# Records every run in .local/runs.jsonl, keeps full output in
# .local/<automation-name>/run.log, and surfaces a macOS notification only when
# the automation asks for one. An automation opts into notifications by
# providing automations/<automation-name>/notice.mjs, which receives the run on
# stdin via env and prints a message, or prints nothing to stay silent.
set -o pipefail

automation="$1"
shift
if [[ -z "$automation" || $# -eq 0 ]]; then
  echo "usage: run-automation.sh <automation-name> <pnpm-script> [args...]" >&2
  exit 64
fi

root="${0:A:h:h}"
cd "$root" || exit 1

state="$root/.local/$automation"
mkdir -p "$state"
log="$state/run.log"

notify() {
  /usr/bin/osascript -e "display notification \"${1//\"/\\\"}\" with title \"$automation\"" >/dev/null 2>&1
}

# launchd provides a bare PATH with no node, so resolve the nvm default first
export NVM_DIR="$HOME/.nvm"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh" --no-use >/dev/null 2>&1
  nvm use default >/dev/null 2>&1
fi
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

zmodload zsh/datetime
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_ms=$(( EPOCHREALTIME * 1000 ))

if ! command -v pnpm >/dev/null 2>&1; then
  printf '\n=== %s (exit 127) ===\npnpm not on PATH\n' "$started_at" >>"$log"
  notify "Cannot run: pnpm not found on PATH"
  RUN_AUTOMATION="$automation" RUN_STARTED_AT="$started_at" RUN_DURATION_MS=0 \
    RUN_EXIT_CODE=127 RUN_STDOUT="" RUN_STDERR="pnpm not found on PATH" \
    RUN_NOTIFIED="Cannot run: pnpm not found on PATH" \
    node "$root/lib/run-log.ts" record 2>/dev/null
  exit 127
fi

out_file="$state/last-run.out"
err_file="$state/last-run.err"

pnpm --silent "$@" >"$out_file" 2>"$err_file"
exit_code=$?
duration_ms=$(( EPOCHREALTIME * 1000 - started_ms ))
duration_ms=${duration_ms%%.*}

stdout="$(cat "$out_file")"
stderr="$(cat "$err_file")"

{
  printf '\n=== %s (exit %s, %sms) ===\n' "$started_at" "$exit_code" "$duration_ms"
  printf '%s\n' "$stdout"
  [[ -n "$stderr" ]] && printf '%s\n' "$stderr"
} >>"$log"

message=""
notice="$root/automations/$automation/notice.mjs"
if [[ -f "$notice" ]]; then
  message="$(
    RUN_STDOUT="$stdout" RUN_STDERR="$stderr" RUN_STATUS="$exit_code" \
    node "$notice"
  )"
fi

if [[ -n "$message" ]]; then
  notify "$message"
  printf 'NOTIFIED: %s\n' "$message" >>"$log"
fi

RUN_AUTOMATION="$automation" RUN_STARTED_AT="$started_at" RUN_DURATION_MS="$duration_ms" \
  RUN_EXIT_CODE="$exit_code" RUN_STDOUT="$stdout" RUN_STDERR="$stderr" \
  RUN_NOTIFIED="$message" \
  node "$root/lib/run-log.ts" record

# keep the per-automation detail log from growing without bound
node -e "import('$root/lib/run-log.ts').then((m) => m.rotateIfLarge('$log'))" 2>/dev/null

exit $exit_code
