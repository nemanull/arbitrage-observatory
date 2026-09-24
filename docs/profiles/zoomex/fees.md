# Zoomex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:11 to 03:54 UTC, from the development host near Seattle.

This profile covers the perpetual fees of Zoomex, which CCXT 4.5.68 does not list, for every perpetual family the venue offers.
Every number carries a source from the ledger in section 10, a probe reference, or a CCXT file and line.
The Help Center pages at `zoomex.zendesk.com/hc/` answer this host with HTTP 403, so every article was read through the public Help Center API at `https://zoomex.zendesk.com/api/v2/help_center/en-us/articles/<id>.json`, which answered 200.

The finding that shapes every other number sits in [`websocket.md`](./websocket.md) section 4 and [`rest.md`](./rest.md) section 2.
On 693 of the 697 USDT perpetuals, Zoomex's public book stream is Bybit's book stream, with the same update ids, sequence numbers, timestamps and levels, and its recent trades are Bybit's trades with the same execution ids.
The fees below are what Zoomex charges its own users on that shared book.
Whether a Zoomex fill really executes against Bybit's book was not tested, because that takes an order.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | 2026-09-22 local, 2026-09-23 UTC | this profile |
| operating entity | "zoomex Technology Limited", named as the provider in the trading account terms. The place of incorporation is not stated in the documents read | S5 |
| country on CoinGecko | Seychelles, established 2021 | S16 |
| excluded regions | "mainland China, North Korea, Cuba, Iran, Crimea, Sevastopol, Sudan, Syria, Luhansk, United States, Singapore, Hong Kong, the European Union, Quebec (Canada), the Republic of Seychelles", and any other region Zoomex names | S4, updated 2026-06-17 |
| US persons | may not trade, the United States is an excluded jurisdiction | S4 |
| identity checks | the VIP page advertises "No KYC required for trading" | S1 |
| API keys | issued after an application, and the documentation says an upgraded unified account needs a new key | S17, S18 |
| public market data from this host | REST and WebSocket both answered without a refusal, no geoblock was seen | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

## 2. Quick answer

| family | maker | taker | maker ppm | taker ppm | source |
|---|---|---|---:|---:|---|
| USDT-M perpetuals, standard | 0.02 % | 0.06 % | 200 | 600 | S1, S2 |
| USDT-M perpetuals, Innovation Zone (73 contracts) | 0.04 % | 0.11 % | 400 | 1,100 | S2, S3, P1 `catalog` |
| inverse perpetuals (coin-M, 4 contracts) | 0.02 % | 0.06 % | 200 | 600 | S2 |

VIP 0 is the "Original" rate of S1, and the retail schedule of S2 prints the same two numbers.
The Innovation Zone rate applies only to contracts tagged `Innovation Zone` in the instruments reply, 73 on 2026-09-23 by P1 `catalog`.
The FAQ of S3 lists 79 names, of which 73 carry the tag and 6 are no longer in the catalog.

## 3. Coverage matrix

| product | present | count on 2026-09-23 | evidence |
|---|---|---:|---|
| USDT-M perpetuals | yes | 697, all `Trading`, `contractType` `LinearPerpetual`, settle `USDT` | P1 `catalog` |
| of which TradFi (tag `Stock` or `Commodity`) | yes | 234 `Stock` and 4 `Commodity` (`XAUUSDT`, `XAGUSDT`, `CLUSDT`, `BZUSDT`) | P1 `catalog`, S13 |
| USDC-M perpetuals | no | 0, no row settles in USDC | P1 `catalog` |
| inverse (coin-M) perpetuals | yes | 4: `BTCUSD`, `ETHUSD`, `SOLUSD`, `XRPUSD`, quote `USD`, settled in the base coin | P1 `catalog` |
| dated futures | no | 0 rows with another `contractType`, and CoinGecko shows 0 futures pairs | P1 `catalog`, S16 |
| options | no | `category=option` answers HTTP 400 `We don't support the category, plz check.` | P1 `errors` |
| spot | yes | 95 USDT pairs, maker and taker 0.1 % | P1 `catalog`, S11 |
| 1000x Futures | yes, a separate product | fee is "Input amount × Leverage × 0.04%", not on the API catalog, not probed | S12 |

