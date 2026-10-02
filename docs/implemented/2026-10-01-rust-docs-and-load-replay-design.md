# Rust docs and load replay, design

Status: Implemented 2026-10-02, reconciled against what shipped.
The approach was chosen by the user in three questions on 2026-10-01.
The implementation plan is [`2026-10-01-rust-docs-and-load-replay-plan.md`](./2026-10-01-rust-docs-and-load-replay-plan.md), and the measurements are in [`2026-10-01-rust-load-replay.md`](../research/2026-10-01-rust-load-replay.md).

## Context

The server has been Rust since commit `132aa99`, and commit `3e59494` deleted the TypeScript server that had moved to `old_ts_server/`.
The current state documents still describe the Nest server: [`README.md`](../../README.md), [`SETUP.md`](../../SETUP.md), [`server/README.md`](../../server/README.md), section 3 of [`AGENTS.md`](../../AGENTS.md), [`app/README.md`](../../app/README.md), [`infra/signoz/README.md`](../../infra/signoz/README.md) and [`ROADMAP.md`](../ROADMAP.md).
The config does too.
CI runs `pnpm --filter server`, which matches no project since `server/` holds a Cargo crate, so CI tests neither server.
Redis still starts from [`docker-compose.yaml`](../../docker-compose.yaml), and nothing reads it.
The root [`package.json`](../../package.json) still calls Prisma, and [`server/.env.example`](../../server/.env.example) still lists `NODE_ENV`, `PORT` and `REDIS_URL`.

957 markdown links in 351 files point at files that no longer exist.
892 of them name the TypeScript server under `server/`, 43 name `old_ts_server/`, and 22 have other causes.

The user wants the README to state that the server handles up to 300,000 messages a second with 60 venues.
No document in the repository measures Rust throughput.
Item 6 of [`2026-09-17-rust-rewrite-requirements.md`](../backlog/2026-09-17-rust-rewrite-requirements.md) asks for a byte path probe and a saturation replay, and neither was run.
The 60 venue load projection of 2026-09-29, about 65,400 frames a second with a crash burst of 2.5 to 4.7 times that, exists only in a chat, and its script is gone.

### What the running Rust process shows

The first Rust test run started at 19:57:57 UTC on 2026-10-01 as process 3606931 and streams 2,094 markets on the five active venues.
Coinbase contributes nothing, because Coinbase International has shown every perpetual as paused since 09:00:29 UTC that day.
Its log, `logs/2026-10-01-rust-test-run.log`, held 560 `engine_summary` lines by 05:20:41 UTC on 2026-10-02.

| Measure | Value |
|---|---:|
| Books applied by the engine | 487,866,084 |
| Books a second, one minute windows, mean | 14,450 |
| Median and 99th percentile minute | 14,052 and 24,307 |
| Busiest minute | 36,710 |
| `max_queue_lag_ms`, median and 99th percentile minute | 5 and 45 |
| `max_queue_lag_ms`, worst minute | 363 |
| Most books waiting in the engine queue at a summary | 5 |

`/proc/3606931` read at about 05:47 UTC gave 15,968.7 s of process CPU over 34,010 s of wall time, which is 0.47 of a core.
The engine thread used 1,734.5 s of that, 5.1 percent of one core.
The socket workers spent 24 percent of their CPU in the kernel.
Resident memory was 58 MB.

That is about 33 µs of process CPU per book, against the 2 to 5 µs the requirements entry expected.
The figure cannot be scaled to a ceiling, because at 14,000 books a second nearly every frame pays for its own wakeups: an epoll return, a task poll and a futex wake of the engine thread.
Under load those costs are shared by many frames.
Only a replay at high rates can say where the ceiling is.

## Decisions

1. A capability claim in the README is a measured number with its conditions: the host, the venues, the rate and the lag.
   A projection is labelled as a projection, and the live run is labelled as the current load.
2. The measurement is a saturation replay through the production code: each adapter's `BookVenue::handle`, `Connection`, the coalescing flush, the engine channel, `run_engine` on its own thread, `Engine::update_book` and `OpportunityManager::validate`.
   The transport is the one part that differs, loopback `ws://` in place of TLS to the venue.
3. The harness is `server/src/venues/load_tests.rs`, an ignored test, because only code under `venues` can build the private adapter types.
   No production code changes.
4. Recording runs the real feeds through `spawn_feed` against the real venues, so pings, subscribe pacing, staggers and resyncs behave as in a run.
   A wrapper around each adapter delegates every `BookVenue` call and copies each frame of a connection's first session with its offset from that session's first frame.
   The recording stays in memory and dies with the test process.
5. The venue set is the nine adapters with a working feed, all ten except coinbase.
   The streamed markets are exactly those the production index would stream, the tracked set of the real nine venue index.
6. Sixty venues are seven copies of the nine, 63 venues in all.
   The clusters are built over all 63, so one cluster holds up to 63 columns.
   Copy r starts r seconds after copy 0, so bursts stay correlated across venues as they are in a crash, while loop ends spread out.
