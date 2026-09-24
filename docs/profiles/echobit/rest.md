# Echobit REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:29 to 07:09 UTC), from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST API of Echobit that a catalog, an anchor poller and a book resync would use, for its one perpetual family, USDT-M.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/echobit/rest-probe.mjs), run from `server/`, unless it names `curl`.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.
The documented API lives on `uapi.echobit.com` (S1).
The website's own API on `www.echobit.com/mainapi` is undocumented, and it is used below only where the documented API has no equivalent, and labelled so.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 UTC | edge |
|---|---|---|
| `uapi.echobit.com` | `52.85.129.17`, `52.85.129.26`, `52.85.129.64`, `52.85.129.110` | CloudFront, `x-amz-cf-pop: SEA900-P10`, `x-cache: Miss from cloudfront` on every reply |
| `www.echobit.com` | `52.85.129.45`, `52.85.129.51`, `52.85.129.90`, `52.85.129.114` | same |
| `ws.echobit.com`, the website's socket host | the same four addresses as `www` | not probed as a socket |

| call | bytes | cold, run 1 and run 2 | warm, five requests per run |
|---|---:|---|---|
| `GET /uapi/time` | 49 | 749 and 732 ms | 440 to 802 ms, and 434 to 674 ms |
| `GET /uapi/contract/list` | 252,327 | 1,251 and 1,122 ms | 1,237 to 1,289 ms, and 564 to 1,132 ms |
| `GET /uapi/exchange/all/tickers` | about 41,360 | 623 and 138 ms | 137 to 612 ms, and 141 to 478 ms |
| `GET /uapi/spot/list` | 110,149 | 1,148 and 1,028 ms | 434 to 1,153 ms, and 436 to 1,060 ms |
| `GET www.echobit.com/mainapi/contract/fund/rates`, undocumented | about 32,665 | 533 and 183 ms | 136 to 497 ms, and 139 to 494 ms |

Small replies fall into two groups, about 135 to 150 ms and about 430 to 500 ms, with nothing between them.
Every reply was a CloudFront miss, so the slow group is the trip to the origin and the fast group is an origin or edge that answered sooner.
The socket answered an application ping in about 124 to 132 ms, see [`websocket.md`](./websocket.md) section 5.
Every public call answered 200 from the Canadian VPN exit, and none asked for a key, a cookie or a challenge.

## 2. Catalog

### The instruments call

`GET /uapi/contract/list` takes no parameter and returns every USDT-M contract, visible or not, in one reply (S2).
`limit=500`, `page=2` and `pageSize=500` each returned the same 200 rows, from `curl`, so the call does not page.
Every one of the 126 swap tickers has its row in the reply, so no visible contract is missing, and whether hidden rows beyond 200 exist is Not verified.

| field | meaning, S2 | on the wire, both runs |
|---|---|---|
| `symbolId` | "Symbol ID" | 200 of 200 are `<baseTokenId>-SWAP-<quoteTokenId>`, for example `BTC-SWAP-USDT`, and equal `tokenId` |
| `quoteTokenId` | quote token | `USDT` on 198, `TUSDT` on 2 |
| `baseId` | contract type, `0 UNKNOW`, `1 LIVE_USDT`, `2 CONTRACT_SIMULATION` and three more | 1 on 198, 2 on the two `TUSDT` rows |
| `type` | "1-spot, 4-futures" | 4 on 200 |
| `showState` | "Display state" | true on 126, false on 74 |
| `showDate` | "Listing time" | `ZHIPU` 2026-09-24, `HOOD` 2026-10-01 and `BRKB` 2026-10-08 lie in the future and are hidden |
| `multiplier` | "Contract multiplier" | 0.0001 to 10,000, section 2 below |
| `indexId` | "Index symbol" | 200 of 200 are `<baseTokenId><quoteTokenId>`, for example `BTCUSDT` |
| `marketPriceScope` | "Market price range" | `["-0.004","0.004"]` on 187, `["-0.001","0.001"]` on 13. Its use is Not publicly specified |
| `riskLimitList`, `crossRiskLimitList` | margin tiers | 7 tiers each on `BTC-SWAP-USDT` |

No status value such as trading, delisting or settling exists.
A hidden row is either delisted, as `CATI`, `CETUS`, `CFX` and `DEGEN` were on 2026-03-19 (S6 in [`fees.md`](./fees.md)), or scheduled, as `ZHIPU`, `HOOD` and `BRKB` are.

