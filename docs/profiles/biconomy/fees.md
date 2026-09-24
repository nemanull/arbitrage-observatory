# Biconomy.com Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:10 to 03:43 UTC), from the development host near Seattle.

This profile covers the fees of the Biconomy.com USDT-margined perpetuals, the only perpetual family the venue lists.
Biconomy.com is a centralized exchange and is not the account abstraction project Biconomy at biconomy.io.
CCXT 4.5.68 has no class for it, see section 8.
The official API documentation covers spot only, S12, so every futures number below comes from the help center, the fee page's data call, or the futures web app's own public endpoints, probed by [`rest-probe.mjs`](../../../scripts/probes/venues/biconomy/rest-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local, 2026-09-23 UTC | |
| operator | "BICONOMY PTE.LTD" operates the platform | S4 |
| country on CoinGecko | British Virgin Islands | S13 |
| who may trade perpetuals | a registered user with at least Level 1 KYC: "Users must complete at least Level 1 KYC verification to unlock full trading functionality." | S1 section 6 |
| excluded regions | users "from or associated with sanctioned jurisdictions", screened against OFAC, UN, EU and UK HM Treasury lists | S5 section 3.4 |
| named restricted countries | "You are from a restricted country (e.g., China, Turkey, Kazakhstan, Indonesia )." KYC is not supported for Chinese citizens. The API key terms name Iran and North Korea as sanctioned | S6, S17, S7 |
| United States | no page found names the United States as restricted, and the Terms of Service carry no country list. Whether a US person may trade is Not publicly specified | S4, S5, S6 |
| contract-level restriction | "Some contracts or trading pairs may be restricted due to regional regulatory requirements." | S1 section 10 |

From this host the fee page, the fee data call, the help center JSON API and every futures REST and WebSocket endpoint answered with no geoblock.
The help center HTML pages answered 403, so the articles were read through the help center's JSON API at `https://biconomy.zendesk.com/api/v2/help_center/en-us/articles/<id>.json`, which answered 200.

## 2. Quick answer

| family | maker | taker | maker ppm | taker ppm | source |
|---|---|---|---|---|---|
| USDT-margined perpetuals | 0.02 % | 0.06 % | 200 | 600 | S1 sections 1 and 11, and on the wire in P1 |

The help center calls these "the standard" and "the default" rates, S1.
On the wire, the fee page's data call returned `maker_fee` `0.000200000000000000` and `taker_fee` `0.000600000000000000` on 294 of 294 futures rows, and the futures catalog returned `mfr` 0.0002 and `tfr` 0.0006 on 295 of 295 active contracts, in both runs of `rest-probe.mjs catalog`, P1.
The one active contract missing from the fee page is `BSP_USDT`, which the catalog flags `ihd` true.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes, 295 active of 511 listed | `detailV2` returned 511 rows, 295 with `state` 0 and 216 with `state` 3, all with settle and quote `USDT`, P1 |
| coin-margined perpetuals | no | "Coin-Margined Contracts (Under Development)", S1 sections 5 and 7. No non-USDT settle currency among 511 rows, P1 |
| USDC-margined perpetuals | no | "USDC Contracts (Under Development)", S1 section 5 |
| dated futures | no | `ft` is 1 on all 511 rows, and CoinGecko counts 0 futures pairs, S13 |
| options | no | the site's route table in its web bundle lists no options route, S15. CoinGecko's description mentions options, S13 |
| spot | yes, not detailed | `GET https://api.biconomy.com/api/v3/symbols` returned 2,000 symbols, 1,013 with `status` 0 and 987 with `status` 1, and the fee page lists 991 spot rows, most at 0.1 % maker and taker |
| other | a `/prediction-futures` route exists on the site, not researched | S15 |

CoinGecko's derivatives list shows "Biconomy (Futures)" with 6 perpetual pairs and 0 futures pairs, and its ticker list names only `BRENTOIL_USDT`, `BTC_USDT`, `CL_USDT`, `ETH_USDT` and `NATGAS_USDT`, S13.
The venue itself serves 295 active perpetuals, so CoinGecko tracks only a handful of them.

## 4. Perpetual tiers

No perpetual VIP tier table is published.
The help center names only the standard maker and taker rates, S1.
The fee page renders one row per contract with its maker and taker rate, and its data call carries no tier, level or volume field, P1 and S11.
The About BIT token article says "Using BIT, users can purchase monthly VIP-status plans to receive discounts on transaction fees.", with no rates and no qualification rule, S8.

| tier | qualification | maker | taker |
|---|---|---|---|
| standard, VIP 0 | any user | 0.02 % | 0.06 % |
| VIP plans | bought monthly with BIT | Not publicly specified | Not publicly specified |

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | status on 2026-09-22 | source |
|---|---|---|---|
| BIT VIP plans | a discount of unpublished size | Not publicly specified | S8 |
| "Ultimate Futures Masters Tournament", phases 2 and 3, "Trading Fee Cashback" | cashback during the event | articles dated 2025-08-29 and 2025-09-19, ended | help center search, S18 |
| referral and market maker programmes | none found | Not publicly specified | |

None of these changes the VIP 0 taker the engine models.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Fee = Position Value x Funding Rate", "Position Value = Quantity Held (in tokens) x Mark Price" | S2 section 3.1 |
| direction | a positive rate means longs pay shorts, a negative rate means shorts pay longs, and the exchange takes no share | S1 section 2, S2 section 5 |
| documented interval | "All Biconomy perpetual contracts are set to settle funding fees every 8 hours at 00:00 UTC, 08:00 UTC, and 16:00 UTC." S1 says the same instants as 00:00, 08:00 and 16:00 UTC+8 | S1, S2 |
| probed interval | 293 contracts on `cycle` 8, `ONG_USDT` on 1 and `BASED_USDT` on 4. The last 20 settlements of each were exactly 8, 1 and 4 hours apart, on the UTC hours 0, 8 and 16 for 8 h contracts | P1 `catalog` and `history` |
| who is charged | holders of a position at the settlement instant only | S2 section 5 |
| cap and floor | Not publicly specified. On the wire 14 contracts sat at exactly 0.0005 and 8 at exactly -0.0005, and none beyond, so a cap of 0.05 % per interval is likely but unconfirmed | P1, third `catalog` run |
| resting rate | 124 of 295 contracts published exactly 0.0001 and 10 published 0 | P1, third `catalog` run |
| rate formula | Not publicly specified | S2 |

The settlement instant itself was not captured.
What the history call shows about the published rate is in [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | Not publicly specified. The forced liquidation FAQ describes the trigger at a 100 % margin ratio and the effect of funding on the liquidation price, and names no fee | S16 |
| remaining collateral | "After liquidation, the remaining collateral is returned to the user's account." | S1 section 9 |
| delisting, 2026 | opening blocked one hour before, then "all remaining BBUSDT positions will be automatically settled and closed based on the prevailing mark price", and funding stops | S9 |
| delisting, 2023 | "Biconomy will be using the index price at the time of delisting as the delivery price" | S10 |
| delisted rows in the catalog | 216 rows stay in `detailV2` with `state` 3, among them `LRC_USDT`, `BB_USDT` and `VANRY_USDT`. `fundingRate/LRC_USDT` still answers with a rate of -0.0005, and `depth/LRC_USDT` answers empty sides and version 0 | P1 `errors` |
| deposits and withdrawals | the fee page lists them per network, see https://www.biconomy.com/en/fee | S11 |

## 8. CCXT

No CCXT class exists for this venue.

| check | result |
|---|---|
| CCXT 4.5.68 installed | `require('ccxt').exchanges` from `server/` lists 104 ids, none matching `bic` or `biconomy`, and no file under `server/node_modules/ccxt/js/src/` matches |
| CCXT master | the GitHub listing of `ts/src` at commit `1d8b674` (2026-09-22 12:48 UTC) has 112 entries and none matches `bic`, S14 |
| request to add it | issue 23685 "New Exchange: Biconomy CEX - https://www.biconomy.com/en" is open, S14 |
| could `ccxt.mexc` be pointed at it | no. The futures API descends from the MEXC contract API but renames its paths: `GET /future/api/v1/contract/detail` and `/future/api/v1/detail` answer 404, and the catalog is `detailV2` with short field names, P1 `errors` |

So `market.taker` has no CCXT value, and `ccxtTakerPpm` has nothing to declare.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the standard taker of 0.06 % in S1, equal to `tfr` 0.0006 on 295 of 295 active contracts and to the fee page's 294 futures rows, P1 |
| `ccxtTakerPpm` | not set | there is no CCXT class, so the catalog loader that replaces `loadMarkets` should read `tfr` and `mfr` from `detailV2`, see [`rest.md`](./rest.md) section 2 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Contract Trading Fees, Limits, and Rules, updated 2026-07-13 | https://biconomy.zendesk.com/hc/en-us/articles/44424584128153-Contract-Trading-Fees-Limits-and-Rules | 2026-09-22 | Biconomy.com, global | maker and taker, funding instants, KYC, leverage, families under development, sections 1 to 7 |
| S2 | Funding Rate Explained, updated 2025-03-27 | https://biconomy.zendesk.com/hc/en-us/articles/30554671089177-Funding-Rate-Explained | 2026-09-22 | Biconomy.com, global | funding formula, instants, who pays, section 6 |
| S3 | What Are Index Price, Mark Price, and Last Price?, updated 2025-03-27 | https://biconomy.zendesk.com/hc/en-us/articles/44426422000281-What-Are-Index-Price-Mark-Price-and-Last-Price | 2026-09-22 | Biconomy.com, global | index and mark definitions, used in [`rest.md`](./rest.md) |
| S4 | Biconomy Terms of Service, updated 2026-09-21 | https://biconomy.zendesk.com/hc/en-us/articles/44161433761561-Biconomy-Terms-of-Service | 2026-09-22 | BICONOMY PTE.LTD | operator, no country list, section 1 |
| S5 | Know-Your-Customer (KYC) and Anti-Money Laundering (AML) Policies, updated 2026-03-13 | https://biconomy.zendesk.com/hc/en-us/articles/45279878062873-Know-Your-Customer-KYC-and-Anti-Money-Laundering-AML-Policies | 2026-09-22 | Biconomy.com, global | sanctions screening, section 1 |
| S6 | Common Reasons for Biconomy Identity Verification Failure, updated 2025-07-05 | https://biconomy.zendesk.com/hc/en-us/articles/44343785705241-Common-Reasons-for-Biconomy-Identity-Verification-Failure | 2026-09-22 | Biconomy.com, global | restricted country examples, section 1 |
| S7 | Biconomy API Key Usage Terms, updated 2025-03-27 | https://biconomy.zendesk.com/hc/en-us/articles/44457897994777-Biconomy-API-Key-Usage-Terms | 2026-09-22 | Biconomy.com, global | sanctioned countries named, section 1 |
| S8 | About BIT token, updated 2026-09-21 | https://biconomy.zendesk.com/hc/en-us/articles/4405699887897-About-BIT-token | 2026-09-22 | Biconomy.com, global | VIP plans bought with BIT, sections 4 and 5 |
| S9 | Important Notice on the Delisting of BBUSDT Perpetual Futures Contract, 2026-07-11 | https://biconomy.zendesk.com/hc/en-us/articles/59936847664409-Important-Notice-on-the-Delisting-of-BBUSDT-Perpetual-Futures-Contract | 2026-09-22 | Biconomy.com, global | delisting at mark, section 7 |
| S10 | Important Notice on the Delisting of Selected Perpetual Futures Contracts, updated 2026-06-15 | https://biconomy.zendesk.com/hc/en-us/articles/23128628011161-Important-Notice-on-the-Delisting-of-Selected-Perpetual-Futures-Contracts | 2026-09-22 | Biconomy.com, global | 2023 delisting at index, section 7 |
| S11 | Biconomy fee page and its data call | https://www.biconomy.com/en/fee and https://openapi.biconomy.com/api/v1/exchange-fee | 2026-09-22 | Biconomy.com, global | per contract maker and taker, sections 2 and 4 |
| S12 | BiconomyOfficial/apidocs README, "Biconomy Open API V3", commit `f08b6c68` of 2026-08-25 | https://github.com/BiconomyOfficial/apidocs | 2026-09-22 | Biconomy.com | the official API covers spot only |
| S13 | CoinGecko API, `derivatives/exchanges`, `derivatives/exchanges/biconomy-futures` and `exchanges/biconomy` | https://api.coingecko.com/api/v3/derivatives/exchanges/biconomy-futures?include_tickers=all | 2026-09-22 | CoinGecko | 6 perpetual pairs, BVI, trust rank 55, section 3 |
| S14 | CCXT on GitHub, `ts/src` listing and issue 23685 | https://github.com/ccxt/ccxt/tree/master/ts/src and https://github.com/ccxt/ccxt/issues/23685 | 2026-09-22 | CCXT | no class on master, section 8 |
| S15 | biconomy.com web bundles, futures app `index-54684f1e.js` and site `266a3c6.js` | https://static.biconomy.com/site1/futures/static/js/index-54684f1e.js | 2026-09-22 | Biconomy.com | futures endpoints, site routes, section 3 |
| S16 | Biconomy.com Futures Forced Liquidation FAQ, updated 2026-03-13 | https://biconomy.zendesk.com/hc/en-us/articles/30145746049817-Biconomy-com-Futures-Forced-Liquidation-FAQ | 2026-09-22 | Biconomy.com, global | no liquidation fee named, section 7 |
| S17 | FAQ, Individual KYC, updated 2026-03-31 | https://biconomy.zendesk.com/hc/en-us/articles/27290589651097-FAQ-Individual-KYC | 2026-09-22 | Biconomy.com, global | no KYC for Chinese citizens, section 1 |
| S18 | help center search for "VIP" and "fee discount" | https://biconomy.zendesk.com/api/v2/help_center/articles/search.json | 2026-09-22 | Biconomy.com | promotion titles and dates, section 5 |
| P1 | `rest-probe.mjs catalog`, `history` and `errors`, two runs at 03:19 to 03:31 UTC on 2026-09-23, and a third `catalog` and `errors` run at 03:42 and 03:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/biconomy/rest-probe.mjs) | 2026-09-22 | this host | fees on the wire, coverage, funding intervals and resting rates |
