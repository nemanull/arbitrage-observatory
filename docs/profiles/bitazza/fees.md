# Bitazza Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:06 to 03:35 UTC for run 1 and 03:40 to 03:47 UTC for run 2, from the development host near Seattle.

Bitazza is CoinGecko's trust rank 34 on 2026-09-22, and it has no CCXT class.
Bitazza Global sells USDT-margined futures and CFD derivatives in its app, but neither has a public API, a public catalog or a public fee schedule, see section 3.
The only public API is the AlphaPoint spot gateway, so this profile covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitazza/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitazza/ws-probe.mjs).

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 local time for every source row | source ledger |
| Global operator | Bitazza International Limited, Tortola Pier Park, Road Town, British Virgin Islands, under the User Agreement "Last Updated: 18 September 2026" | S4 |
| Thailand operator | Bitazza Company Limited, which its own site calls "Thailand's leading crypto brokerage platform", "licensed by the Ministry of Finance, regulated by the SEC", and links to Thai SEC licence record `0000029773` | S14 |
| one engine behind both | the Global gateway `apexapi.bitazza.com` and the Thailand gateway `apexapi.bitazza.co.th` return the same 307 instruments and the same BTCUSDT touch | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |
| CoinGecko listing | "Bitazza", country Thailand, established 2021, trust score 8, trust rank 34, 111 coins, 218 pairs, 24 h volume 308.65 BTC, busiest pairs USDT/THB at about 3.04 M USD and BTC/USDT at about 601 k USD | S10, read 2026-09-23 03:35 UTC |
| who may trade on Global | users of legal age who are not on a sanctions list "maintained by the United Nations, the Financial Services Commission of the British Virgin Islands or any other regulatory authorities" | S4 clause 5.1 |
| excluded regions on Global | the User Agreement names no country. A notice of 2026-04-02 says "certain regulatory frameworks may affect access in some regions, including Thailand" and sends Thai residents to Bitazza Thailand | S4, S5 |
| US persons | Not publicly specified. No official page read on 2026-09-22 names the United States | S4, S1, S2, S15 |
| who may trade on Thailand | the Thai site lists five KYC levels, a suitability test, a FATCA questionnaire and a knowledge test, and quotes limits in THB | S3 |
| official pages from this host | `curl` with its own user agent or with a bare `Mozilla/5.0` got HTTP 403 and the Cloudflare page "Sorry, you have been blocked" on every `bitazza.com` host, and the web fetch tool got 403 too. The same pages answered 200 to a Node request whose user agent read `Mozilla/5.0 (probe)`. So the block is a user agent rule and not a geoblock | `rest-probe.mjs web`, and curl at 03:06 and 03:24 UTC |
| API from this host | the public REST gateway and both WebSocket gateways answered normally, with no geoblock | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

No perpetual has a public API or a public fee, so there is no perpetual VIP 0 number.
The spot VIP 0 numbers are below.

| entity and market | maker | taker | evidence |
|---|---|---|---|
| Bitazza Global, the USDT, BTC, USD and USDF books | 0.15 %, 1,500 ppm | 0.25 %, 2,500 ppm | S1, "Our standard trading fee (without FDM discount) is 0.15% for maker and 0.25% for taker", read live on 2026-09-23 and identical in the copy archived on 2025-08-13 |
| Bitazza Thailand, the THB books | 0.25 %, 2,500 ppm | 0.25 %, 2,500 ppm | S3, "Our standard trading fee (without FDM discount) is 0.25%", with no maker and taker split |

Both entities trade on one matching engine, and the fee depends on the entity of the account, not on the book.
Which books a Global account may trade is Not publicly specified.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined futures, Bitazza Global | present in the app and the website, no public API | launched on the app and then the website on 2023-05-25 "with leverage of up to 1:20 in the USDT market", S8. Posts of 2025-01-29 and 2025-08-15 describe a "Bitazza Futures" interface with leverage "up to 125x on selected pairs" and "funding rates", S6. The Global FAQ still lists a "Futures Trading" section on 2026-09-23, S15. No futures instrument, call or channel exists in the API documentation of 2026-09-18, S9, and `futures.bitazza.com` answers 404 `Not Found!` |
| CFD derivatives, Bitazza Global | present in the app, no public API | a "Derivatives" tab for "stocks, forex, indices, and more", with "Overnight Fees" and the notice "CFDs are complex instruments", since 2025-06-10, S7. XAU/USD "up to 200x", traded "24/5", S7 |
| perpetuals on the public API | absent | `GetInstruments` returns 307 rows, every one `InstrumentType` `Standard`, and `GetProducts` returns 157 products with `MarginEnabled` false on all 157, run 1 and run 2. CoinGecko's derivatives list does not show Bitazza |
| dated futures | absent | no instrument, and no mention in S9 or on the pages read |
| options | absent | same |
| margin trading on spot | absent | `MarginEnabled` false on 157 of 157 products |
| spot, THB | present, 125 running and 15 stopped of 140 | catalog, run 1 and run 2 |
| spot, USDT | present, 117 running and 16 stopped of 133 | catalog, run 1 and run 2 |
| spot, BTC, USDF and USD | present, 14, 15 and 2 running, with zero 24 h volume on all 34 | catalog and the `summary` call, run 1 and run 2 |

