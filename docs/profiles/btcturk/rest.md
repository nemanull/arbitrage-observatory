# BtcTurk REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:14 to 03:38 UTC, from the development host near Seattle.

This profile covers the public REST API of BtcTurk | Kripto (CCXT id `btcturk`), which is spot only, see [`fees.md`](./fees.md) section 3.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/btcturk/rest-probe.mjs), run 1 from 03:29 to 03:31 UTC and run 2, the rerun of every mode, from 03:36 to 03:38 UTC.
The documentation is the API site at `docs.btcturk.com`, S1 to S6, which this host could read.

## 1. Host and latency from this machine

| name | IPv4 | IPv6 |
|---|---|---|
| `api.btcturk.com` | `104.18.37.73`, `172.64.150.183` | `2a06:98c1:3100::ac40:96b7`, `2a06:98c1:3100::6812:2549` |
| `ws-feed-pro.btcturk.com` | same two | same two |
| `graph-api.btcturk.com` | same two | same two |

All three names are Cloudflare addresses, and the documentation places the servers in Azure West Europe, S5.
Replies carried `server: cloudflare` and a `cf-ray` ending in `YVR` or `SEA`.

| call | reply size | first request, run 1 and run 2 | warm median of 5, run 1 and run 2 | warm max |
|---|---|---|---|---|
| `GET /api/v2/server/time` | 78 bytes | 475 and 345 ms | 252.5 and 283.9 ms | 338.9 and 555 ms |
| `GET /api/v2/ticker` | 109,972 and 109,979 bytes | 316 and 286 ms | 269.6 and 264.4 ms | 350.6 and 280.8 ms |
| `GET /api/v2/orderbook?pairSymbol=BTCUSDT` | 4,701 bytes | 196 and 213 ms | 198.1 and 214.4 ms | 201.2 and 223.9 ms |
| `GET /api/v2/server/exchangeinfo` | 354,645 and 354,650 bytes | 728 and 999 ms | 538.4 and 591.1 ms | 669.2 and 970.5 ms |

The `server/time` row opened the connection in each run, and the later rows reused it, so only that first figure includes the TLS handshake.
Sizes are the decompressed body, and every reply in this table was gzip encoded.

## 2. Catalog

### The instruments call

`GET https://api.btcturk.com/api/v2/server/exchangeinfo` returns `data.symbols`, `data.currencies` and `data.currencyOperationBlocks`, S1.

| item | run 1 | run 2 |
|---|---|---|
| symbols | 379 | 379 |
| `status` | `TRADING` on 379 | `TRADING` on 379 |
| quoted in TRY | 190 | 190 |
| quoted in USDT | 189 | 189 |
| bases listed against both TRY and USDT | 189 | 189 |
| `name` equal to `numerator` plus `denominator` | 379 | 379 |
| `hasFraction` true | 375 | 375 |
| order methods without `MARKET` | 25, `LIMIT` and `STOP_LIMIT` only | 25 |

Status values other than `TRADING` are Not publicly specified, and none was seen.
`BTCUSDT` has `tickSize` `"1"` and `denominatorScale` 0, so its tick of 1 USDT is about 11.5 ppm at a price near 86,700.
`maximumLimitOrderPrice` and `minimumLimitOrderPrice` are ten times and a tenth of the current price, updated dynamically, S1.
The reply carries `cache-control: public, max-age=30, s-maxage=30, must-revalidate`, so it may be up to 30 s old.

### How CCXT 4.5.68 maps it

`fetchMarkets` calls `server/exchangeinfo`, at `server/node_modules/ccxt/js/src/btcturk.js` line 260, and `parseMarket` builds each market at lines 309 to 346.

| field | CCXT value | probed |
|---|---|---|
| markets | 379 | 379 in both runs |
| `type` | `spot`, `swap` false | 0 swap markets |
| `active` | `status === 'TRADING'` | 379 active |
| `id` | `name`, `BTCUSDT` | equal to the REST `name` on 379 of 379, and to the socket `PS`, see [`websocket.md`](./websocket.md) section 3 |
| `contractSize` | undefined | undefined on 379 |
| `linear` | undefined | undefined on 379 |
| `taker`, `maker` | 0.0009, 0.0005 from the class defaults at lines 236 to 241 | on 379, see [`fees.md`](./fees.md) section 8 |

### How the engine's catalog would map it

