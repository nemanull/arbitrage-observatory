# OrangeX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:18 to 03:53 UTC, from the development host near Seattle.

This profile covers the fees of the OrangeX USDT-margined perpetuals, which CCXT does not implement.
The website, the help center, the API documentation and the public API all answered this host with HTTP 200, so every page below was read from here.
The API documentation at S4 is a JSON-RPC API in the Deribit shape, and several of its examples are from 2020 and describe instruments that no longer exist, see [`rest.md`](./rest.md) section 2.
The venue's own `get_instruments` reply carries a maker and a taker on every contract, and it is quoted beside the published schedule.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | 2026-09-22 Pacific time, 2026-09-23 UTC | |
| terms of service | "Last revised: July 15, 2026" | S1 |
| default contracting party | OrangeX Fintech s.r.o., identification no. 198 92 853, Ostrava, Czech Republic | S1 section 2.1 |
| other group entities named | EE Legend Pty Ltd (Australia, AUSTRAC registration DCE100906401-001), OrangeX Limited (BVI company no. 2153535), OrangeX LLC (Saint Vincent and the Grenadines, company no. 3687 LLC 2024) | S1 section 2.1 |
| brand licensee | ORNGX LIMITED "is officially authorized by OrangeX (OrangeX.com) to use the OrangeX.com brand name and logo" | S1 section 14.1 |
| country on CoinGecko | Seychelles, established 2021, and the privacy policy names regulators "inside or outside the Republic of Seychelles" | S12, S1 |
| products in scope | USDT-margined perpetuals, the only perpetual family listed | [`rest.md`](./rest.md) section 2 |

### Who may trade

Section 2.5 of the terms excludes anyone "located, incorporated or otherwise established in, or a citizen or resident of" the United States or Panama, S1.
The same section then lists the "Excluded Jurisdictions": Australia, Belarus, Burundi, Cuba, China Mainland, the DPRK, Hong Kong, Iran, Myanmar, Panama, Russia, the Russian-controlled regions of Ukraine (Crimea, Donetsk and Luhansk), Singapore, Syria, South Sudan, Sudan, the United States of America, the United Kingdom, Venezuela, Israel, Slovakia, India and Ukraine, S1.
So a US person may not trade OrangeX perpetuals.
Australia is excluded although an Australian group entity holds an AUSTRAC registration, S1.
Article 1574 adds that affiliates may not market to restricted jurisdictions and that OrangeX offers no KRW pairs or Korean language, S9.

### What this host saw

`www.orangex.com`, `openapi-docs.orangex.com` and `api.orangex.com` all answered HTTP 200 on 2026-09-23 UTC, and no request was refused or challenged.
Public market data needs no account, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 5.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | fee page S2, fee articles S5 and S6, and `taker_commission` `"0.0006"` on 578 of 578 contracts in P1 |
| copy trading on the same perpetuals | 0.06 %, 600 ppm | 0.06 %, 600 ppm | S2, S6 |

The catalog agrees on the taker for every contract.
The maker differs on four contracts: `maker_commission` is `"0.0002"` on 574, `"0.001"` on `ORDI-USDT-PERPETUAL`, `"0.0003"` on `TOSHI-USDT-PERPETUAL`, and `"0.0001"` on `ERA-USDT-PERPETUAL` and `SKY-USDT-PERPETUAL`, P1.
`cmc_contracts` repeats the same numbers as `maker_fee` and `taker_fee`, equal to the catalog on 578 of 578 contracts, P1.

## 3. Coverage matrix

| product | present | count on 2026-09-23 UTC | source |
|---|---|---|---|
| USDT-M perpetuals | yes | 578 in `get_instruments?currency=PERPETUAL`, all `is_active` true | P1 |
| USDC-M perpetuals | no | 0 | P1 |
| coin-margined perpetuals | no | 0 | P1 |
| dated futures | no | 0, and CoinGecko shows 0 futures pairs | P1, S12 |
| options | no | 0 | P1 |
| spot | yes | 348: 346 against USDT, 1 against USDC, 1 against BTC | P1 |
| margin | no | 0, although the API documentation still shows `-MARGIN` instruments | P1, S4 |
| demo contracts | yes | 10 `-SANDBOX` instruments of kind `sandbox`, the demo trading product | P1 |

