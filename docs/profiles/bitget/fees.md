# Bitget Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

## 1. Scope and freshness

Every source was read on 2026-09-15, and every probe ran on 2026-09-15 between 06:57 and 08:03 UTC.
The second pass reread every source and reran every probe section on 2026-09-15 between 18:52 and 19:20 UTC.
This profile covers perpetual trading only, which is the product the engine crosses.
Spot, margin, deposit and withdrawal fees are listed on the official [Fee Schedule](https://www.bitget.com/fee), which is client rendered and returned no table to a plain request.

The platform is operated by BTG Technology Holdings Limited under the [Terms of Use](https://www.bitget.com/support/articles/360014944032-terms-of-use), which read "Last updated: September 15, 2026" in the second pass.
The same terms list the Prohibited Countries.
They include the United States with its territories and minor outlying islands, Canada, Austria, France, Germany, Hong Kong, Japan, Kazakhstan, Malaysia, Singapore, Thailand, Iran, North Korea, Cuba, Crimea, Donetsk, Luhansk, Sudan, Iraq, Libya, Yemen, Afghanistan, the Central African Republic, the Democratic Republic of the Congo, Guinea-Bissau, Haiti, Lebanon, Somalia and South Sudan.
A United States person, which includes an operator on this development host, may not open an account or trade the perpetuals.
The terms also forbid using a VPN to get around the restriction.
Bitget lists regional licences and registrations on its [regulatory licence page](https://www.bitget.com/promotion/regulatory-license), for Australia, El Salvador, the United Kingdom, Georgia, Argentina, Mexico and Switzerland.
None of those pages names a separate perpetual fee schedule, so the global schedule below is the only one this research found.

The labels of the July package apply, plus `Probed` from [`../../plans/2026-09-15-five-venue-research-design.md`](../../plans/2026-09-15-five-venue-research-design.md).

| Label | Meaning |
| --- | --- |
| Published | Bitget publishes the number or the rule on an official page. |
| Dynamic | Bitget computes the value at request time. |
| Account-gated | The value applies only to an eligible, signed-in account. |
| Negotiated | The value depends on an institutional or market maker agreement. |
| Not publicly specified | No official public number was found. |
| Probed | A script under [`../../../scripts/probes/`](../../../scripts/probes/) observed it from this host on 2026-09-15. |

## 2. Quick answer

The VIP 0 perpetual fee is the same for all three families.

| family | CCXT settle | maker | taker | evidence |
| --- | --- | --- | --- | --- |
| USDT-M perpetual, `USDT-FUTURES` | USDT | 0.0200 % = 200 ppm | 0.0600 % = 600 ppm | Published, Probed |
| USDC-M perpetual, `USDC-FUTURES` | USDC | 0.0200 % = 200 ppm | 0.0600 % = 600 ppm | Published, Probed |
| Coin-M perpetual, `COIN-FUTURES` | the base coin | 0.0200 % = 200 ppm | 0.0600 % = 600 ppm | Published, Probed |

Published: the [Trading Fees FAQ](https://www.bitget.com/support/articles/12560603892734) of 2026-08-20 says "a standard futures trading fee of 0.02% for makers and 0.06% for takers".
The [VIP system upgrade announcement](https://www.bitget.com/support/articles/12560603830277) of 2025-06-25 lists VIP0 futures at 0.0200 % maker and 0.0600 % taker.
Probed: the public contracts call returned `makerFeeRate` `0.0002` and `takerFeeRate` `0.0006` on every one of 786 USDT-M, 49 USDC-M and 11 Coin-M contracts, including the 320 stock, metal and other TradFi perpetuals flagged `isRwa` `YES`.

```text
GET https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES
786 rows: takerFeeRate "0.0006" on 786, makerFeeRate "0.0002" on 786
GET .../contracts?productType=USDC-FUTURES   49 rows: 0.0002 / 0.0006 on 49
GET .../contracts?productType=COIN-FUTURES   11 rows: 0.0002 / 0.0006 on 11
```

The second pass at 18:54 UTC read 787 USDT-M rows, 321 of them `isRwa` `YES`, and 49 USDC-M and 11 Coin-M rows, all at `0.0002` and `0.0006`.
These fields are public and carry no account context, so they are the base rate and not a proof of any one account's rate.

## 3. Coverage matrix

| product | present | notes |
| --- | --- | --- |
| USDT-M perpetual | Yes | 786 active at 07:11 UTC on 2026-09-15, Probed. 466 crypto and 320 flagged `isRwa` `YES`. The second pass at 18:53 UTC read 787, with 321 flagged. |
| USDC-M perpetual | Yes | 49 active, Probed. Market ids end in `PERP`, as in `BTCPERP`. |
| Coin-M perpetual | Yes | 9 perpetuals on the classic API, Probed. The unified account API lists 20 under other ids, see [`rest.md`](./rest.md) section 2. |
| Coin-M dated futures | Yes | `BTCUSDU26` and `ETHUSDU26` on the classic API, Probed. Not detailed. |
| Demo products | Yes | `SUSDT-FUTURES`, `SUSDC-FUTURES` and `SCOIN-FUTURES` hold 7 perpetuals and 2 dated futures, Probed. Bitget titles the `SBTCSUSDT` market page "Futures Trading Simulator", and its [demo trading article](https://www.bitget.com/support/articles/12560603790031) says demo funds are virtual. See section 8. |
| Options | No | CCXT reports `has.option` false at `server/node_modules/ccxt/js/src/bitget.js:34`, and no options product type appears in the docs read. |
| Spot | Yes | Out of scope, see the Fee Schedule. |

## 4. Every published perpetual tier

### Regular VIP tiers

Published in the [VIP system upgrade announcement](https://www.bitget.com/support/articles/12560603830277), effective 2025-07-01.
Probed: the public `GET /api/v2/mix/market/vip-fee-rate` returned the same seven futures rows on 2026-09-15, and it returns no VIP0 row.

| level | 30-day futures volume, USDT | today's asset balance, USDT | 30-day average daily asset balance, USDT | maker | taker |
| --- | --- | --- | --- | --- | --- |
| VIP0 | ≥ 0 | ≥ 0 | ≥ 0 | 0.0200 % = 200 ppm | 0.0600 % = 600 ppm |
| VIP1 | ≥ 5,000,000 | ≥ 30,000 | ≥ 30,000 | 0.0190 % = 190 ppm | 0.0600 % = 600 ppm |
| VIP2 | ≥ 10,000,000 | ≥ 50,000 | ≥ 50,000 | 0.0160 % = 160 ppm | 0.0400 % = 400 ppm |
| VIP3 | ≥ 20,000,000 | ≥ 250,000 | ≥ 250,000 | 0.0140 % = 140 ppm | 0.0375 % = 375 ppm |
| VIP4 | ≥ 50,000,000 | ≥ 750,000 | ≥ 750,000 | 0.0120 % = 120 ppm | 0.0350 % = 350 ppm |
| VIP5 | ≥ 100,000,000 | ≥ 2,000,000 | ≥ 2,000,000 | 0.0100 % = 100 ppm | 0.0320 % = 320 ppm |
| VIP6 | ≥ 300,000,000 and API volume ≤ 20 % | ≥ 5,000,000 | ≥ 5,000,000 | 0.0080 % = 80 ppm | 0.0300 % = 300 ppm |
| VIP7 | ≥ 1,000,000,000 and API volume ≤ 20 % | ≥ 10,000,000 | ≥ 10,000,000 | 0.0000 % = 0 ppm | 0.0200 % = 200 ppm |

```json
{"level":"1","dealAmount":"5000000","assetAmount":"30000","takerFeeRate":"0.0006","makerFeeRate":"0.00019","btcWithdrawAmount":"300","usdtWithdrawAmount":"4000000"}
```

The announcement also lists 30-day spot volume thresholds, from 500,000 USDT at VIP1 to 100,000,000 USDT at VIP7.
Its 30-day average daily BGB balance column reads "Calculated based on the formula, dynamically adjusted every two weeks", so the BGB thresholds are Not publicly specified as static numbers.
Qualification rule: the [VIP program article](https://www.bitget.com/support/articles/12560603814485) says users become VIP "by meeting either the monthly trading volume or asset balance requirements".
The announcement does not restate whether one column is enough, so the "any one column" reading rests on that older article of 2024-08-20.
The engine's VIP0 rate needs no qualification, so this ambiguity does not change a registry value.

### PRO and market maker tiers

These are Account-gated and Negotiated.
The [PRO fee grouping update](https://www.bitget.com/support/articles/12560603885903) of 2026-06-16 splits futures into Group A (19 named top pairs), Group B (other crypto) and Group C (all TradFi futures), effective 2026-06-30.
Probed: the public `GET /api/v3/market/fee-group?category=FUTURES` returned these rates.

| tier | Group A taker | Group B taker | Group C taker | maker, all groups |
| --- | --- | --- | --- | --- |
| PRO1 | 0.028 % = 280 ppm | 0.028 % = 280 ppm | 0.012 % = 120 ppm | 0.008 % = 80 ppm |
| PRO6 | 0.015 % = 150 ppm | 0.020 % = 200 ppm | 0.0065 % = 65 ppm | 0 ppm |
| MM1 | no taker row | no taker row | no taker row | −0.005 % in A and C, −0.010 % in B |

PRO2 to PRO5 sit between the two rows above in the same reply.
The PRO qualification rule sits in a PRO launch announcement that this research did not read, so it is Not verified here.

## 5. Discounts that change the perpetual taker

| discount | applies to the perpetual taker | end date | evidence |
| --- | --- | --- | --- |
| BGB holding | Only through the VIP level, via the 30-day average BGB balance column | open-ended | [VIP system upgrade announcement](https://www.bitget.com/support/articles/12560603830277) |
| Paying fees in BGB | Not publicly specified for futures. The FAQ describes the BGB payment discount for spot only. | open-ended | [Trading Fees FAQ](https://www.bitget.com/support/articles/12560603892734) |
| Stock futures at 0.0065 % maker and taker for all users | No longer. The first announcement gives 2025-11-06 20:00 to 2026-01-31 23:59:59 UTC+8. The extension gives the start as 2025-11-05 21:30 UTC+8 and the end as 2026-04-30 23:59:59 UTC+8. | ended 2026-04-30 | [first announcement](https://www.bitget.com/support/articles/12560603841861), [extension](https://www.bitget.com/support/articles/12560603847507) |
| TradFi futures taker at 0.0065 % for futures market makers | No longer, market makers only | ran 2026-05-01 to 2026-06-30 | [institutional announcement](https://www.bitget.com/support/articles/12560603883365) |
| All TradFi futures fee promotions | Ended, TradFi futures moved to Group C | ended 2026-06-30 | [PRO fee grouping update](https://www.bitget.com/support/articles/12560603885903) |
| PRO fee discount trial | PRO users only, trial tiers PRO5 and PRO6 | 2026-10-31 23:59 UTC+8 | [PRO trial program](https://www.bitget.com/support/articles/12560603890844) |
| Referral rebates | Not publicly specified in the sources read | | |

Probed: on 2026-09-15 all 320 TradFi perpetuals carried `takerFeeRate` `0.0006` in the contracts reply, which agrees with every promotion above having ended for regular accounts.

## 6. Funding as a cost

Published in [What Is the Funding Rate in Bitget Futures Trading?](https://www.bitget.com/support/articles/12560603817108), which shows the date 2024-10-22.

```text
F = clamp( [P + clamp(I - P, -0.05%, 0.05%)] / (8 / N), min funding rate, max funding rate )
I = 0.01 % (interest rate index)
N = settlement interval in hours
P = weighted average of the premium index, sampled every 5 s, later samples weighted more
premium index = [max(0, impact bid - index) - max(0, index - impact ask)] / index
impact notional = 200 USDT x maximum leverage
funding fee = position size x mark price x funding rate
```

- Direction: a positive rate means longs pay shorts, and a negative rate means shorts pay longs.
- Counterparty: the fee moves between position holders, and Bitget says it charges no funding service fee.
- Who is charged: only positions held at the settlement time pay or receive.
- Cap and floor: the article gives 0.75 times the maintenance margin rate as the default, adjustable.
  The live value per symbol is `maxFundingRate` and `minFundingRate` in the current funding rate reply.
- Probed caps at 07:11 UTC on 2026-09-15: 0.3 % on BTCUSDT, ETHUSDT and XRPUSDT, 2 % on 293 USDT-M rows, 1 % on 210, 0.5 % on 108, and 17 other values between 0.33 % and 2.1 %.
  Every cap was symmetric.
  No row sat at its cap.
- The second pass at 18:53 UTC read a different spread: 1 % on 312 rows, 2 % on 292, 1.875 % on 82, 1.32 % on 36, 1.8 % on 16, 1.5 % on 15, 0.5 % on 8, 0.495 % on 7, 0.3 % on the same three symbols, 10 other values between 0.33 % and 2.1 %, and 12 pre-listing and test rows with no cap.
  Every cap was again symmetric and no row sat at its cap.
  Caps are Dynamic per symbol, and the poller must read them every round.
- Stock perpetuals: the [stock perps cap announcement](https://www.bitget.com/support/articles/12560603887187) sets the base interest rate to 0 % and moved their cap from 0.1 % to 0.5 % on 2026-06-23 16:00 UTC+8.
  Probed caps on the 320 TradFi rows at 07:11 UTC were 0.5 % on 108, 1 % on 209, 2 % on 2 and 0.75 % on 1.
  On the 321 TradFi rows at 18:53 UTC they were 1 % on 311, 0.5 % on 8, 2 % on 1 and 0.75 % on 1.
  So later changes exist that this research did not read.
- Intervals: the API reference describes the interval in hours, "1 represents 1 hour, 2 represents 2 hours, and so on".
  Probed in use on USDT-M at 07:11 UTC: 1 h on 5 contracts, 4 h on 382 and 8 h on 411.
  At 18:53 UTC: 1 h on 4, 4 h on 383 and 8 h on 412.
  USDC-M: 4 h on 17 and 8 h on 33 in both reads.
  Coin-M: 8 h on all.
- Settlement instants: the article gives 8:00 AM, 4:00 PM and 12:00 AM UTC+8 for 8 hour contracts, which is 00:00, 08:00 and 16:00 UTC.
  Probed at 07:11 UTC: every one of 798 USDT-M rows read `nextUpdate` `1789459200000`, 2026-09-15 08:00 UTC, because 08:00 UTC is a boundary of the 1, 4 and 8 hour grids at once.
  Probed at 18:53 UTC: the 1 hour rows read 19:00 UTC, the 4 hour rows 20:00 UTC and the 8 hour rows 00:00 UTC, so each row carries its own interval's next instant.
- Interval changes: Bitget announces them per symbol, for example [RAVEUSDT from 4 hours to 1 hour](https://www.bitget.com/support/articles/12560603882535) at 2026-04-12 21:00 UTC, and [20 symbols together](https://www.bitget.com/support/articles/12560603859261) on 2026-02-28.

The engine models a taker cross that crosses no settlement, so funding is a reading for it rather than a cost.
The rate semantics the poller needs are in [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting charges

- Liquidation: the [Futures Services Agreement](https://www.bitget.com/support/articles/7700532076057), last updated 2026-08-14, says "a liquidation clearance fee (amount to be determined by Bitget) will be charged on the amount liquidated".
- The [liquidation and collateral shortfall article](https://www.bitget.com/support/articles/12560603813276) of 2025-12-16 uses "The liquidation fee rate is set at 0.0006" in its worst-case price formula, which is 0.06 % = 600 ppm.
- A bankrupt account's remaining positions may be taken over by Bitget, per the same agreement.
- Perpetual settlement: no settlement charge other than funding was found.
  Not publicly specified.
- Delisting: the agreement lets Bitget delist a pair at any time without notice.
  No delisting charge was found.
  Not publicly specified.

## 8. CCXT

CCXT 4.5.68 loads the catalog through the classic v2 API unless the instance has credentials that belong to a unified account.

- `fetchMarkets` asks `handleUTAAndParams` at `server/node_modules/ccxt/js/src/bitget.js:1990`, which returns its default `false` when no credentials are set, at `bitget.js:1929` to `:1948`.
- `fetchDefaultMarkets` then calls `GET /api/v2/mix/market/contracts` once per product type, including the three demo types, at `bitget.js:2012`.
- `market.taker` is the per market `takerFeeRate` field of that reply, at `bitget.js:2223`.
- The constant `fees.swap.taker` of `0.0006` at `bitget.js:937` is not merged into markets, because `setMarkets` merges only `fees.trading`, at `server/node_modules/ccxt/js/src/base/Exchange.js:3735`.

Probed with credentials unset: `market.taker` read `0.0006` on all 851 active swap markets, which is 600 ppm and equals the published VIP0 taker.
The second pass at 18:52 UTC loaded 2,617 markets and 852 active swaps, all at `0.0006`, one new USDT-M listing later.

```text
ccxt 4.5.68 bitget loadMarkets: 2616 markets, 851 active swaps
taker { '0.0006': 851 }
BTCUSDT  BTC/USDT:USDT  taker 0.0006 maker 0.0002
BTCPERP  BTC/USDC:USDC  taker 0.0006 maker 0.0002
BTCUSD   BTC/USD:BTC    taker 0.0006 maker 0.0002
```

The 851 include 7 demo markets, `SBTCSUSDT`, `SETHSUSDT`, `SXRPSUSDT`, `SBTCSUSD`, `SETHSUSD`, `SBTCSPERP` and `SETHSPERP`.
They carry the same fee fields and are not real liquidity.

## 9. Recommended registry values

These are recommendations for a later design, not decisions.

| key | value | reason |
| --- | --- | --- |
| `takerPpm` | `600` | The published VIP0 perpetual taker for all three families, and the rate on every contract row on 2026-09-15. |
| `ccxtTakerPpm` | omit | CCXT reports a real per market wire value, 600 on every market today. With `takerPpm` at 600 and no `ccxtTakerPpm`, the connector warns as soon as Bitget changes any contract's `takerFeeRate`, which is the watch this venue should have. |

A registry comment could cite `ccxt/js/src/bitget.js:2223` for the per market field and `:937` for the unused constant.

## 10. Source ledger

| title | URL | retrieved | entity or region | supports |
| --- | --- | --- | --- | --- |
| Terms of Use | https://www.bitget.com/support/articles/360014944032-terms-of-use | 2026-09-15 | BTG Technology Holdings Limited, global | 1 |
| Bitget global regulatory compliance roadmap | https://www.bitget.com/promotion/regulatory-license | 2026-09-15 | Global | 1 |
| Bitget Trading Fees FAQ | https://www.bitget.com/support/articles/12560603892734 | 2026-09-15 | Global | 2, 5 |
| Bitget Product Fees FAQ | https://www.bitget.com/support/articles/12560603892733 | 2026-09-15 | Global | 2 |
| Bitget Beginner's Guide, Understanding Futures Fees | https://www.bitget.com/support/articles/12560603817155 | 2026-09-15 | Global | 2, 6 |
| Bitget VIP system upgrade announcement | https://www.bitget.com/support/articles/12560603830277 | 2026-09-15 | Global | 2, 4, 5 |
| What is the Bitget VIP Program | https://www.bitget.com/support/articles/12560603814485 | 2026-09-15 | Global | 4 |
| Classic Contract Market API, VIP Fee Rate and Get Contract Config | https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market | 2026-09-15 | Global API | 2, 4 |
| Market API, Get Institution Fee Group | https://www.bitget.com/docs/catalog/market/public-config | 2026-09-15 | Global API | 4 |
| Bitget Liquidity Incentive Program and Bitget PRO Fee Grouping Updates | https://www.bitget.com/support/articles/12560603885903 | 2026-09-15 | Global, institutional | 4, 5 |
| 2026 Bitget PRO Fee Discount Trial Program | https://www.bitget.com/support/articles/12560603890844 | 2026-09-15 | Global, institutional | 5 |
| The transaction fees for Bitget stock futures will be adjusted to 0.0065% | https://www.bitget.com/support/articles/12560603841861 | 2026-09-15 | Global | 5 |
| 90% fee discount on stock futures extended to April 30 | https://www.bitget.com/support/articles/12560603847507 | 2026-09-15 | Global | 5 |
| Exclusive for Institutions, Taker Fees for Stock, Metal, Commodity, and Index Futures | https://www.bitget.com/support/articles/12560603883365 | 2026-09-15 | Global, market makers | 5 |
| What Is the Funding Rate in Bitget Futures Trading? | https://www.bitget.com/support/articles/12560603817108 | 2026-09-15 | Global | 6 |
| The funding rate cap for stock perps will be adjusted from 0.1% to 0.5% | https://www.bitget.com/support/articles/12560603887187 | 2026-09-15 | Global | 6 |
| Bitget to adjust funding rate interval for RAVEUSDT perpetual futures | https://www.bitget.com/support/articles/12560603882535 | 2026-09-15 | Global | 6 |
| Bitget to adjust funding rate interval and maximum/minimum limits for selected perpetual futures | https://www.bitget.com/support/articles/12560603859261 | 2026-09-15 | Global | 6 |
| Futures Services Agreement | https://www.bitget.com/support/articles/7700532076057 | 2026-09-15 | Global | 7 |
| Bitget Futures, Understanding Liquidation and Collateral Shortfall Risk Management | https://www.bitget.com/support/articles/12560603813276 | 2026-09-15 | Global | 7 |
| What Is Demo Trading on Bitget Futures? | https://www.bitget.com/support/articles/12560603790031 | 2026-09-15 | Global | 3 |
| SBTCSUSDT market page, title "Futures Trading Simulator" | https://www.bitget.com/futures/susdt/SBTCSUSDT | 2026-09-15 | Global | 3 |
| Probe script, fees, catalog and funding caps | [`../../../scripts/probes/bitget-rest-probe.mjs`](../../../scripts/probes/bitget-rest-probe.mjs) | 2026-09-15 | this host | 2, 3, 6, 8 |