CoinGecko's derivatives entry `zoomex-futures` showed 702 perpetual pairs, 8,495 BTC of open interest and 89,715 BTC of 24 h volume on 2026-09-23, S16.
The catalog holds 701, so the difference is one pair.

## 4. Perpetual tiers

The only published tier table is the VIP page, S1.
It applies one discount to the standard rate, so the Innovation Zone has no tier table.

| level | 30 day volume, USD | maker | maker discount | taker | taker discount | taker ppm |
|---|---|---|---|---|---|---:|
| VIP 0 | below 5M | 0.020 % | none | 0.060 % | none | 600 |
| VIP 1 | ≥ 5M | 0.020 % | 0 % | 0.036 % | 40 % | 360 |
| VIP 2 | ≥ 10M | 0.020 % | 0 % | 0.033 % | 45 % | 330 |
| VIP 3 | ≥ 30M | 0.010 % | 50 % | 0.030 % | 50 % | 300 |
| VIP 4 | ≥ 50M | 0.006 % | 70 % | 0.027 % | 55 % | 270 |
| VIP 5 | ≥ 100M | 0.002 % | 90 % | 0.024 % | 60 % | 240 |

### Qualification

- Volume is the trailing 30 days, updated at 00:00 UTC the next day, S1.
- A level reached takes effect "every first day of next month", S1.
- The discount "will be distributed to your Rewards Hub - My Rewards every first Friday of the following month", S1 terms item 6.
  So the VIP discount reads as a monthly rebate paid after the fact, not a lower rate at the fill.
  That reading is an inference from the wording.
- A trader with a VIP level on another exchange may apply for that level plus one, for up to three months, S1.
- A downgraded level is kept for 14 days, S1 terms item 1.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| VIP levels | section 4, paid as a monthly rebate | S1 |
| "Team Up, Fees Down" fee rebate | friends can refund part or all of the fee on the first three trades of each UTC day, retail users only, not affiliates | S8 |
| Innovation Zone exclusion | "No trading-related rewards apply in the Innovation Zone. This includes bonuses, fee savers, discount vouchers, or affiliate-related discounts." | S3 |
| token holding | none found | S1, S2 |
| market maker program | none found in the documents read | |
| zero fee promotion | none found | |

The engine models a taker at the base retail tier, so none of these change the recommended number.

## 6. Funding as a cost

- Formula: `F = P + clamp(I − P, 0.05%, −0.05%)`, with the interest rate `I` at 0.01 % per 8 h, and the premium index `P` sampled every minute and averaged over the interval, S6.
- Interval: per contract, and on 2026-09-23 368 perpetuals settled every 8 h, 326 every 4 h and 3 every hour, by `fundingIntervalHour` in the tickers reply, P1 `anchor`.
  The TradFi terms also name a 2 h interval, S13, and none was seen.
- Settlement times for 8 h contracts: 00:00, 08:00 and 16:00 UTC, S6 and S7.
  Funding history spacing was exactly 28,800,000 ms on `BTCUSDT`, 14,400,000 ms on `XAUUSDT` and 3,600,000 ms on `LSKUSDT`, P1 `funding`.
- Cap and floor: per contract, the tickers field `fundingCap`, 19 distinct values from 0.0025 to 0.05 on 697 perpetuals in the bulk reply, P1 `anchor`.
  The four perpetuals Zoomex books itself carry their own cap in the single symbol reply: 0.0027 on `BTCUSDT` and `ETHUSDT`, 0.01 on `SOLUSDT` and `GMTUSDT`, against Bybit's 0.00333 and 0.005 in the bulk row, P1 `own`.
- Who pays: longs pay shorts when the rate is positive, on the position value at the mark price, only for a position held at the timestamp, S7.
  A position opened or closed within 5 s of the timestamp is not guaranteed to be in or out, S7.
