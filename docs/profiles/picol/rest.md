# Picol REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:28 to 03:47 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the public REST surfaces of Picol for its perpetuals: the catalog, the bulk anchor call, the funding history, the book snapshot, limits and errors.
Picol documents three quotation calls on `www.picol.com`, S1 to S4.
Every Pionex open API call tried also answered on `api.picol.com`, which Picol does not document.
[`rest-probe.py`](../../../scripts/probes/venues/picol/rest-probe.py) sent each call to `api.picol.com` and to `api.pionex.com` side by side.
The catalog, the funding history and the anchor are the Pionex ones, and the REST book and trades are the Pionex ones with the sizes multiplied by 0.882.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api.picol.com`, not documented by Picol. The documented calls live under `https://www.picol.com/quotation/`, S2 to S4 |
| resolution | `api.picol.com` resolved to `3.169.173.22`, `.43`, `.53` and `.66`, and `ws.picol.com` to `143.204.1.22`, `.33`, `.106` and `.123` |
| edge | CloudFront, by the `via`, `x-cache` and `x-amz-cf-pop` `HIO52-P4` headers, in front of `server: APISIX/3.13.0`. The Pionex host resolved to Cloudflare addresses instead |
| cold request, `GET /api/v1/market/indexes` on a new TLS connection | 77 to 120 ms over 12 requests in four runs, for 99.2 KB |
| warm request, the same call on a kept connection | median 59 to 62 ms, max 67 to 88 ms, over 10 polls in each of four runs |
| compression | `content-encoding: gzip` when asked, 13,929 to 14,038 bytes on the wire against 99.2 KB |
| access from this exit | every public call answered, with no geoblock and no challenge. `www.picol.com` pages answered 200, and `support.picol.com` does not resolve |

All values are from P1 to P4.

## 2. Catalog

### Picol's documented API

Picol's API documentation is a GitBook of three calls, S1:

| call | parameters | probed |
|---|---|---|
| `GET https://www.picol.com/quotation/order_book` | `base` such as `BTC.PERP`, `quote` `USDT`, `limit` 1 to 150 | 150 levels a side at `limit=150`. At `limit=151` it answered 200 with 1 level a side. An unknown base answered 200 with `"data":null`. The `timestamp` is in seconds |
| `GET https://www.picol.com/quotation/ticker` | `base`, `quote` | one market per call, with `price`, `high`, `low`, `volume` and `volume_to`. Without parameters it answered 400 `P_QUOTATION_INVALID_PARAMS`. `/quotation/tickers` answered 404 |
| `GET https://www.picol.com/quotation/trades_history` | `base`, `quote` | 49 or 50 trades with `exchange` `picol` |

None of the three lists markets, and none carries index, mark or funding.
The `order_book` sizes did not track the Pionex book at a fixed ratio: at the same prices they ran 0.21 to 2.71 times the Pionex sizes, median 0.70 and 0.75, P3 and P4.
So the documented API is a feed for listing sites, not a catalog or an anchor.

### The instruments call

`GET https://api.picol.com/api/v1/common/symbols?type=PERP` returned 602 rows in 249,181 bytes, all `TRADING`, P1 to P4.
`api.pionex.com` returned the same 602 rows, and not one field differed between the two replies in any run.
Without `type` both hosts returned the same 411 spot symbols, 340 with `enable` true.

| family | symbol shape | count |
|---|---|---:|
| USDT-M | `<BASE>_USDT_PERP`, including `USD_USDT_PERP` | 554 |
| coin-quoted | `<BASE>_BTC_PERP`, `_ETH_PERP`, `_SOL_PERP` | 23: 11 BTC, 9 ETH, 3 SOL |
| USDT priced in a coin | `USDT_<COIN>_PERP` | 24 |
| quoted in a tokenized stock | `SPCX_TSLAX_PERP` | 1 |

The `BTC_USDT_PERP` row, whole:

```json
{"symbol":"BTC_USDT_PERP","name":"BTC USDT PERPETUAL","type":"PERP","baseCurrency":"BTC","quoteCurrency":"USDT","basePrecision":4,"quotePrecision":1,"minNotional":"1","baseStep":"0.0001","quoteStep":"0.1","minSizeLimit":"0.0001","maxSizeLimit":"500","maxImpactLimit":"0.05","minSizeMarket":"0.0001","maxSizeMarket":"100","maxImpactMarket":"0.05","maxOrderNum":200,"status":"TRADING","liquidationFeeRate":"0.0115"}
```

Five symbols are not ASCII, such as `币安人生_USDT_PERP`.
17 USDT-M symbols carry a `baseCurrency` other than their prefix, such as `1INCH_USDT_PERP` with `INCH` and `0G_USDT_PERP` with `ZEROG`.
No USDT-M base is listed twice.

### How CCXT 4.5.68 maps it

