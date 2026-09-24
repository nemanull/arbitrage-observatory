# Bithumb REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:13 to 03:30 UTC for run 1 and 03:35 to 03:38 UTC for run 2, from the development host near Seattle.

This profile covers the public REST API of Bithumb for its spot market, because Bithumb lists no perpetual, see [`fees.md`](./fees.md) section 3.
Numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bithumb/rest-probe.mjs) unless a row cites a document.
The documentation is the Korean API reference at `apidocs.bithumb.com`, whose pages each carry an OpenAPI block, read as Markdown by appending `.md` to the page URL, S1 to S7.
Bithumb publishes two REST families on one host: the current `/v1/...` calls and the older `/public/...` calls that CCXT still uses.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST host | `https://api.bithumb.com`, S1 |
| resolved addresses | eight A records on 2026-09-23: `3.38.20.176`, `3.39.105.195`, `54.116.100.224`, `13.124.161.220`, `43.200.65.20`, `52.79.44.237`, `3.37.10.22`, `13.125.108.218` |
| server header | `nginx` |
| first request of a process | 548 and 562 ms for `/v1/market/all` in `catalog`, which includes DNS and TLS |
| warm request, one market book | 19 polls at 1 s, run 1: min 176, median 179, p90 181, max 182 ms. Run 2: 172, 176, 208, 222 ms |
| warm request, 200 market ticker | run 1: min 184, median 187, p90 193, max 193 ms, 146,105 bytes. Run 2: 182, 185, 191, 195 ms |
| warm request, 200 market book | run 1: min 183, median 187, p90 193, max 202 ms, 262,924 bytes. Run 2: 181, 185, 189, 350 ms |
| warm request, legacy `ALL_KRW` book | run 1: min 181, median 185, p90 191, max 200 ms, 219,951 bytes. Run 2: 178, 181, 185, 186 ms |
| refusals | none. Every call answered from this host, and no geoblock or challenge page was seen |

A round trip of about 180 ms from Seattle is consistent with a server in Korea.
The WebSocket host is on Akamai instead, see [`websocket.md`](./websocket.md) section 1.

## 2. Catalog

### The instruments call

`GET /v1/market/all?isDetails=true`, S2, returned 493 rows in 45,835 bytes in both runs.

| quote | markets |
|---|---:|
| KRW | 480 |
| BTC | 13 |
| USDT, USDC | 0 |

Each row has only `market`, `korean_name`, `english_name` and, with `isDetails=true`, `market_warning`.
`market_warning` was `NONE` on 470 rows and `CAUTION` on 23, where `CAUTION` is "거래 유의", designated for caution, S2.
There is no status, tick, lot or minimum field, and no suspended or pre-listing state, so every listed row is a trading market.
The BTC quoted markets were `BTC-ETH`, `BTC-XRP`, `BTC-TRX`, `BTC-KAIA`, `BTC-DOGE`, `BTC-BNB`, `BTC-SOL`, `BTC-ENS`, `BTC-CSPR`, `BTC-AHT`, `BTC-SUI`, `BTC-WLD` and `BTC-USDC`.
Stablecoins trade only as a base: `KRW-USDT`, `KRW-USDC`, `KRW-USD1`, `KRW-USDE` and `BTC-USDC`.
The WebSocket ticker adds `market_state`, `is_trading_suspended` and `delisting_date` per market, see [`websocket.md`](./websocket.md) section 6.

The legacy `GET /public/ticker/ALL_KRW` and `ALL_BTC` list 480 and 13 markets as keys of a `data` object, plus a `date` key.

### How CCXT 4.5.68 maps it

