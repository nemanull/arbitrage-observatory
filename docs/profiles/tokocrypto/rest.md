# TokoCrypto REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 03:15 to 03:45 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public REST API of TokoCrypto (CCXT id `tokocrypto`) for its spot market, because the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
Numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/tokocrypto/rest-probe.mjs), run twice, and from a few `curl` reads made by hand before the probe was written.
The venue publishes no index, mark or funding, so sections 3 and 4 record what it does publish and recommend no anchor poller.

TokoCrypto serves three REST hosts.
`https://www.tokocrypto.com` carries the `/open/v1` API, `https://www.tokocrypto.site` is a Binance spot API clone for the 833 "type 1" symbols, and `https://cloudme-toko.2meta.app` serves the 17 "type 3" symbols, S1.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 | call | cold | warm, 5 calls | CloudFront pop |
|---|---|---|---|---|---|
| `www.tokocrypto.com` | CNAME `d1k2f3pz8hqaut.cloudfront.net`, 99.86.101.86, .90, .118, .122 | `GET /open/v1/common/time` | 630 and 485 ms | median 204 and 203 ms, max 560 and 532 ms | `SEA900-P13` |
| `www.tokocrypto.site` | CNAME `d2qvoir298g1s6.cloudfront.net`, 99.86.101.35, .44, .74, .90 | `GET /api/v3/time` | 692 and 672 ms | median 297 and 292 ms, max 840 and 619 ms | `CGK51-P2, SEA900-P13`, a Jakarta hop behind the Seattle one |
| `cloudme-toko.2meta.app` | 108.138.94.21, .27, .107, .121 | `GET /api/v1/depth?symbol=ALCHIDR&limit=5` | 334 and 337 ms | median 381 and 386 ms | `SEA73-P2` |
| `api.binance.com`, for comparison | 18.238.229.202 | `GET /api/v3/time` | 131 and 132 ms | median 104 and 101 ms | `SEA900-P5` |

`www.tokocrypto.asia`, the second entry of the system config's `binanceApiBaseUrlList`, resolved to the same CloudFront distribution as `www.tokocrypto.site`.
The stream hosts resolved as [`websocket.md`](./websocket.md) section 1 lists.
Every call above answered HTTP 200, and no host refused this machine.

## 2. Catalog

### The instruments call

`GET https://www.tokocrypto.com/open/v1/common/symbols` returned 1,303,164 bytes and 850 rows in 293 and 288 ms, S1.
The reply is `{"code":0,"msg":"Success","data":{"list":[…]},"timestamp":…}`, and each row carries `type`, `symbol`, `baseAsset`, `quoteAsset`, precisions, `filters`, `orderTypes`, `spotTradingEnable`, `marginTradingEnable`, `permissions` and two self trade prevention fields.

| type | quote | rows |
|---|---|---:|
| 1 | USDT | 460 |
| 1 | USDC | 246 |
| 1 | BTC | 34 |
| 1 | IDR | 29 |
| 1 | U | 29 |
| 1 | USD1 | 24 |
| 1 | ETH | 5 |
| 1 | BNB | 5 |
| 1 | SOL | 1 |
| 3 | IDR | 11 |
| 3 | USDT | 6 |

The documentation's enum says "Symbol type: 1 MAIN 2 NEXT", and its changelog of 2023-09-06 calls type 3 "Nextme Symbol(New Symbol)", S1.
No row had type 2.
All 850 rows had `spotTradingEnable` 1, and none is a perpetual or a future.

### How CCXT 4.5.68 maps it

| item | value | source |
|---|---|---|
| markets | 850, all `spot`, all `active`, 0 `swap`, 0 `contract` | P1 and P2 |
| `market.id` | `BTC_USDT`, the catalog `symbol`, with an underscore on all 850 | `server/node_modules/ccxt/js/src/tokocrypto.js` line 803 |
| socket symbol | `btcusdt` in the stream name and `BTCUSDT` in the frame, see [`websocket.md`](./websocket.md) section 3 | P1 and P2 |
| REST book symbol | `BTCUSDT` on `www.tokocrypto.site`, where `BTC_USDT` returns `{"code":-1121,"msg":"Invalid symbol."}` | P1 and P2 |
| `contractSize` | `undefined` | line 823 |
| `linear` | `undefined` | line 821 |
| `active` | `spotTradingEnable` equal to `"1"`, unless `permissions` holds `TRD_GRP_003` | lines 792 to 800 |
| pairs listed twice | none | P1 and P2 |
| `fetchOrderBook` | a USDT quoted market reads `https://api.binance.com/api/v3/depth`, every other market reads `/open/v1/market/depth` | lines 911 to 917, and the `binance` base URL at line 166 |

