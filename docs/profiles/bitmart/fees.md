# BitMart Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:19 and 03:41 UTC on 2026-09-23, and again between 03:48 and 03:56 UTC in the second pass.

This profile covers the fees of BitMart Futures (CCXT id `bitmart`) for every perpetual family it lists, from the published schedule, the help center and the public API.
Spot is named in the coverage matrix only, as the survey plan's scope guard asks.
The help center at `support.bitmart.com` redirects to `bitmart.zendesk.com`, whose HTML pages answer this host with HTTP 403.
Its public Help Center API, `https://bitmart.zendesk.com/api/v2/help_center/en-us/articles/<id>.json`, answered 200 with each article body, so the articles below were read that way and are cited by their `html_url`.
The fee page at `https://www.bitmart.com/fee/en` redirects to `https://www.bitmart.com/en-US/fee` and answered 200, and its tier table is the `ABCFeeRateInfo` array in the server rendered `window.__NUXT__` state of that page.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC | this profile |
| contracting entity | GBM Global Inc., Reg. No. 134925, Trust Company Complex, Ajeltake Road, Majuro, Marshall Islands | S3, first paragraph |
| agreement version | the article was updated 2026-09-21, and its body says "Last updated: December 30, 2024" | S3 |
| US persons | excluded. "BitMart ceased accepting new user registrations from the United States in May 2022", and existing US accounts were told on 2026-07-23 to close all spot, margin and futures positions by 2026-08-08 23:59 UTC | S4 |
| BitMart U.S. | a separate platform at `https://www.bitmart.us/`, "subject to BitMart U.S.'s eligibility requirements", not researched here | S4 |
| Mainland China | futures suspended for Chinese residents since June 2021, "Users can only close position and cannot open position" | S5 |
| other regions | no public list of regions excluded from futures was found in S3 or the articles searched. The KYC tutorial says "certain regions require to complete Level 2 - Advanced verification before conducting any futures trade" | S12 |
| API refusal code | `40047` with HTTP 403, "Services is not available in you countries and areas" | S11 error code list, CCXT `server/node_modules/ccxt/js/src/bitmart.js` line 529 |
| securities | "BitMart is not registered with the U.S. Securities and Exchange Commission and does not offer securities services in the United States or to U.S. persons." | S3 |

Nothing on the public side refused this host.
Every REST call and every socket in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md) answered from Seattle, and no call returned 403 or `40047`.
The refusal code applies to a logged in account, which this survey does not open.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | S1 `ABCFeeRateInfo` level 0 `futuresFeeRate` `{"taker":0.0006,"maker":0.0002}`, and S2 "Regular Users" futures `0.0200%/0.0600%` |
| USDC-M perpetual `BTCUSDC` | same schedule, no separate table published | | S1, S2 |
| coin-M perpetuals `BTCUSD`, `ETHUSD`, `XRPUSD`, `SOLUSD` | same schedule, no separate table published. The fee is paid in the coin | | S2, S6 "If you are trading COIN-M futures, you will pay the trading fee based on the coin you are trading." |

The sources disagree on the maker.
The futures tab of the fee page, as served to a signed out visitor, reads `Maker 0.0400%` and `Taker 0.0600%`, S1.
The tier data on the same page and the VIP Level Guide both read maker 0.0200 %, S1 and S2.
The taker is 600 ppm in all three places, and the taker is the number the engine uses.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 354 `Trading`, of which 92 crypto and 3 TradFi traded in the last 24 h | `GET /contract/public/details` on 2026-09-23, `rest-probe.mjs catalog`, see [`rest.md`](./rest.md) section 2 |
| USDT-M TradFi perpetuals, stocks, indices, metals and FX | yes, 158 of the 354 carry `tradfi_info`, 3 traded | same call |
| USDC-M linear perpetual | yes, 1 `Trading`, `BTCUSDC` | same call |
| coin-M inverse perpetuals, quoted in USD | yes, 4 `Trading`: `BTCUSD`, `ETHUSD`, `XRPUSD`, `SOLUSD` | same call, and S6 "COIN-M Futures is denominated in USD" |
| dated futures | no, `product_type` 2 appears on 0 of 1,215 rows | same call |
| options | no public options API is documented in S11 | S11 |
| spot | yes, separate API at `https://api-cloud.bitmart.com`, not researched | S1, CCXT `bitmart.js` line 121 |

