# PointPay Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:22 to 03:32 UTC on 2026-09-23, from the development host near Seattle, with a second pass at the times named in [`rest.md`](./rest.md) section 9.

This profile covers the fees of PointPay futures, which are USDT-margined linear perpetuals only.
PointPay has no CCXT class, and every perpetual it lists is a Bybit linear perpetual whose book, socket, index, mark and funding PointPay relays unchanged, see [`rest.md`](./rest.md) section 2 and [`websocket.md`](./websocket.md) section 4.
So the fee is the one thing a PointPay leg would add to a Bybit leg, and it is higher.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | PointPay Limited, named as the contracting party of the Terms and Conditions, last updated 12 March 2026 | S9 |
| governing courts | "CLAIMS SHALL BE RESOLVED EXCLUSIVELY VIA COURTS OF THE SAINT VINCENT AND THE GRENADINES." | S9 |
| country on CoinGecko | Saint Vincent and the Grenadines, established 2018, trust score 7, trust score rank 63 on 2026-09-23 (the survey list said 62) | S12 |
| futures launch | "Futures trading is now live on PointPay!", 28 April 2026, "20+ futures contracts", "Leverage of up to 100x" | S11 |
| futures size today | 172 USDT perpetuals, among them 89 stock, 13 ETF and 4 commodity perpetuals that Bybit types as such | P1 `catalog` |
| excluded by domicile | "Iran, Syria, North Korea, Iraq, Sudan, Afghanistan, Libya, Cuba, Somalia, Myanmar, Yemen, Lebanon, Venezuela, South Sudan, Central African Republic, Cote d'Ivoire, Eritrea, Liberia, Russia, Belarus, Crimea, and/or the Luhansk and Donetsk regions of Ukraine, PRC user" | S9 |
| excluded, European Union | new registrations from the EU are banned "with immediate effect", services cease on 1 July 2026 at 00:00 UTC, and withdrawals end on 1 October 2026 at 00:00 UTC | S9 section 20 |
| futures specific exclusion | "The Futures Services are not available to any person located in, incorporated in, ordinarily resident in, or otherwise subject to a jurisdiction where the offering or use of the Futures Services would be unlawful, restricted, or require a licence, registration, or approval not held by PointPay" | S10 section 3 |
| United States | not named in either list, and no US licence or registration is claimed anywhere read | S9, S10 |
| VPN | "You must not use virtual private networks, proxies, account-sharing arrangements, nominee structures, or other means to disguise your location" | S10 section 3 |

Whether a US person may trade PointPay futures is Not publicly specified.
The futures terms exclude any jurisdiction where a licence PointPay does not hold is required, and they do not say which jurisdictions those are.
Bybit, whose book PointPay relays, is a separate company with its own exclusions, and whether those reach PointPay's customers is Not publicly specified.
The public REST and WebSocket endpoints answered this host with HTTP 200 and open sockets, and nothing refused it, see [`rest.md`](./rest.md) section 1.
The registration country list at `https://back.pointpay.io/v3/profile/countrylist` offers every country, Iran and Russia included, so it says nothing about eligibility.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M linear perpetuals, live schedule | 0.05 %, 500 ppm | 0.085 %, 850 ppm | S7 tier "Basic", S8 on 172 of 172 contracts, P1 |
| USDT-M linear perpetuals, Knowledge Base page | 0.02 %, 200 ppm | 0.055 %, 550 ppm | S1 |

