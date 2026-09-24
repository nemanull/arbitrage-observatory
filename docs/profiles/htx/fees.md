# HTX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, from the development host near Seattle, 03:08 to 03:46 UTC on 2026-09-23.

This profile covers the trading fees of HTX (formerly Huobi, CCXT id `htx`) on its perpetual futures, the USDT-margined family in detail and the coin-margined family where it differs.
The engine models a taker cross at the base retail tier, so the Prime 0 taker is the number that matters.
HTX's own fee page is rendered in the browser and its futures table could not be read from this host, see section 1, so the Prime 0 numbers rest on an HTX help article and a third party table that agree.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 | |
| operator | "HTX Operators", defined as "all parties that run the Platform, including but not limited to legal persons, Decentralized Autonomous Organizations (DAO), unincorporated organizations and teams". No legal entity is named | S4 |
| futures terms | "Appendix 2: HTX Futures Services Agreement" of the same User Agreement | S4 |
| disputes | arbitration administered by the Hong Kong International Arbitration Centre, seat Hong Kong | S4 |
| restricted jurisdictions | "MAINLAND CHINA, THE UNITED STATES OF AMERICA, CUBA, IRAN, NORTH KOREA, SUDAN, SYRIA, VENEZUELA, HONG KONG CHINA, THE UNITED KINGDOM, SINGAPORE , MYANMAR, CRIMEA, DONETSK, LUHANSK, SEVASTOPOL AND ALL MEMBER STATE OF THE EUROPEAN UNION (EU)" are "PROHIBITED FROM USING ALL SERVICES" | S4, clause 1.2 |
| US persons | may not trade, since the United States is on the restricted list | S4 |
| agreement date | the article's description opens with `2026-06-18` | S4 |
| public API from this host | every REST call and every WebSocket URL used here answered, with no geoblock, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | P1, P3 |

The fee page `https://www.htx.com/fee/` answered 200 with a 19,263 byte shell to curl, and a single headless Chrome render of 25 s produced 58,268 bytes whose embedded state held an empty `linearLevel: []`.
The public web call behind the spot table, `https://www.htx.com/-/x/hbg/v1/fee/fee-rate?businessType=trading`, answered 200, and `businessType` values `contract`, `swap` and `linear-swap` answered code 2002 `invalid field value in businessType`.
So no HTX page reachable here states the current futures schedule, and the numbers below carry that caveat.

## 2. Quick answer

| family | Prime 0 maker | Prime 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S2 example "Take Prime 0 for example", and the S3 table |
| coin-M perpetuals | 0.02 %, 200 ppm | 0.05 %, 500 ppm | S3 only |

S2 is HTX's own article, and it gives "Maker - 0.02%" and "Taker - 0.06%" as the Prime 0 rates to open and to close.
It also says "The fee rates above are for illustration only. Please refer to your actual fee tier in My Fees."
S3 is a third party table dated "Last Updated: May 14, 2026" and labelled "HTX futures trading fees (2025)", and its USDT-M Prime 0 row is `0.0200% / 0.0600%`.
CCXT reports 0.05 % for every swap, see section 8, which is the coin-M number of S3 and not the USDT-M one.

## 3. Coverage matrix

Counts are from `rest-probe.mjs catalog` at 03:23 UTC on 2026-09-23 through CCXT 4.5.68, P1.

| product | present | active count | note |
|---|---|---|---|
| USDT-M perpetuals | yes | 353 | 130 crypto and 223 TradFi: 179 labelled Stocks, 27 Stocks and Indices, 7 Metals, 7 Indices, 3 Commodities, by the `tradfi_labels` field of `swap_contract_info`. 4 more are suspended with `contract_status` 3 |
| coin-M perpetuals | yes | 5 | `BTC-USD`, `ETH-USD`, `XRP-USD`, `TRX-USD`, `DOGE-USD` |
| USDC-M perpetuals | no | 0 | every linear contract has `trade_partition` `USDT` |
| USDT-M dated futures | yes | 4 | BTC and ETH, `this_week` and `next_week` |
| coin-M dated futures | yes | 8 | BTC and ETH weekly, bi-weekly and quarterly, TRX weekly and bi-weekly |
| options | no | 0 | CCXT sets `option: false` on every market, and `/heartbeat/` still carries an `option_heartbeat` field |
| spot | yes | 605 | 1,560 more spot symbols are listed and not `online` |

CoinGecko's derivatives list of 2026-09-22 shows 366 perpetual pairs for HTX Futures, against 353 plus 5 active and 4 suspended here.

## 4. Perpetual tiers

HTX calls its tiers Prime 0 to Prime 11.
The table is S3, a third party, because no HTX page reachable from this host carried it, see section 1.
Its Prime 0 USDT-M row matches S2, and its Prime 3 USDT-M taker of 0.0450 % matches the Prime 3 example in S6, whose maker of 0.01 % does not match the 0.0140 % below.

