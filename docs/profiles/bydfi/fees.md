# BYDFi Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:12 to 20:51 Pacific time (2026-09-23 03:12 to 03:51 UTC), from the development host near Seattle.

This profile covers the perpetual futures of BYDFi (CCXT id `bydfi`) as they stood on the evening of 2026-09-22.
BYDFi moved to a new trading system that same day, and the move changes every answer below, so it comes first.
The upgrade started at 13:00 UTC+8 on 2026-09-22, with all trading suspended, S1.
The completion notice says the app, trading system, account structure and asset records were replaced, S2.
After it, the documented public API no longer answers, the developer documentation host no longer resolves, and the CCXT 4.5.68 class fails, see [`rest.md`](./rest.md) section 1.
The new platform serves a contract API with the same paths and reply shapes as MEXC's, on the old API host `api.bydfi.com`, and nothing on BYDFi's site documents it.
Fees below come from the help center, the VIP page and that contract API, and they agree.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22, during and after the upgrade | S1, S2, P1 |
| legal entity | the User Agreement is "concluded between you and BYDFi Trading Platform" and names no company or registration | S6 |
| disputes | arbitration under the HKIAC Administered Arbitration Rules, administered by the Hong Kong International Arbitration Centre | S6 |
| country listed by CoinGecko | Singapore, which BYDFi's own agreement lists as prohibited | S9, S6 |
| who may trade | residents of any country outside the Prohibited Jurisdictions | S6 |
| excluded regions | North Korea, Cuba, Sudan, Iran, Mainland China, Singapore, the United States, the United Kingdom, Hong Kong, Kazakhstan, the Russian-controlled regions of Ukraine, Canada, and any country under comprehensive EU or OFAC sanctions or on the FATF call for action list | S6, dated 2026-09-18 15:06:08 |
| US persons | may not trade | S6 |

The Prohibited Jurisdictions list is "non-exclusive and is subject to change at any time", S6.
This host near Seattle reached the site, the help center and the new API with HTTP 200, and no response carried a geoblock or a region notice, see [`rest.md`](./rest.md) section 1.
The documented API paths returned 404 and the documentation host had no DNS record, which are retirements and not refusals.
Reaching the data is not permission to trade from the United States.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | maker ppm | taker ppm |
|---|---|---|---:|---:|
| USDT-M perpetuals | 0.02 % | 0.06 % | 200 | 600 |
| USDC-M perpetuals | 0.02 % | 0.06 % | 200 | 600 |
| coin-M perpetuals | 0.02 % | 0.06 % | 200 | 600 |

The help center gives one row, "USDT-M & COIN-M", at 0.02 % maker and 0.06 % taker, S3.
The VIP page carries `swapMakerFeeRate` 0.0002 and `swapTakerFeeRate` 0.0006 for level 0, S5.
The contract catalog carries `takerFeeRate` 0.0006 and `makerFeeRate` 0.0002 on all 266 contracts, including the 3 USDC and 8 coin-M ones, P1 `catalog`.
The three sources agree.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | source |
|---|---|---:|---|
| USDT-M perpetuals | yes | 255 | P1 `catalog`, all `state` 0 |
| USDC-M perpetuals | yes | 3: `BTC_USDC`, `ETH_USDC`, `SOL_USDC` | P1 `catalog` |
| coin-M perpetuals | yes | 8: `BTC_USD`, `ETH_USD`, `XRP_USD`, `SOL_USD`, `ADA_USD`, `DOGE_USD`, `LTC_USD`, `LINK_USD`, settled in the base coin | P1 `catalog` |
| dated futures | no | 0, `futureType` is 1 on all 266 contracts, and CoinGecko lists 0 futures pairs | P1, S9 |
| options | no | no options contract in the catalog and no options category in the help center | P1, S3 |
| spot | yes | 153 markets through the spot half of the same API | P1 `catalog`, S3 |

CoinGecko's derivatives list shows 271 perpetuals for "BYDFi (Futures)", 250 USDT, 11 USDC and 10 USD, S9.
The live catalog lists 266, 255 USDT, 3 USDC and 8 USD, P1.
The CoinGecko count may predate the upgrade, since its tickers include `SUI` and `XLM` coin-M contracts that the new catalog does not list.

The catalog includes 11 contracts whose index is built only from other venues' futures, among them `XAU_USDT`, `CL_USDT`, `NVDA_USDT` and `NFLX_USDT`, see [`rest.md`](./rest.md) section 4.

## 4. Perpetual tiers