The Knowledge Base page and the live schedule disagree.
The live schedule that feeds the `/fees/futures` page and the CoinGecko and CoinMarketCap contract replies all say 850 ppm taker, while the Knowledge Base page says 550 ppm.
550 ppm taker and 200 ppm maker are Bybit's own VIP 0 derivatives rates, see the VIP 0 row of [`../bybit/fees.md`](../bybit/fees.md) section "Standard product rates", and the engine registry uses 550 ppm for Bybit at [`registry.ts`](../../../server/src/venues/registry.ts) line 46.
This profile takes 850 ppm as the rate a PointPay account pays, because three live sources agree on it and the page reads as copied from Bybit, and that reading is an inference.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 172 | `GET /fapi/v1/public/trade/pairs`, every row quoted in USDT, and Bybit types all 172 `LinearPerpetual`, P1 `catalog` |
| USDC-M perpetuals | no | no USDC quote in the pairs list |
| coin-margined, inverse perpetuals | no | the CoinGecko contracts reply marks all 172 `vanilla`, and no inverse symbol is listed |
| dated futures | no | no `LinearFutures` row, and the CoinGecko reply marks all 172 `Perpetual` |
| options | no | none documented or listed |
| spot | yes, 148 markets | `GET https://api.pointpay.io/api/v1/public/markets` returned 148 rows on 2026-09-23, on its own ViaBTC style engine, see [`websocket.md`](./websocket.md) section 1 |

## 4. Perpetual tiers

The live futures schedule, read from `GET https://back.pointpay.io/api/internal/v1/front-page/fee-schedule/futures-levels` on 2026-09-23, S7.
The page renders the volume column as "30 day trade volume USD" and the balance column as a USDT balance, from the web bundle's labels `user.level.30dayTradeVolumeUSD` and `user.level.tickerBalance` with ticker `USDT`.

| level | 30 day volume, USD | logic | USDT balance | maker | taker | maker paying in PXP | taker paying in PXP |
|---|---|---|---|---|---|---|---|
| Basic | under 10,000,000 | OR | under 100,000 | 0.050 % | 0.085 % | 0.045 % | 0.0765 % |
| Zinc | from 10,000,000 | AND | from 100,000 | 0.048 % | 0.070 % | 0.0432 % | 0.063 % |
| Bronze | from 25,000,000 | AND | from 250,000 | 0.046 % | 0.0675 % | 0.0414 % | 0.06075 % |
| Silver | from 50,000,000 | AND | from 500,000 | 0.044 % | 0.065 % | 0.0396 % | 0.0585 % |
| Gold | from 100,000,000 | AND | from 1,000,000 | 0.042 % | 0.062 % | 0.0378 % | 0.0558 % |

The Gold row carries `volumeTo` 99,999,999, below its own `volumeFrom`, which reads as a data entry slip.
The Knowledge Base page publishes no tier table, only "The standard rate is 0.055%" taker and "0.02%" maker, S1.

### Qualification

A level above Basic needs both the 30 day volume and the USDT balance, since the `conditionLogic` of every level above Basic is `AND`, S7.
How the balance is measured, spot, futures wallet or both, is Not publicly specified.

## 5. Discounts that change the perpetual taker

