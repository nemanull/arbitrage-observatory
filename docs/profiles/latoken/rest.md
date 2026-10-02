# LATOKEN REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, from the development host near Seattle, between 04:12 and 04:31 UTC on 2026-09-23, and again between 04:36 and 04:39 UTC in the second pass, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST API v2 of LATOKEN (CCXT id `latoken`) for its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/latoken/rest-probe.mjs) unless a row names another source.
Canada is on LATOKEN's list of restricted countries, and this host's Canadian VPN exit was answered on every public call, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| base URL | `https://api.latoken.com/v2` | S1 |
| resolved address | `104.20.44.67` and `172.66.163.37`, Cloudflare, on 2026-09-23 UTC | `dig` |
| edge | `server: cloudflare`, and `cf-ray` ending in `YVR`, Vancouver | `curl -I` of `/v2/time` |
| cold request | 315 ms, and 542 ms in the rerun, for `GET /v2/time` from a fresh process | P1 and P2 `latency` |
| warm request | 20 requests at 1 s: min 219, median 242, p90 962, max 1,249 ms, and in the rerun min 220, median 243, p90 310, max 1,291 ms | P1 and P2 `latency` |
| access | HTTP 200 on every documented public path probed, no refusal, no challenge page | P1 |

The documentation page `https://api.latoken.com/doc/v2/` is a Redoc shell that loads `swagger.json`, and both answered 200 to this host, S1.

## 2. Catalog

### The instruments call

| call | reply | rows | notes |
|---|---|---|---|
| `GET /v2/pair` | 593,459 bytes in 256 ms, and 866 ms in the rerun | 1,246: 1,231 `PAIR_STATUS_ACTIVE` and 15 `PAIR_STATUS_INACTIVE`, in both runs | `cache-control: public, max-age=600`. The first reply came from the edge cache, `x-la-cf-cache-status: HIT`, and the rerun's did not, `DYNAMIC,RECALC`. Each row has a pair `id` and `baseCurrency` and `quoteCurrency` currency ids, but no tag |
| `GET /v2/currency` | 1,456,004 bytes in 950 ms, and 540 ms in the rerun | 5,073: 4,966 `CURRENCY_TYPE_CRYPTO`, 90 `CURRENCY_TYPE_IEO`, 17 `CURRENCY_TYPE_ALTERNATIVE` | the only source of the tag, `BTC`, for a currency id. No two active currencies share a tag |
| `GET /v2/ticker` | 616,082 bytes in 407 ms, and 616,038 bytes in 369 ms in the rerun | 1,231, one per active pair | `symbol` in tag form, `"CTI/USDT"`, plus both currency ids. Every active pair's tag symbol is present |
| `GET /v2/pair/available`, `GET /v2/currency/available` | same size and rows as the two above | | no difference seen |

The active pairs by quote currency, from the tags: USDT 1,182, ETH 24, LA 9, TRX 6, BTC 5, USDC 2, BFIC 1, USDQ 1, BNB 1.
Their bases are 1,217 `CURRENCY_TYPE_CRYPTO` and 14 `CURRENCY_TYPE_IEO`.
The WebSocket documentation shows a `CURRENCY_TYPE_GLOBAL_MARKETS` stock currency, but the catalog held none, S2.

The book is thin almost everywhere.
Of the 1,231 ticker rows, 1,194 had both a best bid and a best ask, 767 had a 24 h quote volume of 0, and 410 had an `updateTimestamp` older than one day, against 1,194, 766 and 411 in the rerun.
ETH/USDT led with about 56.3 million USDT of 24 h volume, then USDC/USDT with 9.95 million and HBAR/USDT with 0.76 million.
BTC/USDT showed a 24 h volume of 0, a best bid of 77,000 and a best ask of 79,000 USDT, and a last update about 6.4 hours old, P1 `ticker`.

### How CCXT 4.5.68 maps it

| field | value | source |
|---|---|---|
| markets | 1,245 in 3,921 ms, and in 3,352 ms in the rerun, 1,231 spot active and 14 spot inactive | P1 and P2 `catalog` |
| swaps, futures, contracts | 0, 0, 0 | P1, and `'swap': false` at `server/node_modules/ccxt/js/src/latoken.js` line 29 |
| `market.id` | the pair id, `448d1629-e69f-4934-bb61-3f8992626072` for BTC/USDT | line 427 |
| `baseId`, `quoteId` | the currency ids, `92151d82-df98-4d88-9a4d-284fa9eca49f` and `0c3a106d-bde3-4c13-a26e-3fd2394529e5` for BTC/USDT | line 432 |
| `symbol` | tags from `options.cachedCurrencies`, which `fetchCurrencies` fills | lines 407 and 428 |
| `active` | `status === 'PAIR_STATUS_ACTIVE'` | line 441 |
| `contractSize`, `linear` | `undefined` | lines 445 and 443 |
| `precision` | from `quantityTick` and `priceTick`: BTC/USDT amount 1e-7, price 0.01 | P1 |
| dropped pair | 1 inactive pair whose base currency id is missing from `/v2/currency`, skipped by the guard at line 420 | P1 |

