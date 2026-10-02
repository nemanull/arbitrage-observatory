# Toobit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers perpetual trading on Toobit (CCXT id `toobit`), and nothing else.
Spot, the Innovation Zone, deposit, withdrawal, card and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/toobit/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/toobit/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entities | "Hopeful Technology Co. Ltd." (Cayman Islands) for users outside the EU and EEA, and "Elyndret Spółka Z Ograniczoną Odpowiedzialnością" (Poland) "in respect of services provided to users in the European Union or European Economic Area". No registration number or address appears in the terms. | Published | S2 |
| governing law | Cayman Islands law with Singapore arbitration outside the EU and EEA, Polish law with Warsaw courts inside them | Published | S2 |
| restricted locations in the terms | "Democratic People's Republic of Korea, Myanmar, Bulgaria, Burkina Faso, Cameroon, Democratic Republic of the Congo, Croatia, Haiti, Jamaica, Mali, Mozambique, Nigeria, Philippines, Senegal, South Africa, South Sudan, Syria, Tanzania, Türkiye, Yemen, KENYA, NAMIBIA, Afghanistan, Belarus, Central African Republic, Cuba, […] Ethiopia, Hong Kong, Iraq, Lebanon, Libya, Nicaragua, Somalia, Sudan, […] Uzbekistan, Russian-controlled regions of Ukraine, including the Crimea, Donetsk, and Luhansk regions, Venezuela", section 13.3, terms effective 2024-07-01 | Published | S2 |
| United States | "Starting from 1st August 2024, users in the United States will no longer be able to conduct any trading activities, including spot trading, futures trading, and buy crypto with a credit card." Deposits stopped the same day, and withdrawals were due by 2024-08-31. The terms as fetched do not name the United States. | Published | S3 |
| perpetuals by jurisdiction | The terms as fetched name no product restriction by jurisdiction, and do not say which products the Polish entity offers | Not publicly specified | S2 |
| who may trade the perpetuals | An account holder outside the restricted locations and outside the United States. A person in the United States may not trade. | Region-specific | S2, S3 |
| public API from this host | `api.toobit.com` and `stream.toobit.com` answered every public call with HTTP 200 or an application error, and no call was refused for the host's location | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 5 |
| website from this host | `www.toobit.com` content pages answered HTTP 200, and the fee page S1 was read here with `curl`. `https://www.toobit.com/fee`, the URL CCXT names at `server/node_modules/ccxt/js/src/toobit.js` line 105, answers 302 to itself, and `curl -L` stopped on HTTP 429 after 3 redirects. `support.toobit.com`, the old help center, returned NXDOMAIN. | Probed | `curl` and `dig` on 2026-09-22 about 21:27 UTC |

The development host sits in the United States, which Toobit stopped serving on 2024-08-01, so trading from it is not allowed under S3.
Reading public market data is not an account service, and the API hosts served it without a challenge.
The old help center is gone, so its articles on funding, the market maker rates and the API tiers were read through web.archive.org copies, each labelled with its capture date.
Several announcements carry a page stamp of 2025-08-01 whatever their content date, the United States notice among them, so a page stamp is not taken as a publication date.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals, crypto and TradFi | 0.0200 % = 200 ppm | 0.0600 % = 600 ppm | Published | S1, "Toobit trading fee structure update" dated 2026-06-26 02:24, read from this host. "VIP fee rates apply to all futures markets, including TradFi products." |
| USDC-M perpetuals | 0.02 % = 200 ppm | 0.06 % = 600 ppm | Published | S1 applies to all futures markets, and the USDC launch announcement S5 reads "Maker：0.02%，Taker：0.06%" |

