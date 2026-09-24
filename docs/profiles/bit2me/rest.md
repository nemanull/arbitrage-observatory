# Bit2Me REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 02:36 and 02:59 UTC on 2026-09-23.

This profile covers the public REST API of Bit2Me Pro spot, which has no CCXT id.
Bit2Me lists no live perpetual, see [`fees.md`](./fees.md) section 3, so the spot catalog is the one profiled, as template change 1 of the venue survey plan says.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bit2me/rest-probe.mjs), run from `server/`, unless a source ledger row is named.
Run 1 is the first run of each mode at 02:47 to 02:53 UTC, and run 2 is the second pass, `all` at 02:54 UTC and `catalog` again at 02:56 UTC.

## 1. Host and latency from this machine

| host | role | resolved to |
|---|---|---|
| `gateway.bit2me.com` | every REST call | `104.20.34.144`, `172.66.150.115` |
| `ws.bit2me.com` | WebSocket | the same two addresses |
| `api.bit2me.com` | documentation | the same two addresses |

Replies carry `server: cloudflare` and `via: 1.1 google`, and the REST replies came through the Cloudflare `SEA` point of presence.

| call | reply | first request in the process | warm |
|---|---|---|---|
| `GET /v1/trading/market-config` | 91.5 KB, 287 rows | 354 and 339 ms | 249 to 337 ms over the six warm requests of run 1 and `all` |
| `GET /v2/trading/tickers` | 61 KB, 287 rows | | 238 to 307 ms over nine requests, and 30 polls at a median of 251 and 252 ms, max 350 and 314 ms |
| `GET /v2/trading/order-book?symbol=BTC/EUR` | 4.1 KB, 100 levels per side | | 194 to 217 ms over ten polls in run 1, and 198 to 213 ms in run 2 |

The first request includes the TLS handshake, and every later one reuses the connection.

## 2. Catalog

### The instruments call

`GET /v1/trading/market-config`, public, takes an optional `symbol`, S1.

| item | run 1 | run 2 |
|---|---|---|
| markets | 287 | 287 |
| `marketEnabled` `enabled` | 281 | 281 |
| `marketEnabled` `frozen` | 6: `B2M/USDR`, `BTC/EURR`, `BTC/USDR`, `EUR/EURR`, `EUR/USDR`, `USDR/USDC` | the same 6 |
| documented states | `enabled`, `enabled_at` with a date in `marketEnabledAt`, `frozen`, `disabled`, S1 | |
| enabled by quote | EUR 241, USDC 30, EURCV 5, USDCV 2, USD 1, EUROD 1, EUROP 1 | the same |
| bases | 251, of which 25 trade against more than one quote | the same |

Each row has `id` (a UUID), `symbol`, `feeMakerPercentage`, `feeTakerPercentage`, `marketEnabled`, `marketEnabledAt`, `minAmount`, `maxAmount`, `minPrice`, `maxPrice`, `minOrderSize`, `tickSize`, `initialPrice`, `pricePrecision` and `amountPrecision`.
The fee fields read 0 on every row and do not match the schedule, see [`fees.md`](./fees.md) section 4.
An unknown `symbol` returns 200 with `[]`.

The engine's quote family is USD, USDC and USDT, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
Only 31 enabled markets fall in it: 30 against USDC and `XAUT/USD`.
The other 250 quote EUR, a EUR stablecoin, or `USDCV`, a USD stablecoin outside the family.

### How CCXT would map it

CCXT 4.5.68 has no Bit2Me class, and neither does CCXT `master` on 2026-09-22, see [`fees.md`](./fees.md) section 8.
The engine loads its catalog from CCXT and keeps only active swaps, at `server/src/ccxt/connector.ts` lines 79 and 196 to 203, so it has nothing to load for this venue.

The unmerged class in pull request #22639, commit `487634d`, S4, would map the reply as follows.

| field | mapping in `ts/src/bit2me.ts` | against the wire |
|---|---|---|
| `id` | `symbol`, as in `BTC/EUR`, lines 254 and 272 | identical to the socket's `symbol` and the REST `symbol` parameter on every market probed |
| `type` | always `spot`, `swap` false, lines 280 to 285 | Bit2Me Pro has only spot |
| `contractSize` | `undefined`, line 289 | book sizes are base currency amounts, see [`websocket.md`](./websocket.md) section 4 |
| `linear` | `undefined` | |
| `active` | `marketEnabled` equal to `enabled`, or `enabled_at` with a past date, lines 261 to 270 | the 6 frozen markets would be inactive |

