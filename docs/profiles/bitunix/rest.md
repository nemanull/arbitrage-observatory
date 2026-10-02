# Bitunix REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Seattle time, which was 2026-09-23 01:14 to 01:43 UTC, from the development host near Seattle.

This profile covers the public futures REST API of Bitunix at `https://fapi.bitunix.com`, for every perpetual family.
Every claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) unless a source says otherwise.
Bitunix has no CCXT class, so section 2 describes the venue's own catalog and what a loader would have to map, see [`fees.md`](./fees.md) section 8.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `fapi.bitunix.com`, a CNAME to `fapi.bitunix.com.cdn.cloudflare.net` |
| addresses | `104.18.0.177` and `104.18.1.177` |
| edge | `server: cloudflare`, `cf-ray` ending `-SEA` in the first run and `-YVR` in the rerun, `cf-cache-status: DYNAMIC` |
| origin time | `x-envoy-upstream-service-time` of 2 to 8 ms |
| cold request, new TLS connection | 141, 150, 164, 165 and 178 ms, and 140, 149, 194, 222 and 222 ms in the rerun, P1 |
| warm request | 133 to 232 ms over 10 requests, median 152 ms, and 113 to 145 ms, median 116 ms, in the rerun, P1 |
| refusals | none. Every public call answered HTTP 200 |

The documentation lives at `https://www.bitunix.com/api-docs/`, to which `https://openapidoc.bitunix.com/` redirects with HTTP 301, and it answered this host with HTTP 200.
The Zendesk help center at `support.bitunix.com` answered this host with HTTP 403, `cf-mitigated: challenge` and a page titled "Just a moment...", which is a Cloudflare bot challenge and not a geoblock.
The fetch tool used for documentation got HTTP 403 there too, and no attempt was made to pass the challenge.

## 2. Catalog

### The instruments call

`GET /api/v1/futures/market/trading_pairs`, 318,337 bytes, 761 rows, P2.

| field | meaning, S1 | probed |
|---|---|---|
| `symbol` | the id used on the socket and in every other call | `BTCUSDT`, `BTCUSDC`, `BTCUSD`, upper case on all 761 rows |
| `base`, `quote` | coin and quote | `quote` is `USDT` on 721 rows, `USDC` on 25 and `USD` on 15 |
| `symbolStatus` | `OPEN`, `CANCEL_ONLY` or `STOP` | `OPEN` on 760 rows, and one undocumented `PREVIEW`, `FDUSDUSDT` |
| `isApiSupported` | false means "API Trading Disabled" | false on 35 USDT rows, all equity, ETF or pre-market contracts, see [`fees.md`](./fees.md) section 3 |
| `minTradeVolume` | "Minimum opening amount (base currency)" | `"0.0001"` on `BTCUSDT`, `"100"` on `BTCUSD` |
| `basePrecision`, `quotePrecision` | decimals of size and price | 4 and 1 on `BTCUSDT` |
| `maxFundingRate`, `minFundingRate` | funding cap and floor | in percent, symmetric on every row, see [`fees.md`](./fees.md) section 6 |
| `priceProtectScope` | order price band around the mark | 0.05 on 660 rows, 0.1 on 82 |

Active perpetuals by settlement asset, counting `OPEN` rows with the API enabled: 685 USDT-M, 25 USDC-M and 15 coin-M.

### What a loader would map

No CCXT class exists, so nothing maps these rows today.
The engine's catalog comes from `loadMarkets` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68, filtered to active swaps at line 79.
A Bitunix loader would have to produce the same `Market` fields by hand.

| engine field | Bitunix source | note |
|---|---|---|
| `rawMarketId` | `symbol` | equal to the socket's `symbol` on every stream subscribed and to the `symbol` of the funding batch |
| `base` | `base`, except on 13 scaled contracts | `1000PEPEUSDT` carries `base` `PEPE`, see below |
| `quote` | `quote` | |
| `linear` | true for `USDT` and `USDC`, false for `USD` | coin-M is margined in the coin, see [`fees.md`](./fees.md) section 3 |
| `contractSize` | 1 on the linear families | the book size is in the base coin, see [`websocket.md`](./websocket.md) section 4 |
| `active` | `symbolStatus` `OPEN` and `isApiSupported` true | |