The engine models a taker cross at the base retail tier, so 600 ppm is the number that matters for every Toobit perpetual.
S4, the help article on futures fees dated 2026-09-16, repeats the VIP 0 maker 0.0200 % and taker 0.0600 %, and then computes its taker example at "0.05%".
The tables in S1 and S4 agree on 600 ppm, so the example is taken as a slip, and both are written here.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USDT-M perpetuals | yes | 757, of which 244 carry `isRwa` true and `rwaType` `STOCK` | Probed, `GET /api/v1/exchangeInfo`, array `contracts`, field `marginToken` |
| USDC-M perpetuals | yes | 10: `BTC`, `ETH`, `SOL`, `DOGE`, `XRP`, `LTC`, `ADA`, `LINK`, `UNI` and `SUI`, each `-SWAP-USDC` | Probed, same call |
| coin-margined (inverse) perpetuals | Not offered | 0, `inverse` false on 767 of 767 contracts | Probed, same call |
| `TBV_` perpetuals such as `TBV_BTC-SWAP-TBV_USDT` | outside the catalog | 48 rows in the funding reply and 69 in the mark reply, none in `contracts` | Probed, see [`rest.md`](./rest.md) section 3. The demo announcement S15 says "Demo trading uses virtual funds", and reading `TBV_` as the demo set is an inference |
| Lite Perpetual | same books as USDT-M | "The same symbol order book applies for Lite Perpetual and USDT Perpetual" | S16 |
| dated futures | Not offered | 0, every contract id is `-SWAP-` and CCXT sets `future` false | Probed, and `server/node_modules/ccxt/js/src/toobit.js` line 32 |
| options | Not offered | 0, `options` is an empty array | Probed |
| event contracts and prediction market | yes, not detailed | not in the public API catalog | S1 site menu |
| spot | yes, not detailed | 530 in `symbols`, 518 active in CCXT | Probed |

CoinGecko's derivatives list reads "Toobit Futures" with 767 perpetual pairs, 72,823.73 BTC of open interest and 197,498.02 BTC of 24 h volume on 2026-09-22, S17.
Spot trading is commission-free except for the Innovation Zone, S1, and deposit and withdrawal fees are looked up at `https://www.toobit.com/en-US/support/what-are-the-deposit-and-withdrawal-fees`.

## 4. Perpetual tiers

S1 publishes one futures schedule for every futures market, effective with the 2026-06-26 update.

| VIP | maker | taker | balance (USDT) | 30 D futures volume (USDT) | 30 D spot volume (USDT) |
|---|---|---|---|---|---|
| 0 | 0.0200 % = 200 ppm | 0.0600 % = 600 ppm | < 500 | < 3,000,000 | < 100,000 |
| 1 | 0.0200 % = 200 ppm | 0.0500 % = 500 ppm | ≥ 500 | ≥ 3,000,000 | ≥ 100,000 |
| 2 | 0.0140 % = 140 ppm | 0.0400 % = 400 ppm | ≥ 50,000 | ≥ 8,000,000 | ≥ 500,000 |
| 3 | 0.0120 % = 120 ppm | 0.0375 % = 375 ppm | ≥ 200,000 | ≥ 25,000,000 | ≥ 1,000,000 |
| 4 | 0.0100 % = 100 ppm | 0.0350 % = 350 ppm | ≥ 1,000,000 | ≥ 100,000,000 | ≥ 5,000,000 |
| 5 | 0.0080 % = 80 ppm | 0.0315 % = 315 ppm | ≥ 2,000,000 | ≥ 300,000,000 | ≥ 20,000,000 |
| 6 | 0.0060 % = 60 ppm | 0.0300 % = 300 ppm | ≥ 3,000,000 | ≥ 500,000,000 | ≥ 30,000,000 |

### Qualification

"VIP status is automatically assigned based on the highest tier achieved through any of the following criteria: Account asset balance (USDT), 30-day futures trading volume, 30-day spot trading volume", S1.
"VIP levels are updated daily at 00:00 UTC", sub-accounts share the main account's level, and "Fees are applied based on the VIP level at the time an order is executed", S1.
So a balance of 500 USDT alone reaches VIP 1 and its 500 ppm taker, and S14 of 2026-05-25 announced that change as "VIP1 now starts at ≥500 USDT".
The engine's 600 ppm is the rate of an account below that balance.

### The account's own rate