The engine's connector keeps only markets with `type` `swap`, `swap` true and `active` not false, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 195 to 201.
TokoCrypto yields none, so the connector would log `no usable swap markets; skipping the venue` at line 51.
Even for spot, the CCXT `market.id` is not the symbol the socket or the REST book uses, so a feed would need a mapping.

### One engine with Binance

The type 1 symbols are Binance spot symbols, read through TokoCrypto's hosts.
`GET https://www.tokocrypto.site/api/v3/ticker/bookTicker` returned 3,710 rows, the same symbol set as `https://api.binance.com/api/v3/ticker/bookTicker`, and 3,648 rows had the same best bid and ask across two reads made at the same moment by hand, H1.
All 833 type 1 catalog symbols appear in Binance's reply.
The same book read from the three hosts at once:

| symbol | run | `tokocrypto.site` id | `/open/v1/market/depth` id | `api.binance.com` id | best bid on all three |
|---|---|---:|---:|---:|---|
| BTCUSDT | 03:23 UTC | 100530017127 | 100530017127 | 100530016994 | 86731.32 |
| BTCUSDT | 03:33 UTC | 100530392946 | 100530393010 | 100530392925 | 86688.64 |
| ETHUSDC | 03:23 UTC | 19187265741 | 19187265741 | 19187265730 | 2770.35 |
| ETHUSDC | 03:33 UTC | 19187367061 | 19187367062 | 19187367061 | 2766.97 |
| BTCIDR | 03:23 UTC | 282944316 | 282944316 | 282944316 | 1544876773 |
| BTCIDR | 03:33 UTC | 282946680 | 282946680 | 282946680 | 1544771176 |
| SOLUSD1 | 03:23 UTC | 501471407 | 501471407 | 501471407 | 119.22 |
| SOLUSD1 | 03:33 UTC | 501488129 | 501488129 | 501488124 | 119.03 |

The ids share one sequence, and a difference is only the reads' timing.
On `api.binance.com`, `exchangeInfo?symbol=BTCIDR` returns `TRADING` with a permission set of six entries, `SPOT`, `TRD_GRP_234`, `TRD_GRP_235`, `TRD_GRP_245`, `TRD_GRP_253` and `MARGIN_001`, against 223 entries on `BTCUSDT`, read by hand twice, H1.
The venue's own pages say the same in words: "Tokocrypto 2.0 Powered by Binance Cloud", and a customer agreement that names Binance RIE in ADGM as a liquidity provider, see [`fees.md`](./fees.md) section 1.

## 3. Anchor

TokoCrypto publishes no index price, no mark price and no funding rate, because it lists no derivative.

| call | reply | meaning |
|---|---|---|
| `GET https://www.tokocrypto.site/fapi/v1/premiumIndex?symbol=BTCUSDT` | 404, a 631 byte nginx page | no futures API |
| `GET https://www.tokocrypto.com/fapi/v1/premiumIndex?symbol=BTCUSDT` | 404, the 47,974 byte web app page | no futures API |
| `GET https://www.tokocrypto.com/futures/BTCUSDT` | 200, a 666 byte "Welcome to nginx!" page | no futures product |

What it does publish, per symbol except the two ticker calls:

