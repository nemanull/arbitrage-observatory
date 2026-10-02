# GMO Coin REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 03:06 to 03:35 UTC), from the development host near Seattle.

This profile covers the public REST API of GMO Coin (no CCXT class) for its only perpetual family, the 12 `*_JPY` leverage symbols.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/gmo-coin/rest-probe.mjs) or taken from a source in section 9.
Run P1 ran each mode once between 03:11 and 03:16 UTC, and run P2, the second pass, ran `all` from 03:23:07 to 03:25:13 UTC.
The venue publishes no index, no mark and no funding rate, so sections 3 and 4 record what exists in their place.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api.coin.z.com/public`, version path `/v1`, S1 |
| resolved addresses | `52.85.129.18`, `52.85.129.63`, `52.85.129.94`, `52.85.129.103`, a CloudFront distribution |
| CloudFront edge | `x-amz-cf-pop: SEA900-P10` on every reply |
| origin server header | `nginx` |
| cache headers | `cache-control: no-cache,no-store,max-age=0,must-revalidate`, yet CloudFront serves hits, section 5 |
| compression | none: the replies carried no `content-encoding` although the probe asked for gzip |
| access | every public call answered 200 from this host, with no geoblock and no challenge |

One cold request and ten warm requests 500 ms apart per path.

| path | bytes | cold ms, P1 and P2 | warm min, median, max ms, P1 | warm min, median, max ms, P2 |
|---|---|---|---|---|
| `/v1/status` | 80 | 179, 17 | 16, 127, 331 | 15, 130, 344 |
| `/v1/ticker` | 4,420 and 4,421 | 147, 133 | 15, 129, 327 | 19, 131, 350 |
| `/v1/ticker?symbol=BTC_JPY` | 229 | 330, 322 | 15, 127, 330 | 16, 127, 325 |
| `/v1/orderbooks?symbol=BTC_JPY` | 22,612 and 22,500 | 234, 238 | 18, 244, 436 | 18, 232, 431 |
| `/v1/symbols` | 3,911 | 326, 132 | 16, 132, 340 | 17, 129, 334 |

A reply under 20 ms is a CloudFront hit at the Seattle edge, and the P2 cold `/v1/status` read of 17 ms was one.
The warm medians of 127 to 132 ms on the small replies are misses, the round trip to the origin in Japan, and the 22 KB book took a median of 232 to 244 ms and at most 436 ms.

## 2. Catalog

### The instruments call

`GET /v1/symbols` returns 29 rows with `symbol`, `minOrderSize`, `maxOrderSize`, `sizeStep`, `tickSize`, `takerFee` and `makerFee`, and nothing else, in P1 and P2.
No row carries a status, a product type, a contract size or a listing flag.
The product is spelled in the symbol: 17 spot rows are the bare coin, such as `BTC`, and 12 leverage rows end in `_JPY`, such as `BTC_JPY`, S1 symbol table.
The venue as a whole reports `MAINTENANCE`, `PREOPEN` or `OPEN` at `GET /v1/status`, and it read `{"status":0,"data":{"status":"OPEN"}}` in both runs.

| leverage symbol | min order | max order | size step | tick | taker | maker |
|---|---|---|---|---|---|---|
| `BTC_JPY` | 0.001 | 5 | 0.001 | 1 | 0 | 0 |
| `ETH_JPY` | 0.01 | 100 | 0.01 | 1 | 0 | 0 |
| `BCH_JPY` | 0.1 | 100 | 0.1 | 1 | 0 | 0 |
| `LTC_JPY` | 1 | 500 | 1 | 1 | 0 | 0 |
| `XRP_JPY` | 10 | 100,000 | 10 | 0.001 | 0 | 0 |
| `DOT_JPY` | 1 | 5,000 | 1 | 1 | 0.0003 | 0 |
| `ATOM_JPY` | 1 | 2,000 | 1 | 1 | 0.0003 | 0 |
| `ADA_JPY` | 10 | 50,000 | 10 | 0.001 | 0.0003 | 0 |
| `LINK_JPY` | 1 | 2,000 | 1 | 1 | 0.0003 | 0 |
| `DOGE_JPY` | 10 | 200,000 | 10 | 0.001 | 0.0003 | 0 |
| `SOL_JPY` | 0.1 | 500 | 0.1 | 1 | 0.0003 | 0 |
| `SUI_JPY` | 1 | 5,000 | 1 | 0.001 | 0.0003 | 0 |

The active perpetual count is 12, all settled in JPY.
There is no USDT, USDC or coin-margined perpetual.

### How CCXT 4.5.68 maps it

It does not, since CCXT 4.5.68 has no GMO Coin class, and neither does CCXT master, see [`fees.md`](./fees.md) section 8.
The open pull request ccxt/ccxt#27965 types every row as spot and maps both `BTC` and `BTC_JPY` to `BTC/JPY`, so the engine's swap filter at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203 would keep none of them.

A hand-written catalog would read as follows.

| engine field | value | evidence |
|---|---|---|
| `rawMarketId` | `symbol`, such as `BTC_JPY` | the same spelling on `/v1/symbols`, `/v1/ticker`, `/v1/orderbooks` and the socket, P1, P2 and [`websocket.md`](./websocket.md) section 3 |
| `base`, `quote` | the two halves of the symbol, `BTC` and `JPY` | S1 symbol table, "Bitcoin-Japanese Yen (Margin trading)" |
| `linear` | true | sizes are in the coin and profit and loss is in JPY, S2 |
| `contractSize` | 1 | book sizes are in the base coin, [`websocket.md`](./websocket.md) section 4 |
| `active` | present in `/v1/symbols` and `/v1/status` `OPEN` | no per symbol status exists |

### Pairs listed twice, quote family and price scale

Every leverage symbol has a spot twin with the same base and quote, `BTC` beside `BTC_JPY`, and only the leverage one is the perpetual-like product.
The engine's quote family joins USD and USDC to USDT and nothing else, at [`../../../server/src/engine/cluster/quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6.
A JPY market would therefore form its own cluster key, such as `BTC|JPY`, which no active venue shares, so it would never meet a USDT perpetual.
No price scale is needed, since every price is quoted per one coin.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /v1/ticker` | absent | absent | absent | absent | absent | 4,409 to 4,422 bytes, 29 rows | 60 polls in P2: min 124, median 322, p90 334, max 426 ms |

The ticker row carries `ask`, `bid`, `high`, `last`, `low`, `symbol`, `timestamp` and `volume`, S1 and P1.
No public call returns an index, a mark, a funding rate or a funding schedule, S1.
The leverage product has no funding: it charges a fixed 0.04 % a day on every position held across 06:00 JST, see [`fees.md`](./fees.md) section 6.

### Row mapping

| `AnchorRow` column | field | note |
|---|---|---|
| key | `symbol` | |
| `index` | none | the venue publishes no index |
| `mark` | none, so 0 | the engine refuses a route with a mark of 0 as `anchor_no_mark`, at [`../../../server/src/engine/opportunity/anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 37 and 38 |
| `fundingRate` | none | the leverage fee is a fixed cost to both sides, not a rate between them |
| `fundingIntervalHours` | none | a fee interval of 24 h exists, [`fees.md`](./fees.md) section 6 |
| `nextFundingAt` | none | the fee is booked at 06:00 JST, 21:00 UTC, each day |

