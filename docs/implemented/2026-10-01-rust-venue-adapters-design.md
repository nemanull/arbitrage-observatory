# Rust venue adapters, design

Design of record for porting the ten venue adapters of the Nest server to the Rust server.
The first five, binance, bybit, okx, krakenfutures and coinbase, are started and run.
The other five, gate, bitget, mexc, bitstamp and gemini, are built and registered and not started.
The plan that ships it is [`2026-10-01-rust-venue-adapters-plan.md`](./2026-10-01-rust-venue-adapters-plan.md).

## Problem

Before this work the Rust server had the engine, the book feed runtime and the anchor poller runtime, and no venue.
`load_venue` and `start_venue`, now at [`venues/mod.rs:51`](../../server/src/venues/mod.rs) and [`venues/mod.rs:67`](../../server/src/venues/mod.rs), matched on no venue, so the binary stopped at boot with zero venues loaded.
The Nest server in [`old_ts_server/`](../../old_ts_server/) has ten adapters under `old_ts_server/src/venues/<id>/`, and it started five of them at [`orchestrator.ts:48`](../../old_ts_server/src/orchestrator.ts).
The Rust orchestrator already listed the same five at [`orchestrator.rs:18`](../../server/src/orchestrator.rs).

The 2026-09-30 design of the Rust runtimes is no longer in the repository, so the code is the reference for the venue contract.

## The venue contract

A venue is one value that implements two traits, and `start` at [`venues/mod.rs:85`](../../server/src/venues/mod.rs) hands it to both runtimes behind one `Arc`.

- `BookVenue` at [`venue_feed.rs:62`](../../server/src/feeds/venue_feed.rs) gives the feed its settings, its socket plan, its subscribe frames, its ping and a `handle` for each frame.
  A venue never touches the socket, a timer or the engine channel.
  `type State` is the venue's parse state for one connection, and the runtime makes a fresh one at every open.
- `Connection` at [`venue_feed.rs:81`](../../server/src/feeds/venue_feed.rs) is what `handle` works through.
  `position` resolves a symbol and logs the first drop of an unknown one, `book` and `reset_book` reach the market's `OrderBook`, `publish` marks the market for the engine once the frame is handled, `send` queues a reply frame, and `resync` ends the connection after the frame.
  A venue calls `publish` after its last use of `book`, because `book` borrows the connection.
- `AnchorVenue` at [`anchor_poller.rs:53`](../../server/src/feeds/anchor_poller.rs) gives the poller its cadence, its rate limit pause and `fetch_round`, which returns rows keyed by raw market id.
  `get_json` at [`anchor_poller.rs:71`](../../server/src/feeds/anchor_poller.rs) is the shared GET with a 10 s timeout, and it turns 403, 418 and 429 into `RateLimited`.
  `fetch_round` takes `&self`, so a poller that keeps a table between rounds holds it behind a lock.

## What CCXT did for the Nest server

The Nest connector at [`connector.ts:41`](../../old_ts_server/src/ccxt/connector.ts) called CCXT's `loadMarkets`, kept active swaps, applied the registry's `marketFilter`, and built each market from CCXT's unified fields.
CCXT has no Rust version, so each Rust adapter reads its venue's instruments call itself.
The rules below were read from CCXT 4.5.68's source under `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/` on 2026-10-01, which is the version the Nest server ran.