- The connector keeps only active swap markets, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202, so BtcTurk would yield zero markets and be skipped at lines 50 to 53.
- If spot were ever admitted, `market.id` is the right `rawMarketId`, because the socket's `PS` spells the pair the same way.
  The REST book also accepts `btcusdt` and `BTC_USDT`, section 6, but the socket is case sensitive.
- Sizes are in the base asset on REST and on the socket, and an undefined `contractSize` becomes 1 at lines 188 to 194, which is right.
- TRY is outside the quote family at [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a TRY pair would form a cluster with no other venue in it.
  Only the 189 USDT pairs could meet other venues.
- No pair is listed twice against USDT, so no `marketFilter` is needed, and no price scale applies to a spot pair.

## 3. Anchor

BtcTurk publishes no index price, no mark price and no funding rate, because it lists no perpetual.

| `AnchorRow` column | BtcTurk field |
|---|---|
| `index` | none |
| `mark` | none |
| `fundingRate` | none |
| `fundingIntervalHours` | none |
| `nextFundingAt` | none |

The only published reference prices are the ticker's `last`, `bid`, `ask` and 24 h `average` from `GET /api/v2/ticker`, S2, and the candles of `GET https://graph-api.btcturk.com/v1/ohlcs` and `/v1/klines/history`, S3.
None of them is an index.

## 4. Anchor semantics

There is no index, mark or funding formula to record.
For context on how often the bulk ticker changes, `rest-probe.mjs poll` read it once a second for 30 polls in each run.

| item | run 1 | run 2 |
|---|---|---|
| reply time, min, median, p90, max | 250.7, 265.1, 354.1, 830.5 ms | 257.4, 279.3, 846.8, 865.6 ms |
| rows of 379 whose bid, ask or last changed since the previous poll, min, median, max | 77, 93, 133 | 79, 102, 135 |
| age of the newest row `timestamp` on arrival, min, median, max | 249, 927, 1,356 ms | 406, 839, 1,647 ms |
| `cf-cache-status` | `BYPASS` on 30 of 30 | `BYPASS` on 30 of 30 |

Every row carries a `timestamp` in ms, and the newest one was up to 1.65 s old when the reply arrived, so the ticker is built server side on a cadence of about a second.
That cadence is an inference from the ages, and it is not documented.

## 5. REST book snapshot

`GET https://api.btcturk.com/api/v2/orderbook?pairSymbol=BTCUSDT&limit=N`, S4.

| query | levels per side, both runs | reply time, run 1 and run 2 |
|---|---|---|
| no `limit` | 100 | 342 and 293 ms |
| `limit=25` | 25 | 403 and 204 ms |
| `limit=100` | 100 | 213 and 197 ms |
| `limit=500` | 100 | 219 and 195 ms |
| `limit=1000` | 100 | 210 and 201 ms |

The documentation disagrees with itself on the default: "If limit parameter is not set, default 100 orders are listed." and, in the parameter table, "limit the number of results (default 25)", S4.
The wire gives 100 without a limit, and 100 is also the cap.
The changelog records the cap moving from 100 to 25 on 26 September 2022 and back to 100 on 24 November 2022, S6.

- Level order: bids descending and asks ascending, best first, on every read.
- Fields: `data.timestamp` in ms, `bids` and `asks` as `[price, amount]` string pairs, and nothing else, so there is no sequence number to align with the socket.
- Age: `timestamp` was 97 to 115 ms old on arrival over both runs, which is about the one-way trip.
- Caching: `cf-cache-status: DYNAMIC` and `cache-control: no-cache, no-store, max-age=0, must-revalidate`.
  Five reads of `ETHUSDT` 350 to 525 ms apart returned five distinct timestamps in each run.
- The socket's `obdiff` book equalled this reply on 20 of 20 levels per side for `BTCUSDT` and `BTCTRY`, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

Public limits are per IP, S5.

| call | limit | period | block |
|---|---|---|---|
| `/api/v2/ticker` | 600 | 60 s | 60 s |
| `/api/v2/orderBook` | 180 | 60 s | 60 s |
| `/v1/ohlcs` on the graph host | 120 | 60 s | 60 s |
| `graph-api.btcturk.com` overall | 600 | 10 min | 10 min |
| WebSocket connection requests | 15 | 1 min | 60 s |

`server/exchangeinfo` and `server/time` are not in the table.
A limit answers 429 with a `Retry-After` header in seconds and this body, S5:

```json
{"message": "TOO_MANY_REQUESTS", "success": false, "code": 429, "details": "Quota exceeded. Maximum allowed: 120 per 1m.", "limit": "120", "period": "1m", "policy": "ip"}
```

The probes stayed far below every limit, so no 429 was seen and no rate limit header appeared on any reply.

| request | status | body |
|---|---|---|
| `orderbook?pairSymbol=NOPEUSDT` | 400 | `{"success":false,"message":"Pair NOPEUSDT does not exists.","code":1037}` |
| `orderbook` without `pairSymbol` | 400 | `{"success":false,"message":"INVALID_REQUEST_ERROR","code":1037}` |
| `orderbook?pairSymbol=btcusdt` | 200 | the `BTCUSDT` book, 100 levels per side |
| `orderbook?pairSymbol=BTC_USDT` | 200 | the `BTCUSDT` book, 100 levels per side |
| `ticker?pairSymbol=NOPEUSDT` | 200 | `{"data":[],"success":true,"message":null,"code":0}` |
| `/api/v2/nope` | 404 | empty |

The web pages `www.btcturk.com` and the help center answer this host with a 403 Cloudflare challenge, see [`fees.md`](./fees.md) section 1, but no API or socket call was refused.

## 7. Server time and clock offset

`GET https://api.btcturk.com/api/v2/server/time` returns `{"serverTime":1790133600027,"serverTime2":"2026-09-23T03:20:00.0268053+00:00"}`, and `exchangeinfo` carries `serverTime` too.
`GET /api/v2/server/ping` answered `{"pong":true}` to a manual curl at 03:20 UTC.

| run | samples, offset of server over local midpoint | round trips |
|---|---|---|
| 1 | 28.5, 26.5, 11, 7, 7 ms, median 11 | 236 to 325 ms |
| 2 | 160.5, 16.5, 4, 17.5, 89.5 ms, median 17.5 | 252 to 603 ms |

The two samples with the shortest round trip read 7 and 4 ms, so the local clock is within a few tens of ms of the server, and the larger samples are asymmetric round trips.

## 8. Recommended poller shape

No anchor poller is recommended, because BtcTurk publishes no index, mark or funding.

| item | recommendation | reason |
|---|---|---|
| anchor | none | section 3 |
| catalog | `server/exchangeinfo`, or CCXT `loadMarkets`, which reads the same call | `id` matches the socket, section 2 |
| L1 by REST, if ever wanted | `GET /api/v2/ticker` once a second | one call carries the touch of all 379 pairs, 600 a minute are allowed, but rows were 0.25 to 1.65 s old on arrival |
| book seed | none needed | the socket sends a snapshot on subscribe, and the REST book has no sequence to align with |
| skip | TRY pairs | outside the quote family |
| rate limit pause | the `Retry-After` value, else 60,000 ms | the documented block |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public Endpoints, Get Exchange Info, and Pairs Scale | https://docs.btcturk.com/docs/public-endpoints/exchange-info/ | 2026-09-23 | BtcTurk, global | catalog fields, dynamic price limits, section 2 |
| S2 | Public Endpoints, Get Tickers | https://docs.btcturk.com/docs/public-endpoints/ticker/ | 2026-09-23 | BtcTurk, global | ticker fields, section 3 |
| S3 | Public Endpoints, All Public Endpoints and Get OHLC Data | https://docs.btcturk.com/docs/public-endpoints/all-public-endpoints/ | 2026-09-23 | BtcTurk, global | graph host calls, section 3 |
| S4 | Public Endpoints, Get OrderBook | https://docs.btcturk.com/docs/public-endpoints/orderbook/ | 2026-09-23 | BtcTurk, global | book call and its two defaults, section 5 |
| S5 | Private Endpoints, Rate Limits, and Data Center | https://docs.btcturk.com/docs/private-endpoints/rate-limits/ | 2026-09-23 | BtcTurk, global | limits, 429 body, `Retry-After`, Azure West Europe, sections 1 and 6 |
| S6 | Recent changes | https://docs.btcturk.com/docs/recent-changes/ | 2026-09-23 | BtcTurk, global | book level cap history, section 5 |
| S7 | CCXT 4.5.68 `btcturk.js` | `server/node_modules/ccxt/js/src/btcturk.js` | 2026-09-22 | CCXT | section 2 |
| P1 | `rest-probe.mjs host`, `time`, `catalog`, `book` and `poll`, run 1 at 03:29 to 03:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcturk/rest-probe.mjs) | 2026-09-23 | this host | sections 1 to 7 |
| P2 | the same five modes, run 2 at 03:36 to 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcturk/rest-probe.mjs) | 2026-09-23 | this host | sections 1 to 7, the second readings |
