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

Postgres and Redis run in Docker.
Start them before the server.

```bash
pnpm infra:up         # start both, waits until healthy
pnpm infra:down       # stop
pnpm infra:logs       # follow logs
pnpm infra:reset      # stop and delete all stored data
```

Postgres is on `localhost:5532` and Redis is on `localhost:6479`, both bound to loopback.
The ports are non-default so they do not clash with other projects on the same machine.
Set `POSTGRES_PORT` or `REDIS_PORT` in the environment to change them.

## Database

There is one database, so these work from the repo root and from `server/`.

```bash
pnpm prisma:generate      # regenerate the Prisma client
pnpm prisma:push          # apply schema.prisma directly, no migration files
pnpm prisma:migrateDev    # create and apply a migration
pnpm prisma:migrateDeploy # apply existing migrations
pnpm prisma:studio        # browse the data
```

The client is generated into `server/src/generated/` and is not committed.
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
