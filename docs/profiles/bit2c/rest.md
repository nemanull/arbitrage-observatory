# Bit2c REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:41 to 05:08 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of Bit2c (CCXT id `bit2c`), documented on one page, S1.
Bit2c lists no perpetuals, so the catalog below is its spot market, and section 3 records that it publishes no index, mark or funding.
Every number was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/bit2c/rest-probe.mjs) unless a source is named.
The probe paced itself at one request per second or slower, because no rate limit is published.

## 1. Host and latency from this machine

| host | resolved | edge | notes |
|---|---|---|---|
| `bit2c.co.il`, the API host in CCXT `urls.api.rest`, `server/node_modules/ccxt/js/src/bit2c.js` line 122 | `45.60.248.200`, `45.60.242.200` | Imperva, `x-cdn: Imperva`, `server: Bitcoin liberte !` | every API call |
| `www.bit2c.co.il` | `172.66.132.227`, `172.66.139.187` | Cloudflare | 301 to `https://Bit2C.co.il/`. Its `/cdn-cgi/trace` read `colo=SEA`, `loc=CA`, which is the Canadian VPN exit |

| request | first, cold | warm |
|---|---|---|
| `GET /Exchanges/BtcNis/Ticker.json` | 961 ms and 577 ms to the first byte in P1 and P3, including DNS, TCP and TLS | 232 to 357 ms over 10 requests |
| `GET /Exchanges/BtcNis/orderbook.json` | | 212 to 537 ms over 180 polls in P2, P4 and P5, medians 218 to 269 ms |
| `GET /Exchanges/BtcNis/orderbook-top.json` | | 211 to 412 ms over 180 polls in P2, P4 and P5, medians 219 to 266 ms |

A warm round trip of about 220 to 270 ms is consistent with an origin far from Seattle, likely in Israel, which is an inference.
Every documented call answered 200 from the Canadian VPN exit, and no challenge page, geoblock or refusal was seen.

## 2. Catalog

### The instruments call

There is none.
S1 documents four public calls per pair and names the pairs in the URL itself: `BtcNis`, `EthNis`, `LtcNis` and `UsdcNis`.
The unknown pair error is the only reply that lists pairs, and it names ten.

```json
{"error":"NopeNis is not allowed! Supported pairs are: BtcNis,EthNis,BchabcNis,LtcNis,EtcNis,BtgNis,UsdcNis,LtcBtc,BchsvNis,GrinNis."}
```

Six of the ten are dead.
Their ticker answers with a null bid and ask and zero volume, and their book call redirects, as the table shows.

| pair | ticker `h` bid, `l` ask, P1 | ticker `a`, 24 h base volume | `orderbook.json` | levels, bids and asks, P1 then P3 | book spread, P1 then P3 |
|---|---|---|---|---|---|
| `BtcNis` | 258,000 and 259,999 | 4.714 and 4.699 BTC | 200, 8,267 and 8,184 bytes | 162 and 124, then 161 and 122 | 7,718 then 4,542 ppm |
| `EthNis` | 8,131.61 and 8,346.86 | 70.66 ETH | 200, 3,969 and 4,024 bytes | 71 and 73, then 71 and 75 | 24,560 then 31,540 ppm |
| `LtcNis` | 180.46 and 197 | 34.66 LTC | 200, 3,476 and 3,338 bytes | 33 and 97, then 32 and 93 | 87,638 then 83,003 ppm |
| `UsdcNis` | 2.97 and 3.01 | 18,639 USDC | 200, 1,923 and 1,868 bytes | 27 and 45, then 25 and 45 | 13,378 then 13,378 ppm |
| `BchabcNis`, `BchsvNis`, `EtcNis`, `BtgNis`, `GrinNis`, `LtcBtc` | `null` and `null` | 0 | 301 to `/exchanges/BtcNis/orderbook.html` | none | |

`GET /Exchanges/BtcNis/lasttrades` returned 31 and 30 trades over the last 24 h, the newest 1,059 s and 355 s old, in P1 and P3.
The spreads above are between the book's own best bid and best ask, and they are 0.45 % to 8.8 %.

