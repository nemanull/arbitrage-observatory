# PointPay REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:22 to 03:50 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public futures REST API of PointPay, whose 172 USDT perpetuals are all Bybit linear perpetuals.
Every claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/pointpay/rest-probe.mjs), and the capture is quoted beside the documented value.
The finding that shapes every section: the catalog, the book, the index, the mark and the funding rate PointPay publishes are Bybit's, served from caches that hold a value for about 4 s on the book, 6 s on `pair-data` and up to a minute on the bulk contracts reply.
PointPay has no CCXT class, see [`fees.md`](./fees.md) section 8.

## 1. Host and latency from this machine

| item | value |
|---|---|
| documented base URL | `https://api.pointpay.io`, S1 |
| resolved addresses | `104.20.40.21`, `172.66.171.190`, `2606:4700:10::6814:2815`, `2606:4700:10::ac42:abbe`, Cloudflare, identical for `api`, `exchange`, `back` and `ws-futures.pointpay.io`, in three runs |
| edge | `server: cloudflare`, `cf-ray` ending in `YVR` or `SEA` |
| new connection per call, `GET /fapi/v1/public/trade/pairs`, 16,688 bytes | TLS done in 29 to 56 ms, whole reply in 416 to 803 ms, median 760 ms, 10 calls at 03:45 UTC |
| kept-alive connection, same call | 357 to 487 ms with median 368, then 389 to 741 ms with median 418, then 306 to 431 ms with median 357, 10 calls per run |
| Bybit's own REST from the same host | 170 to 527 ms for the same book and ticker calls, P1 `mirror` |

The TLS handshake finishes within 56 ms, so the rest of each reply's time is spent behind Cloudflare.
Nothing refused this host: every documented call answered HTTP 200.

## 2. Catalog

### The instruments call

| call | reply | probed |
|---|---|---|
| `GET /fapi/v1/public/trade/pairs` | `{"notification":null,"warning":null,"variables":null,"status":"000000","response":[{"asset","quotable","pair","symbol","modificator"}],"errors":null}` | 172 rows, 16,688 bytes, every `quotable` `USDT`, `pair` spelled `BTCUSDT` on 172 of 172, `symbol` spelled `BTC_USDT` on 172 of 172, `modificator` `"1"` on 48 and `"1.000000"` on 124 |
| `GET /fapi/v1/public/trade/full-pair-data/{pair}` | one pair: `trade_data` with prices, funding and interval, `pair_data` with `contractType`, `status`, filters, `fundingInterval` in minutes, `upperFundingRate`, `lowerFundingRate` | 1,847 to 1,910 bytes, 750 to 896 ms per call |
| `GET /public/coingecko/futures/contracts` | every contract at once, CoinGecko derivatives shape | 172 rows, about 104 KB |
| `GET /public/cmc/futures/contracts` | every contract at once, CoinMarketCap shape | 172 rows, about 97 KB |

The pairs list has no status field.
Status lives in `full-pair-data`, `pair_data.status`, which read `Trading` on all five sampled pairs, and in Bybit's instruments call, which read `Trading` on all 172.

### Every pair is a Bybit linear perpetual

P1 `catalog` read Bybit's `GET /v5/market/instruments-info?category=linear` beside the PointPay pairs list, twice.

| check | result, both runs |
|---|---|
| PointPay pairs that are Bybit linear symbols | 172 of 172 |
| their Bybit status and type | `Trading` and `LinearPerpetual` on 172 |
| their Bybit `symbolType` | 57 plain crypto, 9 `innovation`, 89 `stock`, 13 `ETF`, 4 `commodity` |
| Bybit linear instruments in all, and trading USDT perpetuals | 885, and 777 |
| `full-pair-data` fields equal to Bybit's instrument on `BTCUSDT`, `ETHUSDT`, `1000BONKUSDT`, `AAPLUSDT`, `ZMUSDT` | `contractType`, `status`, `priceScale`, `fundingInterval`, `upperFundingRate`, `lowerFundingRate`, `launchTime`, `symbolType`, and the whole `lotSizeFilter` and `priceFilter`, on 5 of 5 |

