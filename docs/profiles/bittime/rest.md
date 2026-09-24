# Bittime REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:09 and 03:44 UTC on 2026-09-23.

This profile covers the public futures REST API of Bittime at `https://fapi.bittime.com`, for its one perpetual family, USDT-margined.
Every number below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs) unless a source from section 9 is named.
Bittime documents six public futures calls: ping, time, contracts, depth, ticker and klines, S1.
The index, mark and funding come from a seventh call, `/fapi/v1/index`, which the documentation does not list and which answers without a key.
The REST API has the paths and fields of Bitrue's futures API, and Bittime's index equalled Bitrue's on BTC and ETH at the same instant, see section 4.

## 1. Host and latency from this machine

| host | resolves to | served by |
|---|---|---|
| `fapi.bittime.com` | CNAME `d2siq6jdobslx9.cloudfront.net`, four IPv4 addresses in `52.85.129.0/24` and eight IPv6 | CloudFront, POP `SEA900-P10`, every reply `x-cache: Miss from cloudfront` |
| `futures.bittime.com` | the same CloudFront distribution | the web page's own API under `/fe-co-api/` |
| `fmarket-ws.bittime.com`, `futuresws-cfx.bittime.com` | CNAME of an AWS load balancer in `ap-southeast-3`, 3 addresses | sockets, see [`websocket.md`](./websocket.md) |
| `openapi.bittime.com` | Alibaba Cloud WAF, 149.129.208.195 | spot API |

| call, three runs | cold, three new connections per run | warm, ten reused connections per run |
|---|---|---|
| `GET /fapi/v1/time` | 229 to 636 ms | min 187 to 192, median 541 to 555, max 568 to 578 ms |
| `GET /fapi/v1/index?contractName=E-BTC-USDT` | 264 to 626 ms | min 191 to 206, median 528 to 565, max 570 to 575 ms |
| `GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=100` | 231 to 581 ms | min 194 to 201, median 551 to 556, max 572 to 580 ms |

Times on a reused connection fall into two groups, about 190 ms and about 550 ms, with nothing between.
CloudFront forwards every call to the origin, which a round trip of about 190 ms places near Jakarta.

## 2. Catalog

### The instruments call

`GET https://fapi.bittime.com/fapi/v1/contracts` returned 16,301 bytes in 803 and 838 ms with 49 rows.

```json
{"symbol": "E-INJ-USDT", "pricePrecision": 3, "side": 1, "maxMarketVolume": 10000, "multiplier": 0.1, "minOrderVolume": 1, "maxMarketMoney": 10000, "type": "E", "maxLimitVolume": 100000, "maxValidOrder": 50, "multiplierCoin": "INJ", "minOrderMoney": 5, "maxLimitMoney": 100000, "status": 1}
```

| field | documented meaning, S1 | seen on 2026-09-23 |
|---|---|---|
| `status` | 0 cannot trade, 1 can trade | 1 on 49 of 49 |
| `type` | `E` perpetual, `S` test, others mixed | `E` on 49 of 49 |
| `side` | 1 forward, 0 backward | 1 on 49 of 49 |
| `multiplier` | contract face value, in `multiplierCoin` | 0.00001 for BTC to 1000 for SHIB, PEPE and FLOKI |

All 49 settle in USDT, and `https://fapi.bittime.com/dapi/v1/contracts` returned `[]`.
Base and quote are not fields, so they come from splitting `symbol` on `-`.
Each base appears once, so no pair is listed twice.

The web page reads a richer list from `POST https://futures.bittime.com/fe-co-api/common/public_info` with body `{"type": "1,2,3,4"}`, which is not in the API documentation, S2.
It returned 44,740 bytes with the same 49 contracts, the same `multiplier` on 49 of 49, and fields the documented call lacks: `openTakerFeeRate`, `closeTakerFeeRate`, `capitalFrequency` in hours, `capitalStartTime`, `maxLever`, `tradeTime`, and `wsUrl` `wss://futuresws-cfx.bittime.com/kline-api/ws`.
[`fees.md`](./fees.md) sections 2 and 6 use its fee and funding fields.

### How CCXT 4.5.68 maps it

CCXT has no Bittime class, see [`fees.md`](./fees.md) section 8, so the engine's catalog path of `loadMarkets` has nothing to call.
CCXT's `bitrue` class reads the same shape, so the probe pointed one at Bittime by setting `urls.api.spot` to `https://openapi.bittime.com/api` and `urls.api.fapi` to `https://fapi.bittime.com/fapi`.
Both have to move, because `bitrue`'s `fetchMarkets` reads its replies by position with spot first, at `server/node_modules/ccxt/js/src/bitrue.js` lines 830 to 860.

