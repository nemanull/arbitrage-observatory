# ApeX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:15 to 22:39 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of ApeX Omni (CCXT id `apex`) that a catalog, an anchor poller and a book check would use, and the decentralised layer behind it.
The researched family is the USDT-settled linear perpetuals of `contractConfig.perpetualContract`.
Every call is a `GET` under `https://omni.apex.exchange/api`, and nothing here signs, logs in or calls a private endpoint.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/apex/rest-probe.py), run with `uv run` from the repository root, unless it names [`ws-probe.py`](../../../scripts/probes/venues/apex/ws-probe.py).
P1 is the first run of each mode, from 22:15 to 22:31 UTC, and P2 is the rerun in the second pass, from 22:31 to 22:39 UTC.
Where the documentation and the wire disagree, both are written.
The socket is in [`websocket.md`](./websocket.md), and fees and who may trade in [`fees.md`](./fees.md).

## 1. Host and latency from this machine

| host | role | resolved | edge |
|---|---|---|---|
| `omni.apex.exchange` | REST, S1 | CNAME `omni.apex.exchange.whecloud.com`, one address, `140.150.36.123` | a CDN whose hops name themselves "Cdn Cache Server V2.0": `x-via: 1.1 PS-SIN-…, 1.1 VM-DFW-… or VM-DEN-…, 1.1 PSmglsjLAX2dv159…`, then an AWS load balancer that sets `AWSALB` cookies |
| `quote.omni.apex.exchange` | socket, S1 | CNAME `quote.omni.apex.exchange.cdn20.com`, the same `140.150.36.123` | see [`websocket.md`](./websocket.md) section 1 |
| `api-docs.omni.apex.exchange` | documentation | CNAME `api-docs.pro.apex.exchange`, four CloudFront addresses | |

The hop names place the edge in Los Angeles and a node in Singapore, so the origin is most likely in Singapore, which is an inference from the names alone.
Every public call answered, and no reply was a refusal or a geoblock, P1 and P2.

The CDN caches replies that the origin marks `cache-control: no-cache`.
A cached reply carries an `Age` header over HTTP/1.1, and its last `x-via` hop reads `0.0` instead of `1.1` over HTTP/2, P1.
That matters for the time call in section 7 and for the bulk ticker in section 3.

| call | reply bytes | latency, P1 | latency, P2 |
|---|---:|---|---|
| `GET /v3/time` | 44 | first call 572.5 ms with DNS and TLS. Origin replies 280 to 590 ms, cached replies 40 to 46 ms | first call 365.5 ms. Cached replies 40 to 124 ms |
| `GET /v3/symbols` | 756,871 decoded, sent gzip | 257 to 364 ms over five calls | 258 to 381 ms over four calls |
| `GET /v3/data/all-ticker-info` | 160,974 to 161,022 decoded, 19,508 gzip | origin 8,473 to 8,550 ms, cached 45 to 156 ms | origin 8,411 to 8,691 ms, cached 42 to 85 ms |
| `GET /v3/ticker?symbol=BTCUSDT` | 426 | 142 ms | |
| `GET /v3/depth?symbol=BTCUSDT&limit=25` | 1,065 | 224 to 232 ms | 224 to 242 ms |
| `GET /v3/history-funding` | 666 for 5 rows | 340 to 378 ms | 338 to 583 ms |

Every JSON reply carries a top-level `timeCost`.
It read 1 on `/v3/time`, about 500 to 3,500 on the single-market calls, and 8,132,888 to 8,412,399 on `all-ticker-info` in P1 and P2, so it is the origin's own build time in microseconds, which the 8.4 to 8.7 s origin replies confirm.

## 2. Catalog

### The instruments call

`GET /api/v3/symbols`, documented as "GET All Config Data", S2, returns `data` with `spotConfig`, `contractConfig`, `omniSwapConfig` and `eventConfig`.
`contractConfig` holds four contract lists, and only the first is read by CCXT.