`GET /api/v1/futures/commissionRate` (USER_DATA, weight 5) returns four rates per symbol, `openMakerFee`, `openTakerFee`, `closeMakerFee` and `closeTakerFee`, and the documented example reads `"0.0001"` to open as taker and `"0.0004"` to close as taker, S18.
No public page explains a split between opening and closing fees, and S1 publishes one rate per side.
CCXT's `fetchTradingFees` reads only the close fields, at `server/node_modules/ccxt/js/src/toobit.js` lines 2675 and 2676.
The call needs a key, so what a VIP 0 account receives from it is Account-gated and Not verified.

## 5. Discounts that change the perpetual taker

| discount | what it does | label | evidence |
|---|---|---|---|
| PRO tiers for API users | PRO 1 to PRO 4 at takers of 0.0400 %, 0.0300 %, 0.0275 % and 0.0250 %, from 30,000,000 USDT of 30 day volume with more than 15 % of it through the API. "PRO tiers apply for all API users (except Market Makers)." Article dated 2025-07-04, read from a web.archive.org capture of 2025-07-18 | Published, possibly stale | S7 |
| market maker | MM1 at 0.0000 % maker and 0.0200 % taker from 1,000,000,000 USDT of 30 day volume, MM2 at −0.0025 % maker and 0.0200 % taker from 2,000,000,000, undated, capture of 2025-07-10 | Negotiated, possibly stale | S8 |
| 50 % off on 30 pairs | 2026-09-03 10:00 UTC to 2026-09-24 10:00 UTC on 30 `-SWAP-USDT` pairs, among them `ONE`, `BB`, `ZIL`, `GRT` and `STRK`. "The fee discount applies to manual trading only. API trades are excluded", and registration is required | Published, ends 2026-09-24, does not apply to API orders | S6 |
| referral | CCXT carries a referral link with `'discount': 0.1`, at `server/node_modules/ccxt/js/src/toobit.js` lines 101 to 104. No Toobit page read states a referee discount on perpetual fees | Not publicly specified | CCXT |
| token holding | No token discount appears in S1 or S14 | Not publicly specified | S1, S14 |
| zero fee on perpetuals | None found. The zero-fee items in the announcement list are spot | Not publicly specified | S1, announcement sitemap |

None of these moves the VIP 0 API taker of 600 ppm.

## 6. Funding as a cost

S10 is the formula of record, an article dated 2023-11-29 read from a web.archive.org capture of 2025-10-06, because its host no longer resolves.
S9, dated 2026-04-01, is the current help article, and it states the fee, the schedule and who pays, and no formula.

```text
Funding = Net Position * Settlement Price * Funding Rate
Comprehensive interest rate = (denominated currency interest rate – underlying currency interest rate) / Funding settlement frequency
                              "Current values: 0.06% - 0.03% / 3 = 0.01%"
Fair Price = Index price * (1 + funding rate basis rate)
Premium Index = [Max (0, depth weighted bid price – fair price) - Max (0, fair price – depth weighted ask price)] / index price + funding rate basis rate
Estimated Funding Rate Of Next Period = clamp (average premium index + clamp (comprehensive interest rate – average premium index, premium deviating from upper limit, premium deviating from lower limit), upper limit of funding rate, lower limit of funding rate)
```