| item | result |
|---|---|
| swaps loaded | 49 |
| `market.id` | `E-BTC-USDT`, the REST `symbol` and the `contractName` the depth, ticker and index calls take |
| socket symbol | `e_btcusdt`, which is not `market.id`, so a feed maps one to the other, see [`websocket.md`](./websocket.md) section 8 |
| `symbol`, `base`, `quote`, `settle` | `BTC/USDT:USDT`, `BTC`, `USDT`, `USDT` |
| `linear` | true on 49 of 49 |
| `contractSize` | equal to `multiplier` on 49 of 49, from `bitrue.js` line 1010 |
| `active` | false on 49 of 49 |
| `market.taker` | 0.00098 |

`active` is false because `bitrue.js` line 1006 sets it to `status === 'TRADING'`, and Bittime's futures `status` is the number 1.
The engine keeps only markets whose `active` is not false, at `server/src/ccxt/connector.ts` line 201, so even a repointed `bitrue` class would hand it zero markets.

### Size unit, pairs listed twice, and price scale

Book sizes on the socket and in REST are contracts of `multiplier` coins, and the two agreed at the same prices, see [`websocket.md`](./websocket.md) section 4.
`E-SHIB-USDT`, `E-PEPE-USDT` and `E-FLOKI-USDT` have a `multiplier` of 1000, but their prices are per single coin, such as a SHIB last of 0.000006184, so no price scale is needed and `contractSize` carries the 1000.
No pair is listed twice.

## 3. Anchor

### The call

There is no bulk call.
`GET https://fapi.bittime.com/fapi/v1/index?contractName=E-BTC-USDT` answers for one contract.

```json
{"currentFundRate": 0.00003855, "indexPrice": 86691.93000000, "remainingSecond": 16180, "tagPrice": 86646.9, "nextFundRate": 0.00003855}
```

The reply names no contract, so it is keyed by the request.
Without `contractName`, with an empty one, with two names joined by a comma, or with the socket spelling `e_btcusdt`, the call answers HTTP 200 with `{"code":"-1121","msg":"Invalid contract","data":null}`.
One round over all 49 contracts at five requests at a time took 5,081 and 5,141 ms in two runs, with a per call median of 217 and 230 ms and a max of 630 and 596 ms.
The replies are 112 to 144 bytes each.

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the `contractName` of the request | `E-BTC-USDT` | none |
| `index` | `indexPrice` | JSON number, up to 8 decimals | none |
| `mark` | `tagPrice` | JSON number on the price tick, never 0 on 49 contracts | none |
| `fundingRate` | `currentFundRate` | fraction per interval, `0.00003855` is 0.003855 % | none |
| `fundingIntervalHours` | not in this reply | `capitalFrequency` of the web contract list, 8 or 4 | from `public_info` |
| `nextFundingAt` | `remainingSecond` | seconds from now to the next settlement | arrival time plus `remainingSecond` × 1,000, rounded to the minute |

Arrival time plus `remainingSecond` landed on 2026-09-23 08:00 UTC for 35 contracts, 04:00 UTC for 13 and 05:00 UTC for `E-XAUT-USDT`, in the rounds at 03:22 and 03:38 UTC.
Over 60 polls in each of two runs the sum stayed within one second of the same instant, so the countdown is exact to the second.

### Other calls tried

| call | answer |
|---|---|
| `premiumIndex`, `fundingRate`, `markPrice`, `ticker/allTicker`, `tickers`, `account`, `nope` under `/fapi/v1/` | HTTP 200, `{"code":"-1002", "msg":"You are not authorized to execute this request. Requests must send an API Key, please append X-CH-APIKEY to all request headers", …}` |
| `/fapi/v1/ticker` without `contractName` | HTTP 200, `-1121 Invalid contract` |
| `GET https://futures.bittime.com/fe-co-api/common/coin_index_price_all` | index prices of margin coins only: BTC, ETH, XRP, USDT, USDC and IDR |

An unknown path and a path that needs a key give the same `-1002` reply, so no other public call can be told apart from a missing one.
No public funding history call was found.

## 4. Anchor semantics

### Index

The formula and basket are Not publicly specified, and no basket call was found.
The probe read Bitrue's `https://fapi.bitrue.com/fapi/v1/index` beside Bittime's for five contracts at 03:39 UTC.
The index was identical on `E-BTC-USDT`, 86,794.21 on both, and on `E-ETH-USDT`, 2,771.79 on both, and one earlier BTC read at 03:30 UTC also matched at 86,691.93.
It differed on `E-HYPE-USDT`, 97.13821429 against 97.13, on `E-ZRX-USDT`, 0.12453968 against 0.1245, and on `E-XAUT-USDT`, 4,340.8 against 4,340.3.
The marks differed on all five.
The index of `E-HYPE-USDT` carries eight decimals, such as 97.15078571, which suggests a mean of several prices.

### Mark

