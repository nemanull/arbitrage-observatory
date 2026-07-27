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
