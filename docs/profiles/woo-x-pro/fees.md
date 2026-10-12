# WOO X Pro Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 02:21 to 02:42 UTC on 2026-10-10, second pass included, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the fees of WOO X Pro (no CCXT class) on its perpetual futures, USDT-margined, USDC-margined and coin-margined.
WOO X Pro is not the venue profiled as WOO X in [`../woo/`](../woo/).
It is the former NovaEX, renamed in December 2025, and it runs on a separate host, `wooxpro.com`, with its own accounts and an API in BitMart's futures v2 shape, see section 1.
Every fee number below comes from the WOO X Pro help center, read through its Zendesk API, and from the VIP table image it embeds.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Wootech Limited Corp., "a company incorporated under the laws of the Republic of Panama" | S1 |
| governing law | the Republic of Panama, arbitration seated in Panama City | S1 section 10.5 |
| who may trade perpetuals | users who complete KYC and are not residents, citizens or located in a restricted jurisdiction | S1 section 6.11, S2 |
| restricted jurisdictions | Afghanistan, China, Cuba, Democratic Republic of the Congo, Iran, Libya, Mali, Myanmar, North Korea, Panama, South Sudan, Sudan, Syria, Taiwan, United States | S2, and the same 15 in S1 section 6.11 |
| United States | excluded | S1, S2 |
| Canada | not on the list | S2 |
| relation to WOO X | the same operator name as WOO X, whose terms exclude Canada as well, see [`../woo/fees.md`](../woo/fees.md) section 1, while WOO X Pro's list does not | S1, S2 |
| history | "NovaEX is officially rebranding to WOO X Pro", rollout "Tentatively 16 Dec 2025", with accounts, positions and history carried over | S3 |
| platform | the futures web front end is BitMart's futures client served from `cdn-frontend.wooxpro.com`, which preconnects to `contract.bitmart.com` and reports errors to `sentryingest-v2.bitmart.com`, and the developer docs carry BitMart's Mintlify favicon path | S9, S10 |

So WOO X Pro and WOO X share an operator name and the WOO token, and nothing else this survey can see.
A US person may not trade WOO X Pro perpetuals.
Its published list does not exclude Canada, where this host's VPN exit sits, and the public API answered every call from that exit, see [`rest.md`](./rest.md) section 1.

How each source was read on 2026-10-09 local time:

- `support.wooxpro.com/hc/...` article pages answered HTTP 403 with a Cloudflare "Just a moment..." page to curl.
- The same articles came back with HTTP 200 from `https://support.wooxpro.com/api/v2/help_center/en-us/articles.json?per_page=100`, which listed all 58 articles in one page.
- The developer documentation at `https://developer.wooxpro.com/` served Markdown for each page with a `.md` suffix, and `https://developer.wooxpro.com/llms.txt` indexed them.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 % (200 ppm) | 0.06 % (600 ppm) | S4 "Regular Users" row, "Futures Fee Rate" `0.0200%/0.0600%`, and S5 "Maker Fee (0.020%)", "Taker Fee (0.060%)" |
| USDC-M perpetual (`BTCUSDC`) | 0.02 % (200 ppm) | 0.06 % (600 ppm) | S4 shows one futures column for every futures product |
| coin-M perpetuals (`BTCUSD`, `ETHUSD`, `XRPUSD`, `SOLUSD`) | 0.02 % (200 ppm) | 0.06 % (600 ppm) | S4, as above |

