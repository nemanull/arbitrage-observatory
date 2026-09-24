# GoPax REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:30 to 04:55 UTC), from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare trace `loc=CA`, `colo=SEA`).

This profile covers the public REST API of GoPax, whose markets are KRW spot and a small USDC spot market.
CCXT 4.5.68 has no GoPax class, see [`fees.md`](./fees.md) section 8.
GoPax lists no perpetual, so section 3 records that there is no index, mark or funding, and section 8 recommends no anchor poller, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/gopax/rest-probe.mjs), or from a source id of section 9.
The probe ran twice, first from 04:31 UTC and again from 04:47 UTC for the second pass, and both readings are written where they differ.
Every access result here is from the Canadian VPN exit.

## 1. Host and latency from this machine

| host | resolved to | edge |
|---|---|---|
| `api.gopax.co.kr` | CNAME `ec2publicrestalb-1806724539.ap-northeast-2.elb.amazonaws.com`, `3.36.235.188`, `43.203.97.193` | AWS load balancer in Seoul, no CDN header on any reply |
| `wsapi.gopax.co.kr` | CNAME `ec2publicwsaalb-2132362960.ap-northeast-2.elb.amazonaws.com`, `13.124.140.104`, `54.116.66.120` | AWS load balancer in Seoul, a plain HTTPS GET answers 426 |
| `www.gopax.co.kr` | CNAME `d1rvkr24q4k2el.cloudfront.net`, four `108.138.94.x` addresses | CloudFront, the web site only |
| `gopax.github.io` | `185.199.110.153` | GitHub Pages, the API documentation |

| call | reply | first request, first run and rerun | warm, 10 requests 500 ms apart, first run | warm, rerun |
|---|---|---|---|---|
| `GET /time` | 28 bytes | 705 ms as the first request of the process with TLS, and 191 ms | min 167, median 169, max 177 ms | min 175, median 179, max 293 ms |
| `GET /tickers` | 73,351 and 73,353 bytes, 368 rows | 528 and 233 ms | min 208, median 212, max 368 ms | min 219, median 224, max 233 ms |
| `GET /trading-pairs` | 43,307 bytes, 122 rows | 181 and 190 ms | min 179, median 184, max 195 ms | min 191, median 196, max 206 ms |
| `GET /trading-pairs/BTC-KRW/ticker` | 174 and 173 bytes | 194 and 204 ms | min 193, median 196, max 212 ms | min 205, median 209, max 235 ms |

Thirty polls of `/tickers` at 1 s took min 215, median 222, p90 258 and max 1,117 ms, and min 216, median 225, p90 243 and max 245 ms in the rerun, all HTTP 200.

Every public call answered HTTP 200 with data, and none was refused or geoblocked.
The replies carried only `content-type` and the weight headers of section 6.
No `content-encoding` came back although the probe asked for gzip, and no cache header was present.

## 2. Catalog

### The instruments call

`GET https://api.gopax.co.kr/trading-pairs` returns every listed pair, S1.

| field | meaning | on 2026-09-23 04:31 and 04:47 UTC |
|---|---|---|
| `name` | pair id, `BTC-KRW` | 122 rows |
| `baseAsset`, `quoteAsset` | `BTC`, `KRW` | 111 KRW and 11 USDC |
| `baseAssetScale`, `quoteAssetScale`, `priceMin` | decimals and minimum price | `ETH-KRW` has scales 8 and 0 and `priceMin` 0.0001 |
| `restApiOrderAmountMin` | minimum order per order type | 1,000 KRW for limit orders on `ETH-KRW` |
| `makerFeePercent`, `takerFeePercent` | base fee | 0.2 and 0.2 on all 122 |