| item | CCXT | wire | effect |
|---|---|---|---|
| markets | 493, all `spot`, all `active: true`, 0 swaps | 493 in `/v1/market/all` | CCXT and the wire list the same 493 pairs |
| source call | the legacy `GET /public/ticker/ALL_{quote}` for KRW and BTC, `server/node_modules/ccxt/js/src/bithumb.js` lines 298 to 307 | | a market with an empty array in that reply is marked inactive, lines 359 to 365 |
| `market.id` | the base alone, `BTC` for `BTC/KRW`, line 367 | the socket and `/v1` spell `KRW-BTC` | 13 ids are shared by a KRW and a BTC market, such as `ETH` for `ETH/BTC` and `ETH/KRW` |
| `contractSize` | undefined, line 385 | sizes are base coins | the engine's rule turns undefined into 1, which is right for spot |
| `linear` | undefined, line 383 | | |
| `taker`, `maker` | 0.0025 on every market, lines 166 and 167 | | see [`fees.md`](./fees.md) section 8 |
| renamed base | `ALT` becomes `ArchLoot`, line 274 | `KRW-ALT` | the only rename among the 493 |

The engine could not use this catalog as it stands.
Its connector keeps only active swaps, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196, and Bithumb has none, so the venue would load zero markets.
`rawMarketId` would also have to be `${quote}-${id}` rather than `market.id`, since `BTC` names two markets and matches neither the socket nor the REST symbol.

### The quote currency

Every liquid market quotes in KRW.
The engine clusters markets by base and quote family, where only USD and USDC fold into USDT, at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
KRW maps to itself, so a `BTC|KRW` cluster would hold Bithumb alone and could never pair with another venue.
Comparing a KRW book with a USDT perpetual needs a KRW to USDT conversion.
The only one on the venue is the `KRW-USDT` book, whose tick is 1 KRW at a price near 1,343 KRW, about 745 ppm per tick.
At 03:28 UTC, `KRW-BTC` and `KRW-ETH` divided by the `KRW-USDT` mid of 1,343.5 sat 142 ppm below and 238 ppm above the OKX `BTC-USDT` and `ETH-USDT` mids.
At 03:37 UTC in run 2, with a `KRW-USDT` mid of 1,342.5, both sat 550 and 476 ppm below.
So the implied gap moved by 408 and 714 ppm in nine minutes, each less than one `KRW-USDT` tick of about 745 ppm, and the conversion's own tick is as large as the gap it measures.
That conversion is context, and it does not make KRW part of the settlement family.

## 3. Anchor

Bithumb publishes no index price, no mark price and no funding rate, because it has no perpetual.
No `AnchorRow` column can be filled from any public call.
The nearest published reference to a global price is the alert list below, which is a flag and not a price.

| call | what it gives | reply in run 1 |
|---|---|---|
| `GET /v1/market/virtual_asset_warning`, S3 | per market alerts with `warning_type`, `warning_step` and `end_date` in Korean time | 69 rows in 180 ms, and 70 in 188 ms in run 2 |
| `GET /v1/market/all?isDetails=true`, S2 | `market_warning` `CAUTION` | 23 of 493 rows in both runs |

The alert types are `PRICE_SUDDEN_FLUCTUATION`, `PRICE_DIFFERENCE_HIGH` ("글로벌 시세 차이", a gap to the global price), `SPECIFIC_ACCOUNT_HIGH_TRANSACTION`, `TRADING_VOLUME_SUDDEN_FLUCTUATION` and `DEPOSIT_AMOUNT_SUDDEN_FLUCTUATION`, with steps `CAUTION`, `WARNING` and `DANGER`, S3.
Two markets carried `PRICE_DIFFERENCE_HIGH` in run 1, one at `WARNING` and one at `CAUTION`, and three in run 2, one at `WARNING` and two at `CAUTION`.
The threshold of the global price gap is Not publicly specified in S3.

## 4. Anchor semantics

There is no index, mark or funding formula, basket, clamp or settlement to record.
A future KRW leg would need its own reference, such as the `KRW-USDT` book of section 2, and that design is outside this survey.
The alert list of section 3 is a flag list, and its `end_date` is a Korean time about a day ahead, such as `2026-09-24 01:59:59` for `KRW-BCH` read at 03:13 UTC on 2026-09-23.

