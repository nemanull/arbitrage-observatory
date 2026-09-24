# LBank REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 02:37 to 03:06 UTC, from the development host near Seattle.

This profile covers the public contract REST API of LBank (CCXT id `lbank`) for the USDT-margined perpetuals, product group `SwapU`.
The documentation lists four public calls, `getTime`, `instrument`, `marketData` and `marketOrder`, and nothing else, S1.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs) unless a source is named, and each mode ran two or three times.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `https://lbkperp.lbank.com`, S1 and CCXT at `server/node_modules/ccxt/js/src/lbank.js` line 115 |
| resolved | CNAME `lbkperp.lbank.com.cdn.cloudflare.net`, then `104.18.34.3` and `172.64.153.253`, on 2026-09-23 |
| front | Cloudflare, `server: cloudflare`, `cf-cache-status: DYNAMIC`, `cf-ray` edge `YVR` |
| TCP connect | 13 ms, from `curl` at 02:37 UTC |
| cold `getTime` | 196, 204 and 186 ms in three runs |
| warm `getTime`, 10 requests | median 123, 123 and 122 ms, min 115 ms, max 212 ms |
| status to this host | HTTP 200 on every documented call, no geoblock and no challenge page |

## 2. Catalog

### The instruments call

`GET /cfd/openApi/v1/pub/instrument?productGroup=SwapU` returned 845 rows, 355,940 bytes, in 241 and 270 ms.
The documentation marks `productGroup` as required and does not list its values, S1.
`SwapU` is the value CCXT sends, at `lbank.js` line 616, and the only one the web app uses.
`SwapB`, `SwapC`, `Swap`, `SwapUSDC`, an empty value and no parameter at all each returned HTTP 200 with `data: []`.

| field | values on 2026-09-23 |
|---|---|
| `symbol`, `symbolName` | equal on 845 of 845, always `baseCurrency` + `USDT` |
| `clearCurrency`, `priceCurrency` | `USDT` on 845 |
| `volumeMultiple` | 1 on 845 |
| `needSuspend` | 1 on 9: `COCOAUSDT`, `XZNUSDT`, `CEGUSDT`, `SUGARUSDT`, `COTTONUSDT`, `WHEATUSDT`, `SOYBEANUSDT`, `XALUSDT`, `FIGUSDT`, meaning Not publicly specified |
| `symbolAlias` | differs from `baseCurrency` on 36, for example `CROSSUSDT` shown as `ONE`, `ONEUSDT` shown as `HARMONY`, `EDGEXUSDT` as `EDGE`, `ONSEMIUSDT` as `ON`, `O1USDT` as `O`, `KIMIUSDT` as `MOONSHOT` |
| `indexPrice` | present, the same index as `marketData` |
| status | no status field. `marketData` carries `instrumentStatus`, `"2"` on all 845, meaning Not publicly specified |

The instruments reply carries no listing time and no funding fields.

### How CCXT 4.5.68 maps it

`fetchMarkets` calls the spot list and `fetchSwapMarkets`, at `lbank.js` lines 526 to 533, and `fetchSwapMarkets` is lines 614 to 710.

| CCXT field | source | probed |
|---|---|---|
| `id` | `symbol` | 845 of 845 equal to the REST `symbol`, the socket `InstrumentID` and the `marketData` `symbol` |
| `base` | `baseCurrency` | equal on 845 of 845 |
| `quote`, `settle` | `clearCurrency` | `USDT` on 845 |
| `linear` | hard coded `true`, line 676 | 845 |
| `active` | hard coded `true`, line 674 | 845, including the 9 `needSuspend` contracts |
| `contractSize` | `volumeMultiple`, line 678 | 1 on 845 |
| `taker`, `maker` | `fees.trading`, lines 209 and 210 | 0.001 on 845, see [`fees.md`](./fees.md) section 8 |

`loadMarkets` took 1,077 and 1,237 ms and returned 2,211 markets, of which 845 are swaps that pass the connector's filter at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 203.
The connector maps `id`, `linear` and `contractSize` at lines 157 to 176 of the same file.

### Size unit, pairs listed twice, and price scale

- The size unit is base coins, since `contractSize` is 1 and the socket and REST sizes are coins, see [`websocket.md`](./websocket.md) section 4.
- No base is listed twice, so `marketFilter` is not needed.
- LBank renames a ticker that collides and shows the common name in `symbolAlias`.
  CCXT keys `base` on `baseCurrency`, so the contract LBank shows as `EDGE` is base `EDGEX` in the catalog and cannot cluster with another venue's `EDGE`.
  The listing is 36 such contracts, a possible missed match and never a false one.