A venue with no poller writes no row at all, and the reader refuses such a route as `anchor_missing`, at the same file, line 26.
So a GMO Coin leg would be refused at open in either case.

## 4. Anchor semantics

### Index, mark and funding

None exists, S1, S2 and S3.
The loss cut is judged on "現在値", the current price, which S2 does not define, and no clamp or cap is published because no formula is.

### The nearest reference: GMO Coin's own spot book

Each leverage book trades apart from the spot book of the same coin on the same venue.
The probe read both from the same `/v1/ticker` reply once a second and computed the leverage mid over the spot mid.

| symbol | P1 min, median, max ppm | P2 min, median, max ppm |
|---|---|---|
| `BTC_JPY` | 189, 403, 669 | 191, 721, 1,171 |
| `ETH_JPY` | 1,171, 1,484, 1,663 | 246, 1,088, 1,513 |
| `BCH_JPY` | 430, 1,057, 3,172 | 634, 839, 1,082 |
| `LTC_JPY` | -201, 301, 452 | 0, 401, 703 |
| `XRP_JPY` | 354, 567, 816 | -491, 688, 1,294 |
| `DOT_JPY` | 0, 0, 0 | 0, 0, 0 |
| `ATOM_JPY` | 0, 0, 0 | 0, 1,718, 1,718 |
| `ADA_JPY` | 596, 782, 931 | -1,916, -1,755, -1,718 |
| `LINK_JPY` | 242, 485, 727 | -3,133, 0, 241 |
| `DOGE_JPY` | -277, -62, 123 | -123, 215, 920 |
| `SOL_JPY` | -134, 187, 268 | 559, 1,199, 1,332 |
| `SUI_JPY` | -2,683, -2,391, -2,170 | -185, -89, 373 |