| discount | effect on VIP 0 taker | source |
|---|---|---|
| paying fees in PXP, PointPay's token | 850 to 765 ppm, 10 % off | S7 `tradeCoreTokenPercentTaker` `0.076500` |
| referral | none on the taker. The referrer earns "a percentage of the trading commissions they generate" at five levels of 25, 15, 10, 5 and 3 %, and the page never uses the word discount | S13 |
| market maker programme | Not publicly specified | none found |
| zero fee promotions | the spot promotions call lists only `USDC_USDT` at 0 %, and no futures promotion is published | `https://back.pointpay.io/api/internal/v1/front-page/fee-schedule/spot-promotions`, 2026-09-23 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate (F) = clamp [Average Premium Index (P) + clamp (Interest Rate (I) − Average Premium Index (P), 0.05%, −0.05%), Upper Funding Rate Limit, Lower Funding Rate Limit]" | S3 |
| interest rate | "0.03% / (24 / Funding Interval)", 0.01 % per 8 h interval | S3 |
| cap | "Upper Funding Rate Limit = min((Initial Margin Rate − Maintenance Margin Rate) × 0.75, Maintenance Margin Rate)", the floor is its negative, and the exchange "may promptly change" them | S3 |
| cap per contract | `fundingCap` 0.00333 on `BTCUSDT` and `ETHUSDT`, 0.01 on `1000BONKUSDT`, 0.005 on `AAPLUSDT`, 0.02 on `ZMUSDT` | P1 `catalog` |
| interval | 8 h on 143 contracts and 4 h on 29, read from Bybit's tickers for the 172 listed symbols | P1 `anchor` |
| settlement instants | "funding occurs three times a day: at 00:00 UTC, 08:00 UTC, and 16:00 UTC" for an 8 h contract. The next settlement read 04:00 UTC on 29 contracts and 08:00 UTC on 143 at 03:23 UTC | S4, P1 `catalog` |
| who pays | "If the funding rate is positive, buyers (“longs”) pay the fee to holders of open sell positions (“shorts”)", only positions open "at the moment the funding interval ends" | S4 |
| edge of the instant | "operations of opening or closing positions within the five-second interval before and after the moment of fee distribution do not guarantee inclusion in the fee accrual procedure or exclusion from it" | S4 |
| PointPay's cut | "PointPay does not take a cut of these fees" | S2 |
| rate value | equal to Bybit's `fundingRate` on 172 of 172 contracts in one run and 137 of 172 in the next, the misses from a cached reply, and `next_funding_rate_timestamp` equal to Bybit's `nextFundingTime` on 172 of 172 in both | P1 `anchor`, see [`rest.md`](./rest.md) section 4 |

The rate PointPay publishes is Bybit's rate to the digit whenever its reply is fresh.
PointPay publishes no funding history call, and three guessed paths answered with its not found shape, so the settled rates were read from Bybit's `GET /v5/market/funding/history`, P1 `reference`.
It showed `BTCUSDT` settling every 8 h at 00:00, 08:00 and 16:00 UTC from 2026-09-21 08:00 to 2026-09-23 00:00, and `1000BONKUSDT` every 4 h from 2026-09-22 04:00 to 2026-09-23 00:00, at 0.00005 each time.
The settlement instant itself was not captured.
Whether a PointPay account is charged Bybit's settled rate at Bybit's instant is Not verified, because it needs an account.

## 7. Liquidation, settlement and delisting charges

| charge | value | source |
|---|---|---|
| delisting | "Positions closed due to delisting are settled with a fixed fee of 0.05%. Standard trading fees based on VIP status do not apply in this case." | S1 |
| liquidation | no separate liquidation fee is published. Proceeds above the bankruptcy price go to the insurance fund, and a deficit is covered by it and then by auto-deleveraging | S14 |
| delivery | none, since no dated future is listed. `deliveryFeeRate` is empty on every sampled contract | P1 `catalog` |
| transfers between spot and futures wallets | "zero fees" | S2 |

## 8. CCXT

No CCXT class exists for PointPay.
`require('ccxt').exchanges` in CCXT 4.5.68, run from `server/`, lists 104 ids and none matches `point` or `ppay`, P1 `catalog`.
The `ts/src` folder of `github.com/ccxt/ccxt` at master commit `1d8b674`, dated 2026-09-22 12:48 UTC, lists 112 entries and none matches `point`.
So `market.taker` for a PointPay swap is undefined, and `ccxtTakerPpm` has nothing to declare.

The CCXT `bybit` class loads the same 172 symbols among Bybit's linear markets, and for a linear market it reports the reply's `takerFee` or else the constant 0.0006, 600 ppm, at `server/node_modules/ccxt/js/src/bybit.js` line 2219.
That is Bybit's number and not PointPay's.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 850 | the Basic level of the live schedule, the CoinGecko contracts `taker_fee` `0.085000` on 172 of 172 contracts, and the CoinMarketCap reply agree. The Knowledge Base 0.055 % is Bybit's rate copied |
| `ccxtTakerPpm` | none | no CCXT class, section 8 |

