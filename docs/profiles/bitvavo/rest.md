# Bitvavo REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 01:21 and 01:33 UTC on 2026-09-23.

This profile covers the public REST API v2 of Bitvavo (CCXT id `bitvavo`) that a catalog and a book resync would use.
Bitvavo lists no perpetual, see [`fees.md`](./fees.md) section 3, so this is its spot market, and it publishes no index, mark or funding.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bitvavo/rest-probe.mjs), run from `server/`, in the `main` runs at 01:21 and 01:32 UTC and the `poll` runs at 01:27 and 01:32 UTC.
Where the documentation and the wire disagree, both are written.
The documentation at `docs.bitvavo.com` answered this host with 200.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-22 | edge |
|---|---|---|---|
| `api.bitvavo.com` | REST base `https://api.bitvavo.com/v2`, S1, and CCXT at `server/node_modules/ccxt/js/src/bitvavo.js` line 159 | `104.18.39.7` and `172.64.148.249` | Cloudflare, `server: cloudflare`, colo `YVR` in the `cf-ray` header of both runs |
| `ws.bitvavo.com`, `ws-mdpro.bitvavo.com`, `docs.bitvavo.com`, `bitvavo.com` | sockets, docs, website | the same two addresses | Cloudflare |

| call | first request | warm requests |
|---|---|---|
| `GET /v2/time` | 245 and 237 ms | 9 each run: 161 to 178 ms and 164 to 178 ms |
| `GET /v2/markets`, 188,160 bytes | 347 and 623 ms | |
| `GET /v2/ticker/book`, every market | 191 and 270 ms | 60 polls a second apart per run: min 175 and 183, median 197 and 198, p90 473 and 483, max 480 and 943 ms, none over 1 s |
| `GET /v2/BTC-EUR/book`, 1,000 levels, about 44.7 KB | 413 and 242 ms | 297 and 356 ms for the same with `depth=1000` |