The documented private call `GET /contract/private/trade-fee-rate` returns an account's own rates, and its example reads `"taker_fee_rate": "0.0006"`, `"maker_fee_rate": "0.0002"`, S6.
It needs an API key, so it was not called.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT-M perpetuals | yes, 354 `Trading`, 95 with 24 h volume | `GET /contract/public/details`, [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | yes, 1 `Trading` (`BTCUSDC`) | as above |
| coin-M perpetuals | yes, 4 `Trading` (`BTCUSD`, `ETHUSD`, `XRPUSD`, `SOLUSD`) | as above, `quote_currency` `USD` with contract sizes 100 and 10 |
| TradFi perpetuals (stocks, indices, FX, metals) | yes, 158 `Trading` rows carry `tradfi_info`, 3 of them with 24 h volume | as above, and S7 |
| dated futures | no | `product_type` is 1, perpetual, on all 1,215 rows, while the docs define 2 as futures, S6 |
| options | no | none in the docs or the site menu |
| spot | yes on the site, which lists Spot and a spot fee schedule in four asset classes | S4, and the site menu. The developer docs cover futures only, and `GET /spot/v1/symbols` answered HTTP 200 with `{"code":-107,"message":"divide:Can not find selector, please check your configuration!"}`, so no public spot API was found |

## 4. Perpetual tiers

From the image embedded in S4, dated 2026-04-23.
A user qualifies for a level by meeting any one of the four criteria, re-evaluated daily at 00:00 UTC+8, S4.

| level | 30 day futures volume (USD) | 30 day spot volume (USD) | asset balance (USD) | daily average WOO held | futures maker | futures taker | futures taker ppm |
|---|---|---|---|---|---|---|---|
| Regular Users | < 10.00m | < 10.00m | < 20.00k | < 1.00m | 0.0200 % | 0.0600 % | 600 |
| V1 | ≥ 10.00m | ≥ 10.00m | ≥ 20.00k | ≥ 1.00m | 0.0150 % | 0.0450 % | 450 |
| V2 | ≥ 50.00m | ≥ 50.00m | ≥ 100.00k | ≥ 5.00m | 0.0100 % | 0.0350 % | 350 |
| V3 | ≥ 100.00m | ≥ 100.00m | ≥ 400.00k | ≥ 20.00m | 0.0050 % | 0.0250 % | 250 |
| V4 | ≥ 200.00m | ≥ 200.00m | ≥ 0.60m | ≥ 30.00m | 0.0000 % | 0.0200 % | 200 |
| V5 | ≥ 0.50b | ≥ 0.50b | ≥ 1.00m | ≥ 50.00m | 0.0000 % | 0.0150 % | 150 |

Spot, for the coverage matrix only: Regular Users pay 0.1000 %, 0.2500 %, 0.4000 % and 0.6000 % maker and taker alike in classes A to D, and V1 to V5 pay one rate across classes, from 0.0400 % and 0.0800 % down to 0.0000 % and 0.0300 %, S4.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| WOO holding | a daily average of 1,000,000 WOO or more lifts a user to V1 and above, sampled by random hourly snapshots | S4 |
| asset balance | 20,000 USD or more across spot, futures, copy trading and earn lifts a user to V1 | S4 |
| VIP sharing | proof of VIP status on another venue grants the matching level for 14 days, once per KYC account | S4 |
| referral, market maker, zero fee promotions | Not publicly specified in the 58 help center articles | S8 listing |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative | S11 |
| fee taken by the venue | none, "WOO X Pro does not charge a fee for funding" | S11 |
| formula | "Funding Fee = Position Value × Funding Rate" | S11 |
| schedule | "every 8 hours" at 00:00, 08:00 and 16:00 UTC, with "funding rates may vary for certain trading pairs" | S11 |
| interval on the wire | 8 h on 216 `Trading` contracts, 4 h on 141 and 1 h on 2 | `funding_interval_hours`, [`rest.md`](./rest.md) section 2 |
| cap and floor | ±3.75 % on `BTCUSDT` and `ETHUSDT` | `funding_upper_limit` `"0.0375"` and `funding_lower_limit` `"-0.0375"` on `GET /contract/public/funding-rate` and on the WebSocket `futures/fundingRate` frame, [`rest.md`](./rest.md) section 4 |
| who is charged | holders of an open position "at the exact second of settlement" | S11 |

## 7. Liquidation, settlement and delisting

- A liquidated position is closed at the bankruptcy price, and the closing fee is charged at the taker rate, so the worked example uses 0.0006, S12.
- The margin left between the bankruptcy price and the fill is the "Liquidation Clearance Fee", paid to the insurance fund, S12.
- No dated futures exist, so no settlement fee applies.
- Delistings are announced in the help center, for example 2026-07-31 for pairs delisted on 2026-08-05, S8.
  No delisting fee is published.

## 8. CCXT

CCXT 4.5.68 has no WOO X Pro class.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` contains `wooxpro` or `novaex`, and its `woo.js` and `woofipro.js` are WOO X and WOOFi Pro, other venues.
The current CCXT source on GitHub, `ts/src` on `master` at version 4.5.85, read on 2026-10-09, lists `woo.ts` and `woofipro.ts` and no WOO X Pro class, S13.
That listing has no `bitmart.ts` either, so CCXT master no longer ships the BitMart class.

The 4.5.68 `bitmart` class speaks the same futures API, but pointed at WOO X Pro it does not fit as it stands.

- It builds its swap host as `https://api-cloud-v2.{hostname}`, at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/bitmart.js` lines 117 and 122, and `api-cloud-v2.wooxpro.com` does not resolve, so its URL would have to be replaced with `https://cloud-api.wooxpro.com`.
- Its swap markets take `taker` from the class constant `0.0040` at line 303 through line 1109, which is 4,000 ppm and not WOO X Pro's 600.
- It labels every contract `settle` USDT and `linear` true, at lines 1117 and 1145, so the four coin-M contracts would be mislabelled.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 futures taker 0.06 %, S4 and S5 |
| `ccxtTakerPpm` | none | no CCXT class exists. A repointed `bitmart` class would report 4,000, see section 8, which is not a fee this venue charges |

## 10. Source ledger

| id | source | url | retrieved | applies to | used for |
|---|---|---|---|---|---|
| S1 | WOO X Pro User Agreement, updated 2026-09-22 | https://support.wooxpro.com/api/v2/help_center/en-us/articles/52752948871961.json | 2026-10-09 | Wootech Limited Corp. | operator, law, restricted list |
| S2 | List of unsupported countries/regions, updated 2026-03-06 | https://support.wooxpro.com/hc/en-us/articles/55760153017881--List-of-unsupported-countries-regions, read through the articles API | 2026-10-09 | all users | restricted jurisdictions |
| S3 | Transition Guide: NovaEX is now WOO X Pro, updated 2026-02-19 | https://support.wooxpro.com/hc/en-us/articles/53284195142681-Transition-Guide-NovaEX-is-now-WOO-X-Pro, read through the articles API | 2026-10-09 | all users | history |
| S4 | WOO X Pro VIP Program: Eligibility, Benefits, and Methodology, 2026-04-23, and its table image | https://support.wooxpro.com/hc/en-us/articles/57154853232793, image https://support.wooxpro.com/hc/article_attachments/57258828941977 | 2026-10-09 | all users | tiers, VIP 0 rates |
| S5 | Calculation of Trading Fees on WOO X Pro, updated 2026-02-20 | https://support.wooxpro.com/hc/en-us/articles/55324207140761, read through the articles API | 2026-10-09 | perpetuals | VIP 0 maker and taker |
| S6 | Developer docs: Get Contract Details and Get Trade Fee Rate | https://developer.wooxpro.com/english/restful_public/symbol-detail.md and https://developer.wooxpro.com/english/trading/trade-fee-rate.md | 2026-10-09 | futures API | product types, private fee call |
| S7 | WOO X Pro TradFi: Trade Global Markets with Crypto | https://support.wooxpro.com/hc/en-us/articles/58499481910553, read through the articles API | 2026-10-09 | TradFi perpetuals | coverage |
| S8 | Help center article listing, 58 articles | https://support.wooxpro.com/api/v2/help_center/en-us/articles.json?per_page=100 | 2026-10-09 | all | delisting notices, absence of promotions |
| S9 | Futures front end HTML and bundles | https://derivatives.wooxpro.com/en-US and `https://cdn-frontend.wooxpro.com/futures-frontend/client/*.js` | 2026-10-09 | platform | BitMart client |
| S10 | Developer docs index and an HTML page of the docs | https://developer.wooxpro.com/llms.txt and https://developer.wooxpro.com/english/websocket/overview | 2026-10-09 | futures API | page list, and the favicon path `/mintlify-assets/_mintlify/favicons/bitmart/` |
| S11 | Funding Rate and Settlement, updated 2026-05-16 | https://support.wooxpro.com/hc/en-us/articles/55311526612505, read through the articles API | 2026-10-09 | perpetuals | funding rules |
| S12 | WOO X Pro Perpetual Futures 2.0: Liquidation and Bankruptcy Mechanism | https://support.wooxpro.com/hc/en-us/articles/55758308245657, read through the articles API | 2026-10-09 | perpetuals | liquidation charges |
| S13 | CCXT `ts/src` on `master`, package version 4.5.85 | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master and https://raw.githubusercontent.com/ccxt/ccxt/master/package.json | 2026-10-09 | CCXT | absence of a class |
| S14 | CCXT 4.5.68 `bitmart.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/bitmart.js` | 2026-10-09 | CCXT | lines 117, 122, 303, 1109, 1117, 1145 |