CoinGecko listed 578 perpetual pairs in the survey brief and 579 in its API at 03:37 UTC, S12.
The 578 include contracts named after equities, ETFs and commodities with no flag to tell them apart, among them `TSLA`, `AAPL`, `NVDA`, `MSTR`, `GS`, `JPM`, `SPY`, `QQQ`, `XAUT`, `XAG` and `CL`, and the pre-IPO names `OPENAI` and `ANTHROPIC`.
A name search found 41 such contracts, P1, and the website sells them under a "TradFi" menu, S2.
Article 371 says OrangeX provides "quarterly contracts, perpetual contracts, and options", S5, and the catalog lists none of the first or the last.

## 4. Perpetual tiers

No tier table is published.
The fee page shows one perpetual maker and taker, S2.
Article 371, "Fee Structures on OrangeX.com", shows the same single row, S5.
Article 1154 set that row on "April 14th at 06:30 UTC" in 2025 and names no volume tiers, S6.
A search of the help center article titles for VIP, tier, market maker and rebate found no fee tier article, S7.

### Qualification

There is nothing to qualify for, since only one retail rate is published.

## 5. Discounts that change the perpetual taker

| discount | status | source |
|---|---|---|
| token holding | none found, OrangeX publishes no platform token discount | S2, S5 |
| VIP or volume tiers | none published | section 4 |
| referral and affiliate | a referral program and an affiliate program are linked from the site footer, and the terms say rebates are cancelled or reduced on a policy breach. No source says either lowers the trader's own taker | S1, S2, S9 |
| market maker program | none found | S7 |
| promotions | a 2024 Black Friday campaign paid "Cash back 50% of Trading fee", and it has ended | S7 |

So the perpetual taker is 0.06 % for every account this research could see.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate = clamp ([premium index + clamp (base rate - premium index, 0.05%, -0.05%)], -0.75%, 0.75%)" | S3 |
| premium index and base rate | not defined on the page, Not publicly specified | S3 |
| cap and floor | ±0.75 % per interval | S3 |
| interval | per contract: 8 h on 194, 4 h on 379 and 1 h on 5 of the 578 live contracts | P1 and P2, from `endTime` minus `startTime` in `get_all_capital_rate` |
| documented interval | "Funding payments are transferred between traders and are charged every eight hours", in article 390 | S8 |
| interval changes | announced per contract, for example `USELESSUSDT` and `AINUSDT` moved from 8 h to 4 h on 2025-07-11, and the same notice reserves the right to change "the interest rate, premium and capped funding rate" without notice | S10 |
| settlement times | on the hour. `BTC-USDT-PERPETUAL` settled at 16:00, 00:00 and 08:00 UTC, the 4 h `API3-USDT-PERPETUAL` every 4 h ending 00:00 UTC, and the 1 h `IOST-USDT-PERPETUAL` every hour | P3 |
| offset contracts | `WDCON-USDT-PERPETUAL` runs 8 h from 20:00 to 04:00 UTC, the only one of the 194 8 h contracts that does not settle at 00:00, 08:00 and 16:00 | P1 |
| who pays | longs pay shorts when the rate is positive, and shorts pay longs when it is negative | S3 |
| live range | -0.005005 to 0.00191 across the live contracts at 03:27 and 03:38 UTC, and -0.004209 to 0.001633 at 03:46 UTC, inside the cap | P2 |
| stale rows | `get_all_capital_rate` also returns 191 delisted contracts, and one of them, `NULS-USDT-PERPETUAL`, still shows -0.007765 from 2025-04-09, the only row beyond today's cap | P1, P2 |

