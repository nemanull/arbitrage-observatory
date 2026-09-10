# Docs Index

Every doc under [`docs/`](./) is listed here.
Rules for this tree live in [AGENTS.md](./AGENTS.md).
Project-wide rules live in the root [AGENTS.md](../AGENTS.md).

## Plans (active)

- [`plans/2026-07-26-exchange-profiles-plan.md`](./plans/2026-07-26-exchange-profiles-plan.md) specifies the research tasks used to produce the exchange profiles and comparisons.

## Research

- [`research/2026-07-26-exchange-fees-comparison.md`](./research/2026-07-26-exchange-fees-comparison.md) compares the verified fee models and total arbitrage costs.
- [`research/2026-07-26-exchange-websocket-comparison.md`](./research/2026-07-26-exchange-websocket-comparison.md) compares market data, subscriptions, recovery, and execution feeds.
- [`research/2026-07-30-ccxt-ws-ingest-feasibility.md`](./research/2026-07-30-ccxt-ws-ingest-feasibility.md) audits CCXT 4.5.68 internals against the cost of streaming every perpetual swap.
- [`research/2026-07-30-venue-ws-protocol-differences.md`](./research/2026-07-30-venue-ws-protocol-differences.md) maps the sixteen axes on which the five venue sockets differ.
- [`research/2026-09-06-venue-depth-endpoints-probe.md`](./research/2026-09-06-venue-depth-endpoints-probe.md) measures each venue's REST book endpoint and depth channel and records the shapes, the latency, kraken's ascending bids and coinbase's one second edge cache.
- [`research/2026-09-07-depth-stream-scaling.md`](./research/2026-09-07-depth-stream-scaling.md) measures the whole pipeline for streamed depth on five venues, sizes the fifty venue universe at about 15,000 markets, and finds the single event loop is the one structural blocker, with pair sharding as the path.
- [`research/2026-09-07-depth-sequence-gaps.md`](./research/2026-09-07-depth-sequence-gaps.md) measures zero sequence gaps in 12.48 million deltas on the four delta depth venues, confirms the maintained book against the venues' own top of book and REST, and records how far each ticker channel lags the book.

## Audits

One file per audited run of the engine, oldest first.
The newest audit is the one that describes current behaviour.

- [`audits/2026-09-05-first-run-data-audit.md`](./audits/2026-09-05-first-run-data-audit.md) audits the first engine run and finds that 67% of its rows compare different assets or different contract units.
- [`audits/2026-09-06-second-run-data-audit.md`](./audits/2026-09-06-second-run-data-audit.md) audits the run with the cluster overrides in place and finds the remaining rows are dominated by non-converging and fragmented spreads.
- [`audits/2026-09-06-third-run-data-audit.md`](./audits/2026-09-06-third-run-data-audit.md) audits the first run with the quote family and finds that roundTripPpm measures a thin book's width, that duration alone cannot separate stale quotes from slow-venue orders, and that no row proves a capturable spread.
- [`audits/2026-09-08-fourth-run-data-audit.md`](./audits/2026-09-08-fourth-run-data-audit.md) audits the first run with the book feeds and the ladder walk, finds five standing basis and equity pairs behind 389 of 597 rows and a ten dollar coinbase bot behind every coinbase peak, and lists what to verify on the next run.

## Bestiary

- [`bestiary/thin-book.md`](./bestiary/thin-book.md) describes a market whose best price is real and holds eleven dollars, and the one maker whose cancel moves it 7%.
- [`bestiary/flicker.md`](./bestiary/flicker.md) describes a cross that lived under one millisecond, which is 438 of the third run's 745 rows.
- [`bestiary/stale-quote.md`](./bestiary/stale-quote.md) describes a price the engine held for 22 seconds after it stopped existing, because the coinbase channel only speaks when a trade happens.
- [`bestiary/slow-venue-resting-order.md`](./bestiary/slow-venue-resting-order.md) describes the one honest class of the third run, a real kraken order that did not move for 28 seconds, and why it still is not free money.
- [`bestiary/withdrawn-side.md`](./bestiary/withdrawn-side.md) describes a book that loses a whole side, and the feed that drops that message without telling the engine.
- [`bestiary/edge-at-the-touch.md`](./bestiary/edge-at-the-touch.md) describes the reading that treats the best level as infinitely deep, and the ladder walk that measures the region both books were paying for, with worked examples.
- [`bestiary/standing-basis.md`](./bestiary/standing-basis.md) describes a gap between two perps that the market holds open on purpose, because each perp is chained to its own venue's index and nothing chains the two perps to each other, which is 352 of the fourth run's 597 rows.
- [`bestiary/index-mark-and-premium.md`](./bestiary/index-mark-and-premium.md) is the vocabulary behind the basis entries: what a perp's index, mark, premium and funding are, how each is built and how fast it moves, with live recipes and a worked settlement.
- [`bestiary/settlement-dip.md`](./bestiary/settlement-dip.md) describes a perp moving against the side paying funding in the minutes around its settlement instant, why leaving before the bill is self defeating, and the IOST capture across the 19:00 instant that shows the shape on two venues and its absence under the fee.

## Implemented

- [`implemented/2026-07-26-exchange-profiles-design.md`](./implemented/2026-07-26-exchange-profiles-design.md) records the reconciled design for the fee and WebSocket research package.
- [`implemented/2026-08-19-schema-rework-design.md`](./implemented/2026-08-19-schema-rework-design.md) records the reconciled design for the Venue schema rework and the column sources of a stored arbitrage opportunity.
- [`implemented/2026-09-06-close-reasons-design.md`](./implemented/2026-09-06-close-reasons-design.md) records the reconciled design for the four close reasons, the feed-owned liveness, and the shutdown flush.
- [`implemented/2026-09-06-close-reasons-plan.md`](./implemented/2026-09-06-close-reasons-plan.md) records the reconciled plan that shipped the close reasons.
- [`implemented/2026-09-06-quote-family-design.md`](./implemented/2026-09-06-quote-family-design.md) records the decision that USD, USDC and USDT are one settlement asset for clustering, and the rank that picks one contract per venue.
- [`implemented/2026-09-06-book-sizes-and-far-sides-design.md`](./implemented/2026-09-06-book-sizes-and-far-sides-design.md) records the reconciled design that carries top-of-book sizes and each leg's far side into the in-memory opportunity.
- [`implemented/2026-09-06-book-sizes-and-far-sides-plan.md`](./implemented/2026-09-06-book-sizes-and-far-sides-plan.md) records the reconciled plan that shipped it across the connector, builder, engine, manager and feeds.
- [`implemented/2026-09-06-depth-block-design.md`](./implemented/2026-09-06-depth-block-design.md) records the reconciled design for the flat depth block in the cluster and the engine's write path into it.
- [`implemented/2026-09-06-depth-block-plan.md`](./implemented/2026-09-06-depth-block-plan.md) records the reconciled plan that shipped the depth block.

## Reference

- [`BACKLOG.md`](./BACKLOG.md) indexes identified work that has no roadmap stage yet, one row per file under [`backlog/`](./backlog/).
- [`ROADMAP.md`](./ROADMAP.md) tracks the planned project stages.
- [`WIKI.md`](./WIKI.md) defines the current market cluster and arbitrage opportunity terminology.
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
