# Binance TR REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 02:52 to 03:12 UTC, from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

Binance TR lists no perpetual, so this profile covers its spot catalog and REST book, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The main finding is that every Binance TR market is a Binance.com TRY book served through Binance TR hosts, with the same update ids and the same levels.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/binance-tr/rest-probe.py), run 1 at 02:55 UTC and run 2 at 03:07 UTC in the second pass, unless a row says otherwise.

## 1. Host and latency from this machine

The API docs name `https://www.binance.tr` as the base and `https://api.binance.me` for "some specified APIs", which are the market data calls of `type` 1 symbols, S1.
The web app's `/v1/common/system-config` lists `https://api.binance.com` and `https://edge.binance.tr` as its Binance API bases, S2.
`www.trbinance.com` still answers `/open/v1/common/time` with the same reply as `www.binance.tr`.

| host | resolved from this host | front | role |
|---|---|---|---|
| `www.binance.tr` | 4 CloudFront addresses in 3.163.24.0/24, canonical `d3rjhwwbxn9e0o.cloudfront.net` | CloudFront POP `HIO52`, `server: elb` | `/open/v1` calls: time, catalog, wrapped book |
| `api.binance.me` | 204.246.177.105 | CloudFront POP `HIO52`, `server: nginx` | Binance `/api/v3` market data |
| `edge.binance.tr` | 4 CloudFront addresses in 18.161.6.0/24, canonical `d2qus5y0flm162.cloudfront.net` | CloudFront POP `FRA60`, `server: elb` | Binance `/api/v3` market data, the web app's second base |
| `api.binance.com` | one CloudFront address, canonical `d3h36i1mno13q3.cloudfront.net` | CloudFront | Binance.com itself |

No host refused this exit, and none answered with a challenge page.

| call | run 1, three requests, the first cold | run 2 |
|---|---|---|
| `www.binance.tr/open/v1/common/time` | 630, 235 and 781 ms | 801, 233 and 789 ms |
| `www.binance.tr/open/v1/common/symbols`, about 462,515 B | 1,180, 424 and 1,144 ms | 1,141, 419 and 1,160 ms |
| `api.binance.me/api/v3/depth?symbol=BTCTRY&limit=20` | 476, 436 and 146 ms | 438, 347 and 434 ms |
| `www.binance.tr/open/v1/market/depth?symbol=BTC_TRY&limit=20` | 489, 488 and 488 ms | 588, 727 and 537 ms |
| `edge.binance.tr/api/v3/depth?symbol=BTCTRY&limit=20` | 1,454, 564 and 668 ms | 1,140, 488 and 569 ms |

`edge.binance.tr` is served from Frankfurt to this host and is the slowest.
`api.binance.com` answered the same book in 135 to 147 ms in run 1 and 136 to 142 ms in run 2, except one ETHTRY read of 327 to 330 ms in each run, section 2.

## 2. Catalog

### The instruments call

`GET https://www.binance.tr/open/v1/common/symbols` takes no parameters and returns `{"code":0,"msg":"Success","data":{"list":[...]},"timestamp":...}`, S1.

| field | value on every row | count |
|---|---|---|
| rows | | 309 |
| `type` | 1, which the docs call "Main" | 309 |
| `quoteAsset` | `TRY` | 309 |
| `permissions` | `["SPOT"]` | 309 |
| `spotTradingEnable`, `marginTradingEnable` | 1, 0 | 309 |
| a status field | none. The row keys are `allowedSelfTradePreventionModes`, `baseAsset`, `basePrecision`, `defaultSelfTradePreventionMode`, `filters`, `icebergEnable`, `marginTradingEnable`, `ocoEnable`, `orderTypes`, `permissions`, `quoteAsset`, `quotePrecision`, `spotTradingEnable`, `symbol` and `type` | |

`symbol` is spelled `BTC_TRY`.
The `type` 1 market data calls on `api.binance.me` and the stream host want it without the underscore, `BTCTRY`, and lower case on the socket, S1.
`BTC_TRY` filters include `PRICE_FILTER` tick 1 TRY, `LOT_SIZE` step 0.00001, `NOTIONAL` minimum 10 TRY and `PERCENT_PRICE_BY_SIDE`, the same filter set Binance.com publishes.

There is no perpetual in the catalog, and section 3 shows the derivative paths that were tried.

