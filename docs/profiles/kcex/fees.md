# KCEX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific time, which is 03:25 to 03:46 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the fees of the KCEX perpetual futures, for every perpetual family.
KCEX has no CCXT class and publishes no API documentation, see section 8 and [`rest.md`](./rest.md) section 1.
The fee facts come from the fee page, the help center, `llms.txt`, and the per-contract fee fields of the futures web app's catalog call, which [`rest-probe.mjs`](../../../scripts/probes/venues/kcex/rest-probe.mjs) reads.
Where a newer help article on www.kcex.com differs from the older copy in the help center's Zendesk store, the newer one is written and the older one is named.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22, help articles dated 2026-08-25 to 2026-09-17 on www.kcex.com | S1 to S8 |
| legal entity | no entity name is published. "KCEX is a centralized cryptocurrency trading platform established in 2021 and registered in Seychelles." | S7 |
| governing law | "This agreement is established in accordance with Singapore law", with Singapore courts, User Agreement clause 23 | S8 |
| licences | S7 and S10 say KCEX "holds regulatory licenses from multiple countries and regions, including the United States and Canada". No licence number or regulator is named, and the User Agreement refuses both countries | S7, S10 |
| who may trade | registered users who pass identity verification, User Agreement AML clauses 2 to 5 | S8 |
| excluded regions | "North Korea, Palau, Rwanda, Cuba, Myanmar, Sudan, Syria, Crimea, Mainland China, Hong Kong, Indonesia, Singapore, Venezuela, Bangladesh, Pakistan, Iran, Afghanistan, Canada, and the United States", and "this list of restricted countries is not exhaustive", User Agreement AML clause 9. The Zendesk copy updated 2025-01-04 has the same list without Iran | S8 |
| US persons | may not trade. The United States is on the refused list | S8 |
| automated access | the User Agreement forbids "deep links, page scraping, robots, spiders, or other automatic devices, programs, scripts, algorithms, or methods to access, retrieve, copy, or monitor any part of the program properties without prior consent from KCEX", and any commercial use of KCEX data without written consent | S8 |
| access from this host | every www.kcex.com page and every futures web app call answered, through CloudFront POP `SEA900-P5`. `api.kcex.com` answered 403 on every path tried, see [`rest.md`](./rest.md) section 6 | P1 |

The automated access clause matters more than any fee on this page.
Reading the web app's market data with a program, as the engine would, needs KCEX's prior consent under the User Agreement.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, standard | 0 %, 0 ppm | 0.01 %, 100 ppm | S1, S2, catalog `takerFeeRate` 0.0001 on 738 contracts, P1 |
| USDC-M perpetuals, standard | 0 %, 0 ppm | 0.01 %, 100 ppm | catalog `takerFeeRate` 0.0001 on 7 of 10 USDC contracts, P1 |
| meme pairs, both families | 0 %, 0 ppm | 0 %, 0 ppm | S3, catalog `takerFeeRate` 0 on 108 contracts, P1 |

The catalog call `GET https://www.kcex.com/fapi/v1/contract/detail` carries `takerFeeRate` and `makerFeeRate` per contract.
On 2026-09-23 at 03:25 and 03:39 UTC, `makerFeeRate` was 0 on all 846 contracts, and `takerFeeRate` was 0.0001 on 738 and 0 on 108, P1.
Of the 108 zero-taker contracts, 102 carry the web app's `common_section_meme` plate.
They include `MUBARAK_USDT`, `DOGE_USDT`, `TRUMP_USDT` and `PEPE_USDT`, and they held 8.1 % of the catalog's 24 h quote volume (`amount24`) at 03:39 UTC, P1.
`DOGE_USDC`, `PEPE_USDC` and `TRUMP_USDC` are the three USDC contracts at 0.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 836 contracts, all `state` 0 | P1 |
| USDC-M perpetuals | yes, 10 contracts, each a second listing of a USDT-M pair: BTC, ETH, SOL, DOGE, PEPE, SUI, XRP, TRUMP, AVAX, ADA | P1 |
| coin-margined perpetuals | no. `GET /fapi/v1/contract/support_currencies` answers `["USDT","USDC"]`, and every row has `futureType` 1 | P1 |
| stock and commodity perpetuals | yes, inside USDT-M: 230 contracts carry the `common_section_stock` plate, among them `META_USDT`, `AMD_USDT`, `SQQQ_USDT` and `CRCL_USDT`, and the commodities `XAU_USDT`, `XAG_USDT`, `CL_USDT` and `BZ_USDT` carry the same plate | P1 |
| dated futures | no. CoinGecko reports 0 futures pairs and 862 perpetual pairs | S9 |
| options | no. Not in the site navigation or the sitemap | S11 |
| spot | yes, 0 % maker and taker on every pair, 817 pairs on CoinGecko | S1, S9 |