| Venue | Instruments call | Perpetual | Active | Base and quote | Linear | Contract size |
|---|---|---|---|---|---|---|
| binance | `fapi/v1/exchangeInfo` and `dapi/v1/exchangeInfo` | `contractType` PERPETUAL, or `deliveryDate` 4133404800000, which is how CCXT keeps all 213 `TRADIFI_PERPETUAL` rows of 2026-10-01 | `status` or `contractStatus` TRADING | `baseAsset`, `quoteAsset` | `marginAsset` equals the quote | `contractSize`, else 1 |
| bybit | `v5/market/instruments-info` per category, `limit=1000`, paged by `nextPageCursor` | `contractType` LinearPerpetual or InversePerpetual | `status` Trading | `baseCoin`, `quoteCoin` | the category is linear | 1 on linear, `lotSizeFilter.minTradingQty` or `minOrderQty` on inverse |
| okx | `api/v5/public/instruments?instType=SWAP` | every row | `state` live | the two halves of `uly` | the quote half equals `settleCcy` | `ctVal` |
| krakenfutures | `derivatives/api/v3/instruments` | a type without " index" and no `lastTradingTime` | `tradeable` | the symbol's part after `_` less its last three letters, and USD | the type is not `futures_inverse` | `contractSize` |
| coinbase | `api/v3/brokerage/market/products?product_type=FUTURE&contract_expiry_type=PERPETUAL` | `contract_expiry_type` PERPETUAL | not `is_disabled` | `contract_root_unit`, `quote_currency_id` | always | `contract_size` |
| gate | `api/v4/futures/usdt/contracts` | a `name` with no third part | `status` trading, which CCXT assumes when absent | the two halves of `name` | the quote equals the settle currency | `quanto_multiplier`, and 0 reads as 1 |
| bitget | `api/v2/mix/market/contracts` for USDT-FUTURES and USDC-FUTURES | `symbolType` perpetual | `status`, else `symbolStatus`, online or normal | `baseCoin`, `quoteCoin` | the base is not the settle coin taken from `supportMarginCoins` | 1 |
| mexc | `api.mexc.com/api/v1/contract/detail` | every row | `state` 0 | `baseCoin`, `quoteCoin` | the quote equals `settleCoin` | `contractSize` |
| bitstamp | `api/v2/markets/` | `market_type` PERPETUAL | `trading` Enabled | `base_currency`, `counter_currency` | always | 1 |
| gemini | `v1/symbols` | an id containing perp, outside CCXT's `brokenPairs` | always | the id less perp, split at the first quote of CCXT's list that ends it | always | 1, pinned by the registry |

Every code passes through CCXT's `safeCurrencyCode`, which uppercases the id and then maps it through the venue's `commonCurrencies` merged over the base table.
The base table maps `XBT` to `BTC` and `BCHSV` to `BSV`, which is how kraken's `PF_XBTUSD` clusters with every other BTC.
The venue tables that touch a perpetual are binance `BCC` and `YOYO`, okx `AE`, coinbase `CGLD`, gate's twenty conflict names such as `GTC` to `GAMECOM`, bitget's six such as `TONCOIN` to `TON`, mexc's twenty one such as `GMT` to `GMTTOKEN` and `XBT` kept as `XBT`, and bitstamp `UST` to `USTC`.

The registry filters and fees of [`registry.ts:34`](../../old_ts_server/src/venues/registry.ts) carry over unchanged.
Kraken keeps linear contracts only, gate keeps linear USDT contracts, bitget keeps linear USDT and USDC contracts, mexc keeps `apiAllowed` contracts, and gemini pins every contract size to 1.

A live CCXT dump of all ten venues on 2026-10-01 kept 804 binance, 873 bybit, 495 okx, 204 krakenfutures, 131 coinbase, 1,024 gate, 862 bitget, 1,167 mexc, 20 bitstamp and 13 gemini markets.
That dump is the parity target.

## Venue facts move into the loaders

The Nest server denied four pairs and scaled two okx markets in [`clusterOverrides.ts:7`](../../old_ts_server/src/engine/cluster/clusterOverrides.ts).
On 2026-09-27 the user removed both from the Rust cluster builder, because each entry is a fact about one venue's market and a pair wide deny also kills valid clusters.
The Rust engine kept the arithmetic for a scale, since [`anchor_reading.rs:55`](../../server/src/engine/opportunity/anchor_reading.rs) divides whatever the multipliers carry besides the fee out of the index gap.

Mark prices read live on 2026-10-01 show every fact still holds.

| Ticker | binance | okx | bybit | kraken | coinbase | What follows |
|---|---|---|---|---|---|---|
| ANTHROPIC | 2,024.78 | 209.33 | not trading | not listed | 2,042.55 | okx quotes a tenth, scale 10 |
| OPENAI | 1,567.67 | 161.02 | not trading | not listed | 1,601.87 | okx quotes a tenth, scale 10 |
| BB | 0.009773 | 9.108 | 0.00978 | 0.00977 | not listed | okx lists another token |
| ON | 0.10604 | 79.31 | 79.15 | not listed | not listed | binance lists another token |
| QNT | 261.66 | 47.05 | 261.75 | 261.57 | not listed | okx lists another token |
| ONE | 0.002227 | 0.002031 | not listed | not listed | not listed | binance's index basket is its own perp, see [`2026-09-15-one-self-index-fresh-gate.md`](../research/2026-09-15-one-self-index-fresh-gate.md) |