### How CCXT 4.5.68 maps it

CCXT does not call the venue for its catalog.
The four live pairs are hard coded at `server/node_modules/ccxt/js/src/bit2c.js` lines 166 to 171, and `loadMarkets` returned them in 0 ms with no request, in P1 and P3.

| field | CCXT value | wire |
|---|---|---|
| `market.id` | `BtcNis`, `EthNis`, `LtcNis`, `UsdcNis` | the REST path segment, and the suffix of the site socket's `UpdateOrderBook_BtcNis`, see [`websocket.md`](./websocket.md) section 3 |
| `type`, `spot`, `swap` | `spot`, true, false | spot order book |
| `active` | `undefined` | the four answer with live books |
| `linear` | `undefined` | not a contract |
| `contractSize` | `undefined` | book sizes are in base units, so the engine's default of 1 is right |
| `taker`, `maker` | `undefined` | see [`fees.md`](./fees.md) section 8 |
| `precision`, `limits` | empty | not published by a public call |

No pair is listed twice.
Path segments are case insensitive: `btcnis` and `BTCNIS` returned the same ticker and book as `BtcNis`, in P1 and P3.
Every live pair is quoted in NIS, which is outside the USD, USDC and USDT family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
The engine's connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 203, so it would load an empty catalog and skip the venue, at lines 49 to 51.

## 3. Anchor

### The bulk calls

None.
Bit2c publishes no index price, no mark price and no funding rate, because it lists no perpetual, S1.
No call returns anything for more than one pair.

The nearest reference numbers are in the per pair ticker, S1.

| field | meaning, from S1 | example, `BtcNis` |
|---|---|---|
| `ll` | last trade price | 259,500 |
| `av` | average price over the last 24 hours | 259,490.878… |
| `h` | highest buy order, the best bid | 258,000 |
| `l` | lowest sell order, the best ask | 259,999 |
| `a` | volume over the last 24 hours, base units | 4.71413306 |
| `c` | change over the last 24 hours, decimal or null | 1.209… |
| `up` | last change up, down or none | `null` |

The broker converts "at an international currency rate", translated from the fee page, see [`fees.md`](./fees.md) section 4, and no public call exposes that rate.

### Row mapping

No `AnchorRow` can be filled.
A route with a Bit2c leg would have `mark` 0 and be refused at open, as section 4 of [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) says.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
The ticker's `h` and `l` equalled the best bid and ask of a full book read 1 s later on `BtcNis`, `LtcNis` and `UsdcNis` in both P1 and P3.
On `EthNis` they differed both times, and that book was pushed about 3.5 times a second on the site socket, so it moved between the two reads.

## 5. REST book snapshot

| call | depth | order | caching, S1 | probed |
|---|---|---|---|---|
| `GET /Exchanges/{pair}/orderbook.json` | the whole book, 157 to 165 bids and 119 to 129 asks on `BtcNis` over 60 reads in P5 | bids descending, asks ascending, in every read of P1 and P3 | "chached 1 sec." | 58, 53 and 58 of 59 consecutive replies differed at one read every 2 s in P2, P4 and P5 |
| `GET /Exchanges/{pair}/orderbook-top.json` | 10 per side in every read | bids descending, asks ascending | "real-time" | 48, 33 and 57 of 59 consecutive replies differed at one read every 2 s |

Each level is a two element array `[price, amount]` of JSON numbers, in base units.
Neither reply carries a timestamp or an update id.
The response headers carry `cache-control: private` and no `Age`, `ETag` or `Last-Modified`.
The touch of `BtcNis` moved 3 to 6 times in each call's 60 reads over 120 s, in P2, P4 and P5.
CCXT's `fetchOrderBook` reads `orderbook.json` and ignores `limit`, at `server/node_modules/ccxt/js/src/bit2c.js` lines 376 to 386, and CCXT does not know `orderbook-top.json`.
The site socket pushes the same top ten as `orderbook-top.json`, level for level, see [`websocket.md`](./websocket.md) section 4.