The published rate is the one for the coming settlement, and [`rest.md`](./rest.md) section 4 shows it against the settled history.
The settlement instant itself was not captured, because this research does not wait for a clock event.
Whether the charge uses the rate shown just before the hour, and what the display does just after, is Not verified.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | Not publicly specified | S2, S5, S11 |
| maintenance margin | tiered by notional, 0.30 % to 50.00 % on the BTC table, with a maintenance amount per tier | S11 |
| insurance fund | covers bankruptcies, and "If bankruptcies in a session deplete the Insurance Fund, any further losses will be covered by profits made by traders on the Platform on a pro rate basis" | S1 |
| delisting | announced per contract in the help center, for example "Announcement on Delisting of STRAX 25X Perpetual". The settlement price of a delisted contract is Not publicly specified | S7 |
| close-only contracts | 16 contracts carry a non-zero `close_only_limit_value`, for example `WAVES-USDT-PERPETUAL` at 3,500,000. Its meaning is Not publicly specified | P1 |
| deposits and withdrawals | the official lookup is article 408, "What are Withdrawal Fees & Minimum Withdrawal Amount?" | S7 |

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `orangex`. The only ids containing "ox" are `btcbox` and `foxbit` | P1, `node -e "console.log(require('ccxt').exchanges)"` run from `server/` |
| CCXT master on GitHub | no `orangex.ts` in `ts/src` at commit `1d8b674` of 2026-09-22 12:48 UTC, 105 `.ts` files listed, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/orangex.ts` returns 404 | S13 |
| pending work | Not verified. The unauthenticated GitHub API answered this host with HTTP 403 "API rate limit exceeded", the authenticated tree listing above then used up the shared hourly budget, and web search was unavailable, so pull requests and issues were not searched | S13 |
| `market.taker` for a swap | none, since there is no class to load | |

So there is no CCXT source line to cite, and no `ccxtTakerPpm` to declare.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | 0.06 % on the fee page, in two articles, and in `taker_commission` on every contract |
| `ccxtTakerPpm` | unset | no CCXT class exists |

A registry entry needs a catalog loader first, because the engine's catalog is CCXT `loadMarkets` at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Terms of Service, "Last revised: July 15, 2026", with the privacy policy on the same page | https://www.orangex.com/terms?type=conditions | 2026-09-23 UTC | OrangeX Group | entities, restricted areas, insurance fund, rebates, sections 1, 5 and 7 |
| S2 | Fee rate | https://www.orangex.com/agreement/fee-rates | 2026-09-23 UTC | OrangeX.com | perpetual 0.02 % and 0.06 %, spot 0.10 %, copy trading 0.06 %, TradFi menu, referral and affiliate links, sections 2 to 5 |
| S3 | Funding rate | https://www.orangex.com/agreement/funding-rates | 2026-09-23 UTC | OrangeX.com | funding formula and cap, who pays, section 6 |
| S4 | ORANGEX API v1.0.0 | https://openapi-docs.orangex.com | 2026-09-23 UTC | OrangeX.com | instrument kinds, margin examples, sections 3 and 7 |
| S5 | Fee Structures on OrangeX.com, article 371 | https://www.orangex.com/support/help/articles/371 | 2026-09-23 UTC | OrangeX.com | single fee row, product list, sections 2 to 5 |
| S6 | Update on Perpetual Trading Fee Structure, article 1154, dated 2025-04-11 | https://www.orangex.com/support/help/articles/1154 | 2026-09-23 UTC | OrangeX.com | current perpetual and copy trading rates, sections 2 and 4 |
| S7 | Help center article list | https://www.orangex.com/support/help | 2026-09-23 UTC | OrangeX.com | no tier or market maker article, promotions, delisting notices, sections 4, 5 and 7 |
| S8 | USDT-Margined Futures Contracts, article 390 | https://www.orangex.com/support/help/articles/390 | 2026-09-23 UTC | OrangeX.com | "charged every eight hours", contract unit, section 6 |
| S9 | OrangeX.com Reinforces Regulatory Compliance, article 1574 | https://www.orangex.com/support/help/articles/1574 | 2026-09-23 UTC | OrangeX.com | affiliate restrictions, Korea, sections 1 and 5 |
| S10 | Important Updates on Funding Rates of USELESS, AIN, article 1326 | https://www.orangex.com/support/help/articles/1326 | 2026-09-23 UTC | OrangeX.com | per contract interval change, section 6 |
| S11 | Notional value, leverage and maintenance margin for BTC, article 1035 | https://www.orangex.com/support/help/articles/1035 | 2026-09-23 UTC | OrangeX.com | maintenance margin tiers, section 7 |
| S12 | CoinGecko API, `exchanges/orangex` and `derivatives/exchanges/orangex_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/orangex_futures | 2026-09-23 UTC | CoinGecko | 579 perpetual pairs, 0 futures pairs, Seychelles, trust rank 91 that day, section 3 |
| S13 | CCXT master tree and raw file | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 UTC | CCXT | no OrangeX class, section 8 |
| P1 | `rest-probe.mjs catalog`, runs at 03:25, 03:45 and 03:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orangex/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog counts and fee fields, sections 2, 3 and 7 |
| P2 | `rest-probe.mjs anchor`, runs at 03:26, 03:37 and 03:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orangex/rest-probe.mjs) | 2026-09-23 UTC | this host | intervals, live rate range, stale rows, sections 2 and 6 |
| P3 | `rest-probe.mjs history`, runs at 03:36 and 03:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orangex/rest-probe.mjs) | 2026-09-23 UTC | this host | settlement times, section 6 |