| item | documented | probed | evidence |
|---|---|---|---|
| who pays | positive rate: "long position holders pay funding fees to short position holders", negative the reverse, and "Only users who hold open positions at the time of settlement will pay or receive funding fees" | | S9 |
| fee | "Funding Fee = Position Value × Funding Rate = Position Size × Mark Price × Funding Rate", exchanged between traders with "no fees charged by the platform" | | S9 |
| schedule | "every 8 hours at 00:00, 08:00, and 16:00 (UTC)", and "some contracts may have different settlement intervals (e.g., every 1, 2, or 4 hours)" | `period` `8H` on 327 contracts, `4H` on 437 and `1H` on 3, and every 8 h and 4 h contract named 2026-09-23 00:00 UTC as the next settlement at 21:34 UTC | S9, [`rest.md`](./rest.md) section 3 |
| interval changes | per contract announcements, for example `ALPACAUSDT` from 4 h to 2 h on 2025-04-24 with a "±2.00%" cap | the three hourly contracts on 2026-09-22 were `LSK-SWAP-USDT`, `G-SWAP-USDT` and `LRCX-SWAP-USDT` | S12, probe |
| interest term | "0.06% - 0.03% / 3 = 0.01%" per 8 h period | `interest` `"0.0001"` on 593 contracts, `"0.0"` on 172, and `"0.00005"` and `"0.0003"` on one each. 171 of the 172 zero rows are `isRwa` stock contracts, and the published rate equalled `interest` exactly on 219 contracts in the rerun | S10, `/api/v1/futures/fundingRate` |
| depth for the premium | "The value range of N: 8000 USDT", the notional over which the depth weighted bid and ask are read | | S10 |
| averaging | "The current average premium index is the arithmetic average of all current-period premium indices in the last 8 hours", computed every minute | | S10 |
| which rate settles | S10 says "The funding rate of each period is calculated from the data of the previous period and has been determined at the beginning of the current period." | the published `rate` changed once in 60 one second polls on `BTC-SWAP-USDT`, `ETH-SWAP-USDT` and `LSK-SWAP-USDT` in both runs, so the reply is a running estimate that moves within the period, and the last estimate before the instant is the one charged, section 6a | S10, [`rest.md`](./rest.md) section 4 |
| cap and floor | "upper limit of funding rate, lower limit of funding rate", with no number in S10. Announcements set per contract caps, for example `TRBUSDT` from "+0.75% / -0.75%" to "+2.00% / -2.00%" on 2023-12-31 | `fundingRateCap` and `fundingRateFloor` per contract, symmetric on 814 of 815 rows. The common caps were `0.02` on 575 contracts, `0.01` on 54, `0.0199996666` on 32, `0.01999999995` on 19, `0.005` on 13, `0.001` and `0.0002` on 12 each. `BTC-SWAP-USDT` read `0.0024` and `ETH-SWAP-USDT` `0.003` | S10, S11, `/api/v1/futures/fundingRate` |
| rates at the cap | | `AGG-SWAP-USDT`, `IEFA-SWAP-USDT` and `DFDVX2-SWAP-USDT` sat exactly at their `0.0002` cap at 21:34 UTC | `/api/v1/futures/fundingRate` |

### 6a. Rate across a settlement

`rest-probe.mjs settlement` read the funding reply every 5 s from 90 s before to 120 s after the 22:00 and the 23:00 settlements of the three hourly contracts, and then read each one's funding history.

| contract | last rate shown before the instant | settled, history call | first rate shown after, with the next hour |
|---|---|---|---|
| `LSK-SWAP-USDT`, 22:00 | `-0.00023909` | `-0.00023909` | `-0.00023998` |
| `G-SWAP-USDT`, 22:00 | `-0.00050083` | `-0.00050083` | `-0.00049758` |
| `LRCX-SWAP-USDT`, 22:00 | `0.00011825` | `0.00011825` | `0.00011504` |
| `LSK-SWAP-USDT`, 23:00 | `-0.00022732` | `-0.00022732` | `-0.00023336` |
| `G-SWAP-USDT`, 23:00 | `-0.00044339` | `-0.00044339` | `-0.00044194` |
| `LRCX-SWAP-USDT`, 23:00 | `0.0001769` | `0.0001769` | `0.00017874` |