The five fee-free leverage books had medians of 301 to 1,484 ppm above spot in both runs.
On the thin books the number jumps between runs by more than a spread, because a one JPY tick on `DOT_JPY` and `ATOM_JPY` is 3,400 to 5,250 ppm, section 5.
A spot book could stand in for an index only for the five liquid symbols, and that is a design question, not a venue feature.

One sample on 2026-09-23 at 03:29:34 UTC put GMO Coin's `BTC_JPY` mid, divided by the `USD_JPY` mid of GMO Coin's public forex ticker at `https://forex-api.coin.z.com/public/v1/ticker`, 54 ppm below the Binance USDT-M `BTCUSDT` mid.
That is one reading, not a measured basis.

### How often each number changed

60 polls of `/v1/ticker` at 1 s, counting the polls in which a leverage row changed.

| symbol | bid or ask, P1 | bid or ask, P2 | last, P1 | last, P2 |
|---|---|---|---|---|
| `BTC_JPY` | 27 | 54 | 6 | 23 |
| `ETH_JPY` | 29 | 52 | 4 | 13 |
| `XRP_JPY` | 38 | 58 | 3 | 10 |
| `BCH_JPY` | 28 | 54 | 1 | 0 |
| `LTC_JPY` | 21 | 27 | 0 | 0 |
| `DOGE_JPY` | 31 | 56 | 1 | 0 |
| `ADA_JPY` | 26 | 12 | 0 | 0 |
| `SUI_JPY` | 27 | 13 | 0 | 0 |
| `SOL_JPY` | 10 | 25 | 0 | 1 |
| `LINK_JPY` | 4 | 13 | 0 | 1 |
| `DOT_JPY` | 0 | 0 | 0 | 0 |
| `ATOM_JPY` | 0 | 0 | 0 | 0 |

Out of 59 poll pairs per run.
P1 got 24 CloudFront hits in 60 polls and P2 got 1, which explains most of the gap between the runs, since a hit repeats the previous reply.
The row `timestamp` is not a trade time: it changed on 38 or 39 polls in P1 and 57 to 59 in P2 on every symbol, quiet ones included, so it stamps the reply.
It was 68 to 1,669 ms older than the reply's `responsetime` in P1, median 830, and 110 to 1,610 ms in P2, median 630.

## 5. REST book snapshot

`GET /v1/orderbooks?symbol=<symbol>` returns `asks` ascending and `bids` descending, S1, as arrays of `{"price", "size"}` strings.
No depth parameter exists, and the reply held up to 500 levels per side.