CCXT has no Picol class, see [`fees.md`](./fees.md) section 8.
The Pionex adapter maps this exact reply already, see [`../../../server/src/venues/pionex/markets.rs`](../../../server/src/venues/pionex/markets.rs) line 13, and the mapping notes of [`../pionex/rest.md`](../pionex/rest.md) section 2 apply unchanged.
`market.id` is the `symbol`, which the socket and the anchor reply spell the same way.
`contractSize` is 1, since the socket book is in base currency, see [`websocket.md`](./websocket.md) section 4.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET https://api.picol.com/api/v1/market/indexes` | `indexPrice` | `markPrice` | `nextFundingRate` | absent | `nextFundingTime`, Unix ms | 601 rows, 99.2 KB, 13.9 to 14.0 KB gzip | median 58 to 60 ms, max 76 to 295 ms over four runs of 60 polls |
| `GET https://api.picol.com/api/v1/market/fundingRates?symbol=<id>&limit=3` | | | the last settled `fundingRate` | the gap between `fundingTime` values | | one symbol per call, the list under `data.rates` | P2 to P4 |

`USD_USDT_PERP` has no `indexes` row, and no row had a mark of 0.
`nextFundingTime` read 04:00 UTC on 387 rows and 08:00 UTC on 214 in every run.
`updateTime` was 334 to 1,285 ms older than the reply's `timestamp`, median 534 to 885 ms over four runs.

| `AnchorRow` column | field | conversion |
|---|---|---|
| key | `symbol` | none |
| `index` | `indexPrice` | `Number()` of the string |
| `mark` | `markPrice` | `Number()` |
| `fundingRate` | `nextFundingRate`, a fraction per interval | `Number()` |
| `fundingIntervalHours` | none in the bulk reply | from the funding history |
| `nextFundingAt` | `nextFundingTime` | none |

### Against Pionex

Fetched at the same moment, the two `indexes` replies had the same 601 symbols and the same `nextFundingTime` on all 601 in four runs.
`nextFundingRate` matched on 601, 568, 595 and 575 rows.
Rows that carried the same `updateTime` on both hosts were identical on 42 of 65, 40 of 47, 266 of 280 and 277 of 304.
In P4 the rest differed in `indexPrice` on 16 rows and in `nextFundingRate` on 11, and never in `markPrice`.
So the two hosts read one anchor service, though a few rows differ at the same `updateTime`.
The funding history of `BTC_USDT_PERP`, `ETH_USDT_PERP`, `SOL_USDT_PERP`, `ACE_USDT_PERP`, `AAX_USDT_PERP`, `BTC_ETH_PERP` and `USDT_BTC_PERP` was identical on both hosts: 8 h gaps on five of them, 4 h on `ACE_USDT_PERP` and 1 h on `AAX_USDT_PERP`.
So the Picol anchor is the Pionex anchor.

## 4. Anchor semantics

Picol publishes no index or mark article of its own in the pages read.
Its funding article repeats the Pionex formula, see [`fees.md`](./fees.md) section 6.
The index, mark and funding semantics are therefore those of [`../pionex/rest.md`](../pionex/rest.md) section 4, including the mark that adds a five minute average of the venue's own basis to the index.

Over 59 intervals of one second polls in each run, P1 to P4:

| field | rows changed per poll, of 601 | `BTC_USDT_PERP` | `ETH_USDT_PERP` | `SOL_USDT_PERP` |
|---|---|---:|---:|---:|
| `indexPrice` | median 296 to 311 | 56 to 59 of 59 | 56 to 57 | 53 to 57 |
| `markPrice` | median 292 to 319 | 18 to 59 | 7 to 50 | 19 to 53 |
| `nextFundingRate` | median 0, max 91 to 141 | 1 each run | 1 | 1 |
| `nextFundingTime` | 0 | 0 | 0 | 0 |

So the reply republishes about once a second, as on Pionex.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET https://api.picol.com/api/v1/market/depth?symbol=BTC_USDT_PERP&limit=<n>` |
| depth | 20, 100 and 1,000 levels a side returned, and `limit=2000` answered `MARKET_PARAMETER_ERROR` `limit error` |
| level order | bids descending and asks ascending at every limit |
| time and size | 26 to 56 ms, about 930 bytes at 20 levels and 40.3 to 40.4 KB at 1,000 |
| freshness | `updateTime` 192 to 418 ms older than the reply `timestamp` |
| best bid and ask for all perpetuals | `GET /api/v1/market/bookTickers?type=PERP`, 599 rows, 78.8 KB, in every run |

The REST book differs from the Pionex REST book in one way.
At the same `updateTime` the price ladder was identical, and the sizes were 0.882 times the Pionex sizes, in five simultaneous pairs per symbol in each of P2 to P4:

| symbol | pairs with the same `updateTime` | Picol size over Pionex size |
|---|---|---|
| `BTC_USDT_PERP` | 15 of 15 | 0.8820 on every level |
| `ETH_USDT_PERP` | 14 of 15 | 0.8820 on every level |
| `SOL_USDT_PERP` | 15 of 15 | 0.8750 to 0.9000 in P2, 0.8820 on every level in P3 and P4 |
| `DOGE_USDT_PERP` | 15 of 15 | 0.8820 on every level |
| `BTC_USDT`, spot | 14 of 15 | median 0.8820, with 0.8791 to 0.8846 on some levels and one level at 1.0000 in P3 |
| `ETH_USDT`, spot | 10 of 15 | 0.8820 on every level |

The REST trades do the same.
The last 50 trades of `BTC_USDT_PERP` and `ETH_USDT_PERP` carried the same `tradeId`, price, side and time on both hosts, 49 or 50 of 50 per run, and Picol's sizes were 0.8820 times Pionex's at the median, P2 to P4.
The socket does not scale, see [`websocket.md`](./websocket.md) section 4, so the socket and the Pionex REST agree, and the Picol REST sizes are a display scale.
A reader that takes a Picol REST snapshot and applies socket deltas would mix the two.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| budget | not documented by Picol. Pionex documents 10 a second per IP, see [`../pionex/rest.md`](../pionex/rest.md) section 6 | `x-ratelimit-tokens` read 29 after a market call and 25 or just below after a catalog call, the Pionex bucket |
| on excess | not documented | not provoked |
| error shape | | HTTP 200 with `{"result":false,"code":"…","message":"…","timestamp":<s>}` |
| unknown route | | HTTP 404 `{"error_msg":"404 Route Not Found"}` |

| request on `api.picol.com` | reply |
|---|---|
| `depth?symbol=NOPE_USDT_PERP` | 200 `MARKET_INVALID_SYMBOL` `symbol error` |
| `depth?symbol=BTC_USDT_PERP&limit=2000` | 200 `MARKET_PARAMETER_ERROR` `limit error` |
| `indexes?symbol=NOPE_USDT_PERP` | 200 `MARKET_PARAMETER_ERROR` `symbol error` |
| `fundingRates?symbol=BTC_USDT` | 200 `MARKET_INVALID_SYMBOL` `symbol error` |
| `common/symbols?type=FUTURES` | 200 `MARKET_PARAMETER_ERROR` `type error` |
| `market/bookTicker?type=PERP`, `common/timestamp`, `/api/v1/nope` | 404 `{"error_msg":"404 Route Not Found"}` |

## 7. Server time and clock offset

No server time call exists, and `/api/v1/common/timestamp` answered 404.
The `timestamp` of a depth reply minus the local midpoint of the request was -29 to 26 ms, median 17 to 21 ms, with a median round trip of 36 to 42 ms, over 10 calls in each of P2 to P4.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

The Pionex adapter's anchor poller at [`../../../server/src/venues/pionex/anchor.rs`](../../../server/src/venues/pionex/anchor.rs) reads this exact reply.
A Picol poller is that poller with `REST` at [`../../../server/src/venues/pionex.rs`](../../../server/src/venues/pionex.rs) line 22 set to `https://api.picol.com`, and every rule of [`../pionex/rest.md`](../pionex/rest.md) section 8 unchanged.
It would read the Pionex anchor, so a Picol leg brings no index, mark or rate the Pionex leg lacks.
The design question it raises is only whether the engine wants the Pionex book twice, once at the 500 ppm Pionex taker and once at the 600 ppm Picol taker.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Picol APIDocs index | https://picol-doc.gitbook.io/apidocs/llms.txt, linked from the web app as `open_api_docs` | 2026-10-09 | Picol | section 2 |
| S2 | Get Order Book | https://picol-doc.gitbook.io/apidocs/markets/get-order-book.md | 2026-10-09 | Picol | section 2 |
| S3 | Get Ticker | https://picol-doc.gitbook.io/apidocs/markets/get-ticker.md | 2026-10-09 | Picol | section 2 |
| S4 | Get Trades History | https://picol-doc.gitbook.io/apidocs/markets/get-trades-history.md | 2026-10-09 | Picol | section 2 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/picol/rest-probe.py), first run at 03:28 UTC, before the size ratio, trade, funding key and clock fixes | | 2026-10-10 UTC | this host | sections 1 to 6 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/picol/rest-probe.py), run at 03:31 UTC, with the trade comparison | | 2026-10-10 UTC | this host | sections 1 to 7 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/picol/rest-probe.py), run at 03:39 UTC, with the quotation calls | | 2026-10-10 UTC | this host | sections 1 to 7 |
| P4 | [`rest-probe.py`](../../../scripts/probes/venues/picol/rest-probe.py), second pass at 03:45 UTC, with the field check of the anchor comparison | | 2026-10-10 UTC | this host | sections 1 to 7 |
