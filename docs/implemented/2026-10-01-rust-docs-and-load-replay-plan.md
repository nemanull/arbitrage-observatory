# Rust docs and load replay, plan

Implements [`2026-10-01-rust-docs-and-load-replay-design.md`](./2026-10-01-rust-docs-and-load-replay-design.md), which is the design of record.
Decision numbers below are that doc's.

## Scope guard

This work does not:

- change any production code in `server/`, only add the ignored test module and its `mod` line,
- add exchange timestamps, kernel stamps, a lag gate or exported queue metrics, which are items 1 to 4 of [`2026-09-17-rust-rewrite-requirements.md`](../backlog/2026-09-17-rust-rewrite-requirements.md),
- edit the text of any audit, research doc, bestiary entry, implemented doc or profile, only their dead links,
- stop the running test run, process 3606931,
- fix the 22 dead links that the Rust move did not cause, which are listed in task 12,
- commit or push, because the user commits.

## Status

| Task | Status |
|---|---|
| 1. Design and plan | Done |
| 2. Replay harness | Done |
| 3. Dry run | Done |
| 4. Replay stages | Done |
| 5. Sixty venue projection | Done |
| 6. Research doc | Done |
| 7. `README.md` | Done |
| 8. `SETUP.md` | Done |
| 9. `server/README.md` | Done |
| 10. Smaller current state docs | Done |
| 11. Config and CI | Done |
| 12. Permalinks | Done |
| 13. Verification | Done |
| 14. Reconcile | Done |

## Tasks

### 1. Design and plan

- This file and the design, under `docs/plans/`, indexed in [`docs/README.md`](../README.md).

### 2. Replay harness, decisions 2 to 11

- `server/src/venues/mod.rs`: add `#[cfg(test)] mod load_tests;` beside `live_tests`.
- `server/src/venues/load_tests.rs`, one ignored test, `load_replay`:
  - Environment: `LIVE_VENUES` (default the nine of decision 5), `REPLAY_RECORD_SECONDS`, `REPLAY_COPIES` (default 7), `REPLAY_SPEEDS` as a comma list.
  - Load each venue with `load_venue`, build the real index, and keep each venue's tracked markets as `tracked_venues` in [`orchestrator.rs`](../../server/src/orchestrator.rs) does.
  - Record through `spawn_feed` with a wrapper venue in record mode, for the record seconds, then cancel.
  - Build 63 copies whose markets carry the copy's venue id, and the copy index over them.
  - For each speed, a stage: replay servers on their own runtime, copies spawned through `spawn_feed` with the wrapper in replay mode, a fresh `Engine` on a thread named `engine`, a one second sweeper, a 10 ms queue depth sampler, and a row counter on the closed channel.
  - A tracing layer keeps only `engine_summary` lines, and the stage snapshots its counters and `/proc/self/task` when each one arrives.
  - One printed line per stage with every field of decision 9 and the verdict of decision 10.
- The test builds and runs with `cargo test --release load_replay -- --ignored --nocapture` from `server/`.

### 3. Dry run

- A short recording and one slow stage, to check every venue records, every copy reconnects after its loop, and the recording fits in memory.
- The laptop had about 6.8 GB available on 2026-10-01 with swap in use, so the recording length is chosen from the dry run's bytes a second.
- Shipped: 20 s of nine venues was 138 MB, two copies kept up at 45,146 frames a second, so the full runs recorded 60 s.

### 4. Replay stages

- Speeds from below the live rate up to the first stage that fails decision 10, written to a log under the session scratchpad.
- The replay is repeated once at the speed nearest 300,000 frames a second, so the claim does not rest on one run.
- Shipped: six runs between 06:02 and 06:59 UTC on 2026-10-02, tabled in section 5 of the research doc.
  Twelve stages from 132,435 to 300,542 frames a second kept up, and the engine queue first filled at 385,225.
  Binance reset most recording sockets in runs 3 to 5, and run 4 was stopped after its recording for that reason.

