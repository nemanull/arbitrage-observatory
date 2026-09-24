# Coinstore REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, evening in Seattle (2026-09-23 02:42 to 03:13 UTC), from the development host near Seattle.

This profile covers the public REST calls a catalog, an anchor poller and a book resync would use for the Coinstore USDT-margined perpetuals, the only perpetual family.
Coinstore deleted its perpetual API documentation on 2026-06-12 in commit b7bcf588, "删除永续合约部分的api文档", S1.
The calls below are the ones the futures web app at `futures.coinstore.com` makes, found in its bundle, S2, and every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/coinstore/rest-probe.mjs), run from `server/`.
They answered without a login, but they are not a published API, and Coinstore can change them without notice.
The spot API is documented, S4, and is named here only.

## 1. Host and latency from this machine

| host | resolved | cold | warm |
|---|---|---|---|
| `futures.coinstore.com` | 104.18.18.83, 104.18.19.83 and two IPv6 addresses, Cloudflare | 278 and 366 ms | 204 to 218 ms |
| `ws-futures.coinstore.com` | the same Cloudflare addresses | | |
| `api.coinstore.com`, spot | the same Cloudflare addresses | 351 and 266 ms | 208 to 289 ms |
| `futures.api.coinstore.com`, named by the spot documentation for transfers | `ENOTFOUND` | | |

The rows time the instrument call and the spot tickers call, each read four times 250 ms apart in each of two runs.
Replies carry `server: cloudflare`, `cf-cache-status: DYNAMIC` and a `cf-ray` ending in `SEA` or `YVR`, so the edge is local and the origin is behind it.
The deleted documentation recommended "access using Japanese AWS cloud server", S3.
Small calls such as one depth took a median of 114 to 121 ms over 60 polls in three runs, see section 5.

Access from this host, as a fact:

| URL | status on 2026-09-22 |
|---|---|
| every call in sections 2 to 7 | HTTP 200 |
| `https://coinstore-openapi.github.io/en/`, the spot documentation | HTTP 200, and its "Perpetual Swap" tab `futures.html` is an empty page |
| `https://support.coinstore.vip/hc/en-us/articles/8007229258009-User-Agreement` | HTTP 403, body `error code: 1034` |
| `https://coinstore-support.zendesk.com/hc/en-us/articles/8007229258009-User-Agreement` | HTTP 403, a Cloudflare "Just a moment..." challenge |
| `wss://ws-futures.coinstore.com/socket.io/?EIO=3&transport=websocket`, the deleted documentation's socket | HTTP 404 from nginx |

Who may trade is in [`fees.md`](./fees.md) section 1: persons in the United States and Japan may not.

## 2. Catalog

### The instruments call

| call | reply | rows |
|---|---|---|
| `GET https://futures.coinstore.com/api/v1/public/web/instruments` | 61.6 KB, `{"code":"0","msg":"","data":[…]}` | 58, all `tradeType` `linearPerpetual`, `quote` and `settleCurrency` `USDT`, `status` 3 |
| `GET https://futures.coinstore.com/api/configs/public`, the legacy catalog of the deleted documentation | 65.9 KB | 35 contracts, 34 margined in USDT and `BTCUSDT(JYAI)` margined in `JYAI` |
| `POST https://api.coinstore.com/api/v2/public/config/spot/symbols` with `{}`, spot | 101 KB | 377 and 376 pairs in two reads |

The meaning of `status` 3 is Not publicly specified, and all 58 rows carry it.
The rows also carry `tickSize`, `ctVal`, `minQty`, `maxLeverage` from 20 to 125, `maintMarginRatio`, `takerRate`, `makerRate`, `onboardDate` from 2025-09-29 to 2026-09-21, and four price band ratios.
The legacy catalog lists `MATICUSDT`, `FTMUSDT` and `RACAUSDT` beside current names, and its market call `GET /api/v1/futureQuot/querySnapshot?contractId=100300034` answers HTTP 200 with `{"message":"user-not-login","code":401}`.
So the legacy catalog is a leftover, and the instrument list is the live one.

`QNTXUSDT` is listed by the tickers, the fee call and the book calls, and is absent from the instrument list.
Its REST book held 62 bids and 49 asks, and 53 and 53 in the rerun, and its socket `depth` stream was acked and delivered, see [`websocket.md`](./websocket.md) section 4.
Whether it is being delisted or hidden is Not publicly specified.

### How a catalog would map it

CCXT has no Coinstore class, in 4.5.68 or in master, see [`fees.md`](./fees.md) section 8.
The engine's catalog is `venue.loadMarkets()` at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 68, so Coinstore needs a catalog loader outside CCXT, which is a code change.