The mark is `tagPrice`.
Its formula is Not publicly specified beyond "Harga referensi nilai wajar yang dihitung oleh platform untuk mengurangi dampak manipulasi jangka pendek", a fair reference price computed by the platform to damp short manipulation, S3.
On the wire it sits on the contract's price tick and follows the traded price of the documented book.
Over 60 polls on BTC in each of two runs it equalled the REST ticker `last` read about 200 ms later on 34 and 35, the bid on 27 and 16, the ask on 24 and 25, and lay inside the touch on 52 and 41.
So the mark behaves like the last trade of the venue's own book, and its premium over the index is that book's own premium.

That has two consequences for the engine's reader.
A mark on the price tick moves by whole ticks, and on `E-ZRX-USDT` one tick of 0.0001 at 0.1243 is 804 ppm, so the mark moved 1,609 and 1,608 ppm in one poll in the two runs.
That trips the 1,000 ppm move guard at `server/src/engine/opportunity/anchorReading.ts` line 6 on an ordinary two tick move.
And since the mark is the book's own price, a fresh premium read from it does not judge the book against anything outside it.
Whether a clamp exists is Not publicly specified.

| contract | mark against index at 03:22 UTC | at 03:38 UTC |
|---|---|---|
| `E-BAT-USDT` | -3,277 ppm, the largest | inside ±1,178 ppm |
| `E-XPL-USDT` | -2,072 ppm | inside ±1,178 ppm |
| `E-SNX-USDT` | +1,906 ppm | +2,236 ppm, the largest |
| `E-SHIB-USDT` | inside ±1,490 ppm | +1,618 ppm |
| `E-BTC-USDT` | -444 ppm, on the first poll | -632 ppm |

### Funding

The rate is `currentFundRate`, and `nextFundRate` equalled it on 49 of 49 contracts and on every poll in both runs.
It changed 12 times in 60 polls on BTC, ETH, HYPE and ZRX in both runs, about every 5 s, and once on XAUT, so it is a live estimate of the upcoming settlement.
The formula, cap and floor are Not publicly specified, see [`fees.md`](./fees.md) section 6.
The settlement instant was not captured, so whether the published rate resets after the hour is Not verified.

### How often each number changed

Two runs of 60 one second polls, at 03:22 and 03:38 UTC.

| contract | `indexPrice` changes | `tagPrice` changes | rate changes | largest index step | largest mark step |
|---|---|---|---|---|---|
| `E-BTC-USDT` | 31 and 31 | 30 and 37 | 12 and 12 | 180 and 500 ppm | 182 and 460 ppm |
| `E-ETH-USDT` | 33 and 30 | 21 and 38 | 12 and 12 | 195 and 1,094 ppm | 181 and 885 ppm |
| `E-HYPE-USDT` | 19 and 28 | 13 and 17 | 12 and 12 | 53 and 135 ppm | 93 and 175 ppm |
| `E-ZRX-USDT` | 2 and 2 | 12 and 9 | 12 and 12 | 8 and 47 ppm | 1,609 and 1,608 ppm |
| `E-XAUT-USDT` | 7 and 2 | 3 and 3 | 1 and 1 | 115 and 69 ppm | 231 and 69 ppm |

The index updates about every second or two on busy contracts.
The ETH index moved 1,094 ppm in one poll in the second run, so on a busy contract the 1,000 ppm guard can trip on the index too.

## 5. REST book snapshot

`GET https://fapi.bittime.com/fapi/v1/depth?contractName=E-BTC-USDT&limit=100`, documented as default 100 and max 100, S1.

| item | seen in two runs |
|---|---|
| levels | `limit` 5 and 30 cut to that many. `limit` 100, 200, 500 or none returned the whole book, 62 to 82 levels per side on BTC and 46 to 50 on ZRX |
| order | bids descending and asks ascending on every read |
| numbers | JSON numbers, sizes in contracts |
| `time` | integer ms, renewed 71 to 2,306 ms apart on BTC, 18 and 17 distinct values in 20 reads over 12.4 and 13.4 s |
| age on arrival | median 206 and 265 ms, max 1,177 and 1,615 ms after `time` |
| caching | the origin repeated one snapshot for up to 2.4 and 2.7 s on the quiet ZRX book, and CloudFront cached nothing |

The book matches the documented socket's book and not the web page's, see [`websocket.md`](./websocket.md) section 1.
`GET /fapi/v1/ticker?contractName=E-BTC-USDT` carries `buy` and `sell` and a `time` rounded to the second.
Its `buy` and `sell` equalled the depth call's touch in the first paired read and were 3.3 USDT higher in the second, the two calls about one second apart.

## 6. Rate limits and errors