No row carries a status, active flag or contract field.
The 11 USDC pairs are `ETH-USDC`, `BTC-USDC`, `BCH-USDC`, `XLM-USDC`, `A-USDC`, `QTUM-USDC`, `XRP-USDC`, `DOGE-USDC`, `SOL-USDC`, `ADA-USDC` and `KAIA-USDC`.
`GET /trading-pairs/cautions?showActive=true` flagged 8 KRW pairs with `alertLevel` 2 (highly risky): `ZIL-KRW`, `GXA-KRW`, `SAND-KRW`, `FANC-KRW`, `CRETA-KRW`, `LFIT-KRW`, `EGGT-KRW` and `CRMC-KRW`.

### The bulk ticker and delisted pairs

`GET /tickers` returned 368 rows, and 246 of them are pairs absent from `/trading-pairs`.
Those are delisted pairs, among them `ZEC-KRW`, `ETH-BTC` and the leveraged tokens `XRPBULL-KRW` and `BTCBEAR-KRW`.
Their newest trade was on 2026-08-18, 242 of them still show a bid, and 30 show a bid at or above the ask.
Their 24 h volume fields are frozen, so `XRPBULL-KRW` reads 2,628,432,694 KRW, more than four times the whole listed KRW market.
A per pair call on a delisted pair answers 404 with error 10059, see section 6.
So `/trading-pairs` is the list of live pairs, and a reader of `/tickers` has to filter by it.

The 122 listed pairs on 2026-09-23 at 04:31 UTC, and at 04:47 UTC in the rerun:

| measure | value |
|---|---|
| pairs with a bid and an ask in `/tickers` | 122 of 122, none crossed |
| last trade within 1 h, 1 day, 7 days | 15, 40, 62, and 16, 40, 62 |
| last trade more than 30 days ago | 27 in both runs |
| KRW 24 h quote volume, all 111 KRW pairs | 585,993,054 and 586,072,007 KRW, about 437,000 USDT at the USDT-KRW bid of 1,340 |
| KRW pairs over 100,000,000 KRW in 24 h | 1, `USDT-KRW` with 215,634,545 KRW in both runs |
| next by volume | `XRP-KRW` 88,539,606 and 90,377,654, `EGGT-KRW` 76,688,991 and 74,145,491, `LOCUS-KRW` 35,576,809 KRW |
| `BTC-KRW` 24 h | 1,869,237 and 1,792,124 KRW, 0.01615273 BTC in the first run |
| median KRW spread in `/tickers` | 511,111 ppm, min 2,239 ppm on `USDT-KRW`, in both runs |
| USDC market | 11 pairs, 24 h volumes of 1 to 65 USDC, the last trade 5 h to 2,896 h old |

The spread median is from `/tickers`, whose bid and ask are the touch at the last trade, see section 5.
The live book spreads of the majors are in section 5.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no GoPax class, and CCXT removed it in 2021, see [`fees.md`](./fees.md) section 8.
The engine's catalog is `loadMarkets` filtered to active swaps at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 203, so GoPax has no path into it today, and it has no swap to offer anyway.

If a custom catalog were written, the facts it would rest on are these.

| engine field | GoPax source | note |
|---|---|---|
| `rawMarketId` | `name`, `BTC-KRW` | identical to the WebSocket `tradingPairName` and to the REST path segment, see [`websocket.md`](./websocket.md) section 3 |
| `base`, `quote` | `baseAsset`, `quoteAsset` | |
| `contractSize` | 1 | spot sizes are base asset units on the socket and in the REST book, see [`websocket.md`](./websocket.md) section 4 |
| `linear` | not applicable | spot |
| `active` | presence in `/trading-pairs` | there is no status field |

### Size unit, pairs listed twice, and price scale

- The size unit is the base asset, and REST and socket sizes agreed on 20 of 20 levels per side on four pairs, see [`websocket.md`](./websocket.md) section 4.
- All 11 USDC bases are also listed against KRW, for example `BTC-KRW` and `BTC-USDC`.
- KRW is not in the engine's quote family, which joins USD, USDC and USDT only, at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) line 5 and [`types.ts`](../../../server/src/engine/cluster/types.ts) line 1.
- So a GoPax KRW book could only meet another KRW venue, and its USDC books are the only ones the quote family would place beside the USDT perpetuals.
- No pair is quoted per 10 or per 1,000 units.