`market.id` does not match any symbol the socket or the REST book uses.
The socket destination is `/v1/book/<baseId>/<quoteId>`, see [`websocket.md`](./websocket.md) section 3, and the REST book accepts either the tags or the currency ids, section 5.
So a feed would key on `<baseId>/<quoteId>`, not on CCXT's `market.id`, and the engine's `rawMarketId` contract at [`../../../server/src/engine/cluster/types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/types.ts) line 11 would need that mapping.
The 1,245 CCXT symbols are all distinct, so no pair is listed twice.
No price scale applies, since the market is spot.

## 3. Anchor

LATOKEN publishes no index, no mark and no funding rate, because it lists no derivative.
No path of the 56 in the v2 OpenAPI file names an index, mark, premium, funding or futures instrument, S1.
Its only derivative trace is an `ACCOUNT_TYPE_FUTURES` value in an account type enum, see [`fees.md`](./fees.md) section 3.

It does publish three reference prices.

| source | field | probed |
|---|---|---|
| `GET /v2/ticker` | `lastPrice`, `bestBid`, `bestAsk`, `updateTimestamp` | 616 KB for every pair, section 4 |
| `GET /v2/ticker/{base}/{quote}` | the same fields for one pair | 200 for BTC/USDT, 404 for an unknown tag |
| WebSocket `/v1/rate/{baseId}/{quoteId}` | `rate`, a JSON number | `2781.63` for ETH/USDT, see [`websocket.md`](./websocket.md) section 2 |

The `rate` formula and sources are Not publicly specified.
The fee page says a user's volume "is converted into a USDT equivalent using prices across 17 exchanges", [`fees.md`](./fees.md) section 4, and whether `rate` is that conversion price is an inference that was not verified.
None of these is an index with a published basket, so no anchor poller is recommended.

## 4. Anchor semantics

No index, mark or funding exists, so there is no formula, clamp or cap to record.
The reference prices change as follows, over 30 polls of `/v2/ticker` at 1 s, in P1 `ticker` at 04:21 UTC and the rerun P2 at 04:38 UTC.

| pair | ticker changed between polls, P1 and P2 | `updateTimestamp` age at poll, P1 | the same, P2 |
|---|---|---|---|
| ETH/USDT | 9 and 4 of 29 | median 1,118 ms, max 3,963 ms | median 2,394 ms, max 8,880 ms |
| HBAR/USDT | 12 and 10 of 29 | median 981 ms, max 4,274 ms | median 1,299 ms, max 4,448 ms |
| USDC/USDT | 0 and 0 of 29 | median 8,314 ms, max 15,317 ms | median 18,503 ms, max 32,512 ms |
| BTC/USDT | 0 and 0 of 29 | about 22.9 million ms, 6.4 hours | about 24.0 million ms, 6.7 hours |

The bulk ticker is 616 KB, took min 30, median 763, p90 850 and max 958 ms, and min 40, median 769, p90 867 and max 939 ms in the rerun, and carries `cache-control: public, max-age=1`.
Its fastest replies of 30 to 47 ms look like edge cache hits, which is an inference from the header.
The ticker's last ETH/USDT best bid differed from the REST book read about a second later in both runs, 2781.0509 against 2780.8909 and 2781.5309 against 2781.5509, and the ticker row can be seconds old, so it is not a substitute for the book feed.

## 5. REST book snapshot

| call | depth | probed |
|---|---|---|
| `GET /v2/book/{currency}/{quote}` | `limit`, "max 1000" in the CCXT comment at `server/node_modules/ccxt/js/src/latoken.js` line 641 | tags `BTC/USDT` and ids `92151d82-…/0c3a106d-…` returned the same book |
| no `limit` | 100 levels per side | 18,561 bytes on BTC/USDT |
| `limit=1`, `20`, `100` | 1, 20, 100 per side | 249, 3,765 and 18,561 bytes |
| `limit=1000` and `limit=2000` | the whole book | BTC/USDT 146 bids and 157 asks in 28,267 bytes, ETH/USDT 107 and 133 in 22,713 bytes |
| `limit=0` | none | 200 with `"ask":[]`, `"bid":[]` and the totals |

Each level is `{"price","quantity","cost","accumulated"}` as strings, and the reply adds `totalAsk` and `totalBid`.
Bids come best first, descending, and asks best first, ascending, on every reply.
The book replies carried no `cache-control` header and `cf-cache-status: DYNAMIC`.
Over 30 polls of BTC/USDT at 20 levels and 1 s, 29 replies equalled the one before and 1 changed, which is a still book, not a cache, since ETH/USDT moved every second on the socket.
Those polls took min 230, median 253, p90 273 and max 606 ms, and the rerun gave the same 29 and 1 with min 228, median 254, p90 417 and max 1,312 ms, P2.

```json
{"ask":[{"price":"79000.00","quantity":"0.0063622","cost":"502.6138","accumulated":"502.6138"},{"price":"79010.00","quantity":"0.0001836","cost":"14.506236","accumulated":"517.120036"}],"bid":[{"price":"77000.00","quantity":"0.0395700","cost":"3046.89","accumulated":"3046.89"},{"price":"71003.10","quantity":"0.0038939","cost":"276.47897109","accumulated":"3323.36897109"}],"totalAsk":"8422643.276941961","totalBid":"11444.977294662"}
```

That is BTC/USDT cut to two levels per side, with a 2,000 USDT gap between the touches and a 6,000 USDT gap below the best bid.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limit | no number. "`TOO_MANY_REQUESTS` - too many requests at the time. A response header `X-Rate-Limit-Remaining` indicates the number of allowed request per a period.", S1 | no `X-Rate-Limit-Remaining`, `X-Rate-Limit-Limit` or `Retry-After` on any public reply, and no 429 at about one request a second |
| CCXT pacing | `'rateLimit': 1000`, one request a second | `server/node_modules/ccxt/js/src/latoken.js` line 24 |
| error shape | `{"result": false, "message": …, "error": "NOT_FOUND", "status": "FAILURE"}`, S1 | `result` is absent on the wire, see below |

| request | status | body |
|---|---|---|
| `/v2/book/NOPE/USDT` | 404 | `{"error":"NOT_FOUND","message":"Unable to resolve currency by tag (NOPE)","status":"FAILURE"}` |
| `/v2/ticker/NOPE/USDT` | 404 | `{"message":"Unable to resolve currency by tag (NOPE)","error":"NOT_FOUND","status":"FAILURE"}` |
| `/v2/trade/fee/NOPE/USDT` | 404 | same message |
| `/v2/currency/NOPE` | 404 | same message |
| `/v2/nope` | 200 | empty body, no `content-type` |
| `/v2/book/BTC/USDT?limit=0` | 200 | empty sides with totals |

An unknown path answering 200 with an empty body means a poller has to check the body, not only the status.

## 7. Server time and clock offset

`GET /v2/time` answers `{"serverTime":1790137107433}` in Unix ms.
Over 20 polls, `serverTime` minus the local midpoint of the request was min 9, median 20, p90 209 and max 529 ms, P1 `latency`, and min -25, median 21, p90 32 and max 541 ms in the rerun, P2.
The spread follows the reply time spread, so the clocks agree to within a few tens of ms.

## 8. Recommended poller shape

No anchor poller is recommended, because LATOKEN has no index, mark or funding, and the engine refuses a route whose mark is 0, as [`../../../server/src/engine/cluster/types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/types.ts) line 34 says.
The engine's catalog would also find 0 active swaps and skip the venue, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 51.