## Decisions

### Shared

1. Each venue is one module under `server/src/venues/`.
   `venues/<id>.rs` holds the venue struct and its `BookVenue` impl, `venues/<id>/anchor.rs` holds its `AnchorVenue` impl, `venues/<id>/markets.rs` holds its loader, and `venues/<id>/tests.rs` holds the feed tests.
   The anchor and loader tests sit at the bottom of their own files.
   This mirrors the split of the runtimes and of the Nest adapters' feed, anchor and types files.
2. The ids stay the CCXT ids, `binance`, `bybit`, `okx`, `krakenfutures`, `coinbase`, `gate`, `bitget`, `mexc`, `bitstamp` and `gemini`, because the database rows and every audit name venues by them.
3. One struct per venue implements both traits, and `start_venue` builds it, from the run's tracked markets where its poller needs them, as in `Binance::new(&run.markets)`.
   A poller needs to know what is tracked, such as whether binance tracks any COIN-M contract, and the Nest pollers read the same list as `this.venue.markets`.
   The krakenfutures, coinbase, gate and mexc pollers make one call that covers every market, so their constructors take nothing.
4. Per market parse state lives in `type State` as a map keyed by position, since `State` must be `Default` and cannot know the market count.
   It dies with the connection, so a reconnect always starts from the venue's next snapshot.
   The Nest binance feed kept its states across reconnects, and this design drops that.
5. A poller's state that outlives a round sits behind a `std::sync::Mutex` in the venue struct: binance's funding intervals, okx's instrument map, bitstamp's funding readings and rotation, and gemini's funding readings.
   Gemini's sits in an `Arc` as well, because its funding refresh runs on a task of its own beside the rounds.
   The guard is never held across an await, and the compiler enforces it, because the round's future must be `Send`.
6. Each loader reads its venue's instruments call with `get_json` and reproduces CCXT 4.5.68's rules from the table above, including the currency code tables.
   The acceptance bar is zero differences in id, base, quote, linear and contract size against the live CCXT dump of the same day.
   A difference that is kept on purpose is written into this doc with its reason.
7. Taker fees are the registry constants: binance 500, bybit 550, okx 500, krakenfutures 500, coinbase 400, gate 500, bitget 600, mexc 800, bitstamp 150 and gemini 700 ppm.
   Where the instruments reply carries a fee that means the same orders, which is only bitget's `takerFeeRate`, the loader warns once when a contract disagrees, as the Nest connector did through CCXT.
8. `Market` gains `price_scale`, set by the loader, and [`index_builder.rs:75`](../../server/src/engine/cluster/index_builder.rs) multiplies both price multipliers by it and divides the size multiplier by it, as [`ClusterIndexBuilder.ts:134`](../../old_ts_server/src/engine/cluster/ClusterIndexBuilder.ts) did.
   The okx loader sets 10 on `ANTHROPIC-USDT-SWAP` and `OPENAI-USDT-SWAP` and logs each at boot.
9. A loader drops the markets whose ticker names another token than the rest of the venues use, and logs each with its reason.
   Binance drops `ONUSDT` and `ONEUSDT`, and okx drops `BB-USDT-SWAP` and `QNT-USDT-SWAP`.
   The pair stays open to every other venue, so binance, bybit and kraken still cluster BB and QNT, and okx and bybit still cluster ON.
10. reqwest gains its `gzip` feature.
    The Nest pollers' `fetch` asked for compressed replies, and on 2026-10-01 compression cut the bybit tickers from 667 KB to 170 KB and the coinbase INTX list from 1.25 s to 0.86 s.
11. Frames and replies are parsed with serde into structs that name only the fields the adapter reads, and every field that a control frame or an odd row can lack is optional or defaulted.
    A frame that still fails to parse is logged as `frame_handle_failed` by the runtime and the connection carries on, which is what a throw inside `handleMessage` did.
