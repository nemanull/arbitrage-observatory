# Docs Index

Every doc under [`docs/`](./) is listed here.
Rules for this tree live in [AGENTS.md](./AGENTS.md).
Project-wide rules live in the root [AGENTS.md](../AGENTS.md).

## Plans (active)

- [`plans/2026-07-26-exchange-profiles-plan.md`](./plans/2026-07-26-exchange-profiles-plan.md) specifies the research tasks used to produce the exchange profiles and comparisons.
- [`plans/2026-09-15-binance-realtime-depth-design.md`](./plans/2026-09-15-binance-realtime-depth-design.md) records the design that builds the Binance book from the real time diff channel and reseeds it from the 100 ms snapshot channel.
- [`plans/2026-09-15-binance-realtime-depth-plan.md`](./plans/2026-09-15-binance-realtime-depth-plan.md) records the plan that ships it, and what the first run has to measure.
- [`plans/2026-09-15-minimum-cross-age-design.md`](./plans/2026-09-15-minimum-cross-age-design.md) records the design that refuses a cross younger than `MIN_CROSS_AGE_MS`, and why a minimum episode age at close cannot exist in a trading engine.
- [`plans/2026-09-15-minimum-cross-age-plan.md`](./plans/2026-09-15-minimum-cross-age-plan.md) records the plan that ships the age gate.

## Research

- [`research/2026-07-26-exchange-fees-comparison.md`](./research/2026-07-26-exchange-fees-comparison.md) compares the verified fee models and total arbitrage costs.
- [`research/2026-07-26-exchange-websocket-comparison.md`](./research/2026-07-26-exchange-websocket-comparison.md) compares market data, subscriptions, recovery, and execution feeds.
- [`research/2026-07-30-ccxt-ws-ingest-feasibility.md`](./research/2026-07-30-ccxt-ws-ingest-feasibility.md) audits CCXT 4.5.68 internals against the cost of streaming every perpetual swap.
- [`research/2026-07-30-venue-ws-protocol-differences.md`](./research/2026-07-30-venue-ws-protocol-differences.md) maps the sixteen axes on which the five venue sockets differ.
- [`research/2026-09-06-venue-depth-endpoints-probe.md`](./research/2026-09-06-venue-depth-endpoints-probe.md) measures each venue's REST book endpoint and depth channel and records the shapes, the latency, kraken's ascending bids and coinbase's one second edge cache.
- [`research/2026-09-07-depth-stream-scaling.md`](./research/2026-09-07-depth-stream-scaling.md) measures the whole pipeline for streamed depth on five venues, sizes the fifty venue universe at about 15,000 markets, and finds the single event loop is the one structural blocker, with pair sharding as the path.
- [`research/2026-09-07-depth-sequence-gaps.md`](./research/2026-09-07-depth-sequence-gaps.md) measures zero sequence gaps in 12.48 million deltas on the four delta depth venues, confirms the maintained book against the venues' own top of book and REST, and records how far each ticker channel lags the book.
- [`research/2026-09-14-fresh-gate-markless-leg.md`](./research/2026-09-14-fresh-gate-markless-leg.md) explains how a 1.5 percent TOWNS cross passed the fresh gate because coinbase supplies no mark, measures the INTX mark as the last trade clamped into the spread, and classifies the sixth run's 74 rows with the kraken band ride.
- [`research/2026-09-14-open-guard-sizing.md`](./research/2026-09-14-open-guard-sizing.md) measures the INTX instruments call as the coinbase anchor source, the one-poll anchor moves that size the moving anchor guard at 1,000 ppm, and the region floor's cost at each threshold across two runs.
- [`research/2026-09-15-denied-basis-pairs-gate-probe.md`](./research/2026-09-15-denied-basis-pairs-gate-probe.md) reads OPENAI, ANTHROPIC, ONG, SIREN and ONE live against the open gate, finds every crossed route refused as a standing basis in 90 of 90 rounds, and is the evidence for taking them off `DENIED_PAIRS`.
- [`research/2026-09-15-binance-realtime-depth.md`](./research/2026-09-15-binance-realtime-depth.md) splits our view delay into venue batching and distance, measures `@depth@0ms` at 29 ms ahead of the snapshot channel across 571 markets, and verifies that the two channels share one update id space with 0 mismatched replays.
- [`research/2026-09-15-one-self-index-fresh-gate.md`](./research/2026-09-15-one-self-index-fresh-gate.md) explains how row 2739, a 3.7 percent ONE binance-okx basis, passed the fresh gate after ONE left `DENIED_PAIRS`: binance's ONE index is the perp itself at weight 1.0, the only such basket among 564 USD-M perps, so its mark trails the perp by about five minutes and the leg's fresh premium is momentum.
- [`research/2026-09-15-five-venue-integration.md`](./research/2026-09-15-five-venue-integration.md) compares Gate, Bitget, MEXC, Bitstamp and Gemini against the catalog, the fee registry, the book feed and the anchor poller, finds Gate fits as is, Bitget and MEXC fit with small changes, and Bitstamp and Gemini need an anchor other than a one second bulk poll.