| list | rows | `enableTrade`, `enableDisplay`, `enableOpenPosition` | settlement | `contractType` |
|---|---:|---|---|---|
| `perpetualContract` | 138 | all true on 86, all false on 50, true, false, false on 1, true, false, true on 1 | USDT on 138 | `PERPETUAL_CONTRACT` 71, `UNKNOWN_CONTRACT_TYPE` 67 |
| `stockContract` | 48 | all true on 40, all false on 8 | USDT on 48 | `STOCK_CONTRACT` 48 |
| `predictionContract` | 184 | true, false, true on 163, all false on 15, all true on 6 | USDT on 184 | `PREDICTION_CONTRACT` 184 |
| `prelaunchContract` | 0 | | | |

P1 and P2 agreed on every count.
`isPrelaunch` was false on every row, and `contractType` does not separate live rows from dead ones.

### The 88 trading perpetuals

| item | value, P1 and P2 |
|---|---|
| trading | 88 of 138, all USDT settled |
| names | `symbol` is `<base>-USDT`, `crossSymbolName` and `symbolDisplayName` are `<base>USDT`, on 88 of 88 |
| bases | one row per base, no pair listed twice. Three bases start with a digit: `1000PEPE`, `1000BONK` and `0G` |
| hidden but trading | `IO-USDT` with `enableDisplay` and `enableOpenPosition` false and `pullOffTime` 1765501200, which is 2025-12-12, and `STBL-USDT` with `enableDisplay` false, `deliveryTime` 1779184800000 and `pullOffTime` 1779184800, which is 2026-05-19. Neither has sent a book, see section 5 |
| `minOrderSize` | equal to `stepSize` on 88 of 88 |
| `fundingInterestRate` | `0.0003` on 88 |
| `fundingMaxRate` | 0.000305 on 45, 0.005 on 29, 0.02 on 10, 0.000469 on 3, 0.01 on 1, with `fundingMinRate` the negative of each |
| `maxMarketPriceRange` | 0.045 on 73 and 0.1 on 15 |
| `indexPriceVarRate` | 0.001 on 87 and 0.0005 on 1 |
| `displayMaxLeverage` | 50 on 77, 25 on 8, 100 on 2, 5 on 1 |

The 50 rows that are not trading include `TON`, `1000SHIB`, `MKR`, `FTM`, `ETC`, `TRUMP` and `MELANIA`.
The 40 trading `stockContract` rows are 29 stocks, 6 commodities, 4 indexes or ETFs and one row with no category, such as `AAPLUSDT`, `SPYUSDT`, `XAUUSDT`, `CLUSDT`, `SPCXUSDT` (SpaceX), `CXMTUSDT`, `UNITREEUSDT` and `OURAUSDT`, and none shares a base with a crypto perpetual.

### How CCXT 4.5.68 maps it