### 5. Sixty venue projection, decision 13

- The 60 venues are the ten with adapters and the 50 survey rows whose verdict fits, as listed in the answer section of [`2026-09-22-venue-survey.md`](../research/2026-09-22-venue-survey.md).
- For each, the perpetual count and the throughput row of its `websocket.md`, read by hand, with a per market rate, a projected frames a second and bytes a second.
- A venue with no load probe gets a stated guess and is counted separately.

### 6. Research doc

- `docs/research/2026-10-01-rust-load-replay.md`: the live run, the replay method and its omissions, the stage table, the projection table, and what the numbers do and do not say.
- Indexed in [`docs/README.md`](../README.md).

### 7. `README.md`, decisions 1, 14 and 17

- Rewrite the intro, Method links, Architecture, Scope, Repository and Status for Rust.
- Add the measured capacity, the projected load and the live load, each labelled.
- Results and Limitations keep their findings, and say the audited runs were the TypeScript server's.

### 8. `SETUP.md`

- Requirements: Rust stable, Docker, and pnpm only for the app and the infra scripts.
- Database: apply `server/migrations/*.sql` in order, checked against a scratch database in task 13.
- Running: `cargo run --release` from `server/`, stopped with one SIGINT for a clean flush.
- Checks: `cargo test`, the live tests and the load replay.
- Configuration: the variables the Rust code reads.
- Adding a venue: the module layout and the two match arms of [`venues/mod.rs`](../../server/src/venues/mod.rs), plus `ACTIVE_VENUES`.

### 9. `server/README.md`

- The crate layout, the thread layout, the commands and the tests.

### 10. Smaller current state docs, decision 17

- [`AGENTS.md`](../../AGENTS.md) section 3, [`app/README.md`](../../app/README.md), [`infra/signoz/README.md`](../../infra/signoz/README.md), [`ROADMAP.md`](../ROADMAP.md), the requirements backlog entry's status, and its row in [`BACKLOG.md`](../BACKLOG.md).

### 11. Config and CI, decision 16

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): a `server` job with `cargo test --locked` and an `app` job with pnpm lint and build.
- [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml): drop `server` and the build rules only the Nest server needed.
- [`package.json`](../../package.json): drop the server and Prisma scripts.
- `pnpm-lock.yaml`: regenerate with `pnpm install`.
- [`docker-compose.yaml`](../../docker-compose.yaml): drop the Redis service and its volume.
- [`server/.env.example`](../../server/.env.example): only `DATABASE_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `RUST_LOG` and `OTEL_LOG_LEVEL`.

### 12. Permalinks, decision 15

- A script under the session scratchpad rewrites every dead link whose target existed in git.
- Left as found, because the Rust move did not cause them: the example links in [`docs/AGENTS.md`](../AGENTS.md), the missing `rest.md` of the mgbx and ibit-global profiles, and a `node_modules` path in the close reasons design.
- Shipped: 932 links in 346 files, pinned to 15 commits, 14 of them already on `origin/main` and `c642b40` with 11 links waiting for the next push.
- A line number in a link's text, such as `Engine.ts:116`, was written against the working tree of its day, which no commit captures exactly, because docs and code were committed together in batches.
  So a permalink opens the right file as of its doc's last commit, and the cited line can sit a few lines off.
  Pinning by `git blame` of each line was tried on three citations and matched no better.

### 13. Verification

- `cargo test` in `server/` passes, and its count goes into `SETUP.md` and `server/README.md`.
- The app's `pnpm lint` and `pnpm build` pass after the workspace change.
- The migrations apply cleanly to a scratch database on the local Postgres, which is then dropped.
- The link check finds no dead link except the ones task 12 leaves.

### 14. Reconcile

- Audit the design and this plan against what shipped, edit every claim that changed, and set every status.
- Re-resolve every `file:line` citation in both docs.
- Move both docs to [`implemented/`](../implemented/) and update [`docs/README.md`](../README.md).