12. A shared `venues/wire.rs` turns a venue's number into an `f64` the way JavaScript's `Number` did for the Nest adapters.
    A decimal string, a JSON number and a null all read, and anything unparseable reads as NaN, which the order book and `anchor_issue` already refuse.
    It also reads a level array of any length whose first two entries are the price and the size, which covers binance, bybit, okx, gate, bitget, mexc, bitstamp and gemini.
13. A shared `venues/catalog.rs` holds the currency code rule of decision 6, CCXT's contract size rule, and `finish`.
    `finish` applies the deny step of decision 9, logs every scaled market and one `catalog_read` line, and fails a venue left with no market.
14. Settings, cadences, URLs, chunk sizes and frame shapes are the Nest adapters' values, listed per venue below.
    This port changes behaviour only where a decision here says so.
15. Venue tests drive `handle` directly on a test built `Connection`, as the Nest specs drove `handleMessage` on a stub connection.
    `venue_feed.rs` gains a `#[cfg(test)]` constructor and three readers, the published books, the resync flag and the queued replies.
    Pollers and loaders keep their REST base in a field, which a `with_rest` constructor points at a local axum host in tests.
    That host, in `venues/testing.rs`, answers each path with what a case set, records every request, and can delay or hold a reply, as the Nest specs mocked `getJson` per URL.
    Gemini also takes its clock as a field, because its funding rules read the time and its Nest spec froze `Date.now`.
16. Every Nest spec case of the ten adapters is ported case for case into the Rust tests, with a note where the runtime's coalescing changes a count.
    The runtime sends one update per market per frame, where a Nest feed called `updateBook` on every publish.
    A Nest case that tested `startKeepalive` reads `ping` and `settings` in Rust, and a case that froze `Date.now` either drives gemini's clock or reads the real clock relative to the reply.
17. Two ignored tests reach the live venues on request.
    `live_catalog` prints every venue's loaded markets one per line, and the plan diffs that output against the CCXT dump.
    `live_smoke` starts one venue at a time through `start_venue` on every market it lists, with a stand-in engine channel, for 90 s unless told otherwise.
    It reports the markets that got no book, the books that never showed both sides, crossed tops, stale events and markets the anchors never carried, and prints the first line of every warning kind.
    It fails on a market with no book, a crossed top, a closed socket, or a frame that failed to parse.
    They are the Rust form of the stand-in engine smoke that passed the five later venues on 2026-09-15.
18. The five later venues get an arm in both match statements and stay off `ACTIVE_VENUES`.
    Starting one is a separate decision, and the checklist at the end of [`2026-09-15-five-venue-adapters-plan.md`](../implemented/2026-09-15-five-venue-adapters-plan.md) still applies.

### Per venue

Every number here is the Nest adapter's.
`max_silence` is the silence that ends a connection, and the runtime checks it once a second.

| Venue | Sockets | Markets per socket | Subscribe frames | Ping | Max silence | Other settings |
|---|---|---|---|---|---|---|
| binance | `wss://fstream.binance.com/public/stream` for linear, `wss://dstream.binance.com/stream` for inverse, with the first market's two streams in the query | 200 | `SUBSCRIBE` of 100 streams, `<symbol>@depth@0ms` and `<symbol>@depth20@100ms` per market | a WebSocket ping every 30 s | 240 s | retire after 23 h plus up to 30 min |
| bybit | `wss://stream.bybit.com/v5/public/linear` and `.../inverse` | 200 | 200 `orderbook.50.<symbol>` topics | `{"op":"ping"}` every 20 s | 60 s | none |
| okx | `wss://ws.okx.com:8443/ws/v5/public` | 250 | 200 `books` arguments | text `ping` every 20 s | 60 s | 400 ms connect stagger |
| krakenfutures | `wss://futures.kraken.com/ws/v1` | 100 | one `book` frame of 100 product ids | a WebSocket ping every 20 s | 30 s | none |
| coinbase | `wss://advanced-trade-ws.coinbase.com` | 30 | one `level2` frame of 30 products, then one `heartbeats` frame | none, the heartbeats channel is the keepalive | 15 s | 300 ms connect stagger, 1.5 s reconnect jitter |
| gate | `wss://fx-ws.gateio.ws/v4/ws/usdt` | 150 | one `futures.obu` frame of `ob.<contract>.50` streams | `{"time":<s>,"channel":"futures.ping"}` every 15 s | 45 s | none |
| bitget | `wss://ws.bitget.com/v3/ws/public` | 50 per instType | 10 `books` arguments per frame | text `ping` every 25 s | 60 s | 1 s subscribe gap, 1 s connect stagger |
| mexc | `wss://contract.mexc.com/edge` | 150 | one `sub.depth.full` frame per contract, limit 20 | `{"method":"ping"}` every 15 s | 45 s | 50 ms subscribe gap |
| bitstamp | `wss://ws.bitstamp.net` | 1,000 | one `bts:subscribe` frame per `order_book_<id>` channel | `{"event":"bts:heartbeat"}` every 20 s | 60 s | 60 s first book wait |
| gemini | `wss://ws.gemini.com/?snapshot=-1` | all on one socket | one `subscribe` frame of `<id>@depth@100ms` streams | `{"id":<n>,"method":"ping"}` every 20 s | 60 s | none |

