# Bitbank REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 01:30 to 01:50 UTC), from the development host near Seattle.

This profile covers the public REST API of Bitbank (CCXT id `bitbank`) for its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitbank/rest-probe.mjs) unless a source id from section 9 says otherwise.
Bitbank publishes no index, mark or funding rate, so no anchor poller is recommended.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-23 UTC | edge | cache | cold | warm, 10 requests |
|---|---|---|---|---|---|---|
| `public.bitbank.cc` | public market data, S1 | `108.138.94.33`, `.43`, `.89`, `.107` | CloudFront POP `SEA73-P2`, origin `server: AmazonS3` | `cache-control: max-age=1` | 39 ms on a hit, 346 to 414 ms on a miss | 13 to 367 ms over two runs. A CloudFront hit took 13 to 67 ms, and a miss mostly 330 to 420 ms, once 144 ms |
| `api.bitbank.cc` | `/v1/spot/pairs`, `/v1/spot/status` and the private API, S2 | `108.138.94.12`, `.17`, `.56`, `.128` | CloudFront POP `SEA73-P2`, origin `server: nginx` | `cache-control: no-store` | 106 to 245 ms | 102 to 475 ms over two runs, median 111 and 272 ms for `spot/status` and 191 and 285 ms for `spot/pairs` |
| `stream.bitbank.cc` | WebSocket, see [`websocket.md`](./websocket.md) | `18.65.238.14`, `.55`, `.76`, `.101` | | | | |

Public market data is a set of JSON objects on S3, served through CloudFront with a one second cache.
So a public read is either a cache hit, fast and up to about 2 s old, or a miss that usually goes to the origin in about 340 ms.
Every call answered HTTP 200 to this host, and no geoblock, challenge or refusal was seen on the API hosts.
The support site `support.bitbank.cc` did answer 403 with a Cloudflare managed challenge, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET https://api.bitbank.cc/v1/spot/pairs` needs no authentication, S2.
It returned 62 pairs in 69,531 bytes.

| quote | listed | `is_enabled` | tradable | suspended |
|---|---:|---:|---:|---:|
| JPY | 47 | 47 | 44 | 3: `mkr_jpy`, `rndr_jpy`, `matic_jpy` |
| BTC | 15 | 15 | 0 | 15 |

A suspended pair keeps `is_enabled` true and sets `stop_order`, `stop_market_order`, `stop_stop_order`, `stop_stop_limit_order`, `stop_buy_order` and `stop_sell_order` true, and its book and ticker sides are empty.
`GET https://api.bitbank.cc/v1/spot/status` reported all 62 pairs `NORMAL`, suspended ones included, so it cannot tell a suspended pair either.
The status enum is `NORMAL`, `BUSY`, `VERY_BUSY` and `HALT`, S2.
No perpetual appears in any bitbank catalog, and the count of active perpetuals is 0.

### How CCXT 4.5.68 maps it

| field | CCXT | source |
|---|---|---|
| call | `fetchMarkets` calls `marketsGetSpotPairs`, which requests `https://api.bitbank.cc/spot/pairs`, without `/v1`, and that URL answers the same 69,531 bytes | `bitbank.js` lines 278 and 1065 to 1071, P1 |
| `id` | `name`, such as `btc_jpy` | lines 311 and 317 |
| `symbol` | `BTC/JPY` | |
| `type`, `swap` | `spot`, `false` on all 62 | lines 325 to 328 |
| `active` | `is_enabled`, so all 62 are active, the 18 suspended ones included | line 331 |
| `linear`, `contractSize` | `undefined` | lines 333 and 337 |
| `taker`, `maker` | `taker_fee_rate_quote`, `maker_fee_rate_quote` | lines 335 and 336 |

`market.id` equals the `spot/pairs` `name`, the REST path segment in `/{pair}/depth`, the `pair` field in `/tickers`, and the room suffix on the socket, on 62 of 62 pairs.
No pair is listed twice.
The engine keeps only active swap markets, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 195 to 202, so bitbank yields zero markets and the connector skips the venue.
Even in a spot mode, every bitbank quote is JPY or BTC, which the quote family does not merge with USDT, at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a bitbank market could only cluster with another JPY or BTC market.
A spot filter would also need `stop_order` from `info`, since CCXT marks suspended pairs active.

