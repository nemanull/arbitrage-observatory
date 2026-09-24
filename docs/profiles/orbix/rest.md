# Orbix REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:24 to 05:01 UTC), from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocated to Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

This profile covers the public REST API of Orbix, a Thai spot exchange with no perpetuals and no CCXT class, see [`fees.md`](./fees.md) sections 3 and 8.
It is profiled on its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
The API is a Binance style clone under `https://www.orbixtrade.com/api/v3/`, beside older Satang era calls under `https://www.orbixtrade.com/api/`, S1.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/orbix/rest-probe.mjs), whose runs are listed in section 9.
Access results are as seen from the Canadian VPN exit, and no call was refused.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `www.orbixtrade.com`, a CNAME to `www.orbixtrade.com.edgekey.net` and `e215775.dscb.akamaiedge.net`, Akamai | `dig`, 2026-09-22 |
| addresses | `184.30.150.79`, `184.30.150.87`, `2600:140a:1000:b::b81e:9657`, `2600:140a:1000:b::b81e:964f` | P1, three runs |
| behind the edge | every reply carries `x-amz-cf-pop: KUL62-P1`, a CloudFront point of presence in Kuala Lumpur, so the origin sits in Southeast Asia | P1 |
| cold request, `GET /api/v3/ping` | 388, 354 and 779 ms in three runs, answering `{}` | P1 |
| warm request, `GET /api/v3/ping` | 209 to 473 ms over 15 requests | P1 |
| `GET /api/v3/depth`, 60 one second polls | median 243 and 252 ms, max 630 and 406 ms, none over 1 s | P4 |
| `GET /api/v3/ticker/24hr`, 60 one second polls | median 260 and 265 ms, max 457 and 1,001 ms, 1 of 120 over 1 s | P4 |
| geoblock | none: every public call answered 200 or its documented error, and the WebSocket opened, see [`websocket.md`](./websocket.md) section 1 | P1 to P7 |

## 2. Catalog

### The instruments call

`GET https://www.orbixtrade.com/api/v3/exchangeInfo` returns `{"timezone","serverTime","rateLimits","exchangeFilters","symbols"}` in 44,790 bytes, P1.

| item | value |
|---|---|
| symbols | 111, each unique, one per base asset |
| status | `TRADING` 104, `BREAK` 7 (`busd_thb`, `hbar_thb`, `ltc_thb`, `luna_thb`, `lunc_thb`, `xmr_thb`, `xzc_thb`) |
| quote | `thb` on 111 of 111 |
| margin | `isMarginTradingAllowed` false on 111 of 111 |
| order types | `LIMIT` and `MARKET` |
| filters | `PRICE_FILTER` with `tickSize` only. The minimum order size is in `GET /api/configs/`, `trading.symbols[].minTradeAmount`, `"0.0001"` on `btc_thb` |
| `rateLimits` | `[]` |

`GET /api/configs/` is the web app's configuration, 561 KB, and lists the same 111 symbols with `createOrderEnabled` false on exactly the seven `BREAK` pairs, P1.

No perpetual family exists, so there is no active perpetual count to give.
The spot pairs by activity on 2026-09-23 UTC:

| measure | count | source |
|---|---|---|
| pairs with both sides in `ticker/24hr` | 36 | P1, runs at 04:46 and 04:47 UTC |
| bids only | 11 | P1 |
| asks only | 12 | P1 |
| no order on either side | 45 | P1 |
| pairs with at least one trade in 24 h | 18 | P1 |
| `ticker/24hr` rows whose `closeTime` is over an hour old | 93 and 92 of 104 | P1 |

The 18 traded pairs summed about 10.4 million THB of quote volume in 24 h, led by `btc_thb` at 4.22 million and `usdt_thb` at 4.17 to 4.18 million, P1.
At the `usdt_thb` bid of 33.17 to 33.19 THB that is about 315,000 USDT.
`GET /api/orderbook-tickers/` answers best bid and ask for 36 pairs in all three runs, the same count as the two sided books, P1.

### How CCXT maps it

CCXT 4.5.68 has no Orbix class, so no `market.id`, `contractSize`, `linear` or `active` exists to compare, see [`fees.md`](./fees.md) section 8.
The engine's catalog comes only from CCXT `loadMarkets` filtered to active swaps, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68 and 79, so Orbix would need a catalog loader of its own.

### Symbol spelling, size unit, and pairs listed twice

| where | spelling |
|---|---|
| `exchangeInfo` `symbol`, `ticker/24hr` `symbol`, WebSocket stream names and `s` | `btc_thb`, lower case |
| `orderbook-tickers` keys and the web app's trade URLs | `BTC_THB`, upper case |
| `GET /api/v3/depth?symbol=` | accepts both, P3 |