The VIP page lists eight levels, S5.
The level is the highest one met by any of the three columns, and it is reassessed daily at 02:00 UTC, S5.

| level | 30 day spot volume, USDT | 30 day futures volume, USDT | asset holdings, USDT | perp maker | perp taker | maker ppm | taker ppm |
|---|---:|---:|---:|---:|---:|---:|---:|
| VIP0 | 0 | 0 | 0 | 0.020 % | 0.060 % | 200 | 600 |
| VIP1 | 100,000 | 10,000,000 | 50,000 | 0.018 % | 0.060 % | 180 | 600 |
| VIP2 | 500,000 | 20,000,000 | 100,000 | 0.016 % | 0.050 % | 160 | 500 |
| VIP3 | 1,000,000 | 30,000,000 | 250,000 | 0.014 % | 0.040 % | 140 | 400 |
| VIP4 | 2,000,000 | 50,000,000 | 750,000 | 0.012 % | 0.040 % | 120 | 400 |
| VIP5 | 5,000,000 | 100,000,000 | 2,000,000 | 0.010 % | 0.035 % | 100 | 350 |
| VIP6 | 10,000,000 | 200,000,000 | 5,000,000 | 0.008 % | 0.032 % | 80 | 320 |
| VIP7 | 100,000,000 | 5,000,000,000 | 50,000,000 | 0.007 % | 0.030 % | 70 | 300 |

The volumes and holdings are the page's visible table, and the rates are the `swapMakerFeeRate` and `swapTakerFeeRate` of each level in the JSON the page embeds, S5.
The page says "Log In to View Fee Rates and Withdrawal Limits", so the rates are not shown to a visitor, and the embedded values are the evidence.
Spot is 0.1 % maker and 0.1 % taker at every level in the same JSON, S5, and in the help center, S3.

## 5. Discounts that change the perpetual taker

| discount | finding | source |
|---|---|---|
| VIP level | the table in section 4 | S5 |
| other reductions | "Users may receive reduced fees based on VIP levels, trading volume, promotional offers, or specific trading pairs." with no schedule | S3 |
| zero fee promotions | none on 2026-09-22: `isZeroFeeRate` and `isZeroFeeSymbol` false, `feeRateMode` `NORMAL`, `feeRateType` `BASE`, and `tieredFeeRates` and `leverageFeeRates` empty on all 266 contracts | P1 `catalog` |
| token holding | no BYDFi token discount was found | S3, S5 |
| market maker program | Not publicly specified | none found |
| referral | an invite program exists on the site menu, and its effect on the taker rate is Not publicly specified | site menu |

## 6. Funding as a cost

The formula, from the help center, S4:

```text
Funding Rate = Clamp[Average Premium Index + Clamp(Comprehensive Interest Rate - Average Premium Index, Maximum Premium Deviates, Minimum Premium Deviates), Maximum Funding Rate, Minimum Funding Rate]
Comprehensive Interest Rate = (Interest Rate of Pricing Currency - Interest Rate of Underlying Currency) / Funding Rate Settlement Frequency
```

| item | value | source |
|---|---|---|
| interest rate | 0.06 % for the pricing currency and 0.03 % for the underlying, over 3 settlements a day, so 0.01 % per 8 h | S4 |
| premium deviation bounds | named in the formula, values Not publicly specified | S4 |
| rate cap and floor | `maxFundingRate` 0.02 and `minFundingRate` -0.02 on all 266 contracts, so ±2 % per interval | P1 `anchor` |
| interval | 8 h on 105 contracts and 4 h on 161, from `collectCycle` | P1 `anchor` |
| settlement instants | 00:00, 08:00 and 16:00 UTC for 8 h contracts, stated as 08:00, 16:00 and 00:00 UTC+8, S4, and seen in the history of `BTC_USDT`, `ETH_USDT`, `BTC_USDC` and `BTC_USD` | S4, P1 `history` |
| 4 h instants | every 4 h from 00:00 UTC, seen in the history of `HYPE_USDT` | P1 `history` |
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative | S4 |
| who is charged | only positions held at the settlement instant, "If the trader closes the position before the specified funding timestamp, no funding fees are paid/received." | S4 |
| amount | position value times the rate, with USDT-M position value at the mark price | S4 |
| where it is taken | isolated margin from the position margin, cross margin from the available balance and then the position | S4 |