## 3. Anchor

GoPax publishes no index price, no mark price and no funding rate, because it lists no perpetual.
The REST documentation has no such call, S1.
The nearest reference numbers are these, and none is an anchor.

| call | field | what it is |
|---|---|---|
| `GET /tickers` | `last`, `highestBid`, `lowestAsk` | the last trade and the touch at that trade, section 5 |
| `GET /trading-pairs/stats` | `close` | "the current price (updated every 1 minute)", S1 |
| `GET /trading-pairs/cautions` | `isGlobalPriceDifference` | a boolean caution flag for a pair whose price differs from foreign markets, S1 |

## 4. Anchor semantics

Not applicable, since GoPax publishes no index, mark or funding.
The caution flag is a boolean and carries no price, S1.

## 5. REST book snapshot

`GET /trading-pairs/{pair}/book?level=N`, S1.

| level | documented | probed |
|---|---|---|
| 1 | best ask and best bid | 1 and 1 on four pairs |
| 2 | 50 asks and 50 bids | 50 and 50 on `BTC-KRW`, `USDT-KRW` and `XRP-KRW`, 33 bids and 50 asks on `ETH-USDC`, which had 33 bids in all |
| 3, the default | all entries | `BTC-KRW` 422 bids and 565 asks in 46,625 bytes, then 419 and 566 in 46,539, `XRP-KRW` 479 and 1,004, then 483 and 1,006, `USDT-KRW` 65 and 381 in both |
| 9, not documented | | 200 with the whole book, the same as level 3 |

| item | value |
|---|---|
| shape, cut to one level per side | `{"sequence": 84551349, "bid": [["84551218", 114980000, 0.0014, "1790137997710"]], "ask": [["84469259", 117020000, 0.00000858, "1790130106866"]]}` |
| entry | `[entry id as a string, price as a number, size as a number, update time in Unix ms as a string]` |
| order | bids descending and asks ascending, on every read of four pairs at three levels |
| `sequence` | one counter for the whole exchange, never below the largest entry id in the reply. It rose by 73 and by 57 across five reads about 1.3 s apart, so about 11 to 14 book changes per second on the whole exchange |
| level age | `BTC-KRW` and `XRP-KRW` hold resting orders 1,422 days old |
| caching | none seen, every read carried a new `sequence` |

The live touch of the majors on 2026-09-23 at 04:33 UTC, and at 04:48 UTC in the rerun:

| pair | best bid | best ask | spread |
|---|---:|---:|---:|
| `BTC-KRW` | 114,980,000, then 115,000,000 | 117,020,000 | 17,742 ppm, then 17,565 ppm |
| `USDT-KRW` | 1,340 | 1,342 | 1,493 ppm in both |
| `XRP-KRW` | 2,204 | 2,212, then 2,218 | 3,630 ppm, then 6,352 ppm |
| `ETH-USDC` | 2,600 | 2,700 | 38,462 ppm in both |

The bulk ticker's touch is not the live touch.
Read back to back at 04:41 UTC, `/tickers` gave `BTC-KRW` a bid of 114,930,000 while the book's best bid was 115,000,000, and its last trade was at 03:13:36 UTC.
`XRP-KRW` read 2,204 and 2,217 in `/tickers` against 2,203 and 2,215 in the book, and at 04:49 UTC it still read 2,204 and 2,217 against a book of 2,204 and 2,218, with no trade in between.
`BTC-KRW` matched at 04:49 UTC after a trade at 04:46:55 UTC, and `ETH-KRW` matched in both runs, its book unchanged since its last trade.
Across 30 polls a second apart, the bulk ticker's touch changed in at most 1 pair per poll, and not at all in 27 and 28 of 29 poll pairs.
So `highestBid` and `lowestAsk` in `/tickers` follow trades, not the book, and are the touch as of the last trade.