| Venue | Book rule | Anchor calls | Poll | Rate limit pause |
|---|---|---|---|---|
| binance | snapshot channel reseeds and bounds the window, diffs chain on `pu` or straddle `U`, a gap drops the symbol until the next snapshot | `premiumIndex` per tracked family, `fundingInfo` reread hourly | 1 s | 60 s |
| bybit | snapshot resets, delta `u` must be the last plus one or the connection resyncs | `tickers` per tracked category | 2 s | 10 min |
| okx | snapshot resets, update `prevSeqId` must be the last `seqId` or the connection resyncs, an equal pair is a heartbeat | `funding-rate`, `mark-price`, `index-tickers` per index quote, `instruments` reread hourly | 1 s | 60 s |
| krakenfutures | `book_snapshot` resets, delta `seq` must be the last plus one or the connection resyncs | `tickers`, funding divided by the mark, interval 1 h, next at the top of the hour | 1 s | 60 s |
| coinbase | one `sequence_num` per connection must step by one or the connection resyncs, snapshot resets, update before a snapshot resyncs | INTX `instruments`, mark 0 when not positive, next at the next interval boundary | 2 s | 60 s |
| gate | a `full` push resets, a delta `U` must be the last `u` plus one or the connection resyncs, a delta with no levels only moves the id | `contracts`, pre market and non trading rows left out | 1 s | 10 s |
| bitget | snapshot resets, `pseq` 0 or a `pseq` other than the last `seq` resyncs | `tickers` and `current-fund-rate` per tracked product type | 1 s | 60 s |
| mexc | every push is a whole top 20, an older `version` is skipped, a binary frame is warned once per connection | `funding_rate`, with code 510 in a 200 body read as a rate limit | 1 s | 60 s |
| bitstamp | every push is a whole book, an older `microtimestamp` is skipped, `bts:request_reconnect` ends the connection | `ticker` every round, one market's `funding_rate` per round in turn, ts capped by the ticker's own second | 1 s | 60 s |
| gemini | the first frame per symbol is the snapshot, `u` at or below the last is skipped, `U` above the last resyncs | `riskstats` per market each round, `fundingamount` refreshed beside the rounds one request at a time | 3 s, or longer so riskstats stays at 90 a minute | 60 s |

### Where the port differs from the Nest adapters

- Every venue's parse state is per connection, per decision 4, which also makes mexc warn about a binary frame once per connection rather than once per process, and gemini count request ids per connection.
- A bitget market whose quote names no instType sits in no plan, and `spawn_feed` logs it as `markets_unplanned`, where the Nest feed logged its own error.
- Bitstamp's `bts:request_reconnect` calls `resync` with the reason `reconnect_requested`, which ends the connection the way the Nest feed's close with reopen did.
- Gemini's socket URL carries an explicit `/` before the query.
  Without it tungstenite sends an empty request path and gemini answers `400 Bad Request`, which Node's `ws` never showed because it normalises the path.
  The live smoke found it on 2026-10-01.
- A venue error frame logs as `venue_error`, a notice as `venue_notice`, and a coinbase acknowledgement that omits a product as `subscription_missing`, where the Nest feeds logged free text.

## What the live checks found on 2026-10-01

The Rust catalogs matched a CCXT 4.5.68 dump taken the same minute on all ten venues, in id, base, quote, linear and contract size.
The only differences are the four denied markets of decision 9, and the two okx markets whose `price_scale` is 10.