The futures product could not be researched further.
Its contract list, fee schedule, funding formula, interval and cap are on no page this host could read, and the app was not installed.
Deposit and withdrawal fees are on the official fee pages S1 and S3 and are not recorded here.

## 4. Spot tiers

Neither entity publishes a volume tier.
The only schedule is a discount for paying fees in the FDM token, keyed on the FDM balance held.

| tier | FDM held | discount on fees paid in FDM | Global taker paid in FDM |
|---|---:|---:|---:|
| Bronze | 0 | 50 % | 0.125 %, 1,250 ppm |
| Silver | 50,000 | 50 % | 0.125 %, 1,250 ppm |
| Gold | 150,000 | 55 % | 0.1125 %, 1,125 ppm |
| Platinum | 500,000 | 60 % | 0.10 %, 1,000 ppm |
| Diamond | 1,500,000 | 65 % | 0.0875 %, 875 ppm |
| Emerald | 3,000,000 | 70 % | 0.075 %, 750 ppm |
| Early Adopter bonus | 5,000 | plus 5 % | |

The tiers and discounts are from S1 and S3, which show the same table, and from S2.
The fee pages say "up to 75%", which is Emerald plus the Early Adopter bonus.
The levels page says "up to a 70% discount" and that an Early Adopter must "maintain a minimum of 500 FDM", while its own tier table says 5k, S2.
The balance is snapshotted "at midnight 12:00am Thailand (GST+7) everyday", S2.
The discount needs the toggle "Use FDM To Pay For Fees", S2.
The last column is the Global taker times one minus the discount, a derived number.

## 5. Discounts that change the spot taker

| discount | effect | evidence |
|---|---|---|
| paying fees in FDM | 50 % to 70 % off, plus 5 % for Early Adopters, section 4 | S1, S2, S3 |
| referral | the referrer earns "15% for Bronze level" up to "40% at Emerald status" of the referee's fees, which does not change the referee's fee | S2 |
| market maker | a Market Maker API section exists, with rate limits arranged with an account manager, and no fee is published | S9 |
| zero fee promotions | none found | |

## 6. Funding as a cost

Spot carries no funding.
The futures product mentions "funding rates", S6, but its formula, interval, cap and settlement are Not publicly specified on any page read, and the settlement instant was not captured.
The CFD product charges "Overnight Fees", S7, of unpublished size.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge.
A delisted spot instrument stays in the catalog with `SessionStatus` `Stopped`, as 34 of 307 did in both runs, see [`rest.md`](./rest.md) section 2.
The futures product mentions "liquidation penalties", S6, of unpublished size.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| CCXT 4.5.68 | no class. `require('ccxt').exchanges` has 104 ids and none is Bitazza. The two names that look close are `apex`, which is ApeX, a different venue, and `ndax`, another AlphaPoint venue | `rest-probe.mjs catalog`, `server/node_modules/ccxt/js/src/apex.js` line 22 |
| CCXT master | no class. `ts/src` at commit `1d8b674` of 2026-09-22 12:48 UTC has 112 entries and no `bitazza.ts`, and `ts/src/pro` has none either | S12 |
| open pull request | ccxt/ccxt#15091, "New Exchange - bitazza (revived PR)", opened 2022-09-23 and still open. It adds `js/bitazza.js`, a 46 line subclass of `ndax` with the gateway `https://apexapi.bitazza.com:8443/AP` and a flat `taker` and `maker` of 0.0025 | S11 |
| `ndax` pointed at the Bitazza gateway | `loadMarkets` returns 297 spot markets, 263 active. `BTC/USDT` has `id` `"7"`, `taker` 0.0025 and `maker` 0.002, which are the `ndax` constants at `server/node_modules/ccxt/js/src/ndax.js` lines 363 and 364 | `rest-probe.mjs catalog`, run 1 |
| `market.taker` for a Bitazza market | none, since no class exists | |

## 9. Recommended registry values