The 08:00 UTC settlement of 2026-09-22 is missing from the funding history of all five contracts read, which fits the upgrade window, P1 `history`.
The funding rate published before a settlement is the upcoming one, not the last settled one, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured, and the behaviour above comes from the history endpoint and the help center.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | `liquidationFeeRate` 0.0006 on all 266 contracts, whose use the help center does not describe | P1 `catalog` |
| settlement | perpetuals have no expiry | S3 |
| delisting | the announcements have a delisting category and an ST warning notice for 2026-09, and no delisting fee schedule was found | announcement index |
| upgrade | copy trading and grid positions were closed at the upgrade, and existing futures positions and orders were kept | S1 |

## 8. CCXT

| class | what `market.taker` reports | source line |
|---|---|---|
| `bydfi` | nothing on 2026-09-22, because `loadMarkets` throws `ExchangeError: bydfi {"code":404,"msg":"Not Found"}` | P1 `legacy` |
| `bydfi`, when the old API answered | `feeRateTaker` of each market, example `"0.0006"` | `server/node_modules/ccxt/js/src/bydfi.js` line 500 reads it and line 523 sets `taker`, the example is the comment at line 424 |
| `mexc`, with `https://api.mexc.com` replaced by `https://api.bydfi.com` in every URL | 0.0006 on all 266 swap markets | `server/node_modules/ccxt/js/src/mexc.js` line 1465, P1 `catalog` |

The `bydfi` class has an empty `fees` block at `bydfi.js` line 199, so there is no exchange wide constant to fall back on.
CCXT master on GitHub, read on 2026-09-22, still points `bydfi` at `https://api.bydfi.com/api` with the same `v1/fapi/market/...` public paths and `wss://stream.bydfi.com/v1/public/fapi`, so no newer CCXT release fixes it yet.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 perpetual taker on all three families, S3, S5 and P1 agree |
| `ccxtTakerPpm` | 600, only with the `mexc` class on the swapped host | `mexc.js` line 1465 reads the catalog's `takerFeeRate`, which is 0.0006 on every contract |

A registry entry built on `new ccxt.bydfi()` loads no markets today, so it has no CCXT taker to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BYDFi System Upgrade Has Started, Services Are Suspended | https://www.bydfi.com/announcements/article/bydfi-system-upgrade-has-started-services-are-suspended-17827791534705 | 2026-09-22 | BYDFi, global | upgrade start and scope, sections 1 and 7 |
| S2 | BYDFi System Upgrade Completion Announcement | https://www.bydfi.com/announcements/article/bydfi-system-upgrade-completion-announcement-17827791534704 | 2026-09-22 | BYDFi, global | new trading system, sections 1 and 7 |
| S3 | Help Center, Fees FAQs, article "Transaction Fee Calculation", dated 2026-08-27 | https://www.bydfi.com/support/fees/fees-faqs | 2026-09-22 | BYDFi, global | maker and taker, discounts, sections 2, 3 and 5 |
| S4 | Help Center, Fees FAQs, article "How Are Funding Rates and Funding Fees Calculated?", dated 2026-08-18 | https://www.bydfi.com/support/fees/fees-faqs | 2026-09-22 | BYDFi, global | funding, section 6 |
| S5 | BYDFi VIP page, visible table and embedded level JSON | https://www.bydfi.com/vip | 2026-09-22 | BYDFi, global | tiers, section 4 |
| S6 | Terms of Service, "User Agreement", dated 2026-09-18 15:06:08 | https://www.bydfi.com/support/terms-of-service/terms-of-service | 2026-09-22 | BYDFi, global | entity, arbitration, prohibited jurisdictions, section 1 |
| S7 | Help Center, Trading Mechanism, article "Index Price", dated 2026-08-18 | https://www.bydfi.com/support/futures-trading/trading-mechanism | 2026-09-22 | BYDFi, global | index sources, see [`rest.md`](./rest.md) |
| S8 | CCXT 4.5.68 `bydfi.js` and `mexc.js` | `server/node_modules/ccxt/js/src/bydfi.js`, `server/node_modules/ccxt/js/src/mexc.js` | 2026-09-22 | CCXT | section 8 |
| S9 | CoinGecko API, `/derivatives/exchanges` and `/derivatives/exchanges/bydfi-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/bydfi-futures | 2026-09-22 | CoinGecko | country, perpetual counts, section 3 |
| S10 | CCXT master `ts/src/bydfi.ts` and `ts/src/pro/bydfi.ts` | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/bydfi.ts | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs` modes `legacy`, `catalog`, `anchor` and `history` | [`rest-probe.mjs`](../../../scripts/probes/venues/bydfi/rest-probe.mjs) | 2026-09-22 | this host | sections 2, 3, 5 to 8 |
