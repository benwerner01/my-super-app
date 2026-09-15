# my-super-app

Personal automations, scheduled jobs and small apps. Single-user, no deployment.

## Layout

```
lib/            shared across everything (lib/google — OAuth for any Google API)
automations/    one directory per automation, each self-contained
apps/           anything with a UI (apps/dashboard — read-only view of the above)
launchd/        tracked launchd agent templates
.local/         credentials, tokens, generated files, logs — gitignored, never committed
```

`apps/*` is a pnpm workspace; the root package stays the automations runner and
has no runtime dependencies of its own.

## Running

Requires Node 24+. TypeScript runs natively via type stripping, so there is no
build step and no runtime dependencies — `typescript` is only used to typecheck.

```sh
pnpm install
cp .env.example .env.local   # then fill it in
pnpm typecheck
pnpm test
```

## Secrets

Anything personal or secret lives in `.env.local` or `.local/`, both gitignored.
This repository is public: never hardcode an email address, a postcode, a token,
or a client secret in tracked files.

## Adding an automation

1. Create `automations/<name>/` with an `index.ts` entry point, and add a pnpm
   script for it.
2. Print **one JSON object to stdout** as the last thing the run does. Include
   `changed: boolean`, and `changes` or `summary` for detail. The runner records
   those fields; anything else is still logged, just with less structure.
3. Optionally add `automations/<name>/notice.mjs`. It receives `RUN_STDOUT`,
   `RUN_STDERR` and `RUN_STATUS` in the environment, and prints a message to
   raise a notification — or prints nothing to stay silent.
4. Schedule it with a launchd plist invoking the shared runner:

```
/bin/zsh  lib/run-automation.sh  <name>  <pnpm-script>  [args...]
```

## Run history

Every run through `lib/run-automation.sh` is recorded, whether scheduled or
manual. Nothing here is committed.

```sh
pnpm runs              # recent runs, newest last
pnpm runs 50           # more of them
pnpm run:automation mr-green-calendar mr-green:calendar sync   # run it now, logged
```

- `.local/runs.jsonl` — one JSON line per run across all automations:
  timestamp, duration, exit code, whether anything changed, what was notified,
  and any error. Queryable with `jq`.
  `error` is an asserted failure only — what the automation reported as `error`,
  or its stderr when it actually exited non-zero. Whatever a *successful* run
  wrote to stderr is kept separately in `stderr`, so a deprecation warning is
  still visible without being dressed up as a failure.
- `.local/<name>/run.log` — full stdout and stderr per run, for when the
  structured line is not enough. Rotated past 2MB.
- `.local/<name>/last-run.out` / `.err` — just the most recent run.

Running an automation's pnpm script directly (`pnpm mr-green:calendar sync`) is
**not** recorded — you are watching the output yourself. Use
`pnpm run:automation` when you want a manual run in the history.

## Dashboard

`apps/dashboard` is a read-only view of everything above: which automations
exist, whether launchd is actually scheduling them, and what each run did. It
never runs, edits or disables anything — the terminal acts, the dashboard only
observes.

```sh
pnpm dashboard:dev       # http://127.0.0.1:7777, hot reload
pnpm dashboard:build     # production build
pnpm dashboard:start     # serve the production build
```

It binds to `127.0.0.1` only and has no auth, which is why it must stay on
loopback. The port and host are defined once, in `apps/dashboard/serve.mjs`;
`DASHBOARD_PORT` overrides the port.

### Always on

`launchd/ch.benwerner.dashboard.plist` is a template — it is tracked with a
`__REPO_ROOT__` placeholder because this repository is public. Install it once:

```sh
pnpm dashboard:build
sed "s|__REPO_ROOT__|$PWD|g" launchd/ch.benwerner.dashboard.plist \
  > ~/Library/LaunchAgents/ch.benwerner.dashboard.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/ch.benwerner.dashboard.plist
```

It runs at login and `KeepAlive` restarts it if it dies, logging to
`.local/dashboard/`.

**After changing dashboard code, the running agent keeps serving the old
production build until you rebuild and restart it:**

```sh
pnpm dashboard:build
launchctl kickstart -k gui/$UID/ch.benwerner.dashboard
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7777
```

## Automations

### `mr-green-calendar`

Keeps Google Calendar populated with Mr. Green recycling pickups, and invites a
guest to the dates the source confirms.

```sh
pnpm mr-green:calendar preview                      # fetch and print, writes nothing
pnpm mr-green:calendar authorize <client_secret.json>
pnpm mr-green:calendar sync --dry-run               # show the plan
pnpm mr-green:calendar sync
```

Scheduled by launchd (`ch.benwerner.mr-green-calendar`, Mondays 08:00) via the
shared runner — the dashboard reads that agent to show the schedule. Force a run
with:

```sh
launchctl kickstart -k gui/$UID/ch.benwerner.mr-green-calendar
```

Every event it owns is tagged `extendedProperties.private.source`, and each run
reconciles against that tag: missing dates are inserted, moved dates updated,
and tagged future events the source dropped are deleted. Re-running is a no-op.

The API only returns a handful of future dates. Anything past those is projected
on a 28-day cadence and labelled `projected` in the event description; observed
gaps are not always 28 days, so those shift as real dates get published. Guests
are invited to confirmed dates only.