`full-pair-data` also carries Bybit-only fields such as `unifiedMarginTrade`, `copyTrading`, `forbidUplWithdrawal` and `symbolId`, and a `launchTime` of `1584230400000`, March 2020, for `BTCUSDT`, six years before PointPay launched futures.
PointPay lists 172 of Bybit's 777 USDT perpetuals, and its blog of 15 September 2026 announced 100 or more stock, ETF and commodity additions, see [`fees.md`](./fees.md) section 1.

### How a catalog would map it

No CCXT class exists, so the engine's `loadMarkets` path at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) has nothing to load.
A catalog built by hand would map as follows.

| engine field | PointPay source | value |
|---|---|---|
| `rawMarketId` | `pair` | `BTCUSDT`, equal to the socket topic symbol and to Bybit's symbol. The `symbol` field `BTC_USDT` and the CoinGecko `ticker_id` `BTC-USDT` are other spellings |
| `base`, `quote` | `asset`, `quotable` | `BTC`, `USDT` |
| `linear` | `pair_data.contractType` | `LinearPerpetual` on every sampled pair |
| `contractSize` | none published | 1, since sizes are base coin: `qtyStep` `0.001` on `BTCUSDT`, `100` on `1000BONKUSDT`. CCXT's `bybit` class sets 1 on every linear market at `server/node_modules/ccxt/js/src/bybit.js` line 2199 |
| `active` | `pair_data.status` | `Trading` |
| pair listed twice | none | 172 distinct pairs, one family |
| price scale | none of its own | every symbol and base is spelled as on Bybit, `1000BONKUSDT` with base `1000BONK` included, so no entry in [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts) would differ from Bybit's |

What `modificator` means is Not publicly specified, and it was 1 on every pair.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time over 60 polls |
|---|---|---|---|---|---|---|---|
| `GET /public/coingecko/futures/contracts` | `index_price` | absent | `funding_rate`, and `next_funding_rate` equal to it | absent | `next_funding_rate_timestamp`, Unix ms | 103,976 to 104,018 bytes, 172 rows | median 508 and 503 ms, max 1,549 and 884 ms, 1 poll over 1 s in the first run |
| `GET /public/cmc/futures/contracts` | `index_price` | absent | `funding_rate` | absent | `next_funding_rate_timestamp` | about 97 KB, 172 rows | 453 to 1,244 ms, single calls |
| `GET /fapi/v1/public/trade/pair-data/{pair}` | `indexPrice` | `markPrice` | `fundingRate` | absent | `nextFundingTime`, Unix ms as a string | 472 bytes, one pair | median 362 and 373 ms, max 978 and 722 ms |
| `GET /fapi/v1/public/trade/full-pair-data/{pair}` | `indexPrice` | `markPrice` | `fundingRate` | `fundingIntervalHour` | `nextFundingTime` | 1,847 to 1,910 bytes, one pair | 750 to 896 ms, single calls |

No call returns a mark for every contract at once.
The mark exists only per pair, and 172 pair calls a second is 10,320 a minute against the 500 a minute that the rate limit headers announce, section 6.

### Row mapping

If a poller were built, it would read the bulk CoinGecko reply and could not fill the mark.

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `base_currency` + `target_currency` | `BTC` and `USDT`, since `ticker_id` is `BTC-USDT` | concatenate |
| `index` | `index_price` | decimal string | `Number()` |
| `mark` | none in any bulk reply | | 0, which the engine refuses at open |
| `fundingRate` | `funding_rate` | decimal string, a fraction per interval | `Number()` |
| `fundingIntervalHours` | none in the bulk reply. `fundingIntervalHour` per pair in `full-pair-data` | string hours, `"8"` or `"4"` | `Number()`, read once per pair |
| `nextFundingAt` | `next_funding_rate_timestamp` | integer Unix ms | none |

### Volume and open interest are Bybit's divided by 100

