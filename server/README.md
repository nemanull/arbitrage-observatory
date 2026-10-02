# server

The engine, a Rust crate that runs headless.
It streams every venue's order books, judges each cross against the gates in the root [README.md](../README.md), and writes every closed episode to Postgres.

Installation, configuration and the commands for a run are in [SETUP.md](../SETUP.md).

```bash
cp .env.example .env
cargo run --release
```

## Layout

| Path | What it holds |
| --- | --- |
| [`src/main.rs`](./src/main.rs) | Boot: telemetry, the TLS provider, the Postgres pool, the writer task and the orchestrator. |
| [`src/orchestrator.rs`](./src/orchestrator.rs) | Loads each active venue's catalog, builds the cluster index, starts the engine thread, the feeds, the pollers and the sweeper, and stops them on a signal. |
| [`src/engine/`](./src/engine/) | The cluster index, the engine and its book and anchor writes, and under `opportunity/` the gates, the episode lifecycle, the ladder walk, the anchor reading and the writer. |
| [`src/feeds/`](./src/feeds/) | The shared runtimes every venue plugs into: one task per book socket in `venue_feed.rs`, the order book, and the REST anchor poller in `anchor_poller.rs`. |
| [`src/venues/`](./src/venues/) | One module per venue, each with its catalog loader, book feed, anchor parse and tests, plus the shared catalog and wire parsing. |
| [`migrations/`](./migrations/) | The schema, as SQL applied in file name order. |

## Threads

Every socket and every poller is a task on one tokio runtime, which runs a worker thread per logical CPU.
A socket task owns its connection, its frame parsing and the books of its markets, and it waits on nothing but its socket.

The engine is one OS thread named `engine`.
It reads one bounded channel of 4,096 updates, applies each book to its cluster's flat arrays, and runs the gates on every quote change.
When that channel is full a socket task keeps reading and applying frames, and sends each waiting market once with its newest book, so a slow engine sees fewer and fresher updates rather than a queue of old ones.

Closed episodes go to a writer task over a channel of 1,024, which inserts them in batches of 64 and retries a failed batch.

## Tests

```bash
cargo test                                   # 478 tests, plus 3 ignored ones
```

No test needs a database or the network, except the three ignored groups that `SETUP.md` lists, which reach the real venues.
[`src/pipeline_tests.rs`](./src/pipeline_tests.rs) drives the real engine thread from two fake venues on local sockets, and each venue's `tests.rs` replays frames captured from that venue.
