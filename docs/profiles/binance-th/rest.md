# Binance TH REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time (2026-10-10 UTC), from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the public REST API of Binance TH, which serves spot only, because Binance TH lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/binance-th/rest-probe.py).
Run 1 started at 02:54 UTC and run 2, the second pass, at 03:11 UTC, and a number that differed between them is written as a range.
The documentation is the API reference at `https://www.binance.th/api-docs/en/`, S1.
Where the documentation and the wire disagree, both are written, and the wire is what a client must handle.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| REST base | `https://api.binance.th`, every call under `/api/v1/` | S1, probed |
| DNS | `api.binance.th`, `nbstream.binance.th` and `www.binance.th` are all CNAMEs of `d39p5riyc753c.cloudfront.net`, 4 addresses in `18.161.6.0/24` | `host` |
| CDN | CloudFront, POP `HIO52-P1`, every reply `x-cache: Miss from cloudfront`, behind `server: nginx` | `host`, `cache` |
| cold request | `GET /api/v1/ping` first call 358 to 362 ms | `host`, runs 1 and 2 |
| warm request | `GET /api/v1/ping` median 164 to 175 ms over 5 calls, min 148 ms, max 386 ms | `host` |
| access | no geoblock and no refusal on any public call from the Canadian exit | `host`, `errors` |

`/api/v3/` paths answer HTTP 404 `Resource not found`, so the global Binance spot paths do not carry over.

## 2. Catalog

### The instruments call

`GET /api/v1/exchangeInfo`, weight 10 (S1), returned 385,076 bytes in 513 to 536 ms.
The shape is the global Binance spot shape: `timezone`, `serverTime`, `rateLimits`, `exchangeFilters` and `symbols`.
Each symbol carries `symbol`, `status`, `baseAsset`, `quoteAsset`, the precision fields, `filters`, `orderTypes`, `test` and a `type` field that global Binance does not have.

| count | value | probe |
|---|---|---|
| symbols | 512, all `status TRADING`, all `test 0` | `catalog` |
| by quote | USDT 383, USDC 107, THB 11, FDUSD 11 | `catalog` |
| by `type` | `GLOBAL` 507, `SITE` 5 | `catalog` |
| THB pairs | `SITE`: ATHTHB, BTCTHB, USDTTHB, VELOTHB, ZENTTHB. `GLOBAL`: ASTERTHB, BNBTHB, ETHTHB, PLUMETHB, SOLTHB, XRPTHB | `catalog` |
| distinct base assets | 387, of which 112 trade against more than one quote | `catalog` |
| derivatives | none, no symbol has a contract form, and `/fapi/v1/exchangeInfo`, `/dapi/v1/exchangeInfo` and `/api/v1/premiumIndex` answer HTTP 404 | `catalog` |

`GET /api/v1/symbolType`, weight 1, returned the same 512 symbols with the same `type` on every one.
S1 says "type will be GLOBAL or SITE".
It does not say what the two values mean, and section "The two books" below answers that from the wire.

The fee groups of [`fees.md`](./fees.md) do not follow `type`.
All 11 THB pairs are exchange pairs by the venue's trading rules page (S3), although 6 of them are `GLOBAL`.

### The two books

A `GLOBAL` symbol's book on Binance TH is the global Binance spot book for the same symbol.
The `mirror` mode read `GET /api/v1/depth?limit=20` on both venues one after the other.

| symbol | `lastUpdateId` on Binance TH minus Binance, read second | same price and size, of 40 levels |
|---|---|---|
| BTCUSDT | 20 in run 1, 11 in run 2 | 37 in run 1, 40 in run 2 |
| ETHUSDT | 9 in run 1, 5 in run 2 | 39 in run 1, 40 in run 2 |
| ETHTHB | 0 in both runs | 40 in both runs |
| BTCTHB, `SITE` | global Binance answers `{"code":-1121,"msg":"Invalid symbol."}` | |

The update ids run in the same sequence on both venues, so the book is one book seen twice.
The WebSocket profile shows the same thing on the stream, [`websocket.md`](./websocket.md) section 4.
So 507 of 512 Binance TH markets add no liquidity beyond global Binance, and only the 5 `SITE` THB pairs have a book of their own.
This matches the licence split of [`fees.md`](./fees.md) section 1 for crypto pairs, which go through the broker.

### How the engine's catalog would map it

There is no CCXT class, see [`fees.md`](./fees.md) section 8, so a catalog would be read from `exchangeInfo` directly.
`symbol` is base and quote joined in upper case on 512 of 512 symbols, and the socket wants it in lower case, see [`websocket.md`](./websocket.md) section 3.
The REST book also accepts `btcthb` in lower case, and refuses `BTC_THB` with `-1121`.
There is no contract size, and book sizes are in the base asset, as on any Binance spot book.
No pair is listed twice.

## 3. Anchor

Binance TH publishes no index, no mark price and no funding rate, because it lists no perpetual.
No anchor poller is recommended.

The API has one price that is neither, `GET /api/v1/referencePrice`, weight 1 (S1).