CoinGecko's derivatives API listed `bitmart_futures` with 933 perpetual pairs, 0 futures pairs, and 109,314.53 BTC of 24 h volume on 2026-09-23, S14.
The venue's own catalog had 359 `Trading` perpetuals and 856 `Delisted` ones, so the 933 matches neither count.

## 4. Perpetual tiers

The futures schedule from S1 and S2, identical in both.
The level is reassessed "Every day at UTC 00:00 AM", and "take effect two hours later", S1.

| level | maker | taker | maker ppm | taker ppm |
|---|---|---|---:|---:|
| Regular, level 0 | 0.0200 % | 0.0600 % | 200 | 600 |
| VIP 1 | 0.0200 % | 0.0600 % | 200 | 600 |
| VIP 2 | 0.0200 % | 0.0600 % | 200 | 600 |
| VIP 3 | 0.0180 % | 0.0500 % | 180 | 500 |
| VIP 4 | 0.0180 % | 0.0500 % | 180 | 500 |
| VIP 5 | 0.0180 % | 0.0500 % | 180 | 500 |
| VIP 6 | 0.0160 % | 0.0400 % | 160 | 400 |
| VIP 7 | 0.0140 % | 0.0300 % | 140 | 300 |
| VIP 8 | 0.0140 % | 0.0300 % | 140 | 300 |

### Qualification

"You may qualify through any one of the following criteria", S2.

| level | 30 day spot volume, USD | 30 day futures volume, USD | asset balance, USD | BMX holdings plus other assets, USD |
|---|---:|---:|---:|---|
| Regular | under 200,000 | under 1,000,000 | under 8,000 | |
| VIP 1 | 200,000 | 1,000,000 | 8,000 | 2,400 + 4,000 |
| VIP 2 | 500,000 | 10,000,000 | 20,000 | 4,000 + 12,000 |
| VIP 3 | 1,000,000 | 100,000,000 | 50,000 | 5,000 + 35,000 |
| VIP 4 | 2,000,000 | 150,000,000 | 100,000 | 10,000 + 70,000 |
| VIP 5 | 5,000,000 | 200,000,000 | 200,000 | 20,000 + 140,000 |
| VIP 6 | 10,000,000 | 300,000,000 | 500,000 | 50,000 + 350,000 |
| VIP 7 | 20,000,000 | 500,000,000 | 2,000,000 | 100,000 + 1,500,000 |
| VIP 8 | 50,000,000 | 1,000,000,000 | 5,000,000 | 300,000 + 3,700,000 |

The fee page data also carries `assetVolRelation` `OR` and `bmxRelation` `AND` from VIP 1 up, and `AND` for level 0, S1.
The API docs add that "VIP fee I applied for" is updated "on the 8th, 18th and 28th of every month", S11 FAQ Q7.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | source |
|---|---|---|
| BMX fee deduction | the fee page says "All users are allowed to use BMX deduction and get a 25% discount." The BMX article, dated February 15, 2019, describes the 25 % for trades paid in BMX without naming futures. Whether it applies to perpetuals is Not publicly specified | S1, S9 |
| referral | CCXT records a referral `discount` of 0.3 at `bitmart.js` line 128. Its terms were not researched | S16 |
| LP Program | a maker program with a monthly maker ratio of 70 % or more to qualify and 50 % to keep, rates not published on the page | S1 |
| institutional rate | "kindly reach out to us via Telegram", no rate published | S1 |
| zero fee events | the fee page state lists `zeroFeesContracts` as `[]` on 2026-09-23. The last event found ran from 2026-05-27 04:00 to 2026-06-03 15:59 UTC on eight TradFi perpetuals and excluded "Institutional accounts, market makers, project teams, and API users" | S1, S10 |

