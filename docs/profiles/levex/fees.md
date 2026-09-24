# LeveX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:13 to 03:39 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the perpetual fees of LeveX, which has no CCXT class and says it offers no API, see [`rest.md`](./rest.md) section 2.
LeveX lists USDT-margined, USDC-margined and coin-margined perpetuals, and all three are covered.
The fee tier table on the fee page is loaded from the web client's REST host, which refuses this host with HTTP 403, so the tiers below come from the help center and the blog only.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 | |
| operator | "Levex Trading Platform", with no incorporated entity, registry number or address named in either agreement | S8, S9 |
| country | Panama, founded 2023, per CoinGecko's listing only | S13 |
| launch | "Since launching in October 2023" | S16 |
| licence | none named on the about, compliance or agreement pages | S8, S9, S16 |
| who may trade | registered users outside the Prohibited Countries who pass identity verification under LeveX's KYC and AML policies | S8 |
| excluded regions, User Agreement of 2024-10-25 | United Arab Emirates, North Korea, Cuba, Sudan, Syria, Iran, Crimea, Mainland China, Indonesia, Singapore, Venezuela, and the United States | S8 |
| excluded regions, Terms of Use of 2023-10-26 | the same list plus "Europe, and United Kingdom", declared "non-exclusive and is subject to change" | S9 |
| US persons | may not trade, under both documents | S8, S9 |
| automated access | both documents say "You may not (i) use any deep linking, web crawlers, bots, spiders or other automatic devices, programs, scripts, algorithms or methods … to access, obtain, copy or monitor any part of the properties" | S8, S9 |
| API | "We don't currently offer an API, but it's something we're exploring for the future.", last updated 2025-04-30 | S1 |

The two agreements are both linked from the site footer on 2026-09-22 and disagree on Europe and the United Kingdom.
Both exclude the United States.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S2, S3 |
| USDC-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S2, S3 |
| coin-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S2, S3 |
| spot, context only | 0.1 %, 1,000 ppm | 0.1 %, 1,000 ppm | S3 |

The help center gives one futures rate, "our standard Maker fee is 0.02% and Taker fee is 0.06%", without naming a family, S2.
The fee structure guide of 2025-05-22 gives the same "0.02% for makers and 0.06% for takers at the VIP 0 level", S3.
A per family rate could only come from the tier table, which this host cannot read, see section 4.

## 3. Coverage matrix

Counts are from the web client socket's all market ticker, identical in four runs from 03:17 to 03:37 UTC on 2026-09-23, where a listed contract with a mark of 0 is counted as inactive, see [`rest.md`](./rest.md) section 2.

| product | present | listed | active | note |
|---|---|---|---|---|
| USDT-M perpetuals | yes | 298 | 254 | includes stock, ETF and commodity perpetuals such as `XAUUSDT`, `CLUSDT`, `KOUSDT`, `RDDTUSDT` and `SOXLUSDT`, traded 24/7, S10 |
| USDC-M perpetuals | yes | 22 | 22 | `BTCUSDC` and 21 others |
| coin-M perpetuals | yes | 12 | 10 | spelled `cBTCUSD`, margined and settled in the coin, S7 |
| dated futures | no | | | CoinGecko lists 0 futures pairs, S13, and the socket lists none |
| options | no | | | not in the site navigation or among the 532 sitemap URLs, S17 |
| spot | yes | | | `/en/spot/trade`, and CoinGecko ranks the spot venue 54th, S13 |

The 286 active contracts equal CoinGecko's 286 perpetual pairs, split 254, 22 and 10 there as well, S13.
The 46 inactive rows include `DENTUSDT`, `FLOWUSDT`, `HIGHUSDT`, `LISTAUSDT` and `1000SATSUSDT`, each of which has a delisting post in the sitemap, S17.

## 4. Perpetual tiers

The tier table is Not publicly readable from this host.
The fee page renders "Loading..." until the browser loads the levels from `api100.levex.com`, where the web client's `VipLevels` call is `/service-user-manage/vip/public/levels`, S16, and that host answered 403 to every request from this machine, see [`rest.md`](./rest.md) section 1.
A fetch of the page from outside this host also returned the table as "Loading...", S4.
The probe did not route around the refusal.

What the public pages do say:

| claim | source |
|---|---|
| seven levels from 2026-07-13: VIP 0, then Silver, Gold, Platinum, Ruby, Diamond, Emerald and Ultimate, replacing 25 old levels, "keeps today's fees" | S5 |
| an invite-only Chairman status in parallel, and a VIP Transfer from another exchange | S5, S15 |
| "Perpetual maker/taker fees can be as low as 0.006%/0.03%", from 2025-02-07 | S6 |
| "fees can be reduced by over 90% compared to the standard rates" at the highest levels | S3 |
| "fee reductions of 80% and more", and a VIP Transfer from Binance, Bybit or OKX with a 30 day VIP+1 trial and "Fee rates as low as 33% of standard" | S15 |

The lowest published perpetual rates, 0.006 % maker and 0.03 % taker, are 60 ppm and 300 ppm.

### Qualification

"Reach either the trading volume or account balance threshold to qualify for a tier." and "VIP level is calculated based on your 30-day trading volume or current account balance.", S4.
Spot and perpetual volume count together, S3.
The thresholds themselves are in the unreadable table.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| VIP level | see section 4 | S4, S5 |
| referral | a referrer may give up part of a commission of up to 30 %, "keep 20% while giving them a 10% discount" | S12 |
| Futures Voucher | "only covers trading fees", a bonus rather than a rate | S11 |
| Futures Credit | margin that "covers up to 50% of your trading fees and losses" on some credit types | S11 |
| fee discount bonus | the web bundle has a `/service-user-manage/bonus/fee-discount-bonus/pick-up` call, terms Not publicly specified | S16 |
| token holding | none found on the fee, VIP, help center and agreement pages read for this profile | |
| zero fee promotion | none found on 2026-09-22 | |

None of these changes the VIP 0 rate a new account pays, so the engine's taker stays 600 ppm.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | "every 8 hours on LeveX at specific timestamps: 00:00 UTC, 08:00 UTC, and 16:00 UTC" | S7, S2 |
| per contract interval | a `fundingInterval` field in seconds exists per contract in the web client, the countdown is `interval - now mod interval`, value Not readable here | S16 |
| formula | "the price difference between the perpetual contract price and the spot price, combined with an interest rate component", no equation published | S7 |
| cap and floor | `fundingCap` and `fundingFloor` fields exist per contract in the web client, values Not readable here | S16 |
| who pays | longs pay shorts when the rate is positive, and only positions held at the timestamp pay | S7 |
| amount | "Funding Fee = Position Size × Funding Rate" | S7 |
| coin-M | paid and received in the coin | S7 |
| observed rates | on 286 active contracts at the end of run 4, 03:38 UTC: 150 at 0.0001, 132 at 0.00005, and 4 others, `MTLUSDT` at -0.003067, `BTCUSDT` at -0.000214, `BTCUSDC` at 0.000097 and `cBNBUSD` at 0.00011. The 150 and 132 held in every run | P2 |