This is context for the verdict and not a request to register PointPay.
A PointPay leg would read Bybit's book at 850 ppm where the Bybit leg reads the same book at 550 ppm, so it would only add a dearer copy of an existing leg, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Knowledge Base, Trading Fees | https://pointpay.gitbook.io/base/documentation/ecosystem/futures/trading-fees | 2026-09-22 | PointPay, global | 0.055 % and 0.02 %, delisting fee, sections 2, 4 and 7 |
| S2 | Knowledge Base, Futures | https://pointpay.gitbook.io/base/documentation/ecosystem/futures | 2026-09-22 | PointPay, global | perpetuals only, no cut of funding, free transfers, sections 6 and 7 |
| S3 | Knowledge Base, Funding Rate | https://pointpay.gitbook.io/base/documentation/ecosystem/futures/funding-rate | 2026-09-22 | PointPay, global | funding formula, interest, cap, section 6 |
| S4 | Knowledge Base, Funding Fee Calculation | https://pointpay.gitbook.io/base/documentation/ecosystem/futures/funding-fee-calculation | 2026-09-22 | PointPay, global | settlement times, who pays, five second window, section 6 |
| S5 | Knowledge Base, Index Price | https://pointpay.gitbook.io/base/documentation/ecosystem/futures/index-price | 2026-09-22 | PointPay, global | index method, see [`rest.md`](./rest.md) section 4 |
| S6 | Knowledge Base, Mark Price | https://pointpay.gitbook.io/base/documentation/ecosystem/futures/mark-price | 2026-09-22 | PointPay, global | mark method, see [`rest.md`](./rest.md) section 4 |
| S7 | futures fee levels behind `https://exchange.pointpay.io/fees/futures` | https://back.pointpay.io/api/internal/v1/front-page/fee-schedule/futures-levels | 2026-09-23 | PointPay, global | tier table and PXP rates, sections 2, 4 and 5 |
| S8 | CoinGecko and CoinMarketCap futures contracts | https://api.pointpay.io/public/coingecko/futures/contracts and https://api.pointpay.io/public/cmc/futures/contracts | 2026-09-23 | PointPay, global | `maker_fee` 0.05 and `taker_fee` 0.085 on 172 rows, section 2 |
| S9 | Terms and Conditions, last updated 12 March 2026, rendered from `https://back.pointpay.io/content-groups` | https://exchange.pointpay.io/terms-conditions | 2026-09-23 | PointPay Limited | operator, courts, excluded domiciles, EU cessation, section 1 |
| S10 | Futures Trading Terms, from the same content call | https://exchange.pointpay.io/terms/futures-trading-terms | 2026-09-23 | PointPay Limited | Restricted Jurisdiction, VPN rule, section 1 |
| S11 | PointPay blog, "Futures trading is now live on PointPay!" of 28 April 2026 and "100+ new assets are now live on PointPay futures!" of 15 September 2026 | https://blog.pointpay.io/futures-trading-is-now-live-on-pointpay/ and https://blog.pointpay.io/55-new-assets-are-now-live-on-pointpay-futures/ | 2026-09-23 | PointPay | launch date and listing growth, section 1 |
| S12 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/pointpay | 2026-09-23 | CoinGecko | country, trust rank, section 1 |
| S13 | Knowledge Base, Referral Program | https://pointpay.gitbook.io/base/documentation/ecosystem/referral-program | 2026-09-23 | PointPay, global | referrer commission levels, section 5 |
| S14 | Knowledge Base, Liquidation Overview and Trading Rules: Liquidation Process | https://pointpay.gitbook.io/base/documentation/ecosystem/futures/liquidation-overview | 2026-09-22 | PointPay, global | insurance fund and auto-deleveraging, section 7 |
| S15 | CCXT master `ts/src` listing | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 | CCXT | no PointPay class, section 8 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/pointpay/rest-probe.mjs) `catalog`, `anchor` and `reference` | [`rest-probe.mjs`](../../../scripts/probes/venues/pointpay/rest-probe.mjs) | 2026-09-23 UTC | this host | contract count, fee fields, caps, intervals, funding equality, Bybit's funding history, CCXT list, sections 1 to 8 |