| item | value | evidence in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/apex.js` |
|---|---|---|
| call | `v3/symbols`, then `contractConfig.perpetualContract` only | lines 584 to 588 and 643 |
| `market.id` | `symbol`, as `BTC-USDT` | line 646 |
| `market.id2` | `crossSymbolName`, as `BTCUSDT`, which ticker, depth, klines, trades and the socket use | lines 647, 780, 824, 878, 936 and 1019, and `pro/apex.js` line 232 |
| funding history symbol | `market.id`, as `BTC-USDT` | line 1080 |
| `base`, `quote`, `settle` | `baseTokenId`, and `settleAssetId` for both quote and settle | lines 649 to 653 |
| `quoteId` | `l2PairId`, a number such as `50001` | line 648 |
| `active` | `enableTrade` | line 674 |
| `linear` | the literal `true` | line 676 |
| `contractSize` | `minOrderSize` | line 680 |
| `taker`, `maker` | `0.0002` and `0.0005`, swapped, see [`fees.md`](./fees.md) section 8 | lines 656 and 657 |
| `commonCurrencies` | empty | line 235 |
| pacing | `rateLimit` 20 ms, commented as 600 requests a minute | line 25 |

Probed through the connector's filter of type swap, `swap` true and `active` not false, P1 and P2 `ccxt`:

| result | value |
|---|---|
| markets | 138, every one a swap |
| active swaps | 88, all linear, quoted and settled in USDT |
| `market.id` equal to `info.symbol` | 88 of 88 |
| `market.id2` equal to `info.crossSymbolName` | 88 of 88 |
| `contractSize` | equal to `minOrderSize` on 88 of 88: 1 on 47, 0.1 on 25, 0.01 on 6, 0.001 on 4, 10 on 3 and 100 on 3 |
| pairs listed twice | 0 |
| `loadMarkets` | 661 ms |

### What the catalog needs changed

- `rawMarketId` must be `crossSymbolName`, CCXT's `id2`, because the socket, `/v3/ticker`, `/v3/depth` and the bulk ticker all key by `BTCUSDT`.
  CCXT's dashed `market.id` gets `error:handler not found` on the socket, as `ETH-USDT` did in [`websocket.md`](./websocket.md) section 3, and an empty `data` from the ticker, as `BTC-USDT` did in section 6.
- The contract size must be 1, not CCXT's `minOrderSize`.
  Book sizes are base coins: `BTCUSDT`'s 24 h `turnover24h` over `volume24h` gave 83,262 against a last price of 82,572, and its top bid of `["82565.6","4.689"]` is 4.689 BTC, P1 `book`.
  On `1000PEPEUSDT` the sizes are multiples of the `stepSize` of 100 in `1000PEPE` units.
  CCXT's size would shrink every `BTCUSDT` level a thousandfold and grow every `1000PEPEUSDT` level a hundredfold, and 41 of the 88 markets have a `minOrderSize` other than 1.
- `IO-USDT` and `STBL-USDT` are trading in the catalog and in CCXT, but they never send a book, their REST books are empty, and their marks equal their indexes.
  A loader that keeps CCXT parity keeps them and records them as never booking, or it drops rows with `enableDisplay` false and records the difference from the CCXT dump.
- `1000PEPE` and `1000BONK` are priced per 1,000 tokens, and `1000PEPEUSDT` read 0.0039946.
  CCXT keeps the `1000` in the base, so they cluster only with other venues' `1000PEPE` and `1000BONK` markets, and the identity check of decision 15 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) confirms whether a price scale is needed.
- The 40 trading `stockContract` rows are outside CCXT, which reads only `perpetualContract`.
  They share the socket, where `AAPLUSDT` booked, and both anchor sources, take Chainlink prices, and pay no funding during closures, S5.
  S5 says most pairs trade 24/5 and selected pairs 24/7, while the catalog's `tag` read `7x24h` or `7*24` on 23 of the 40 when checked on 2026-10-12.
  Decision 4 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) keeps TradFi perpetuals that trade, while decision 7 makes the CCXT dump the parity target, so the plan has to record which one wins here.

## 3. Anchor

### The bulk calls

| source | index | mark | funding rate | interval | next settlement | size and cadence |
|---|---|---|---|---|---|---|
| REST `GET /v3/data/all-ticker-info`, not in S1 but used by CCXT at `apex.js` line 800 | `indexPrice` | `markPrice` | `fundingRate` | absent | `nextFundingTime`, an ISO string such as `2026-10-12T23:00:00Z` | 361 rows, 161 KB, origin 8.5 s, mostly served from the CDN cache |
| REST `GET /v3/ticker?symbol=BTCUSDT`, S1 | `indexPrice` | `markPrice` | `fundingRate` | absent | `nextFundingTime` | one market a call |
| socket `instrumentInfo.all`, S1 | `xp` | `mp` | `fr` | absent | absent | 369 rows, 68.9 KB, a whole snapshot every 2.0 s, age at arrival p50 131 ms in P1 and 123 ms in P2 |
| socket `instrumentInfo.H.<symbol>`, S1 | `indexPrice` | `markPrice` | `fundingRate` | absent | `nextFundingTime` | a delta names only the keys that changed |

The REST bulk call is unfit for the anchor.
In P1, 27 of 30 polls a second apart were cached copies, 3 went to the origin and took 8,473 to 8,550 ms, and 24 of 29 consecutive replies were identical, so the 88 rows changed 5 times over the 43 s the polls took.
The `BTCUSDT` row stayed the same for 5.1, 5.0, 13.5 and 17.5 s between its changes.
P2 repeated it: 25 cached copies, 5 origin replies of 8,411 to 8,691 ms, and 24 of 29 consecutive replies identical.
The origin's `timeCost` of about 8.2 s means even a fresh copy may hold prices read up to that long before it left.
The per-market socket channel is unfit too, because a delta names only the keys that changed, S1, so an unchanged mark is never resent and `SocketAnchors` would see it age past 10 s on a quiet market.
`instrumentInfo.all` resends every row every 2 s, so it is the anchor source, see section 8.

On the 88 trading perpetuals every row was present in both sources, with no empty or zero mark, index or funding rate, P1 REST and P2 socket.
`oraclePrice` was the empty string on 88 of 88 REST rows, and the socket carries no oracle field.
`nextFundingTime` named the next whole hour on 88 of 88 REST rows.

### Row mapping from `instrumentInfo.all`

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `s` | `BTCUSDT`, the `crossSymbolName` | as is |
| `index` | `xp` | decimal string | parse |
| `mark` | `mp` | decimal string, never 0 or empty on a trading perpetual | parse |
| `fundingRate` | `fr` | a fraction per hour, `"0.0000125"` is 0.00125 % | parse |
| `fundingIntervalHours` | none | the constant 1, S1 and S4 | 1 |
| `nextFundingAt` | none on this channel | the next whole UTC hour after the arrival stamp | `(floor(ts / 3_600_000) + 1) * 3_600_000` |

The floor-plus-one form matches the REST `nextFundingTime` of the same rows, and settlements land exactly on the hour, section 4.

## 4. Anchor semantics

### Index

S3 is the formula of record.

> The Index Price is a weighted average of the underlying asset's spot prices drawn from multiple exchanges (e.g. Binance, Bybit, Coinbase, Kraken).

The per-asset basket and its weights are Not publicly specified, and no public call returns them.
TradFi perpetuals are priced by "Chainlink's decentralised TradFi oracle feeds", S5.
The index of a crypto perpetual is a spot basket, so it does not contain ApeX's own perpetual.
Whether any asset's basket has only one source could not be checked.

### Mark

S3 is the formula of record.

```text
Mark Price = Median(Price 1, Price 2, Last Price)
Price 1    = Index Price x [1 + Last Funding Rate x (Time Until Next Funding / 8)]
Price 2    = Index Price + 5-Minute Moving Average Basis
5-Min MA Basis = MA[(Bid1 + Ask1) / 2 - Index Price], updated every second over a rolling 5 minutes
```

No clamp on the mark is published.
`Price 1` sits within a few ppm of the index while the hourly rate is near 0.0000125, so the mark equals the index whenever the 5-minute basis and the last trade lie on opposite sides of it.

| check | P1, REST | P2, REST | P2, socket |
|---|---|---|---|
| mark equal to index on the same row | 32 of 88 | 35 of 88 | 26 of 88 |
| mark against index, p50 | 254 ppm | 283 ppm | 510 ppm |
| mark against index, p90 | 1,546 ppm | 1,686 ppm | 1,543 ppm |
| widest | 14,731 ppm | 14,718 ppm, `APEXUSDT` | 14,706 ppm, `APEXUSDT` at mark 0.2415 against index 0.238 |
| mark equal to index on `IOUSDT` and `STBLUSDT` | yes | yes | yes |

A mark that equals its index carries no premium, so on those rows the anchor cannot show a standing gap between ApeX's book and its index.
That is close to the capped mark that section "Anchor" of [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) warns about, here caused by the median rather than by a clamp.

### Funding

S4 is the formula of record, and [`fees.md`](./fees.md) section 6 treats funding as a cost.

```text
F = P + clamp(I - P, +0.05%, -0.05%)
I = (USDT Interest - Underlying Asset Interest) / 24
P = [Max(0, Impact Bid Price - Index Price) - Max(0, Index Price - Impact Ask Price)] / Index Price + Funding Rate of Current Interval
```

`P` and `I` are "updated every minute", averaged over a one hour TWAP, and settled "every hour, on the hour (UTC)", S4.
The catalog's `fundingImpactMarginNotional` sets the impact depth per contract, from 6 to 10,000,000, P1.
The documented cap is ±0.05 % an hour, S4, while the catalog's `fundingMaxRate` ranges from 0.0305 % to 2 % per contract, section 2.

| check | P1 and P2 |
|---|---|
| settled rows on `BTC-USDT`, `ETH-USDT`, `TRX-USDT` and `DOGE-USDT` over 24 h | 24 each, 1 h apart, stamped exactly on the hour |
| largest settled rate over those 24 h | 0.00002489 on `BTC-USDT` |
| settled rows at the contract's `fundingMaxRate` | 0 |
| live `fundingRate` at the interest term `0.0000125` | 69 of 88 in P1 REST, 70 in P2 REST and 71 in P2 socket |
| live `fundingRate` changes | at most 1 per market, over 43 s of P1 REST polls and over 40 s of P2 socket snapshots |
| `TRXUSDT` live `fundingRate` | `-0.00002977` at 22:29 UTC and `-0.00001987` at 22:38 UTC, while the 22:00 settlement had charged `-0.00002149` |
| `predictedFundingRate` | `0.0000125` on 88 of 88 in P2 REST, and it never changed over the polls of P1 and P2 |

The live `fundingRate` moves within the hour and differs from the last settled rate, so it is the running estimate for the coming settlement.
`predictedFundingRate` is the interest term on every row, so it carries nothing and is not used.
Whether the last estimate before the hour equals the rate charged was Not verified, because this research does not wait for a settlement.
The `price` column of `/v3/history-funding` is not defined by S1 beyond "Price".

### How often each number changed

| source | window | index changes per market | mark changes per market |
|---|---|---|---|
| socket `instrumentInfo.all`, P2 | 21 snapshots, 20 transitions over 40 s | p50 3, p90 14, max 18, and 22 of 88 never changed | p50 4, p90 15, max 20, and 14 of 88 never changed |
| socket `instrumentInfo.all`, P1, `BTCUSDT` | 21 snapshots | 20 distinct values | 18 distinct values |
| socket `instrumentInfo.H.BTCUSDT`, P1 | 202 frames over 40 s | 99 frames carried `indexPrice`, 73 distinct | 43 frames carried `markPrice`, 40 distinct |
| REST bulk, P1 | 30 polls over 43 s | p50 2, max 5 | p50 2, max 5 |

So on `BTCUSDT` the index moved about twice a second and the mark about once, and `instrumentInfo.all` samples both every 2 s.
In P2 29 of 3,520 two-second steps of an index or a mark moved more than 1,000 ppm, the open guard at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) line 6.

## 5. REST book snapshot

`GET /v3/depth?symbol=<crossSymbolName>&limit=<n>`, S1.

| item | documented, S1 | probed, P1 and P2 |
|---|---|---|
| default depth | "Default at 100" | 25 levels per side |
| `limit` | not bounded in S1 | 25, 100 and 200 honoured, and 500 and 1,000 capped at 200 |
| order | | bids descending and asks ascending, best first, unlike the socket snapshot |
| level | `[price, size]` strings | as documented |
| sequence | `u` | the `u` of the socket's `orderBook200` stream, see [`websocket.md`](./websocket.md) section 4 |
| caching | | two `ETHUSDT` reads about 540 ms apart returned one `u` twice, 11,787,671 in P1 and 11,792,176 in P2, while a rerun 729 ms apart returned 11,787,994 then 11,788,002. The socket's 200 stream moves `ETHUSDT` about every 100 ms, so a repeated `u` most likely means the edge cache served the second read |
| dead markets | | `IOUSDT` and `STBLUSDT` returned `{"a":null,"b":null,"s":"","u":0}` |
| TradFi | | `AAPLUSDT` returned 25 and 25 levels in sizes that are multiples of its `stepSize` |
| unknown or dashed symbol | | HTTP 200 with `{"a":null,"b":null,"s":"","u":0}` |

A feed does not need the REST book, because the socket sends a snapshot on subscribe.

## 6. Rate limits and errors

| item | documented, S1 | probed |
|---|---|---|
| budget | "Limit 600 requests per 60 secs", per IP | not approached, at most about 40 requests in any minute |
| status at the limit | "If you receive a HTTP 403 (Access Denied) response, your IP has been either temporarily or permanently banned" | not reached |
| `Retry-After` | Not publicly specified | absent on every reply |
| limit headers | Not publicly specified | none on `/v3/time` |
| CCXT | `httpExceptions` maps 403 to `RateLimitExceeded` | `apex.js` lines 201 to 203 |

| request | status | body |
|---|---:|---|
| `/v3/ticker?symbol=NOPEUSDT`, `BTC-USDT`, `btcusdt` or no symbol | 200 | `{"data":[],"timeCost":…}` |
| `/v3/depth` with an unknown, dashed or missing symbol, or `limit=abc` | 200 | `{"data":{"a":null,"b":null,"s":"","u":0},…}` |
| `/v3/history-funding?symbol=NOPE-USDT` or `BTCUSDT` | 200 | `{"code":3,"msg":"invalid symbol: …",…}` |
| `/v3/nope`, `/v3/data/nope`, `POST /v3/symbols` | 404 | `{"code": 404, "msg": "Page Not Found", "data": ""}` |
| `/v2/symbols` | 200 | the configuration of the discontinued ApeX Pro, with StarkEx asset ids |

Every symbol error is an HTTP 200, so a poller must treat an empty `data` as a failed read.
The poller pauses on 403, 418 and 429 at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 21, which covers the documented 403.

## 7. Server time and clock offset

`GET /v3/time` returns `{"data":{"time":1791843337913},"timeCost":1}` in Unix ms, while S1's example shows seconds.
Five of ten replies in P1 and six of ten in P2 carried the cache marker.

| reply | round trip | local time minus server time |
|---|---|---|
| origin, best round trip, P1 | 281.5 ms | between -138.0 and +143.5 ms |
| cached, P1, five replies | 41 to 46 ms | 464 to 809 ms, so the cached value was that old |
| cached, P2, six replies | 40 to 124 ms | 383 to 780 ms |
| fastest reply without the marker, P2 | 73.2 ms | between +79.7 and +152.9 ms |

The P1 origin read bounds the offset within about ±140 ms.
A 73 ms round trip is too short for the Singapore path of section 1, so the P2 read was most likely a cached copy that carried no marker, about 80 to 153 ms old.
A cached time reply is up to about a second old, so the time call cannot measure the offset without the cache marker of section 1.

## 8. Recommended poller shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| source | the socket channel `instrumentInfo.all`, subscribed on the book socket and read into `SocketAnchors` at [`socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs), as decision 13 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) describes | a whole snapshot every 2 s at about 125 ms of age, against a REST bulk call that is cached and 8.2 s slow at the origin |
| writes | for each row of a tracked market, `set_index(xp)`, `set_mark(mp)` and `set_funding(fr, 1.0, next whole hour)` at the frame's arrival | every row is resent every 2 s, so each row's stamp stays fresh |
| `publishes_mark` | true | `mp` is present and non-zero on every trading perpetual |
| skip | rows of symbols outside the loaded catalog, which are the prediction contracts, the stock contracts unless loaded, and the perpetuals that are not trading | `.all` carries 369 rows |
| `poll_every` | 1 s, the default | `fetch_round` returns the latest rows, and a row is at most one 2 s push old |
| interval and next funding | 1 h, and the next whole UTC hour | settlements land exactly on the hour, and the channel carries neither |
| REST fallback | none | `all-ticker-info` kept one `BTCUSDT` row for up to 17.5 s in P1 |
| rate limit | nothing to pace | the anchor costs no REST request |
| flag | `IOUSDT` and `STBLUSDT` | their mark equals their index and they have no book |