7. Each copy gets one local WebSocket server per recorded connection.
   The server accepts, discards whatever the client sends, sends the recording at speed k against the recorded offsets, and closes.
   The client then reconnects as it would after a venue close, and the next loop starts with that session's snapshots again.
8. A run is a list of speeds, or with `REPLAY_RATES` a list of target frames a second that the harness turns into speeds against the recording's own rate.
   The second form was added during the runs, because one copy's recorded rate ranged from 17,685 to 26,217 frames a second between recordings.
   Each speed is a stage with a fresh pipeline: new servers, new feeds, a new engine thread.
   A stage runs until the engine has logged two `engine_summary` lines, and the second window, the minute after the ramp, is the one reported.
9. Each stage reports offered and delivered frames a second, megabytes a second, books a second, books per frame, the engine queue depth sampled every 10 ms, the engine's `max_queue_lag_ms`, how late the replay servers fell behind their schedule, CPU by thread group from `/proc/self/task`, and resident memory.
   Coalescing shows as books per frame dropping below the slowest stage's.
10. A stage kept up when all four hold.
    Delivered frames are at least 99 percent of offered frames.
    No replay server fell more than 100 ms behind its schedule, so TCP never held frames back for long.
    The engine queue never filled, and books per frame is within 2 percent of the slowest stage, so nothing coalesced.
    The engine's `max_queue_lag_ms` stayed under 100 ms, the lag threshold of item 4 of the requirements entry.
11. The replay servers run in the same process on their own runtime, and every thread group is named, so the CPU of the server under test is read by thread name.
    The server under test keeps tokio's default worker count, as `main` does.
    The first run went at nice 19 to keep the live test run first in line, and later runs at nice 0 once the stages near 300,000 left most cores idle.
    A run started with `&` from zsh lands at nice 5, because zsh lowers background jobs, and the research doc records each run's priority.
12. The research doc states what the replay leaves out: TLS decryption, the network, the anchor polls, and the database writer.
    Without anchors, a cross wide enough to need them is refused as `anchor_missing`, which costs the engine about the same as a full refusal.
    Rows go to a counting channel instead of Postgres.
13. The 60 venue projection is rebuilt in the research doc by the method of 2026-09-29.
    A venue's perpetual count, from its survey row or adapter verification, is multiplied by the per market frame rate of the load probe in its `docs/profiles/<venue>/websocket.md` throughput row.
    The ten adapters take their per market rate from the first replay recording instead of the September probes, because that recording is the same code measuring the same channels.
    The crash multiplier of 2.5 to 4.7 is carried as inferred, because no 60 venue crash was ever measured.
14. The README states 300,000 messages a second as measured only if a stage at or above that rate kept up by decision 10.
    Otherwise it states the measured ceiling, and the gap to 300,000.
    Run 6 kept up at 300,542 frames a second by every criterion, so the README states it as measured, with the engine queue first full at 385,225.
15. Dead links become GitHub permalinks into `https://github.com/nemanull/arbitrage-observatory`, at a commit where the target exists.
    That is the linking doc's own last commit when the target exists there, and otherwise the last commit in which the target existed.
    A directory gets `tree`, a file gets `blob`, and a fragment is kept.
    A target that never existed in git is left as it is and listed in the plan.
    The repository is private, so these links open for collaborators only, as the README's issue links already do.
    A line number in a link's text was written against the working tree of its day, which no commit captures exactly, so the cited line can sit a few lines off at the pinned commit.
16. CI gets a Rust job that runs `cargo test --locked` in `server/` on stable, and the app keeps its lint and build.
    The pnpm workspace drops `server`, the root scripts drop the server and Prisma scripts, and the lockfile is regenerated.
    Compose drops Redis, `scripts/redis-flush.sh` goes with it, `server/.env.example` lists only what the Rust code reads, and section 3 of `AGENTS.md` names `tracing` in place of Nest's logger.
    The first `pnpm install` after the change wrote `allowBuilds` placeholders for the two Prisma packages into the workspace file, and they were removed, since the regenerated lockfile holds no Prisma.
17. Documents that describe the current state are rewritten for Rust.
    Historical documents, the audits, research, bestiary, implemented docs and profiles, keep their text, and only their dead links change.

## Rejected alternatives

- An in-process replay that calls `handle` without sockets.
  It is simpler, and it leaves out the socket read path, where the live process spends most of its CPU.
- Looping a recording on one open connection.
  Every sequence checked venue would see a gap at the wrap and resync.
- A recording file replayed across several test runs.
  It needs a file format and stored catalogs, and one process that records and then replays is enough.
- Copies started at random offsets.
  That removes the crash-like correlation, and it creates crosses between copies of different venues taken at different moments.
- Pointing the dead links at the Rust files.
  The historical docs describe TypeScript behaviour at TypeScript line numbers.
- Wording 300,000 as a design target only.
  The user chose to measure.

## Wording rules for the README

- "Measured" is used only for a number recorded in the research doc, with the host named.
- The replay and the live run are never merged into one figure.
- A projection says it is a projection and names its source.
- Nothing claims the 60 venue system runs live, because ten adapters exist and five run.