A base listed against several quotes, such as BTC against EUR, EURCV, EUROD, EUROP, EURR, USDC, USDCV and USDR, would need a `marketFilter` if a spot leg were ever kept.

## 3. Anchor

Bit2Me publishes no index price, no mark price and no funding rate, because it lists no live perpetual.
No call returns any `AnchorRow` column.

The futures product documented on the WebSocket side has no REST counterpart.
Every guessed futures path returned the same 404 HTML as a path that does not exist, in both runs.

| path on `gateway.bit2me.com` | status | body |
|---|---|---|
| `/v1/futures/instruments`, `/v1/futures/markets`, `/v1/futures/tickers`, `/v1/futures/funding-rate`, `/v2/futures/tickers`, `/v1/derivatives/instruments` | 404 | `<pre>Cannot GET /v1/futures/instruments</pre>` and the like |
| `/v1/nope/nope` | 404 | `<pre>Cannot GET /v1/nope/nope</pre>` |

A `GET` of `https://ws.bit2me.com/v1/futures/connection/websocket` and of `https://ws.bit2me.com/v1/nope` both returned 200 with the body `OK`, in both runs.

### Reference prices it does publish

| call | what it is | probed |
|---|---|---|
| `GET /v3/currency/ticker/{symbol}?rateCurrency=EUR` | the Bit2Me price of a currency with market cap and supply, documented with `ApiKeyAuth`, S2 | 200 without a key in 217 and 213 ms, `"price":"75643.3000000000067153760990358"` for BTC in EUR |
| `GET /v1/currency/rate` | exchange rates in USD for fiat and crypto, documented with `ApiKeyAuth`, S2 | 200 without a key, 15.2 KB, in a `curl` check during the reconnaissance |
| `GET /v2/trading/tickers` | the Pro ticker of every market, with `bid` and `ask` | section 4 |

None of these is an index basket or a mark, and none is recommended as an anchor.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

The bulk ticker is the nearest thing to a quote poll, and it is trade driven.
The BTC/EUR ticker `timestamp` was 8 ms after the newest trade from `GET /v1/trading/trade/last`, and its `close` equalled that trade's price, in the run 2 `catalog` rerun.

| 30 polls of `GET /v2/trading/tickers`, one a second | run 1 | run 2 |
|---|---|---|
| reply time | min 234, median 251, p90 270, max 350 ms | min 238, median 252, p90 282, max 314 ms |
| BTC/EUR `timestamp` changes | 1 | 2 |
| BTC/EUR `bid` changes | 1 | 2 |
| BTC/EUR `ask` changes | 1 | 1 |
| BTC/EUR ticker age at arrival | min 194, median 74,313, max 88,305 ms | min 401, median 11,415, max 25,421 ms |

The BTC/EUR book changed about once a second over the same minutes, see [`websocket.md`](./websocket.md) section 4.
So the ticker's `bid` and `ask` are the touch at the last trade, and they can be tens of seconds stale.
Across all 287 tickers the `timestamp` age had a median of 562 s and 907 s, and a maximum of 121 days.

## 5. REST book snapshot

`GET /v2/trading/order-book?symbol=<symbol>`, public, takes only `symbol`, S1.
No depth parameter exists.

| market | run 1 | run 2 |
|---|---|---|
| BTC/EUR | 100 bids, 100 asks, `nonce` `1790117175928` | the same counts and `nonce` |
| ETH/EUR | 100 bids, 100 asks | the same |
| PERP/EUR | 29 bids, 100 asks | 30 bids, 100 asks |
| BTC/USDC | 138 bids, 35 asks, no `nonce` and no `datetime` | the same |
| B2M/EUR | 50 bids, 76 asks, three numbers per level, no `nonce`, `timestamp` 50,148 ms old | the same counts, `timestamp` 14,576 ms old |
| B2M/USDR, frozen | `{"symbol":"B2M/USDR","asks":[],"bids":[],"timestamp":…}` | the same |