| symbol | bids, asks | bids descending, asks ascending | spread ppm, P1 | spread ppm, P2 | JPY within 20 levels, bids and asks, P2 |
|---|---|---|---|---|---|
| `BTC_JPY` | 455, 180 | yes | 132 | 163 | 57,908,432 and 10,033,657 |
| `ETH_JPY` | 278, 160 | yes | 236 | 398 | 10,231,080 and 14,057,268 |
| `XRP_JPY` | 500, 404 | yes | 640 | 456 | 11,214,898 and 15,682,258 |
| `BCH_JPY` | 281, 290 | yes | 2,221 | 3,019 | 4,595,243 and 2,930,286 |
| `LTC_JPY` | 126, 121 | yes | 3,718 | 5,016 | 11,020,518 and 3,303,002 |
| `SOL_JPY` | 276, 256 | yes | 1,606 | 639 | 10,787,875 and 6,468,787 |
| `DOGE_JPY` | 500, 500 | yes | 1,600 | 798 | 3,152,269 and 3,537,798 |
| `ADA_JPY` | 379, 286 | yes | 1,787 | 4,931 | 1,241,959 and 2,234,522 |
| `SUI_JPY` | 450, 320 | yes | 702 | 628 | 584,051 and 812,546 |
| `LINK_JPY` | 97, 58 | yes | 3,391 | 2,896 | 8,729,022 and 6,009,963 |
| `ATOM_JPY` | 98, 49 | yes | 3,454 | 10,292 | 3,027,634 and 4,612,982 |
| `DOT_JPY` | 114, 75 | yes | 5,249 | 5,249 | 5,582,119 and 12,373,043 |
| `BTC` spot | 500, 500 | yes | 178 | 35 | 153,882,667 and 39,749,234 |

Level counts are from P2.
No book was crossed in either run.
The same `BTC_JPY` 20 levels held 6,721,886 JPY of bids and 7,830,468 JPY of asks in P1, so the depth near the touch varies by several times within ten minutes.
At the `USD_JPY` mid of 157.61 from section 4, 10,000,000 JPY is about 63,000 USD.

### Caching

CloudFront caches every public reply for about one second despite its `no-cache` header, and the origin regenerates its replies on a grid of about 505 ms.
The `cache` mode read one ticker URL 20 times 150 ms apart, then 20 times with a query parameter that changed on every read.

| read | P1 | P2 |
|---|---|---|
| same URL: CloudFront hits of 20 | 16 | 15 |
| same URL: distinct `responsetime` values | 5 | 5 |
| same URL: gap between the `responsetime` of consecutive misses | 1,012 to 1,014 ms | 1,010 to 1,011 ms |
| same URL: age of a hit at receipt | 181 to 1,028 ms | 393 to 1,059 ms |
| changing parameter: CloudFront hits of 20 | 0 | 0 |
| changing parameter: distinct `responsetime` values | 13 | 12 |
| changing parameter: gap between consecutive `responsetime` values | min 0, median 506, max 507 ms | min 0, median 505, max 507 ms |
| changing parameter: median age at receipt | 318 ms | 348 ms |

Two misses with different URLs came back with the same `responsetime`, so the origin serves a reply built up to about 505 ms earlier.
Six `BTC_JPY` book reads 300 ms apart in P2 showed a new `etag` and `responsetime` on every miss, 501 or 1,003 ms apart, and the hit between repeated the miss before it.
A poller defeats the CloudFront layer with a changing query parameter, and nothing defeats the origin grid.

## 6. Rate limits and errors

No limit is published for the public REST API.
S1 section "API Limiting" names only the public WebSocket, one subscribe per second per IP, and the private REST tiers of 20 or 30 requests a second per account.
The probe peaked at about six requests a second, on CloudFront hits in the `cache` mode, and got no refusal.
The documented limit error is `ERR-5003` "The API usage limits are exceeded.", and S1 documents no HTTP status or `Retry-After` for it.
The HTTP status table of S1 lists only 200, 404, and 503 for a WebSocket call during maintenance.
Maintenance on REST answers `ERR-5201` for regular and `ERR-5202` for emergency maintenance, S1.

Every probed error came back as HTTP 404 with the same body, in P1, P2 and a separate call for the delisted `XTZ`, `DAI` and `XTZ_JPY`.

```json
{"status": 2, "messages": [{"message_code": "ERR-5207", "message_string": "Not found"}]}
```