| call | reply | size and time |
|---|---|---|
| `GET /api/v3/referencePrice?symbol=BTCUSDT` on `tokocrypto.site` | `{"symbol":"BTCUSDT","referencePrice":"86629.44195251","timestamp":1790133790012}` | 80 bytes, 654 and 670 ms cold |
| `GET /api/v3/referencePrice/calculation?symbol=BTCUSDT` | `{"symbol":"BTCUSDT","calculationType":"ARITHMETIC_MEAN","bucketCount":80,"bucketWidthMs":3750}` | 94 bytes |
| `GET /api/v3/referencePrice` without `symbol` | 400 `{"code":-1102,"msg":"Mandatory parameter 'symbol' was not sent, was empty/null, or malformed."}` | no bulk form |
| `GET /api/v3/avgPrice?symbol=BTCUSDT` | `{"mins":5,"price":"86617.12932012","closeTime":1790133792440}` | 61 bytes |
| `GET /api/v3/executionRules?symbol=BTCUSDT` | `PRICE_RANGE` with every multiplier `1.1500` up and `0.8500` down | 183 bytes |
| `GET /api/v3/ticker/price` | 3,710 rows of `{"symbol","price"}` | 157,387 bytes, 495 and 479 ms |
| `GET /api/v3/ticker/bookTicker` | 3,710 rows of best bid and ask | 426,558 and 426,686 bytes, 697 and 639 ms |
| `GET https://cloudme-toko.2meta.app/api/v1/ticker/bookTicker` | 28 rows, among them test symbols `456123` and `456789` | 3,609 and 3,610 bytes |

None of these is an `AnchorRow`.
The reference price is a trade price average that bounds order prices, not an index of other venues, and there is no mark or funding to pair it with.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
For the record, the reference price is "a simple moving average of trade prices over a time window", where the window is `bucketWidthMs` times `bucketCount`, S1.
On BTCUSDT that is 3,750 ms times 80, a 300 s window.
Over 60 polls one second apart:

| number | changes, run 1 | changes, run 2 |
|---|---:|---:|
| BTCUSDT `referencePrice` | 59 | 53 |
| BTCUSDT `avgPrice` | 57 | 53 |
| BTCUSDT `ticker/price` | 37 | 31 |
| BTCIDR `referencePrice` | 1 | 6 |
| BTCIDR `ticker/price` | 1 | 1 |

At the last poll the BTCUSDT last price stood 379 ppm and 70 ppm above the reference price.
Reply time for `referencePrice` was median 297 and 296 ms, p90 649 and 624 ms, max 856 and 727 ms.

## 5. REST book snapshot

| call | depth | order | caching |
|---|---|---|---|
| `GET https://www.tokocrypto.site/api/v3/depth?symbol=BTCUSDT&limit=N` | the documentation lists "Default 100; max 5000. Valid limits:[5, 10, 20, 50, 100, 500]", S1. Limits 5, 20, 100, 500, 1,000 and 5,000 each returned exactly that many levels per side, and limit 7 returned 7 | bids descending and asks ascending at every limit | none: five reads 200 ms apart returned five different `lastUpdateId` values in both runs |
| `GET https://www.tokocrypto.com/open/v1/market/depth?symbol=BTC_USDT&limit=5` | the same book wrapped in `{"code":0,"msg":"Success","data":{…},"timestamp":…}` | same | serves type 1 and type 3 symbols |
| `GET https://cloudme-toko.2meta.app/api/v1/depth?symbol=NBTUSDT&limit=5` | type 3 book with `lastUpdateId`, `E`, `T` and `symbol` | same | `E` stood 31 and 41 minutes behind the local clock on a book that did not change |

Reply sizes on BTCUSDT ran from 367 bytes at limit 5 to 320,049 bytes at limit 5,000, and times from 283 to 672 ms.
Binance weighs a depth call 5 up to limit 100, 25 up to 500, 50 up to 1,000 and 250 up to 5,000, S3.
TokoCrypto's hosts return no weight header for these calls, section 6.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limit on `www.tokocrypto.com` | "Every request will contain X-MBX-USED-WEIGHT-(intervalNum)(intervalLetter)", S1, with no number given | `x-mbx-request-weight-1m: 1200` and `x-mbx-used-weight-1m` on every reply, which read 34 at most during a probe run |
| limit on `www.tokocrypto.site` | same | no weight header at all, only `x-mbx-uuid`. `exchangeInfo` lists only `ORDERS` limits of 100 per 10 s and 200,000 per day, while Binance's own `exchangeInfo` adds `REQUEST_WEIGHT` 6,000 per minute and `RAW_REQUESTS` 300,000 per 5 minutes |
| limit on `cloudme-toko.2meta.app` | not documented | `x-mbx-used-weight-1m` of 2 to 8 |
| status codes | 429 on a limit, 418 for an automatic IP ban after further requests, bans from 2 minutes to 3 days, 403 for a WAF rule, S1 | none reached |
| `Retry-After` | "sent with a 418 or 429", S1 | not seen, no limit was reached |

