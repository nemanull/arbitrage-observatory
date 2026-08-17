# Docs Index

Every doc under [`docs/`](./) is listed here.
Rules for this tree live in [AGENTS.md](./AGENTS.md).
Project-wide rules live in the root [AGENTS.md](../AGENTS.md).

## Plans (active)

- [`plans/2026-08-14-comment-free-typescript-plan.md`](./plans/2026-08-14-comment-free-typescript-plan.md) defines the policy, cleanup, and verification steps for comment-free handwritten TypeScript.
- [`plans/2026-08-14-comment-free-typescript-design.md`](./plans/2026-08-14-comment-free-typescript-design.md) defines the policy and cleanup boundary for comment-free handwritten TypeScript.
- [`plans/2026-07-31-instrument-index-design.md`](./plans/2026-07-31-instrument-index-design.md) records the accepted quote storage design.
  Its 2026-08-01 amendment in section 0 fixes the runtime representation to the per-cluster form in `server/src/engine/types.ts`.
  Its 2026-08-04 change replaces decision 10, so refresh mutates the index in place instead of rebuilding and swapping it, and section 6 is superseded.
- [`plans/2026-08-03-websocket-feed-foundation-design.md`](./plans/2026-08-03-websocket-feed-foundation-design.md) defines the `VenueFeed` contract, its three venue-specific members, and how `submit` writes a normalized quote into the cluster index.
  Section 7 lists the connection lifecycle work that is deferred, with the field or research section that already specifies each item.

A market data ingest design and plan dated 2026-07-30 are referenced by the research docs below but were never committed.
The full connection lifecycle plan remains forthcoming.

## Research

- [`research/2026-07-26-exchange-fees-comparison.md`](./research/2026-07-26-exchange-fees-comparison.md) compares the verified fee models and total arbitrage costs.
- [`research/2026-07-26-exchange-websocket-comparison.md`](./research/2026-07-26-exchange-websocket-comparison.md) compares market data, subscriptions, recovery, and execution feeds.
- [`research/2026-07-30-ccxt-ws-ingest-feasibility.md`](./research/2026-07-30-ccxt-ws-ingest-feasibility.md) audits CCXT 4.5.68 internals against the cost of streaming every perpetual swap.
- [`research/2026-07-30-venue-ws-protocol-differences.md`](./research/2026-07-30-venue-ws-protocol-differences.md) enumerates the sixteen axes on which the five venue sockets differ, and which of them belong in a shared base class.

## Implemented

- [`implemented/2026-07-26-exchange-profiles-design.md`](./implemented/2026-07-26-exchange-profiles-design.md) records the reconciled design for the fee and WebSocket research package.
- [`implemented/2026-07-26-exchange-profiles-plan.md`](./implemented/2026-07-26-exchange-profiles-plan.md) records the completed research and verification tasks for the exchange profiles.
- [`implemented/2026-07-28-exchange-seed-design.md`](./implemented/2026-07-28-exchange-seed-design.md) records why exchange reference data ships inside a migration and which fee tier it carries.
- [`implemented/2026-07-28-exchange-seed-plan.md`](./implemented/2026-07-28-exchange-seed-plan.md) records every seeded connection setting and fee class with the profile line it came from.

## Reference

- [`ROADMAP.md`](./ROADMAP.md) tracks the planned project stages.
- [`profiles/binance/fees.md`](./profiles/binance/fees.md) records Binance fees by entity, product, account tier, and service.
- [`profiles/binance/websocket.md`](./profiles/binance/websocket.md) records Binance WebSocket endpoints, channels, schemas, and recovery rules.
- [`profiles/bybit/fees.md`](./profiles/bybit/fees.md) records Bybit fees by entity, product, account tier, and service.
- [`profiles/bybit/websocket.md`](./profiles/bybit/websocket.md) records Bybit WebSocket endpoints, channels, schemas, and recovery rules.
- [`profiles/okx/fees.md`](./profiles/okx/fees.md) records OKX fees by entity, product, account tier, and service.
- [`profiles/okx/websocket.md`](./profiles/okx/websocket.md) records OKX WebSocket endpoints, channels, schemas, and recovery rules.
- [`profiles/coinbase/fees.md`](./profiles/coinbase/fees.md) records Coinbase fees by product, entity, account type, and service.
- [`profiles/coinbase/websocket.md`](./profiles/coinbase/websocket.md) records Coinbase WebSocket endpoints, channels, schemas, and recovery rules.
- [`profiles/kraken/fees.md`](./profiles/kraken/fees.md) records Kraken fees by entity, product, account tier, and service.
- [`profiles/kraken/websocket.md`](./profiles/kraken/websocket.md) records Kraken WebSocket endpoints, channels, schemas, and recovery rules.