## 9. Decentralised layer

### Chain and sequencer

ApeX Omni is "Powered by zkLink X technology (a high-performance ZK-rollup infrastructure for multi-chain aggregation)", S6.
Deposits and withdrawals run on Ethereum, BNB Chain, Base, Mantle and Arbitrum, S1, through zkLink contracts that S7 lists per chain, and S7 describes a forced exit from the rollup to those chains.
Orders carry two signatures, an API key HMAC and a zkLink payload signature that proves "the user approved the exact trading parameters under L2 rules", S1.
The book and the matching are served by the operator's API behind the CDN of section 1, and no public call exposes a block, a batch number or a chain timestamp.
So every time a feed sees is the operator's clock: `ts` in microseconds on the socket and `time` in ms on REST, which agree with this host within about 140 ms, section 7.

### Who may use it, and from where

The Terms of APEX DAO Inc., "Last updated: 27 July 2026", bar persons who reside in, are located in or are controlled from the United States, sanctioned territories and sanctioned persons, and forbid a VPN used to get around that, S8.
Canada is not named.
Accounts are wallets, with no KYC step in the API flow, S1.
From the Canadian exit of this host every public REST call and socket answered with no refusal, P1 and P2.
The Terms also say ADI does not operate any website interface, and the operator of `omni.apex.exchange` is not named, see [`fees.md`](./fees.md) section 1.