The trades calls, for context.
`GET /Exchanges/{pair}/lasttrades` returns the last 24 h of trades as `{date, price, amount, isBid, tid}`, with `date` in Unix seconds.
`GET /Exchanges/{pair}/trades.json` is "Cached every 5 min" by S1, and `?limit=5` returned 6 rows in P1 and P3.
S1 also prints a `trades.json` example with `[price, amount, unixtimestamp]` levels, which the wire does not follow.

## 6. Rate limits and errors

No rate limit is published on S1 or in the FAQ.
CCXT paces the class at one request per 3,000 ms, at `server/node_modules/ccxt/js/src/bit2c.js` line 24.
The probes sent about 500 requests at one per second or slower across both passes, and none was refused, so no limit status code, `Retry-After` header or ban shape was observed.

| request | status | reply |
|---|---|---|
| ticker of an unknown pair | 200 | `{"error": "NopeNis is not allowed! Supported pairs are: …"}` |
| book of an unknown pair, or of a dead pair | 301 | HTML "Object moved" to `/exchanges/BtcNis/orderbook.html` |
| a path that does not exist, such as `/Exchanges/BtcNis/Ticker` without `.json` or `/api/v1/time` | 200 | the site's HTML page titled `NotFound`, 39,295 bytes |
| a wrong case pair, `btcnis` | 200 | the normal reply |

So an error can arrive as a 200 with an `error` key, as a 301, or as a 200 HTML page.
CCXT treats a body with `error` or `Error` as an exception, at `server/node_modules/ccxt/js/src/bit2c.js` lines 1031 to 1051.
A reader has to check the content type and the `error` key, not only the status.

## 7. Server time and clock offset

There is no server time call, and `/api/v1/time` returns the HTML `NotFound` page, P1.
The `Date` header carries whole seconds, and each run takes five reads that bound the server clock minus this host's clock.
P1 bounded it at -1,029 to -539 ms, and P3 at -397 to +128 ms.
The two bounds do not overlap, while this host's clock was NTP synchronized, so the header is not a clock to trust below about one second.
The header may be written by the Imperva edge and not by the origin, which was not separable.
The only timestamps in the public replies are the Unix seconds of each trade in `lasttrades` and `trades.json`.

## 8. Recommended poller shape

No anchor poller is recommended.
Bit2c has no perpetual, publishes no index, mark or funding, and has no bulk call.
A spot stage that wanted its books could read `orderbook-top.json` per pair, four calls, but the site socket delivers the same ten levels with a median push gap of 273 to 830 ms per pair, see [`websocket.md`](./websocket.md) section 8.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bit2C API documentation | https://bit2c.co.il/home/api | 2026-09-22 | Bit2c, Israel | the public calls, ticker fields, book caching notes, sections 2 to 6 |
| S2 | Bit2C FAQ | https://bit2c.co.il/home/faq | 2026-09-22 | Bit2c, Israel | no rate limit published, section 6 |
| S3 | CCXT 4.5.68 `bit2c.js` | `server/node_modules/ccxt/js/src/bit2c.js` | 2026-09-22 | CCXT | API host, markets, `rateLimit`, `fetchOrderBook`, error handling, sections 1, 2, 5 and 6 |
| P1 | `rest-probe.mjs survey` at 04:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2c/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1, 2, 4, 5, 6 and 7 |
| P2 | `rest-probe.mjs cache` at 04:45 UTC, 120 s | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2c/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 and 5 |
| P3 | `rest-probe.mjs survey`, second pass at 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2c/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1, 2, 4, 5, 6 and 7, the second readings |
| P4 | `rest-probe.mjs cache`, second pass at 05:00 UTC, 120 s | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2c/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 and 5 |
| P5 | `rest-probe.mjs cache` with level ranges, at 05:05 UTC, 120 s | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2c/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 and 5, the book depth range |