| request | status | body |
|---|---|---|
| `tokocrypto.site` depth of `NOPEUSDT` | 400 | `{"code":-1121,"msg":"Invalid symbol."}` |
| `tokocrypto.site` depth of `BTC_USDT` | 400 | `{"code":-1121,"msg":"Invalid symbol."}` |
| `tokocrypto.site` depth with `limit=abc` | 400 | `{"code":-1100,"msg":"Illegal characters found in parameter 'limit'; legal range is '^[0-9]{1,20}$'."}` |
| `tokocrypto.site` unknown path `/api/v3/nope` | 404 | empty |
| `/open/v1/market/depth` of `NOPE_USDT` | 200 | `{"code":2802,"msg":"Trading pair does not exist","timestamp":…}` |
| `/open/v1/account/spot` without a key | 200 | `{"code":3700,"msg":"Invalid API-key","timestamp":…}` |
| `cloudme-toko.2meta.app` depth of `NOPEIDR` | 400 | `{"code":-1121,"msg":"Invalid symbol."}` |
| `cloudme-toko.2meta.app/api/v1/time` | 403 | a CloudFront "The request could not be satisfied" page, returned in 12 and 13 ms, so the path is blocked at the edge while the depth path on the same host answers |

The `/open/v1` API reports errors inside an HTTP 200 reply, so a client must read `code`.

## 7. Server time and clock offset

| call | reply | offset, 5 samples | round trip |
|---|---|---|---|
| `GET https://www.tokocrypto.com/open/v1/common/time` | `{"code":0,"msg":"Success","data":null,"timestamp":1790133324005}` | median 9 and 7 ms | median 199 and 200 ms |
| `GET https://www.tokocrypto.site/api/v3/time` | `{"serverTime":1790133541266}` | median 0 and 5 ms | median 295 and 300 ms |

The offset is the server time minus the midpoint of the request, and the one slow sample per run pulled the p90 to 177 to 263 ms.
The clock of this host agrees with the venue's within about 10 ms.

## 8. Recommended poller shape

None.
TokoCrypto has no perpetual, index, mark or funding, so there is nothing for an `AnchorPoller` to read.
The engine refuses a route whose anchor carries no mark, see [`../../implemented/2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) section "What the engine needs from a venue", so even a spot leg on this venue would be refused at open without a change to that rule.
If a later design wants a price reference for the IDR books, `ticker/price` on `www.tokocrypto.site` is the one bulk call, at 157 KB per read.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tokocrypto API documentation, sections Change Log, General API Information, LIMITS, Public API Definitions, Order book, Query Execution Rules and the Price Range FAQ | https://www.tokocrypto.com/apidocs/ | 2026-09-22 | PT Aset Digital Berkat, Indonesia | hosts, symbol types, limits, status codes, depth limits, reference price formula, sections 2 to 6 |
| S2 | Tokocrypto system config | https://www.tokocrypto.com/v1/common/system-config | 2026-09-22 | Indonesia | `binanceApiBaseUrlList`, `nextMeApiBaseUrl`, section 1 |
| S3 | Binance spot REST API | https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md | 2026-09-22 | Binance | depth weights, section 5 |
| S4 | CCXT 4.5.68 `tokocrypto.js` | `server/node_modules/ccxt/js/src/tokocrypto.js` | 2026-09-22 | CCXT | market mapping and order book routing, section 2 |
| P1 | `rest-probe.mjs main` at 03:23 UTC and `poll` at 03:24 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/tokocrypto/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7, the first readings |
| P2 | `rest-probe.mjs main` at 03:33 UTC and `poll` at 03:34 UTC on 2026-09-23, the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/tokocrypto/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7, the second readings |
| H1 | `curl` and `dig` by hand, 03:15 to 03:22 UTC on 2026-09-23, and the `exchangeInfo` permission sets at 03:20 and about 03:43 UTC | `api.binance.com`, `www.tokocrypto.site`, `cloudme-toko.2meta.app` | 2026-09-22 | this host | the `ticker/bookTicker` comparison, `BTCIDR` permission sets, host resolution, section 2 |