| tier | USDT-M maker | USDT-M taker | coin-M maker | coin-M taker |
|---|---:|---:|---:|---:|
| Prime 0 | 0.0200 % | 0.0600 % | 0.0200 % | 0.0500 % |
| Prime 1 | 0.0180 % | 0.0550 % | 0.0150 % | 0.0450 % |
| Prime 2 | 0.0160 % | 0.0500 % | 0.0120 % | 0.0450 % |
| Prime 3 | 0.0140 % | 0.0450 % | 0.0090 % | 0.0420 % |
| Prime 4 | 0.0120 % | 0.0400 % | 0.0060 % | 0.0400 % |
| Prime 5 | 0.0100 % | 0.0300 % | 0.0030 % | 0.0360 % |
| Prime 6 | 0.0060 % | 0.0295 % | 0.0000 % | 0.0350 % |
| Prime 7 | 0.0040 % | 0.0285 % | -0.0020 % | 0.0330 % |
| Prime 8 | 0.0020 % | 0.0280 % | -0.0030 % | 0.0320 % |
| Prime 9 | 0.0010 % | 0.0275 % | -0.0040 % | 0.0300 % |
| Prime 10 | 0.0005 % | 0.0265 % | -0.0050 % | 0.0285 % |
| Prime 11 | 0.0000 % | 0.0250 % | -0.0080 % | 0.0270 % |

### Qualification

S3 says any one of four criteria qualifies, and gives these thresholds.

| tier | 30 day spot volume, USDT | 30 day futures volume, USDT | previous day total assets, USDT | previous day HTX token assets, USDT |
|---|---:|---:|---:|---:|
| Prime 0 | < 30,000 | < 300,000 | < 5,000 | < 1,000 |
| Prime 1 | ≥ 30,000 | ≥ 300,000 | ≥ 5,000 | ≥ 1,000 |
| Prime 2 | ≥ 120,000 | ≥ 5,000,000 | ≥ 20,000 | ≥ 4,000 |
| Prime 3 | ≥ 600,000 | ≥ 10,000,000 | ≥ 45,000 | ≥ 12,000 |
| Prime 5 | ≥ 12,000,000 | ≥ 100,000,000 | ≥ 95,000 | ≥ 30,000 |
| Prime 11 | ≥ 1,800,000,000 | ≥ 3,000,000,000 | not eligible | not eligible |

HTX's own statement on rates, S7, says the 30 day volume is summed at 00:00 GMT+8 over all main and sub accounts, and that HTX tokens count at 1.5 times their market value toward the asset criterion.

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | source |
|---|---|---|
| TRX fee deduction | "an additional 5% discount" on futures fees when the toggle is on and TRX covers the fee, launched 2024-03-08 03:00 UTC | S6 |
| HTX token holding | S3 says "having any amount of the exchange's official token comes with a 25% discount on spot and futures trading fees". No HTX page reachable here confirms it for futures | S3 |
| referral | CCXT's `urls.referral` carries `discount: 0.15`, at `server/node_modules/ccxt/js/src/htx.js` lines 192 to 195. S3 describes a 30 % commission to the referrer, not a discount to the trader | S10, S3 |
| market maker programme | a separate schedule in basis points, updated 2023-02-01 06:00 UTC | S8 |
| zero fee promotions | none found in the HTX pages read for this profile | |

None of these apply to an unauthenticated account at Prime 0, so the engine's number is the undiscounted taker.

## 6. Funding as a cost

From the HTX article "Funding Calculation", S5, and the wire, P2.

| item | value |
|---|---|
| interval | 8 h, 4 h or 1 h per contract, in `settlement_period` of `swap_contract_info`. On 2026-09-23 the 357 USDT-M swaps listed read 248 at 8 h, 93 at 4 h and 16 at 1 h, and the 130 active crypto swaps read 67, 56 and 7 |
| premium index | `[Max(0, Impact bid price - Index price) - Max(0, Index price - Impact ask price)] / Index price`, every 5 s, over an impact notional of 25,000 USDT for BTC and ETH down to 2,000 USDT for new listings |
| average premium | time weighted, `(P1 * 1 + P2 * 2 + ... + Pn * n) / (1 + 2 + ... + n)`, with 5,760 readings in 8 h |
| rate | `clamp{[Average premium index + clamp(0.01% - Average premium index, Premium deviation cap, Premium deviation floor)] / (8/N), Funding rate cap, Funding rate floor}`, where N is the interval in hours |
| cap and floor, documented | BTC premium deviation cap and floor ±0.05 %, funding rate cap and floor ±0.375 % |
| cap and floor, on the wire | `/v5/market/funding_rate` read `max_funding_rate` 0.003 for BTC, 0.004875 for DOGE, 0.005 for XAU and 0.02 for LSK, STEEM and NVDA, so the live BTC cap is ±0.3 % against the article's ±0.375 % |
| who pays | longs pay shorts when the rate is positive. "Funding fees are settled between the users, and the platform does not take any fees from them." |
| settlement price | "Funding fees are settled at the index price." |
| when | only positions open at the settlement instant pay or receive. BTC settles at 00:00, 08:00 and 16:00 UTC |
| waiver | "For users with low margin ratios, the system may partially or fully waive their funding fee to prevent forced liquidation." |
| published rate | the live rate of the current period, which "may fluctuate until the funding payment deadline", see [`rest.md`](./rest.md) section 4 |

