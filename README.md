# arbitrage_observatory

pnpm workspace with two packages:

- `server/` — NestJS API, compiled with tsgo (http://localhost:3000)
- `app/` — React + TypeScript frontend, Vite (http://localhost:5173)

## Setup

```bash
pnpm install          # from the repo root, installs both packages
cp server/.env.example server/.env
cp app/.env.example app/.env
```

## Infrastructure

Postgres, Redis, and SigNoz run in Docker.
Start them before the server.

```bash
pnpm infra:up         # start everything, waits until healthy
pnpm infra:down       # stop
pnpm infra:logs       # follow logs
pnpm infra:reset      # stop and delete all stored data
```

Postgres is on `localhost:5532` and Redis is on `localhost:6390`, both bound to loopback.
The ports are non-default so they do not clash with other projects on the same machine.
Set `POSTGRES_PORT` or `REDIS_PORT` in the environment to change them.

## Observability

The server exports logs, traces, and metrics to a local SigNoz over OTLP, so a failure in a background job is still readable long after the terminal is gone.
The UI is on http://localhost:8180 and it accepts any email and password, since the container registers nothing.

Setup and upgrades are covered in [infra/signoz/README.md](./infra/signoz/README.md).
Set `OTEL_EXPORTER_OTLP_ENDPOINT` to an empty value in `server/.env` to run without exporting.

```bash
docker compose up -d --wait postgres redis   # skip SigNoz on a constrained machine
```

## Database

There is one database, so these work from the repo root and from `server/`.

```bash
pnpm prisma:generate      # regenerate the Prisma client
pnpm prisma:push          # apply schema.prisma directly, no migration files
pnpm prisma:migrateDev    # create and apply a migration
pnpm prisma:migrateDeploy # apply existing migrations
pnpm prisma:studio        # browse the data
```

The client is generated into `server/src/db/generated/prisma/` and is committed with the server source.
`pnpm install` regenerates it, so a fresh clone builds without extra steps.

## Run

```bash
pnpm dev              # both packages in watch mode, in parallel
pnpm dev:server       # server only
pnpm dev:app          # app only
```

## Other scripts

```bash
pnpm build            # build both
pnpm test             # test both (packages without a test script are skipped)
pnpm lint             # lint both
```

Anything can also be run per package with `pnpm --filter server <script>`.

## Docs

Design docs, plans, and research live in [docs/](./docs/), indexed by [docs/README.md](./docs/README.md).
Rules for working in this repo are in [AGENTS.md](./AGENTS.md).