### The same pairs as Binance.com

`api.binance.com/api/v3/exchangeInfo?permissions=SPOT` lists 369 TRY pairs, 310 `TRADING` and 59 `BREAK`.
All 309 Binance TR symbols, with the underscore removed, are among the 310 trading ones.
The one Binance.com trading TRY pair missing from Binance TR was `ZAMATRY` in both runs.
No Binance TR symbol is absent from Binance.com.

### One book, not two

Section 5 of the probe read BTCTRY and ETHTRY from the four hosts in quick succession, three rounds each.

| run 1 round, unless named | `api.binance.me` | `www.binance.tr/open/v1` | `edge.binance.tr` | `api.binance.com` |
|---|---|---|---|---|
| BTCTRY 1 | id 5987818881, bid 4065012, ask 4065505 | id 5987818881, same levels | id 5987818881, same levels | id 5987818881, same levels |
| BTCTRY 3 | id 5987818896 | 5987818896 | 5987818896 | 5987818896 |
| ETHTRY 1 | id 4488416514 | 4488416526 | 4488416528 | 4488416528, same levels as `edge` |
| run 2, BTCTRY 1 | id 5987823644, bid 4065133, ask 4065310 | 5987823644, same levels | 5987823644, same levels | 5987823644, same levels |
| run 2, ETHTRY 1 | id 4488423397, bid 122699, ask 122700 | 4488423397, same levels | 4488423397, same levels | 4488423397, same levels |

Where two hosts were read at the same update id, their levels were identical, and ETHTRY ids differ only because the four requests were sequential on a busier book.
`api.binance.me` also serves `BTCUSDT`, which is not a Binance TR market, with a Binance.com update id of about 101,261,313,335, section 7 of the probe.
The socket shows the same thing, [`websocket.md`](./websocket.md) section 4.
So Binance TR is an account and fee layer on Binance.com's TRY books, and the books carry no Binance TR specific liquidity that the engine could not already read from Binance.com.

### How CCXT 4.5.68 maps it

There is no Binance TR class.
The `binance` class loads the same pairs from `https://api.binance.com/api/v3`, at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/binance.js` line 246, with `market.id` `BTCTRY`, which is the spelling `api.binance.me` and the stream host use.
Book sizes are base asset quantities, so a spot contract size of 1 is right.
No pair is listed twice, since every row is a distinct TRY pair.

## 3. Anchor

Binance TR publishes no index, no mark and no funding rate, because it lists no perpetual.

| path tried | reply |
|---|---|
| `api.binance.me/fapi/v1/premiumIndex?symbol=BTCUSDT` | HTTP 403, empty body |
| `api.binance.me/fapi/v1/exchangeInfo` | HTTP 403, empty body |
| `www.binance.tr/fapi/v1/premiumIndex` | HTTP 404, the site's HTML error page |
| `edge.binance.tr/fapi/v1/premiumIndex?symbol=BTCUSDT` | HTTP 404, nginx page |
| `www.binance.tr/open/v1/futures/symbols`, `/open/v1/market/mark-price`, `/open/v1/market/funding-rate` | HTTP 200 with `{"code":404,"msg":"Not Found",...}` |

The reference prices that do exist are Binance.com's own spot calls served on `api.binance.me`, none of them documented by Binance TR:

| call | reply |
|---|---|
| `/api/v3/avgPrice?symbol=BTCTRY` | `{"mins":5,"price":"4066520.01496974","closeTime":...}`, a 5 minute average price |
| `/api/v3/ticker/price?symbol=BTCTRY` | last price |
| `/api/v3/ticker/bookTicker?symbol=BTCTRY` | best bid and ask with sizes |

No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

## 5. REST book snapshot

| call | documented | probed |
|---|---|---|
| `GET https://api.binance.me/api/v3/depth?symbol=BTCTRY&limit=N` | "Default 100; max 5000. Valid limits:[5, 10, 20, 50, 100, 500]", S1 | a bare Binance reply `{"lastUpdateId","bids","asks"}` without the `code` and `data` wrapper the docs show. Limits 1, 5, 7, 20, 100 and 500 returned that many levels per side. Limit 1000 returned 821 bids and 1,000 asks in run 1 and 829 and 1,000 in run 2, and 5000 returned 821 and 1,162, then 830 and 1,158, the whole thin book |
| `GET https://www.binance.tr/open/v1/market/depth?symbol=BTC_TRY&limit=N` | not in the docs | the same book in the `{"code":0,"msg":"Success","data":{...},"timestamp"}` wrapper, 5, 50, 100 and 500 levels at those limits, `cache-control: no-cache,no-store` |
| level order | not stated | bids descending and asks ascending at every limit |
| weight | not stated by Binance TR | the `x-mbx-used-weight-1m` header rose by 5 for limits up to 100, 25 for 500, 50 for 1000 and 250 for 5000, which is Binance.com's spot depth weight table |
| caching | | `x-cache: Miss from cloudfront` on every book read |