| Venue | Markets | Window | Book updates | No book | Never two sided | Crossed | Sockets closed | Anchored |
|---|---|---|---|---|---|---|---|---|
| binance | 802 | 90 s | 652,383 | 0 | 0 | 0 | 0 | all |
| bybit | 873 | 90 s | 480,205 | 0 | 0 | 0 | 0 | all |
| okx | 493 | 90 s | 153,693 | 0 | 0 | 0 | 0 | all |
| krakenfutures | 204 | 90 s | 444,588 | 0 | 0 | 0 | 0 | all |
| coinbase | 131 | 60 s | 131 | 0 | 131 | 0 | 0 | all |
| gate | 1,024 | 90 s | 236,594 | 0 | 0 | 0 | 0 | all but 13 |
| bitget | 862 | 120 s | 706,431 | 0 | 0 | 0 | 0 | all |
| mexc | 1,167 | 120 s | 106,971 | 6 | 0 | 0 | 0 | all but 6 |
| bitstamp | 20 | 120 s | 4,554 | 0 | 0 | 0 | 0 | all |
| gemini | 13 | 120 s | 887 | 0 | 0 | 0 | 0 | all |

- Every Coinbase International perpetual that is not delisted, which is the 131 the Advanced list carries, read `PAUSED`, with its quote frozen at 09:00:29 or 09:00:30 UTC.
  The Advanced socket answered each of them with an empty snapshot and no update.
  The Advanced products list still carries all 131 with `is_disabled` false and `trading_disabled` true, and CCXT reads only the first, so the loader keeps them for parity.
  An empty book never becomes a live leg, so coinbase contributes nothing to a run while the pause lasts, and [`2026-09-05-coinbase-derivatives-cutover.md`](../backlog/2026-09-05-coinbase-derivatives-cutover.md) holds the replacement host.
- A binance market is seeded only by its top 20 snapshot, and binance pushes that snapshot only when the top 20 changes.
  NAVERUSDT, a Korean equity perpetual, sent 16 diffs and no snapshot in 75 s, so a quiet TradFi book can hold no book for minutes, as it did on the Nest server.
- The six mexc markets with no book are Hong Kong stock perpetuals whose `openingTime` is 2026-10-02 09:00 UTC, which CCXT lists as active.
- The 13 gate markets with no anchor are pre market contracts with no index basket, such as `ANTHROPIC_USDT` and `H100_USDT`, which the poller leaves out by design.
- Bitstamp and gemini log `anchor_row_missing` for each market until their one request per round funding read has reached it.

## Rejected alternatives

- Calling CCXT from Rust through a Node sidecar at boot.
  It would keep one Node process in a Rust deployment for one call per venue, and the instruments calls are each a few dozen lines.
- A shared catalog table that maps every venue's markets to coins by hand.
  CCXT's rules plus its currency tables reproduce the Nest clusters exactly, and a hand table would drift on every listing.
- Keeping the deny list and the scale table in the cluster builder.
  The user removed them on 2026-09-27, because the builder must not name a venue or a ticker.
- A `price_scale` applied by the feed to every price it parses.
  The book would then hold prices the venue never quoted, and the anchors would need the same treatment on the poller side.
  A multiplier in the cluster keeps raw prices everywhere, as the Nest server did.
- One file per venue.
  Binance alone is a feed of about 200 lines, an anchor of about 100 and a loader of about 100 before tests, and the three concerns change for different reasons.
- Testing the venues only against local WebSocket servers, as the runtime tests do.
  The Nest specs drive one frame at a time and read what was published, and a direct `handle` call ports them without a socket per case.

## Out of scope

- The exchange timestamp, kernel stamp and lag gate of [`2026-09-17-rust-rewrite-requirements.md`](../backlog/2026-09-17-rust-rewrite-requirements.md) items 1, 2 and 4.
  The adapters parse frames as the Nest adapters did and keep the local clock as `recv_ts`.
- A boot time admission stage that compares index prices across venues, sketched in [`2026-09-05-cluster-identity-and-unit-normalisation.md`](../backlog/2026-09-05-cluster-identity-and-unit-normalisation.md).
- Starting any of the five later venues.
- Sequence detail on `book_resync`, which the runtime left out on 2026-09-30.