| request | status |
|---|---|
| `/v1/orderbooks?symbol=NOPE_JPY` | 404 `ERR-5207` |
| `/v1/orderbooks` without a symbol | 404 `ERR-5207` |
| `/v1/ticker?symbol=NOPE` | 404 `ERR-5207` |
| `/v1/nope` and `/v2/ticker` | 404 `ERR-5207` |
| `/v1/klines?symbol=BTC_JPY&interval=2min&date=20260922` | 404 `ERR-5207`, documented as "Invalid symbol, interval or date values." |
| `/v1/orderbooks?symbol=XTZ`, `DAI` and `XTZ_JPY` | 404 `ERR-5207` |

A success carries `"status": 0` and a `responsetime`.

## 7. Server time and clock offset

No server time call exists.
Every reply carries `responsetime`, an ISO 8601 string with milliseconds, and `/v1/status` is the lightest call at 80 bytes.
Over 33 CloudFront misses in P2, `responsetime` minus the local midpoint of the request had a median of -86 ms, a minimum of -474 ms and a maximum of 105 ms.
P1 counted hits too, so its median of -325 ms is not a clock reading.
Because the origin can serve a reply built up to about 505 ms earlier, `responsetime` bounds the clock only loosely.
The socket gives a tighter bound: a book frame arrived at the earliest 48 to 51 ms after its `timestamp`, and a protocol pong came back in 94 to 98 ms, whose half is 47 to 49 ms, see [`websocket.md`](./websocket.md) section 5.
That agreement suggests the offset is within a few milliseconds, which is an inference.
The local clock reported NTP synchronised through `timedatectl`.

## 8. Recommended poller shape

No anchor poller is recommended, because the venue publishes nothing an `AnchorRow` could hold.
GMO Coin cannot join the engine as a perpetual leg in its current shape, and each of the following would have to change first.

| blocker | what it needs |
|---|---|
| no CCXT class in 4.5.68 or master, and the open pull request types the leverage symbols as spot | a hand-written catalog from `/v1/symbols`, or a CCXT class that types `*_JPY` as swaps |
| JPY settlement, section 2 | a JPY quote family with a live `USD_JPY` conversion, which adds foreign exchange risk to every cross |
| no index, mark or funding, section 3 | an anchor substitute, such as GMO Coin's own spot book, and a rule for a leg with no mark, since the reader refuses it today |
| access | only residents of Japan may open an account, see [`fees.md`](./fees.md) section 1 |
| book freshness | the socket and REST both publish on a grid of about 505 ms, see [`websocket.md`](./websocket.md) section 4 |

If a later design adds JPY venues, the only useful reads are the socket book of [`websocket.md`](./websocket.md) section 8 and, for a spot reference, `GET /v1/ticker?n=<changing>` once a second, 4.4 KB for all 29 symbols.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GMO Coin API documentation, English, sections "Endpoint", "API Limiting", "Public API", "The handling symbols", "HTTP Status Codes", "Error Codes" and "Changelog" | https://api.coin.z.com/docs/en/ | 2026-09-22 | GMO Coin, Japan | calls, fields, symbol table, limits, error codes, sections 1 to 7 |
| S2 | 取引所（暗号資産の購入・売却・レバレッジ取引） | https://coin.z.com/jp/corp/product/info/exchange/ | 2026-09-22 | GMO Coin, Japan | size unit, JPY settlement, loss cut on 現在値, sections 2 and 4 |
| S3 | 手数料 (fees) | https://coin.z.com/jp/corp/guide/fees/ | 2026-09-22 | GMO Coin, Japan | leverage fee in place of funding, section 4 |
| S4 | GMO Coin forex public ticker | https://forex-api.coin.z.com/public/v1/ticker | 2026-09-22 | GMO Coin, Japan | `USD_JPY` 157.607 and 157.612 at 03:29 UTC, section 4 |
| P1 | `rest-probe.mjs` `catalog`, `latency`, `cache`, `poll`, `book` and `errors`, 03:11 to 03:16 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gmo-coin/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs all`, the second pass, 03:23:07 to 03:25:13 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gmo-coin/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P3 | curl reads of the ticker with and without a changing parameter at 03:12 UTC, and of the delisted symbols near 03:33 UTC | not kept | 2026-09-22 | this host | sections 5 and 6 |