The REST replies report Bybit's 24 hour volume, turnover and open interest divided by 100.
In P3 `mirror`, Bybit's `openInterest`, `volume24h` and `turnover24h` divided by the same fields of `full-pair-data` gave 99.93 to 100.06 on 20 of 20 paired reads, where the two reads were up to a few seconds apart.
The same ratio for `volume24h` and `turnover24h` against `pair-data` was 100.00 to 100.07 on 40 of 40 paired reads in P1 and P2 `mirror`.
`singleOpenInterest` was not divided, its ratio was 1.000 to 1.001, and `prevPrice24h`, `highPrice24h`, `lowPrice24h` and `prevPrice1h` were equal on every fresh read.
The `BTCUSDT` reply kept by P1 `catalog` shows the shape: `"openInterest":"603.88818000"` beside `"singleOpenInterest":"30194.409"`.
The ticker frames on PointPay's WebSocket carry Bybit's full numbers, see [`websocket.md`](./websocket.md) section 2.
The CoinGecko and CoinMarketCap replies carry the divided figures, so any volume a tracker shows for PointPay futures is one hundredth of Bybit's.

## 4. Anchor semantics

### Index

The documented index is "the averaged value of six of the most actively traded cryptocurrency spot pairs across major exchanges, weighted accordingly", with weights from each platform's 24 hour volume, "updated hourly", S2.
A component more than 5 % from the median of all sources is excluded and its weight smoothed away, and for some pairs, BTC and ETH among them, the threshold is 1 %, S2.
A component returns only when it includes at least one of Binance, OKX, Bybit or Coinbase, or at least two of Bitget, Gate or MEXC, S2.
PointPay publishes no basket call.
PointPay answered three guessed paths for a basket or a funding history, such as `/fapi/v1/public/trade/index-components/BTCUSDT`, with its HTTP 200 and body status 404 shape, P3 `reference`.
Bybit's `GET /v5/market/index-price-components?indexName=BTCUSDT` returned six components at 03:50 UTC: Binance 0.4657, Gate 0.1753, Bybit's own spot 0.1529, OKX 0.134, KuCoin 0.0707 and Coinbase 0.0014, P3 `reference`.
A basket that holds the venue's own spot is not the self-referential shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), which is a basket holding the venue's own perpetual, and no PointPay basket was checked for that shape because the baskets are Bybit's.

The published index is Bybit's index, read from a cache.
In the three `mirror` runs the PointPay `indexPrice` equalled Bybit's ticker string on 9, 12 and 5 of 20 paired reads, and differed by up to 2,258, 438 and 2,706 ppm on the rest.
In the two `anchor` runs the CoinGecko `index_price` equalled Bybit's string on 120 and 45 of 172 rows and lay within 1,000 ppm of it on 172 and 146.
Every difference is consistent with the cache age measured below.

### Mark

The Knowledge Base gives two methods, S3.
For contracts listed after 14 November 2025 and ten named ones: "Mark Price = Price₃ × C + Index Price × (1 − C)", where C is "limited within the range from 0.1 to 0.9".
For the rest: "Mark Price = Median (P1, P2, Last Traded Price)", with "P1 = Index Price × [1 + Current Funding Rate × (Remaining Time Until Next Funding / 8)]" and "P2 = Index Price + 2.5-minute moving average" of the mid minus the index.
If the index cannot be obtained, "the exchange switches to using the last confirmed price of its own platform", S3.
The published `markPrice` equalled Bybit's ticker string on 12, 13 and 4 of 20 paired reads in the three `mirror` runs, and differed by up to 1,748, 919 and 2,813 ppm on the rest, which is the cache again.
Whatever clamps apply are Bybit's.

### Funding