## 6. Rate limits and errors

| item | documented, S1 | probed |
|---|---|---|
| public limit | 20 calls per 1 s moving window per IP | never exceeded, at most about 2 calls per second |
| book call | once per 1 s window since 2021-05-25 | called at most once per 1.1 s |
| weight headers | `x-gopax-ip-addr-used-weight` and `x-gopax-ip-addr-left-weight` | `1` and `19`, or `2` and `18`, on every call except `/time`, which sends none |
| over the limit | HTTP 429, error 10105 `Rate Limit Exceeded`, error 10364 `Ip Address Banned Temporarily` | not triggered |
| `Retry-After` | not documented | not seen |

The book call reported a used weight of 1, like every other call, so the header does not show the book's tighter limit.

| request | status | body |
|---|---|---|
| `/trading-pairs/NOPE-KRW/ticker` | 404 | `{"errorMessage":"Invalid asset code: NOPE","errorCode":10058,"errorData":"NOPE"}` |
| `/trading-pairs/NOPE-KRW/book?level=1` | 404 | the same |
| `/trading-pairs/btc-krw/ticker` | 404 | `{"errorMessage":"Invalid asset code: btc","errorCode":10058,"errorData":"btc"}` |
| `/trading-pairs/BTC_KRW/ticker` | 404 | `{"errorMessage":"Invalid asset code: BTC_KRW","errorCode":10058,"errorData":"BTC_KRW"}` |
| `/trading-pairs/ZEC-KRW/ticker`, delisted | 404 | `{"errorMessage":"Invalid trading pair: ZEC-KRW","errorCode":10059,"errorData":"ZEC-KRW"}` |
| `/trading-pairs/ZEC-KRW/book?level=1`, delisted | 404 | the same |
| `/nope` | 404 | HTML `Cannot GET /nope` |

## 7. Server time and clock offset

`GET /time` returns `{"serverTime": 1790137416516}` in Unix ms, S1.
Over ten reads the server clock was 4 ms ahead of the local midpoint, range 2.5 to 4.5 ms, with a median round trip of 167 ms.
The rerun read 3.5 ms ahead, range 1.5 to 4 ms, with a median round trip of 176 ms.

## 8. Recommended poller shape

None.
GoPax has no index, mark or funding to poll, so no anchor poller is recommended.
A GoPax leg would also have no anchor to judge a cross against, and the reader refuses a leg whose mark is 0 as `anchor_no_mark`, at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) lines 37 and 38.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GoPax REST API documentation, English | https://gopax.github.io/API/index.en.html | 2026-09-22 | Streami | calls, fields, levels, rate limit, weight headers, error codes, changelog, sections 2 to 7 |
| S2 | GoPax WebSocket API documentation, English | https://gopax.github.io/wsapi/index.en.html | 2026-09-22 | Streami | the socket host, section 1 |
| S3 | CCXT on GitHub, master `1d8b674` of 2026-09-22 | https://github.com/ccxt/ccxt | 2026-09-22 | CCXT | no GoPax class, section 2 |
| P1 | `rest-probe.mjs catalog` at 04:31 UTC, and `all` from 04:47 UTC for the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/gopax/rest-probe.mjs) | 2026-09-23 UTC | this host | section 2 |
| P2 | `rest-probe.mjs latency` at 04:32 UTC and at 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gopax/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 6 and 7 |
| P3 | `rest-probe.mjs tickers` at 04:33 UTC and at 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gopax/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 and 5 |
| P4 | `rest-probe.mjs book` at 04:33 and 04:41 UTC and at 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gopax/rest-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P5 | `rest-probe.mjs errors` at 04:34 and 04:42 UTC and at 04:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gopax/rest-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
| P6 | `dig` of the four hosts and a Cloudflare trace | | 2026-09-23 UTC | this host | section 1 |