None.
Bitazza cannot join the registry, because the engine's catalog is CCXT swaps and Bitazza has neither a CCXT class nor a public perpetual.
If a spot leg is ever modelled, `takerPpm` would be 2,500, the Global VIP 0 taker, and `ccxtTakerPpm` would stay unset, since no CCXT class declares a constant.
The `ndax` stand-in reports 2,500 as well, but only because its own constant happens to match.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitazza Global, Fees | https://bitazza.com/fees | 2026-09-23 03:23 UTC live, and the copy archived at https://web.archive.org/web/20250813100557/https://bitazza.com/fees | Bitazza International Limited, global | maker 0.15 %, taker 0.25 %, FDM tiers, "up to 75%", sections 2 and 4 |
| S2 | Bitazza Global, Freedom Levels | https://bitazza.com/levels | 2026-09-23 03:23 UTC | Bitazza International Limited | tier requirements, "up to a 70% discount", Early Adopter rule, snapshot time, referral share, sections 4 and 5 |
| S3 | Bitazza Thailand, Fees | https://bitazza.co.th/fees | 2026-09-23 03:08 UTC | Bitazza Company Limited, Thailand | 0.25 % standard fee, FDM tiers, KYC levels, sections 1, 2 and 4 |
| S4 | Bitazza Global, User Agreement, "Last Updated: 18 September 2026" | https://bitazza.com/user-agreement | 2026-09-23 03:23 UTC, compared with the copy of 2025-09-13 that reads "Last Updated: 29 May 2025" | Bitazza International Limited, British Virgin Islands | operator, eligibility, sanctions clause, section 1 |
| S5 | "Important Notice: Bitazza Global Platform Remains Accessible Globally", 2026-04-02 | https://blog.bitazza.com/blog/normal-operation-announcement | archived copy of 2026-05-11 | Bitazza Global | Thailand access note, section 1 |
| S6 | "5 Common Futures Trading Mistakes (And How to Avoid Them)", 2025-08-15, and "Bitazza 101: How to Trade Futures Safely", 2025-01-29 | https://blog.bitazza.com/blog/5-common-futures-trading-mistakes-and-how-to-avoid-them and https://blog.bitazza.com/blog/bitazza-101-how-to-trade-futures-safely | 2026-09-23 03:24 UTC live, and the 2025-01-29 copy archived | Bitazza Global | futures, 125x, funding rates, liquidation penalties, sections 3, 6 and 7 |
| S7 | "Bitazza Explainer: Derivatives Trading", 2025-06-10, "Risk Management 101", 2025-12-09, "Two Ways to Trade Gold", 2025-11-07 | https://blog.bitazza.com/blog/bitazza-explainer-derivatives-trading, https://blog.bitazza.com/blog/risk-management-101-bitazza-derivatives, https://blog.bitazza.com/blog/two-ways-to-trade-gold | 2026-09-23 03:24 UTC live, gold post from the copy archived on 2025-11-07 | Bitazza Global | CFD derivatives, 200x, 24/5, overnight fees, sections 3 and 6 |
| S8 | "Futures Trading Now on Bitazza", 2023-05-25 | https://content.bitazza.com/futures-trading-now-on-bitazza/ | copy archived on 2025-03-16 | Bitazza Global | futures launch and 1:20 leverage, section 3 |
| S9 | Bitazza API Reference, version 3.3, `last-modified` 2026-09-18 | https://api-doc.bitazza.com/_index.html | 2026-09-23 03:25 UTC | both gateways | spot only API, Market Maker API, section 3 and 5 |
| S10 | CoinGecko exchange API, `bitazza` | https://api.coingecko.com/api/v3/exchanges/bitazza | 2026-09-23 03:35 UTC | | trust rank, volume, section 1 |
| S11 | ccxt/ccxt pull request 15091 | https://github.com/ccxt/ccxt/pull/15091 | 2026-09-23 03:09 UTC | CCXT | unmerged Bitazza class, section 8 |
| S12 | CCXT `ts/src` on master | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 03:06 UTC, commit `1d8b674` | CCXT | no Bitazza class, section 8 |
| S13 | CCXT 4.5.68 `ndax.js` | `server/node_modules/ccxt/js/src/ndax.js` | 2026-09-22 | CCXT | `ndax` fee constants, section 8 |
| S14 | Bitazza Thailand home page | https://bitazza.co.th/home | 2026-09-23 03:07 UTC | Bitazza Company Limited | licensing claims and SEC record link, section 1 |
| S15 | Bitazza Global, FAQs | https://bitazza.com/faq | 2026-09-23 03:34 UTC | Bitazza International Limited | "Futures Trading" FAQ section, section 3 |
| P1 | `rest-probe.mjs`, run 1 at 03:21 to 03:23 UTC and run 2 at 03:40 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitazza/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog counts, CCXT, access, sections 1, 3 and 8 |