| engine field | instrument field | note |
|---|---|---|
| `rawMarketId` | `symbol`, such as `BTCUSDT` | identical in the socket and the funding call on 58 of 58, and in the depth call on the 4 probed |
| `base`, `quote` | `base`, `quote` | `symbol` equals `base` plus `quote` on 58 of 58 |
| `linear` | `tradeType` `linearPerpetual` | |
| `active` | `status` 3 | meaning Not publicly specified |
| `contractSize` | 1, not `ctVal` | the book and trade sizes are coins, see [`websocket.md`](./websocket.md) section 4 |
| taker | `takerRate` | 0.0006 on 49 of 58, 0.0004 on 9 |

No base is listed twice in the instrument list.
`1000PUMPUSDT` has base `1000PUMP`, so it is quoted per 1,000 PUMP and would need a price scale, see [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts).
The list also holds equity and pre-listing names such as `TSLAUSDT`, `AAPLUSDT`, `NVDAONUSDT`, `MUUSDT`, `SAMSUNGUSDT`, `OPENAIUSDT` and `ANTHROPICUSDT`, and short tickers such as `TUSDT`, `BZUSDT` and `REUSDT`, which need a check against other venues before any pairing.

## 3. Anchor

### The bulk calls

No REST call returns the index, the mark or the upcoming funding rate.
The web app reads all three from the socket's `index` stream, S2, and the probe found no other source.

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| socket stream `index`, one entry per symbol | `indexPrice` | `markPrice` | `fundingRate`, see section 4 | absent | `nextFundRateTime`, ms | 58 symbols, one frame each per second | see [`websocket.md`](./websocket.md) section 2 |
| `GET /api/v1/public/funding/web/fundingRate?tradeType=linearPerpetual&symbol=<id>` | | | the last 100 settled rates | the spacing of `fundingTime` | the last settled time | 10.8 KB for `BTCUSDT`, one symbol per call | 170 ms or less per call |
| `GET /api/v1/market/ticker/24hr?tradeType=linearPerpetual` | | | | | | 21.4 KB, 59 rows, last price and 24 h statistics | median 203 to 205 ms over 60 polls in three runs |
| `GET /api/v1/market/ticker/mini?tradeType=linearPerpetual` | | | | | | 10.2 KB, 59 rows | |
| `GET /api/v1/market/markPrice?tradeType=linearPerpetual`, a guess | | | | | | HTTP 404 Spring `Not Found` | |

The 24 h ticker is not a price feed either, because its `closeTime` and `lastPrice` changed once in 59 one-second polls on `BTCUSDT`, `ETHUSDT` and `XRPUSDT`, in both runs.

### Row mapping

The engine's `AnchorRow` columns, read from one `index` frame and the funding history.

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `BaseWsDTO.symbol` | string, `BTCUSDT` | none |
| `index` | `indexPrice` | decimal string, up to 8 decimals | `Number()` |
| `mark` | `markPrice` | decimal string | `Number()` |
| `fundingRate` | `fundingRate` | decimal string, a fraction per 8 h, `"-0.00005"` is −0.005 % | `Number()` |
| `fundingIntervalHours` | none on the wire | 8 on every symbol from the funding history | constant 8, or the spacing of the last two `fundingTime` values |
| `nextFundingAt` | `nextFundRateTime` | Unix ms, `1790150400000` is 2026-09-23 08:00 UTC | none |

