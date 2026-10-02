# Bitlo REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:15 to 03:56 UTC, from the development host near Seattle.

Bitlo lists no perpetual, so this profile covers the public spot REST API, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The API document lists six public calls on two hosts, S1, and every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) unless a row cites another source.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-23 |
|---|---|---|
| `api4.bitlo.com` | public market data, S1 | `172.66.43.202`, `172.66.40.54`, `2606:4700:3108::ac42:2836`, `2606:4700:3108::ac42:2bca` |
| `api.bitlo.com` | private calls and server time, S1 | the same four Cloudflare addresses |
| `api3.bitlo.com` | candles, S1 | the same four |
| `www.bitlo.com`, `docs.bitlo.com` | website and API document | the same four |

Every reply carried a `cf-ray` ending in `-SEA`, so requests land on Cloudflare's Seattle edge and travel from there to the origin.

| call | status | reply | cold | warm, five requests |
|---|---|---|---:|---|
| `GET https://api.bitlo.com/config/servertime` | 200 | 28 B | 278 ms | 748, 173, 173, 179, 182 ms |
| `GET https://api4.bitlo.com/config` | 200 | 543,524 B | 259 ms | 291, 200, 201, 191, 205 ms |
| `GET https://api4.bitlo.com/market/ticker/all` | 200 | 102,876 B | 291 ms | 181, 210, 171, 178, 176 ms |
| `GET https://api4.bitlo.com/market/orderbook?market=BTC-TRY` | 200 | 3,648 B | 235 ms | 701, 191, 163, 187, 167 ms |
| `GET https://api4.bitlo.com/market/market-ticker?market=BTC-TRY` | 200 | 292 B | 728 ms | 224, 207, 226, 198, 197 ms |
| `GET https://api4.bitlo.com/market/orderbook/fills?market=BTC-TRY` | 200 | 3,179 B | 276 ms | 191, 167, 199, 165, 170 ms |

P1, the first run at 03:26 UTC.
The rerun at 03:45 UTC read cold 235 to 321 ms and warm 167 to 986 ms, with every warm read but the first `config` read under 272 ms.
Every reply carried `cache-control: no-cache, no-store, max-age=0, must-revalidate` and `cf-cache-status: DYNAMIC`, so nothing is cached at the edge.
The website at `https://www.bitlo.com/` is a JavaScript shell that answers 200 and renders everything from these calls, and `https://www.bitlo.com/komisyonlar`, `https://docs.bitlo.com/` and `https://www.bitlo.exchange/` answered 200 at 03:55 UTC.

## 2. Catalog

### The instruments call

`GET https://api4.bitlo.com/config` returns `markets`, `assets`, `settings`, `marketCategories`, `exchangeFeeSchedule` and `convertibleAsset` in one 543,524 B reply, S1 and P2.
`GET https://api.bitlo.com/config` returns the same 376 market codes in 864,465 B.

| field | meaning | on 2026-09-23 |
|---|---|---|
| `code` | market id, `BASE-QUOTE` | 376 markets, every one matches `^[A-Z0-9]+-(TRY\|USDT)$` |
| `tradingEnabled` | the market trades | 299 true, 77 false |
| `tradeDisabledReason` | why not | `MARKET_DISABLED` on all 77, `null` otherwise |
| `quoteAssetCode` | quote | TRY on 304 markets, 227 of them trading, and USDT on 72, all trading |
| `baseAssetScale`, `quoteAssetScale`, `priceStep`, `quantityStep`, `minimumQuantity`, `maximumQuantity`, `minimumNotionalValue` | precision and limits | per market |
| `category` | tag ids | `ERA-TRY` carries id 32 "stocks", eleven metal tokens carry id 26 "Metal", six fiat or stable pairs carry id 28 "Fiat" |

No market has a perpetual, futures or options shape, and none carries a funding, contract size or expiry field.
71 bases trade against both TRY and USDT.

### Ticker list against the catalog

`GET https://api4.bitlo.com/market/ticker/all` returned 378 rows in all three reads, P2.
Every trading market is in it, and so are all 77 disabled markets, plus `AI-TRY` and `BEAM-TRY`, which are not in the catalog.
80 rows had no bid or no ask: the 77 disabled markets, `AI-TRY`, `BEAM-TRY`, and the trading market `CROF-TRY`, which read `0.00/178.00` at 03:55 UTC.
No row was crossed or locked.

