# Setup

This file covers installation, configuration and the commands for running a session.
The project overview is in [README.md](./README.md).

## Requirements

| Component | Version | Notes |
| --- | --- | --- |
| Node | 24 or newer | The compiled server is CommonJS and loads CCXT, whose dependency chain reaches an ESM-only module, so it relies on `require(esm)`. |
| pnpm | 11 | Declared as `packageManager`, so Corepack selects it automatically. |
| Docker | any current release | Postgres, Redis and SigNoz run in containers. |

No exchange account and no API key are needed.
Every feed the engine reads is public.

## Install

```bash
pnpm install
cp server/.env.example server/.env
cp app/.env.example app/.env
```

`pnpm install` generates the Prisma client as a postinstall step, so a fresh clone builds with no further commands.

## Infrastructure

```bash
pnpm infra:up         # Postgres, Redis and SigNoz, waits until healthy
pnpm infra:down       # stop
pnpm infra:logs       # follow logs
pnpm infra:reset      # stop and delete all stored data
```

Postgres listens on `localhost:5532` and Redis on `localhost:6390`, both bound to loopback.
The ports are shifted off their defaults so they do not collide with other projects on the same host.
Override them with `POSTGRES_PORT` and `REDIS_PORT`.

SigNoz is the heaviest container in the set and is optional.
To run without it:

```bash
docker compose up -d --wait postgres redis
```

## Database

There is one database, so these work from the repository root and from `server/`.

```bash
pnpm prisma:generate      # regenerate the Prisma client
pnpm prisma:push          # apply schema.prisma directly, no migration files
pnpm prisma:migrateDev    # create and apply a migration
pnpm prisma:migrateDeploy # apply existing migrations
pnpm prisma:studio        # browse the data
```

The client is generated into `server/src/db/generated/prisma/` and is committed alongside the server source.

## Running

```bash
pnpm dev:server       # the engine, http://localhost:3000
pnpm dev:app          # the placeholder frontend, http://localhost:5173
pnpm dev              # both, in parallel
```

The engine starts its feeds on boot.
The first lines of the log give the cluster count, the active venues and the denied pairs, followed by one line per feed as it subscribes.
Every subsequent stage transition is logged with the market it processed, because almost all of the work happens in background jobs and a terminal is not a reliable record of it.

Three HTTP routes report and control the run.

| Route | Effect |
| --- | --- |
| `GET /status` | The current run: whether it is live, when it started, the cluster count and the market count per venue. |
| `GET /start` | Start the feeds if they are stopped. |
| `GET /stop` | Stop the feeds and flush any open episode. |

## Reading the data

There is no user interface.
Stored episodes are read directly.

```bash
pnpm prisma:studio                                    # browse the tables
psql postgresql://observatory:observatory@localhost:5532/observatory
```

Logs, traces and metrics are exported over OTLP to a local SigNoz at http://localhost:8180, which accepts any email and password because the container registers nothing outbound.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` to an empty value in `server/.env` to run without exporting.
Setup and upgrade notes are in [infra/signoz/README.md](./infra/signoz/README.md).

## Checks

```bash
pnpm build            # both packages
pnpm test             # 30 suites, 389 tests, no database required
pnpm lint             # read-only
pnpm lint:fix         # the rewriting form
pnpm --filter server run typecheck
```

The test suite touches no external service.
It runs with `--forceExit` for a reason, explained in [server/README.md](./server/README.md).

Anything can also be run per package with `pnpm --filter server <script>`.

## Configuration

`server/.env` is the only file that needs editing, and the example covers every variable the server reads.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `REDIS_URL` | Redis connection string for the BullMQ write queue. |
| `PORT` | HTTP port, default 3000. |
| `NODE_ENV` | Standard Node environment flag. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint, empty to disable exporting. |
| `OTEL_SERVICE_NAME` | Service name attached to exported telemetry. |

## Adding a venue

Ten venue adapters exist and five are active.
Activating one of the remaining five is a checklist rather than new code, and it is written out in [docs/implemented/2026-09-15-five-venue-adapters-plan.md](./docs/implemented/2026-09-15-five-venue-adapters-plan.md).

A new venue needs a directory under `server/src/venues/` holding a book feed, an anchor poller and its types, plus an entry in `server/src/venues/registry.ts`.
The shared behaviour lives in [`VenueFeed.ts`](./server/src/feeds/book/VenueFeed.ts) and [`AnchorPoller.ts`](./server/src/feeds/anchor/AnchorPoller.ts), so an adapter supplies only what differs.
Capture the venue's real frames with a probe under `scripts/probes/` before writing the adapter, and record what they contain under `docs/profiles/`.
