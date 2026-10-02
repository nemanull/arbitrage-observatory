# Tokpie REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Seattle time (04:34 to 04:53 UTC on 2026-09-23, first runs and the second pass), from the development host near Seattle through its Surfshark WireGuard exit, which geolocates to Canada (Cloudflare trace `loc=CA`, edge `SEA` or `YVR`).

This profile covers the public REST API of Tokpie on its spot market, since Tokpie lists no perpetuals, see [`fees.md`](./fees.md) section 3.
Every claim below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/tokpie/rest-probe.mjs) or read from the API page S1, and the ledger in section 9 names which.
Where a probe ran more than once, every reading is given in run order.
All access results are from the Canadian VPN exit.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| base URL | `https://tokpie.com/{api_name}/`, every route a GET with a trailing slash | S1, P1 |
| address | `tokpie.com` resolved to one IPv4 address, `95.213.151.243`, and `dig` found no AAAA record | P1 |
| network | RIPE range `95.213.151.0/24`, name `SELECTEL-NET`, country RU, from the RIPE RDAP record read on 2026-09-22 | S2 |
| server | `nginx/1.4.6 (Ubuntu)`, no CDN in front | P1 |
| cold request | `GET /api_ticker/`, about 132.3 KB, over three runs: DNS 13, 10 and 12 ms, TCP 19, 16 and 17 ms, TLS done at 694, 696 and 696 ms, first byte at 1,089, 1,059 and 1,077 ms, complete at 1,422, 1,391 and 1,413 ms | P1 |
| warm request | `GET /api_ticker/?market=ETH@USDT` on one keep-alive socket: 950, 226, 177, 182 and 214 ms, then 871, 178, 187, 178 and 190 ms, then 977, 178, 223, 311 and 179 ms. A median of 178, 182 and 178 ms over 12 reads in each of three poll runs | P1, P3 |
| round trip | about 178 ms. A bare TCP connect to port 8222 took 180 and 183 ms, while port 443 connected in 12 to 19 ms over five connects, so something on the path answers 443 early and the TLS handshake carries the real distance | P1, P5 |
| plain HTTP | `http://tokpie.com/api_ticker/?market=ETH@USDT` answered 302 to the `https` URL | P1 |
| refusals | none on any public route of `tokpie.com` | P1 to P4 |

## 2. Catalog

### The instruments call

There is no instruments or markets call.
The catalog is the bulk ticker `GET /api_ticker/`, S1.

| item | value on 2026-09-23 UTC | source |
|---|---|---|
| rows | 379 in all three runs, one per pair, 685 to 736 ms warm | P1 |
| pair spelling | `BASE@QUOTE` with the listing's own case, for example `ETH@USDT`, `Cake@USDT`, `$CCS@ETH` | P1 |
| fields | `pair`, `id`, `isFrozen`, `highestBid`, `lowestAsk`, `last`, `avg`, `at_first24`, `high24hr`, `low24hr`, `percentChange`, `baseVolume`, `quoteVolume`, `updated` | P1, S1 |
| status | `isFrozen` only, a JSON number, 1 meaning frozen. 194 rows frozen, 185 not | P1, S1 |
| two sided books | 183 rows carry both `highestBid` and `lowestAsk`, 149 of them quoted in USDT, 17 in ETH and 5 in USDC. No frozen row has a bid or an ask. 2 unfrozen rows have no two sided book | P1 |
| locked or crossed | 1 row in the first run, `USDT@USDC` at `1.0002` bid and `1.0002` ask, and 0 in the next two | P1 |
| quote assets | USDT 150, TKP 113, ETH 88, USDC 11, BNB 5, YOUC 5, WBTC 4, SOL 1, TRX 1, XRP 1 | P1 |
| perpetuals | none, no row has a perpetual, swap or futures spelling | P1 |
| numbers | prices and volumes are decimal strings, `null` where there is no book or no trade | P1 |
| `id` | an integer per pair, `709237` for `ETH@USDT` on every read | P1, P3 |
| `updated` | minute resolution, `"23.09.2026 04:32 UTC"`. At 04:34 UTC the rows read 04:32 and 04:33, at 04:45 UTC they read 04:40 to 04:42, and at 04:52 UTC they read 04:48 to 04:50 | P1 |
| 24 h USDT volume | 15,213,370, 15,218,425 and 15,209,999 USDT summed over the 150 USDT rows, led by `ETH@USDT` at about 3.02 million and `BNB@USDT` at about 2.12 million | P1 |