The update id is Binance.com's id, so it chains with the stream's `U` and `u`, [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

The docs give Binance's rules: 403 for a WAF limit, 429 for a rate limit, 418 for an auto ban after continued 429s, bans from 2 minutes to 3 days, and `Retry-After` on 418 and 429, S1.
They name the `X-MBX-USED-WEIGHT-(intervalNum)(intervalLetter)` header but no number.

| host | header seen | meaning |
|---|---|---|
| `api.binance.me` | `x-mbx-used-weight` and `x-mbx-used-weight-1m` | the count rose from 25 to 371 across run 1 and from 104 to 455 across run 2, including weight spent on `api.binance.com` in between, so the two hosts appear to share one per IP counter |
| `www.binance.tr` | `X-Mbx-Request-Weight-1m: 1200`, and `X-Mbx-Used-Weight-1m` 36 in run 1 and 78 in run 2 | a separate limit of 1,200 per minute for the `/open/v1` calls |

No request of the probe met a 403, 418 or 429.

| request | reply |
|---|---|
| `api.binance.me` depth for `NOPETRY` | HTTP 400 `{"code":-1121,"msg":"Invalid symbol."}` |
| `api.binance.me` depth for `BTC_TRY` | HTTP 400, same body, so the underscore spelling is refused there |
| `www.binance.tr/open/v1/market/depth` for `NOPE_TRY` or `BTCTRY` | HTTP 200 `{"code":2802,"msg":"Trading pair does not exist",...}` |
| `www.binance.tr/open/v1/nope` | HTTP 200 `{"code":404,"msg":"Not Found",...}` |

A client of `www.binance.tr` must read `code`, since an error arrives with HTTP 200.

## 7. Server time and clock offset

| call | reply | offset in run 1, then run 2 |
|---|---|---|
| `www.binance.tr/open/v1/common/time` | `{"code":0,"msg":"Success","data":null,"timestamp":...}`, the time in `timestamp`, not in `data` | +54 ms against the local midpoint with a 296 ms round trip, then +27 ms with 237 ms |
| `api.binance.me/api/v3/time` | `{"serverTime":...}` | +23 ms with 144 ms, then +165 ms with 434 ms |

## 8. Recommended poller shape

No anchor poller is recommended, because there is no index, mark or funding.
No catalog loader is recommended either.
Binance TR's markets are Binance.com TRY books that the `binance` class and `api.binance.com` already serve, so a spot leg on them would be built from Binance.com, with Binance TR's 2,000 ppm taker from [`fees.md`](./fees.md) applied only for a Binance TR account.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Binance TR API documentation | https://www.binance.tr/apidocs/ | 2026-10-10 UTC, change log head 2026-08-28 | Binance TR | hosts, symbol types and spelling, depth limits, error and limit rules, sections 1, 2, 5 and 6 |
| S2 | Binance TR web app `/v1/common/system-config` | https://www.binance.tr/v1/common/system-config | 2026-10-10 UTC | Binance TR | Binance API and stream bases of the web app, section 1 |
| S3 | Binance spot WebSocket streams documentation | https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md | 2026-10-10 UTC | Binance.com | local book recovery with the depth snapshot, section 5 |
| P1 | `rest-probe.py`, run 1 at 02:55 UTC and run 2 at 03:07 UTC | [`rest-probe.py`](../../../scripts/probes/venues/binance-tr/rest-probe.py) | 2026-10-10 UTC | this host | every probed row |
| P2 | `fees-probe.py` section 3 | [`fees-probe.py`](../../../scripts/probes/venues/binance-tr/fees-probe.py) | 2026-10-10 UTC | this host | the system-config bases, section 1 |