| call | result | probe |
|---|---|---|
| `?symbol=BTCUSDT` | `{"symbol":"BTCUSDT","referencePrice":"82645.93358649","timestamp":1791600901005}` in run 1, a price in run 2 as well | `refprice` |
| `?symbol=ETHTHB` | a price in run 1, `"referencePrice":null` with a timestamp 10 minutes old in run 2 | `refprice` |
| `?symbol=BTCTHB` or `USDTTHB`, the `SITE` pairs | HTTP 400 `{"code":-1000,"msg":"An unknown error occured while processing the request."}` | `refprice` |
| no symbol, documented as "all symbols" | the same HTTP 400 `-1000` | `refprice` |
| 10 one second polls of BTCUSDT | 2 distinct prices and 2 distinct timestamps in both runs | `refprice` |

S1 gives no formula for the reference price.
It looks like the anchor of the price range rule that `GET /api/v1/executionRules` describes.
That call returned 1,588 rows, more than the 512 listed symbols, and every multiplier on every row was `null`.
With a symbol it answered for BTCUSDT and failed with `-1000` for BTCTHB.

## 4. Anchor semantics

Not offered.
There is no index basket, mark formula or funding formula to record, and the reference price above has no published formula.

## 5. REST book snapshot

`GET /api/v1/depth?symbol=<SYMBOL>&limit=<n>` (S1).

| item | documented | probed |
|---|---|---|
| limits | default 500, max 1000, "If limit > 1000, then the response will truncate to 1000" | default 500 levels. `limit=1000` is accepted. `limit=5000` is refused with HTTP 400 `{"code":-1130,"msg":"Data sent for parameter 'limit' is not valid."}`, not truncated. `limit=7` is accepted. `limit=0` is refused with `-1130` |
| weight | 1 for 1 to 100, 5 for 101 to 500, 10 for 501 to 1000 | the `x-mbx-used-weight-1m` header rose by 2, 5, 10 and 20 after the 20, 100, 500 and 1000 level calls, so 1000 levels cost 20 and 20 levels cost 2 on the wire |
| shape | `{lastUpdateId, bids, asks}`, levels `[price, qty]` as strings | as documented, strings |
| level order | not stated | bids descending and asks ascending on every call of every symbol |
| book size | | BTCTHB had 764 to 770 bids and 388 to 389 asks in total, USDTTHB 137 bids and 92 asks, ETHTHB 94 bids and 97 to 98 asks, BTCUSDT filled 1000 per side |
| caching | not stated | none seen. `lastUpdateId` changed in 13 and 19 of 19 one second steps on BTCTHB in runs 1 and 2, and 19 of 19 on BTCUSDT in both |
| reply time | | 140 to 285 ms for every limit |

`GET /api/v1/ticker/bookTicker` without a symbol returned all 512 symbols in 61,279 to 61,325 bytes, with no empty side on any row.
S1 marks the symbol as required, and the wire does not.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| IP weight | 1,000 per 10 seconds and 6,000 per minute (S1, section "Rate Limits & Throughput Management") | `exchangeInfo.rateLimits` lists only `REQUEST_WEIGHT` 6,000 per minute, and `ORDERS` 6,000 per minute and 1,000 per 10 seconds |
| weight header | `X-MBX-USED-WEIGHT-10S` and `X-MBX-USED-WEIGHT-1M` | only `x-mbx-used-weight-1m` is sent |
| 429, 418 and `Retry-After` | 429 on a limit, 418 on an automatic ban of 2 minutes to 3 days, `Retry-After` in seconds on both | not provoked |
| 403 | "the WAF Limit (Web Application Firewall) has been violated" | not seen |
| a refused `limit=5000` | | the refused call and the next 5 level call raised the minute counter by 102 together, three times in each run, so a refused call is not free |
| response wrapper | S1 says every reply has `code`, `msg`, `timestamp` and `data` | public replies are bare objects and arrays, as on global Binance |

Error shapes seen on the wire.

| request | status | body |
|---|---|---|
| unknown symbol `NOPETHB` | 400 | `{"code":-1121,"msg":"Invalid symbol."}` |
| missing symbol | 400 | `{"code":-1102,"msg":"Mandatory parameter 'symbol' was not sent, was empty/null, or malformed."}` |
| bad limit | 400 | `{"code":-1130,"msg":"Data sent for parameter 'limit' is not valid."}` |
| unknown path | 404 | HTML `Resource not found` |
| signed call without a key | 401 | `{"code":-2014,"msg":"API-key format invalid."}` |

## 7. Server time and clock offset

`GET /api/v1/time` returns `{"serverTime":<ms>}`, weight 1.
Five samples by the midpoint method put the server 22 to 34 ms ahead of this host, median 23 ms in run 1 and 25 ms in run 2.

## 8. Recommended poller shape

No anchor poller, because there is no index, mark or funding.
The venue cannot join the engine as a perpetual leg.

For a future spot leg, the catalog is `GET /api/v1/exchangeInfo` once at start, and only the 5 `SITE` pairs are worth a feed of their own.
The 507 `GLOBAL` pairs repeat the global Binance book, so a Binance spot feed already sees them.
The REST book seeds the diff stream of [`websocket.md`](./websocket.md) section 8 at `limit=1000`, weight 20 on the wire.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | API reference `https://www.binance.th/api-docs/en/` | 2026-10-09 |
| S2 | global Binance spot REST `https://api.binance.com/api/v3/depth`, read only to compare books | 2026-10-10 UTC |
| S3 | trading rules page `https://www.binance.th/en/faq/trading-rules/d2268ea48e42411785a71351be67153f`, sections "Exchange Pair [ THB ]", "Broker Pair [ Others ]" and "Broker Pair [ USDT ]" | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/binance-th/rest-probe.py), runs 1 and 2 | 2026-10-10 UTC |