The rate charged was the last estimate published before the instant on 6 of 6 settlements, so from the last recalculation before it, about 45 s before it here, the reply shows the rate that will settle.
That contradicts S10's rate "determined at the beginning of the current period", and the wire is what a reader must handle.
The reply kept showing the settled rate beside the past settlement time until about 75 s after each instant, see [`rest.md`](./rest.md) section 4.
The funding reply names the rate for the upcoming settlement, which is what `AnchorRow.fundingRate` expects, except in that window of about 75 s after each settlement.

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| liquidation fee | "No trading fees are charged during the liquidation process", page dated 2025-10-20 | Published | S13 |
| insurance fund and auto-deleveraging | margin left after a liquidation at a better price than bankruptcy "is added to the insurance fund", the fund covers a loss beyond bankruptcy, and ADL reduces opposing profitable positions when the fund is insufficient | Published | S13 |
| perpetual settlement fee | none, perpetuals do not expire | | |
| delisting charge | Not publicly specified in the pages read | Not publicly specified | |
| a past mark price incident | On 2025-05-29 "Toobit experienced a temporary mark price deviation" on PI, HYPE and XAUT perpetuals that "led to unexpected liquidations and ADL", and affected users were compensated | Published | S19 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | Probed, `ccxt.version` |
| `market.taker` on every active swap without credentials | `undefined` on 767 of 767 | Probed, `rest-probe.mjs main`, tag `ccxt_catalog` |
| `market.maker` | `undefined` on 767 of 767 | same |
| why | `parseMarket` sets no fee field, at `server/node_modules/ccxt/js/src/toobit.js` lines 950 to 1030, and the class has no `fees` block in `describe`, where the only `fees` key is the URL at line 105. `setMarkets` then merges the base default of `'taker': undefined`, at `server/node_modules/ccxt/js/src/base/Exchange.js` lines 2369 to 2374 and 3735 | CCXT |
| `fetchTradingFees` | private, reads `closeMakerFee` and `closeTakerFee` of `api/v1/futures/commissionRate` | `server/node_modules/ccxt/js/src/toobit.js` lines 2631 to 2679 |

The connector turns a missing `taker` into `null` and skips any market whose registry has no `takerPpm`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 162 to 166.
So without a registry rate every Toobit market would be dropped with the warning at line 134, "skipped 767 market(s) missing an id, a symbol, or a taker fee".
A null CCXT number is never compared, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 118 to 123, so no `ccxtTakerPpm` is needed.

## 9. Recommended registry values

```ts
toobit: {
  takerPpm: 600,
  // ccxt/js/src/toobit.js parseMarket (lines 950 to 1030) sets no fee, so market.taker is undefined and the connector would skip all 767 swaps without this rate.
  // The 10 USDC-M contracts repeat USDT-M pairs and the quote family ranks them out, so the feed need not subscribe them.
  marketFilter: (market) => market.settle === 'USDT',
}
```