## 3. Anchor

Bitbank publishes no index price, no mark price and no funding rate, because it has no derivative.
Margin trading pays a fixed daily interest to bitbank, not a funding rate, see [`fees.md`](./fees.md) section 6.

The only reference price is the circuit breaker's base price (基準価格), the close of 10 minutes earlier in normal mode, S5.
It is not published directly.
`GET https://public.bitbank.cc/{pair}/circuit_break_info` returns `upper_trigger_price` and `lower_trigger_price`, the base price plus and minus the normal limit band, which is 20 % on BTC, ETH, XRP, DOGE and SOL against JPY and 50 % on other pairs, S5.

| pair | `upper_trigger_price` | `lower_trigger_price` | midpoint | check |
|---|---|---|---|---|
| `btc_jpy`, 01:30 UTC | `16372154` | `10914768` | 13,643,461 | times 1.2 is 16,372,153.2 and times 0.8 is 10,914,768.8, so a band of 20 % |
| `xrp_jpy`, 01:30 UTC | `301.752` | `201.168` | 251.46 | times 1.2 is 301.752 and times 0.8 is 201.168 exactly |
| `btc_jpy`, 01:44 UTC | `16355615` | `10903743` | 13,629,679 | times 1.2 is 16,355,614.8 and times 0.8 is 10,903,743.2 |
| `xrp_jpy`, 01:44 UTC | `299.291` | `199.527` | 249.409 | times 1.2 is 299.2908 and times 0.8 is 199.5272 |

The rows are from the two P1 runs, when `btc_jpy` last traded near 13,640,000 and then 13,590,000.
The socket room `circuit_break_info_btc_jpy` pushed a new band 42 s and 56 s apart in two runs, see [`websocket.md`](./websocket.md) section 2.
The call is per pair, with no bulk form, and the fields are null outside normal mode, S1.
The band also widens in steps after repeated breaks, S5, so the midpoint is the base price only while no break has fired in the last hour.
None of this is an index, and none of it maps to an `AnchorRow`.

The bulk call that does exist is `GET https://public.bitbank.cc/tickers`, 62 rows in 9,945 bytes, with `pair`, `sell`, `buy`, `open`, `high`, `low`, `last`, `vol` and `timestamp`, S1.
`GET /tickers_jpy` returns the 47 JPY rows in 7,509 bytes.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding formula to record.

What the ticker poll shows instead, over 30 polls of `/tickers` at 1 s in each of two runs, P1:

| measure | first run | second run |
|---|---|---|
| reply time | min 26, median 347, p90 365, max 419 ms | min 23, median 341, p90 358, max 397 ms |
| pairs whose `timestamp` changed from one poll to the next | min 27, median 32, max 62 of 62 | min 0, median 30, max 37 of 62 |
| arrival minus the row's `timestamp` | min 760, median 2,084, p90 27,850, max 59,874 ms | min 577, median 3,092, p90 34,825, max 45,294 ms |

So a quiet pair's ticker row can be close to a minute old, and even `btc_jpy` read 929 to 1,442 ms old in five reads, and 584 to 3,160 ms in the second run, P1.
The 18 suspended pairs carry `"sell":null` and `"buy":null`.

## 5. REST book snapshot

`GET https://public.bitbank.cc/{pair}/depth` takes no depth or limit parameter, S1.

| pair | bids | asks | bid order | ask order | crossed | reply | age of `timestamp` at arrival |
|---|---:|---:|---|---|---|---|---|
| `btc_jpy` | 200 | 200 | descending | ascending | no | 9,027 bytes | 815 and 929 ms |
| `xrp_jpy` | 200 | 200 | descending | ascending | no | 9,202 and 9,254 bytes | 1,567 and 1,691 ms |
| `bat_jpy` | 120 and 122 | 200 | descending | ascending | no | 7,225 and 7,271 bytes | 1,314 and 1,442 ms |

Each cell gives the first and the second run where they differ.

