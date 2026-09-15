# Five venue adapters, design

Design of record for building Gate, Bitget, MEXC, Bitstamp and Gemini as venues in the shape Binance, Bybit, OKX, Kraken and Coinbase already have.
The research behind it is [`2026-09-15-five-venue-integration.md`](../research/2026-09-15-five-venue-integration.md) and the fifteen profiles under [`profiles/`](../profiles/).
The plan that ships it is [`2026-09-15-five-venue-adapters-plan.md`](./2026-09-15-five-venue-adapters-plan.md).

## Problem

The research found what each venue needs, and none of it exists as code.
The user wants every adapter built now and switched on later.
So each venue gets a registry entry, a book feed, an anchor poller, its wire types and its tests, and nothing starts it.

A venue runs only when its id is in `activeVenues` at [`orchestrator.ts:48`](../../server/src/orchestrator.ts).
The registry at [`registry.ts:34`](../../server/src/venues/registry.ts) is a lookup and starts nothing.
That split is what lets an adapter land without running.

## What the existing shape gives a venue

- A `VenueRegistration` at [`registry.ts:28`](../../server/src/venues/registry.ts) holds the connector options, the CCXT exchange, a feed factory and a poller factory.
- `VenueConnector` loads the catalog through CCXT, applies `marketFilter`, sets the taker fee and warns when CCXT's fee is not the one the registry expects, at [`connector.ts:33`](../../server/src/ccxt/connector.ts).
- `VenueFeed` owns sockets, reconnects, the silence watch and the `OrderBook` per market.
  A venue writes `planEndpoints`, `getSubscribeFrames`, `startKeepalive` and `handleMessage`, see [`VenueFeed.ts:387`](../../server/src/feeds/book/VenueFeed.ts).
  Before this work `onOpen` sent every subscribe frame at once, and decision 7 changed that at [`VenueFeed.ts:117`](../../server/src/feeds/book/VenueFeed.ts).
- `AnchorPoller` runs one round per interval, and a venue writes `fetchRound`, which returns an `AnchorMap` keyed by `rawMarketId`.
  Before this work `apply` stamped every row with the round's arrival time, and decision 5 changed that at [`AnchorPoller.ts:133`](../../server/src/feeds/anchor/AnchorPoller.ts).
  `failed` paused only on an `HttpStatusError` whose status is 403, 418 or 429, at [`errors.ts:1`](../../server/src/shared/errors.ts), and decision 6 added a second case at [`AnchorPoller.ts:190`](../../server/src/feeds/anchor/AnchorPoller.ts).
- The orchestrator hands a feed and a poller only the markets that share a cluster with another venue, at [`orchestrator.ts:214`](../../server/src/orchestrator.ts).
  So a GUSD or USD1 perpetual, which sits outside the quote family at [`quoteFamily.ts:3`](../../server/src/engine/cluster/quoteFamily.ts), never reaches a feed.

## Decisions

### Shared

1. The five venues are added to `VENUE_REGISTRY` under their CCXT ids, `gate`, `bitget`, `mexc`, `bitstamp` and `gemini`, and `activeVenues` does not change.
   CCXT 4.5.68 lists all five ids.
   Adding an id to `activeVenues` is the activation step, and it waits on the checklist in the plan.
2. Each venue lives in `server/src/venues/<id>/` as `<id>.ts` for the feed, `anchor.ts` for the poller, `types.ts` for the wire shapes, and `<id>.spec.ts` and `anchor.spec.ts` for the tests, as the existing five do.
   The classes are `GateFeed`, `GateAnchorPoller`, `BitgetFeed`, `BitgetAnchorPoller`, `MexcFeed`, `MexcAnchorPoller`, `BitstampFeed`, `BitstampAnchorPoller`, `GeminiFeed` and `GeminiAnchorPoller`.
3. `VenueConnectorOptions` gains `ignoreCcxtTakerPpm`.
   When it is true, no market's CCXT fee is compared with the registry, because CCXT's number describes orders the registry rate does not.
   MEXC is the one user, since CCXT reads the per contract web and app rate and API orders pay 800 ppm, see [`mexc/fees.md`](../profiles/mexc/fees.md) section 9.
   The orchestrator constructs `VenueConnector` directly at [`orchestrator.ts:208`](../../server/src/orchestrator.ts), so a registry option replaces the subclass override the comment at [`connector.ts:32`](../../server/src/ccxt/connector.ts) used to anticipate.