- The published rate is the rate for the upcoming settlement, updated every minute until the interval ends, S6.
- Whose rate: on the relayed `CHRUSDT` the last 4 settled rates equalled Bybit's, 4 of 4.
  On the own `BTCUSDT` and `ETHUSDT` 0 of the last 4 settled rates equalled Bybit's, for example 0.00000501 against Bybit's 0.00003927 on `BTCUSDT` at 2026-09-23 00:00 UTC, and on `GMTUSDT` 3 of 4 did, all three at the 0.0001 baseline, P1 `funding`.
- The settlement instant itself was not captured, by design of this survey.

## 7. Liquidation, settlement and delisting

- Liquidation uses the mark price, partial liquidation by risk tier first, then takeover by the liquidation engine at the bankruptcy price, S10.
  No separate liquidation fee number is published in S10.
- Delisting: open positions are closed by the system at the average index price of the last 30 minutes before delisting, and "A trading fee will be applied", S9.
- A contract whose last price falls below 20 times its tick size may be delisted without notice, S9.
- There are no dated futures, so there is no delivery fee.

## 8. CCXT

- CCXT 4.5.68 has no Zoomex class.
  `require('ccxt').exchanges` run from `server/` lists 104 ids, and none contains `zoom`.
- The CCXT master tree `ts/src` on GitHub at commit `1d8b674`, dated 2026-09-22 12:48 UTC, has 105 files and none contains `zoom`, S15.
  Issue #26609 "zoomex support" has been open since 2025-08-08, S15.
- Zoomex's API copies Bybit's v5 market API under another path prefix, so the CCXT `bybit` class loads the Zoomex catalog once its host and path prefix are replaced, P1 `ccxt` and [`rest.md`](./rest.md) section 2.
  Loaded that way, `market.taker` is 0.0006 and `market.maker` is 0.0001 on all 701 swaps, because the instruments reply carries no fee and CCXT falls back to constants at `server/node_modules/ccxt/js/src/bybit.js` lines 2219 and 2220.
- The taker constant equals Zoomex's standard taker by coincidence, since it is Bybit's old non-VIP rate, as the Bybit entry of [`registry.ts`](../../../server/src/venues/registry.ts) notes at lines 47 and 48.
  It is wrong for the 73 Innovation Zone contracts, which charge 0.0011.
  The maker constant 0.0001 is wrong for every contract, since Zoomex charges 0.0002.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 standard taker, S1 and S2 |
| `ccxtTakerPpm` | 600 | the `bybit` class fallback at `bybit.js` line 2219, if the catalog is loaded through a `bybit` subclass |
| Innovation Zone | leave the 73 tagged contracts out with a `marketFilter`, or accept that the registry understates them by 500 ppm | one `takerPpm` per venue, S3 |

