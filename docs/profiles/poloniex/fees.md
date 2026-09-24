# Poloniex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, which was 2026-09-23 03:18 to 03:44 UTC, from the development host near Seattle.

This profile covers the USDT-margined perpetuals of Poloniex Futures v3 (CCXT id `poloniex`), the venue's only perpetual family.
Spot is named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/poloniex/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/poloniex/ws-probe.mjs).
CoinGecko's derivatives list of 2026-09-22 does not show Poloniex, and the venue does list 18 perpetuals, see section 3.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entity | The user agreement says "Polo" is "the relevant Polo group entity which is providing the Services", chosen by Country of Residence, and names Polo Digital Assets Inc. only as the GDPR representative. CoinGecko lists the exchange's country as Seychelles. | Region-specific | S8, S13 |
| restricted territories | "Afghanistan, Burma, Singapore, the Chinese Mainland, Hong Kong China, Crimea, Cuba, the United Kingdom, Democratic Republic of Congo, Iran, Iraq, Ivory Coast, Libya, Mali, North Korea, Palestine, Somalia, Sudan, Syrian Arab Republic, Yemen, Zimbabwe, Lugansk, Donetsk, all member states of the European Union (EU), the United States and all US Territories", section 39 of the agreement last revised 2026-04-01 | Published | S8 |
| futures only | "you may not use the Services to trade in Margin and Futures if you are a resident, national or agent of Burundi and Morocco" | Published | S8, and the "Prohibited Countries for Futures" list of S7 |
| who may trade the perpetuals | An account holder outside the restricted territories and outside Burundi and Morocco. A citizen or resident of the United States may not. | Region-specific | S7, S8 |
| enforcement | "users from these countries are blocked at the IP level" | Published | S7 |
| public API from this host | `api.poloniex.com` answered every public call with HTTP 200 through the CloudFront edge `SEA900-P13`, and `wss://ws.poloniex.com/ws/v3/public` opened in 400 to 429 ms. | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 5 |
| website from this host | `www.poloniex.com` served its script-rendered pages and its public support calls with HTTP 200. | Probed | `curl` on 2026-09-22 |

The development host sits in the United States, which the agreement excludes, so trading from it is not allowed under S7 and S8.
The IP block S7 describes did not touch the public market data API or the website from this host.
The fee page and the user agreement render only in a browser, so the fee tables were read from the site's public calls that feed the page, and the agreement was rendered once in a headless browser.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals, published fee page | 0.0200 % = 200 ppm | 0.0600 % = 600 ppm | Published | S1 |
| USDT-M perpetuals, futures system rank table | 0.015 % = 150 ppm | 0.05 % = 500 ppm | Published by an unrendered site call | S2 |

