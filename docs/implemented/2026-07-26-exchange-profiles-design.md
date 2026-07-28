# Exchange Profiles Research Design

**Status:** Done.

**Archived:** 2026-07-26.

## Purpose

This design defines the first research package for Binance, Bybit, OKX, Coinbase, and Kraken.
The package explains every publicly documented exchange fee and the WebSocket interfaces needed by an arbitrage observatory.
The package is documentation only.
It does not add exchange integrations or runtime code.

## Goals

1. Record every publicly documented fee schedule, tier, account program, and market family for each exchange.
2. Explain how to calculate the full cost of opening, holding, and closing a derivatives position.
3. Record non-trading fees such as deposits, withdrawals, custody, staking, card, and service charges.
4. Explain every relevant public and private WebSocket channel.
5. Show exact single-symbol and multi-symbol subscription shapes.
6. Identify the minimum feeds needed for opportunity detection and the additional feeds needed for safe execution.
7. Make every time-sensitive claim traceable to an official source and retrieval date.

## Scope

The fee research covers publicly documented global and regional products.
It covers spot, margin, convert, futures, perpetuals, options, delivery contracts, custody, staking, cards, deposits, withdrawals, and other fee-bearing services offered by an exchange.
It covers published retail, professional, institutional, market-maker, and VIP tiers.
It records eligibility rules and discounts when the exchange publishes them.

Some fees depend on an account, asset, network, jurisdiction, negotiated agreement, or live network conditions.
The profiles identify those values as dynamic or account-gated.
They document the official lookup page, authenticated endpoint, public endpoint, or calculation rule when available.
They do not invent a static value for a fee that the exchange calculates at request time.

The WebSocket research covers market data and account data that can affect arbitrage detection or execution.
It covers best bid and ask, ticker, trades, depth, candles, mark price, index price, funding, open interest, liquidations, instruments, balances, orders, fills, and positions where offered.

## Documentation layout

Each exchange owns a readable profile directory.
The fee profile is the detailed source of record for that exchange.
The WebSocket profile is the detailed source of record for that exchange.

The delivered exchange files are:

- `docs/profiles/binance/fees.md`
- `docs/profiles/binance/websocket.md`
- `docs/profiles/bybit/fees.md`
- `docs/profiles/bybit/websocket.md`
- `docs/profiles/okx/fees.md`
- `docs/profiles/okx/websocket.md`
- `docs/profiles/coinbase/fees.md`
- `docs/profiles/coinbase/websocket.md`
- `docs/profiles/kraken/fees.md`
- `docs/profiles/kraken/websocket.md`

Two permanent research documents provide cross-exchange comparisons.
They do not duplicate every profile table.
They link to the profiles and summarize the differences that affect architecture.

The delivered comparison files are:

- `docs/research/2026-07-26-exchange-fees-comparison.md`
- `docs/research/2026-07-26-exchange-websocket-comparison.md`

Every created document receives one line in [`README.md`](../README.md).
This follows the lifecycle and indexing requirements in [`AGENTS.md`](../AGENTS.md), especially lines 7 to 34.

## Fee profile structure

Every fee profile uses the same sections when the exchange has relevant data.

1. A scope and freshness block records the retrieval date, exchange entities, regions, and source limitations.
2. A quick answer explains how to calculate maker and taker costs for an opening buy or sell.
3. A product coverage matrix shows which markets and services are covered.
4. Trading tables reproduce all published tiers with their qualification rules.
5. Derivatives sections cover trading, funding, delivery, settlement, liquidation, and exercise costs.
6. Financing sections cover margin interest, loans, and borrowing rules.
7. Asset movement sections cover deposits, withdrawals, internal transfers, and network-dependent charges.
8. Service sections cover convert, custody, staking, cards, and other published charges.
9. Discount sections cover token discounts, referral effects, rebates, and special programs.
10. Worked examples show opening, holding, closing, and round-trip calculations.
11. Dynamic and account-gated sections explain how to retrieve values that cannot be represented truthfully as static tables.
12. A source ledger maps every section to official documentation.

The common derivatives formula is:

```text
trading fee = trade notional × applicable maker or taker rate
round-trip trading fee = opening fee + closing fee
total position cost = round-trip trading fee + funding or financing + settlement or delivery + liquidation costs when applicable
```

The profiles state the contract-specific notional formula before applying a fee rate.
They distinguish fee rates from rebates.
They distinguish maker or taker classification from buy or sell direction.

## WebSocket profile structure

Every WebSocket profile uses the same structure.