`takerPpm: 600` is the published VIP 0 taker for every futures market, S1, and it applies to API orders, which the PRO tiers of S7 start only at 30,000,000 USDT of monthly volume.
`ccxtTakerPpm` stays unset, because CCXT reports no number, and the connector compares nothing when CCXT's number is missing.
A later CCXT release that starts reading a fee will produce a number the connector compares against 600, which is the watch this venue needs.
A balance of 500 USDT moves an account to VIP 1 and a 500 ppm taker, so the rate an account pays should be read from `commissionRate` before trading, see section 4.
The `marketFilter` is optional, and it keeps 757 USDT-M contracts, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Toobit trading fee structure update, dated 2026-06-26 02:24 | https://www.toobit.com/en-US/support/fee-rate | 2026-09-22, read here with `curl` | Toobit, global | futures and spot tiers, qualification, TradFi note, sections 2 to 5 |
| S2 | Toobit Terms of Use, effective 2024-07-01, page stamp 2026-06-16 08:01, read here with `curl` | https://www.toobit.com/en-US/support/toobit-terms-of-use | 2026-09-22 | Hopeful Technology Co. Ltd. and Elyndret Sp. z o.o. | entities, governing law, restricted locations, section 1 |
| S3 | Notice for Discontinuation of Services in the United States, page stamp 2025-08-01 08:13, read here with `curl` | https://www.toobit.com/en-US/announcement/notice-for-discontinuation-of-services-in-the-united-states | 2026-09-22 | Toobit, United States | United States exit, section 1 |
| S4 | Perpetual Futures: How are futures trading fees calculated, dated 2026-09-16 03:18 | https://www.toobit.com/en-US/support/perpetual-futures-how-are-futures-trading-fees-calculated | 2026-09-22 | Toobit, global | fee on filled value, VIP 0 rates and the 0.05 % example, section 2 |
| S5 | USDC Perpetual Contract Big Launch, page stamp 2025-08-01 08:09 | https://www.toobit.com/en-US/announcement/usdc-perpetual-contract-big-launch-now-live | 2026-09-22 | Toobit, global | USDC-M maker and taker, section 2 |
| S6 | Trade 30 trending futures pairs with 50% lower fees, dated 2026-09-03 09:13 | https://www.toobit.com/en-US/announcement/trade-30-trending-futures-pairs-with-50-lower-fees-26-09-03 | 2026-09-22 | Toobit, global | the promotion and its API exclusion, section 5 |
| S7 | Toobit launches pro fee tiers and Broker incentive programs for API users, dated 2025-07-04, capture of 2025-07-18 | https://web.archive.org/web/2026/https://support.toobit.com/hc/en-us/articles/48561076815129-Toobit-launches-pro-fee-tiers-and-Broker-incentive-programs-for-API-users | 2026-09-22 | Toobit, global | PRO tiers, section 5 |
| S8 | Market Maker Fee Rate, undated, capture of 2025-07-10 | https://web.archive.org/web/2025/https://support.toobit.com/hc/en-us/articles/20417690980633-Market-Maker-Fee-Rate | 2026-09-22 | Toobit, global | MM rates, section 5 |
| S9 | How Funding Fees Are Calculated in Futures Trading, dated 2026-04-01 13:04 | https://www.toobit.com/en-US/support/how-funding-fees-are-calculated-in-futures-trading | 2026-09-22 | Toobit, global | funding fee, schedule, who pays, section 6 |
| S10 | Funding Calculation, dated 2023-11-29, capture of 2025-10-06 | https://web.archive.org/web/2025/https://support.toobit.com/hc/en-us/articles/15958722800921-Funding-Calculation | 2026-09-22 | Toobit, global | funding formula, interest, depth, averaging, section 6 |
| S11 | Updates on capped funding rate of USD-M TRBUSDT perpetual contract, 2023-12-31 | https://www.toobit.com/en-US/announcement/updates-on-capped-funding-rate-of-usd-m-trbusdt-perpetual-contract-(2023-12-31) | 2026-09-22 | Toobit, global | per contract caps, section 6 |
| S12 | Toobit to Adjust Funding Rate Interval for ALPACAUSDT Perpetual Futures, 2025-04-24 | https://www.toobit.com/en-US/announcement/toobit-to-adjust-funding-rate-interval-for-alpacausdt-perpetual-futures-25-04-24 | 2026-09-22 | Toobit, global | interval changes, section 6 |
| S13 | Liquidation Mechanism, dated 2025-10-20 03:16 | https://www.toobit.com/en-US/support/liquidation-mechanism | 2026-09-22 | Toobit, global | liquidation, insurance fund, ADL, section 7 |
| S14 | A New Era of Toobit VIP with Lower Fees and Greater Benefits, dated 2026-05-25 08:02 | https://www.toobit.com/en-US/announcement/a-new-era-of-toobit-vip-with-lower-fees-and-greater-benefits | 2026-09-22 | Toobit, global | VIP 1 from 500 USDT, sections 4 and 5 |
| S15 | Newly added support for multiple contract pairs on Demo Trading, dated 2026-03-11 | https://www.toobit.com/en-US/announcement/newly-added-support-for-multiple-contract-pairs-on-demo-trading | 2026-09-22 | Toobit, global | demo trading uses virtual funds, section 3 |
| S16 | Similarities and differences between Lite Perpetual and USDT Perpetual, page stamp 2025-08-01 | https://www.toobit.com/en-US/support/similarities-and-differences-between-lite-perpetual-usdt-perpetual | 2026-09-22 | Toobit, global | shared order book, section 3 |
| S17 | CoinGecko derivatives exchanges API, entry `toobit_derivatives` | https://api.coingecko.com/api/v3/derivatives/exchanges | 2026-09-22 | CoinGecko | pair count, open interest, volume, section 3 |
| S18 | Toobit API, USDT-M Account and Trading, User Trade Fee Rate | https://api-docs.toobit.com/api/usdt-m-account-and-trading.html | 2026-09-22, read here with `curl` | Toobit, global | `commissionRate` fields, section 4 |
| S19 | Official Statement: Mark Price Deviation and Liquidation Review, page stamp 2025-08-01 08:19 | https://www.toobit.com/en-US/announcement/official-statement-mark-price-deviation-and-liquidation-review | 2026-09-22 | Toobit, global | the 2025-05-29 incident, section 7 |