4. `VenueConnectorOptions` gains `contractSize`, which pins every market's size.
   Gemini is the one user.
   Its books are in base units, and CCXT copies the price tick into `contractSize` on the day its catalog scrape succeeds, see [`gemini/rest.md`](../profiles/gemini/rest.md) section 2.
5. An `AnchorRow` may carry its own `ts`, and `apply` keeps it instead of the round's arrival time.
   A round made of several requests would otherwise stamp early numbers with the arrival of the slowest request, which reads a leg as fresher than it is.
   Bitstamp and Gemini use it.
   The existing five do not set it and behave as today.
6. `errors.ts` gains `RateLimitReplyError`, and `AnchorPoller.failed` pauses on it exactly as on a 429.
   MEXC sends its rate limit, code 510, inside an HTTP 200 body with `success` false, see [`mexc/rest.md`](../profiles/mexc/rest.md) section 6.
   Any other `success` false reply is a plain failed round.
7. `VenueFeed` gains `subscribeGapMs`, a pause between subscribe frames on one connection, 0 by default.
   The first frame goes out on open, and the rest go out one per gap from a timer the connection owns, so a close cancels them.
   Bitget closed its v3 socket on frames of 25 or more arguments with no error, and MEXC takes one frame per contract, so both pace, see [`bitget/websocket.md`](../profiles/bitget/websocket.md) section 8 and [`mexc/websocket.md`](../profiles/mexc/websocket.md) section 8.
8. `VenueFeed` gains a first book watch.
   After the last subscribe frame plus `firstBookWaitMs`, 10,000 by default, a connection logs one `book_unserved` warning with the count and a sample of its markets that hold no book.
   Gate, MEXC and Bitstamp acknowledge a misspelled or wrong family stream and then stay silent, so this line is the only trace such a market leaves.
   The warning costs nothing on the existing five, which all send a snapshot on subscribe.
9. No venue code touches `DENIED_PAIRS`, the quote family, the anchor reader, the engine or the orchestrator.
   A pair line removes a pair from every venue, and a venue that is not running produces no row that could justify one.
   The self index baskets, capped marks and closed market hours the research found become activation checks in the plan.

### Gate

10. Registry: `takerPpm` 500, `ccxtTakerPpm` unset, and `marketFilter` keeping `linear === true` with settle `USDT`.
    CCXT's literal 0.0005 already equals 500, so the connector's warning fires only if a later CCXT release changes it, see [`gate/fees.md`](../profiles/gate/fees.md) section 9.
    The filter drops the one BTC-settled inverse contract, whose `quanto_multiplier` of 0 reads as a contract size of 1, and keeps the feed and poller on one settlement family.
11. Feed: `wss://fx-ws.gateio.ws/v4/ws/usdt`, channel `futures.obu` with stream `ob.<rawMarketId>.50`, 150 markets per connection and one subscribe frame per connection.
    A `full` frame resets the book and stores `u`.
    A delta applies only when `U` is the last `u` plus one, and anything else resyncs.
    A delta that chains but carries no levels moves `u` and publishes nothing, since the top fifty did not change, which was 14,198 of 40,882 deltas in the live smoke.
    Keepalive is `futures.ping` every 15 s, and `maxSilenceMs` is 45,000.
    A `futures.system` frame, the documented notice before a shutdown, is logged as a warning.
    Evidence is [`gate/websocket.md`](../profiles/gate/websocket.md) sections 4 and 8.
12. Poller: `GET https://api.gateio.ws/api/v4/futures/usdt/contracts` every second.
    Rows whose `is_pre_market` is true or whose `status` is not `trading` are skipped.
    `funding_interval` is seconds and `funding_next_apply` is Unix seconds.
    `maker_fee_rate` and `taker_fee_rate` are never read.
    `rateLimitPauseMs` is 10,000, the length of Gate's window.
    Evidence is [`gate/rest.md`](../profiles/gate/rest.md) sections 3 and 8.

### Bitget

13. Registry: `takerPpm` 600, `ccxtTakerPpm` unset, and `marketFilter` keeping `linear === true` with settle `USDT` or `USDC`.
    The filter drops the 9 Coin-M contracts and the 7 demo markets CCXT loads as active swaps, see [`bitget/websocket.md`](../profiles/bitget/websocket.md) section 8.
    CCXT reads the wire's per market `takerFeeRate`, 600 on every contract, so the connector warns the day Bitget changes one.