The two public sources disagree at VIP 0.
The fee page's futures tab renders `futureMakerFee` and `futureTakerFee` from the table in S1.
The site's fee module also defines a `getFuturesFeeRates` call to the rank table in S2, and the fee page does not render it.
Which rate an account is charged could only be read from the authenticated `queryUserFeeRate` call, which this survey does not make.
The engine models a taker cross at VIP 0, so this profile takes the published 600 ppm and records 500 ppm as the open alternative.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USDT-M linear perpetuals | yes | 18, all `OPEN` | Probed, `GET /v3/market/allInstruments`, [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | no | 0 | Probed, every row has `sCcy` `USDT` |
| coin-margined inverse perpetuals | no | 0 | Probed, every row has `ctType` `LINEAR`. CCXT notes "actually, exchange does not have any inverse future now" at `server/node_modules/ccxt/js/src/poloniex.js` line 918 |
| dated futures | no | 0 | Probed, `alias` is `""` on 18 of 18 rows. The documentation reserves `alias` for delivery futures, see [`rest.md`](./rest.md) section 2 |
| options | no | 0 | no options API is documented at https://api-docs.poloniex.com/ |
| spot | yes, not detailed | 870 CCXT spot markets, 831 active, 839 quoted in USDT | Probed, CCXT `loadMarkets`. Published VIP 0 spot maker and taker 0.2000 % and 0.2000 %, S1 |

The 18 perpetuals are BTC, ETH, SOL, XRP, BNB, DOGE, ADA, TRX, SUI, LTC, APT, UNI, 1000PEPE, 1000SHIB, LINK, FIL, AVAX and BCH, each against USDT.
Deposit, withdrawal, margin interest and earn schedules are looked up on the fee page at `https://www.poloniex.com/app/fee`.

## 4. Perpetual tiers

### Published fee page, S1

| level | 30-day futures volume, USD | or 30-day spot volume, USD | or total balance, USD | or TRX and HTX balance, USD | futures maker | futures taker |
|---|---:|---:|---:|---:|---:|---:|
| VIP 0 | 0 | 0 | 0 | 0 | 0.0200 % | 0.0600 % |
| VIP 1 | 100,000 | 10,000 | 2,000 | 1,000 | 0.0180 % | 0.0550 % |
| VIP 2 | 2,000,000 | 80,000 | 4,000 | 2,000 | 0.0160 % | 0.0500 % |
| VIP 3 | 5,000,000 | 500,000 | 10,000 | 4,000 | 0.0140 % | 0.0450 % |
| VIP 4 | 10,000,000 | 1,000,000 | 200,000 | 80,000 | 0.0120 % | 0.0400 % |
| VIP 5 | 20,000,000 | 2,000,000 | 400,000 | 120,000 | 0.0100 % | 0.0350 % |
| VIP 6 | 50,000,000 | 5,000,000 | 1,000,000 | 300,000 | 0.0080 % | 0.0300 % |
| VIP 7 | 100,000,000 | 10,000,000 | 8,000,000 | 2,400,000 | 0.0050 % | 0.0250 % |
| VIP 8 | 500,000,000 | 20,000,000 | 16,000,000 | 4,800,000 | 0.0030 % | 0.0230 % |
| VIP 9 | 1,000,000,000 | 50,000,000 | 30,000,000 | 9,000,000 | 0.0000 % | 0.0210 % |

### Futures system rank table, S2

| rank | `tradeVolume` | maker | taker |
|---|---:|---:|---:|
| 0 | 0 | 0.00015 | 0.0005 |
| VIP1 | 100,000 | 0.00013 | 0.00048 |
| VIP2 | 2,000,000 | 0.0001 | 0.00045 |
| VIP3 | 5,000,000 | 0.00008 | 0.00042 |
| VIP4 | 10,000,000 | 0.00005 | 0.00038 |
| VIP5 | 20,000,000 | 0 | 0.00034 |
| VIP6 | 50,000,000 | -0.00015 | 0.0003 |
| VIP7 | 100,000,000 | -0.00015 | 0.00025 |
| VIP8 | 500,000,000 | -0.00015 | 0.00023 |
| VIP9 | 1,000,000,000 | -0.00015 | 0.00021 |

The volume thresholds match S1, and the takers match S1 from VIP 6 up.
Below VIP 6 the rank table is 10 to 100 ppm cheaper on the taker, 100 ppm at VIP 0, and it pays makers from VIP 6.

### Qualification

A user reaches a level by any one of four measures, per the 2024-07-08 upgrade: yesterday's asset balance, TRX holdings, 30-day spot volume, or 30-day futures volume, S3.
The volume is computed daily at 00:00 UTC+8 and converted to USDT at the day's close, S3.
S3 states the TRX measure as a coin count, "≥ 100" TRX for VIP 1, while the current page in S1 states a TRX and HTX balance in USD, $1,000 for VIP 1.
S1 is the current page and is the one tabled above.

## 5. Discounts that change the perpetual taker

| discount | effect | label | evidence |
|---|---|---|---|
| TRX and HTX deduction | The fee page shows a deducted column for spot only, 0.1400 % against 0.2000 % at VIP 0. No futures deduction column is shown. | Published | S1 |
| Poloniex Super membership | "zero trading fees on Spot and Futures within designated quotas", launched 2026-02-14, with a 30-day trial for 1 USDT. The quota and the price after the trial are not in the announcement. | Published, conditions Not publicly specified | S4 |
| market maker, institutional and high net worth | "Special offer for market makers, institutional clients, and HNW clients", by application | Published, rates Not publicly specified | S1 |
| referral | Not publicly specified for futures in the pages read | Not publicly specified | |

None of these changes the VIP 0 taker a new retail account pays.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula, from 2026-04-30 06:00 UTC | "Funding rate = clamp {A, Upper limit of funding rate, Lower limit of funding rate}", with "Average funding rate (A) = [Average premium index + Premium deviation (B)] / (8 / N)" and "Premium deviation (B) = clamp (Interest rate − Average premium index, Upper premium deviation limit, Lower premium deviation limit)" | Published | S5 |
| premium index | "[Max (0, Impact bid price - Index price) - Max (0, Index price - Impact ask price)] / Index price" | Published | S5 |
| interval | N is defined as "the funding interval, taking a positive integer from 1 to 8", and the example says a 4 hour interval gives "N will be 2 (=8/4)". The two readings conflict, and the example reads N as settlements per 8 hours. The interval "is dynamically adjusted based on a calendar day and will take effect immediately". | Published, internally inconsistent | S5 |
| interval on the wire | 8 hours on 18 of 18 perpetuals, from `nFT` minus `fT`, in both runs | Probed | [`rest.md`](./rest.md) section 3 |
| settlement instants | 00:00, 08:00 and 16:00 UTC on the wire: the BTC history holds 9 rows 8 hours apart, the latest at `1790121600000`, 2026-09-23 00:00 UTC. The 2020 help article says "04:00 UTC, 12:00 UTC and 20:00 UTC". | Probed, and Published in conflict | [`rest.md`](./rest.md) section 4, S6 |
| cap and floor | "Upper limit of funding rate" and "Lower limit of funding rate" are named without values, and no call read returns them | Not publicly specified | S5 |
| interest rate | Not publicly specified. 17 of 18 perpetuals published `fR` and `nFR` of exactly 0.0001, 0.01 % per 8 hours, in both runs, which matches a default interest term with a premium inside the deviation clamp. That reading is an inference. | Probed | [`rest.md`](./rest.md) section 4 |
| amount | "Funding = Position Value * Funding Rate", with "Position Value is determined by the Mark Price at funding timestamp" | Published, 2020 | S6 |
| who pays | A positive rate means longs pay shorts, and a negative rate means shorts pay longs. Only a position held at the timestamp pays or receives. | Published | S10, S6 |
| published rate | `fR` is the last settled rate and `nFR` is "the predicted funding rate", an estimate for the end of the current period, due at `nFT` | Published and Probed | S10, S11, [`rest.md`](./rest.md) section 4 |

The settlement instant itself was not captured, and no probe waited for one.

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation | When margin falls below maintenance, open orders are cancelled and "the liquidation engine will take over the position at bankruptcy price" | Published, 2020 | S9 |
| liquidation fee | Not publicly specified in the pages read | Not publicly specified | S9 |
| insurance fund | 4,662,513.6 USDT, updated `1789922100046` (2026-09-20 16:35 UTC) | Probed | `GET /v3/market/insurance` on 2026-09-22 |
| maintenance margin tiers | tiered by position size, upgraded from 2026-06-30 with full rollout by 2026-10-13 07:00 UTC, readable per contract at `GET /v3/market/riskLimit` | Published and Probed | S14 |
| settlement | none, the contracts are perpetual | | section 3 |
| delisting | Poloniex delisted perpetuals by announcement in 2022 and 2023. The settlement price and fee on a delisting are Not publicly specified in the pages read. | Not publicly specified | support article search on 2026-09-22 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| exchange default | `fees.trading` sets `maker` and `taker` to `0.0009` with the comment "starting from Jan 8 2020" | `server/node_modules/ccxt/js/src/poloniex.js` lines 265 to 270 |
| swap market fee | `parseSwapMarket` sets `'taker': this.safeNumber(market, 'tFee')` and `'maker': this.safeNumber(market, 'mFee')` | same file, lines 951 and 952 |
| wire | no row of `/v3/market/allInstruments` carries `tFee` or `mFee`, 0 of 18 | Probed, [`rest.md`](./rest.md) section 2 |
| what `market.taker` reports on a swap without credentials | `undefined` on 18 of 18 swap markets. The explicit `undefined` overrides the exchange default when CCXT merges `fees.trading` into the market at `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3732 to 3735. | Probed, CCXT 4.5.68, both runs |
| spot markets | `0.0009` on every spot market, from the exchange default, against the published 0.2000 % | Probed |

The connector turns an undefined taker into `null` and drops the market when the registry sets no `takerPpm`, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 162 to 166.
So Poloniex yields no market at all unless the registry sets `takerPpm`.
With `takerPpm` set, the connector skips the CCXT comparison because the CCXT number is `null`, at line 120.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the published VIP 0 USDT-M taker on the fee page, S1, and the higher of the two public numbers. It is required, since CCXT reports no swap taker. |
| `ccxtTakerPpm` | unset | CCXT 4.5.68 reports `undefined`, so there is no constant to declare and the connector never compares |
| comment | cite `ccxt/js/src/poloniex.js:951`, which reads the absent `tFee` | |

If an authenticated read of `queryUserFeeRate` ever shows 0.0005, the value becomes 500.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Poloniex fee page, spot and USDT-M perpetual futures tabs, fed by the public table call | https://www.poloniex.com/app/fee/futures and https://www.poloniex.com/proxy/sapi/spot/public/feeRate/feeRates | 2026-09-22 | Poloniex, global | VIP tiers, futures and spot maker and taker, deduction column, sections 2 to 5 |
| S2 | Futures system rank fee table, defined as `getFuturesFeeRates` in the site's fee module and not rendered | https://www.poloniex.com/proxy/futures/futures-market/configs/user-rank-fee | 2026-09-22 | Poloniex, global | the 500 ppm alternative, sections 2 and 4 |
| S3 | Poloniex to Upgrade Futures Fee Rate System, 2024-07-05 | https://www.poloniex.com/en-US/announcement/24667584983447 | 2026-09-22 | Poloniex, global | qualification rules, section 4 |
| S4 | Poloniex Super Is Live, 2026-02-14 | https://www.poloniex.com/en-US/announcement/38401802414103 | 2026-09-22 | Poloniex, global | zero fee membership, section 5 |
| S5 | Poloniex to Update Funding Rate Calculation Formula, 2026-04-29 | https://www.poloniex.com/en-US/announcement/40122046511383 | 2026-09-22 | Poloniex, USDT-M perpetuals | funding formula and dynamic interval, section 6 |
| S6 | Funding Mechanism, 2020-08-03 | https://www.poloniex.com/en-US/announcement/360052561893 | 2026-09-22 | Poloniex Futures | funding amount, settlement hours as then published, section 6 |
| S7 | Prohibited Countries, 2021-07-13 | https://www.poloniex.com/en-US/announcement/4404183719191 | 2026-09-22 | Poloniex, global | prohibited countries, futures list, IP block, section 1 |
| S8 | Poloniex User Agreement, last revised 2026-04-01 | https://www.poloniex.com/support/terms | 2026-09-22 | Polo group entities | entity wording, restricted territories, Burundi and Morocco, section 1 |
| S9 | What Is Forced Liquidation?, 2020-08-03 | https://www.poloniex.com/en-US/announcement/360052559893 | 2026-09-22 | Poloniex Futures | liquidation, section 7 |
| S10 | Futures REST API, Get Current Funding Rate | https://api-docs.poloniex.com/v3/futures/api/market/get-current-funding-rate | 2026-09-22 | Poloniex, global | `fR`, `fT`, `nFR`, `nFT` meanings, sign convention, section 6 |
| S11 | Futures WebSocket API, Funding Rate | https://api-docs.poloniex.com/v3/futures/websocket/public/get-funding-rate | 2026-09-22 | Poloniex, global | `fT` is "the most recent funding rate settlement", section 6 |
| S12 | Perpetual Futures' Index Price and Mark Price Explained, 2023-10-18 | https://www.poloniex.com/en-US/announcement/18359607883543 | 2026-09-22 | Poloniex Futures | index and mark, see [`rest.md`](./rest.md) section 4 |
| S13 | CoinGecko exchange record for Poloniex | https://api.coingecko.com/api/v3/exchanges/poloniex | 2026-09-22 | CoinGecko | country Seychelles, section 1 |
| S14 | Poloniex to Fully Upgrade Tiered Maintenance Margin Ratios for USDT-M Futures, 2026-09-20 | https://www.poloniex.com/en-US/announcement/45044213671505 | 2026-09-22 | Poloniex, USDT-M perpetuals | maintenance margin rollout, section 7 |
| C1 | CCXT 4.5.68 `poloniex.js` | `server/node_modules/ccxt/js/src/poloniex.js` | 2026-09-22 | CCXT | default fee, swap fee fields, inverse note, sections 3 and 8 |
| P1 | `rest-probe.mjs main`, runs at 03:27 and 03:37 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/poloniex/rest-probe.mjs) | 2026-09-22 | this host | catalog, CCXT taker, funding per contract, sections 3, 6 and 8 |

The announcement pages render in a browser only, and their text was read from the site's public call `https://www.poloniex.com/proxy/sapi/proclamation/public/support/public/getDetails?id=<id>` with the same id.