Tick size, lot size and minimum order are not published by any public route, S1.
The bulk ticker is a cached snapshot and not a live touch.
In the second run its `ETH@USDT` row read a bid of `2761.59823099` while the book call and the single pair ticker a few seconds either side read `2764.24902599`, P1.
In the third its ask read `2781.544213` while the book call read `2781.444183`, P1.

### How CCXT maps it

CCXT 4.5.68 has no Tokpie class, and neither does CCXT master on 2026-09-22, see [`fees.md`](./fees.md) section 8.
So `market.id`, `contractSize`, `linear` and `active` have no CCXT value to compare, and the engine's catalog at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68 cannot load the venue.

### Size unit, pairs listed twice, and price scale

Book sizes are in the base asset, "quantity of Base currency", S1.
No pair is listed twice, since the 379 `pair` values and the 379 `id` values are each unique, P1.
No pair has TKP as its base, so nothing in the catalog prices TKP, P1.
No price scale applies.

## 3. Anchor

Tokpie publishes no index, no mark and no funding, because it has no derivative, S1.
No `AnchorRow` column has a source, and no anchor poller is recommended.

The only reference prices are in the ticker, S1.

| field | meaning, S1 |
|---|---|
| `last` | last deal price |
| `avg` | average deal price within the last 24 hours |
| `at_first24` | price of the first deal of the last 24 hours |
| `highestBid`, `lowestAsk` | best bid and ask, from a snapshot refreshed every few minutes, see section 5 |

`GET /api_candlestick/?pair=…&limit=…&interval=…` returns 100 to 1,000 bars, S1.
On `ETH@USDT` at a 1 minute interval it returned 100 bars in every run, and the first and last bars carried an open time, an open price and a close time, with empty strings for high, low and volume, P1.
The close price was empty on the first bar and filled on the last.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

The spot books were compared with Gate spot once in each of the last two poll runs, as context for any cross against a Tokpie leg, P3.

| pair | read at, UTC | Tokpie bid | Tokpie ask | Gate bid | Gate ask | Tokpie mid against Gate mid | Tokpie spread |
|---|---|---:|---:|---:|---:|---:|---:|
| `ETH@USDT` | 04:37:26 | 2,761.59823099 | 2,764.02395849 | 2,783.78 | 2,783.79 | -7,534 ppm | 878 ppm |
| `ETH@USDT` | 04:47:33 | 2,764.24902599 | 2,775.362359 | 2,784.06 | 2,784.07 | -5,122 ppm | 4,012 ppm |
| `BNB@USDT` | 04:37:26 | 791.33732999 | 795.83868 | 797.3 | 797.4 | -4,718 ppm | 5,672 ppm |
| `BNB@USDT` | 04:47:33 | 792.98782499 | 795.83868 | 797.4 | 797.5 | -3,808 ppm | 3,589 ppm |
| `TRX@USDT` | 04:37:26 | 0.34436466 | 0.344373281 | 0.3445 | 0.3446 | -525 ppm | 25 ppm |
| `TRX@USDT` | 04:47:33 | 0.34436466 | 0.344534329 | 0.3444 | 0.3445 | -1 ppm | 493 ppm |
| `Cake@USDT` | 04:37:26 | 2.69080699 | 2.690807 | 2.6817 | 2.6842 | +2,928 ppm | 0 ppm |
| `Cake@USDT` | 04:47:33 | 2.67080099 | 2.690807 | 2.6926 | 2.6941 | -4,658 ppm | 7,463 ppm |
| `SOL@USDT` | 04:37:26 | 118.50554099 | 119.185745 | 119.54 | 119.55 | -5,850 ppm | 5,723 ppm |
| `SOL@USDT` | 04:47:33 | 118.50554099 | 119.185745 | 119.7 | 119.71 | -7,179 ppm | 5,723 ppm |

