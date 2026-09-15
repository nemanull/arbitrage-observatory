# Bitget REST Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

Every probed number here comes from [`../../../scripts/probes/bitget-rest-probe.mjs`](../../../scripts/probes/bitget-rest-probe.mjs) or [`../../../scripts/probes/bitget-settlement-probe.mjs`](../../../scripts/probes/bitget-settlement-probe.mjs), run from `server/` on Node 24 with the global `fetch`.
The first run was 06:57 to 08:03 UTC, and the second pass reran every section from 18:52 to 19:20 UTC on the same date.
Latency includes TLS, the request and reading the whole body, and it is one host on one date, not a distribution.
The socket is in [`websocket.md`](./websocket.md), and fees are in [`fees.md`](./fees.md).

## 1. Host and latency

| host | resolved on 2026-09-15 | what it suggests |
| --- | --- | --- |
| `api.bitget.com` | `104.18.14.166`, `104.18.15.166`, CNAME `api.bitget.com.bpgslb007.com` then `api.bitget.com.cdn.cloudflare.net` | Cloudflare in front of the API. Every reply carried `server: cloudflare`, and the `cf-ray` suffix read `YVR`, which is the Vancouver edge. That the origin sits elsewhere is an inference, since Cloudflare does not show it. |
| `ws.bitget.com` | `18.238.217.8`, `.29`, `.121`, `.124`, CNAME `ws.bitget.com.bpgslb007.com` then `dxotqhr62n6z4.cloudfront.net` | CloudFront. The WebSocket upgrade read `x-amz-cf-pop: SEA900-P4`, a Seattle edge. |

The first request of the process paid DNS and TLS.
Every later call reused that connection, so the first column below is warm for every call but the first.
Warm reads are five, one second apart.
Bytes are the decompressed body, since every reply came `content-encoding: br`.

| call | first ms | warm min / med / max ms | bytes |
| --- | ---: | ---: | ---: |
| `GET /api/v2/public/time` | 196, TTFB 191, cold | 111 / 114 / 126 | 98 |
| `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES` | 127 | 117 / 120 / 139 | 608,204 |
| `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` | 118 | 117 / 119 / 155 | 397,089 |
| `GET /api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES` | 124 | 112 / 115 / 123 | 119,311 |
| `GET /api/v3/market/tickers?category=USDT-FUTURES` | 121 | 119 / 121 / 133 | 383,329 |
| `GET /api/v2/mix/market/merge-depth?productType=USDT-FUTURES&symbol=BTCUSDT&limit=50` | 110 | 109 / 121 / 142 | 1,865 |
| `GET /api/v3/market/orderbook?category=USDT-FUTURES&symbol=BTCUSDT&limit=50` | 110 | 111 / 112 / 143 | 1,802 |

Over 60 one second polls the tickers call took 115 to 167 ms, median 125, and the funding call 120 to 244 ms, median 140.
The second pass at 18:52 UTC read warm medians of 114 to 175 ms on the same seven calls, and over its 60 polls the tickers call took 115 to 471 ms, median 141, and the funding call 109 to 466 ms, median 123.
A 400 KB reply still arrives in about 120 to 140 ms, so body size costs this venue little time from this host.

## 2. Catalog

### Two API generations