14. Feed: `wss://ws.bitget.com/v3/ws/public`, channel `books`, with `instType` `usdt-futures` or `usdc-futures` taken from the market's quote and never guessed.
    50 markets per connection, at most 10 arguments per frame, `subscribeGapMs` 1,000 and `connectStaggerMs` 1,000.
    Keepalive is the text `ping` every 25 s, and the bare text `pong` is tested before `JSON.parse`, as the OKX feed does.
    `maxSilenceMs` is 60,000.
    A snapshot resets the book and stores `seq`.
    An update applies when its `pseq` equals the last `seq`, and an update before any snapshot, a `pseq` of 0 or any other `pseq` resyncs.
    `seq` and `pseq` are compared as the numbers `JSON.parse` returns, which are exact near 10^12 on the linear contracts, while the Coin-M sequences above 2^53 never reach the feed because of the filter.
    A market whose quote names no `instType` is left out of every plan and logged once, which the filter makes unreachable today.
    Only the first entry of a `books` frame is read, because every frame of a 517 frame live capture carried one, and a second entry would break the next `pseq` and resync rather than be lost silently.
15. Poller: `GET https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES` and `.../current-fund-rate?productType=USDT-FUTURES` in parallel every second, plus the `USDC-FUTURES` pair only while a USDC market is tracked.
    Index and mark come from the tickers, and rate, interval in hours and `nextUpdate` in Unix ms come from the funding call, joined on `symbol`.
    A reply whose `code` is not `"00000"` fails the round.
    Evidence is [`bitget/rest.md`](../profiles/bitget/rest.md) sections 3 and 8.

### MEXC

16. Registry: `takerPpm` 800, `ignoreCcxtTakerPpm` true, and `marketFilter` keeping `apiAllowed === true` on `market.info`, which drops the 41 contracts the API cannot trade, see [`mexc/fees.md`](../profiles/mexc/fees.md) section 9.
    CCXT types `info` as `any`, so the filter reads the field through a cast to satisfy the lint rule.
    The registry comment says the API rate changed twice in two months and must be re-read before activation.
17. Feed: `wss://contract.mexc.com/edge`, channel `sub.depth.full` with `limit` 20, one subscribe frame per contract, 150 markets per connection and `subscribeGapMs` 50.
    Every `push.depth.full` frame is a whole book and goes to `resetBook`, and a frame whose `version` is below the last applied one is dropped while the contract holds a book.
    A contract with no book, which is every contract after a close, takes any version, so a counter reset on the venue heals on the reconnect instead of freezing the book.
    Keepalive is `{"method":"ping"}` every 15 s, and `maxSilenceMs` is 45,000.
    A binary frame is logged once and dropped.
    `VenueFeed` does not pass the frame type to `handleMessage`, so a frame whose first byte is not `{` is taken as binary.
    Evidence is [`mexc/websocket.md`](../profiles/mexc/websocket.md) sections 4 and 8.
18. Poller: `GET https://api.mexc.com/api/v1/contract/funding_rate` every second, keyed by `symbol`, with `idxPrice`, `fairPrice`, `fundingRate`, `collectCycle` in hours and `nextSettleTime` in Unix ms.
    A reply whose `success` is not true or whose `code` is not 0 fails the round, and code 510 throws `RateLimitReplyError`.
    Evidence is [`mexc/rest.md`](../profiles/mexc/rest.md) sections 3, 6 and 8.

### Bitstamp

19. Registry: `takerPpm` 150 and `ccxtTakerPpm` 4000.
    CCXT falls back to its spot constant, and the registry comment says 150 ppm belongs to two launch programmes that end when Bitstamp introduces volume tiers, see [`bitstamp/fees.md`](../profiles/bitstamp/fees.md) section 9.
20. Feed: one connection to `wss://ws.bitstamp.net` per 1,000 markets, which is one connection for today's 20, and one `bts:subscribe` frame per `order_book_<rawMarketId>` channel.
    The venue closes a connection on its 1,025th subscription with no error, so the split only matters if the catalog grows.
    Every data frame is a whole book of up to 100 levels and goes to `resetBook`, and a frame whose `microtimestamp` is not above the last applied one is dropped.
    The guard is kept per market across reconnects, because the stamp is venue time and keeps rising.
    Keepalive is `{"event":"bts:heartbeat"}` every 20 s, and `maxSilenceMs` is 60,000.
    `bts:request_reconnect` closes the connection with reopen.
    `firstBookWaitMs` is 60,000, because Bitstamp sends no snapshot on subscribe and a quiet book stayed empty for up to 49 s.
    Evidence is [`bitstamp/websocket.md`](../profiles/bitstamp/websocket.md) sections 4, 5 and 8.