The settlement instant itself was not captured, and the funding history endpoint is what this section relies on for settled rates.
For BTC the settled rate at 00:00 UTC on 2026-09-23 was 0.0000087, while the live rate read about 0.000066 at 03:33 UTC, P2.

## 7. Liquidation, settlement and delisting

The USDT-M system upgrade that ran from April 2026 to a migration deadline of 2026-09-19 16:00 UTC made liquidation trigger only on the maintenance margin ratio computed from the mark price reaching 100 %, and it adds the taker fee rate of the user's Prime level to every maintenance margin term, S9.
A liquidation fee, a delivery fee for dated futures and a delisting settlement rule were not found in any HTX page reachable here, and they stay Not verified.
The official lookup is the contract details page of each contract on the HTX futures site.
A delisted contract keeps a frozen row in `swap_index`, see [`rest.md`](./rest.md) section 2.

## 8. CCXT

| field | value | line |
|---|---|---|
| `market.taker` on every swap and future | `0.0005`, 500 ppm | `server/node_modules/ccxt/js/src/htx.js` line 1979 |
| `market.maker` on every swap and future | `0.0002`, 200 ppm | same file, line 1978 |
| `market.taker` and `maker` on spot | `0.002` | same file, lines 1970 and 1971 |
| `fees.trading` | `tierBased: false`, maker and taker `0.002` | same file, lines 794 to 797 |

`rest-probe.mjs catalog` read `taker` 0.0005 and `maker` 0.0002 on all 358 active swaps without credentials, P1.
The constant is 100 ppm below the USDT-M Prime 0 taker of section 2.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the USDT-M Prime 0 taker in S2 and S3, and the engine trades the USDT-M family |
| `ccxtTakerPpm` | 500 | the constant at `htx.js` line 1979, so the connector's check expects it and does not warn on every market |

If a later reading of the live fee page shows a different Prime 0 taker, that reading replaces 600.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | HTX fee page | https://www.htx.com/fee/ | 2026-09-22 | HTX, global | section 1, not readable for futures |
| S2 | USDT-Margined Futures Trading Fees: Definition and Calculation, published 2020-10-26 | https://www.htx.com/support/900000089923 | 2026-09-22 | HTX, global | Prime 0 example, sections 2 and 4 |
| S3 | HTX Fees (2026): An In-Depth Overview + Explanations, BitDegree, last updated 2026-05-14 | https://www.bitdegree.org/crypto/tutorials/htx-fees | 2026-09-22 | third party | tier table, qualification, HTX token discount, sections 2, 4 and 5 |
| S4 | HTX Platform User Agreement, description dated 2026-06-18 | https://www.htx.com/support/en-us/detail/360000298561 | 2026-09-22 | HTX Operators | operator, restricted jurisdictions, arbitration, section 1 |
| S5 | Funding Calculation, published 2024-04-29 | https://www.htx.com/support/900001326466 | 2026-09-22 | HTX, USDT-M | funding formula, impact notional, cap example, waiver, section 6 |
| S6 | HTX to Launch the TRX Deduction of Trading Fees and Loan Interest, published 2024-03-07 | https://www.htx.com/support/74964031768198 | 2026-09-22 | HTX, global | TRX discount and Prime 3 example, sections 4 and 5 |
| S7 | HTX statement on rates, public web call | https://www.htx.com/-/x/hbg/v1/equity/level/intro | 2026-09-22 | HTX, global | qualification rules, section 4 |
| S8 | HTX to Update Assessment Mechanism and Fee Rates for Market Makers, published 2023-01-20 | https://www.htx.com/support/94928520943856 | 2026-09-22 | HTX, global | market maker schedule, section 5 |
| S9 | HTX's USDT-M Futures Trading System Upgrade and the Migration Deadline, published 2026-09-03, and Announcement Regarding the Upgrade and Migration of the HTX USDT-M Futures Trading System, published 2026-04-03 | https://www.htx.com/support/65042754281336 and https://www.htx.com/support/55029524265440 | 2026-09-22 | HTX, USDT-M | liquidation rule change, section 7 |
| S10 | CCXT 4.5.68 `htx.js` | `server/node_modules/ccxt/js/src/htx.js` | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs catalog`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 8 |
| P2 | `rest-probe.mjs funding`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
| P3 | `ws-probe.mjs book` and `extras` | [`ws-probe.mjs`](../../../scripts/probes/venues/htx/ws-probe.mjs) | 2026-09-23 UTC | this host | section 1 |
