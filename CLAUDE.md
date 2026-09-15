# CLAUDE.md

Personal automations repo for a single user on one Mac. Nothing is deployed;
everything runs locally under launchd. Read `README.md` for the user-facing view.

## Layout

```
lib/              shared code (lib/run-log.ts, lib/google/, the two runner scripts)
automations/      one directory per automation, self-contained
apps/dashboard/   Next.js read-only dashboard over everything above
launchd/          tracked launchd plist templates (__REPO_ROOT__ placeholder)
.local/           credentials, tokens, logs, run history — gitignored
```

`apps/*` is a pnpm workspace. The root package is the automations runner.

## Conventions

- **Node 24+, native TypeScript.** Type stripping, no build step for anything
  outside `apps/`. Imports use explicit `.ts` / `.tsx` extensions.
- **Zero runtime dependencies at the root.** `typescript` and `@types/node` are
  devDependencies used only to typecheck. Do not add a runtime dependency to the
  root package; `apps/dashboard` has its own (Next, React, Tailwind — nothing
  else, and adding to that list needs justification).
- **Strict TS.** The root `tsconfig.json` uses `erasableSyntaxOnly`, NodeNext and
  `noUncheckedIndexedAccess`, and includes only `automations/**` and `lib/**`.
  It must not be loosened for the dashboard — `apps/dashboard/tsconfig.json` is
  separate and bundler-flavoured.
- **This repository is public.** Never commit an email address, postcode, token,
  client secret, or any value from `.env.local` or `.local/`. Test fixtures are
  synthesized, never copied from real data. Tracked launchd templates use a
  `__REPO_ROOT__` placeholder instead of a real home directory path.
- **`.local/` is the only writable state.** It is gitignored and never committed.

## Automations

Each is `automations/<name>/index.ts`, plus a pnpm script. The last thing a run
prints on stdout is one JSON object including `changed: boolean` and `changes`
or `summary`. An optional `automations/<name>/notice.mjs` receives `RUN_STDOUT`,
`RUN_STDERR` and `RUN_STATUS` and prints a macOS notification message, or prints
nothing to stay silent.

`lib/run-automation.sh <name> <pnpm-script> [args...]` is the shared entry point
for every scheduled and manual-but-recorded run. It writes:

- `.local/runs.jsonl` — one `RunRecord` per run across all automations
  (`lib/run-log.ts` defines the type and `readRuns()`; use it, never re-parse)
- `.local/<name>/run.log` — full output per run, rotated to `run.log.1` past 2MB
- `.local/<name>/last-run.out` / `.err` — the most recent run only

Scheduling is launchd agents labelled `ch.benwerner.<name>` with plists in
`~/Library/LaunchAgents/`. An automation directory with no agent is never run —
the dashboard surfaces that as "not scheduled".

Note that an automation can exit 0 and still report `error` in its JSON;
`mr-green-calendar` swallows transient scrape failures this way. Exit code alone
is not the health signal.

`RunRecord.error` and `RunRecord.stderr` are deliberately separate, and the
split must not be collapsed in either direction:

- `error` — an asserted failure: the automation's own `error` field, or its
  stderr when the process exited non-zero. This is what drives `degraded` and
  `failing`, and it is the only thing allowed to.
- `stderr` — everything written to stderr, kept whether or not the run failed.
  A warning on a successful run lands here and nowhere else.

Folding stderr back into `error` cries wolf on every deprecation warning;
dropping it instead hides a problem an automation only ever mentions on stderr.
Both surfaces render `stderr` explicitly but without error styling.

## Dashboard (`apps/dashboard`)

Next.js App Router + Tailwind. It **observes only**: no route, action or button
may execute a command, write to `.local/`, or mutate anything. It has no auth
because it binds to loopback.

Things that will bite you:

- **Every page that touches the filesystem needs `export const dynamic =
  "force-dynamic"` and `export const runtime = "nodejs"`.** Without it the
  production build prerenders the page and the dashboard silently serves run
  history frozen at build time. `next build` must show `ƒ (Dynamic)` for every
  route — if one shows `○ (Static)`, it is broken.
- **The repo root is not `process.cwd()`.** Under `next start` the cwd is
  `apps/dashboard`. Use `repoRoot()` from `lib/repo-root.ts`, which honours
  `MY_SUPER_APP_ROOT` and otherwise walks up to the directory holding
  `lib/run-log.ts`.
- `lib/run-log.ts` lives outside the app; it resolves through the
  `@repo/run-log` tsconfig path plus `experimental.externalDir`,
  `turbopack.root` and `outputFileTracingRoot` in `next.config.ts`.
- **Host and port live in one place: `apps/dashboard/serve.mjs`** (127.0.0.1,
  `DASHBOARD_PORT` or 7777). Never bind 0.0.0.0.
- This is Next 16, which differs from older conventions in ways your training
  data may predate; `apps/dashboard/node_modules/next/dist/docs/` is the version
  that is actually installed. `next dev` regenerates `AGENTS.md` and
  `CLAUDE.md` inside the app on every run — both are gitignored, leave them be.
- Every reader degrades to an empty state: missing `runs.jsonl`, a torn last
  line, no runs, missing or rotated logs, no plist. None of those may 500.

### Redeploying after a code change — do not skip this

The always-on dashboard is a **production build** served by launchd. Editing
source changes nothing that the browser can see. `pnpm dashboard:dev` also does
not help: the agent is serving the built output, not the dev server.

```sh
pnpm dashboard:build                              # rebuild .next
launchctl kickstart -k gui/$UID/ch.benwerner.dashboard   # restart the agent
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7777   # expect 200
```

Skip either of the first two steps and the browser keeps showing the old build,
with no error anywhere to tell you why.

Installing the agent for the first time:

```sh
sed "s|__REPO_ROOT__|$PWD|g" launchd/ch.benwerner.dashboard.plist \
  > ~/Library/LaunchAgents/ch.benwerner.dashboard.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/ch.benwerner.dashboard.plist
```

Agent logs are in `.local/dashboard/launchd.{out,err}.log`.

## Health check

```sh
pnpm typecheck                      # root: automations/ + lib/
pnpm test                           # root: node --test over automations/**/*.test.ts
pnpm --filter dashboard typecheck   # dashboard, separate tsconfig
pnpm dashboard:build                # must end with every route marked ƒ (Dynamic)
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7777
launchctl print gui/$UID/ch.benwerner.dashboard | grep state
git status --short                  # must never show .local/ or .env.local
```