The id is always `base` plus `quote` except on 13 rows: `1000RATSUSDT`, `1000BONKUSDT`, `1000SATSUSDT`, `1000PEPEUSDT`, `1000SHIBUSDT`, `1000LUNCUSDT`, `1000FLOKIUSDT`, `1000CHEEMSUSDT`, `1MBABYDOGEUSDT`, `1000000MOGUSDT`, `1000SHIBUSDC`, `1000PEPEUSDC` and `1000BONKUSDC`, P2.
On those the `base` names the unscaled token while the price and size are per 1,000 or per 1,000,000 of it.
`1000PEPEUSDT` quoted 0.0049492 with sizes of 309,226 to 580,449 on 2026-09-23 at 01:30 UTC, and Binance's `1000PEPEUSDT` quoted the same price with sizes of the same order.
Its `minTradeVolume` of 790 is about 3.9 USDT at that price, which fits units of 1,000 PEPE.
So a loader must take the base from the symbol prefix, or the pair would need a price scale in [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts).
That reading of the unit is an inference from these two comparisons.

### Pairs listed twice

27 bases are listed on more than one family: 13 on USDT, USDC and USD, 12 on USDT and USDC, and 2 on USDT and USD, P2.
The quote family ranks those, so the loader needs no `marketFilter`, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
The coin-M rows quote a size that looks like US dollars, see [`websocket.md`](./websocket.md) section 4, so they should stay out until that unit is settled.

### Rows outside the catalog

`GET /api/v1/futures/market/tickers` returned 805 rows and `funding_rate/batch` returned 894, against 761 in the catalog, P2.
All 761 catalog rows are in the funding batch, and `FDUSDUSDT` is missing from the tickers.
The 133 funding rows not in the catalog are delisted contracts such as `MILKUSDT`, `WAVESUSDT` and `DARUSDT`, every one with a `fundingRate` of `"0"`.
`TONUSD` among them has `markPrice` `"0"` and `indexPrice` `null`.
A poller keyed by the tracked markets never reads them, and a poller that iterates the reply must skip them.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/futures/market/funding_rate/batch` | `indexPrice` | `markPrice` | `fundingRate`, percent | `fundingInterval`, hours | `nextFundingTime`, Unix ms as a string | 186,291 bytes, 894 rows, no compression | 60 polls: min 130, median 150, p90 199, max 316 ms. Rerun: min 152, median 190, p90 216, max 753 ms. None over 1 s, P3 |
| `GET /api/v1/futures/market/tickers` | absent | `markPrice` | absent | absent | absent | 140,951 bytes, 805 rows | not polled |
| `GET /api/v1/futures/market/funding_rate?symbol=` | same fields as the batch, one symbol | | | | | | |

One call carries every `AnchorRow` column for every family, keyed by `symbol`, which is the socket's id.
The rate limit is 10 requests a second per IP on each market endpoint, S1, so one poll a second uses a tenth of it.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT` | none |
| `index` | `indexPrice` | decimal string, `null` on `TONUSD` | `Number()`, skip a null |
| `mark` | `markPrice` | decimal string, `"0"` on `TONUSD` | `Number()` |
| `fundingRate` | `fundingRate` | decimal string in percent per interval, `"0.01"` is 0.0001 | `Number() / 100` |
| `fundingIntervalHours` | `fundingInterval` | integer hours: 1, 2, 4 or 8 | none |
| `nextFundingAt` | `nextFundingTime` | Unix ms as a string, `"1790150400000"` is 2026-09-23 08:00 UTC | `Number()` |

The documentation example shows `"fundingRate":"0.0005"` with a cap of `"0.3"` and does not name the unit, S2.
The percent reading rests on three probes.
First, on the 212 symbols Binance also lists whose Binance predicted rate was not a default value such as 0.0001 or 0.00005, the Bitunix rate divided by 100 was a median 1.025 times Binance's, with the 10th and 90th percentiles at 0.513 and 1.303, P4.
The rerun gave 207 symbols, a median of 1.031, and percentiles of 0.721 and 1.277.
No such symbol matched Binance exactly, so Bitunix does not copy Binance's rate, and the 484 and 487 exact matches were all at 0, 0.00005 or 0.0001.
Second, the funding history publishes fractions, and `ETHUSD` settled 0.0001 at 00:00 UTC while its batch rate read `"0.01"`, P5.
Third, the socket's `fr` equalled the history's last settled value times 100 on `BTCUSDT`, `ARIAUSDT`, `BTCUSD` and `BTCUSDC`, see section 4.