## 5. REST book snapshot

| call | levels | order | notes |
|---|---|---|---|
| `GET /v1/orderbook?markets=KRW-BTC`, S4 | 30 units for one market | bids descending, asks ascending, as index-paired units | sizes as JSON numbers in base coin, four decimals |
| `GET /v1/orderbook?markets=KRW-BTC,KRW-ETH,BTC-ETH` | 15 units per market when more than one market is asked | same | 200 markets in one call answered in a median 187 and 185 ms |
| `GET /public/orderbook/BTC_KRW?count=30` | 30 bids and 30 asks | bids descending | legacy, prices and sizes as strings |
| `GET /public/orderbook/ALL_KRW` | 5 per side by default, all 480 KRW markets | | legacy |

S4 documents the 30 and 15 level rule.
The unit shape is the socket's, see [`websocket.md`](./websocket.md) section 4.

A scan of all 493 markets at 15 levels in three calls of up to 200 found every market at 15 units.
Five markets padded the bid side in both runs with units of price 0 and size 0, such as `KRW-NFT` and `KRW-BTT`, and no market padded its asks or had an empty side.
Thirty-six unit sides in run 1 and 44 in run 2, each time on 34 markets, showed a size of 0 at a live price, which is a size that rounds below the fourth decimal.
A consumer must drop both kinds.

`timestamp` on the book is Unix ms.
Forty reads of `KRW-BTC` 250 ms apart returned 40 distinct timestamps in each run, and each reply's `timestamp` was 142 to 349 ms old on arrival in run 1 and 148 to 450 ms in run 2, so no response cache was visible at that spacing.

## 6. Rate limits and errors

The public limit is 150 requests a second per IP for each category, and the categories are candles, order book, ticker, trades and everything else, S5.
Every reply carries the limiter's state.

```text
x-ratelimit-remaining: 149
x-ratelimit-requested-tokens: 1
x-ratelimit-burst-capacity: 150
x-ratelimit-replenish-rate: 150
```

No limit was hit, so the status code and any `Retry-After` of a refusal were not observed.
S5 says only that the category is restricted for a while, and that traffic may be cut "별도 공지 없이", without notice.

| request | HTTP status | body |
|---|---|---|
| `/v1/orderbook?markets=KRW-NOPE` | 200 | `{"error":{"name":404,"message":"Code not found"}}` |
| `/v1/orderbook?markets=KRW-BTC,KRW-NOPE` | 200 | the same 404 error, so one bad code fails the whole call |
| `/v1/orderbook?markets=krw-btc` | 200 | the `KRW-BTC` book, so REST accepts lower case while the socket does not |
| `/v1/orderbook` | 200 | `{"error":{"name":400,"message":"Missing request parameter error. Check the required parameters!"}}` |
| `/v1/ticker?markets=KRW-NOPE` | 200 | `{"error":{"name":404,"message":"Code not found"}}` |
| `/v1/nope` | 404 | `{"name":"not_found","message":"No Route matched with those values"}` |
| `/public/orderbook/NOPE_KRW` | 200 | `{"status":"5500","message":"상장 코인 아님"}`, not a listed coin |
| `/public/ticker/ALL_USDT` | 200 | `{"status":"5500","message":"입력값을 확인해 주세요."}`, check the input |
| `/v1/ticker` with 400 markets, 3,456 query characters | 200 | 400 rows |
| `/v1/ticker` with all 493 markets, 4,264 query characters | 414 | empty body, in both runs |

An error in the `/v1` family is an HTTP 200 whose body is an `error` object, so a client must check the body and not only the status.
From 2026-10-13 17:00 KST, a ticker call with more than 200 `markets` will answer `400 Bad Request` with "Parameter 'markets' must be less than or equal to 200 items.", S6.

## 7. Server time and clock offset

There is no server time call.
The `Date` header has one second resolution.
Five reads put the server clock between 211 ms behind and 68 ms ahead of this host in run 1, and between 145 ms behind and 118 ms ahead in run 2, so together between 145 ms behind and 68 ms ahead.