If a spot leg were ever designed, these would be the REST pieces.

| item | recommendation | reason |
|---|---|---|
| catalog | `GET /v2/pair` and `GET /v2/currency`, at most every 10 minutes | the pair reply is cached for 600 s at the edge, and the tags live only in the currency reply |
| key | `<baseId>/<quoteId>` | the socket's spelling, section 2 |
| skip | pairs whose ticker `updateTimestamp` is older than a day, or with no bid or no ask | 410 and 37 of 1,231 rows, and the stale BTC/USDT book had a spread of about 25,600 ppm |
| pacing | one request a second, and pause on 429 | the documented code, and CCXT's pace |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Latoken Public API V2, OpenAPI file behind the documentation page | https://api.latoken.com/doc/v2/swagger.json, rendered at https://api.latoken.com/doc/v2/ | 2026-09-22 | LATOKEN, global | base URL, 56 paths, error format and codes, `X-Rate-Limit-Remaining`, order entry `POST /v2/auth/order/place`, sections 1, 3 and 6 |
| S2 | Latoken Public WebSocket API V1, OpenAPI file | https://api.latoken.com/doc/ws/swagger.json | 2026-09-22 | LATOKEN, global | stock currency example, section 2 |
| S3 | CCXT 4.5.68 `latoken.js` | `server/node_modules/ccxt/js/src/latoken.js` | 2026-09-22 | CCXT | market mapping, `rateLimit`, book limit comment, sections 2, 5 and 6 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/latoken/rest-probe.mjs) `latency`, `catalog`, `book`, `fees`, `errors` and `ticker`, first runs 04:18 to 04:22 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/latoken/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | the same six modes rerun in the second pass, 04:36 to 04:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/latoken/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | the second readings, sections 1 to 7 |