1. A connection matrix lists public, private, market-specific, regional, and sandbox endpoints.
2. An endpoint guide explains which endpoint serves each market family.
3. A channel matrix explains the purpose and payload class of every relevant channel.
4. Subscription examples show one symbol and multiple symbols.
5. Representative payloads are annotated field by field.
6. Order book sections explain snapshots, deltas, sequence identifiers, checksums, and resynchronization.
7. Session sections explain authentication, heartbeats, reconnects, limits, and subscription acknowledgements.
8. Symbol and timestamp sections explain identifiers, units, and clock semantics.
9. Private feed sections cover orders, fills, balances, positions, and authentication where documented.
10. An arbitrage recommendation separates minimum detection feeds from validation and execution feeds.
11. A source ledger maps every protocol claim to official API documentation.

The recommendation does not treat a top-of-book feed as sufficient for executable profit.
Best bid and ask can detect a candidate spread.
Depth is needed to estimate size and slippage.
Instrument, fee, funding, and account data are needed to validate the opportunity.
Private order and fill data are needed to manage live execution.

## Source policy

Official exchange documentation is the primary source.
Official fee pages, API references, support articles, legal schedules, and product disclosures are acceptable.
Official API schemas are preferred over third-party examples for WebSocket behavior.
Search results and third-party summaries may help locate a source, but they are not evidence for a profile claim.

Each source ledger records the source title, direct URL, retrieval date, applicable entity or region, and the sections it supports.
Conflicting official sources are both recorded.
The profile explains which source appears current and why.
An unresolved conflict is marked explicitly.

## Research data flow

1. The researcher discovers the official source inventory for one exchange.
2. The researcher records raw facts and limitations in that exchange profile.
3. A second pass checks every table and protocol claim against the cited source.
4. The comparison documents extract only normalized fields from the verified profiles.
5. The final audit checks links, coverage, arithmetic, and prose rules.

## Failure and uncertainty handling

A missing public number is not treated as zero.
It is marked as not publicly specified, account-gated, negotiated, unavailable in the documented region, or dynamically calculated.
A discontinued product remains out of the current tables unless it is needed to explain a conflicting official page.
A region-specific product is labeled with its legal entity or eligibility boundary.
A value with uncertain freshness is labeled with the retrieval date and the conflicting evidence.

## Verification

The documentation review checks that every requested exchange has both profile files.
It checks that every known market and service family appears in the coverage matrix.
It checks every numeric row against an official source.
It recalculates worked examples independently.
It validates JSON examples.
It checks that multi-symbol subscriptions match each exchange protocol.
It checks that order book recovery instructions include sequencing and snapshot behavior.
It checks all internal links and the [`README.md`](../README.md) index.
It checks the sentence-per-line and prose requirements from [`AGENTS.md`](../AGENTS.md).

## Decisions

1. The research covers literal all-fee scope rather than trading fees alone.
2. The research covers every publicly documented account tier and market family found in the official source inventory.
3. Dynamic fees are represented by official retrieval mechanisms and rules rather than stale copied values.
4. Detailed facts live in per-exchange profiles.
5. Cross-exchange documents remain concise and link to detailed profiles.
6. Fee and WebSocket subjects use separate files because they have different data models and update cycles.
7. Official first-party sources support all substantive claims.
8. The WebSocket recommendation distinguishes detection, validation, and execution requirements.
9. The work remains documentation only.

## Rejected alternatives

### One large exchange research document

This would make direct comparison easy at first.
It was rejected because complete fee tiers and WebSocket schemas for five exchanges would become difficult to read and maintain.

### Per-exchange documents without comparisons

This would minimize duplication.
It was rejected because an arbitrage system needs a normalized view of differences across venues.

### Static snapshots for every asset and network fee

This would look exhaustive on the retrieval date.
It was rejected because many withdrawal and network fees change frequently and may differ by account.

### Arbitrage-only fee coverage

This would produce much shorter profiles.
It was rejected because the approved scope includes every published exchange fee and account program.

## Reconciliation

The delivered package matches the approved hybrid structure.
It contains ten detailed exchange profiles and two concise comparison documents.
The detailed profiles remain the source of record.
The comparison documents remain the primary reading path for cross-exchange decisions.

Dynamic, negotiated, regional, and account-gated values use explicit evidence labels and official lookup boundaries.
No unavailable value was converted into a guessed static rate.
The profiles preserve conflicts between official pages when the exchange has not resolved them.

Several reference profiles exceed the 400-line readability warning because complete tier tables, payload schemas, recovery rules, and source ledgers are required for verification.
The compact comparison documents prevent that detail from becoming the only reading path.

Independent exchange audits and a holistic package review were completed.
The reviews added regional fee results, market-data charges, source mappings, checksum corrections, protocol-limit conflicts, and missing derivatives details.
All JSON examples and Markdown tables passed the repository validators.

No runtime exchange client, account login, authenticated request, or trading behavior was added.
Live account rates and live protocol exercises remain production validation tasks outside this documentation-only scope.
