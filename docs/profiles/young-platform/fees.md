# Young Platform Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:24 to 04:56 UTC, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

Young Platform is CoinGecko's trust rank 121 in the survey list of 2026-09-22, it lists no perpetual, and it has no CCXT class.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The spot market is not an exchange order book.
Since 2026-07-01 Young Platform runs no internal order book and routes every order of its Pro platform, and of its API, to external venues as a Fill or Kill limit order, S5.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/young-platform/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/young-platform/ws-probe.mjs).

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 local time for every source row, 2026-09-23 UTC | source ledger |
| operator | Young Platform S.p.A., Via Francesco Cigna 96/17, 10155 Turin, Italy, VAT 11931440017 | S7 |
| licence | crypto-asset service provider under MiCAR, authorised by Consob and Banca d'Italia on 30/06/2026 under article 16(1) of Legislative Decree 129/2024 and article 63 of Regulation (EU) 2023/1114 | S5 |
| authorised services | custody, exchange of crypto-assets for funds and for other crypto-assets, execution of orders on behalf of clients, placing, advice, portfolio management, transfer | S7 |
| services not held | operation of a trading platform. The Pro notice says the platform "does not operate, in any form, a multilateral trading system within the meaning of Article 76 MiCAR" | S5, S7 |
| two trading products | the Young Platform app is bilateral dealing on own account under MiCAR article 77. Young Platform Pro and the trader API are execution of orders on behalf of clients under article 78, routed by a Smart Order Router to external venues | S4, S5 |
| who may trade | residents of the United States, the US Pacific Islands, the US Minor Outlying Islands and the US Virgin Islands may not register. Birth in one of them is no bar if the residence on the identity document is elsewhere | S9 |
| other exclusions | the high risk third countries of the European Commission and a list kept by the AML officer, in the terms of the YNG vesting service. No general country list is published beyond the US one | S4, S9 |
| US persons | may not trade | S9 |
| CoinGecko listing | "Young Platform", Italy, established 2019, trust score 4, trust rank 125 in the API at 04:38 UTC, 24 h volume 6.98 BTC, 48 tickers, all linking to `pro.youngplatform.com/trade/` | S11 |
| access from this host | every public REST and WebSocket call answered, 200 or 101, with Cloudflare edges `YVR` and `SEA` in `cf-ray`. No refusal, no challenge. These results are from the Canadian VPN exit | P1, P2, P4 |

## 2. Quick answer

| family | schedule | maker | taker | maker ppm | taker ppm | source |
|---|---|---|---|---:|---:|---|
| spot, SOR execution (Pro and trader API) | Annex A (b), Level 0, 30-day volume EUR 0.00 to 5,000.00 | no maker order exists | 0.40% | none | 4,000 | S4 |
| spot, legacy Pro order book, before 2026-07-01 | help center | 0.2% | 0.2% | 2,000 | 2,000 | S8 |
| spot, legacy Pro order book, before 2026-07-01 | legacy `GET /api/v4/public/markets`, 88 of 89 markets | `makerFee` 0.20, read as percent | `takerFee` 0.30, read as percent | 2,000 | 3,000 | P2 |
| spot, app, bilateral | Annex A (a) | not applicable | spread 0.10% to 1.50% by class plus 1.89% explicit | not applicable | 19,900 to 33,900 | S4 |

The API trader surface places only SOR orders, S3, so the SOR row is the one that matters.
It is one brokerage commission on every executed order, applied "to the intermediation result obtained at the External Execution Venue", S5.
The only order type is a Fill or Kill limit order, S5 and S3, so no order ever rests and there is no maker rate.
The help center article still shows the old 0.2% maker and taker, and it was last updated on 2026-06-04, before the new model took effect.
The legacy v4 market list still answers with `makerFee` 0.20 and `takerFee` 0.30, and its `currentTradingPrice` is frozen: 51,395.32 for BTC-EUR against a live last of 76,199, P2.
Both describe the internal order book dismissed on 2026-07-01, and the Annex A schedule dated 30/06/2026 replaces them.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals | absent | no product page, no fee row and no help article names one, S4, S7. CoinGecko's derivatives list of 214 venues does not include it, S12 |
| perpetuals, unreleased | code only | the Pro web app bundle `ypp-2.26.1` carries a futures module with `/api/futures/...` calls and One Trading's public API and stream URLs, and its config sets `FUTURES_ENABLED:!1`. The public `https://bff.youngplatform.com/api/status` lists 20 feature flags and no `futures`, and `https://bff.youngplatform.com/api/futures/markets` answers 404, S13. If it ever ships, the contracts would be One Trading's, see [`../onetrading/`](../onetrading/) |
| dated futures | absent | S4, S7 |
| options | absent | S4, S7 |
| margin | absent | `activeMarginTrading` is false on all 89 rows of the legacy v4 market list, P2 |
| spot, SOR | present, 24 markets: 20 quoted in EUR and 4 in USDC, 23 open for buy and sell. `YNG-EUR` is `active` with buy and sell disabled | `GET /api/v1/trader/public/markets`, P1, P2 |
| spot, tickers | 89 markets: 77 EUR, 11 USDC, 1 BTC | `GET /api/v1/trader/public/tickers`, P1 |