Nothing refused this host.
Every public call answered 200 or a JSON error, and none met a Cloudflare challenge, unlike the website, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET /v2/markets` returns every market in one array, at one weight point, S2.
Each row carries `market`, `status`, `base`, `quote`, `pricePrecision`, `minOrderInBaseAsset`, `minOrderInQuoteAsset`, `maxOrderInBaseAsset`, `maxOrderInQuoteAsset`, `quantityDecimals`, `notionalDecimals`, `tickSize`, `maxOpenOrders`, `feeCategory` and `orderTypes`.
The documented `status` values are `trading`, `halted`, `auction`, `auctionMatching` and `cancelOnly`, S3.

| count on 2026-09-22, both runs | value |
|---|---:|
| rows | 438 |
| `status` `trading` | 437 |
| `status` `halted` | 1, `WMTX-EUR` |
| quoted in EUR | 427 |
| quoted in USDC | 11: `BTC`, `ETH`, `SOL`, `XRP`, `DOGE`, `PEPE`, `TIA`, `SUI`, `ADA`, `USDCV` and `EURC` |
| perpetual, future or option | 0 |

`pricePrecision` was `null`, and CCXT calls it deprecated and reads `tickSize` instead, at `server/node_modules/ccxt/js/src/bitvavo.js` line 458.
`BTC-EUR` has a `tickSize` of 1 EUR, so its book moves in whole euros.

### How CCXT 4.5.68 maps it

| field | CCXT | probed |
|---|---|---|
| markets | `parseMarkets` builds one spot market per row, at `server/node_modules/ccxt/js/src/bitvavo.js` lines 473 to 538 | 438 markets, all `type` `spot`, 0 `swap` |
| `market.id` against the socket symbol | `id` is the row's `market` | 438 of 438 ids equal the REST `market` and the `ticker/book` `market`, and all are `<base>-<quote>`. The socket accepted all 437 trading ids in one subscribe and keys its events by the same spelling |
| symbol | `base + '/' + quote` through `safeCurrencyCode` | differs from the raw id only for `MIOTA-EUR`, which CCXT names `IOTA/EUR` |
| `active` | `status === 'trading'`, line 499 | 437 active |
| `contractSize` | `undefined`, line 503 | not set. The book size is in the base currency, see [`websocket.md`](./websocket.md) section 4 |
| `linear` | `undefined`, line 501 | not set |
| `taker`, `maker` | 0.0025 and 0.002 on every market, lines 508 and 509 | see [`fees.md`](./fees.md) section 8 |
| pairs listed twice | none within one quote | 11 bases trade in both EUR and USDC, among them `BTC-EUR` and `BTC-USDC` |

The engine's catalog keeps only active swap markets, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203.
From Bitvavo it would keep 0 and skip the venue, at lines 49 to 51.
Even as spot, 427 of the 438 markets are quoted in EUR, which the quote family does not merge with USD, USDC or USDT, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).

## 3. Anchor

Bitvavo publishes no index price, no mark price and no funding rate, because it lists no perpetual.
No call in the REST spec S3 returns one, and no `AnchorRow` column can be filled.
An anchor poller is not recommended.

The reference prices Bitvavo does publish are these, each for spot only.

| call | what it returns | weight, S3 |
|---|---|---|
| `GET /v2/ticker/book` | `market`, `bid`, `bidSize`, `ask`, `askSize` for every market in one reply, 44,796 and 44,720 bytes, 438 rows | 1 |
| `GET /v2/ticker/price` | the last trade price per market | 1 |
| `GET /v2/ticker/24h` | 24 h `open`, `high`, `low`, `last`, `volume`, `volumeQuote`, `bid`, `ask` and their sizes per market | 25 without `market`, 1 with it |
| `GET /v2/report/{market}/book` | the MiCA pre-trade transparency book, up to 1,000 levels per side, each with `side`, `price`, `size` and `numOrders`, 130.9 KB for `BTC-EUR` | 1 |

`ticker/book` and the report book were read by the probe in both runs, and the other two are named from S3.
The halted `WMTX-EUR` still had a bid and an ask in `ticker/book` in both runs, so a reader has to filter on `status`.

## 4. Anchor semantics

There is no index, mark or funding to describe.
The one bulk number that exists, `ticker/book`, changed as follows over 60 one-second polls per run.

| market | touch price changes in 59 intervals |
|---|---:|
| `BTC-EUR` | 10 and 12 |
| `ETH-EUR` | 29 and 44 |
| `FUN-EUR` | 7 and 10 |

Between two polls a second apart, 99 to 253 of the 438 rows changed their bid, ask or a size, with a median of 142 and 160.
So `ticker/book` refreshes within a second, and it carries no sequence number or timestamp.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /v2/{market}/book?depth=<n>` | S4 |
| depth | 1 to 1,000, default 1,000. `depth=0` and `depth=1001` answer 400 with error 205 | S4, probe tag `error_shape` |
| fields | `market`, `nonce`, `bids`, `asks`, `timestamp` in ns | probe tag `book` |
| level order | bids descending and asks ascending, on 1,000 and 25 levels in both runs | probe tag `book` |
| nonce | the same sequence as the socket's `book` events: a REST read of 25 levels carried the socket's latest nonce and equalled the socket-built book on 25 of 25 levels per side, on three markets | [`websocket.md`](./websocket.md) section 4 |
| caching | none seen: `cf-cache-status` `DYNAMIC`, no `age` or `cache-control`, and two back-to-back reads carried nonces 413287922 and 413287925, then 413294006 and 413294008 | probe tag `book_back_to_back` |
| halted market | `GET /v2/WMTX-EUR/book` answers 409 `{"errorCode":431,"error":"getBook is not available for WMTX-EUR in state HALTED"}` | probe tag `error_shape` |

The REST book can seed the socket's book in place of the `getBook` action, since both share the nonce and cost one point, S4 and S5.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| budget | 1,000 weight points a minute, counted per IP without a key, per account with one | S5 |
| cost of the calls above | 1 point each, except `ticker/24h` without `market` at 25. The remaining count fell by exactly 1 per call in both runs, and CCXT's `loadMarkets` cost 2, `markets` and the `assets` call of `fetchCurrencies` at `server/node_modules/ccxt/js/src/bitvavo.js` line 548 | S3, probe `limit` fields |
| headers | `bitvavo-ratelimit-limit` `1000`, `bitvavo-ratelimit-remaining`, and `bitvavo-ratelimit-resetat` in Unix ms at the next whole minute, as `1790126520000`, 2026-09-23 01:22:00 UTC | probe tag `time_first` |
| over the budget | HTTP 429 with error 105. An IP without a key is blocked for 15 minutes, an account for 1 minute. The reset is read from `bitvavo-ratelimit-resetat`. `Retry-After` is not documented | S5, S6. Not triggered by the probe |
| CCXT | `rateLimit` 60 ms, commented "1000 requests per minute", at `server/node_modules/ccxt/js/src/bitvavo.js` line 24 | S7 |
| error shape | `{"errorCode": <n>, "error": "<text>"}` with HTTP 400 for a bad parameter, 409 for a halted market | probe tag `error_shape` |
| unknown path | `GET /v2/nope` answers 404 with an HTML page and no rate limit headers | probe tag `error_shape` |