CoinGecko's 862 perpetual pairs is 16 more than the 846 rows of the catalog call.
The `push.tickers` socket channel carried one symbol the catalog lacks, `BUN_USDT`, see [`websocket.md`](./websocket.md) section 2.

## 4. Perpetual tiers

No volume or asset tier table is published.
The fee page shows one standard futures rate, 0 % maker and 0.01 % taker, and a separate list of "Meme Trading Pair" rates, with the note "The fee rates for the following special trading pairs differ from the standard trading fee", S1.
The trading fee article of 2026-08-27 gives the same two numbers and adds "The fee rates for certain trading pairs may vary due to promotional campaigns", S2.
The web bundle names "Gold VIP", "Diamond VIP" and "Premium VIP" cards and an "Apply for VIP" button, but no rate is attached to them on any public page, S1.

History, for context.
The Zendesk copy of the trading fee article, updated 2024-10-31, still shows a futures taker of 0.02 %.
The adjustment article moved the taker from 0.02 % to 0.01 % "starting from 16:00 on October 31, 2024(UTC)" on "all KCEX futures trading pairs", and left the maker at 0 %, S4.

### Qualification

Not publicly specified, since no tier exists beyond the standard and meme rates.

## 5. Discounts that change the perpetual taker

| discount | effect | end date | source |
|---|---|---|---|
| meme pairs at zero | taker 0 % and maker 0 % on "all MEME coin futures trading pairs on KCEX" | "Until 16:00 on March 24, 2027 (UTC)" in the article dated 2026-09-17. The Zendesk copy of the same article ended the event on 2025-03-24 | S3 |
| token holding | none found | | |
| referral | the 2024 adjustment moved a "Client Ratio" of commission rebates from 50 % to 60 %. Whether it lowers a trader's own taker is not stated | not stated | S4 |
| market maker programme | Not publicly specified | | |

Which contracts count as meme pairs is not published as a list.
The catalog's `takerFeeRate` field is the only machine-readable answer, and 108 contracts read 0 on 2026-09-23, P1.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Fee = Position Size at the Snapshot Time × Mark Price × Funding Rate" | S5 |
| rate formula | Not publicly specified. The article says only that the rate follows the difference between the perpetual and spot prices | S5 |
| direction | a positive rate means longs pay shorts, and "KCEX does not charge any fees from these payments" | S5 |
| interval | "generally settled every 8 hours at 00:00, 08:00, and 16:00 (UTC)", with per-contract exceptions shown on the product page | S5 |
| interval on the wire | `collectCycle` 8 on 318 contracts, 4 on 526 and 1 on 2 | P1 |
| cap and floor | per contract, `maxFundingRate` and `minFundingRate`: ±0.02 on 814 contracts, +0.02 and -0.03 on 1, ±0.03 on 21, ±0.04 on 9, ±0.05 on 1. No contract sat at its cap on either run | P1 |
| who is charged | holders of a position at the settlement time only | S5 |
| settlement delay | "system processing may be delayed by up to approximately 15 seconds", and a position opened at 16:00:05 "may still be included" | S5 |

The published rate is a fraction per settlement interval, not per 8 h, because the history call returns the settled `fundingRate` together with `collectCycle` for 1, 4 and 8 hour contracts, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured.
Settlement times come from the funding history call, which listed settlements exactly on the hour: `BTC_USDT` at 00:00, 08:00 and 16:00 UTC, `MUBARAK_USDT` every 4 h, and `G_USDT` every hour, P1.
The Zendesk copy of the funding article, updated 2024-10-28, said the rate is calculated every minute and that the rate computed at 07:59, 15:59 and 23:59 UTC+8 is the one used.
The article of 2026-08-26 no longer says so.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation fee | named in the margin ratio, "Margin Ratio = (Maintenance Margin + Liquidation Fee) ÷ (Position Margin + Unrealized P&L)", and no rate is given | S6 |
| liquidation price | the estimated liquidation price formula uses "Maintenance Margin Rate + Taker Fee Rate", so the liquidation fee is probably the taker rate. That reading is an inference | S6 |
| insurance fund | a liquidation filled better than the bankruptcy price adds the remaining margin to the insurance fund, and a deficit beyond the fund goes to auto-deleveraging | S6 |
| settlement fee | none. There are no dated futures | S9 |
| delisting | delistings are announced in the help center, for example "KCEX Will Delist ZIL, API3, SPELL, COMP, 1INCH, CYBER, NFP and BAKE USDT-M Perpetual Futures". Any charge on a forced close at delisting is Not publicly specified | S12 |

Deposit and withdrawal fees are listed on the fee page under "Deposit and Withdrawal Fees", and the meme article states withdrawals at 0 %, S1 and S3.

## 8. CCXT