`nextFundingTime` is on the hour on every catalog row except the `PREVIEW` row.
On the 133 rows outside the catalog and on `FDUSDUSDT` it held a time 0.8 to 31.4 s before the reply instead, and 0.8 to 31.2 s in the rerun, P3, so it is not a settlement there.
At 01:25 UTC the 309 catalog rows on 8 h read 08:00 UTC, 448 of the 449 on 4 h read 04:00 UTC, and the two on 1 h read 02:00 UTC.
`MTLUSDT`, on 4 h, read 05:00 UTC, so a 4 h contract can sit off the 00:00, 04:00 and 08:00 grid.

## 4. Anchor semantics

### Index

The index basket is Not publicly specified in any page this host could read.
The help center article "Spot Index Price and Mark Price" answers HTTP 403 here and to the fetch tool, S3.
No basket or constituents call exists in the futures API, S1.
The Bitunix index is not Binance's: on 819 common symbols it differed from Binance's index by a median 631 to 640 ppm over three runs, and it equalled it on 1 to 3, P4.
`BTCUSDT` read 86,722.8 on Bitunix against 86,693.0 on Binance at about the same second.

### Mark

The help center gives the mark as "Mark Price = MEDIAN (Mark Price1, Mark Price2, Latest Price)", with Mark Price1 = index × (1 + funding basis ratio), the basis ratio = the funding rate at the previous settlement × time to the next settlement ÷ interval, and Mark Price2 = index + the 30 minute moving average of (best bid + best ask) ÷ 2 − index, S3.
That text comes from a search engine's excerpt of the 403 page, not from a direct read.
No clamp beyond the median is documented.
Because the median includes the last price, the mark can be the last trade.
On the last reply of the rerun, 382 of the 760 rows with a settlement on the hour had `markPrice` equal to `lastPrice`, P3.
So on about half the contracts the anchor's mark is the last trade, and its premium over the index is the last trade's basis rather than a smoothed one.
The absolute premium of mark over index on those 760 rows was a median 473 ppm, 2,569 ppm at the 90th percentile, 6,067 ppm at the 99th and 28,013 ppm at the most.

### Funding

| item | value | source |
|---|---|---|
| documented rule | each period's rate is fixed at the start of the period from the previous period's data, and a predicted rate for the next period is computed every minute | S4 |
| cap | `maxFundingRate` and `minFundingRate` per contract, in percent | P2 |
| REST `fundingRate` | changed between runs and never inside one: `BTCUSDT` read `"-0.003173"` at 01:15 UTC, `"0.003757"` at 01:22 and 01:25, and `"0.003834"` at 01:42. `GUSDT` read `"-0.030226"` at 01:25 and `"-0.032283"` at 01:42. Over two runs of 60 one second polls no row of 894 changed | P3 |
| socket `fr` | the rate settled at `ft`, in percent. `fr` times 0.01 equalled the history's 00:00 UTC value on `BTCUSDT`, `ARIAUSDT`, `BTCUSD` and `BTCUSDC`, for example `"-0.00077"` against `-0.0000077` | P5, [`websocket.md`](./websocket.md) section 2 |
| history | `GET /api/v1/futures/market/get_funding_rate_history?symbol=`, fractions, newest first, `fundingTime` as a string of Unix ms, spaced by the interval on all seven contracts read | P5 |

The engine wants the rate for the upcoming settlement.
The REST batch rate is the only candidate, since the socket's `fr` is the last settled one.
Whether the next settlement charges the REST rate is Not verified.
Under the documented rule the rate charged at the end of a period is fixed at its start, so a rate that keeps moving inside the period would be the prediction for the period after.
Under the rule most venues follow, the moving rate is the one the next settlement charges.
The probe did not wait for a settlement to tell the two apart, and the history alone cannot, since it keeps no past predictions.
The settlement instant itself was not captured.

The settled rates were close to Binance's and not equal to them.
`BTCUSDT` settled -0.0000077 at 00:00 UTC on Bitunix and +0.00001021 on Binance, and `ETHUSDT` settled 0.00009047 against 0.00009373, P5.
So Bitunix computes its own rate.

### How often each number changed

Two runs of 60 polls of the batch at 1 s, from 01:24:55 and 01:41:29 UTC, P3.