## Audits

One file per audited run of the engine, oldest first.
The newest audit is the one that describes current behaviour.

- [`audits/2026-09-05-first-run-data-audit.md`](./audits/2026-09-05-first-run-data-audit.md) audits the first engine run and finds that 67% of its rows compare different assets or different contract units.
- [`audits/2026-09-06-second-run-data-audit.md`](./audits/2026-09-06-second-run-data-audit.md) audits the run with the cluster overrides in place and finds the remaining rows are dominated by non-converging and fragmented spreads.
- [`audits/2026-09-06-third-run-data-audit.md`](./audits/2026-09-06-third-run-data-audit.md) audits the first run with the quote family and finds that roundTripPpm measures a thin book's width, that duration alone cannot separate stale quotes from slow-venue orders, and that no row proves a capturable spread.
- [`audits/2026-09-08-fourth-run-data-audit.md`](./audits/2026-09-08-fourth-run-data-audit.md) audits the first run with the book feeds and the ladder walk, finds five standing basis and equity pairs behind 389 of 597 rows and a ten dollar coinbase bot behind every coinbase peak, and lists what to verify on the next run.
- [`audits/2026-09-15-fifth-run-data-audit.md`](./audits/2026-09-15-fifth-run-data-audit.md) audits the first home server run, finds no capturable row among 66, shows 30 rows where the engine's view of okx and kraken lagged their own tapes by 1 to 3.7 s inside two flash crashes and 22 standing basis rows that crossed the fresh gate by under 4,100 ppm, and names the per leg lag guard as the first repair.

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
- [`bestiary/lagging-view.md`](./bestiary/lagging-view.md) describes a view running seconds behind a venue while its socket keeps delivering at full rate, the one frame collapse that gives it away, and the 30 of the fifth run's 66 rows it produced inside two flash crashes.
- [`bestiary/gate-margin.md`](./bestiary/gate-margin.md) describes what a hard threshold does to a noisy estimator, the eleven ppm that separated SIREN's 20,364 refusals from its first row, and the 22 of the fifth run's 66 rows that are the measurement rather than the edge.
- [`bestiary/saturated-anchor.md`](./bestiary/saturated-anchor.md) describes a mark clamped into a band around its index, why a fresh premium past that band never decays to zero, and what the fifth run can and cannot prove about it.
- [`bestiary/blind-guard.md`](./bestiary/blind-guard.md) describes a refusal wired into the open path only, which stopped the engine opening a route and also stopped it closing the routes already open, leaving 55.6 percent of the fifth run's samples blind.

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
- [`implemented/2026-09-14-fresh-edge-verdict-design.md`](./implemented/2026-09-14-fresh-edge-verdict-design.md) records the reconciled design that makes the fresh edge the verdict at open and at close, refuses routes whose anchors cannot be read, and removes the index quarantine.
- [`implemented/2026-09-14-fresh-edge-verdict-plan.md`](./implemented/2026-09-14-fresh-edge-verdict-plan.md) records the reconciled plan that shipped the fresh edge verdict.
- [`implemented/2026-09-14-open-guards-design.md`](./implemented/2026-09-14-open-guards-design.md) records the reconciled design for the three refusals at open, a moving anchor, a markless leg and a thin book, and the mark coinbase reads from Coinbase International Exchange.
- [`implemented/2026-09-14-open-guards-plan.md`](./implemented/2026-09-14-open-guards-plan.md) records the reconciled plan that shipped the open guards.
- [`implemented/2026-09-15-five-venue-research-design.md`](./implemented/2026-09-15-five-venue-research-design.md) records the reconciled design for researching Gate, Bitget, MEXC, Bitstamp and Gemini as the next venues, with what the engine needs from a venue.
- [`implemented/2026-09-15-five-venue-research-plan.md`](./implemented/2026-09-15-five-venue-research-plan.md) records the reconciled plan and the profile template that produced the fifteen venue profiles.
- [`implemented/2026-09-15-five-venue-adapters-design.md`](./implemented/2026-09-15-five-venue-adapters-design.md) records the reconciled design that builds Gate, Bitget, MEXC, Bitstamp and Gemini as registered venues that do not start, the shared feed, poller and connector changes they needed, and each adapter's live smoke numbers.
- [`implemented/2026-09-15-five-venue-adapters-plan.md`](./implemented/2026-09-15-five-venue-adapters-plan.md) records the reconciled plan that shipped the five adapters, and the checks each venue needs before it is activated.

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
- [`profiles/gate/fees.md`](./profiles/gate/fees.md) records Gate perpetual fees, tiers, funding, the CCXT fee and the recommended registry values.
- [`profiles/gate/websocket.md`](./profiles/gate/websocket.md) records Gate public book channels, captured frames, session rules and the recommended feed shape.
- [`profiles/gate/rest.md`](./profiles/gate/rest.md) records Gate catalog, anchor calls and semantics, REST book, rate limits and the recommended poller shape.
- [`profiles/bitget/fees.md`](./profiles/bitget/fees.md) records Bitget perpetual fees, tiers, funding, the CCXT fee and the recommended registry values.
- [`profiles/bitget/websocket.md`](./profiles/bitget/websocket.md) records Bitget public book channels, captured frames, session rules and the recommended feed shape.
- [`profiles/bitget/rest.md`](./profiles/bitget/rest.md) records Bitget catalog, anchor calls and semantics, REST book, rate limits and the recommended poller shape.
- [`profiles/mexc/fees.md`](./profiles/mexc/fees.md) records MEXC perpetual fees, tiers, funding, the CCXT fee and the recommended registry values.
- [`profiles/mexc/websocket.md`](./profiles/mexc/websocket.md) records MEXC public book channels, captured frames, session rules and the recommended feed shape.
- [`profiles/mexc/rest.md`](./profiles/mexc/rest.md) records MEXC catalog, anchor calls and semantics, REST book, rate limits and the recommended poller shape.
- [`profiles/bitstamp/fees.md`](./profiles/bitstamp/fees.md) records Bitstamp perpetual fees, tiers, funding, the CCXT fee and the recommended registry values.
- [`profiles/bitstamp/websocket.md`](./profiles/bitstamp/websocket.md) records Bitstamp public book channels, captured frames, session rules and the recommended feed shape.
- [`profiles/bitstamp/rest.md`](./profiles/bitstamp/rest.md) records Bitstamp catalog, anchor calls and semantics, REST book, rate limits and the recommended poller shape.
- [`profiles/gemini/fees.md`](./profiles/gemini/fees.md) records Gemini perpetual fees, tiers, funding, the CCXT fee and the recommended registry values.
- [`profiles/gemini/websocket.md`](./profiles/gemini/websocket.md) records Gemini public book channels, captured frames, session rules and the recommended feed shape.
- [`profiles/gemini/rest.md`](./profiles/gemini/rest.md) records Gemini catalog, anchor calls and semantics, REST book, rate limits and the recommended poller shape.