| request | status | body |
|---|---|---|
| `/NOPE-EUR/book` | 400 | `{"errorCode":205,"error":"market parameter NOPE-EUR is invalid."}` |
| `/btc-eur/book?depth=1` | 400 | `{"errorCode":205,"error":"market parameter is invalid."}` |
| `/BTC-EUR/book?depth=0` | 400 | `{"errorCode":205,"error":"depth parameter 0 is invalid."}` |
| `/BTC-EUR/book?depth=1001` | 400 | `{"errorCode":205,"error":"depth parameter 1001 is invalid."}` |
| `/WMTX-EUR/book?depth=5` | 409 | `{"errorCode":431,"error":"getBook is not available for WMTX-EUR in state HALTED"}` |
| `/markets?market=NOPE-EUR` | 400 | `{"errorCode":205,"error":"market parameter is invalid."}` |
| `/ticker/book?market=NOPE-EUR` | 400 | `{"errorCode":205,"error":"market parameter NOPE-EUR is invalid."}` |

## 7. Server time and clock offset

`GET /v2/time` returns `{"time": <ms>, "timeNs": <ns>}`, as `{"time":1790126496703,"timeNs":1790126496703587000}`.
Taken against the midpoint of each request, the server clock was ahead of this host by a median of 3 ms in both runs.
The warm offsets ran from 0 to 3 ms in the first run and from minus 7 to 5 ms in the second, and the first request of each run read 32 and 28 ms while its connection opened.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| anchor poller | none | Bitvavo publishes no index, mark or funding, and a mark of 0 is refused at open as `anchor_no_mark`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 37 to 39 |
| catalog | `GET /v2/markets`, keep `status === 'trading'` | the halted market is acknowledged by the socket and never delivers, and its `ticker/book` row is frozen |
| book seed | `getBook` on the socket, or `GET /v2/{market}/book` at the default 1,000 levels | same nonce, one point each |
| budget | stay under about 300 points a minute for snapshots and polls together | an IP over 1,000 points a minute without a key is blocked for 15 minutes |
| spot cross-check, if ever wanted | `GET /v2/ticker/book` once a second, 60 points a minute | one reply covers all 438 markets, median 197 ms |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | REST API introduction | https://docs.bitvavo.com/docs/rest-api/introduction/ | 2026-09-22 | Bitvavo B.V. | base URL |
| S2 | Get markets | https://docs.bitvavo.com/docs/rest-api/get-markets/ | 2026-09-22 | Bitvavo B.V. | catalog call and fields |
| S3 | Exchange REST API spec, version 2.10.0 | https://docs.bitvavo.com/api-specs/exchange-rest-api.yaml | 2026-09-22 | Bitvavo B.V. | status enum, call list, weights, no index, mark or funding |
| S4 | Get order book | https://docs.bitvavo.com/docs/rest-api/get-order-book/ | 2026-09-22 | Bitvavo B.V. | depth limits, nonce, weight |
| S5 | Rate limits | https://docs.bitvavo.com/docs/rate-limits/ | 2026-09-22 | Bitvavo B.V. | budget, headers, 429 and blocks |
| S6 | Handle errors | https://docs.bitvavo.com/docs/errors/ | 2026-09-22 | Bitvavo B.V. | error 105, retry advice |
| S7 | CCXT 4.5.68 `bitvavo.js` | `server/node_modules/ccxt/js/src/bitvavo.js` | 2026-09-22 | CCXT | market mapping, `rateLimit`, fee constants |
| S8 | Get server time | https://docs.bitvavo.com/docs/rest-api/get-server-time/ | 2026-09-22 | Bitvavo B.V. | `time` and `timeNs` |
| P1 | `rest-probe.mjs main`, runs at 01:21 and 01:32 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitvavo/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 3 and 5 to 7 |
| P2 | `rest-probe.mjs poll`, runs at 01:27 and 01:32 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitvavo/rest-probe.mjs) | 2026-09-22 | this host | sections 1 and 4 |