[`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) calls `fetchRound` once per interval, at lines 56 and 103, and every venue implements it with REST calls.
A Coinstore round would instead read the last `index` frame per symbol from a socket the poller keeps open, which is a second code change.

## 4. Anchor semantics

### Index

The archived help center article "Index Introduction", updated 2023-06-13, says the index "is calculated by weighted average of the latest spot transaction prices of several exchanges" and that "Index prices are published every three seconds.", S5.
Its weight table did not survive in the archive, and the article predates the current system.
No basket call was found, so the basket of each current perpetual is Not publicly specified.
Over 60 one-second frames, `indexPrice` changed on 57, 57 and 56 of 58 symbols in three runs, 36, 38 and 33 times on `BTCUSDT` and 46, 53 and 46 times on `XRPUSDT`, so the current index moves faster than every three seconds.
Each frame carries an undeclared protobuf field 4 with a millisecond time, `1790132839032` in one sample whose `ts` was `1790132840000`, likely the computation instant.

### Mark

No mark formula for the current system was found.
The web app links a help center article "Fair Mark Price", S2, and the Internet Archive holds no copy of it.
The wire shows a mark that sits nearer the last trade than the index, on 17 of the 24 end-of-run readings the probe logged in full over three runs.
On `BTCUSDT` one frame read index 86,477.529, mark 86,441.77 and last trade 86,440.81, so the mark sat 413 ppm under the index and 11 ppm from the trade.
The mark equalled the index on only 2, 3 and 2 of 58 symbols at the end of three runs.
The instrument list carries `markPriceGreaterRatio` and `markPriceLessRatio` of 0.005 on 12 symbols, 0.02 on 36, 0.05 on 9 and 0.2 on 1.
`BTWUSDT`, whose mark premium over the index reached 5,892 ppm in the first run, is on the 0.02 band.
In the rerun no symbol's premium exceeded its `markPriceGreaterRatio`, and the largest were `TAOUSDT` at 3,619 ppm on the 0.02 band and `LTCUSDT` at 2,243 ppm on the 0.005 band.
What these ratios bound is Not publicly specified, and they are candidates for a mark clamp that no reading reached.
If the mark tracks the perpetual's own trades, the fresh edge on a Coinstore leg would read momentum, which is the failure the fresh gate already met on a self-referenced index, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
That consequence is an inference and was not measured.

### Funding

The current formula and cap are Not publicly specified, see [`fees.md`](./fees.md) section 6.
The socket's `fundingRate` changed on 6, 6 and 4 of 58 symbols within 60 s in three runs, and `lastFundingRate` on none.
`fundingRate` equalled `lastFundingRate` on 43, 43 and 44 of 58 symbols.
Against the funding history, `lastFundingRate` equalled the rate settled at 00:00 UTC on 11 of 17 and 10 of 16 symbols compared, and `fundingRate` on 4 of each.
On `MUUSDT` `lastFundingRate` read −0.00005 while its last three settlements were all +0.00005, and `fundingRate` read +0.00005.
So `fundingRate` behaves as the moving estimate for the settlement at `nextFundRateTime`, and what `lastFundingRate` holds is Not publicly specified.

### Rate across a settlement

Not captured, by design of this survey.
The funding history shows 58 of 58 symbols settled at 2026-09-23 00:00 UTC, every one on an 8 h grid of 00:00, 08:00 and 16:00 UTC, with 5 symbols showing one longer pause of 1,240 to 5,064 h in their last 100 rows.

### How often each number changed

| number | symbols that changed in 60 one-second frames | example counts |
|---|---|---|
| `indexPrice` | 57, 57 and 56 of 58 | `BTCUSDT` 36, 38 and 33, `XRPUSDT` 46, 53 and 46, `OPENAIUSDT` 5 |
| `markPrice` | 56, 57 and 56 of 58 | `BTCUSDT` 29, 30 and 31, `ETHUSDT` 34, 32 and 22 |
| `fundingRate` | 6, 6 and 4 of 58 | |
| `lastFundingRate`, `nextFundRateTime` | 0 | |

Every symbol delivered exactly 60 frames in 60 s in every run, and in the rerun the frames came a median of 1,000 ms apart, 1,094 ms at the 99th percentile and at most 1,123 ms.

## 5. REST book snapshot

| call | depth | order | id | time |
|---|---|---|---|---|
| `GET /api/v1/market/depthAll?tradeType=linearPerpetual&symbol=<id>` | every gear, the whole book: `BTCUSDT` held 292 to 310 bids and 153 to 175 asks at gear `0.01` across nine reads of this call and the next, and the reply was 36.6 to 37.3 KB | bids descending, asks ascending, every gear | `lastDepthId`, a JSON number, one per gear and the same on all gears | 116 to 168 ms |
| `GET /api/v1/market/depth?tradeType=linearPerpetual&symbol=<id>&gear=<g>` | one gear, the whole book, and `limit=5` cut it to 5 levels | same | `lastDepthId` | median 114 to 121 ms over 60 polls in three runs |

The gears are the `frontPrecisions` of the instrument, and the finest equals `tickSize`.
The REST book moves in the socket's steps: five reads 200 ms apart on `BTCUSDT` returned 2 distinct ids in each run, `5666716693` then `5666716893`, and `5666892160` then `5666892892`, and 60 one-second reads of `ETHUSDT` changed id 58 times in each run.
No cache header is set, and Cloudflare reports `DYNAMIC`.
Sizes are coins and a whole multiple of `ctVal` on 483 of 483 and 467 of 467 `BTCUSDT` levels, see [`websocket.md`](./websocket.md) section 4.
A socket book bridged onto a REST read taken after the first frame matched a fresh REST read on level count and on the top 20 levels of both sides, on four of four symbols, at the same `lastDepthId`.

## 6. Rate limits and errors

The perpetual calls publish no limit.
The spot documentation says "A maximum of 300 requests is allowed every 3 seconds for the same IP.", and lists 429 as "too many visits", S4.
No reply carried a rate limit header or `Retry-After`, and no probe came near a limit.

| request | HTTP | body |
|---|---|---|
| depth on `NOPEUSDT` | 200 | `{"code":"1006","msg":"Trading pair does not exist, please modify","ts":1790132062948,"traceId":"…"}` |
| depth with gear `5` | 200 | `{"code":"1046","msg":"gear field is invalid, please re-enter",…}` |
| depth with no parameter | 200 | `{"code":"1047","msg":"gear field cannot be empty, please re-enter",…}` in one run and `"tradeType field cannot be empty, please re-enter"` in the other |
| funding history of `NOPEUSDT` | 200 | code `1006` |
| an unknown path | 404 | `{"timestamp":"2026-09-23T02:54:25.103+00:00","status":404,"error":"Not Found","path":"/v1/market/markPrice"}` |
| a private path without login | 200 | `{"message":"user-not-login","code":401}` |

Errors arrive with HTTP 200 and a nonzero `code` string, so a poller must read `code`, not only the status.

## 7. Server time and clock offset

No server time call is published.
An error reply carries `ts` in ms, and ten reads of it against the midpoint of each request gave offsets of +3 to +6 ms, median +5 ms, and −2 to +4 ms, median +2 ms, in two runs, at a round trip of 108 to 125 ms.
The `Date` header, which has one second resolution, agreed within its resolution.

## 8. Recommended poller shape

No poller fits the current engine, and the venue is not recommended as a perpetual leg.
Three changes would be needed together: a catalog outside CCXT, a socket-fed anchor in place of a REST round, and a protobuf decoder in the feed.
All three would rest on calls the venue does not publish and removed from its documentation in June 2026.

If it is ever wired, the shape would be:

| item | recommendation | reason |
|---|---|---|
| catalog | `GET /api/v1/public/web/instruments`, rows with `status` 3, `contractSize` 1 | section 2 |
| anchor | one socket subscribed to `index` for every tracked symbol, and a round that reads the last frame per symbol | no REST source, section 3 |
| interval | 1,000 ms | one `index` frame per symbol per second |
| `fundingIntervalHours` | 8, checked against the funding history at start | no field on the wire |
| skip | `QNTXUSDT` and any symbol absent from the instrument list | section 2 |
| deny list input | the mark sits nearer the last trade than the index on most readings, section 4 | the fresh gate may read such a leg as fresh, an inference |
| error handling | treat a nonzero `code` in an HTTP 200 body as an error | section 6 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coinstore commit b7bcf588, 2026-06-12 | https://github.com/coinstore-openapi/coinstore-openapi.github.io/commit/b7bcf588e19d60bc2690294ce2da092e67f5287f | 2026-09-22 | Coinstore, global | perpetual documentation deleted, preamble |
| S2 | Coinstore futures web app bundle | https://futures.coinstore.com/app-c5871e5f35262e33814e.js, https://futures.coinstore.com/component---src-pages-futures-index-tsx-7d70f014e07bb95e7e2c.js, https://futures.coinstore.com/component---src-pages-app-funding-history-tsx-ce0849686cee94af2749.js | 2026-09-22 | Coinstore, global | every perpetual path, the index stream as the only mark source, help center links, sections 2 to 5 |
| S3 | Coinstore Perpetual Swap API documentation before its deletion, at commit decd7e7e | https://github.com/coinstore-openapi/coinstore-openapi.github.io/blob/decd7e7efaa2b9e548c0fa9a7bc2e74fc4414201/source/en/futures.html.md | 2026-09-22 | Coinstore, legacy futures | legacy catalog and snapshot call, Japanese AWS advice, sections 1 and 2 |
| S4 | Coinstore spot API documentation | https://coinstore-openapi.github.io/en/ | 2026-09-22 | Coinstore, global | spot rate limit, HTTP codes, spot symbols call, sections 2 and 6 |
| S5 | Coinstore "Index Introduction", Internet Archive snapshot of 2024-10-06 | http://web.archive.org/web/20241006113205/https://support.coinstore.vip/hc/en-us/articles/8514099520409-Index-Introduction | 2026-09-22 | Coinstore, legacy futures | index method and three second publication, section 4 |
| P1 | `rest-probe.mjs catalog` at 02:53 and 03:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinstore/rest-probe.mjs) | 2026-09-22 | this host | sections 1 and 2 |
| P2 | `rest-probe.mjs anchor` at 02:53 and 03:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinstore/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs book` at 02:54 and 03:06 UTC, and `poll` at 02:56 and 03:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinstore/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 3 and 5 |
| P4 | `rest-probe.mjs errors` at 02:54 and 03:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinstore/rest-probe.mjs) | 2026-09-22 | this host | sections 6 and 7 |
| P5 | `ws-probe.mjs index` at 02:55, 02:58 and 03:07 UTC, `book` at 02:50 and 03:08 UTC, and `recipe` at 03:10 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinstore/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 5 |