The Tokpie prices in this table come from the bulk ticker, which lags the book by minutes, section 5.
Tokpie's `ETH@USDT` ask sat below Gate's bid in both reads.
Its `SOL@USDT` bid and ask read the same in both snapshots, ten minutes apart, while Gate's moved.
The `ETH@USDT` ticker also showed a 24 h low of 1,745.3873892 and a high of 2,942.0585 in all three catalog runs, P1.
A cross built on a Tokpie leg would set a book that barely moves against a live one.

## 5. REST book snapshot

Two calls, both documented in S1.

| call | depth parameter | returned | source |
|---|---|---|---|
| `GET /api_order_book/?market=ETH@USDT&size=10` | `size`, documented as "Gear position 1-10". Required: missing or `0` answers `API_ORDER_BOOK_ERROR_INVALID_PARAMETER_SIZE` | `size` 5, 10, 11 and 20 returned that many levels per side, so 10 is not a cap | S1, P1, P2 |
| `GET /api_order_book_v2/?market=ETH@USDT&depth=20` | `depth`, 0 for the full book, "Market depth is unlimited". Missing returns the full book, `-1` answers `API_ORDER_BOOK_V2_ERROR_INVALID_PARAMETER_DEPTH` | `depth` 20 returned 20 per side, `0` and `100` returned the full book, 71 bids and 39 asks, then 72 and 38 twice | S1, P1, P2 |

| property | value | source |
|---|---|---|
| keys | v1 `aob_bid`, `aob_ask`, `aob_datetime`. v2 `aob2_bids`, `aob2_asks`, `aob2_datetime` | P1 |
| level | `[price, size]` as JSON numbers, not strings, for example `[2761.59823099, 4.74535984]`, and `[7.021e-9, 580008049284]` on a low priced pair | P1 |
| bid order | descending, best first, on both calls and both pairs in every run | P1 |
| ask order | also descending, so the best ask is the last element, on both calls and both pairs in every run | P1 |
| time | `aob2_datetime` is whole seconds, `"23.09.2026 04:34:36 UTC"`, and read 92 to 1,108 ms before each reply arrived over three poll runs, so it is the time the reply was built and not the time the book last changed | P1, P3 |
| sequence or update id | none | P1 |
| caching headers | none, no `Cache-Control`, `ETag` or `Age` | P1 |
| time, busy pair | `ETH@USDT` at depth 20: median 680, 666 and 676 ms, p90 1,151, 745 and 1,171 ms, max 1,337, 1,152 and 2,029 ms over 58, 60 and 58 polls. The full book once took 1,863 ms, and `size=11` once took 1,644 ms | P1, P2, P3 |
| time, quiet pair | `BOAKIN@USDT`: 191 to 240 ms, about one round trip | P1 |
| reply size | 1,233 to 1,234 bytes at depth 20 and 2,451 to 2,452 bytes in full on `ETH@USDT` | P1 |
| how often books move | the 58 to 60 polls of the `ETH@USDT` 20 level book in each run returned 1 distinct book in the first two runs and 2 in the third. The bulk ticker read about 70 s apart showed a new touch on 5 of 183 two sided pairs in the second run and on 0 in the third | P3 |
| ticker against book | the single pair ticker's `highestBid` and `lowestAsk` equalled the book's touch in 12 of 12, 12 of 12 and 7 of 12 samples in the poll runs, in 30 of 30 on `BNB@USDT` while that book did not move, and in 6 of 30 on `ETH@USDT` while it did | P3, P4 |

The `ETH@USDT` run of P4 shows how the ticker lags.
The book's ask moved from `2775.362359` to `2781.544213`, while the ticker kept `2775.362359` with `updated` at 04:44 UTC.
When `updated` turned to 04:48 UTC the ticker showed `2781.544213`, by which time the book's ask was `2781.444183`.
So the single pair ticker, like the bulk one, is a snapshot refreshed about every four minutes, and only the book calls carry the live touch.