| quote | two sided rows | quoted spread, ppm | 24 h notional |
|---|---:|---|---|
| USDT, 03:26 UTC | 72 | min 1,082, median 10,233, p90 16,000, max 34,483 | 293,358 USDT in all, the largest `BTC-USDT` at 34,236 USDT, 5 markets above 10,000 USDT |
| USDT, 03:45 UTC | 72 | min 875, median 10,850, p90 16,674, max 34,483 | 286,854 USDT in all, the largest 35,119 USDT, 5 markets above 10,000 USDT |
| TRY, 03:26 UTC | 226 | min 19, median 10,331, p90 16,413, max 107,877 | 59,487,536 TRY in all, the largest 4,405,003 TRY |
| TRY, 03:45 UTC | 226 | min 439, median 10,695, p90 17,276, max 107,877 | 59,410,234 TRY in all, the largest 4,096,733 TRY |

These spreads come from the bulk ticker, whose touch can be a minute old, see section 4.

### How CCXT 4.5.68 maps it

It does not, since CCXT 4.5.68 has no Bitlo class and the master branch has none either, see [`fees.md`](./fees.md) section 8.
A connector would have to be written by hand, and the engine's catalog accepts only CCXT swap markets, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202.

| engine field | Bitlo source | note |
|---|---|---|
| `rawMarketId` | `code`, `BTC-TRY` | identical to the socket destination suffix, the socket body `market` and the REST `market` parameter |
| `base`, `quote` | `baseAssetCode`, `quoteAssetCode` | |
| `contractSize` | none | sizes are base asset units on both REST and socket, so 1 |
| `linear` | not applicable | spot |
| `active` | `tradingEnabled` | |