Bitget runs a classic account API, v2, and a Unified Trading Account API, v3.
The classic docs call the classic account "in maintenance mode" and recommend UTA, see the [Introduction](https://www.bitget.com/docs/classic/Introduction).
Both answer public market data without keys from this host.

| call | generation | rate limit | notes |
| --- | --- | --- | --- |
| `GET /api/v2/mix/market/contracts?productType=` | classic | 20 per second per IP | `productType` is `USDT-FUTURES`, `USDC-FUTURES` or `COIN-FUTURES`. This is what CCXT calls. |
| `GET /api/v3/market/instruments?category=` | UTA | 20 per second per IP | Same USDT-M and USDC-M ids. Different Coin-M ids. |

Sources: [Classic Contract Market API](https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market) and [UTA Market Data](https://www.bitget.com/docs/catalog/market/market-data).

### Status values

Documented for classic `symbolStatus`: `listed`, `normal`, `maintain`, `limit_open`, `restrictedAPI` and `off`.
Documented for UTA `status`: `listed`, `online`, `limit_open`, `limit_close`, `offline` and `restrictedAPI`.
Probed: every classic row read `normal` and every UTA row read `online`, in the morning and in the second pass, so no other status was on the wire that day.

### Active perpetuals by settlement asset

Probed with CCXT 4.5.68, filtered as `isActiveSwapMarket` does at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194.

| settle | linear | CCXT active swaps | classic `productType` | example `market.id` |
| --- | --- | ---: | --- | --- |
| USDT | true | 786 | `USDT-FUTURES` | `BTCUSDT` |
| USDC | true | 49 | `USDC-FUTURES` | `BTCPERP` |
| the base coin | false | 9 | `COIN-FUTURES` | `BTCUSD` |
| SUSDT, SUSDC, SBTC, SETH | mixed | 7 | `SUSDT-FUTURES`, `SUSDC-FUTURES`, `SCOIN-FUTURES` | `SBTCSUSDT` |

The second pass at 18:52 UTC loaded 2,617 markets and 852 active swaps, 787 of them USDT-M, with the other rows unchanged.
The last row is Bitget's demo product.
Its markets are simulated, see [`fees.md`](./fees.md) section 3, and CCXT still loads them as active swaps because `fetchDefaultMarkets` asks for all six product types, at `server/node_modules/ccxt/js/src/bitget.js:2012`.
CCXT also loads 4 dated futures, `BTCUSDU26`, `ETHUSDU26` and two demo ones, as `future`, which the connector drops.
Of the 786 USDT-M perpetuals, 320 carry `isRwa` `YES`, the stock, index, forex, metal, commodity and pre-listing contracts.

The UTA Coin-M list differs.
`GET /api/v3/market/instruments?category=COIN-FUTURES` returned 20 perpetuals with ids like `BTCUSD_CM`, `SUIUSD_CM` and `HYPEUSD_CM`, plus `BTCCMZ26` and `ETHCMZ26`, where classic lists 9 perpetuals with ids like `BTCUSD`.
The UTA USDT-M and USDC-M lists matched the classic lists id for id, 786 and 49 in the morning, and 787 and 49 in the second pass.

### How CCXT maps a market

| field | CCXT source | probed |
| --- | --- | --- |
| `market.id` | the `symbol` field of the contracts row, `bitget.js:2106` | Equal to the socket `instId` and to the `symbol` key of both anchor calls. Every one of 786 USDT-M, 49 USDC-M and 9 Coin-M ticker rows matched a CCXT id. |
| `base`, `quote` | `baseCoin` and `quoteCoin` through `safeCurrencyCode`, `bitget.js:2109` to `:2110` | `1000BONKUSDT` has base `1000BONK`. Three ids are non-ASCII, `龙虾USDT`, `牛来USDT` and `哈基米USDT`, with the same non-ASCII base. |
| `settle` | the base if it is in `supportMarginCoins`, else the quote, else the first margin coin, `bitget.js:2111` to `:2122` | `BTCUSD` settles in BTC even though its `supportMarginCoins` lists seven coins. |
| `linear` | `inverse = (base === settle)`, `bitget.js:2172` | Coin-M is inverse, everything else linear. |
| `active` | `symbolStatus` is `normal` or `online`, `bitget.js:2193` to `:2196` | 851 of 851 active, and 852 of 852 in the second pass. |
| `contractSize` | `1` for every contract, `bitget.js:2202` | Book sizes are in base coin, so 1 is right. The WebSocket top five of MAVUSDT equalled the REST `merge-depth` top five level for level in base coin units, in the morning and again in the second pass. `sizeMultiplier` is the order size step, not a contract multiplier, per the contract config page. |
| `taker` | the `takerFeeRate` field, `bitget.js:2223` | `0.0006` on all 851. |

### Pairs listed more than once

No base and quote pair is listed twice.
But 49 pairs have two or three contracts inside one quote family, since the engine groups USD, USDC and USDT, see [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
BTC, for example, is `BTCUSDT`, `BTCPERP` and `BTCUSD`.
Every one of the 49 USDC-M contracts and the 9 Coin-M contracts has a USDT-M twin, so `marketRank` in [`../../../server/src/engine/cluster/quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) would keep the USDT-M contract on every pair.
The orchestrator streams only tracked markets, at [`../../../server/src/orchestrator.ts`](../../../server/src/orchestrator.ts) lines 218 to 220, so in practice Bitget contributes only USDT-M perpetuals.

### Price scale and name collisions

- `OPENAIUSDT` read 1,458.86 and `ANTHROPICUSDT` 2,069.2 at 07:11 UTC, while okx's `OPENAI-USDT-SWAP` read 148.81 and `ANTHROPIC-USDT-SWAP` 214.22 at about 07:33 UTC.
  In the second pass, read seconds apart, Bitget's marks were 1,443.39 and 2,065.28 and okx's last trades 147.5 and 211.55.
  The engine already scales those two okx markets by 10, see [`../../../server/src/engine/cluster/clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) lines 20 to 23, and Bitget's prices sit at that scaled magnitude, so Bitget needs no scale on them.
  The morning reads were 22 minutes apart, and the second pass compared a mark with a last trade, so the gap between the two venues was not measured.
  Both Bitget indices come from one source, see section 4.
- `BBUSDT` and `QNTUSDT` are listed, and `ONUSDT` is not.
  The existing `DENIED_PAIRS` lines name ticker collisions between binance, bybit and okx.
  Which token Bitget's BB and QNT are was Not verified.
- `ONEUSDT` is listed, and its index is 60 % Bitget's own perpetual, see section 4.

## 3. Anchor

Two classic calls per family carry every column, and each answers for the whole family at once.

| call | rows on 2026-09-15 | bytes | columns it carries |
| --- | ---: | ---: | --- |
| `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` | 786, and 787 in the second pass | 397,069 | `indexPrice`, `markPrice`, `fundingRate`, `ts` |
| `GET /api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES` | 798, and 799 in the second pass | 119,312 | `fundingRate`, `fundingRateInterval`, `nextUpdate`, `minFundingRate`, `maxFundingRate` |
| `GET /api/v2/mix/market/tickers?productType=USDC-FUTURES` | 49 | 24,880 | as above |
| `GET /api/v2/mix/market/current-fund-rate?productType=USDC-FUTURES` | 50 | 7,603 | as above |
| `GET /api/v2/mix/market/tickers?productType=COIN-FUTURES` | 11 | 5,615 | as above, including 2 dated futures |
| `GET /api/v2/mix/market/current-fund-rate?productType=COIN-FUTURES` | 14 | 2,094 | as above, dated futures with `nextUpdate` 0 |

The UTA twins are `GET /api/v3/market/tickers?category=USDT-FUTURES`, 383 KB with the same index, mark and rate fields, and `GET /api/v3/market/current-fund-rate?category=USDT-FUTURES`, 160 KB, which adds `cashDividend` and `cashDividendNextUpdate`.
Read in the same second, v2 and v3 gave equal marks and funding rates on the four tracked symbols, and indices that differed in the eighth significant digit, as `77238.928` and `77238.918`, since the two replies were stamped 800 ms apart.
In the second pass the two replies were stamped 0.7 to 1.3 s apart and every index, mark and rate was equal.

The `fundingRate` of the tickers call equalled the funding call on all 786 USDT-M rows read together.
The funding call also lists 12 symbols the tickers and contracts calls do not, such as `PLAYUSDT`, `TRUTHUSDT`, `BGTESTMEUSDT` and `RWATESTMEUSDT`, all with `maxFundingRate` `null`, in both runs.
The keys of both calls use the CCXT `market.id` spelling.

### Field for each `AnchorRow` column

The row type is at [`../../../server/src/engine/cluster/types.ts`](../../../server/src/engine/cluster/types.ts) lines 42 to 49.

| column | field | unit | probed |
| --- | --- | --- | --- |
| `index` | tickers `indexPrice` | quote per base coin, a decimal string with up to 16 decimals, as `0.0103579021830553` | Present and positive on every row. |
| `mark` | tickers `markPrice` | quote per base coin, a decimal string | Present and positive on every row. |
| `fundingRate` | tickers or funding call `fundingRate` | a fraction per interval, `0.0001` is 0.01 %, per the UTA page "0.000088 represents 0.0088%" | The rate for the upcoming settlement, see section 4. |
| `fundingIntervalHours` | funding call `fundingRateInterval` | hours as a string, "1 represents 1 hour, 2 represents 2 hours, and so on" | 1 h on 5, 4 h on 382, 8 h on 411 USDT-M rows in the morning, and 4, 383 and 412 in the second pass. It agreed with the contracts `fundInterval` on every row in both. |
| `nextFundingAt` | funding call `nextUpdate` | Unix ms as a string | `1789459200000`, 08:00 UTC, on all 798 rows at 07:11 UTC, since 08:00 is on every grid. At 18:53 UTC the 1 h rows read 19:00, the 4 h rows 20:00 and the 8 h rows 00:00 UTC. It equalled `nextFundingTime` of `GET /api/v2/mix/market/funding-time` for a 1 h, a 4 h and an 8 h symbol in both runs. |

The tickers `ts` is one timestamp for the whole reply, and in the first five polls it was 73 to 103 ms older than the reply's arrival.
Captured rows, trimmed to the anchor fields:

```json
{"symbol":"BTCUSDT","lastPr":"77202.1","askPr":"77202.1","bidPr":"77202","ts":"1789456276886","indexPrice":"77237.976","fundingRate":"0.0001","markPrice":"77202.1"}
```

```json
{"symbol":"BTCUSDT","fundingRate":"0.0001","fundingRateInterval":"8","nextUpdate":"1789459200000","minFundingRate":"-0.003","maxFundingRate":"0.003"}
```

## 4. Anchor semantics

### Index

Published in [What is Index Price in Future Trading?](https://www.bitget.com/support/articles/12560603824105), dated 2025-03-13.

- A weighted average of spot prices from up to six exchanges, each weighted by its 24 hour volume, with weights refreshed every four hours.
- It updates at least every 200 ms.
- A source more than 5 % from the median of all sources is dropped until it returns within 2 %, and a source silent for 15 minutes is dropped.
- Neither removal applies when a source weighs more than 30 % or when only two sources remain.
  Bitget then decides by hand.
- In extreme cases Bitget "may remove an exchange from the calculation or assign fixed weights to prevent systemic risk".
- A change of sources that would move the index more than 0.1 % is phased in gradually.

The basket call is public: `GET /api/v3/market/index-components?symbol=`, 10 per second per IP, see [UTA Derivatives and Funding Rate](https://www.bitget.com/docs/catalog/market/derivatives).
Probed at 1 request per second over all 786 USDT-M perpetuals plus `BTCPERP`, `ETHPERP`, `BTCUSD` and `ETHUSD`, 07:09 to 07:22 UTC, and every one answered.
The second pass walked the 787 USDT-M perpetuals and the same four from 19:06 to 19:19 UTC, and all 791 answered.

| finding | 07:09 UTC | 19:06 UTC | examples |
| --- | ---: | ---: | --- |
| baskets with 6 sources | 170 | 222 | `BTCUSDT`: BINANCE 0.3, BITGET 0.3, OKX 0.2, BYBIT 0.1, GATEIO 0.05, MEXC 0.05, the same weights in both runs |
| baskets with 1 source | 22 | 22 | all TradFi or pre-listing: `OPENAIUSDT`, `ANTHROPICUSDT`, `MOONSHOTUSDT`, `H100USDT`, `B200USDT` on `BITGET_CROSS`, oil, gas and copper on `PYTH_PRO`, `HSIUSDT` on `ITICK_INDEX` |
| crypto baskets with 1 source | 0 | 0 | |
| baskets made only of `BITGET_FUTURE` | 0 | 0 | |
| crypto baskets that include `BITGET_FUTURE` | 44 | 48 | morning: `UBUSDT` 0.85, `LYNUSDT` 0.6522, `ONEUSDT` 0.6, `RAVEUSDT` 0.5207, `TAIKOUSDT` 0.5, `FOLKSUSDT` 0.4676, `XPINUSDT` 0.4565, `SIRENUSDT` 0.45. Second pass: `UBUSDT` 0.8696, `XPINUSDT` 0.6317, `LYNUSDT` 0.6259, `ONEUSDT` 0.6, `RAVEUSDT` 0.558, `FOLKSUSDT` 0.5173, `TAIKOUSDT` 0.5, `IDOLUSDT` 0.4727 |
| crypto baskets with `BITGET_FUTURE` at 0.3 or more | 20 | 19 | |

`BITGET_FUTURE` reads as Bitget's own perpetual, which is an inference from the name, since the docs define no exchange codes.
The index article speaks only of spot prices on exchanges, while the wire also lists that code, data vendors such as `PYTH_PRO`, `DXFEED`, `INTRINIO` and `MASSIVE`, `HYPERLIQUID`, and `BINANCE_INDEX`.
The weights on BTCUSDT were round numbers, 0.3, 0.3, 0.2, 0.1, 0.05 and 0.05, where the article describes volume weights, so a fixed weighting is likely in force there.
The UTA page's own example response, stamped December 2025, shows `BITGET_FUTURE` at 0.4696 in the BTCUSDT basket, so baskets change, and the own-perpetual weights of `XPINUSDT` and `FOLKSUSDT` moved within the day.
`ONEUSDT` at 0.6 own perpetual is the shape that let binance ONE through the fresh gate, see [`../../research/2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
`UBUSDT` at 0.85 to 0.87 is the closest to a basket of the perpetual alone.

### Mark

Published in [What is Mark Price in Future Trading?](https://www.bitget.com/support/articles/12560603824106), dated 2025-10-13.

```text
mark = median(Price 1, Price 2, Price 3), updated every 200 ms
Price 1 = last price on the Bitget futures market
Price 2 = index x (1 + latest funding rate x minutes to next settlement / interval minutes)
Price 3 = index + MA over 30 s of ((bid1 + ask1) / 2 - index), sampled every 1 s
```

- No cap or clamp on the mark premium is published.
- The article says Bitget "may adjust the MA calculation window for Price 3 or switch the mark price calculation to Price 1 in response to highly volatile market conditions".
- Probed: `markPrice` equalled `lastPr` on 351 of 786 USDT-M rows read at once at 07:11 UTC, 227 of 466 crypto and 124 of 320 TradFi.
  On BTCUSDT the mark 77202.1 equalled the last trade and the best ask.
  The second pass at 18:53 UTC read 235 of 787.
- So on a third to a half of the contracts at any moment, the mark is the last trade, the median's Price 1.
  Where it is, a leg's fresh premium, touch over mark, measures the book against its own last print rather than a smoothed anchor.
- Probed absolute mark premium over index across USDT-M at 07:11 UTC: median 816 ppm, p90 2,813 ppm, p99 14,265 ppm, max 57,845 ppm.
  At 18:53 UTC: median 502 ppm, p90 2,275 ppm, p99 7,225 ppm, max 10,133 ppm.

### Funding

The formula, the cap rule and the settlement instants are in [`fees.md`](./fees.md) section 6.

- Cap and floor per symbol: `maxFundingRate` and `minFundingRate` in the funding call, symmetric on every row, 0.3 % on BTCUSDT and ETHUSDT.
  No row sat at its cap in either run.
  The cap distribution changed between the two runs, see [`fees.md`](./fees.md) section 6.
- Interval: `fundingRateInterval` per symbol.
  Bitget changes it per symbol by announcement, so it must be read every round.
- Unit: a fraction per interval.
- Upcoming or settled: the published rate is the running rate for the upcoming settlement.
  At 07:11 UTC BTCUSDT published 0.0001 while its last settlement, 00:00 UTC, had settled at 0.00002, and IOSTUSDT published −0.000171 against −0.000177 settled at 07:00.
  The settlement watch below confirms it on MTLUSDT.
- Recalculation: the running rate is republished about once a minute.
  MTLUSDT's changed at −59, +1, +61 and +121 s around 19:00 UTC, and BTCUSDT's once in the same four minutes.

### Settlement instant

Probed with [`../../../scripts/probes/bitget-settlement-probe.mjs`](../../../scripts/probes/bitget-settlement-probe.mjs) from 18:58:30 to 19:02:30 UTC on 2026-09-15, polling the funding call, the tickers call and `history-fund-rate` once a second each.
MTLUSDT, a 1 hour contract, settled at 19:00, and BTCUSDT, an 8 hour contract, was the control.

| time from 19:00:00 UTC | funding call, MTLUSDT | tickers call, MTLUSDT | `history-fund-rate` newest row |
| --- | --- | --- | --- |
| −1 s and 0 s | `-0.000457`, `nextUpdate` 19:00 | `-0.000457` | `-0.000655` at 18:00 |
| +1 s | `-0.000449`, `nextUpdate` 20:00 | `-0.000457` | `-0.000457` at 19:00 |
| +2 s | `-0.000449`, `nextUpdate` 20:00 | `-0.000449` | `-0.000457` at 19:00 |

- The last rate published before the instant, `-0.000457`, is the rate the history recorded as settled at 19:00.
- The funding call rolled `nextUpdate` and published the next running rate in the first poll after the instant, and the history had the settled row in the same poll.
- The tickers call carried the settled rate for one more poll.
  At +121 s the order was the reverse, with the tickers call one poll ahead.
  So the two calls can disagree for about a second.
- BTCUSDT kept `nextUpdate` 00:00 UTC throughout, and all 480 bulk replies were HTTP 200 in at most 334 ms.

### How often each number changes

60 polls at 1 Hz, 07:11:21 to 07:12:20 UTC, the tickers and funding calls in parallel, counted across the 59 consecutive pairs.
The second pass at 18:53 UTC, with FRAXUSDT and SANTOSUSDT as the thin pair, read 57 index and 55 mark changes on BTCUSDT, 55 and 53 on ETHUSDT, 2 and 14 on FRAXUSDT, 2 and 2 on SANTOSUSDT, and one funding rate change on BTCUSDT and FRAXUSDT.

| symbol | index changed | mark changed | funding rate changed | `nextUpdate` changed |
| --- | ---: | ---: | ---: | ---: |
| BTCUSDT | 47 | 39 | 0 | 0 |
| ETHUSDT | 44 | 34 | 0 | 0 |
| MAVUSDT, thin | 2 | 0 | 0 | 0 |
| CELRUSDT, thin | 8 | 0 | 0 | 0 |

The largest one poll move on BTCUSDT was 54 ppm on the index and 67 ppm on the mark, far under the reader's 1,000 ppm guard.
The thin marks did not move for a minute, which is what a mark pinned to a last trade does on a book that did not trade.

## 5. REST book snapshot

| call | depth | rate limit | notes |
| --- | --- | --- | --- |
| `GET /api/v2/mix/market/merge-depth?productType=&symbol=&limit=` | `limit` 1, 5, 15, 50 or `max`, default 100, `precision` `scale0` to `scale3` | 20 per second per IP | Probed `limit=max` returned 100 levels a side on BTCUSDT, and every level on the thin books, 60 and 71 on MAVUSDT. |
| `GET /api/v3/market/orderbook?category=&symbol=&limit=` | default 5, maximum 1000 | 20 per second per IP | |

- Level order: bids descending and asks ascending on every read of both calls, as the UTA page documents.
- Number type: prices and sizes are JSON numbers here, as `[77176,1.4392]`, where the socket sends strings.
- Caching: `cf-cache-status: DYNAMIC` on every read, and four reads one second apart returned four different `ts` values with changing sizes on BTCUSDT, in both runs.
  No edge cache was seen.
- Thin books in the second pass: `limit=max` returned 63 bids and 69 asks on FRAXUSDT and 82 and 59 on SANTOSUSDT, and 100 a side on BTCUSDT again.
- A real symbol under the wrong product type is served anyway: `merge-depth` with `productType=USDT-FUTURES&symbol=BTCPERP` answered `200` with the USDC-M book.

## 6. Rate limits, status codes and errors

- Per endpoint limits, per IP: 20 per second on tickers, current funding rate, contracts, merge depth, history funding rate and funding time, 10 per second on index components and the VIP fee rate, 5 per second on discount rate.
  `symbol-price` is 20 per second limited by user ID.
  Sources: the classic and UTA market pages in the ledger.
- Overall: "The overall rate limit for the common domain name is 6000 requests/IP/min", and "REST and WebSocket share the same rate limit quota", per the [UTA Quick Start](https://www.bitget.com/docs/uta/quick-start).
  The classic pages this research found state per endpoint limits only.
- Status on a limit: `429 Too Many Requests`, per the Quick Start and the [UTA error code page](https://www.bitget.com/docs/uta/error-code/common-error-handling).
  The probe never reached a limit, so the 429 body is Not verified.
- `Retry-After`: Not publicly specified, and not observed.
- Remaining quota header: `x-mbx-used-remain-limit`, documented as the "Remaining rate limit quota for the current endpoint".
  Probed at `19` or `18` on every call while polling at 1 Hz, in both runs.
- Error shape: HTTP 400 with a JSON body.
  `code` is a string, `"00000"` on success.

```json
{"code":"40034","msg":"Parameter NOPEUSDT does not exist","requestTime":1789456354640,"data":null}
```

```json
{"code":"40019","msg":"Parameter NOPE-FUTURES cannot be empty","requestTime":1789456355854,"data":null}
```

```json
{"code":"25100","msg":"Trading pair NOPEUSDT does not exist","requestTime":1789456359504,"data":null}
```

The first came from classic `merge-depth` and `current-fund-rate` with an unknown symbol, the second from classic `tickers` with an unknown product type, and the third from UTA `orderbook`.
The second pass returned the same status, `code` and `msg` on all six error calls.
UTA `current-fund-rate` without `category` or `symbol` answered `40019`, "Parameter symbol,category cannot be empty".

## 7. Server time and clock offset

`GET /api/v2/public/time` returns `{"code":"00000","data":{"serverTime":"1789455435724"}}`, milliseconds as a string.
Five samples one second apart put the server clock −1.5 to +3.0 ms from this host's clock, taken at the midpoint of 109 to 117 ms round trips.
The second pass at 18:54 UTC read −60.5 to −54 ms at the midpoint of 110 to 123 ms round trips.
The offset moved by about 57 ms in twelve hours on the same server call, so it describes this host's clock on the day, not the venue.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

- URLs: `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` and `GET /api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES`, in parallel.
  Add the `USDC-FUTURES` pair only if a USDC-M contract is ever tracked, which section 2 shows no pair needs today.
- Interval: 1 s.
  Both replies arrive in about 120 to 170 ms, and BTCUSDT's index moved on 47 of 59 one second polls.
  Two requests per second is a tenth of either endpoint's limit.
- Row mapping: `index` from tickers `indexPrice`, `mark` from tickers `markPrice`, and `fundingRate`, `fundingIntervalHours` and `nextFundingAt` from the funding call's `fundingRate`, `fundingRateInterval` and `nextUpdate`, joined on `symbol`, which equals `rawMarketId`.
  Taking the rate and the instant from one reply keeps them consistent at a settlement, where the tickers rate can trail by a poll.
- Success check: HTTP 200 and `code === "00000"`.
  A bad parameter comes back as HTTP 400, which `getJson` already raises.
- Skip: funding rows without a ticker row, the 12 pre-listing and test symbols with `maxFundingRate` `null`, and any row whose `indexPrice` is not positive.
- Rate limiting: no `Retry-After` is documented, so a 429 falls back to `rateLimitPauseMs`.
- API generation: the poller, the catalog CCXT loads and the recommended feed all spell USDT-M and USDC-M ids the same way.
  CCXT and this poller use the classic v2 calls, the recommended feed uses the v3 socket, and they agree on every linear id.
  They differ only on Coin-M, where v3 uses `_CM` ids, and the feed's market filter drops Coin-M.
- The mark is often the last trade, and 44 to 48 crypto baskets include Bitget's own perpetual, at weights up to 0.87.
  A later design should decide whether such legs need a refusal like the self-index case, since this poller cannot tell a smoothed mark from a last print.
- The UTA twins are drop-in if the classic API is retired.
  The index and mark fields have the same names, and the rows use the same ids on USDT-M.

## 9. Source ledger

| title | URL | retrieved | entity or region | sections supported |
| --- | --- | --- | --- | --- |
| Introduction, Bitget API docs | https://www.bitget.com/docs/classic/Introduction | 2026-09-15 | Bitget, global API | 2 |
| Classic Contract Market API, all market endpoints | https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market | 2026-09-15 | Bitget, global API | 2, 3, 5, 6 |
| UTA Market Data, Get Instruments, Get Tickers, Get Order Book | https://www.bitget.com/docs/catalog/market/market-data | 2026-09-15 | Bitget, global API | 2, 3, 5, 6 |
| UTA Derivatives and Funding Rate, Get Current Funding Rate, Get Index Price Components | https://www.bitget.com/docs/catalog/market/derivatives | 2026-09-15 | Bitget, global API | 3, 4, 6 |
| UTA Quick Start, domains and rate limit | https://www.bitget.com/docs/uta/quick-start | 2026-09-15 | Bitget, global API | 6 |
| UTA error codes | https://www.bitget.com/docs/uta/error-code/common-error-handling | 2026-09-15 | Bitget, global API | 6 |
| What is Index Price in Future Trading? | https://www.bitget.com/support/articles/12560603824105 | 2026-09-15 | Bitget, global | 4 |
| What is Mark Price in Future Trading? | https://www.bitget.com/support/articles/12560603824106 | 2026-09-15 | Bitget, global | 4 |
| What Is the Funding Rate in Bitget Futures Trading? | https://www.bitget.com/support/articles/12560603817108 | 2026-09-15 | Bitget, global | 4 |
| CCXT bitget class 4.5.68 | `server/node_modules/ccxt/js/src/bitget.js` | 2026-09-15 | installed package | 2 |
| okx public ticker, `OPENAI-USDT-SWAP` and `ANTHROPIC-USDT-SWAP` | https://www.okx.com/api/v5/market/ticker?instId=OPENAI-USDT-SWAP | 2026-09-15 | okx, global API | 2 |
| REST probe script | [`../../../scripts/probes/bitget-rest-probe.mjs`](../../../scripts/probes/bitget-rest-probe.mjs) | 2026-09-15 | this host | 1 to 7 |
| Settlement probe script | [`../../../scripts/probes/bitget-settlement-probe.mjs`](../../../scripts/probes/bitget-settlement-probe.mjs) | 2026-09-15 | this host | 4 |