| symbol | `indexPrice` changes | `markPrice` changes | longest stretch without a mark change, rerun | `fundingRate` changes | `nextFundingTime` changes |
|---|---:|---:|---:|---:|---:|
| `BTCUSDT` | 20 and 31 | 4 and 13 | 8 s | 0 | 0 |
| `ETHUSDT` | 24 and 34 | 10 and 19 | 5 s | 0 | 0 |
| `ARIAUSDT`, quiet | 2 and 3 | 5 and 4 | 19 s | 0 | 0 |
| `BTCUSD`, coin-M | 19 and 28 | 10 and 17 | 9 s | 0 | 0 |
| `BTCUSDC` | 17 and 28 | 14 and 21 | 5 s | 0 | 0 |
| `GUSDT`, 1 h | 5 and 4 | 8 and 13 | 12 s | 0 | 0 |
| `LSKUSDT`, 1 h, rerun only | 19 | 25 | 5 s | 0 | 0 |

Across all rows the index changed 4,012 and 4,862 times and the mark 5,333 and 6,610 times in 59 intervals, about 68 to 82 and 90 to 112 rows a second out of 894.
The socket's `price` channel moved about as often: in 61 s `BTCUSDT` changed its index 24 and 25 times and its mark 11 and 12 times, P6.
A mark that stands still for 8 to 19 s is still stamped fresh on each arrival, so the reader's 10 s age limit at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 5 does not see it.

## 5. REST book snapshot

`GET /api/v1/futures/market/depth?symbol=<symbol>&limit=<limit>`, S1, P7.

| item | value |
|---|---|
| limits | `1`, `5`, `15`, `50` and `max`. Any other value answers code 10008 `Parameter 20 does not match, alternative value ["1","5","15","50","max"].` |
| no limit | the whole book, 17,335 bids and 6,316 asks on `BTCUSDT`, and 17,142 and 6,412 in the rerun |
| `max` | the whole book: 17,328 bids and 6,310 asks in 474,681 bytes on `BTCUSDT`, 157 and 235 on `ARIAUSDT`, 499 and 251 on `BTCUSD`, and 17,137 and 6,416, 137 and 216, 491 and 259 in the rerun |
| level order | bids descending, asks ascending, at every limit on every symbol |
| numbers | price and size as strings. The documentation example shows JSON numbers, S1 |
| time | 124 to 162 ms warm, 301 and 434 ms for the whole `BTCUSDT` book, and 480 and 218 ms on the first call of a run |
| caching | `cf-cache-status: DYNAMIC`, no `age` or `cache-control` header, and two reads 100 ms apart differed in both runs |
| id or timestamp | none in the reply |

The REST book is the 50 level fallback for a deeper view than the socket's 15, at one request per symbol.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| documented limit | "Rate Limit: 10 req/sec/ip" on each market endpoint | S1 |
| limit error | code 10005 "Too many requests, please try again later" and 10006 "Request too frequently", both listed with HTTP status 200 | S5 |
| `Retry-After` | not seen on any reply, and the limit was not tested | P8 |
| error envelope | HTTP 200 with `{"code":<n>,"data":null,"msg":"…"}` | P8 |

Probed error replies, P8.

| request | HTTP | body |
|---|---|---|
| `depth?symbol=NOPEUSDT&limit=15` | 200 | `{"code":20015,"data":null,"msg":"this Futures is not allowed to trade."}` |
| `funding_rate?symbol=MILKUSDT`, delisted | 200 | the same code 20015 |
| `trading_pairs?symbols=NOPEUSDT` and `tickers?symbols=NOPEUSDT` | 200 | the same code 20015 |
| `depth?limit=15`, no symbol | 200 | `{"code":1,"data":null,"msg":"Network Error"}` |
| `depth?symbol=BTCUSDT&limit=20` | 200 | code 10008, quoted in section 5 |
| `depth?symbol=btcusdt&limit=1` | 200 | code 0 and a normal book, so the symbol is case insensitive |
| an unknown path `/nope` | 200 | `{"code":404,"data":null,"msg":"Not Found"}` |

Every error arrives with HTTP 200, so the engine's pause on 403, 418 and 429 at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) would never fire for Bitunix.
A poller has to read `code` and treat 10005 and 10006 as the rate limit.

## 7. Server time and clock offset