### Oracle

The crypto index is a weighted average of spot prices from several exchanges, "e.g. Binance, Bybit, Coinbase, Kraken", S3, with no published basket.
TradFi perpetuals take Chainlink's TradFi feeds, S5.
The mark is ApeX's own median of section 4, built from its index, its own book's mid and its last trade, with no external perpetual price in it.
The REST field `oraclePrice` exists and is empty on every trading perpetual, P1.

### Who lists a market

The operator lists and delists every market, through a phased process that it announces, S9.
No permissionless listing is documented, and every row of `/v3/symbols` belongs to one operator-curated list.
So no third party can list a ticker here, but the operator's own names still need the identity check of decision 15 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md).
The check should look hardest at short or generic names such as `GRAM`, `MEGA`, `CASHCAT`, `CHIP`, `PONS`, `EDGE` and `MET`, and at the stock rows `SPCX`, `CXMT`, `UNITREE` and `OURA` if they are ever loaded.

### Routing

ApeX's prediction markets are "spot markets powered by integrations like Polymarket", S6, and they are outside this research.
The perpetual books are ApeX's own, and no venue of [`2026-09-22-venue-survey.md`](../../research/2026-09-22-venue-survey.md) names ApeX as a route.
YUBIT's web socket speaks the same protocol, with the `realtime_public?v=2` path, `op` frames, a server ping every 15 s and snapshot bids worst first, see [`../yubit/websocket.md`](../yubit/websocket.md).
ApeX's books, `u` values and symbols are its own, so that is a shared protocol and not a shared book.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ApeX Omni API v3 docs | https://api-docs.omni.apex.exchange/ | 2026-10-12 | ApeX API docs | base URL, public calls, rate limit, signatures, chains, sections 1 to 7 and 9 |
| S2 | ApeX Omni API v3 docs, "GET All Config Data" | https://api-docs.omni.apex.exchange/#publicapi-v3-for-omni-get-all-config-data-v3 | 2026-10-12 | ApeX API docs | the catalog, section 2 |
| S3 | Price Markers | https://apex-pro.gitbook.io/apex-pro/apex-omni/price-markers | 2026-10-12 | ApeX docs | index and mark formulas, sections 4 and 9 |
| S4 | Trading & Funding Fees | https://apex-pro.gitbook.io/apex-pro/apex-omni/trading-and-funding-fees | 2026-10-12 | ApeX docs | funding formula, interval and cap, sections 3 and 4 |
| S5 | TradFi Perpetuals | https://apex-pro.gitbook.io/apex-pro/apex-omni/tradfi-perpetuals | 2026-10-12 | ApeX docs | Chainlink pricing and market hours, sections 2, 4 and 9 |
| S6 | What is ApeX Omni | https://apex-pro.gitbook.io/apex-pro/what-is-apex-omni | 2026-10-12 | ApeX docs | zkLink X, products, Polymarket integration, section 9 |
| S7 | Force Withdrawal | https://apex-pro.gitbook.io/apex-pro/apex-omni/force-withdrawal | 2026-10-12 | ApeX docs | zkLink contracts per chain, section 9 |
| S8 | Terms of Use | https://apex-pro.gitbook.io/apex-pro/about/terms-of-use | 2026-10-12 | APEX DAO Inc., Panama | who may use the software, section 9 |
| S9 | Delisting Mechanism | https://apex-pro.gitbook.io/apex-pro/apex-omni/margin-risk-management-and-liquidations/delisting-mechanism | 2026-10-12 | ApeX docs | operator-run listing and delisting, section 9 |
| S10 | CCXT 4.5.68 `apex.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/apex.js` | 2026-10-12 | CCXT | catalog mapping, fees, pacing, sections 2, 3 and 6 |
| P1 | `rest-probe.py` modes `host` 22:26, `time` 22:28, `ccxt` and `catalog` 22:28, `anchor` 22:28 to 22:29, `funding` 22:29, `book` 22:30 and `errors` 22:30 UTC, with `curl` reads of each public call at 22:15 UTC and of the cache marker at 22:27 UTC | [`rest-probe.py`](../../../scripts/probes/venues/apex/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 8 |
| P2 | the same modes rerun in the second pass, 22:37 to 22:39 UTC | [`rest-probe.py`](../../../scripts/probes/venues/apex/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 8 |
