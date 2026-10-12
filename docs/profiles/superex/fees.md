# SuperEx Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 02:48 to 03:11 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the USDT-margined perpetuals of SuperEx, the only perpetual family its web app lists.
SuperEx has no CCXT class, so no number here comes from CCXT.
The fee schedule is a public call of the web app's backend, read by [`rest-probe.py`](../../../scripts/probes/venues/superex/rest-probe.py).
That backend is not covered by SuperEx's published API documentation, which describes only the Free Market spot zone, S1.
Spot, the Free Market, index futures and options are named once in the coverage matrix.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | Not publicly specified in the pages read. | Not publicly specified | S5, S11 |
| restricted locations | No restricted location list was found in the help center. Its search for "restricted" returned 33 articles, none of them a list. | Not publicly specified | S14 |
| region flags on the wire | The public call `GET /user/config/areas` lists 227 areas. Canada has allowedRegister 1, allowedLogin 1 and allowedAuth 1. Registration is off for RU, PH, ET, LB, KZ, AB, BY and TJ. Identity verification is off for US, DZ, EG, MA, NP, QA, TN and IRAQ. | Probed | [`rest-probe.py`](../../../scripts/probes/venues/superex/rest-probe.py) section "Region flags" |
| who may trade the perpetuals | An account holder in an area whose registration flag is on. The bundle calls `/user/user/swap/open` and `/user/user/swap/answer` before perpetual trading, which reads as an opening questionnaire, S11. | Region-specific | S11 and the row above |
| website from this exit | `www.superex.com` answered HTTP 403 with SuperEx's own region page, "your access request was not allowed in your local area network". `www.superex.live`, a mirror domain that serves the same web app, answered 200. Its API key page `/en/apiKeyHome` answered an Akamai 403 "Access Denied". | Probed | [`rest-probe.py`](../../../scripts/probes/venues/superex/rest-probe.py) section "Site access" |
| public API from this exit | `api.superexchang.com` answered the catalog, the fee schedule, the funding history and the socket. Two perpetual calls, the live funding call and the position calculator, answered an Akamai 403 "Access Denied". | Probed | [`rest.md`](./rest.md) sections 1 and 3 |

The flags say Canada may register, while the main site refuses this Canadian exit.
That is recorded as seen and was not routed around.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-margined perpetual | 0.02%, 200 ppm | 0.06%, 600 ppm | Probed | `swapFrontMaker` 0.0002 and `swapFrontTaker` 0.0006 at level 0 of `GET /spot/spot/vip/level/configs` |

The schedule names a second perpetual column, `swapReverseMaker` and `swapReverseTaker`, which is 0 at every level.
"Front" and "reverse" match the web app's words for USDT-margined and coin-margined contracts, and no coin-margined contract is listed, so the zero column is read as an unused family.
The VIP 0 spot maker and taker are both 0.1%, 1000 ppm, from the same call.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT-margined perpetuals | yes, 308 contracts, all state 1 | `GET /swap/front/swap`, [`rest.md`](./rest.md) section 2 |
| coin-margined perpetuals | no contract listed | every catalog row settles in USDT, and the reverse fee column is 0 |
| index futures | yes, per S10 | An altcoin-margined perpetual on the BTC and ETH index, introduced by S10. Its catalog was not found in the web bundle, so its count is unknown. |
| dated futures | not found | no delivery contract in the catalog or in the bundle's routes |
| options | not as a trading product | The bundle calls `/c2c/v3/public/option/box`, a promotion, and CoinMarketCap mentions "SuperEx options", S12. |
| spot | yes, 2147 pairs | `GET /spot/spot/symbol/config/rules?pageSize=3000`, [`rest.md`](./rest.md) section 2 |
| Free Market spot zone | yes | the only product the published API documents, S1 to S3 |

## 4. Perpetual tiers

All ten levels come from one call, `GET /spot/spot/vip/level/configs`, probed 2026-10-10.

| level | platform | spotBtc | swapBtc | perpetual maker | perpetual taker | taker ppm |
|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0.02% | 0.06% | 600 |
| 1 | 500 | 100000 | 500000 | 0.018% | 0.055% | 550 |
| 2 | 2000 | 500000 | 2500000 | 0.016% | 0.05% | 500 |
| 3 | 5000 | 2000000 | 10000000 | 0.016% | 0.045% | 450 |
| 4 | 10000 | 5000000 | 25000000 | 0.012% | 0.04% | 400 |
| 5 | 20000 | 10000000 | 50000000 | 0.01% | 0.035% | 350 |
| 6 | 50000 | 20000000 | 100000000 | 0.008% | 0.03% | 300 |
| 7 | 100000 | 40000000 | 200000000 | 0.006% | 0.025% | 250 |
| 8 | 200000 | 80000000 | 400000000 | 0.004% | 0.02% | 200 |
| 9 | 500000 | 150000000 | 1000000000 | 0.002% | 0.015% | 150 |

### Qualification

The wire names the thresholds `platform`, `spotBtc` and `swapBtc` and gives no unit or window.
Reading `platform` as an ET holding and the other two as 30-day volumes is a guess, so the rule is Not publicly specified.
No help center article states the perpetual tier rule, and the fee page `www.superex.com/userCenter/fee/trading` linked by S12 sits on the refused site.

## 5. Discounts that change the perpetual taker