The futures documentation promises "a limited frequency description below each interface" and gives none, S1.
It names HTTP 429 for a broken limit and 418 for an automatic IP ban after further 429s, S1.
The spot `exchangeInfo` lists `general` IP at 20,000 per minute, `orders_ip_seconds` at 6,000 per 10 s and `orders_user_seconds` at 600 per 10 s, which may or may not cover the futures host.
No limit was reached, no 429 was seen, and replies carry no rate limit or `Retry-After` header.

| request | HTTP | body |
|---|---|---|
| unknown contract, missing or malformed `contractName` | 200 | `{"code":"-1121","msg":"Invalid contract","data":null}` |
| unknown path, or a path that needs a key | 200 | `{"args":null,"code":"-1002","data":null,"msg":"You are not authorized to execute this request. …","succ":false}` |
| unknown path on `futures.bittime.com/fe-co-api/` | 404 | `{"timestamp":…,"status":404,"error":"Not Found","message":"No message available","path":"/common/nope"}` |

Errors arrive as HTTP 200, so a poller has to read `code` in the body.

## 7. Server time and clock offset

`GET /fapi/v1/time` returns `{"serverTime": 1790133722086, "timezone": "West Indonesia Time"}`.
Over ten samples in each of two runs the offset at the shortest round trips, 184 to 196 ms, was -2 to +6.5 ms, so this host's clock agreed with the server within 7 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision, and conditional on the open question of [`websocket.md`](./websocket.md) section 1.

| item | recommendation | reason |
|---|---|---|
| URL | `https://fapi.bittime.com/fapi/v1/index?contractName=<rawMarketId>`, once per tracked contract per round | the only call that carries index, mark and rate |
| fan-out | all tracked contracts at once, or a round of 49 takes about 5 s at five at a time | the engine refuses a reading older than 10 s and two legs read more than 5 s apart, at `server/src/engine/opportunity/anchorReading.ts` lines 4 and 5 |
| interval | 2,000 ms | a per call median of about 210 ms and a p90 near 560 ms, 49 requests per round, and no published limit |
| interval and next settlement | `fundingIntervalHours` from `capitalFrequency` of `common/public_info`, read at boot and every few minutes, and `nextFundingAt` from arrival plus `remainingSecond` | `/fapi/v1/index` has no interval field |
| row mapping | section 3 | |
| error check | treat a body with `code` as a failure even on HTTP 200 | errors arrive as 200 |
| mark guard | expect `anchor_moving` refusals on contracts whose tick is near 1,000 ppm, such as ZRX | the mark moves by whole ticks |
| rate limit pause | `rateLimitPauseMs` 60,000 | no window is published, and the spot limit counts per minute |

`AnchorPoller.fetchRound` returns one map per round, so a Bittime poller would issue its calls inside one `fetchRound`, at `server/src/feeds/anchor/AnchorPoller.ts` lines 103 and 245.
That fits the base class, at the price of 49 requests per round against a bulk call on every other venue.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bittime USDⓈ-M Futures API docs | https://www.bittime.com/api_docs_includes_file/futures/index.html | 2026-09-22 | Bittime | base URL, calls, field meanings, 429 and 418, sections 2, 5 and 6 |
| S2 | Bittime futures web page bundle, `entry.1ffd44c4129c1e01b163.js` | https://www.bittime.com/futures/includes/entry.1ffd44c4129c1e01b163.js | 2026-09-22 | Bittime | `apiBase` `https://futures.bittime.com`, `/fe-co-api/`, `common/public_info` and `common/coin_index_price_all` with `needLogin` false, sections 2 and 3 |
| S3 | Mark Price vs Last Price, 2026-08-28 | https://support.bittime.com/hc/id/articles/17403367663887 | 2026-09-22 | Indonesia | what the mark is for, section 4 |
| S4 | CCXT 4.5.68 `bitrue.js` | `server/node_modules/ccxt/js/src/bitrue.js` | 2026-09-22 | CCXT | `fetchMarkets` by position, `active` and `contractSize`, section 2 |
| S5 | Bitrue futures index call | https://fapi.bitrue.com/fapi/v1/index?contractName=E-BTC-USDT | 2026-09-22 | Bitrue | the shared index value, section 4 |
| P1 | `rest-probe.mjs catalog`, 03:18 and 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs) | 2026-09-22 | this host | section 2 |
| P2 | `rest-probe.mjs latency`, 03:21 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs) | 2026-09-22 | this host | section 1 |
| P3 | `rest-probe.mjs anchor`, 03:22 and 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P4 | `rest-probe.mjs depth`, `errors` and `time`, 03:20 to 03:22 and 03:37 to 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs) | 2026-09-22 | this host | sections 3, 5, 6 and 7 |
| P5 | one `curl` each of the guessed calls at 03:14 UTC, of Bitrue's depth, ticker and index at 03:30 UTC, and of `dapi/v1/contracts` at 03:43 UTC | | 2026-09-22 | this host | sections 2, 3 and 4 |