## 4. Spot tiers

### SOR execution, Annex A (b), from 2026-07-01

| level | 30-day volume, EUR | fee | ppm |
|---|---|---|---:|
| Level 0 | 0.00 to 5,000.00 | 0.40% | 4,000 |
| Level 1 | 5,000.01 to 10,000.00 | 0.35% | 3,500 |
| Level 2 | 10,000.01 to 50,000.00 | 0.28% | 2,800 |
| Level 3 | 50,000.01 to 100,000.00 | 0.22% | 2,200 |
| Level 4 | 100,000.01 to 1,000,000.00 | 0.18% | 1,800 |
| Level 5 | 1,000,000.01 to 2,500,000.00 | 0.14% | 1,400 |
| Level 6 | 2,500,000.01 to 5,000,000.00 | 0.10% | 1,000 |
| Level 7 | over 5,000,000.01 | 0.05% | 500 |

The table is S4, "For the orders executed through Journey Pro, the following tiered fees apply on the basis of the trading volumes of the last 30 days".

### Qualification

The API's `TraderProfile` schema says the tier follows `rolling_volume_eur`, "the customer's trailing 30-day EUR volume, refreshed once a day at 05:00 UTC", S3.
Its `FeeTier` carries `perc_fee_bps` and a `fee_fixed` component, and `sor_tiers` is "the full SOR fee tier ladder", "identical across markets", S3.
The ladder is returned only by the authenticated `GET /private/profile`, so it was not read here.
Whether `fee_fixed` is non-zero on any tier is Not verified.

### Bilateral app, Annex A (a)

The app sells from Young Platform's own inventory at a dynamic spread, plus an explicit fee, S4.

| class | criterion | base spread | maximum spread |
|---|---|---|---|
| A | market cap 50 bn USD or more | 0.40% | 0.80% |
| B | market cap 1 bn USD or more | 0.60% | 1.00% |
| O | market cap under 1 bn USD | 0.80% | 1.50% |
| S | no criterion printed | 0.10% | 0.30% |

The explicit fee is 1.89% of the countervalue, or EUR 1.99 on EUR orders up to 50.00 and EUR 2.49 on EUR orders above 50.00 and under 100.00, S4.
The legacy v4 market list carries the same two fixed tiers on `BTC-EUR`, P2.
This product has no API and is context only.

## 5. Discounts that change the spot taker

| discount | effect | evidence |
|---|---|---|
| YNG clubs | a fee discount of 5% (Essential, 126 YNG), 30% (Bronze, 1,087 YNG), 50% (Silver, 3,624 YNG), 75% (Gold, 7,249 YNG) or 90% (Platinum, 18,123 YNG), YNG locked for 90 days | `GET https://api.youngplatform.com/api/v2/clubs/public`, the five rows with `active` true, S10 |
| club against volume | the SOR discount is "the club discount below the volume cap, the non-club (fee-user-group) discount once the volume exceeds the cap" | `sor_discount_percentage` in S3 |
| referral, market maker, zero fee promotions | none published for SOR orders | S4 |

The club table also holds eight inactive rows with older thresholds, among them a 100% Platinum discount, S10.
The volume cap and the non-club discount are not published.
A Platinum club at 90% would take the Level 0 rate to 0.04%, 400 ppm, if the discount applies to the SOR commission as S3 implies.
That reading is an inference from the schema text and was not checked on an account.

## 6. Funding as a cost

None.
No perpetual is listed, so no funding rate exists.
Italy levies a stamp duty of 0.2% a year on the value of crypto-assets held at year end on every Young Platform account, S4.

## 7. Liquidation, settlement and delisting

No liquidation, since no margin or derivative product is live.
A Fill or Kill order that finds too little size at the external venue is cancelled in full, and the notice calls that likely "in conditions of high volume, illiquidity, rapid movements or market volatility", S5.
All open orders on Pro were cancelled unilaterally before the maintenance window of 2026-06-30 20:00 to 2026-07-01 02:00 CEST, when the internal order book was dismissed, S5.
Order entry through the old Pro API was switched off on 2026-06-25, S6.
Deposit, withdrawal and card fees are on the official page `https://exchange.youngplatform.com/en/fees`, which renders only in a browser and was not read.