21. Poller: `GET https://www.bitstamp.net/api/v2/ticker/` for index and mark on every round, and `GET https://www.bitstamp.net/api/v2/funding_rate/<rawMarketId>/` for one market per round in rotation, both in parallel every second.
    That is 1,200 requests per 10 minutes against a published 10,000.
    Ticker rows are filtered to `market_type` `PERPETUAL` and keyed by `market.replace('/', '').toLowerCase()`.
    A row's `ts` is the ticker's own `timestamp` in ms, capped at the reply's arrival, because the edge served cached replies in under 20 ms and a cached reply stamped on arrival reads as fresh.
    `fundingIntervalHours` is the constant 8, and `nextFundingAt` is the funding reply's `next_funding_time` times 1,000, never computed from the grid.
    A market is left out of the round until its first funding reading lands, which takes at most one rotation.
    A failed funding request for one market is logged once per market and does not fail the round, and the market keeps its last reading until its next turn.
    Evidence is [`bitstamp/rest.md`](../profiles/bitstamp/rest.md) sections 3, 4 and 8.

### Gemini

22. Registry: `takerPpm` 700, `ccxtTakerPpm` 4000 and `contractSize` 1, see [`gemini/fees.md`](../profiles/gemini/fees.md) section 9.
    The registry comment says the 0.004 literal matches no Gemini perpetual rate.
23. Feed: one connection to `wss://ws.gemini.com?snapshot=-1` and one subscribe frame naming `<rawMarketId>@depth@100ms` for every market.
    The first `depthUpdate` for a symbol after open is absolute levels and goes to `resetBook`.
    After it, a frame with `u` at or below the last `u` is dropped, a frame with `U` above the last `u` resyncs, and any other frame applies and stores `u`.
    Keepalive is `{"id":<n>,"method":"ping"}` every 20 s, and `maxSilenceMs` is 60,000.
    A control reply whose `status` is not 200 is logged.
    Evidence is [`gemini/websocket.md`](../profiles/gemini/websocket.md) sections 4 and 8.
24. Poller: `GET https://api.gemini.com/v1/riskstats/<rawMarketId>` for every tracked market in parallel on each round, each row stamped with its own reply's arrival.
    `intervalMs` is the larger of 3,000 and the tracked market count times 60,000 divided by 90, which keeps index and mark under 90 of the public 120 requests a minute, and gives 4,000 for the 6 USDC perpetuals.
    A failed `riskstats` request drops that market from the round, and the round fails only when every request failed, rethrowing the first error so a 429 still pauses.
    Funding comes from `GET https://api.gemini.com/v1/fundingamount/<rawMarketId>`, at most one request per round and one in flight, started after the round's `riskstats` settle and not awaited, because a single reply took 1.2 to 3.8 s.
    A market is due once its reading is missing, older than 60 s, or names a `nextFundingTimestamp` no longer in the future, which is how the settled hour's estimate shows after each hour.
    Among due markets it refreshes the one whose last request is oldest, not the one whose reading is oldest, so a market whose call keeps failing cannot starve the rest.
    The refresh shares the round's abort signal, and a failure is logged unless a stop aborted it.
    `fundingRate` is `estimatedFundingAmount` divided by the round's mark, and `fundingIntervalHours` is `nextFundingTimestamp` minus `fundingTimestampMilliSecs` in hours.
    A market is left out of the round while it holds no usable funding reading, so the first round after boot writes nothing and counts as failed, and every market writes from about the seventh round.
    Evidence is [`gemini/rest.md`](../profiles/gemini/rest.md) sections 3, 4 and 8.

## What it does not do

- It starts no venue.
- It adds no `DENIED_PAIRS` line, no price scale and no quote family member.
- It does not refuse a leg whose index basket holds the venue's own perpetual, whose mark is capped, or whose market hours are closed.
- It adds no REST book seed, no socket anchor and no second anchor writer.
- It does not pause Bitstamp on a rate limit sent as HTTP 400, because two requests a second is an eighth of the limit.
- It does not repair CCXT's renames of MEXC's GAS, GMT and FLUX bases.

## Rejected alternatives

- **A socket anchor for Bitstamp and Gemini.**
  Bitstamp's `funding_rate_<id>` channel and Gemini's archived v2 feeds carry the anchor without a request budget.
  Either needs a second anchor writer beside `AnchorPoller`, while the REST rounds fit the existing class with one optional field.
  Bitstamp's channel stays the upgrade path if its ticker proves too coarse.
- **One Gemini request per tick in rotation.**
  At one request a second a leg ages 6 s between reads, past the 5 s skew limit at [`anchorReading.ts:4`](../../server/src/engine/opportunity/anchorReading.ts).