- `BBUSDT`, `QNTUSDT` and `ONEUSDT` are listed, and all three bases are already in `DENIED_PAIRS` at [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) lines 7 to 12.
- 13 symbols start with a digit, among them `1000SATSUSDT`, `1000LUNCUSDT`, `1000BTTCUSDT`, `1000XECUSDT`, `1000WOJAKUSDT`, `1000000BABYDOGEUSDT` and `10001000SATSUSDT`.
  CCXT keeps the prefix in `base`, as `1000SATS`, so these cluster only with a venue that uses the same prefix, and no `PRICE_SCALE` line is needed unless one does not.
- TradFi contracts, stocks, indices and commodities such as `HK50USDT`, `METASTOCKUSDT`, `GOLDUSDT` and `XTIUSDT`, sit in the same list and the same product group.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /cfd/openApi/v1/pub/marketData?productGroup=SwapU` | `underlyingPrice` | `markedPrice` | `fundingRate`, equal to `positionFeeRate` on every row | `positionFeeTime`, seconds | `nextFeeTime`, Unix ms | 305 KB, 845 rows, gzip | three runs of 60 polls: min 158, 141 and 147 ms, median 185, 171 and 183 ms, p90 201, 183 and 207 ms, max 612, 611 and 602 ms |

One call carries every `AnchorRow` column for every contract, keyed by `symbol`, which is CCXT's `market.id`.
The documentation lists the reply fields as `highestPrice`, `lastPrice`, `lowestPrice`, `markedPrice`, `openPrice`, `prePositionFeeRate`, `symbol`, `turnover` and `volume`, S1.
The wire has no `prePositionFeeRate` and adds `underlyingPrice`, `fundingRate`, `positionFeeRate`, `positionFeeTime`, `nextFeeTime`, `instrumentStatus` and `lastTime`.
CCXT's `parseFundingRate` reads the wire names, at `lbank.js` lines 1363 to 1409.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT` | none |
| `index` | `underlyingPrice` | decimal string, rounded to the contract's price tick | `Number()` |
| `mark` | `markedPrice` | decimal string, never 0 on 845 rows | `Number()` |
| `fundingRate` | `fundingRate` | decimal string, a fraction per interval: `"0.00003745"` is 0.003745 % | `Number()` |
| `fundingIntervalHours` | `positionFeeTime` | integer seconds: 3600, 14400 or 28800 | divide by 3,600 |
| `nextFundingAt` | `nextFeeTime` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

### Rows that cannot be used

| rows | what is wrong | seen in |
|---|---|---|
| `CRTUSDT`, `JMPUSDT`, `TICSUSDT`, `10TAUSDT`, `OBOLUSDT`, `GUSDTUSDT`, `10001000SATSUSDT` | no `fundingRate` and no `positionFeeRate` key, and the index equals the mark | both anchor runs that logged it |
| `1000XECUSDT` | `underlyingPrice` `"0.0"` and `markedPrice` `"0.00001"` | every catalog and anchor run |

## 4. Anchor semantics

### Index

"The price index is a weighted average of prices from major spot markets, based on their trading volumes. Referenced exchanges include: Bitfinex, Binance, Huobi, OKEx, Bittrex, HitBTC.", S2, dated 2023-08-04.
A source more than 5 % from the median gets weight zero, more than one such source switches the index to the median, and a source silent for 10 s gets weight zero, S2.
No public call returns a basket, and the list above dates from 2023 and uses names such as Huobi and OKEx that those venues have since changed, so which venues feed each contract's index today is Not publicly specified.
The web app's trading rule call answered `{"error_code":10006,"msg":"not open path","result":"false","success":false}` to this host.
Whether any basket is LBank's own perpetual cannot be checked, which leaves the self-index trap of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) open.

The index is published in steps of about 5 s.
`BTCUSDT`'s index changed on 12 of 59 intervals in each of three one second poll runs, while `lastTime` changed on 42 or 43.
The socket ticker agreed, 9 index changes in 44 frames.
It is rounded to the contract's tick, so one tick on `CTKUSDT` at 0.1317 is a move of 759 ppm, close to the reader's 1,000 ppm per poll limit at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) line 6.

### Mark

S2 gives two statements that do not agree.
"Basis = Funding rate × (Time to next funding rate settlement (hours) ÷ 8)" with "Mark Price = Price index + Moving average (1-minute basis)", and "The 1-minute basis is the average of [(Bid 1 price + Ask 1 price) ÷ 2 - Price index] over the past minute, calculated every second (60 data points)."
The same page also says "The mark price is updated every 8 hours, in sync with funding rate settlements", which the wire contradicts, since `BTCUSDT`'s mark changed on 14 of 59 intervals in each run.
No clamp on the mark premium is published.