| count | value |
|---|---:|
| visible USDT-M perpetuals, `showState` true and `baseId` 1 | 124 |
| of which TradFi, tag `TradFi` | 26 |
| hidden rows | 74 |
| simulation rows, `baseId` 2 | 2 |
| rows with a 24 h ticker in `/uapi/exchange/all/tickers` | 124 visible and both simulation rows, 0 hidden |
| rows in the funding reply | 200, including every hidden row |

The 124 visible perpetuals reported 29.66 and 29.55 billion USDT of 24 h quote volume in the two runs, and `BTC-SWAP-USDT` alone about 17.2 to 17.3 billion.
The quietest visible contract, `IRYS-SWAP-USDT`, reported about 1.45 million USDT.

### How a catalog maps it

CCXT has no Echobit class, see [`fees.md`](./fees.md) section 8, so the engine's catalog path through `loadMarkets` at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 68 cannot run.
A hand written catalog would map each visible row as follows.

| engine field | source | check on the wire |
|---|---|---|
| `rawMarketId` | `symbolId` | identical to the socket's `symbol`, the ticker's `s` and the funding row's `symbolId` on every visible row |
| anchor key for mark and index | `indexId` | the mark and index kline calls answer an empty array for `BTC-SWAP-USDT` and a candle for `BTCUSDT`, section 3 |
| `base`, `quote` | `baseTokenId`, `quoteTokenId` | |
| `linear` | true | every visible row is USDT-margined |
| `active` | `showState` true and `baseId` 1 | hidden rows have no ticker, and a depth subscription for the delisted `CATI-SWAP-USDT` answered `Invalid Symbols!`, see [`websocket.md`](./websocket.md) section 4 |
| `contractSize` | `multiplier` | section below |

### Size unit, pairs listed twice, and price scale

| multiplier | rows of 200 |
|---|---:|
| 0.0001 | 2 |
| 0.001 | 7 |
| 0.01 | 28 |
| 0.1 | 8 |
| 1.0 | 67 |
| 10.0 | 54 |
| 100.0 | 25 |
| 1000.0 | 7 |
| 10000.0 | 2 |

Book and ticker sizes are counted in contracts of `multiplier` base units.
On all 124 visible contracts, the ticker's quote volume `qv` divided by its volume `v`, its last price `c` and the `multiplier` lay between 0.8 and 1.25, so `v` is in contracts of `multiplier` coins.
`BTC-SWAP-USDT` has multiplier 0.0001 and a touch of `"129032"` contracts, which is 12.9 BTC, while the spot book `BTCUSDT` on the same host shows sizes of 0.1 to 6.8 BTC per level in coins.
The product announcement lists the same multipliers, `BTC-SWAP-USDT` 0.0001 and `ADA-SWAP-USDT` 10 (S5 in [`fees.md`](./fees.md)).
So `contractSize` is `multiplier`.

No base is listed twice among the visible rows.
`1000PEPE-SWAP-USDT` and `1000SHIB-SWAP-USDT` quote per 1,000 tokens, with multiplier 1 and last prices of 0.004994 and 0.006167, so a catalog must keep the base spelled `1000PEPE` and `1000SHIB` or apply a price scale of 1,000.
The hidden `SHIB-SWAP-USDT` row sits beside the visible `1000SHIB-SWAP-USDT`.
TradFi bases such as `CL` and `BZ`, last at 89.32 and 94.67, which fits crude oil, and `COIN` and `SPY`, which name a stock and an index fund, need a check against the same ticker on the other venues before they join a cluster.

## 3. Anchor

### The bulk calls

No documented REST call returns index, mark or funding (S1).
Funding exists in bulk, and mark and index exist only per contract.

| call | index | mark | funding rate | interval | next settlement | reply | time, 60 one second rounds, two runs |
|---|---|---|---|---|---|---|---|
| `GET www.echobit.com/mainapi/contract/fund/rates`, undocumented, the website's own call | absent | absent | `fundRate` | `nextSettleTime − settleTime` | `nextSettleTime`, Unix ms integer | about 32,670 bytes, 200 rows | min 134 and 135, median 473 and 482, p90 495 and 519, max 527 and 854 ms |
| socket `fund_rates` on `wss://uapi.echobit.com/uapi/ws/inform`, documented | absent | absent | `fundRate` | same | `nextSettleTime`, Unix ms string | 200 rows per push, one push every 1,997 to 1,999 ms median, max 2,741 ms | see [`websocket.md`](./websocket.md) section 2 |
| `GET /uapi/exchange/mark/klines?symbol=<indexId>&interval=1m&limit=1`, undocumented path on the documented host | | `c` of the current 1 m candle | | | | one row | median 136 to 139 ms, max 374 to 418 ms |
| `GET /uapi/exchange/index/klines?symbol=<indexId>&interval=1m&limit=1`, undocumented path on the documented host | `c` of the current 1 m candle | | | | | one row | median 137 to 139 ms |
| socket `markKline_1m` and `indexKline_1m` on the market socket, keyed by `indexId`, documented | `c` | `c` | | | | one row per push | see [`websocket.md`](./websocket.md) section 2 |

