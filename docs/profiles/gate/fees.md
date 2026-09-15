# Gate Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

This profile covers perpetual trading on Gate (CCXT id `gate`), and nothing else.
Spot, margin, deposit, withdrawal, card and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`gate-venue-probe.mjs`](../../../scripts/probes/gate-venue-probe.mjs) and [`gate-ws-probe.mjs`](../../../scripts/probes/gate-ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-15 for every source row | | source ledger |
| legal entity | Not publicly specified in the pages read. The user agreement defines "Gate" as "the Sites, Gate and/or any of its Affiliates, related body corporate" and names no company in the part the fetch returned. | Not publicly specified | S9 |
| restricted locations | "the United States, Mainland China, Singapore, Canada, France, Germany, Hong Kong, Malaysia, Malta, Cuba, Iran, North Korea, Sudan, Crimea, Spain, Luhansk, Donetsk, Netherlands, Bolivia, United Kingdom, Myanmar, Venezuela, Uzbekistan, Austria, India, Indonesia, Japan, Argentina, Cambodia, United Arab Emirates, Thailand, South Korea, etc.", updated 2024-11-22 | Published | S8 |
| restricted locations in the user agreement | "The Restricted Locations include but are not limited to the United States of America, […] Republic of the Philippines, Pakistan, Vietnam, Russia and so on." | Published | S9 |
| perpetuals by jurisdiction | "Margin trading & lending and perpetual futures are not allowed in the jurisdictions in which they are prohibited by Applicable Laws or by this Agreement." | Published | S9 |
| who may trade the perpetuals | An account holder outside the restricted locations. A person in the United States may not use the services. | Region-specific | S8, S9 |
| website from this host | Every `www.gate.com` and `www.gate.tr` page, including the API docs, answered HTTP 403 "Access Denied" from an Akamai edge. | Probed | `curl` on 2026-09-15, see [`rest.md`](./rest.md) section 1 |
| public API from this host | `api.gateio.ws` and `fx-ws.gateio.ws` answered every public call. | Probed | [`rest.md`](./rest.md) section 1 |

The documentation and help pages were read through a fetch that does not originate from this host, because this host is refused.
The development host sits in the United States, which is a restricted location, so trading from it is not allowed under S8 and S9.
Reading public market data is not an account service, and the API hosts served it without any challenge.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M crypto perpetuals | 0.020 % = 200 ppm | 0.050 % = 500 ppm | Published | S16, the rendered fee page, VIP 0 of Groups A, B and C. First read in S1 (taker, effective 2026-04-09) and S3 (maker, effective 2024-05-20), see section 4 |
| USDT-M TradFi perpetuals (stocks, metals, indices, forex, commodities) | 0.0200 % = 200 ppm | 0.0500 % = 500 ppm | Published | S2 (effective 2026-09-01) |
| BTC-margined perpetual (`BTC_USD`) | Not publicly specified | Not publicly specified | Not publicly specified | no page read names a BTC-margined perpetual rate |
| USD1-margined perpetuals | Not publicly specified | Not publicly specified | Not publicly specified | no page read names a USD1-margined rate |

The engine models a taker cross at the base retail tier, so 500 ppm is the number that matters for every USDT-M perpetual.
The TradFi VIP 0 taker of 500 ppm was re-read in S2 on the second pass.
The crypto VIP 0 taker of 500 ppm rests on S1 as read in the first pass, and it agrees with S2 and with CCXT's literal `0.05% vip0` in section 8.
Crypto and TradFi perpetuals carry the same VIP 0 taker.

## 3. Coverage matrix

| product | present | count on 2026-09-15 | evidence |
|---|---|---:|---|
| USDT-M perpetuals, crypto | yes | 567 in the raw listing, 568 by CCXT's `contract_type` count, see note | Probed, `/futures/usdt/contracts` |
| USDT-M perpetuals, TradFi | yes | 416 (380 stocks, 18 indices, 12 metals, 3 commodities, 3 forex) | Probed, same call, field `contract_type` |
| BTC-margined inverse perpetual | yes | 1 (`BTC_USD`) | Probed, `/futures/btc/contracts` |
| USD1-margined perpetuals | yes | 9 (`BTC_USD1`, `ETH_USD1`, `SOL_USD1`, `XAU_USD1`, `XAG_USD1`, `MU_USD1`, `SKHYNIX_USD1`, `SNDK_USD1`, `SPCX_USD1`) | Probed, `/futures/usd1/contracts` |
| USDC-margined perpetuals | Not offered on this path | 0 | Probed, `/futures/usdc/contracts` answered 400 `MISSING_REQUIRED_HEADER`, which is the reply to an unknown path |
| dated futures | yes, not detailed | 27 CCXT `future` markets | Probed, CCXT `loadMarkets` |
| options | yes, not detailed | 3,104 CCXT `option` markets | Probed, CCXT `loadMarkets` |
| spot | yes, not detailed | 2,238 CCXT `spot` markets | Probed, CCXT `loadMarkets` |

The CCXT count of 568 crypto contracts against the raw 567 comes from `BTC_USD`, whose `contract_type` is also empty.
Spot, margin, deposit, withdrawal, card and earn fees are looked up on the fee page at `https://www.gate.com/fee`, which renders its tables only in a browser session (S10).

## 4. Perpetual tiers

### USDT-M crypto perpetual taker, effective 2026-04-09

Source S1 publishes the taker column only.
S1 was read in the first pass on 2026-09-15.
In the second pass WebFetch of S1 and S3 returned only the site footer on two or three attempts each, and `curl` from this host got HTTP 403, so the S1 table and the S3 maker column below are Not verified by the second pass.
The VIP 0 row alone was then confirmed on S16, the fee page rendered in headless Chrome on 2026-09-15 at about 19:40 UTC.
Its Futures Fee Rate tab, USDT Perp, read `0.02%/0.05%` as maker and taker for VIP0 in Group A, Group B and Group C.
The USDT Perp and TradFi USDT-M Futures tabs rendered the same table text, so which of the two the table belongs to could not be told apart, and both carry that VIP 0 rate.
Group A is `BTC_USDT`, `ETH_USDT`, `SOL_USDT` and `XRP_USDT`.
Group B is 56 named contracts, among them `BNB_USDT`, `DOGE_USDT`, `HYPE_USDT`, `PEPE_USDT`, `XAU_USDT` and `XAG_USDT`.
Group C is every other USDT-M contract.

| VIP | taker, group A | taker, group B | taker, group C |
|---|---|---|---|
| 0 | 0.0500 % = 500 ppm | 0.0500 % | 0.0500 % |
| 1 | 0.0500 % = 500 ppm | 0.0500 % | 0.0500 % |
| 2 | 0.0500 % = 500 ppm | 0.0500 % | 0.0500 % |
| 3 | 0.0480 % = 480 ppm | 0.0480 % | 0.0480 % |
| 4 | 0.0480 % = 480 ppm | 0.0480 % | 0.0480 % |
| 5 | 0.0450 % = 450 ppm | 0.0450 % | 0.0450 % |
| 6 | 0.0420 % = 420 ppm | 0.0420 % | 0.0420 % |
| 7 | 0.0375 % = 375 ppm | 0.0375 % | 0.0375 % |
| 8 | 0.0350 % = 350 ppm | 0.0350 % | 0.0350 % |
| 9 | 0.0320 % = 320 ppm | 0.0320 % | 0.0320 % |
| 10 | 0.0300 % = 300 ppm | 0.0300 % | 0.0300 % |
| 11 | 0.0280 % = 280 ppm | 0.0280 % | 0.0280 % |
| 12 | 0.0260 % = 260 ppm | 0.0260 % | 0.0260 % |
| 13 | 0.0240 % = 240 ppm | 0.0240 % | 0.0240 % |
| 14 | 0.0220 % = 220 ppm | 0.0220 % | 0.0220 % |
| 15 | 0.0180 % = 180 ppm | 0.0200 % = 200 ppm | 0.0220 % = 220 ppm |
| 16 | 0.0160 % = 160 ppm | 0.0180 % = 180 ppm | 0.0200 % = 200 ppm |

The latest crypto perpetual maker column found is the 2024 one in S3.
It reads 0.020 % for VIP 0 to 2, 0.018 % for VIP 3 to 5, 0.015 % for VIP 6 to 9, 0.010 % for VIP 10, and 0.000 % for VIP 11 to 16.
S1 changed takers only and says nothing about makers, so the 2024 maker column is labelled Published and not confirmed current.
The 2024 taker column in S3 is superseded by S1 and is not reproduced.

### USDT-M TradFi perpetuals, effective 2026-09-01

Source S2 applies to "perpetual contracts related to stocks, metals, indices, forex, and commodities".

| VIP | maker | taker |
|---|---|---|
| 0 | 0.0200 % = 200 ppm | 0.0500 % = 500 ppm |
| 1 | 0.0200 % | 0.0500 % |
| 2 | 0.0200 % | 0.0500 % |
| 3 | 0.0200 % | 0.0480 % = 480 ppm |
| 4 | 0.0200 % | 0.0480 % |
| 5 | 0.0200 % | 0.0450 % = 450 ppm |
| 6 | 0.0180 % = 180 ppm | 0.0420 % = 420 ppm |
| 7 | 0.0160 % = 160 ppm | 0.0375 % = 375 ppm |
| 8 | 0.0140 % = 140 ppm | 0.0350 % = 350 ppm |
| 9 | 0.0120 % = 120 ppm | 0.0320 % = 320 ppm |
| 10 | 0.0080 % = 80 ppm | 0.0250 % = 250 ppm |
| 11 | 0.0060 % = 60 ppm | 0.0230 % = 230 ppm |
| 12 | 0.0040 % = 40 ppm | 0.0210 % = 210 ppm |
| 13 | 0.0020 % = 20 ppm | 0.0190 % = 190 ppm |
| 14 | 0.0000 % | 0.0180 % = 180 ppm |
| 15 | 0.0000 % | 0.0150 % = 150 ppm |
| 16 | 0.0000 % | 0.0120 % = 120 ppm |

S1 names `XAU_USDT`, `XAG_USDT`, `XTI_USDT`, `XBR_USDT` and `NG_USDT` in its group B, and S2 later covers metals and commodities as TradFi.
Which schedule those five follow after 2026-09-01 is not stated in either page.
At VIP 0 the two schedules agree, so the question does not change the engine's number.

### Qualification

The 30-day trading volume that sets the VIP level is "30-Day Spot Trading Volume + 30-Day Futures Trading Volume × 40% + 30-Day Options Trading Volume × 5%", effective 2025-09-10 (S5).
S5 returned only the site footer in the second pass, so this formula is Not verified by the second pass.
The per-level volume, GT holding and asset thresholds are rendered by the VIP page only in a browser session, and the fetch returned the table headers with no rows (S11).
The thresholds are therefore Not verified.

## 5. Discounts that change the perpetual taker

| discount | what it does | label | evidence |
|---|---|---|---|
| Futures Taker Program | 9 %, 16 % or 20 % off the taker for a monthly volume share of 0.02 % to under 0.2 %, 0.2 % to under 1 %, and 1 % or more. Registration goes through an account manager, and managed subaccounts are excluded. It started 2026-09-01, and "The end date will be announced separately." | Account-gated, open-ended | S2 |
| market maker program | MM 0 to MM 3 maker rates of 0.000 % down to -0.005 % on TradFi perpetuals | Negotiated | S2 |
| points | "Taker fees can be offset with Points, calculated at a fixed rate of 0.075%, though discounts may apply depending on circumstances, with the rate going as low as 0.0225%." And "Points cannot be used to offset maker fees." The article is from 2022. S16 still says "The futures taker fee rate is fixed at 0.075% when Points Deduction is enabled", so a points user pays 0.075 % rather than the 0.05 % VIP 0 taker | Account-gated, possibly stale | S4 |
| GT holding | The VIP qualification accepts GT holdings, and the thresholds are Not verified | Not verified | S5, S11 |
| referral | Every contract carries `ref_discount_rate` `"0"` and `ref_rebate_rate` `"0.2"` | Probed, meaning Not publicly specified | `/futures/usdt/contracts`, BTC_USDT row |
| zero-fee promotion on perpetuals | None found in the fee announcement list read on 2026-09-15 | Not publicly specified | S12 |

Every contract row in `/futures/usdt/contracts` carries `maker_fee_rate` `"-0.0001"` and `taker_fee_rate` `"0.00075"`, 983 of 983 on 2026-09-15.
Those numbers match no published retail tier.
CCXT's own sample of the reply marks both fields as "not actual value for regular users", at `server/node_modules/ccxt/js/src/gate.js` lines 1542 and 1543.
A poller must not read a fee from that call.

## 6. Funding as a cost

Source S6 is the formula of record, dated 2022-08-17, and the wire of 2026-09-15 is quoted beside it.
N is the settlement interval in hours.
The base rate is 0.03 % for Gate crypto contracts and 0 for traditional financial contracts.

```text
Premium Index = [ Max (0, Depth-Weighted Bid Price − Index Price) − Max (0, Index Price − Depth-Weighted Ask Price) ] / Index Price
Funding Rate = Clamp [ ( Average Premium Index + Clamp ( 8-hour Interest Rate − Average Premium Index, −0.05%, 0.05% ) ) / (8 / N), −fmax, fmax ]
8-hour Interest Rate = Base Rate / 3
Funding Fee = Position Value × Funding Rate
USDT-Margined Contracts: Position Value = Mark Price × Position Size × Contract Multiplier
Coin-Margined Contracts: Position Value = Position Size × Contract Multiplier / Mark Price
```

| item | documented | probed | evidence |
|---|---|---|---|
| who pays | positive rate: longs pay shorts, negative rate: shorts pay longs | | S6 |
| recalculation | "The funding rate and premium index are calculated every 60 seconds." | the published `funding_rate` changed 0 or 1 times per run of 60 one second polls on four contracts, and 0 or 1 times per 30 s on the socket ticker | S6, [`rest.md`](./rest.md) section 4 |
| averaging | time weighted over the cycle, "(1 × P₁ + 2 × P₂ + … + n × Pₙ) / (1 + 2 + … + n)" per minute, heavier near settlement | | S6 |
| which rate is published | "The funding rate used at final settlement is the result from the last calculation in the current cycle." | across the 20:00 UTC settlement of two hourly contracts, the rate charged was the one calculated at the instant, and the reply showed it for about a minute beside the next settlement time, see [`rest.md`](./rest.md) section 4 | S6 |
| interval | 8 h settles at 00:00, 08:00 and 16:00 UTC, and 4 h every four hours from 00:00 UTC | 593 contracts at 8 h, 382 at 4 h, 8 at 1 h, field `funding_interval` in seconds | S6, `/futures/usdt/contracts` |
| interval changes | a contract whose rate reaches its limit at settlement moves to 1 h, and returns to 4 h after 16 consecutive settlements under 0.025 % absolute | the 8 one-hour contracts were `CVC_USDT`, `CXMT_USDT`, `FRONG_USDT`, `IOST_USDT`, `LSK_USDT`, `MTL_USDT`, `STEEM_USDT`, `T_USDT` | S6, `/futures/usdt/contracts` |
| depth for the premium | the depth-weighted bid and ask are read over a notional, 20,000 USDT in the S6 example | `funding_impact_value` `"30000"` on BTC_USDT, which the API changelog calls the "funding rate depth impact value" | S6, S15, `/futures/usdt/contracts` |
| interest term | base rate 0.03 % for crypto, 0 for TradFi | `interest_rate` `"0.0003"` on 570 contracts and `"0"` on 413 | S6, `/futures/usdt/contracts` |
| cap and floor | "fmax and −fmax are the upper and lower limits of the funding rate." The calculation example for BTC_USDT in S6 uses "Funding Rate Limits (fmax): ± 0.75%", while the wire read 0.003 for BTC_USDT. The SDK model says "Maximum of funding rate = (1/market maximum leverage - maintenance margin rate) * funding_cap_ratio". The API changelog adds `funding_rate_limit` "to indicate funding rate cap value" | `funding_rate_limit` held every published rate inside it (maximum ratio 1.0 at 06:59 and at 19:12 UTC), and 12 contracts sat exactly at `±funding_rate_limit` of `0.0002`, 7 at 19:12 UTC. The SDK formula reproduced `funding_rate_limit` on 151 of 983 contracts, 140 at 19:12 UTC | S6, S13, S15, `/futures/usdt/contracts` |
| cap values in use | per contract | at 06:59 UTC: `0.02` on 530 contracts, `0.01` on 212, `0.0002` on 177, `0.0075` and `0.005` on 17 each, `0.025` on 12, `0.000001` on 10 pre-market contracts, `0.03` on 3, `0.003` on 2 (`BTC_USDT`, `ETH_USDT`), and `0.075` (`GT_USDT`), `0.0206` and `0.015` on 1 each | `/futures/usdt/contracts` |
| manual changes | Gate announces per contract interval and cap changes, for example 8 contracts moved to 4 h and 6 capped at ±1.00 % from 2026-09-04 08:00 UTC. S7 returned only the site footer in the second pass, so the example is Not verified by the second pass | | S7 |
| positions near the instant | "if a trader opens a position at 08:00:00 (UTC+8), the funding fee may still be charged or credited" | | S6 |

The cap the engine should trust is `funding_rate_limit`, because the published rates sat on it and never beyond it.
The SDK's `funding_cap_ratio` formula does not reproduce that cap on most contracts, so the formula is either stale or describes a different bound.

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| liquidation fee | "the liquidation fee rate is 0.075%", used in the bankruptcy price formula (2022 article) | Published | S14 |
| insurance fund and auto-deleveraging | the insurance fund takes what the market cannot absorb, then ADL reduces the most profitable positions | Published | S14 |
| perpetual settlement fee | none, perpetuals do not expire | | |
| delisting charge | Not publicly specified in the pages read | Not publicly specified | |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | Probed, `ccxt.version` |
| `market.taker` on every active swap without credentials | `0.0005` on 984 of 984 | Probed, `gate-venue-probe.mjs main`, tag `ccxt` |
| where it comes from | the literal `'taker': this.parseNumber('0.0005'), // 0.05% vip0` in `parseContractMarket` | `server/node_modules/ccxt/js/src/gate.js` line 1653 |
| `market.maker` | `0.0002` from the literal on the next line | `server/node_modules/ccxt/js/src/gate.js` line 1654 |
| the exchange-level swap fee block | `'maker': 0.0` and `'taker': 0.0005`, with a tier table | `server/node_modules/ccxt/js/src/gate.js` lines 1012 to 1058 |
| the reply's own fee fields | ignored by CCXT | the code of `parseContractMarket`, lines 1603 to 1685, reads no fee field, and the fields appear only in its sample comment |

The CCXT constant is 500 ppm and matches the published VIP 0 taker for USDT-M perpetuals.
The connector compares CCXT's number to `ccxtTakerPpm` or, when that is unset, to the market's own `takerPpm`, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 29 to 31.

## 9. Recommended registry values

```ts
gate: {
  takerPpm: 500,
  // ccxt/js/src/gate.js:1653 hardcodes 0.0005 for every contract market, which equals the published VIP 0 USDT-M taker.
}
```

`takerPpm: 500` is the published VIP 0 taker for both USDT-M schedules, S1 and S2.
`ccxtTakerPpm` stays unset, because CCXT's constant already equals 500 and the connector then expects 500.
If a later CCXT release changes the literal, the connector's warning fires, which is the watch this venue needs.
The one BTC-margined contract has no published rate, and the quote family ranks it after `BTC_USDT`, so it is not traded, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Gate Spot and Futures Fee Structure Upgrade for an Enhanced Trading Experience, published 2026-03-25 | https://www.gate.com/announcements/article/50390 | 2026-09-15 | Gate, global | USDT-M crypto taker tiers and groups, sections 2 and 4 |
| S2 | Gate USDT-M Perpetual Futures Fee Updates, published 2026-08-26 | https://www.gate.com/announcements/article/101365 | 2026-09-15 | Gate, global | TradFi maker and taker tiers, Taker Program, MM rates, sections 2, 4 and 5 |
| S3 | Announcement On Adjustment To USDT-M Perpetual Futures Fees, published 2024-05-09 | https://www.gate.com/announcements/article/36485/announcement-on-adjustment-to-usdt-m-perpetual-futures-fees | 2026-09-15 | Gate, global | the 2024 maker column, sections 2 and 4 |
| S4 | Futures Trading Fee Calculation, dated 2022-04-11 | https://www.gate.com/help/futures/futures_logic/22079 | 2026-09-15 | Gate, global | fee on position value, points, section 5 |
| S5 | VIP Tier Upgrade Requirements Updated, published 2025-09-02 | https://www.gate.com/announcements/article/46885 | 2026-09-15 | Gate, global | VIP volume formula, section 4 |
| S6 | Contract Funding Rate and Funding Fee Explanation, dated 2022-08-17 | https://www.gate.com/help/futures/futures-logic/27569/funding-rate-and-funding-fee | 2026-09-15 | Gate, global | funding formula, intervals, interval switch, interest, section 6 |
| S7 | Gate to Adjust Funding Rate Settlement Frequency and Limits for Multiple Perpetual Futures, published 2026-09-02 | https://www.gate.com/announcements/article/101514 | 2026-09-15 | Gate, global | manual interval and cap changes, section 6 |
| S8 | Restricted Locations, updated 2024-11-22 | https://www.gate.com/help/guide/faq/40959/restricted-locations | 2026-09-15 | Gate, global | restricted locations, section 1 |
| S9 | User Agreement | https://www.gate.com/legal/user-agreement | 2026-09-15 | Gate, global | entity wording, perpetual restriction clause, section 1 |
| S10 | Crypto Fee Overview | https://www.gate.com/fee | 2026-09-15 | Gate, global | the fee page renders no table without a browser session, section 3 |
| S11 | Gate VIP | https://www.gate.com/en/vip | 2026-09-15 | Gate, global | VIP table headers with no rows, section 4 |
| S12 | Fees announcement list | https://www.gate.com/announcements/fee | 2026-09-15 | Gate, global | no perpetual zero-fee promotion listed, section 5 |
| S13 | Contract model, Gate Python SDK (repository archived, last push 2026-07-16) | https://raw.githubusercontent.com/gateio/gateapi-python/master/docs/Contract.md | 2026-09-15 | Gate, SDK generated from the API specification | `funding_cap_ratio` formula, section 6 |
| S14 | Liquidation Mechanism, dated 2022-03-25 | https://www.gate.com/help/futures/futures/22159/liquidation-process | 2026-09-15 | Gate, global | liquidation fee, section 7 |
| S15 | Gate API v4 changelog, v4.106.127 and v4.106.73 | https://www.gate.com/docs/developers/apiv4/en/ | 2026-09-15 | Gate, global | `funding_rate_limit` is the cap value, `funding_impact_value` is the depth impact value, section 6 |
| S16 | Fee Overview, Futures Fee Rate tab, rendered in headless Chrome | https://www.gate.com/fee | 2026-09-15 | Gate, global | 2, 4, 5 |