The ticker's `timestamp` is 9 hours ahead of Unix time.
It read 32,396,529 to 32,399,324 ms ahead of the local clock in run 1 and 32,387,597 to 32,392,335 ms in run 2, against 32,400,000 ms in 9 hours, and a direct read at 03:28:53 UTC returned `1790166529623`, which is 12:28:49 when read as UTC.
It equalled `trade_timestamp`, the time of the last trade, on every read of run 2, while `trade_time` read `032849` in UTC and `trade_time_kst` read `122849` on the direct read.
The shortfall from a full 9 hours grew by about 1.2 s per read across the five reads of run 2, while `trade_time` stayed `033749`, so it is the age of that last trade.
So the ticker's `timestamp` and `trade_timestamp` are Korean wall time written as if it were Unix time, where S7 documents "Unix timestamp, Unit: ms".
The book's `timestamp` on REST and the socket's `timestamp` and `trade_timestamp` are true Unix time.

## 8. Recommended poller shape

No anchor poller is recommended.
Bithumb publishes no index, mark or funding, so there is nothing for `AnchorPoller` to read.
If a KRW leg were ever modelled, `GET /v1/orderbook?markets=KRW-USDT` once a second is the conversion a design would start from, and `GET /v1/market/virtual_asset_warning` is the list of markets to skip, both far inside the 150 a second limit.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | API 레퍼런스 (API reference overview) | https://apidocs.bithumb.com/reference/api-레퍼런스 | 2026-09-22 | Bithumb, Korea | REST host, section 1 |
| S2 | 거래 대상 목록 조회 (market list) | https://apidocs.bithumb.com/reference/거래-대상-목록-조회 | 2026-09-22 | Bithumb, Korea | `/v1/market/all`, `isDetails`, `market_warning`, sections 2 and 3 |
| S3 | 경보제 조회 (alert list) | https://apidocs.bithumb.com/reference/경보제-조회 | 2026-09-22 | Bithumb, Korea | alert types and steps, section 3 |
| S4 | 호가(Orderbook) 조회 (REST book) | https://apidocs.bithumb.com/reference/호가-조회 | 2026-09-22 | Bithumb, Korea | 30 levels for one market, 15 for several, section 5 |
| S5 | API 요청 수 제한 안내 (rate limits), updated 2026-08-26 | https://apidocs.bithumb.com/docs/api-요청-수-제한-안내 | 2026-09-22 | Bithumb, Korea | 150 a second per category per IP, section 6 |
| S6 | [사전 공지] 현재가 조회 markets 최대 개수 제한 (ticker markets cap) | https://apidocs.bithumb.com/changelog/사전-공지-현재가-조회-markets-최대-개수-제한 | 2026-09-22 | Bithumb, Korea | 200 market cap from 2026-10-13, section 6 |
| S7 | 현재가(Ticker) 조회 (REST ticker) | https://apidocs.bithumb.com/reference/현재가-조회 | 2026-09-22 | Bithumb, Korea | `timestamp` documented as Unix ms, `trade_time` as UTC, section 7 |
| S8 | CCXT 4.5.68 `bithumb.js` | `server/node_modules/ccxt/js/src/bithumb.js` | 2026-09-22 | CCXT | catalog mapping, section 2 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/bithumb/rest-probe.mjs) `catalog` and `timing`, run 1 at 03:13 and 03:14 UTC | local | 2026-09-23 UTC | this host | sections 1 to 3 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/bithumb/rest-probe.mjs) `book` and `errors`, run 1 at 03:17 to 03:28 UTC | local | 2026-09-23 UTC | this host | sections 2 and 5 to 7 |
| P3 | [`rest-probe.mjs`](../../../scripts/probes/venues/bithumb/rest-probe.mjs), every mode, run 2 at 03:35 to 03:38 UTC | local | 2026-09-23 UTC | this host | the second readings |