`GET /uapi/contract/fund/rates` answered 404 with an HTML body, so the funding call exists only on the website host.
The mark and index klines take `interval` and not the socket's `klineType`, and without it they answer 400 `{"code":-100012,"msg":"Parameter interval [String] missing!"}`, from `curl`.
The website itself reads mark and index the same way, one contract at a time from the latest 1 m candle, in its bundled script.

A REST poll of every visible contract needs 1 funding call and 248 kline calls per round.
The documented budget for market data is 1,200 GET per 60 s (S3), so a full round takes at least 12.45 s.
That is over the reader's 10 s limit, `ANCHOR_MAX_AGE_MS` at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) line 5, so a one second REST anchor can cover about nine contracts at most.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbolId` of the funding row, and `indexId` of the catalog row for the klines | string | join through the catalog |
| `index` | index kline `c` | decimal string | `Number()` |
| `mark` | mark kline `c` | decimal string | `Number()` |
| `fundingRate` | `fundRate` | decimal string, a fraction per interval, `"0.000002142045953999"` | `Number()` |
| `fundingIntervalHours` | `nextSettleTime − settleTime` | Unix ms, integers in REST and strings on the socket | divide by 3,600,000 |
| `nextFundingAt` | `nextSettleTime` | Unix ms | `Number()` |

The funding reply's `currentTime` changed on every poll and was 928 and 932 ms old on arrival in the two one second runs, so the bulk reply is about a second behind.
The kline `t` is the candle's open time, not the time of the reading, so a reading has to be stamped on arrival.

## 4. Anchor semantics

### Index

The index is the equally weighted average of external exchanges' prices after dropping every price more than 3 % from their median, S4.
An exchange's price is ignored for a cycle when its timestamp is more than 5 s from Echobit's clock.
On each exchange one pair is used, USDT-margined first, then USDC or USD.
"Echobit may continuously adjust its index references by adding or removing exchanges", and the constituent list is Not publicly specified.
No basket call is documented, and none was found in the website's script.
The worked example in S4 uses nine exchanges.

| reading | Echobit `BTCUSDT` index | OKX `BTC-USDT` index | difference |
|---|---:|---:|---:|
| run 1, 06:35 UTC | 86,481.7 | 86,481.2 | 6 ppm |
| run 2, 06:47 UTC | 86,523.7 | 86,523.9 | −2 ppm |
| run 3, 06:53 UTC | 86,487.4 | 86,487.7 | −3 ppm |

So the BTC index is an external basket and not Echobit's own book.
Whether any basket is Echobit's own perpetual, the case in [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), cannot be checked without the constituent list.

### Mark

Mark Price = Median(Price 1, Price 2, Last Price), with Price 1 the index and Price 2 the index plus a 5 minute moving average of (best bid + best ask) / 2 − index, updated every second, S4.
"In extreme market conditions … Echobit may apply additional protections, such as: Setting Mark Price = Price 2".
During an upgrade or a trading halt, the moving average term is set to 0.
No cap on the mark premium is published.

| contract | mark minus index, three runs | median | last traded, from `/uapi/exchange/ticker` |
|---|---|---|---|
| `BTC-SWAP-USDT` | −657 to −547, −618 to −348, −628 to −531 ppm | −563, −561, −554 ppm | 86,398.3 to 86,412.7 in run 1, when the mark first read 86,399.4 and the index 86,448.1 |
| `ETH-SWAP-USDT` | −544 to −399, −544 to −109, −617 to −399 ppm | −472, −508, −508 ppm | |
| `ENA-SWAP-USDT` | −1,748 to −506, −1,370 to +46, −1,880 to −459 ppm | −920, −1,051, −918 ppm | |

Run 1 polled every two seconds, and runs 2 and 3 every second.
The BTC mark sat by the last traded price.
All three marks sat below the index on nearly every poll of every run, and ENA's rose above it once, by 46 ppm.
A mark that tracks the last price is not a capped mark, so the capped mark trap named in [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) does not apply as far as the wire shows.

### Funding

The formula, interest rate and premium index are in [`fees.md`](./fees.md) section 6.