## 8. CCXT

No class.
`require('ccxt').exchanges` in CCXT 4.5.68 from `server/` lists 104 ids and none matches `young`, P1.
The `ts/src` folder of CCXT master on GitHub listed 112 entries on 2026-09-23 and none matches `young`, S14.
So there is no `market.taker` to report and no source line to cite.

## 9. Recommended registry values

None.
Young Platform should not enter the registry, because it lists no perpetual, see the verdict in [`rest.md`](./rest.md) section 8.
If a spot comparison ever needs it, `takerPpm` 4,000 is the Level 0 SOR commission and `ccxtTakerPpm` has no value to declare.
The commission is charged on top of whatever the external venue's own price and fee were, S5, so 4,000 ppm is a lower bound on the cost of a cross.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Young Platform API docs, README and `GUIDES/overview.md`, commit `0d92713` of 2026-07-30 | https://github.com/YoungAgency/youngplatform_api_docs | 2026-09-22 | Young Platform S.p.A. | hosts, public and private surfaces |
| S2 | `GUIDES/websocket.md` | https://github.com/YoungAgency/youngplatform_api_docs/blob/main/GUIDES/websocket.md | 2026-09-22 | Young Platform S.p.A. | socket topics, SOR venues example `kraken_prime` |
| S3 | `trader_openapi.json`, OpenAPI 3.0, version 1.0 | https://github.com/YoungAgency/youngplatform_api_docs/blob/main/trader_openapi.json | 2026-09-22 | Young Platform S.p.A. | `FeeTier`, `TraderProfile`, order type LIMIT with FOK or IOC, sections 2, 4 and 5 |
| S4 | General Terms and Conditions, Crypto-Asset Services, 30/06/2026, Annex A Detailed Fee Schedule | https://youngplatform.com/en/legal/ | 2026-09-22 | Young Platform S.p.A., Italy | fee tables, stamp duty, sections 2, 4, 5 and 6 |
| S5 | Notice on the new operating model of Young Platform Pro from 1 July 2026 | https://youngplatform.com/en/legal/ | 2026-09-22 | Young Platform S.p.A., Italy | CASP authorisation date, dismissed order book, FOK only, brokerage commission |
| S6 | Temporary Suspension and Decommissioning of the Young Platform Pro API Infrastructure, 1 June 2026 | https://youngplatform.com/en/legal/ | 2026-09-22 | Young Platform S.p.A., Italy | old API order entry off from 2026-06-25, new API planned by end of 2026 |
| S7 | Transparency on executed orders, page footer | https://youngplatform.com/en/order-execution-transparency/ | 2026-09-22 | Young Platform S.p.A., Italy | entity, address, authorised services |
| S8 | Cosa sono le commissioni Maker e Taker?, updated 2026-06-04 | https://support.youngplatform.com/hc/it/articles/360021046440 | 2026-09-22 | Young Platform, Italian help center | legacy Pro 0.2% maker and taker |
| S9 | Non riesco a registrarmi a Young Platform, updated 2026-09-21, and Non riesco a registrarmi a Pro, updated 2026-02-25 | https://support.youngplatform.com/hc/it/articles/360021249380 and https://support.youngplatform.com/hc/it/articles/360021249520 | 2026-09-22 | Young Platform, Italian help center | United States and territories not supported |
| S10 | Public clubs list | https://api.youngplatform.com/api/v2/clubs/public | 2026-09-22 | Young Platform | club thresholds and `feeDiscountPercentage` |
| S11 | CoinGecko API, exchange `young-platform` | https://api.coingecko.com/api/v3/exchanges/young-platform | 2026-09-22, 04:38 UTC | CoinGecko | trust score, rank, volume |
| S12 | CoinGecko API, derivatives exchanges list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | 214 derivatives venues, none is Young Platform |
| S13 | Pro web app bundle `ypp-2.26.1` and the public feature status | https://pro.youngplatform.com/assets/main-D2m9vOaS.min.js and https://bff.youngplatform.com/api/status | 2026-09-22 | Young Platform | futures module present and disabled |
| S14 | CCXT master, `ts/src` listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-22 | CCXT | no Young Platform class |
| P1 | `rest-probe.mjs all`, 04:31 to 04:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/young-platform/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | catalog counts, CCXT list, access |
| P2 | `rest-probe.mjs all`, 04:41 to 04:43 UTC, and the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/young-platform/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | legacy v4 fees and frozen prices, margin flag |
| P4 | `ws-probe.mjs` all modes, 04:33 to 04:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/young-platform/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | socket access |