| discount | effect | label | evidence |
|---|---|---|---|
| ET fee deduction | `swapFrontTakerDiscount` and `swapFrontMakerDiscount` are 0.1 at every level, and the spot pair is 0.2. S9 says paying fees in ET earns "the corresponding discount" and names no rate. Reading 0.1 as a 10% cut, a VIP 0 taker paid in ET would be 540 ppm. | Probed for the field, Not publicly specified for its meaning | fee call above, S9 |
| referral | S9 says no referral rebate is paid on a fee deducted in ET. | Published | S9 |
| fee coupons and promotions | The help center runs futures fee coupons and time-boxed fee events, for example a 2025-02-11 "Futures Fee Discounts" event. Whether one runs on 2026-10-09 was not checked. | Published | S14 |
| market maker | Not publicly specified. | Not publicly specified | |

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| interval | 8 hours by default, at 00:00, 08:00 and 16:00 UTC. S4 also says GMT+8 in one sentence and lets each pair differ. | Published | S4, S5 |
| interval on the wire | `fundingTime` 8 on every btc_usdt history row, with settlements at 00:00, 08:00 and 16:00 UTC | Probed | [`rest.md`](./rest.md) section 4 |
| per-pair changes | The help center holds many notices that change one contract's settlement frequency, such as MAGICUSDT and ORCAUSDT on 2026-02-19. | Published | S14 |
| formula | Funding Rate = Premium Index + clamp(0.01% minus Premium Index, 0.05%, -0.05%), computed every minute, then clamp(8-hour average, fmax, -fmax) with fmax = (initial margin minus maintenance margin) × 75% | Published | S4 |
| current period rate | The rate applied at 16:00 is the one calculated during the 08:00 to 16:00 period. | Published | S4 |
| who pays whom | Between users only. "The platform does not charge any funding fees." | Published | S4 |
| amount | Funding Fee = Position Value × Funding Rate, with Position Value = Contract Quantity × Contract Face Value | Published | S4 |

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation trigger | margin rate at or below 0% | Published | S7 |
| liquidation fee | Not publicly specified. S7 says the loss "will be equal to the loss when the margin rate of that position drops to 0" and the takeover price is not shown on the chart. | Not publicly specified | S7 |
| settlement fee | none, there is no delivery | Not offered | S5 |
| delisting | Notices delist contracts one by one, with no stated fee. Every listed contract had `isDelisting` 0 on 2026-10-10. | Published, Probed | help center, [`rest.md`](./rest.md) section 2 |

## 8. CCXT

CCXT 4.5.68 has no SuperEx class.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` has "superex" in its name or its text, by `ls` and `grep -rli` on 2026-10-10.
The current CCXT source has none either: the listing of `ts/src` at master commit f0aca06 (2026-10-08) holds no name containing "super", S13.
So `ccxtTakerPpm` has no CCXT constant to declare.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 `swapFrontTaker` 0.0006 from the fee call |
| `ccxtTakerPpm` | none | no CCXT class exists |

The engine models the base retail tier, so the ET discount is left out.
The fee call is part of the undocumented web backend, so a later adapter would re-read it rather than trust this number for long.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [Quick Start, Free Market API Docs](https://docs-api.superex.com/en/quickStart.html) | 2026-10-09 |
| S2 | [Websocket Free Market Quotes Data](https://docs-api.superex.com/en/websocket.html) | 2026-10-09 |
| S3 | [Market situation, Free Market API Docs](https://docs-api.superex.com/en/Market.html) | 2026-10-09 |
| S4 | [Introduction to Perpetual Funding Fee Rules](https://support.superex.com/hc/en-001/articles/44457052286361), updated 2025-11-27 | 2026-10-09 |
| S5 | [Introduction to Perpetual Futures](https://support.superex.com/hc/en-001/articles/4412869144217), updated 2025-03-07 | 2026-10-09 |
| S6 | [USDT-Margined Futures Account Equity and P&L Calculation](https://support.superex.com/hc/en-001/articles/44462213199129), updated 2025-03-13 | 2026-10-09 |
| S7 | [Forced Liquidation Explanation](https://support.superex.com/hc/en-001/articles/44454958145817), updated 2025-03-13 | 2026-10-09 |
| S8 | [Index Calculation Rules](https://support.superex.com/hc/en-001/articles/44457340458009), updated 2025-03-13 | 2026-10-09 |
| S9 | [How to use ET to deduct the trading fees](https://support.superex.com/hc/en-001/articles/4411462960153), updated 2025-03-06 | 2026-10-09 |
| S10 | [Index Futures Product Introduction](https://support.superex.com/hc/en-001/articles/54020027097369), updated 2026-01-08 | 2026-10-09 |
| S11 | The web app at [www.superex.live](https://www.superex.live/), its `window.__NUXT__.config` and its `/_nuxt/` bundle chunks | 2026-10-09 |
| S12 | [CoinMarketCap, SuperEx](https://coinmarketcap.com/exchanges/superex/) | 2026-10-09 |
| S13 | [CCXT `ts/src` on master](https://github.com/ccxt/ccxt/tree/master/ts/src), commit f0aca06 | 2026-10-09 |
| S14 | [Help center article search](https://support.superex.com/api/v2/help_center/articles/search.json?query=API), queried for API, openapi, API key, trading fee, futures fee, restricted, funding rate, perpetual and terms of use | 2026-10-09 |
