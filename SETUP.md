# Setup

This file covers installation, configuration and the commands for running a session.
The project overview is in [README.md](./README.md).

## Requirements

| Component | Version | Notes |
| --- | --- | --- |
| Rust | stable, 1.88 or newer | The server crate uses edition 2024 and its `let` chains, and it was built with 1.98. |
| Docker | any current release | Postgres and the optional SigNoz stack run in containers. |
| Node and pnpm | Node 24, pnpm 11 | Only for the placeholder frontend, the infrastructure scripts and the probe scripts. pnpm is declared as `packageManager`, so Corepack selects it. |

No exchange account and no API key are needed.
Every feed the server reads is public.

## Install

```bash
cp server/.env.example server/.env
pnpm install          # the frontend and the root scripts only
```

## Infrastructure

```bash
pnpm infra:up         # Postgres and SigNoz, waits until healthy
pnpm infra:down       # stop
pnpm infra:logs       # follow logs
pnpm infra:reset      # stop and delete all stored data
```

Postgres listens on `localhost:5532`, bound to loopback.
The port is shifted off its default so it does not collide with other projects on the same host.
Override it with `POSTGRES_PORT`.

SigNoz is the heaviest container in the set and is optional.
To run without it:

```bash
docker compose up -d --wait postgres
```

## Database

The schema is the SQL under [`server/migrations/`](./server/migrations/), applied in file name order.
The server does not migrate on boot.

```bash
for f in server/migrations/*.sql; do
  psql postgresql://observatory:observatory@localhost:5532/observatory -v ON_ERROR_STOP=1 -f "$f"
done
```

The file names follow the `<version>_<name>.sql` layout that `sqlx migrate run --source server/migrations` also reads, for anyone who has `sqlx-cli` installed.

## Running

```bash
cd server
cargo run --release
```

The server reads `server/.env` from the directory it starts in, and starts its feeds on boot.
The first lines of the log give each venue's catalog, the cluster count and the markets each venue streams, followed by one line per socket as it opens.
Every later stage transition is logged with the market it processed, because almost all of the work happens in background tasks and a terminal is not a reliable record of it.

One `SIGINT` or `SIGTERM` stops the run cleanly.
The feeds stop first, every open episode closes with the reason `shutdown`, and the writer drains its queue to Postgres before the process exits.
A second signal exits at once, for a stop that hangs on a database that does not answer.

The server has no HTTP surface.
A run is started by starting the process and ended by signalling it.

## Reading the data

There is no user interface.
Stored episodes are read directly.

```bash
psql postgresql://observatory:observatory@localhost:5532/observatory
```

Logs are exported over OTLP to a local SigNoz at http://localhost:8180, which accepts any email and password because the container registers nothing outbound.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` to an empty value in `server/.env` to keep the logs on the console only.
Setup and upgrade notes are in [infra/signoz/README.md](./infra/signoz/README.md).

## Checks

From `server/`:

```bash
cargo test                                   # 478 tests, no database and no internet access
cargo build --release
```

Three groups of tests are ignored by default, because they reach the real venues.

```bash
LIVE_VENUES=binance,okx cargo test live_catalog -- --ignored --nocapture
LIVE_VENUES=binance LIVE_SECONDS=120 cargo test --release live_smoke -- --ignored --nocapture
cargo test --release load_replay -- --ignored --nocapture
```

`live_catalog` prints each venue's markets for a parity check against another catalog, and `live_smoke` streams every market of each venue and fails on a market with no book, a crossed top, a closed socket or a frame that does not parse.
`load_replay` records the live venues and replays the recording as copies of them through the feeds and the engine, and its method and results are in [`2026-10-01-rust-load-replay.md`](./docs/research/2026-10-01-rust-load-replay.md).

The frontend has its own checks, run from the repository root:

```bash
pnpm lint
pnpm build
```

## Configuration

`server/.env` is the only file that needs editing, and the example covers every variable the server reads.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `RUST_LOG` | Console log filter, for example `info` or `info,server::engine=debug`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint, empty to disable exporting. |
| `OTEL_SERVICE_NAME` | Service name attached to exported logs. |
| `OTEL_LOG_LEVEL` | What reaches SigNoz, independent of the console. |

## Adding a venue

Ten venue adapters exist and five are active.
The active set is `ACTIVE_VENUES` in [`orchestrator.rs`](./server/src/orchestrator.rs), so activating one of the other five is one line there once its checks pass.

A new venue is one module under `server/src/venues/`: `<id>.rs` holds the book feed and the anchor poll, `<id>/markets.rs` reads the venue's catalog, `<id>/anchor.rs` parses its reference prices, and `<id>/tests.rs` replays its captured frames.
It also needs one arm in `load_venue` and one in `start_venue` in [`venues/mod.rs`](./server/src/venues/mod.rs).
The shared behaviour lives in [`venue_feed.rs`](./server/src/feeds/venue_feed.rs) and [`anchor_poller.rs`](./server/src/feeds/anchor_poller.rs), so an adapter supplies only what differs: the plan, the subscribe frames, the ping, and how one frame changes its books.
Capture the venue's real frames with a probe under `scripts/probes/` before writing the adapter, and record what they contain under `docs/profiles/`.
The catalog parity and live smoke steps the last ten adapters went through are tasks 12, 13 and 20 of [`2026-10-01-rust-venue-adapters-plan.md`](./docs/implemented/2026-10-01-rust-venue-adapters-plan.md).