| field | documented, S3 socket page | on the wire |
|---|---|---|
| `fundRate` | "Predicted funding rate" | changed on 31 and 35 row readings across 200 rows over 60 one second polls, and on BTC between socket pushes |
| `settleRate` | "Current funding rate" | never changed within a run, `BTC-SWAP-USDT` read `0.000000673918148608` on every poll |
| `settleTime` | "Current settlement time" | the last settlement, 04:00 UTC for BTC at 06:33 UTC |
| `nextSettleTime` | "Next settlement time" | 12:00 UTC for BTC |

So `settleRate` reads as the rate settled at `settleTime`, and `fundRate` as the estimate for `nextSettleTime`, which is what `fundingRate` wants.
That reading is an inference from the field names and the two behaviours above, because no settlement instant was captured and no public funding history call exists.

### How often each number changed

| contract | mark changes in 59 transitions, runs 2 and 3 | index changes | largest one poll move of the mark | of the index |
|---|---|---|---|---|
| `BTC-SWAP-USDT` | 31 and 23 | 11 and 29 | 183 and 141 ppm | 49 and 97 ppm |
| `ETH-SWAP-USDT` | 7 and 12 | 10 and 17 | 363 and 109 ppm | 36 and 109 ppm |
| `ENA-SWAP-USDT` | 20 and 20 | 26 and 22 | 1,006 and 965 ppm | 549 and 780 ppm |

The ENA mark moved 1,006 ppm in one poll in run 2, over `MAX_ANCHOR_MOVE_PPM` of 1,000 at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) line 6.
On the socket, `indexKline_1m` pushed 31 frames in 30 s and `markKline_1m` 14 and 18, see [`websocket.md`](./websocket.md) section 2.

## 5. REST book snapshot

`GET /uapi/exchange/depth?symbol=<symbolId>&limit=<n>`, documented with `limit` required (S2).

| item | wire |
|---|---|
| levels | `limit` 1, 5, 20, 50 and 100 return that many on BTC. 200, 500 and 1,000 all return at most 200 per side, 175 bids and 200 asks in run 1 and 200 and 200 in runs 2 and 3 |
| no `limit` | 100 per side on `BTC-SWAP-USDT`, from `curl` |
| order | bids descending and asks ascending on every reply |
| fields | `s`, `t` in ms, `v` a version string such as `"90353786_18"`, `b`, `a` as `[price, size]` string pairs, `o` 0 |
| age | `t` was 118 to 697 ms old on arrival for BTC |
| caching | in runs 2 and 3, three and two consecutive reads returned the same `v` and `t`, while in run 1 six reads returned six versions, so the origin sometimes holds a reply for a few hundred ms |
| cut replies | a reply can hold fewer levels than asked at the same `v`. In the second and third `book` runs, `limit=100` on `ETH-SWAP-USDT` came back `20/20` on 6 and on 1 of 10 reads and 93 bids on the rest, on `ZKP-SWAP-USDT` `1/1` on 1 of 10 in the second run, and on `BTC-SWAP-USDT` `100/100` on all 20. On `IRYS-SWAP-USDT` one version, `955782_18`, came back as `1/1`, `5/5` or `13/14` levels depending on the `limit` asked, from `curl` |
| unknown or missing symbol | 200 `{"msg":"success","code":"0","data":[]}` |
| spot symbol | `BTCUSDT` answers on the same call with a spot book in coins |

The cut replies look like a cache that serves whatever depth was stored for a version first.
That is an inference, and a resync that reads this call has to check the level count.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public GET budget | "Common APIs - GET 1200 per 60s" and "Market Data - GET 1200 per 60s", S3. Whether the count is per IP or per key is Not publicly specified | not tested, the densest loop sent 7 or 8 requests a second, about 430 a minute |
| limit headers | Not publicly specified | none. Replies carried only `connection`, `content-type`, `date`, `transfer-encoding`, `via`, `x-amz-cf-id`, `x-amz-cf-pop`, `x-cache` |
| status of a limit | Not publicly specified | not seen |
| `Retry-After` | Not publicly specified | not seen |
| envelope | `{"msg","code","data"}`, `code` "0" on success, S1 | as documented, `code` a string |
| bad `interval` | | 400 `{"code":-10008,"msg":"Period required!"}`, `code` a number |
| missing `interval` | | 400 `{"code":-100012,"msg":"Parameter interval [String] missing!"}`, from `curl` |
| private call without a key | `-1002` "You are not authorized to execute this request", S6 | 400 with that body |
| unknown path | | 404 `<html><body><h2>404 Not found</h2></body></html>` |

## 7. Server time and clock offset

