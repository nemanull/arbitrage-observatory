# Roadmap

The staged build of version 0.1.
Everything below shipped.
Work found after this point is tracked as GitHub issues and in [`BACKLOG.md`](./BACKLOG.md), because a checklist stopped being the right shape for it.

## Phase 1

- [x] Create the repository, and set up the server, the docs, the agent rules and a raw frontend.
- [x] Research the major exchanges.
- [x] Add Prisma, BullMQ and Redis, and set up the rest of the infrastructure.

## Phase 2

- [x] Create the core project types.
- [x] Create the cluster builder.
- [x] Set up a simple engine and an opportunity manager.

## Phase 3

- [x] Define and implement opportunity monitoring and saving.
- [x] Implement the WebSocket feed and its integration for Binance.
- [x] Implement the WebSocket feed and its integration for Bybit and OKX.
- [x] Add SigNoz.
- [x] Add orchestration.

## Phase 4

- [x] Add Coinbase and Kraken.
- [x] Record why an episode closed, and stop closing on silence.

## Phase 5

- [x] Record both sides and the touch sizes of both legs at open, peak and close in the engine.
- [x] Stream a twenty level book for every market from each venue's WebSocket into the engine.

## Not started

- A frontend.
  [`app/`](../app/) is still the Vite starter and holds the slot.
  The engine is headless and the data is read through Prisma Studio, `psql` or SigNoz, so nothing is blocked on this.
