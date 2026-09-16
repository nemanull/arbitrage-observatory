# MEXC Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

This profile covers perpetual futures on MEXC, the CCXT id `mexc`, for a perp to perp taker cross.
Every probed number comes from [`../../../scripts/probes/mexc-rest-probe.mjs`](../../../scripts/probes/mexc-rest-probe.mjs).
Evidence labels follow [`../../implemented/2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md), with `Probed` meaning that script observed it from this host on 2026-09-15.

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| Retrieval date | 2026-09-15 for every page in the ledger | | section 10 |
| Contracting legal entity | The User Agreement names "MEXC", "the Platform" and "MEXC Trading Platform" and names no company or jurisdiction of incorporation | Not publicly specified | S1 |
| Governing law | The laws of England and Wales, with disputes referred to arbitration at the Hong Kong International Arbitration Centre | Published | S1 |
| User Agreement version | Last updated 29 May 2025 | Published | S1 |
| Prohibited jurisdictions | North Korea, Cuba, Sudan, Iran, Mainland China, Singapore, Malaysia, the United States, the United Kingdom, Hong Kong, Kazakhstan, the Russian-controlled regions of Ukraine, Canada, and any comprehensively sanctioned country or territory | Published | S1, clause 1 |
| Misrepresented location | MEXC may terminate the account and liquidate open positions | Published | S1, clause 1 |
| Who may place futures orders through the API | Any user who completed KYC may apply for an API key with futures trading permission, since 2026-03-31 06:00 UTC, and "API product availability may vary by region" | Published | S2, S3 |
| API futures before 2026-03-31 | The older docs closed the order placement and cancellation endpoints "temporarily" on 2022-07-25 and record no reopening, and S3 opened API futures trading on 2026-03-31 | Published | S3, S4 |
| Innovation Zone pairs | Web and app only, not tradable through the API | Published | S5 |
| Innovation Zone restricted regions | Armenia, Azerbaijan, Bangladesh, Belarus, Georgia, India, Indonesia, Israel, Japan, Kazakhstan, Kyrgyzstan, Malaysia, Moldova, Nigeria, Palau, Russia, South Korea, Sri Lanka, Taiwan, Tajikistan, Ukraine, Uzbekistan and Yemen | Published | S5 |
| Regional fee schedules | Several regions pay a different standard rate, see section 5 | Region-specific | S9 to S12 |

The development host is in the United States, which the User Agreement lists as prohibited.
The public market data endpoints still answered from this host, see [`./rest.md`](./rest.md) section 1.
Public data access is not the same as permission to trade, and nothing in this profile implies that an account from this host may trade.

## 2. Quick answer

MEXC runs two fee schedules for the same perpetual, and the channel that places the order decides which applies.

| channel | maker | taker | scope | label | source |
|---|---|---|---|---|---|
| API orders, since 2026-06-01 08:00 UTC | 0.06 % = 600 ppm | 0.08 % = 800 ppm | All futures pairs except Innovation Zone pairs, every settlement family, open-ended | Published | S6 |
| Web and app, the largest paid group | 0 % = 0 ppm | 0.02 % = 200 ppm | Per contract, as the public contract list reports it, 494 contracts at 19:01 UTC | Dynamic, Probed | P1 |
| Web and app, ETH, SOL, USOIL and UKOIL perpetuals | 0 % = 0 ppm | 0.01 % = 100 ppm | Per contract, 12 contracts at 19:01 UTC, and the BTC contracts were in this group at 06:59 UTC and at 0.02 % by 19:01 UTC | Dynamic, Probed | P1 |
| Web and app, zero fee contracts | 0 % = 0 ppm | 0 % = 0 ppm | Per contract, flagged `isZeroFeeRate` | Probed | P1 |
| Web and app, a group of 64 contracts | 0.01 % = 100 ppm | 0.04 % = 400 ppm | Per contract | Probed | P1 |
| Innovation Zone, web and app only | 0.04 % = 400 ppm | 0.10 % = 1,000 ppm | Innovation Zone pairs | Published | S5 |

The API schedule overrides every web and app rate, zero fee event and MX discount.
The announcement says so in these words: "API trading is subject to a separate fee structure, which takes precedence over any rates or promotional offers".
The engine's trades would be placed through the API, so 800 ppm is the taker that applies to them.

The API rate is the same for USDT, USDC, USD1 and coin margined perpetuals, because the announcement scopes it to all futures pairs and names no family.
MEXC publishes no VIP tier table for API orders in any page read, see section 4.

## 3. Coverage matrix

Counts are CCXT 4.5.68 active swaps at 07:09 UTC, filtered exactly like [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194.

| product | present | detail | label | source |
|---|---|---|---|---|
| USDT margined perpetuals | yes | 1,061 contracts, quote and settle USDT | Probed | P2 |
| USDC margined perpetuals | yes | 78 contracts, quote and settle USDC | Probed | P2 |
| USD1 margined perpetuals | yes | 35 contracts, quote and settle USD1 | Probed | P2 |
| Coin margined perpetuals | yes | 10 contracts, quote USD, settled in BTC, ETH, SOL, XRP, SUI, DOGE, ADA, LTC, AVAX or LINK | Probed | P2 |
| Stock, index and commodity perpetuals | yes | 425 contracts carry `type` 2 in the contract list at 06:59 UTC, most with a `STOCK` suffix | Probed | P1 |
| Dated futures | not listed | `futureType` is 1, perpetual, on every contract, and the API documents 2 as delivery | Probed | P1, S7 |
| Options | not found | The futures API documents no option instrument | Not publicly specified | S7 |
| Spot | yes | CCXT loads spot markets beside the swaps, 3,166 markets in total | Probed | P2 |

The 425 stock, index and commodity contracts sit inside the USDT, USDC and USD1 counts above.
The API docs describe `type` 2 as "suspended" and `typeLabel` 2 as "stock", and these contracts traded with live books during the probe, see the conflicts section of [`./rest.md`](./rest.md).

## 4. Perpetual tiers

No VIP tier table for futures could be read.

| attempt | result |
|---|---|
| [MEXC fee page](https://www.mexc.com/fee) through WebFetch | The page body explains maker and taker and MX deduction, and renders no tier table |
| [VIP Program page](https://www.mexc.com/VIPProgram) through WebFetch | No fee table rendered |
| `curl` of `www.mexc.com` from this host | HTTP 403 "Access Denied" from Akamai, on every page |
| Support and announcement search on mexc.com | Announcements for API rates, regional rates and promotions, and no tier table |

The tier table is therefore `Not publicly specified` for this research.
For API orders it would not change the answer, because the API schedule in section 2 names one rate for all users and takes precedence over other rates.
The only volume rule found is the Futures VIP Experience Card, in section 5.

## 5. Discounts and promotions that change the perpetual taker

| item | effect on taker | applies to API orders | end date | label | source |
|---|---|---|---|---|---|
| API futures fee, 2026-03-31 06:00 UTC | maker 0.01 %, taker 0.05 % | yes | superseded 2026-05-01 | Published | S3 |
| API futures fee, 2026-05-01 08:00 UTC | maker 0.04 %, taker 0.06 % | yes | superseded 2026-06-01 | Published | S13 |
| API futures fee, 2026-06-01 08:00 UTC | maker 0.06 %, taker 0.08 % | yes | open-ended | Published | S6 |
| 0-Fee Fest | 0 % maker and taker on selected futures pairs | no, "API users are not eligible for 0 fees" | per pair, announced one by one, several concluded on 2026-09-14 10:00 UTC | Published | S8, S14 |
| MX deduction and MX holding discounts | 20 % with MX deduction, 50 % holding at least 500 MX, in the regional announcements | no, the API schedule overrides MX discounts | open-ended in the announcements read | Published | S9, S10, S13 |
| Futures VIP Experience Card | taker "as low as 0.01%" for 30 days, kept after 1 billion USD of volume, and 0.005 % after 5 billion USD | Not publicly specified | 30 days from approval, and market makers and institutional users are excluded | Published | S15 |
| Institutional account | "higher rate limits and dedicated resource support" on application | Negotiated | Not publicly specified | Negotiated | S3, S6 |
| Temporary per contract rate | 11 contracts carried `feeRateType` "TEMP" at 06:59 UTC, 9 at 0 % and 2 at 0.01 % maker and 0.04 % taker | no, web and app rates | not in the reply | Probed | P1 |

Regional standard rates for web and app orders.

| region | maker | taker | pairs | effective | label | source |
|---|---|---|---|---|---|---|
| Australia, Canada, New Zealand, United Kingdom | 0 % | 0.02 % | all futures except BTCUSDT, BTCUSD, BTCUSDC and the zero fee pairs | 2025-03-24 08:00 UTC | Region-specific | S9 |
| Palau, Czech Republic | 0.01 % | 0.04 % | not named | 2025-08-08 16:00 UTC | Region-specific | S10 |
| Kosovo | 0.01 % | 0.04 % | all standard futures pairs | 2026-09-01 16:00 UTC | Region-specific | S11 |
| CIS region and Ukraine | 0.01 % | 0.04 % | all stock futures | 2026-09-07 02:00 UTC | Region-specific | S12 |

Canada and the United Kingdom appear in the 2025 fee announcement and in the User Agreement's prohibited list, and both statements are recorded as published.
None of the regional rates apply to API orders, because the API schedule takes precedence.

## 6. Funding as a cost

| item | value | label | source |
|---|---|---|---|
| Formula | "Funding Rate = Interest Rate + Clamped Premium Index (range: −0.05% to +0.05%)" | Published | S16 |
| Interest rate | Not given as a number, the worked example uses 0.01 % | Not publicly specified | S16 |
| Premium index sampling and impact notional | Not described | Not publicly specified | S16, S17 |
| Worked example | A premium index of 0.1 % is clamped to 0.05 %, and with an interest rate of 0.01 % the funding rate is 0.06 % | Published | S16 |
| Cap and floor | Per contract, `maxFundingRate` and `minFundingRate` in the funding call | Probed | P3 |
| Caps in use at 07:12 UTC | ±3 % on 811 contracts, ±0.02 % on 242, ±2.5 % on 91, ±0.75 % on 35, ±4 % on 4, ±0.18 % on BTC_USDT and ETH_USDT, ±0.3 % on 2, ±0.1 % on 2, 0 on 2, and +0.02 % with -0.01 % on MX_USDT | Probed | P3 |
| Contracts at their cap | 115 of 1,192 at 07:12 UTC, and 86 at 19:01 UTC | Dynamic, Probed | P3 |
| Intervals in use | 4 h on 593, 8 h on 587, 1 h on 10, 2 h on 1, 24 h on 1, from `collectCycle` at 07:12 UTC | Probed | P3 |
| Settlement instants | "generally settled every 8 hours, at 00:00, 08:00, and 16:00 (UTC)", and "Funding fee settlement times may vary by Futures trading pair" | Published | S17 |
| Settlement batch delay | "Funding fee settlement may be delayed by up to 15 seconds due to batch processing", and a position opened at 08:00:05 UTC "may still be included" | Published | S17 |
| Who pays | A positive rate means longs pay shorts, a negative rate means shorts pay longs | Published | S17 |
| Who is charged | "Only users who hold open positions at the settlement time" | Published | S17 |
| Notional, stablecoin margined | Position size in coins × fair price | Published | S17 |
| Notional, coin margined | Position size in contracts × contract value / fair price | Published | S17 |
| Published rate | A live estimate for the upcoming settlement, which kept moving until the instant, see [`./rest.md`](./rest.md) section 4 | Probed | P3 |
| Unit | A fraction per interval, 0.000071 means 0.0071 % | Probed | P3 |

Funding is zero for the modelled taker cross, which closes within seconds and crosses no settlement.
A position held across a settlement pays the whole rate, including the up to 15 s batch window after the instant.

## 7. Liquidation, settlement and delisting charges

| item | value | label | source |
|---|---|---|---|
| Liquidation fee | The contract list carries `liquidationFeeRate` per contract, 0.02 % on 967 contracts, 0 on 216, 0.01 % on 11 and 0.04 % on 5 at 06:59 UTC, and BTC_USDT carries 0.04 % | Probed | P1 |
| Liquidation fee documentation | The contract info page describes the field only as "Liquidation fee rate", and the calculation guide read does not mention a liquidation fee, so when and on what notional it is charged is not stated | Not publicly specified | S7, S18 |
| Delivery or settlement charge | No dated futures are listed | Not offered | P1 |
| Delisting charge | No charge found | Not publicly specified | none |
| Delisting behaviour | 15 contracts left the contract list between 06:59 and 07:10 UTC, and the book call for one of them then returned an empty book with a frozen timestamp, see [`./rest.md`](./rest.md) section 2 | Probed | P1, P4 |

Deposit, withdrawal and spot fees are out of scope and are listed on the [MEXC fee page](https://www.mexc.com/fee).

## 8. CCXT

| item | value | source |
|---|---|---|
| Where the swap taker comes from | `'taker': this.safeNumber(market, 'takerFeeRate')`, read per contract from the public `GET /api/v1/contract/detail` reply | `server/node_modules/ccxt/js/src/mexc.js` line 1465, the call at line 1387 |
| Exchange level constant | `'maker': 0.002`, `'taker': 0.002` under `fees.trading`, which the swap markets do not use | `server/node_modules/ccxt/js/src/mexc.js` lines 481 and 482 |
| Reported swap takers without credentials | 0 ppm on 576 markets, 100 ppm on 15, 200 ppm on 491, 400 ppm on 64 and 1,000 ppm on 38, at 07:09 UTC, and 576, 12, 494, 64 and 38 at 18:55 UTC | P2 |
| The 1,000 ppm group | maker 0.04 % and taker 0.10 %, the Innovation Zone rates of S5, and 36 of its 38 contracts carried `apiAllowed` false at 19:01 UTC | P1 |
| BTC/USDT:USDT | `taker` 0.0001 at 07:09 UTC and 0.0002 at 18:55 UTC, `maker` 0 | P2 |
| What the reported number is | The web and app rate for that contract, which is not the rate an API order pays | P1, S6 |

CCXT reports a real per contract fee, so no single `ccxtTakerPpm` constant can describe it.
The reported values change when MEXC starts or ends a zero fee event on a contract, as the 11 `TEMP` contracts show.

## 9. Recommended registry values

These are recommendations for a later design, not decisions.

| key | value | reason |
|---|---|---|
| `takerPpm` | `800` | The API taker of 0.08 % since 2026-06-01 overrides every per contract rate for API orders, S6 |
| `ccxtTakerPpm` | unset | CCXT reads a real per contract web and app rate, 0 to 1,000 ppm, so the connector's single constant check would warn on every market |
| connector | override `isExpectedCcxtTakerPpm` to accept any CCXT value | [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 27 to 31 already names this case: "A venue that serves a real per market fee" |
| `marketFilter` | keep `market.info.apiAllowed === true` | 41 active swaps carried `apiAllowed` false at 07:09 UTC, and Innovation Zone pairs cannot be traded through the API, S5 |

The 76 pairs that MEXC lists in more than one of USDT, USDC and USD need no filter, because [`../../../server/src/engine/cluster/quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 12 to 17 already rank USDT before USDC before USD.

A registry comment should cite `server/node_modules/ccxt/js/src/mexc.js` line 1465 and the S6 announcement.
The API rate has changed twice in two months, so the later design should re-read the API updates page before trusting 800 ppm, see [MEXC API updates](https://www.mexc.com/announcements/api-updates).

## Conflicts between documents and the wire

- The API fee announcement of 2026-06-01 has a table of maker 0.06 % and taker 0.08 %, and an example sentence in the same page that still says "maker 0.04% and taker 0.06%", the May rates.
  The table is the stated adjustment.
- The funding page clamps the premium index to ±0.05 % in its formula and its worked example, and the wire shows per contract caps from ±0.02 % to ±4 %.
  So the formula's clamp is not the effective cap.
- MEXC Learn's "Calculation of Futures Yield and Trading Fees" says taker 0.040 % and maker 0.010 % with "Rates are as of August 15, 2025", S19, while the public contract list on 2026-09-15 reports 0.02 % taker and 0 % maker on most contracts.
  The Learn page dates its own rates, and the wire is newer.

## 10. Source ledger

Retrieved 2026-09-15 unless stated.
Every official page was read with WebFetch, because `www.mexc.com` answered `curl` from this host with HTTP 403.

| id | title | URL | entity or region | sections supported |
|---|---|---|---|---|
| S1 | MEXC User Agreement | https://www.mexc.com/terms | MEXC, global | 1 |
| S2 | Integration guide, MEXC Futures API | https://www.mexc.com/api-docs/futures/integration-guide | MEXC, global | 1 |
| S3 | Introducing API Futures Trading on Mar 31, 2026 | https://www.mexc.com/announcements/article/introducing-api-futures-trading-on-mar-31-2026-17827791534551 | MEXC, global | 1, 5, 9 |
| S4 | MXC Contract API, update log | https://mexcdevelop.github.io/apidocs/contract_v1_en/ | MEXC, global | 1 |
| S5 | Introducing Futures Innovation Zone: High Potential Assets & Opportunities | https://www.mexc.com/announcements/article/introducing-futures-innovation-zone-17827791534000 | MEXC, global with restricted regions | 1, 2, 9 |
| S6 | Updates to API Futures Trading Fees (Jun 1, 2026) | https://www.mexc.com/announcements/article/updates-to-api-futures-trading-fees-jun-1-2026-17827791535742 | MEXC, global | 2, 5, 9 |
| S7 | Get Contract Info, MEXC Futures API | https://www.mexc.com/api-docs/futures/market-endpoints/get-contract-info | MEXC, global | 3, 7 |
| S8 | 0 Fee Fest | https://www.mexc.com/zero-fee | MEXC, global | 5 |
| S9 | Updated Futures Trading Fee Rates for Users for Select English-Speaking Countries (Mar 24, 2025) | https://www.mexc.com/announcements/article/updated-futures-trading-fee-rates-for-users-for-select-english-speaking-countries-mar-24-2025-17827791522827 | Australia, Canada, New Zealand, United Kingdom | 5 |
| S10 | MEXC Futures Trading Fee Adjustment in Select Regions Effective August 8, 2025 | https://www.mexc.com/announcements/article/mexc-futures-trading-fee-adjustment-in-select-regions-effective-august-8-2025-17827791528661 | Palau, Czech Republic | 5 |
| S11 | Adjustments to Standard Futures Trading Fees in Kosovo | https://www.mexc.com/announcements/article/adjustments-to-standard-futures-trading-fees-in-kosovo-17827791538001 | Kosovo | 5 |
| S12 | Adjustments to Trading Fees on Stock Futures in the CIS Region and Ukraine | https://www.mexc.com/en-GB/announcements/article/adjustments-to-trading-fees-on-stock-futures-in-the-cis-region-and-ukraine-17827791538276 | CIS region and Ukraine | 5 |
| S13 | Updates to API Futures Trading Fees (May 1, 2026) | https://www.mexc.com/announcements/article/updates-to-api-futures-trading-fees-may-1-2026-17827791535194 | MEXC, global | 5 |
| S14 | Trading Fee announcements | https://www.mexc.com/announcements/tag/trading-fee-40 | MEXC, global | 5 |
| S15 | Futures Trading VIP Experience Card - Enjoy 0.01% Taker Fees, The Lowest in the Industry! | https://www.mexc.com/support/articles/17827791519715 | MEXC, global | 5 |
| S16 | BTCUSDT Futures Funding Rate History & Updates | https://www.mexc.com/futures/information/funding_list/BTC_USDT | MEXC, global | 6 |
| S17 | MEXC Futures Funding Rate: Calculation Methods and How to View Funding Rates | https://www.mexc.com/support/article/mexc-futures-funding-rate-305432020820705280 | MEXC, global, page dated 2026-06-01 | 6 |
| S18 | MEXC Futures Calculation Guide: Fees, Unrealized PNL, and Closing Profit Explained | https://www.mexc.com/support/article/mexc-futures-calculation-guide-312060306409668608 | MEXC, global, page dated 2026-02-25 | 7 |
| S19 | Calculation of Futures Yield and Trading Fees, MEXC Learn | https://www.mexc.com/learn/article/calculation-of-futures-yield-and-trading-fees/1 | MEXC, global, page dated 2026-07-27 | conflicts |

| id | probe | observation |
|---|---|---|
| P1 | `curl https://contract.mexc.com/api/v1/contract/detail` at 06:59 UTC, and `https://api.mexc.com/api/v1/contract/detail` at 07:10 UTC and 19:01 UTC | Per contract `takerFeeRate`, `makerFeeRate`, `feeRateType`, `isZeroFeeRate`, `apiAllowed`, `type`, `futureType`, `liquidationFeeRate` |
| P2 | [`../../../scripts/probes/mexc-rest-probe.mjs`](../../../scripts/probes/mexc-rest-probe.mjs) `catalog` at 07:09 UTC | CCXT counts by settlement and reported taker ppm |
| P3 | [`../../../scripts/probes/mexc-rest-probe.mjs`](../../../scripts/probes/mexc-rest-probe.mjs) `anchor` at 07:12 UTC, first reply of the bulk funding call | Caps, intervals, contracts at cap |
| P4 | `curl https://api.mexc.com/api/v1/contract/depth/ALIGN_USDT?limit=5` at 07:10 UTC | Empty book with timestamp 07:00:01 UTC after delisting |