The futures API has no server time call, S1.
The `Date` header read at a known point in each second put the local clock within the header's one second resolution, with offsets of -161 to -164 ms on five of six reads and -424 ms on the first, P9.
The rerun gave -165 to -169 ms on five reads and -604 ms on the first.
That is what a clock near zero offset gives when the reads land about 165 ms into the second.
On the socket, `ts` ran 48 to 50 ms before arrival at the minimum while a ping took 100 to 102 ms round trip, see [`websocket.md`](./websocket.md) section 5.
Both readings fit a clock offset near zero, and neither measures it better than about 50 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://fapi.bitunix.com/api/v1/futures/market/funding_rate/batch` | one call carries all five `AnchorRow` fields for every family |
| interval | 1,000 ms, the default | median 150 and 190 ms and max 316 and 753 ms over two runs of 60 polls, at a tenth of the documented limit |
| row mapping | section 3, key `symbol` | |
| rate | `Number(fundingRate) / 100` | the wire is in percent, and the history is in fractions |
| skip | rows not in the tracked catalog, `null` index, `"0"` mark | 133 delisted rows remain in the reply with a rate of 0 |
| skip | rows whose `nextFundingTime` is not on the hour | those carry a recent timestamp instead of a settlement |
| rate limit | read the JSON `code`, and pause 1,000 ms on 10005 or 10006 | every error comes with HTTP 200 and no `Retry-After` was seen |
| mark cadence | expect a mark that stands still for 5 to 19 s | the batch mark of `BTCUSDT` changed 4 and 13 times in 59 s |
| socket alternative | the `price` channel carries index and mark about twice a second, but its `fr` is the last settled rate | the REST rate is still needed for the upcoming one |

The reply is about 16 GB a day at one hertz.
On about half the contracts the mark is the last trade, see section 4, so the mark there moves with the book the engine already reads and is not an independent check of it.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitunix futures OpenAPI: introduction, Get Trading Pairs, Get Tickers, Get Depth, Get Funding Rate | https://www.bitunix.com/api-docs/futures/common/introduction.html and https://www.bitunix.com/api-docs/futures/market/get_depth.html | 2026-09-22 | Bitunix, global | host, fields, limits, sections 1, 2, 5, 6, 7 |
| S2 | Bitunix futures OpenAPI: Get Funding Rate (batch) and Get Funding Rate History | https://www.bitunix.com/api-docs/futures/market/get_funding_rate_batch.html and https://www.bitunix.com/api-docs/futures/market/get_funding_rate_history.html | 2026-09-22 | Bitunix, global | section 3 |
| S3 | Spot Index Price and Mark Price, Bitunix Help Center, HTTP 403 to this host, read as a search excerpt | https://support.bitunix.com/hc/en-us/articles/17038229863193-Spot-Index-Price-and-Mark-Price | 2026-09-22 | Bitunix, global | section 4 |
| S4 | Introduction to Futures Funding Rate, last updated 2026-05-28 | https://www.bitunix.com/hub/helpcenter/article/introduction-to-futures-funding-rate?id=79 | 2026-09-22 | Bitunix, global | section 4 |
| S5 | Bitunix futures OpenAPI, Error Code | https://www.bitunix.com/api-docs/futures/ErrorCode/error_code.html | 2026-09-22 | Bitunix, global | section 6 |
| S6 | Binance USD-M futures `premiumIndex`, `fundingRate` and `depth`, public | https://fapi.binance.com/fapi/v1/premiumIndex | 2026-09-23 UTC | Binance | comparisons in sections 2 to 4 |
| P1 | `rest-probe.mjs latency`, run twice | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 01:24 and 01:38 UTC | this host | section 1 |
| P2 | `rest-probe.mjs catalog`, run twice | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 01:24 and 01:38 UTC | this host | section 2 |
| P3 | `rest-probe.mjs anchor`, two runs of 60 polls | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 01:24 and 01:41 UTC | this host | sections 3 and 4 |
| P4 | `rest-probe.mjs units`, three runs | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 01:27, 01:33 and 01:38 UTC | this host | sections 3 and 4 |
| P5 | `rest-probe.mjs history` on seven symbols, and a one-off read of Binance's funding history on five | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 01:26, 01:32 and 01:42 UTC | this host | sections 3 and 4 |
| P6 | `ws-probe.mjs book`, run twice | [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs) | 2026-09-23 01:21 and 01:35 UTC | this host | section 4 |
| P7 | `rest-probe.mjs book`, run twice | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 01:26 and 01:38 UTC | this host | section 5 |
| P8 | `rest-probe.mjs errors`, run twice | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 01:26 and 01:38 UTC | this host | section 6 |
| P9 | `rest-probe.mjs clock`, run twice | [`rest-probe.mjs`](../../../scripts/probes/venues/bitunix/rest-probe.mjs) | 2026-09-23 01:26 and 01:38 UTC | this host | section 7 |