Bids were descending and asks ascending on every market in both runs.
Prices and sizes are JSON numbers, and sizes are base currency amounts.
The first 20 levels of BTC/EUR equalled the socket's frame on both sides in both runs, see [`websocket.md`](./websocket.md) section 4.

Ten polls of BTC/EUR one second apart:

- `timestamp` advanced between 8 of 9 consecutive polls in run 1 and 9 of 9 in run 2, and the weak `etag` changed with it.
- `timestamp` was 250 to 1,603 ms old on arrival in run 1 and 368 to 1,114 ms in run 2.
- `nonce` never changed, so it does not number updates.

No cache beyond the book's own refresh was seen.

## 6. Rate limits and errors

| limit | value | source |
|---|---|---|
| REST requests per IP | 600 a minute on the Starter tier, 800 on Medium and 1,000 on Pro | S2, section "Rate Limit" |
| over the limit | 429 "too many requests", and 418 "banned from accessing the API" | S2 |
| `GET /v1/trading/candle` | 5 a second per IP | S2, tag "Pro (Trading Spot)" |
| order and balance calls | 1 to 15 a second per account | S2, tag "Pro (Trading Spot)" |

No reply carried a rate limit header, and no error reply carried `Retry-After`, in either run.
No limit was approached, since a full `all` run made about 75 requests over 51 s.

| request | status | body |
|---|---|---|
| order book of `NOPE/EUR` or `BTC-EUR` | 404 | `{"statusCode":404,"error":"Not Found","message":"Market not found for symbol NOPE/EUR","reqId":"0c6717dd-41ba-4e58-a6b4-745592c94b35"}` |
| ticker of `NOPE/EUR` | 404 | the same shape |
| order book without `symbol` | 400 | `{"message":"Validation errors","errors":[{"code":"INVALID_REQUEST_PARAMETER","errors":[{"code":"REQUIRED",…}],"in":"query","message":"Invalid parameter (symbol): Value is required but was not provided"…}]}` |
| market config of `NOPE/EUR` | 200 | `[]` |
| unknown path `/v1/nope` | 404 | HTML `<pre>Cannot GET /v1/nope</pre>` |

The documented error shape has `message`, `error`, `statusCode`, `reqId` and `data`, S1.

## 7. Server time and clock offset

No server time call exists among the 15 paths of the Pro REST specification, S1.
The HTTP `Date` header has one second resolution.
Over five requests in each run it read between 527 ms behind and 14 ms ahead of the local midpoint in run 1, and between 501 ms behind and 35 ms ahead in run 2.
That is what a clock within a few tens of ms of the local one produces, and a finer offset cannot be read from this venue.

## 8. Recommended poller shape

No anchor poller is recommended.
Bit2Me publishes no index, mark or funding, and the bulk ticker is trade driven, so it cannot stand in for an anchor.
If a spot leg were ever modelled, the REST book serves only to seed the socket's books, see [`websocket.md`](./websocket.md) section 8.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Pro (Trading Spot) REST API, OpenAPI file `trading-spot-rest.json` | https://api.bit2me.com/openapi/trading-spot-rest.json | 2026-09-22 | Bit2Me | paths, parameters, market states, error shape, sections 2, 5, 6 and 7 |
| S2 | Bit2Me API Gateway, OpenAPI file `crypto.json`, sections "Rate Limit" and "WebSockets" and tag "Pro (Trading Spot)" | https://api.bit2me.com/openapi/crypto.json | 2026-09-22 | Bit2Me | rate limits, 429 and 418, reference price calls, sections 3 and 6 |
| S3 | Futures WebSockets API, OpenAPI file `futures-websockets.json` | https://api.bit2me.com/openapi/futures-websockets.json | 2026-09-22 | Bit2Me | the only futures documentation, which has no REST path, section 3 |
| S4 | ccxt/ccxt pull request #22639, `ts/src/bit2me.ts` at commit `487634d` of `bit2me-devs/ccxt` | https://github.com/ccxt/ccxt/pull/22639 | 2026-09-22 | CCXT | the mapping a future class would use, section 2 |
| P1 | `rest-probe.mjs catalog`, `book`, `errors`, `futures` and `poll`, run 1 at 02:47 to 02:53 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2me/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs all` at 02:54 UTC and `catalog` at 02:56 UTC on 2026-09-23, the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2me/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7, the second readings |