On the wire the premium is large on thin contracts.

| run | median of \|mark / index - 1\| | p90 | max | contracts beyond 10,000 ppm | beyond 5,000 ppm |
|---|---:|---:|---:|---:|---:|
| 02:50 UTC | 1,003 ppm | 4,128 ppm | 91,009 ppm | not logged | not logged |
| 03:03 UTC | 1,064 ppm | 4,143 ppm | 97,875 ppm, `MOOUSDT` at -97,875 | 14 | 53 |
| 03:05 UTC | 1,119 ppm | 4,146 ppm | 96,359 ppm, `MOOUSDT` | 17 | 58 |

A mark that averages the venue's own touch over a minute tracks the perpetual and not the spot, so a thin contract's mark follows its own book, an inference from S2's formula.

### Funding

The formula, interest and premium index are in [`fees.md`](./fees.md) section 6, S3.
The published rate moved between minutes, not between polls: `BTCUSDT` read 0.00003808 at 02:51, 0.00003783 at 02:52, 0.00003746 at 03:01 and 0.00003608 at 03:05 UTC, and it changed on 0 or 1 of 59 intervals in each poll run.
That is the running, time weighted estimate for the upcoming settlement that S3 describes.
The socket ticker's `PrePositionFeeRate` equalled `PositionFeeRate` on the last frame of both book runs, for `BTCUSDT` and `CTKUSDT`.

| interval | contracts | median rate | min | max |
|---|---:|---:|---:|---:|
| 1 h | 1, `MUSEBOOKUSDT` | -775 ppm | | |
| 4 h | 494 with a rate | 50 ppm | -4,500 ppm | 3,450 ppm on `STONKUSDT` |
| 8 h | 343 with a rate | 0 ppm | -4,797 ppm on `1000BTTCUSDT` | 1,307 ppm |

These are the 03:05 UTC run, and the 03:03 UTC run gave the same medians and extremes within 3 %.
The 4 h median of 50 ppm is half the 100 ppm that the 8 h `ETHUSDT` and `DOGEUSDT` showed, which suggests the 0.01 % interest is per 8 h and scaled to the interval, an inference.
No cap is published, and the largest magnitude seen was 4,827 ppm, about 0.48 % per interval, at 03:03 UTC.

### Rate across a settlement

The public API has no funding history call, so the rate on either side of a settlement was not read, and the settlement instant itself was not captured.
Settlements fall on `nextFeeTime`, and at 02:50 UTC the 4 h contracts read 04:00 UTC, the 8 h contracts 08:00 UTC and the 1 h contract 03:00 UTC.

### How often each number changed

Three runs of 60 one second polls, 02:50, 03:03 and 03:05 UTC.

| contract | index changes | mark changes | rate changes | largest index move | largest mark move |
|---|---|---|---|---|---|
| `BTCUSDT` | 12, 12, 12 | 14, 14, 14 | 0, 1, 0 | 79, 36, 187 ppm | 112, 45, 190 ppm |
| `ETHUSDT` | 15, 18, 15 | 17, 18, 18 | 0, 0, 1 | 141, 112, 178 ppm | 131, 185, 243 ppm |
| `DOGEUSDT` | 11, 15, 15 | 13, 19, 15 | 0, 0, 0 | 393, 485, 584 ppm | 491, 485, 681 ppm |
| `CTKUSDT` | 0, 0, 3 | 0, 2, 0 | 0, 0, 0 | 0, 0, 759 ppm | 0, 759, 0 ppm |
| `HK50USDT` | 6, 4, 6 | 32, 29, 25 | 0, 0, 0 | 423, 101, 151 ppm | 394, 142, 136 ppm |

`lastTime` was at most 4 s old on the freshest row of every poll and 36 to 196 s old on the stalest, so it is a per row update time, not a reply time.

## 5. REST book snapshot

`GET /cfd/openApi/v1/pub/marketOrder?symbol=BTCUSDT&depth=<n>`, S1.

| `depth` | bids | asks | time |
|---|---:|---:|---|
| 1 | 1 | 1 | 215, 189 ms |
| 5 | 5 | 5 | 129, 118 ms |
| 20 | 20 | 20 | 127, 121 ms |
| 50 | 50 | 50 | 416, 129 ms |
| 100 | 100 | 100 | 129, 124 ms |
| 200 | 200 | 200 | 145, 134 ms |
| 500 | 500 | 489, 492 | 156, 144 ms |
| 1000 | 838, 842 | 488, 492 | 171, 161 ms |
| absent or 0 | 25 | 25 | |