The formula, the interest rate of 0.01 % per 8 h, and the per contract cap are in [`fees.md`](./fees.md) section 6.
The CoinGecko `funding_rate` equalled Bybit's ticker `fundingRate` on 172 of 172 rows in the first `anchor` run and 137 of 172 in the second, and `next_funding_rate_timestamp` equalled Bybit's `nextFundingTime` on 172 of 172 in both.
The per pair `fundingRate` equalled Bybit's on 20, 19 and 18 of 20 reads in the three `mirror` runs.
So the published rate is the `fundingRate` of Bybit's tickers call, the same field the engine's Bybit poller already reads as `fundingRate` at [`anchor.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/bybit/anchor.ts) line 67, with Bybit's semantics.
The settlement instant was not captured.

### How often each number changed

| call | polls over 60 s | what changed | when |
|---|---|---|---|
| CoinGecko contracts | 60 and 60 | `index_price` of `BTC-USDT`, `ETH-USDT`, `ALGO-USDT` and `1000BONK-USDT` changed 2 times in the first run and once in the second | the one change of the second run came 28.9 s into the minute |
| `pair-data/BTCUSDT` | 60 and 60 | `markPrice` and `indexPrice` changed 9 and 10 times | at 2.6, 8.6, 14.6, 20.6, 26.6, 32.6, 38.6, 44.6, 50.5 and 56.6 s in the second run, one step every 5.94 to 6.10 s |
| `full-pair-data` on four pairs | 5 rounds over about 20 s, P3 `mirror` | nothing: `markPrice` and `indexPrice` stayed at their first value on all four pairs, while Bybit's moved in 16 of 16 later reads | |
| Bybit's `tickers.BTCUSDT` over its socket, for reference | | 373 and 444 frames a minute | continuous |

So `pair-data` is served from a cache refreshed about every 6 s, `full-pair-data` from one held at least 20 s, and the CoinGecko reply from one refreshed about every 30 to 60 s.
The engine stamps a reading on arrival at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts), so a 6 s or 60 s old number would read as fresh, and the 10 s age limit at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 5 would never see its age.

## 5. REST book snapshot

| call | depth | probed |
|---|---|---|
| `GET /fapi/v1/public/trade/order-book/{pair}` | always 200 per side, `limit=50` is ignored | bids descending and asks ascending on 40 of 40 reads. `btcusdt` in lower case works, `BTC_USDT` returns `"response":[]` |
| `GET /public/coingecko/futures/orderbook?ticker_id=BTCUSDT&depth=100` | documented "`depth = 100` means 50 levels on each bid/ask side", S1 | 100 per side. `depth=0`, documented as full depth, returned 1 per side. `ticker_id=BTC-USDT` also works |
| `GET /public/cmc/futures/orderbook/BTC-USDT` | | 200 per side |

The `order-book` reply carries Bybit's `u`, `seq`, `ts` and `cts`, and its levels are Bybit's.
Read beside Bybit's `GET /v5/market/orderbook?category=linear&limit=200` on four pairs in five rounds, three times:

| reads | PointPay `u` against Bybit's | PointPay `cts` against Bybit's |
|---|---|---|
| 12 of 20, in each run | 1 to 5 updates ahead | 117 to 1,000 ms later, because PointPay answered after Bybit |
| 8 of 20, in each run | 13 to 24 updates behind | 3,083 to 4,802 ms older |

Five book reads 0.9 s apart in each latency run carried the same `ts` for 3.5 to 3.9 s, and 20 back to back reads in `limits` saw 2 distinct `u` values in each run.
So the REST book is Bybit's book from a cache about 4 to 5 s deep, and a read is fresh or up to 4.8 s old depending on where it lands.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limit | Not publicly specified in S1 | every reply carries `x-ratelimit-limit: 500` and `x-ratelimit-reset` counting down from 60, so 500 per 60 s |
| scope | | per endpoint: the order book burst read `x-ratelimit-remaining` 486 to 495 while the next call to another endpoint read 499 |
| counter | | `remaining` did not fall monotonically over 20 back to back calls, `490,487,489,487,490,…`, which reads as several counters behind the edge |
| 429, `Retry-After` | Not publicly specified | not reached, and no `Retry-After` header was seen |
| unknown pair | | HTTP 200 with `"status":"000000","response":[]` on `pair-data` and `order-book`, and `"response":{"trade_data":null,"pair_data":null}` on `full-pair-data` |
| unknown path | 404 JSON `{"timestamp", "status": 404, "error": "Not Found", "message": "", "path"}`, S1 | HTTP 200 with `{"response":null,"status":404,"errors":{"message":[""]},…}` |
| wrong method | | HTTP 404 `{"status":"error","message":"Cannot POST /fapi/v1/public/trade/pairs","result":null}` |
| invalid request | 400 as an nginx HTML page, S1 | not triggered |

A poller cannot rely on the HTTP status for an unknown pair or a bad path, since both answer 200.

## 7. Server time and clock offset

The futures REST API documents no time call.
The spot WebSocket's `server.time` returns Unix seconds, `{"id":2,"params":[],"result":1790134831,"error":null}`, see [`websocket.md`](./websocket.md) section 6.
The `Date` header minus the midpoint of each request ranged from −771 to +171 ms over 15 book reads in three runs, which is inside its one second resolution.
The first `ts` of each latency run, the only reads certain to be fresh, sat +92, −43 and +26 ms from the request midpoint, with round trips of 601, 614 and 681 ms, so this host's clock agrees with Bybit's to within that.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
The recommendation is not to build a PointPay poller.

| item | recommendation | reason |
|---|---|---|
| anchor source | Bybit's own bulk tickers call, which the engine already polls at [`anchor.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/bybit/anchor.ts) line 6 | every PointPay anchor number is Bybit's, and Bybit's call is fresh |
| if a PointPay poller were built | `GET /public/coingecko/futures/contracts` every 2 s, key `base_currency` + `target_currency` | the only call with all 172 rows |
| its gaps | no mark, so the engine would refuse every route at open. No interval, so it would need `full-pair-data` once per pair. A cache of 30 to 60 s that the arrival stamp hides | sections 3 and 4 |
| per pair mark | not viable | 172 `pair-data` calls a second is about 20 times the 500 per 60 s limit, and each reply is up to 6 s old |
| rate limit pause | 60,000 ms | the window is 60 s and no `Retry-After` is sent |
| skip | none needed, all 172 pairs were `Trading` | |

