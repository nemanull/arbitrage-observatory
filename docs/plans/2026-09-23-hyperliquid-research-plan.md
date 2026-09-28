# Hyperliquid research, plan

Hyperliquid is the first decentralised venue the engine would read.
This plan researches it in the shape of the venue survey, and adds the questions a decentralised venue raises.
It follows the design of record [`2026-09-22-venue-survey-design.md`](./2026-09-22-venue-survey-design.md) and its template changes in [`2026-09-22-venue-survey-plan.md`](./2026-09-22-venue-survey-plan.md).

**Status:** Done.

**Opened:** 2026-09-23.

## Scope guard

This work does not:

- Change any code under `server/` or `app/`, including the TypeScript server now under `server/ts/` and the Rust rewrite under `server/rust/`.
- Create a wallet, sign an action, call an exchange endpoint, or place an order.
- Run a Hyperliquid node, although it records what running one would take and give.
- Probe faster than Hyperliquid's published limits, or route around a refusal.

## Why a decentralised venue needs more than the template

- The order book, the oracle and the funding live on HyperCore, Hyperliquid's own chain, so every price has a block behind it.
- Anyone can read the chain by running a non-validator node, which could replace the public API as the data source.
- Builder-deployed perpetual dexes (HIP-3) list markets whose oracle the deployer sets, and whose names can collide with other venues' tickers.
- Several centralised venues in the survey route their perpetuals to Hyperliquid, so their books may be Hyperliquid's book seen again.

## Researchers and the files each owns

Four researchers, each owning disjoint files, all under `docs/profiles/hyperliquid/`, `docs/research/` and `scripts/probes/venues/hyperliquid/`.

| task | researcher | owns |
|---|---|---|
| 1 | Fees, access and CCXT | `docs/profiles/hyperliquid/fees.md`, `scripts/probes/venues/hyperliquid/fees-probe.mjs` |
| 2 | WebSocket market data | `docs/profiles/hyperliquid/websocket.md`, `scripts/probes/venues/hyperliquid/ws-probe.mjs` |
| 3 | REST info API and the anchor | `docs/profiles/hyperliquid/rest.md`, `scripts/probes/venues/hyperliquid/rest-probe.mjs` |
| 4 | The decentralised layer | `docs/research/2026-09-23-hyperliquid-dex.md`, `scripts/probes/venues/hyperliquid/dex-probe.mjs` |

Task 4's doc covers HyperCore blocks and timestamps, the non-validator node as a data source, HIP-3 dexes and their oracles, the survey venues that route to Hyperliquid, who may use it, and what trading would later need.

## Tracker

| task | subject | status |
|---|---|---|
| 1 | Fees, access and CCXT | Done |
| 2 | WebSocket market data | Done |
| 3 | REST info API and the anchor | Done |
| 4 | The decentralised layer | Done |
| 5 | Main session checks, survey row and index | Done |