- **Rewriting cached rows on every round.**
  `Engine.updateAnchor` measures `movePpm` against the previous write at [`Engine.ts:413`](../../server/src/engine/Engine.ts), so writing the same numbers again resets the move to 0 and hides a real one.
  A market is written only on the round that read it.
- **Awaiting Gemini's funding call inside the round.**
  A 3.8 s reply would hold the round's writes back by that much.
- **A connector subclass for MEXC.**
  The orchestrator builds `VenueConnector` directly, and a boolean in the registry is one line.
- **Reading Bitget's sequences from the raw frame text.**
  The first build compared `seq` and `pseq` as digit strings cut from the text, to stay exact above 2^53.
  Only the Coin-M contracts reach that range, and the filter drops them, so the numbers `JSON.parse` returns are exact on every market the feed receives.
- **Pacing inside `getSubscribeFrames`.**
  The venue returns frames and `VenueFeed.onOpen` sends them, so pacing belongs where the send is.
- **Deny list lines now.**
  A pair line removes the pair from every venue, and the candidates in the research were read on one date for venues that are not running.
- **MEXC's merged `sub.depth` with a REST seed.**
  About 100 ms sooner, at the cost of a seed per contract and a resync that reseeds the whole slice, see [`mexc/websocket.md`](../profiles/mexc/websocket.md) section 8.

## Verification

Measured on 2026-09-15 between 20:50 and 21:05 UTC, from the development host.

- Tests: 387 pass on explicit paths, 37 in `src/ccxt` and `src/feeds`, 193 in `src/venues` and 157 in `src/engine`.
  The new venues hold 15 Gate, 22 Bitget, 18 MEXC, 19 Bitstamp and 22 Gemini tests, built from frames and replies captured in the profiles or live that day.
- Typecheck, lint and Prettier are clean on every touched file.
- Each adapter ran once against the live venue through `VenueConnector` with its registry options and a stand-in engine that validates anchor readings the way `Engine.updateAnchor` does.

| venue | catalog kept | feed run | books | resyncs, unserved | poller run | rows per round |
|---|---|---|---|---|---|---|
| Gate | 983 of 984 swaps, `BTC_USD` dropped | 303 markets, 3 connections, 45 s | 303 of 303, 26,987 publishes | 0, 0 | 983 markets, 12 rounds, 167 to 358 ms warm | 972 written, 11 pre market missing, 0 rejected |
| Bitget | 836 of 852, 787 USDT and 49 USDC | 299 markets, 6 connections, 45 s | 299 of 299, 121,131 publishes | 0, 0 | 836 markets, 13 rounds, 119 to 295 ms | 836 written, 0 missing, 0 rejected |
| MEXC | 1,143 of 1,184, the 41 `apiAllowed` false dropped | 299 markets and one fake id, 2 connections of 150 paced frames, 45 s | 299 of 299, 14,963 publishes | 0, 1 naming only the fake `NOPE_USDT` | 1,143 markets, 13 rounds, 143 to 479 ms | 1,143 written, 0 missing, 0 rejected |
| Bitstamp | 20 of 20 | 20 markets, 1 connection, 65 s | 20 of 20, 2,633 publishes, `brent` only once | 0, 0 | 20 markets, 25 rounds, about 170 ms median | 20 written from round 20, as the funding rotation fills |
| Gemini | 13 swaps, 6 USDC ones can cluster | 13 markets, 1 connection, 45 s | 13 of 13, 765 publishes | 0, 0 | 6 USDC markets every 4 s, 16 rounds, 155 to 2,158 ms | 6 written from round 7, no 429 |

- Bitstamp row stamps were 0.24 to 2.3 s old when written, median 0.77 s, because the ticker stamps whole seconds.
- Gemini's funding calls took 645 to 3,832 ms, and its row stamps were up to 1.9 s old when written, because a round writes after its slowest `riskstats` reply.
- No run crossed an hour, a settlement, a reconnect or a rate limit, so those paths rest on the specs.
- The first real run of each venue is an activation step, not part of this work.

## Known limits

- `AnchorPoller` warns once per market about a missing reading, and Bitstamp and Gemini spend that warning during their funding warm-up, so a market that goes missing for real later is only counted in `anchor_poll_summary`.
- Gemini leaves a market out while its funding reading names a past settlement, and with one refresh per 4 s round and replies of up to 3.8 s, the six markets can take about 45 s to recover after each hour.
- A Gemini 429 on only some of a round's requests drops those markets without pausing the poller.
- A Gate duplicate delta, with `U` at or below the last `u`, resyncs the whole slice of 150, although none was seen.
