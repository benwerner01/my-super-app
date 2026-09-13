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

Scheduled by launchd (`ch.benwerner.mr-green-calendar`, Mondays 08:00), which
runs `automations/mr-green-calendar/run.sh`. Force a run with:

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