Only the 72 USDT markets would fall in the USD, USDC and USDT settlement family of [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6.
TRY forms its own family, and no other venue in the engine quotes TRY.

## 3. Anchor

Bitlo publishes no index price, no mark price and no funding rate, because it lists no perpetual.
No call returns any `AnchorRow` column.

It does publish three reference prices, none of which is an index.

| call | fields | cadence |
|---|---|---|
| `GET https://api4.bitlo.com/market/ticker/all` | per market `currentQuote` (last trade), `weightedAverage24h`, `highestQuote24h`, `lowestQuote24h`, `bid`, `ask`, volumes | the bid and ask of the whole reply changed only twice in 120 one second polls, 61 s apart, in both runs, section 4 |
| `/topic/ticker-price` on the socket | per asset `price` and `tryPrice` | one asset per frame, median 256 to 295 ms apart, see [`websocket.md`](./websocket.md) section 2 |
| `GET https://api3.bitlo.com/api/v3/klines/history?symbol=BTC-TRY&resolution=60&from=<s>&to=<s>` | TradingView style `{s, t, o, h, l, c, v}` candles | resolutions 15, 60, 240, 1D and 1W, S1 |

The unit of `price` in `/topic/ticker-price` is Not publicly specified.
The frame `{"symbol":"BTC","price":"86820","tryPrice":"4230739"}` arrived while `BTC-USDT` traded near 86,824 and `BTC-TRY` near 4,228,909, so `price` reads as USDT and `tryPrice` as TRY, an inference.

## 4. Anchor semantics

There is no index basket, no mark formula, no clamp and no funding formula to record.

The REST bulk ticker behaves like a snapshot rebuilt about once a minute, P4.
Over 120 polls at one per second, the bid and ask of any row changed in only two polls, at 27 s and 88 s, when 54 and then 45 markets changed at once.
The rerun saw the same shape, at 30 s and 91 s, with 73 and 69 markets.
Over the same two windows the `BTC-TRY` REST book top changed 4 and 7 times, and the ticker's bid and ask equalled the book's best bid and ask on 92 and 40 of 120 polls.
So the bulk ticker's touch can be a minute old, and the book call or the socket is the only live touch.

`GET https://api4.bitlo.com/market/market-ticker?market=BTC-USDT` disagreed with its own row in the bulk reply read a moment later, P4.
It gave `weightedAverage24h` `"1399417.37"` and `notionalVolume24h` `"818809.53"` where the bulk row gave `"85987.31"` and `"34241.00"`, while last price and ask matched.
The rerun repeated it: `"1377233.58"` and `"819684.60"` against `"86011.91"` and `"35117.80"`.
The single market call's figures look computed in TRY, an inference, and the bulk row is the consistent one.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET https://api4.bitlo.com/market/orderbook?market=<code>`, S1 |
| reply | `{"sequenceId": <int>, "bids": [{"0": price, "1": size}, …], "asks": [...]}` with price and size as decimal strings |
| depth | 50 levels per side, where the API document says "first 20 records only for each", S1. Thinner books return fewer: `USDT-TRY` 23 and 21, `CHR-TRY` 17 and 26, then 16 and 27 in the rerun |
| depth parameters | `limit=5`, `limit=100`, `depth=5`, `size=100` and `level=100` are ignored, and every reply held 50 and 50 |
| level order | bids descending, asks ascending, 0 violations on five markets in both runs |
| sequence | `sequenceId` is per market and shares its space with the socket's `beginSequenceId` and `endSequenceId`. `BTC-TRY` read `100000018675752` and `ETH-TRY` `100000021438860` a moment apart |
| caching | `no-store`, `DYNAMIC`. Two reads 171 to 688 ms apart gave the same `sequenceId` on all five markets in both runs, because those books had not changed |
| time | warm 163 to 701 ms, and 187 to 209 ms for the five book reads of the rerun |
| size unit | base asset units, `"0.13641900"` BTC |

The same call on `api.bitlo.com` also answers 200 with the same shape.
`GET https://api4.bitlo.com/market/orderbook/fills?market=<code>` returns the last 12 trades with `price`, `quantity`, `side` and an ISO `timestamp`, and the order and customer ids masked as `"del"`.

## 6. Rate limits and errors

No rate limit is published, S1.
The catalog's `settings` carry `api1interval` 8000 and `api2interval` 2000, which read as the website's polling intervals in ms, an inference, since their meaning is Not publicly specified.
20 back-to-back book reads on one connection took 4.3 s, and 3.8 s in the rerun, all answered 200, and no reply carried a rate limit or `Retry-After` header, P5.
The status a limit would produce is therefore Not verified.

| request | status | body |
|---|---|---|
| `GET /market/orderbook?market=NOPE-TRY` on `api4` | 200 | empty, 0 bytes |
| `GET /market/orderbook?market=btc-try` and `?market=BTC_TRY` | 200 | empty |
| `GET /market/market-ticker?market=NOPE-TRY` | 200 | empty |
| `GET /market/orderbook` without `market` | 400 | `{"timestamp":"2026-09-23T03:27:08.110+00:00","status":400,"error":"Bad Request","path":"/market/orderbook"}` |
| `GET /market/nope` on `api4` | 404 | `{"timestamp":"…","status":404,"error":"Not Found","path":"/market/nope"}` |
| `GET https://api.bitlo.com/market/ticker/all` | 302 | a Cloudflare HTML redirect page with `location: https://api4.bitlo.com/market/ticker/all` |
| `GET https://api.bitlo.com/` | 403 | `{"code":0,"message":"","timestamp":"2026-09-21T07:33:53.223Z","data":{}}` |

An unknown market is not an error on this API, so a caller must treat an empty 200 body as "no such market".

## 7. Server time and clock offset

`GET https://api.bitlo.com/config/servertime` returns `{"serverTime":1790134009649}` in Unix ms, and the API document links it as the clock for signed calls, S1.
The same path on `api4` answers 404.
Ten warm reads gave an offset of the server clock ahead of this host of 0.5 to 9 ms, with round trips of 172 to 196 ms, and 5.5 to 15.5 ms with round trips of 177 to 191 ms in the rerun, P1.
A third run at 03:55 UTC read 3.5 to 8 ms, except one read of 54 ms whose round trip took 268 ms.

## 8. Recommended poller shape

No anchor poller is recommended, since Bitlo publishes no index, mark or funding.

If a spot book feed were ever built, its REST side would be the seed of [`websocket.md`](./websocket.md) section 8.

| item | recommendation | reason |
|---|---|---|
| seed call | `GET https://api4.bitlo.com/market/orderbook?market=<rawMarketId>` once per market at subscribe and on each gap | the socket sends no snapshot, and `sequenceId` aligns with the deltas |
| seed pacing | sequential, one market at a time | no limit is published, and 20 back-to-back reads in about 4 s were the most tested, so a full seed of 299 markets would take about a minute and is itself untested |
| empty reply | treat an empty 200 body as an unserved market | unknown ids are not errors |
| catalog | `GET https://api4.bitlo.com/config`, keep `tradingEnabled` true | 299 of 376 markets trade |
| do not read | `bid` and `ask` of `market/ticker/all` as a live touch | refreshed about once a minute |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitlo API Documentation | https://docs.bitlo.com/ | 2026-09-22 | Bitlo, Türkiye | base URLs, the six public calls, the 20 level statement, the server time link |
| P1 | `rest-probe.mjs host` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) | 2026-09-23 | this host | sections 1 and 7 |
| P2 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) | 2026-09-23 | this host | section 2 |
| P3 | `rest-probe.mjs book` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) | 2026-09-23 | this host | section 5 |
| P4 | `rest-probe.mjs ticker` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) | 2026-09-23 | this host | sections 3 and 4 |
| P5 | `rest-probe.mjs limits` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) | 2026-09-23 | this host | sections 5 and 6 |