No discount applies to an unauthenticated API taker at VIP 0, so 600 ppm stands.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| direction | "If the funding fee rate is positive, long positions will pay funding costs to short positions." | S6 |
| who is charged | positions open at the funding time. "If you close your position prior to the funding time, you will not need to pay nor receive funding fees." | S7 |
| counterparty | "BitMart does not charge any fees in the funding process. The funding fee is exchanged directly between counterparties." | S7 |
| interval | documented as every 8 h at 00:00, 08:00 and 16:00 UTC, S6 and S7. On the wire `funding_interval_hours` read 8 on 216 `Trading` contracts, 4 on 141 and 1 on 2, and 52 of the 100 contracts that traded were on 8 h and 48 on 4 h | [`rest.md`](./rest.md) section 2 |
| interval changes | announced per contract, for example "changed from 8 hours to 4 hours" for BRETT, 1000000MOG, G and BANANA from 2025-01-15 16:00 UTC | S13 |
| cap and floor | `funding_upper_limit` `0.0375` and `funding_lower_limit` `-0.0375` on all 96 rows of `funding-rate-v2`, that is 3.75 % per interval either way | [`rest.md`](./rest.md) section 4 |
| formula | not published. The mark is described as "index-based price * (1 + basis rate of funding cost)" | S15 |
| settled history | 8 h contracts settled at 00:00, 08:00 and 16:00 UTC and 4 h contracts every 4 h in `funding-rate-history`, see [`rest.md`](./rest.md) section 4 | probe |

The settlement instant itself was not captured.
The rate that settled is taken from the funding history endpoint, whose newest row equalled the current `rate_value` on 5 of 5 contracts.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| forced liquidation | the system "places a liquidation order at the bankruptcy price", and what is left when it fills better goes "into the risk fund", which the article calls "the liquidation fee" | S8 |
| closing fee in a liquidation | charged at the taker rate. The worked example uses `0.0006` | S8 |
| funding fee | not a venue charge, see section 6 | S7 |
| delisting | 127 contracts carried `delist_time` 1784973600, 2026-07-25 10:00 UTC, and still read `status` `Trading` on 2026-09-23 with zero 24 h volume. How open positions in a delisted contract are settled is Not publicly specified in the sources read | [`rest.md`](./rest.md) section 2 |

## 8. CCXT

| item | value |
|---|---|
| version | 4.5.68 |
| class | `bitmart`, one class for spot and contracts |
| `market.taker` for a swap without credentials | `0.004`, that is 4,000 ppm, on 1,215 of 1,215 swap markets |
| `market.maker` | `0.0035`, 3,500 ppm |
| source | the `fees.trading` constants `'taker': this.parseNumber('0.0040')` and `'maker': this.parseNumber('0.0035')` at `server/node_modules/ccxt/js/src/bitmart.js` lines 303 and 304, copied into every contract market at lines 1152 and 1153 |
| tiers | the `tiers` object at lines 305 to 326 starts at `0.0020` taker and has a second taker tier of `0.18` at line 308, which is not a fraction a fee can be |
| probe | `rest-probe.mjs catalog`, `"taker":{"0.004":1215}` |