KCEX has no CCXT class.

- `require('ccxt').exchanges` in `server/node_modules` at CCXT 4.5.68 lists 104 exchange ids, and none contains `kcex`, P1.
- The current CCXT source, `ts/src` on the `master` branch at commit `1d8b674434` of 2026-09-22 12:48 UTC, has 112 entries and none named `kcex`, S13.
- GitHub code search and issue search for `kcex` in `ccxt/ccxt` both returned 0 results on 2026-09-22, S13.

So `market.taker` cannot be read for any KCEX market, and there is no CCXT source line to cite.
The closest equivalent is the catalog's per-contract `takerFeeRate`, section 2.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

| key | value | reason |
|---|---|---|
| `takerPpm` | 100 | the standard VIP 0 perpetual taker, S1, S2 and the catalog. It overstates the cost of the 108 zero-taker contracts, which is the safe side |
| `ccxtTakerPpm` | none | there is no CCXT class, so there is no constant to expect |

A registry entry cannot be added as the engine is built today, because the catalog comes from CCXT `loadMarkets` at `server/src/ccxt/connector.ts` line 68.
KCEX would need a catalog read from `GET /fapi/v1/contract/detail` instead, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | KCEX fee page, "KCEX Trading Fees", its meta description and its page strings | https://www.kcex.com/fee | 2026-09-22 | KCEX, global | standard rates, meme pair rates, no tier table, VIP names, sections 2 to 5 |
| S2 | "KCEX Futures Trading Fees Explained: Maker and Taker Rates and Fee Calculations", dated 2026-08-27 | https://www.kcex.com/support/articles/24022325982105 | 2026-09-22 | KCEX, global | 0 % and 0.01 %, promotional exceptions, sections 2 and 4 |
| S3 | "KCEX Launches Zero-Fee Trading for MEME Futures Pairs", dated 2026-09-17 | https://www.kcex.com/support/articles/40347271037721 | 2026-09-22 | KCEX, global | meme pairs at 0 %, end date 2027-03-24, sections 2 and 5 |
| S4 | "KCEX Futures Taker Fees Reduction and Commission Rebates Adjustments", updated 2024-11-05 | https://www.kcex.com/support/articles/39439567296025 | 2026-09-22 | KCEX, global | taker 0.02 % to 0.01 % from 2024-10-31, client ratio, sections 4 and 5 |
| S5 | "KCEX Futures Funding Rate Mechanism", dated 2026-08-26, and its Zendesk copy updated 2024-10-28 | https://www.kcex.com/support/articles/29293431331865 | 2026-09-22 | KCEX, global | funding formula, times, delay, section 6 |
| S6 | "KCEX Liquidation and Position Tier Guide", dated 2026-08-25 | https://www.kcex.com/support/articles/23961689372185 | 2026-09-22 | KCEX, global | liquidation fee, liquidation price, insurance fund, section 7 |
| S7 | "About KCEX", updated 2024-11-06 | https://www.kcex.com/support/articles/23960524291353 | 2026-09-22 | KCEX, global | Seychelles registration, licence claim, section 1 |
| S8 | "User Agreement" on www.kcex.com, and its Zendesk copy updated 2025-01-04 | https://www.kcex.com/support/articles/23962442522649 | 2026-09-22 | KCEX, global | refused countries, Singapore law, automated access clause, section 1 |
| S9 | CoinGecko API, `exchanges/kcex` and `derivatives/exchanges/kcex-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/kcex-futures | 2026-09-22 | CoinGecko | 862 perpetual pairs, 0 futures pairs, 817 spot pairs, Seychelles, trust rank 90 on the spot entry, section 3 |
| S10 | KCEX `llms.txt` | https://www.kcex.com/llms.txt | 2026-09-22 | KCEX, global | fee claims, licence claim, section 1 |
| S11 | KCEX sitemaps and `robots.txt` | https://www.kcex.com/robots.txt | 2026-09-22 | KCEX, global | no API or options page, section 3 |
| S12 | Help center search through the Zendesk help center API | https://kcex.zendesk.com/api/v2/help_center/articles/search.json?query=funding%20rate | 2026-09-22 | KCEX, global | article ids and dates, delisting notices, section 7 |
| S13 | CCXT repository, `ts/src` listing, code search and issue search | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no KCEX class, section 8 |
| P1 | `rest-probe.mjs catalog`, two runs at 03:25 and 03:39 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/kcex/rest-probe.mjs) | 2026-09-22 | this host | per-contract fees, counts, funding caps and cycles, history, CCXT list, sections 1 to 8 |

The help center host `support.kcexhelp.com` answered 403 to this host, so the Zendesk copies were read through `kcex.zendesk.com/api/v2/help_center`, which answered 200, and the current copies through www.kcex.com, which answered 200.