The larger question is whether Zoomex should be a venue at all, see [`rest.md`](./rest.md) section 8.
A Zoomex route on a relayed perpetual is a Bybit route that pays 600 ppm instead of Bybit's 550.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Zoomex VIP Club | https://www.zoomex.com/en/promotion/zoomex-vip-program | 2026-09-23 | Zoomex, global | VIP 0 and tier rates, qualification, rebate timing, sections 2, 4, 5 |
| S2 | Taker's Fee and Maker's Fee Calculation, updated 2025-11-18 | https://zoomex.zendesk.com/hc/en-us/articles/34850942819225-Taker-s-Fee-and-Maker-s-Fee-Calculation | 2026-09-23 | Zoomex | standard, inverse and Innovation Zone rates, section 2 |
| S3 | FAQ Perpetual Trading Innovation Zone, updated 2026-05-13 | https://zoomex.zendesk.com/hc/en-us/articles/50441227260569-FAQ-Perpetual-Trading-Innovation-Zone | 2026-09-23 | Zoomex | Innovation Zone rates, list and reward exclusion, sections 2 and 5 |
| S4 | Service Restricted Countries, updated 2026-06-17 | https://zoomex.zendesk.com/hc/en-us/articles/35639141483545-Service-Restricted-Countries | 2026-09-23 | Zoomex | excluded jurisdictions, section 1 |
| S5 | Terms and Conditions for Trading Account, updated 2026-04-30 | https://zoomex.zendesk.com/hc/en-us/articles/51045031223577-Terms-and-Conditions-for-Trading-Account | 2026-09-23 | zoomex Technology Limited | entity name, section 1 |
| S6 | What is funding rate?, updated 2025-12-05 | https://zoomex.zendesk.com/hc/en-us/articles/34755393448729-What-is-funding-rate | 2026-09-23 | Zoomex | funding formula, clamp, schedule, section 6 |
| S7 | Funding fee calculation, updated 2025-11-18 | https://zoomex.zendesk.com/hc/en-us/articles/34754678102937-Funding-fee-calculation | 2026-09-23 | Zoomex | who pays, 5 s window, section 6 |
| S8 | Trading Fee Rebate function, updated 2025-12-05 | https://zoomex.zendesk.com/hc/en-us/articles/45853908544665-Trading-Fee-Rebate-function | 2026-09-23 | Zoomex | fee rebate event, section 5 |
| S9 | Delisting Mechanism, updated 2026-05-11 | https://zoomex.zendesk.com/hc/en-us/articles/34803211986457-Delisting-Mechanism | 2026-09-23 | Zoomex | delisting settlement, section 7 |
| S10 | Liquidation Process (USDT Contract), updated 2026-06-10 | https://zoomex.zendesk.com/hc/en-us/articles/37573794495001-Liquidation-Process-USDT-Contract | 2026-09-23 | Zoomex | liquidation, section 7 |
| S11 | Zoomex Spot Trading Fees, updated 2026-04-29 | https://zoomex.zendesk.com/hc/en-us/articles/34797370530713-Zoomex-Spot-Trading-Fees | 2026-09-23 | Zoomex | spot 0.1 %, section 3 |
| S12 | FAQ 1000x Futures, updated 2026-04-30 | https://zoomex.zendesk.com/hc/en-us/articles/41845512770457-FAQ-1000x-Futures | 2026-09-23 | Zoomex | 1000x Futures fee, section 3 |
| S13 | Trading Account (Traditional Finance) Terms and Conditions, updated 2026-06-05 | https://zoomex.zendesk.com/hc/en-us/articles/58633669722905-Trading-Account-Traditional-Finance-Terms-and-Conditions | 2026-09-23 | Zoomex | TradFi perpetuals, 1, 2, 4 and 8 h intervals, sections 3 and 6 |
| S14 | CCXT 4.5.68 `bybit.js` | `server/node_modules/ccxt/js/src/bybit.js` | 2026-09-23 | CCXT | fee fallbacks at lines 2219 and 2220, section 8 |
| S15 | CCXT `ts/src` tree and issue #26609 | https://github.com/ccxt/ccxt/tree/master/ts/src and https://github.com/ccxt/ccxt/issues/26609 | 2026-09-23 | CCXT | no Zoomex class on master, section 8 |
| S16 | CoinGecko derivatives exchange `zoomex-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/zoomex-futures | 2026-09-23 | CoinGecko | 702 perpetual pairs, country, volume, sections 1 and 3 |
| S17 | Zoomex API Introduction, updated 2026-05-07 | https://zoomex.zendesk.com/hc/en-us/articles/50221739193753-Zoomex-API-Introduction | 2026-09-23 | Zoomex | API application step, section 1 |
| S18 | Zoomex API documentation, Change Log | https://zoomexglobal.github.io/docs/v3/changelog | 2026-09-23 | Zoomex | new key after the unified account upgrade, section 1 |
| P1 | `rest-probe.mjs` modes `catalog`, `anchor`, `funding`, `errors`, `ccxt`, `mirror`, `own`, 03:15 to 03:31 UTC, and the second pass at 03:39 to 03:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zoomex/rest-probe.mjs) | 2026-09-23 | this host | sections 2, 3, 6, 8 |