- Levels are objects `{"volume": "9.7658", "price": "86413.2", "orders": "1"}` with strings, bids descending and asks ascending at every depth.
- `CTKUSDT` and `HK50USDT` returned 25 levels per side at `depth=50`.
- Five reads 200 ms apart were all different and all `cf-cache-status: DYNAMIC`, so the book is not cached at the edge.
- CCXT's `fetchOrderBook` asks for 60 levels when no limit is given, at `lbank.js` line 917.

## 6. Rate limits and errors

The documentation publishes no rate limit for the public calls, and its error table lists code 183 "Exceeded maximum query count per second", S1.
CCXT assumes "20 per second for all other requests", at `lbank.js` lines 28 and 29.
No reply carried a rate limit header or `Retry-After`, and no limit was reached at about two requests a second.

| request | HTTP | body |
|---|---|---|
| `marketOrder` with `symbol=NOPEUSDT` | 200 | `{"error_code":20156,"msg":"This product has been delisted and is not available for trading.","result":"false","success":false}` |
| `marketOrder` with `symbol=btcusdt` | 200 | the same 20156 body |
| `marketOrder` without `symbol` | 500 | `{"error_code":500,"msg":"Internal Server Error","result":"false","success":false}` |
| `marketOrder` without `depth`, or `depth=0` | 200 | a 25 level book |
| `instrument` or `marketData` without `productGroup` | 200 | `{"data":[],"error_code":0,"msg":"Success","result":"true","success":true}` |
| an unknown path under `/cfd/openApi/v1/pub/` | 403 | an `openresty` "403 Forbidden" HTML page |

An error comes back with HTTP 200 and `success: false`, so a poller has to read `success` and not only the status.
The engine's pause on 403, 418 and 429 would fire on a wrong path, which is harmless.

## 7. Server time and clock offset

`GET /cfd/openApi/v1/pub/getTime` returns `{"data":1790131879213,"error_code":0,"msg":"Success","result":"true","success":true}`, Unix ms.
Over the fastest of ten requests, at 115 to 117 ms round trip, the server clock read 18, 22 and 21 ms ahead of this host.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://lbkperp.lbank.com/cfd/openApi/v1/pub/marketData?productGroup=SwapU` | one call carries all five `AnchorRow` fields for all 845 contracts |
| interval | 1,000 ms, the default | median 171 to 185 ms and max 612 ms over 180 polls, and the index itself moves about every 5 s |
| row mapping | section 3, key `symbol` | |
| success check | skip the round when `success` is not `true` | errors arrive with HTTP 200 |
| skip | a row without `fundingRate` | 7 rows on 2026-09-23 |
| skip | a row whose `underlyingPrice` is 0 | `1000XECUSDT` |
| skip | the 9 `needSuspend` contracts, from the instruments call | CCXT marks them active |
| rate limit pause | `rateLimitPauseMs` 10,000 | no limit or `Retry-After` is published |
| deny list input | none possible from the API | no basket call, section 4 |

The reply is about 305 KB a second, about 26 GB a day before gzip, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | LBank CONTRACT API | https://www.lbank.com/docs/contract.html | 2026-09-22 | LBank, global | host, the four public calls, their parameters and documented fields, error code 183, sections 1 to 7 |
| S2 | Mark Price and Funding Rate in Futures, 2023-08-04 | https://www.lbank.com/support/articles/21423004948377 | 2026-09-22 | LBank, global | index and mark formulas, section 4 |
| S3 | Funding Rate: Definition, Components, and Uses, 2023-08-04 | https://www.lbank.com/support/articles/21422922435353 | 2026-09-22 | LBank, global | funding formula and time weighting, section 4 |
| S4 | CCXT 4.5.68 `lbank.js` | `server/node_modules/ccxt/js/src/lbank.js` | 2026-09-22 | CCXT | host, product group, swap parser, funding parser, rate limit comment, sections 1 to 6 |
| P1 | `rest-probe.mjs catalog`, runs at 02:50 and 03:03 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 and 2 |
| P2 | `rest-probe.mjs anchor`, runs at 02:50, 03:03 and 03:05 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs book`, runs at 02:51 and 03:04 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P4 | `rest-probe.mjs misc`, runs at 02:51, 03:04 and 03:05 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 6 and 7 |
| P5 | `ws-probe.mjs book`, ticker readings | [`ws-probe.mjs`](../../../scripts/probes/venues/lbank/ws-probe.mjs) | 2026-09-23 UTC | this host | the funding rate over minutes and the ticker's index changes, section 4 |
| P6 | exploratory `curl` and `dig` at 02:37 UTC | | 2026-09-23 UTC | this host | CNAME and TCP connect time, section 1 |