Prices and sizes are strings, and `sequenceId` is a string such as `"34423818161"`, although S1 types it as a number.
The reply also carries `asks_over`, `bids_under`, `asks_under`, `bids_over`, `ask_market` and `bid_market`.
A suspended pair returns empty `bids` and `asks`.

Five reads of `btc_jpy/depth` 300 ms apart returned only two distinct `sequenceId` values in each of two runs, with `x-cache` alternating between `Miss`, `Hit` and `RefreshHit from cloudfront`, and the book's own `timestamp` was 1,003 to 2,137 ms old at arrival.
The REST book is therefore always about one to two seconds behind the socket.
Its `sequenceId` is on the socket's counter, but a book rebuilt from the socket at that id matched the REST top 20 levels exactly in only 6 of 12 comparisons, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| documented limit | per user: 10 QUERY calls and 6 UPDATE calls per second, plus a system wide limit, HTTP 429 when reached | S2, section "Rate limit" |
| public endpoints | Not publicly specified. They are cached S3 objects | P1 |
| CCXT | `rateLimit: 100` ms, one call per 100 ms | `bitbank.js` line 24 |
| `Retry-After` | not seen, and no 429 was provoked | P1 |

The probe stayed at about three requests per second.

| request | status | body |
|---|---|---|
| `GET public.bitbank.cc/nope_jpy/depth` | 404, `content-type: text/plain`, `x-cache: Error from cloudfront` | `{"success":0,"data":{"code":10000}}` |
| `GET public.bitbank.cc/nope_jpy/ticker` | 404 | the same |
| `GET public.bitbank.cc/btc_jpy/nope` | 404 | the same |
| `GET api.bitbank.cc/v1/nope` | 404, `server: nginx` | the same |

Code 10000 is "Url not found".
The documented codes a poller would meet are 10007 "System maintenance", 10008 "Server is busy. Retry later." and 10009 "You sent requests too frequently. Retry later with decreased requests.", S3.

## 7. Server time and clock offset

Bitbank publishes no server time call, and CCXT 4.5.68 implements no `fetchTime` for it.
The `Date` header of ten uncached `spot/status` replies bounded the offset to between -47 and +364 ms, server minus local, with a median round trip of 287 ms, and to between -65 and +91 ms in the second run, P1.
Together the two runs put the offset between -47 and +91 ms.
The socket gives a tighter reading: arrival minus the diff `t` was at least 50 ms on every pair, which is the one way trip from Tokyo plus the offset, see [`websocket.md`](./websocket.md) section 3.

## 8. Recommended poller shape

None.
There is no index, mark or funding to poll, and the circuit breaker band is per pair, slow and not an index.
A spot design that wanted a reference would read the circuit breaker room on the socket, see [`websocket.md`](./websocket.md) section 2.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public REST API for Bitbank, `public-api.md` | https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-api.md | 2026-09-22 | bitbank, Japan | base URL, tickers, depth, circuit break info, error payload, sections 1 and 3 to 5 |
| S2 | Private REST API for Bitbank, `rest-api.md` | https://github.com/bitbankinc/bitbank-api-docs/blob/master/rest-api.md | 2026-09-22 | bitbank, Japan | `spot/pairs`, `spot/status`, rate limit, sections 1, 2 and 6 |
| S3 | Error codes, `errors.md` | https://github.com/bitbankinc/bitbank-api-docs/blob/master/errors.md | 2026-09-22 | bitbank, Japan | codes 10000, 10007 to 10009, section 6 |
| S4 | CCXT 4.5.68 `bitbank.js` | `server/node_modules/ccxt/js/src/bitbank.js` | 2026-09-22 | CCXT | lines 24, 278, 311 to 337, 1065 to 1071, section 2 |
| S5 | サーキットブレーカー制度の説明 (circuit breaker rules) | https://bitbank.cc/guide/circuit-breaker-mode | 2026-09-22 | bitbank, Japan | base price, limit bands, section 3 |
| P1 | `rest-probe.mjs` `catalog`, `latency`, `depth`, `errors` and `tickers`, at 01:30 to 01:33 UTC and 01:44 to 01:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbank/rest-probe.mjs) | 2026-09-23 UTC | this host | every measured number |