`GET /uapi/time` returns `{"msg":"success","code":"0","data":<Unix ms>}`.
Ten samples per run read the server `data` 151, 154 and 151 ms ahead of the local request midpoint at the fastest round trips of 429, 438 and 429 ms, and 151 to 277 ms ahead over all thirty samples.
With round trips that long, the REST offset is known only to within about ±220 ms.
The socket's `sendTime` arrived 63 to 73 ms after it was stamped, as the median per contract, while a socket ping round trip took about 124 to 132 ms, which fits a clock offset near zero on the socket path.
That suggests the local clock and the socket server's clock agree to within tens of ms, and that the REST reading is skewed by an asymmetric path.
The engine stamps on arrival, so neither matters to it.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
The shape of the current pollers, one bulk call a second as in [`anchor.ts`](../../../server/src/venues/gate/anchor.ts), does not fit, because mark and index exist only per contract.

| item | recommendation | reason |
|---|---|---|
| mark and index | subscribe `markKline_1m` and `indexKline_1m` for every visible `indexId` on the market socket, and keep the last `c` of each with its arrival time | the only way to hold 124 marks and indices fresh. A REST round of 248 kline calls takes at least 12.45 s at the documented budget |
| funding | subscribe `fund_rates` on `wss://uapi.echobit.com/uapi/ws/inform`, or poll `www.echobit.com/mainapi/contract/fund/rates` once a second | the socket is documented and pushes all 200 rows every 2 s. The REST call is the website's own and undocumented |
| anchor source | a named change: an anchor fed by these subscriptions instead of `fetchRound` over REST, or a `fetchRound` that reads their last values | `AnchorPoller` expects one REST round per tick at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) line 103 |
| interval | the socket pace, mark every 1 to 2 s and index about every second | section 4 |
| row mapping | section 3, key `symbolId`, joined to `indexId` through the catalog | |
| skip | rows whose `showState` is false, and the `TUSDT` simulation rows | 74 hidden rows still carry funding, 12 of them at `-0.02` |
| rate limit pause | 60,000 ms if REST is polled | the documented window is 60 s and no `Retry-After` was seen |
| deny list input | TradFi bases and any basket that proves to be Echobit's own | section 2, and the constituent list is not published |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Echobit API docs, Http: base endpoint `https://uapi.echobit.com` and the response envelope | https://echobit.gitbook.io/echobit-user-docs/en/http.md | 2026-09-22 | Echobit | sections 1, 3 and 6 |
| S2 | Echobit API docs, Common and Market Data: `/uapi/time`, `/uapi/contract/list`, `/uapi/spot/list`, tickers, depth, klines | https://echobit.gitbook.io/echobit-user-docs/en/http/common.md and https://echobit.gitbook.io/echobit-user-docs/en/http/market-data.md | 2026-09-22 | Echobit | sections 2 and 5 |
| S3 | Echobit API docs, Authentication and Rate Limits, and the socket FundRate page | https://echobit.gitbook.io/echobit-user-docs/en/http/authentication-and-rate-limits.md and https://echobit.gitbook.io/echobit-user-docs/en/websocket/fundrate.md | 2026-09-22 | Echobit | sections 3, 4 and 6 |
| S4 | Echobit Futures Trading, Mark Price and Index Price, updated 2026-07-18, with the formula images `59408528598297` and `59507900175129` | https://support.echobit.com/hc/en-us/articles/59408528604953 | 2026-09-22 | Echobit, global | section 4 |
| S5 | Echobit web bundle, `window.__NUXT__.config` and the scripts under `static.echobit.com/web/f230acc74d5f/_nuxt/`, which name `/mainapi/contract/fund/rates`, `/mainapi/exchange/mark/klines` and `/mainapi/exchange/index/klines` | https://www.echobit.com/en-us | 2026-09-22 | Echobit | section 3 |
| S6 | Echobit API docs, Common error codes | https://echobit.gitbook.io/echobit-user-docs/en/faq/common-error-codes.md | 2026-09-22 | Echobit | section 6 |
| S7 | OKX public index ticker, `BTC-USDT` | https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT | 2026-09-22 | OKX | section 4 |
| P1 | `rest-probe.mjs catalog` at 06:32 and 06:51 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/echobit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 and 2 |
| P2 | `rest-probe.mjs anchor` at 06:33 (two second rounds), 06:46 and 06:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/echobit/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs book` at 06:36, 06:51 and 07:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/echobit/rest-probe.mjs) | 2026-09-22 | this host | sections 5 to 7 |
| P4 | `curl` checks of the kline parameters, the depth call without `limit`, and the depth level counts by `limit` on `IRYS-SWAP-USDT` and `ETH-SWAP-USDT` | | 2026-09-22 | this host | sections 3 and 5 |