The WebSocket serves only the lower case name, see [`websocket.md`](./websocket.md) section 4.
Sizes are base asset quantities, so the multiplier is 1.
No pair is listed twice, and no price scale is needed.
Every pair quotes THB, which [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6 does not fold into the USDT family, so no Orbix pair would share a cluster with a USDT perpetual.

## 3. Anchor

Orbix publishes no index, no mark and no funding rate, since it lists no derivative.

| call | status | source |
|---|---|---|
| `GET /api/v3/premiumIndex` | 404, empty body | P3 |
| `GET /api/v3/fundingRate` | 404, empty body | P3 |
| `GET /api/v1/premiumIndex` | 404, empty body | P3 |
| `GET /api/fapi/v1/premiumIndex` | 404, empty body | P3 |

The only reference prices it publishes are the `ticker/24hr` fields `lastPrice`, `weightedAvgPrice`, `bidPrice` and `askPrice`, one 36 KB reply for all 104 trading pairs, P1.
No anchor poller is recommended, see section 8.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
For the reference prices above, over 59 one second intervals in each of two runs, `btc_thb` `lastPrice` and `bidPrice` in `ticker/24hr` never changed, while the `btc_thb` depth `lastUpdateId` changed 12 and 8 times, P4.
So `ticker/24hr` did not follow the book over those two minutes, and the book is the current price source.

## 5. REST book snapshot

`GET https://www.orbixtrade.com/api/v3/depth?symbol=<pair>&limit=<n>` returns `{"lastUpdateId", "bids", "asks"}` with price and size as strings, S1 and P2.

| item | value | source |
|---|---|---|
| default depth | 5 levels per side without `limit` | P2, both runs |
| limits | 5, 20, 100, 500 and 1,000 each honoured up to the book's size: `btc_thb` returned 500 bids at `limit=500` and 527 and 528 bids at `limit=1000` | P2 |
| level order | bids descending and asks ascending on 24 of 24 reads per run | P2 |
| empty or one sided book | the missing side is `[]`, as `{"lastUpdateId":1310098023,"bids":[],"asks":[]}` on `yfi_thb` | P1 |
| timestamp | none in the body | P2 |
| reply time | 211 to 630 ms over all depth reads | P2, P4 |
| caching | `cache-control: max-age=0, no-cache, no-store`, and 10 reads of `btc_thb` 500 ms apart returned 3 and 2 distinct ids in the two runs, which is the book changing, not a cache | P2 |
| `lastUpdateId` | one counter for the whole venue, which is also the id the WebSocket diff chain continues from, see [`websocket.md`](./websocket.md) section 4 | P2, P5 |

A book built from this snapshot and the diff stream matched the WebSocket's 20 level book on every comparison, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

The API documentation publishes one table, "for Market Maker customers": GET 160 requests per second, POST 10 per second, and other methods 5 per second, S1.
It recommends client side rate control and exponential backoff, and names no status code and no ban rule, S1.
`exchangeInfo` returns `"rateLimits": []`, and `GET /api/v3/ping` carries the Binance style header `x-mbx-used-weight: 1`, P1.
The probes kept at least 500 ms between requests, so no limit was reached and no `Retry-After` was seen.

| request | status | body | source |
|---|---|---|---|
| `depth?symbol=nope_thb` | 500 | `{"status":"internal_server_error","message":"Sorry, the system error occurred.\nPlease try again (mDNCCO)",…}`, with a new code in parentheses on every call | P3 |
| `depth?symbol=ltc_thb`, a `BREAK` pair | 500 | same shape | P3 |
| `depth?symbol=btcthb`, and `depth` with no symbol | 500 | same shape | P3 |
| `depth?symbol=BTC_THB` | 200 | the `btc_thb` book | P3 |
| `ticker/24hr?symbol=btc_thb` | 200 | one row | P3 |
| `ticker/bookTicker`, `ticker/price`, `trades`, an unknown `v3` path | 404 | empty | P3 |
| `/api/fees/?pair=btc_thb` | 401 | `{"status":"invalid_authentication_header","message":"Authentication header is invalid"}` | P3 |
| `/api/broker/ticker/24h`, `/api/broker/depth` | 404 | nginx HTML page | P3 |

An unknown or halted pair answers 500 exactly like a server fault, so a snapshot fetch should check the pair's `exchangeInfo` status before treating a 500 as an outage.

## 7. Server time and clock offset

`GET https://www.orbixtrade.com/api/v3/time` answers `{"serverTime":<ms>}`, P3.
Over 12 samples in two runs the server clock sat between 12 ms behind and 53 ms ahead of the host's, measured at the midpoint of round trips of 215 to 348 ms, P4.
The `serverTime` inside `exchangeInfo` is not live: it held one value across 4, 6 and 4 reads a second apart in three runs, and when it moved it jumped by 10,288 and 9,610 ms, so that reply is refreshed about every 10 s, P4.

## 8. Recommended poller shape

None.
Orbix has no index, mark or funding to poll, and its pairs quote THB, outside the USDT family the engine clusters, see section 2.
If a THB spot leg were ever designed, its book would come from the WebSocket, see [`websocket.md`](./websocket.md) section 8, and REST would serve only as the diff stream's snapshot source, `GET /api/v3/depth?symbol=<pair>&limit=1000`, well inside the published 160 GET requests per second.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | orbix Trade API, Postman collection, published 2023-11-27 | https://docs.orbixtrade.com/ | 2026-09-22 | Orbix Trade, Thailand | endpoint list, payload examples, rate limit table, sections 2, 5 and 6 |
| P1 | `rest-probe.mjs catalog` at 04:29, 04:46 and 04:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orbix/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 3 and 5 to 6 |
| P2 | `rest-probe.mjs book` at 04:29 and 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orbix/rest-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P3 | `rest-probe.mjs errors` at 04:30, 04:48 and 05:00 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orbix/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 2, 3, 6 and 7 |
| P4 | `rest-probe.mjs poll` at 04:31 and 04:49 UTC, and `time` at 04:30 and 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orbix/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 4 and 7 |
| P5 | `ws-probe.mjs book` | [`ws-probe.mjs`](../../../scripts/probes/venues/orbix/ws-probe.mjs) | 2026-09-23 UTC | this host | the shared id counter, section 5 |