The engine would gain nothing from a PointPay leg.
Its book is Bybit's book about 70 to 80 ms later, its anchors are Bybit's anchors up to a minute late, and its taker is 850 ppm against Bybit's 550, see [`fees.md`](./fees.md) section 2.
A PointPay against Bybit route would compare a book with itself.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Knowledge Base, "Futures public endpoints", "CG-public-futures-endpoints" and "CMC-public-futures-endpoints", with their sub pages | https://pointpay.gitbook.io/base/documentation/developers/exchange-api-documentation/futures-public-endpoints | 2026-09-22 | PointPay, global | base URL, call paths and fields, documented errors and depth, sections 1 to 6 |
| S2 | Knowledge Base, Index Price | https://pointpay.gitbook.io/base/documentation/ecosystem/futures/index-price | 2026-09-22 | PointPay, global | index method, section 4 |
| S3 | Knowledge Base, Mark Price | https://pointpay.gitbook.io/base/documentation/ecosystem/futures/mark-price | 2026-09-22 | PointPay, global | mark methods and clamps, section 4 |
| S4 | Bybit `GET /v5/market/instruments-info`, `tickers`, `orderbook`, `index-price-components` and `funding/history` | https://api.bybit.com/v5/market/instruments-info?category=linear | 2026-09-23 | Bybit | the reference every PointPay number was compared with, sections 2 to 5 |
| S5 | CCXT 4.5.68 `bybit.js` | `server/node_modules/ccxt/js/src/bybit.js` | 2026-09-23 | CCXT | `contractSize` 1 on linear markets at line 2199, section 2 |
| P1 | `rest-probe.mjs` `latency`, `catalog`, `mirror`, `anchor` and `limits`, first run at 03:22 to 03:26 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pointpay/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | the same five modes, second run at 03:35 to 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pointpay/rest-probe.mjs) | 2026-09-23 UTC | this host | the second readings of sections 1 to 7 |
| P3 | `rest-probe.mjs latency` with a new connection per call at 03:45 UTC, `mirror` on `full-pair-data` at 03:47 UTC, and `reference` at 03:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pointpay/rest-probe.mjs) | 2026-09-23 UTC | this host | cold timings, the third warm, clock and book readings, open interest ratios, Bybit's basket and funding history, sections 1, 3, 4, 5 and 7 |
