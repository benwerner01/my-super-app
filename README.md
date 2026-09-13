# my-super-app

Personal automations, scheduled jobs and small apps. Single-user, no deployment.

## Layout

```
lib/            shared across everything (lib/google — OAuth for any Google API)
automations/    one directory per automation, each self-contained
.local/         credentials, tokens, generated files, logs — gitignored, never committed
```

Add `apps/` alongside when something needs a UI. There is no workspace tooling
until something actually needs it.

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
- `.local/<name>/run.log` — full stdout and stderr per run, for when the
  structured line is not enough. Rotated past 2MB.
- `.local/<name>/last-run.out` / `.err` — just the most recent run.

Running an automation's pnpm script directly (`pnpm mr-green:calendar sync`) is
**not** recorded — you are watching the output yourself. Use
`pnpm run:automation` when you want a manual run in the history.

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
shared runner. Force a run with:

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