A local book built from these calls has to find the best ask with a minimum, or reverse the ask array, and never take the first element.
The busy pair costs about 500 ms of server time per read on top of the round trip, so one keep-alive connection reads about one busy book a second, and 183 books a second would need many parallel connections against a host with no published limit.

## 6. Rate limits and errors

No rate limit is published, S1.
No reply carried a rate limit header, and no 429 or `Retry-After` was seen at up to two requests a second, P1 to P4.
Both runs of P2 gave the same replies.

| request | HTTP | body | source |
|---|---|---|---|
| unknown market on `api_ticker` | 200 | `{"is_ok": false, "error_code": "API_TICKER_ERROR_MARKET_NOT_FOUND"}` | P2 |
| unknown market on `api_order_book` | 200 | `{"is_ok": false, "error_code": "API_ORDER_BOOK_ERROR_MARKET_NOT_FOUND"}` | P2 |
| unknown market on `api_order_book_v2`, including `ETH_USDT` | 200 | `{"is_ok": false, "error_code": "API_ORDER_BOOK_V2_ERROR_MARKET_NOT_FOUND"}` | P2 |
| `api_order_book` without `size` or with `size=0` | 200 | `{"is_ok": false, "result": "API_ORDER_BOOK_ERROR_INVALID_PARAMETER_SIZE"}` | P2 |
| `api_order_book_v2` with `depth=-1` | 200 | `{"is_ok": false, "result": "API_ORDER_BOOK_V2_ERROR_INVALID_PARAMETER_DEPTH"}` | P2 |
| `api_trades` without `market` | 200 | `{"is_ok": false, "result": "API_TRADES_ERROR_INVALID_PARAMETER_MARKET"}` | P2 |
| `api_trades` with an unknown market | 200 | `{"is_ok": true, "result": []}` | P2 |
| unknown route `/api_nope/` | 404 | the site's HTML error page | P2 |

Every failure is HTTP 200 with `is_ok` false, and the reason sits in `error_code` for an unknown market and in `result` for a bad parameter.
A reader has to check `is_ok` and never the status code alone.
An unknown market on `api_trades` looks like a quiet market.

## 7. Server time and clock offset

No server time route is published, S1.
The `Date` header carries whole seconds, and fifteen reads over three runs, each taken at the midpoint of its request, bound the server clock to between 20 ms behind and 74 ms ahead of this host, P1.

## 8. Recommended poller shape

None.
Tokpie has no index, mark or funding to poll, and no CCXT class to catalog it, so it cannot join the engine as a perpetual leg.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tokpie API, "Last updated on February 10, 2021". The live page read with the probe's user agent had the same text as the Internet Archive capture of 2026-07-28 16:26 UTC | https://tokpie.io/api | 2026-09-22 | Graceful Globe S.A., Panama | routes, fields, depth parameters, size unit, sections 1 to 7 |
| S2 | RIPE RDAP record for `95.213.151.243` | https://rdap.db.ripe.net/ip/95.213.151.243 | 2026-09-22 | RIPE NCC | network name and country, section 1 |
| P1 | `rest-probe.mjs catalog`, runs at 04:34, 04:45 and 04:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tokpie/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 3, 5 and 7 |
| P2 | `rest-probe.mjs errors`, runs at 04:35 and 04:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tokpie/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 5 and 6 |
| P3 | `rest-probe.mjs poll`, runs at 04:35, 04:37 and 04:47 UTC, the first without the Gate table and the bulk ticker diff | [`rest-probe.mjs`](../../../scripts/probes/venues/tokpie/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit, and Gate spot for reference | sections 1, 4 and 5 |
| P4 | `rest-probe.mjs live BNB@USDT` at 04:40 UTC and `live ETH@USDT` at 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tokpie/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P5 | `ws-probe.mjs`, runs at 04:39 and 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tokpie/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the TCP connect times, section 1 |