A rate of exactly 0.0001 or 0.00005 on 282 of 286 contracts looks like an interest term with a premium dead band, but LeveX publishes no formula, so that reading is an inference.
Whether the 0.00005 group settles every 4 hours is Not verified, because the interval sits in the refused catalog.
The funding history endpoint `/service-perpetual/trading/public/funding-rate` answered 403, so no settlement was read from history, and no settlement instant was captured.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation | when "neither the position's margin nor your account's available margin could cover" the loss | S2 |
| liquidation fee | Not publicly specified | |
| insurance fund and ADL | an insurance fund covers losses beyond margin, then auto-deleveraging reduces opposing profitable positions | S2 |
| settlement or delivery fee | none, there are no dated contracts | |
| delisting | 13 delisting posts in the sitemap, such as `delist-dentusdt-perpetual-contract`, whose bodies did not render outside a browser, terms Not verified | S17 |

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `lev` or `vex`, and `grep -ril levex` over `server/node_modules/ccxt/js/src` finds nothing | P1 |
| CCXT master on GitHub | no LeveX file among the 105 files in `ts/src` at commit `fbc5f21` of 2026-09-22 10:33 UTC, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/levex.ts` returns 404 | S14 |
| exchange requests | a GitHub issue search for `levex` in `ccxt/ccxt` returns 0 results | S14 |
| `market.taker` for a swap | none, since there is no class to load | |

There is no CCXT source line to cite, and no `ccxtTakerPpm` to declare.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600, if a leg were ever built | the VIP 0 futures taker of 0.06 %, S2 and S3 |
| `ccxtTakerPpm` | unset | CCXT has no LeveX class |

No registry entry is recommended.
Every venue in [`registry.ts`](../../../server/src/venues/registry.ts) builds its catalog from a CCXT class through [`connector.ts`](../../../server/src/ccxt/connector.ts), which calls `loadMarkets` at line 68.
LeveX has no class, says it has no API, and forbids scripts from monitoring its site, see section 1.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Miscellaneous, "Do you offer an API?", last updated 2025-04-30 | https://levex.com/en/support/miscellaneous | 2026-09-22 | LeveX, global | no API, sections 1 and 8 |
| S2 | Futures and Products FAQs, dated 2023-10-07 | https://levex.com/en/support/futures-and-products-faqs | 2026-09-22 | LeveX, global | families, VIP 0 futures fees, 8 h funding, ADL, insurance fund, sections 2, 6, 7 |
| S3 | Understanding the LeveX Fee Structure, dated 2025-05-22 | https://levex.com/en/support/understanding-levex-fee-structure | 2026-09-22 | LeveX, global | VIP 0 futures and spot fees, over 90 % reduction, sections 2 and 4 |
| S4 | Fees and Conditions page | https://levex.com/en/fees-conditions | 2026-09-22 | LeveX, global | qualification text, the table renders "Loading...", read here and through WebFetch, section 4 |
| S5 | The New LeveX VIP Program Is Live, dated 2026-07-13 | https://levex.com/en/blog/new-levex-vip-program-launch | 2026-09-22 | LeveX, global | seven levels, Chairman, VIP Transfer, section 4 |
| S6 | Levex Fees Update, dated 2025-02-07 | https://levex.com/en/blog/trading-fees-update | 2026-09-22 | LeveX, global | lowest perpetual rates, section 4 |
| S7 | Understanding Funding Fees, dated 2023-09-26 | https://levex.com/en/support/understanding-funding-fees | 2026-09-22 | LeveX, global | funding times, direction, formula wording, coin-M, section 6 |
| S8 | Levex User Agreement, last updated 2024-10-25 | https://levex.com/en/user-agreement | 2026-09-22 | LeveX, global | operator, Prohibited Countries, automated access, section 1 |
| S9 | Levex Terms Of Use, last updated 2023-10-26 | https://levex.com/en/support/levex-terms-of-use | 2026-09-22 | LeveX, global | Prohibited Countries with Europe and UK, automated access, section 1 |
| S10 | Stock and Commodity Perpetuals FAQ, dated 2026-05-20 | https://levex.com/en/support/stock-commodity-perpetuals-faq | 2026-09-22 | LeveX, global | 24/7 stock and commodity perpetuals, section 3 |
| S11 | Futures Credit/Vouchers FAQ, dated 2025-07-28 | https://levex.com/en/support/futures-credit-faq | 2026-09-22 | LeveX, global | voucher and credit, section 5 |
| S12 | LeveX Referral Program FAQ, dated 2025-07-17 | https://levex.com/en/support/referral-program-faq | 2026-09-22 | LeveX, global | referral discount, section 5 |
| S13 | CoinGecko API, `derivatives/exchanges/levex-futures` and `exchanges/levex` | https://api.coingecko.com/api/v3/derivatives/exchanges/levex-futures?include_tickers=unexpired | 2026-09-22 | third party | 286 perpetual pairs by quote, 0 futures pairs, Panama, spot rank 54, sections 1 and 3 |
| S14 | CCXT GitHub, `ts/src` listing, raw `levex.ts`, and issue search | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no class in master, section 8 |
| S15 | LeveX VIP page | https://levex.com/en/vip | 2026-09-22 | LeveX, global | 80 % and 33 % claims, trial, VIP Transfer, section 4 |
| S16 | LeveX about page and web JavaScript bundles `app-FiYwroKJ.js`, `app-BabnG6Gd.js`, `worker-trade-ARXVGGSP.js` | https://levex.com/en/about and https://static.levex.com/102/js/app-BabnG6Gd.js | 2026-09-22 | LeveX, global | launch date, `VipLevels` path, `fundingInterval`, `fundingCap`, `fundingFloor`, countdown, fee discount call, sections 1, 5, 6 |
| S17 | LeveX sitemap | https://levex.com/sitemap.xml | 2026-09-22 | LeveX, global | 532 URLs, 13 delisting posts, no options, sections 3 and 7 |
| P1 | `rest-probe.mjs` at 03:27 UTC, and at 03:36 UTC in the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/levex/rest-probe.mjs) | 2026-09-22 | this host | CCXT ids, 403 on the tier and funding calls, sections 4, 6, 8 |
| P2 | `ws-probe.mjs book`, runs 1 and 2 at 03:17 and 03:22 UTC, runs 3 and 4 at 03:34 and 03:37 UTC in the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/levex/ws-probe.mjs) | 2026-09-22 | this host | contract counts, funding rates, sections 3 and 6 |