CCXT's constant is about seven times the published perpetual taker.
The engine therefore must not read the fee from CCXT for this venue.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 perpetual taker in S1 tier data, S1 futures tab and S2 |
| `ccxtTakerPpm` | 4000 | the constant CCXT reports on every swap, `bitmart.js` line 303, so the connector's check expects it and stays quiet |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BitMart Trading Fees page, server rendered state `ABCFeeRateInfo` and the futures tab | https://www.bitmart.com/en-US/fee | 2026-09-22 | BitMart, global | tiers, level 0 futures fee, BMX line, LP Program, `zeroFeesContracts`, sections 2, 4 and 5 |
| S2 | BitMart VIP Level Guide, updated 2026-06-12 | https://bitmart.zendesk.com/hc/en-us/articles/51619963454107-BitMart-VIP-Level-Guide | 2026-09-22 | BitMart, global | tiers and qualification, sections 2 and 4 |
| S3 | BITMART USER AGREEMENT, updated 2026-09-21 | https://bitmart.zendesk.com/hc/en-us/articles/115004890354-BITMART-USER-AGREEMENT | 2026-09-22 | GBM Global Inc., Marshall Islands | entity, securities line, section 1 |
| S4 | Important Notice Regarding Services for U.S. Users, created 2026-07-23 | https://bitmart.zendesk.com/hc/en-us/articles/53418890232475-Important-Notice-Regarding-Services-for-U-S-Users | 2026-09-22 | United States | US exclusion, BitMart U.S., section 1 |
| S5 | Notice on Suspension of Futures Service for Chinese Residents | https://bitmart.zendesk.com/hc/en-us/articles/1260807108649-Notice-on-Suspension-of-Futures-Service-for-Chinese-Residents | 2026-09-22 | Mainland China | section 1 |
| S6 | BitMart Futures Tutorial 04: Futures Knowledge and Function Introduction, updated 2025-12-03 | https://bitmart.zendesk.com/hc/en-us/articles/11101353769243-BitMart-Futures-Tutorial-04-Futures-Knowledge-and-Function-Introduction | 2026-09-22 | BitMart, global | coin-M definition, funding direction, fee currency, sections 2, 3 and 6 |
| S7 | Introduction to BitMart Futures, updated 2024-08-20 | https://bitmart.zendesk.com/hc/en-us/articles/360044614594-Introduction-to-BitMart-Futures | 2026-09-22 | BitMart, global | funding schedule, who is charged, section 6 |
| S8 | BitMart Futures V2.0 Liquidation and Margin Breach Liquidation Explanation | https://bitmart.zendesk.com/hc/en-us/articles/26449697919515-BitMart-Futures-V2-0-Liquidation-and-Margin-Breach-Liquidation-Explanation | 2026-09-22 | BitMart, global | section 7 |
| S9 | Instruction on Using BMX to Pay Trading Fee | https://bitmart.zendesk.com/hc/en-us/articles/360018115633-Instruction-on-Using-BMX-to-Pay-Trading-Fee | 2026-09-22 | BitMart, global | section 5 |
| S10 | [0 Fee Trading] Trade NVDAX, TSLAX & More Futures, Enjoy 0 Fees | https://bitmart.zendesk.com/hc/en-us/articles/50899423574171--0-Fee-Trading-Trade-NVDAX-TSLAX-More-Futures-Enjoy-0-Fees | 2026-09-22 | BitMart, global | section 5 |
| S11 | BitMart Futures API v2 documentation | https://developer-pro.bitmart.com/en/futuresv2/ | 2026-09-22 | BitMart, global | error code 40047, VIP update days, options absent, sections 1, 3 and 4 |
| S12 | BitMart Futures Tutorial 01: KYC Verification and Futures Account Activation, updated 2026-08-14 | https://bitmart.zendesk.com/hc/en-us/articles/11098989871003-BitMart-Futures-Tutorial-01-KYC-Verification-and-Futures-Account-Activation | 2026-09-22 | BitMart, global | section 1 |
| S13 | [Important Notice] Adjustment of Funding Fee Interval for Certain Futures Trading Pairs | https://bitmart.zendesk.com/hc/en-us/articles/32816865715099--Important-Notice-Adjustment-of-Funding-Fee-Interval-for-Certain-Futures-Trading-Pairs | 2026-09-22 | BitMart, global | section 6 |
| S14 | CoinGecko derivatives exchanges API | https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=100 | 2026-09-22 | CoinGecko | 933 perpetual pairs, section 3 |
| S15 | Definitions and Calculation of Last Trade Price, Index Price and Marking Price, updated 2022-09-15 | https://bitmart.zendesk.com/hc/en-us/articles/360045289773-Definitions-and-Calculation-of-Last-Trade-Price-Index-Price-and-Marking-Price | 2026-09-22 | BitMart, global | mark formula, section 6 |
| S16 | CCXT 4.5.68 `bitmart.js` | `server/node_modules/ccxt/js/src/bitmart.js` | 2026-09-22 | CCXT | fee constants, referral, error 40047, sections 1, 5 and 8 |
| P1 | `rest-probe.mjs catalog`, `anchor` and `limits` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitmart/rest-probe.mjs) | 2026-09-22 | this host | catalog counts, CCXT fee, funding cap and history, sections 1, 3, 6, 7 and 8 |
