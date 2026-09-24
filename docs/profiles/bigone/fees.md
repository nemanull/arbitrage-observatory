# BigONE Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:08 to 04:40 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocated to Canada (Cloudflare trace `loc=CA`, colo `YVR`).

This profile covers the perpetual futures of BigONE (CCXT id `bigone`), which the venue calls contracts, in both families it lists: USDT-margined and coin-margined.
Spot is named in the coverage matrix only, as the survey plan's scope guard asks.
The help center HTML pages answered this host with HTTP 403 and a Cloudflare "Just a moment..." challenge, and a fetch that does not originate here got 403 too.
The same articles were read through the help center's JSON API, `https://bigone.zendesk.com/api/v2/help_center/en-us/articles/<id>.json`, which answered 200.
Every fee table on BigONE is an image inside an article, so the numbers below were read from the image files the articles embed.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | the BigONE User Agreement names "BigONE" and "the BigONE team" and no legal entity | S8 |
| second entity | Bigone Investment Ltd., a private company of the Astana International Financial Centre, Kazakhstan, in a FinTech Lab sandbox under the AFSA, for users of the Eurasia agreement | S9 |
| perpetual terms | the Perpetual Futures User Agreement requires that the user is eligible under the Terms of Service and that the agreement "does not contradict with the laws of the country or region where you are from" | S10 |
| United States | excluded: "You must verify that you are not a US Citizen or Resident, as BigONE is currently not available in the United States." (User Agreement 2.1, edited 2026-07-10) | S8 |
| other regions | the Eurasia agreement refers to a list of Restricted Locations "in BigONE website" as its Annex A, and that list was not found in the help center or the API docs | S9 |
| Japan | an article titled "BigONE Has Stopped KYC Service to Users in Japan" exists, dated 2018-06-27, and its body was not read | help center search |
| fee freshness | the futures fee of 0.02 % maker and 0.06 % taker appears in the VIP table of 2025-01-17 and in the "Fees" article last updated 2022-09-19 | S1, S2 |

Access from this host on 2026-09-22 local time, through the Canadian VPN exit:

| endpoint | result |
|---|---|
| `https://big.one/api/contract/v2/symbols`, `/instruments`, `/depth@{symbol}/snapshot` | 200, see [`rest.md`](./rest.md) section 1 |
| `wss://api.big.one/ws/contract/v2/depth@{symbol}` and `/instruments` | 101, see [`websocket.md`](./websocket.md) section 1 |
| `https://open.big.one/docs/...` API documentation | 200 |
| `https://bigone.zendesk.com/hc/en-us/articles/...` help center pages | 403, Cloudflare challenge page, 5,574 bytes |
| `https://bigone.zendesk.com/api/v2/help_center/...` help center API | 200 |

## 2. Quick answer

| family | VIP level | maker | taker | maker ppm | taker ppm | source |
|---|---|---|---|---|---|---|
| USDT-M perpetuals | VIP 1, the lowest level | 0.02 % | 0.06 % | 200 | 600 | S1, S2, S3 |
| coin-M perpetuals (`BTCUSD`, `ETHUSD`) | VIP 1 | 0.02 % | 0.06 % | 200 | 600 | S2 says "Contract trading fees", with no split by family |

BigONE's table starts at VIP 1, and there is no VIP 0 row.
The futures maker and taker are the same at every level from VIP 1 to VIP 8, see section 4.

## 3. Coverage matrix

| product | present | detail |
|---|---|---|
| USDT-M perpetuals | yes | 101 contracts in `GET /api/contract/v2/symbols`, 97 with `enable` true and 4 false, [`rest-probe.mjs`](../../../scripts/probes/venues/bigone/rest-probe.mjs) `catalog` |
| coin-M perpetuals | yes | `BTCUSD` and `ETHUSD`, inverse, settled in BTC and ETH, both enabled |
| TradFi perpetuals | yes, inside USDT-M | of the 97 enabled USDT-M contracts, 49 are `type` `STOCK`, 2 `METAL` and 3 `COMMODITY`, S7 |
| dated futures | no | no dated contract in `symbols`, and CCXT marks `future` as "has but unimplemented" at `server/node_modules/ccxt/js/src/bigone.js` line 32 |
| options | no | CCXT `option: false` at `bigone.js` line 33 |
| spot | yes | 912 spot markets in CCXT `loadMarkets`, VIP 1 spot maker 0.20 % and taker 0.20 %, S1. Not researched further |
| leveraged ETF tokens, prediction market | yes | named in help center article titles only |

The 99 enabled perpetuals match CoinGecko's "BigONE Futures: 99 perpetual pairs" on 2026-09-22.

## 4. Perpetual tiers

From the image in S1, dated 2025-01-17 and still the newest VIP announcement found.

| level | 30 day trading volume, USDT | or 30 day average holding, USDT | or 30 day average ONE | futures maker | futures taker | spot maker | spot taker |
|---|---|---|---|---|---|---|---|
| VIP 1 | < 200,000 | < 10,000 | < 2,000,000 | 0.02 % | 0.06 % | 0.20 % | 0.20 % |
| VIP 2 | ≥ 200,000 | ≥ 10,000 | ≥ 2,000,000 | 0.02 % | 0.06 % | 0.18 % | 0.19 % |
| VIP 3 | ≥ 1,000,000 | ≥ 50,000 | ≥ 8,000,000 | 0.02 % | 0.06 % | 0.17 % | 0.18 % |
| VIP 4 | ≥ 3,000,000 | ≥ 100,000 | ≥ 20,000,000 | 0.02 % | 0.06 % | 0.16 % | 0.17 % |
| VIP 5 | ≥ 8,000,000 | ≥ 300,000 | ≥ 80,000,000 | 0.02 % | 0.06 % | 0.10 % | 0.12 % |
| VIP 6 | ≥ 12,000,000 | ≥ 1,000,000 | ≥ 180,000,000 | 0.02 % | 0.06 % | 0.08 % | 0.10 % |
| VIP 7 | ≥ 50,000,000 | ≥ 5,000,000 | ≥ 350,000,000 | 0.02 % | 0.06 % | 0.07 % | 0.09 % |
| VIP 8 | ≥ 1,000,000,000 | ≥ 10,000,000 | ≥ 600,000,000 | 0.02 % | 0.06 % | 0.06 % | 0.08 % |

### Qualification

- The level is the highest of three methods, computed at the same time, S1.
- Trading volume counts spot volume plus 40 % of futures volume over the past 30 days, S1.
- Asset holding is the 30 day average of net assets in USDT times a coefficient of 1, 0.7 or 0.3 by asset class, S1 and S14.
- ONE holding is the 30 day average of the venue's token ONE, S1.
- A user who qualified by volume keeps the level for 30 days after falling below it, S1.

The futures columns are flat, so no level changes the perpetual taker.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | source |
|---|---|---|
| VIP level | none, the futures fee is 0.02 % and 0.06 % at every level | S1 |
| holding ONE | raises the VIP level, which does not change the futures fee. A 2018 "Hold ONE to Get Trading Fee Rebate" scheme redistributes "all trading fee received in the form of crypto assets" by ONE balance, and whether it still runs in 2026 or covers futures is Not verified | S1, S15 |
| 11.11 promotion | 50 % of futures fees rebated as trial funds to registered users trading over 10,000 USDT, 2025-11-11 to 2025-11-17 GMT+8, ended | S11 |
| referral and Star affiliate programme | articles exist under those titles, not researched | help center search |
| market maker programme | Not publicly specified | |
| zero fee promotion on perpetuals | none found on 2026-09-22 | help center search for "zero fee" and "fee discount" |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays | "When the Funding Rate is positive, longs pay shorts, and vice versa when the rate is negative." | S4 |
| amount | `Funding = Position Value * Funding Rate`, on notional, independent of leverage | S4 |
| when | only positions held at a funding time pay or receive | S4 |
| venue fee on funding | none: "BigONE does not charge any fees on funding." | S2, S4 |
| formula | `F = P + clamp(I - P, 0.05%, -0.05%)`, with the premium index `P` and the interest rate `I` computed every minute and averaged by an 8 hour TWAP | S4 |
| premium index | `P = (Max(0, Impact Bid - Mark) - Max(0, Mark - Impact Ask)) / Spot Price + Fair Basis used in Mark Price` | S4 |
| cap | the absolute rate is capped at 75 % of initial margin minus maintenance margin, and it may not change by more than 75 % of the maintenance margin between intervals | S4 |
| cap, BTCUSDT | 0.375 %, from `initialMargin` 0.01 and `maintenanceMargin` 0.005 in `symbols` | S4, P1 |
| cap, TradFi | ±2.00 % on `TSLAUSDT`, ±0.50 % on `XAUUSDT` and `XAGUSDT` | S7 |
| interval | 8 h by default. From 2026-09-04 02:00 UTC, 24 named USDT-M contracts settle every 4 h and `SKRUSDT` every 1 h | S4, S6 |
| schedule, documented | "every 8 hours at 02:00 UTC+00, 10:00 UTC+00, and 18:00 UTC+00" in an article edited 2021-10-17 | S4 |
| schedule, on the wire | at 04:13 UTC on 2026-09-23 98 contracts read `nextFundingTime` 08:00 UTC and `SKRUSDT` read 05:00 UTC, so the 8 h grid is now 00:00, 08:00 and 16:00 UTC | P1 |
| rates seen | from -0.138 % (`SQQQUSDT`) to +0.093 % (`BEUSDT`) at 04:17 UTC | P2 |

The documented schedule and the wire disagree, and the wire is what a poller reads.
The settlement instant itself was not captured, and no public funding history call was found, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

- Positions are marked at the Fair Price, `Index Price * (1 + Funding Rate * Time Until Funding / Funding Interval)`, which drives unrealized PNL and liquidation, S5.
- A liquidation fee or insurance fund charge is Not publicly specified in the articles read.
- Perpetuals do not settle, S16.
- Four contracts are listed with `enable` false: `EOSUSDT`, `MATICUSDT`, `XINUSDT` and `TONUSDT`, P1.
  How their positions were closed was not researched.

## 8. CCXT

CCXT 4.5.68 returns `market.taker` and `market.maker` as `undefined` on all 103 swap markets without credentials, [`rest-probe.mjs`](../../../scripts/probes/venues/bigone/rest-probe.mjs) `catalog`.

| step | file and line |
|---|---|
| the class declares `fees.trading.maker` and `taker` of 0.001, which is 1,000 ppm | `server/node_modules/ccxt/js/src/bigone.js` lines 198 and 199 |
| `fetchMarkets` builds each contract through `safeMarketStructure` | `bigone.js` line 744 |
| `safeMarketStructure` writes `'taker': undefined` and `'maker': undefined` into every market | `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3653 and 3654 |
| `setMarkets` deep extends the class fee first and the market last | `base/Exchange.js` lines 3732 to 3735 |
| `deepExtend` copies a key whose value is `undefined`, so the market's `undefined` replaces 0.001 | `server/node_modules/ccxt/js/src/base/functions/generic.js` lines 151 to 175 |

So the 1,000 ppm constant never reaches a market.
It would also be wrong, since the published perpetual taker is 600 ppm.

The engine's connector returns no market when neither the registry nor CCXT gives a taker, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 162 to 166.
Without a registry `takerPpm`, all 99 BigONE perpetuals would be skipped with "skipped 99 market(s) missing an id, a symbol, or a taker fee".

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 1 perpetual taker of 0.06 %, flat across all levels, S1 |
| `ccxtTakerPpm` | unset | CCXT reports no taker, and the comparison runs only when CCXT reports a number, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 119 to 124 |
| `marketFilter` | keep `linear === true` | the two inverse contracts `BTCUSD` and `ETHUSD` quote their book in contracts of 1 USD, which the engine would read as 1 coin, see [`websocket.md`](./websocket.md) section 4 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Announcement on BigONE VIP Membership System Optimization and Upgrade, 2025-01-17, with the table image `article_attachments/42465210782745` | https://bigone.zendesk.com/hc/en-us/articles/42436540326297 | 2026-09-22 | BigONE, global | sections 2, 3, 4, 5, 9 |
| S2 | Fees, updated 2022-09-19 | https://bigone.zendesk.com/hc/en-us/articles/900000315563 | 2026-09-22 | BigONE, global | "Contract trading fees Maker: 0.02%, Taker: 0.06%", no fee on funding, sections 2 and 6 |
| S3 | BigONE Futures rate, updated 2022-02-13 | https://bigone.zendesk.com/hc/en-us/articles/900000033483 | 2026-09-22 | BigONE, global | "all contracts adopt fixed rate", section 2 |
| S4 | Funding, edited 2021-10-17 | https://bigone.zendesk.com/hc/en-us/articles/900000315543 | 2026-09-22 | BigONE, global | formula, caps, schedule, section 6 |
| S5 | Liquidation - Fair Price Marking, edited 2021-10-17 | https://bigone.zendesk.com/hc/en-us/articles/900000315483 | 2026-09-22 | BigONE, global | mark formula, section 7 |
| S6 | Adjustments to Funding Rate Settlement Frequency for Selected USDT-Margined Perpetual Futures, 2026-09-02, with the table image `article_attachments/61829611661337` | https://bigone.zendesk.com/hc/en-us/articles/61829180468761 | 2026-09-22 | BigONE, global | 4 h and 1 h contracts, section 6 |
| S7 | BigONE Launches TradFi Perpetual Futures, 2026-03-13, with the image `article_attachments/55986087274137` | https://bigone.zendesk.com/hc/en-us/articles/55981206209945 | 2026-09-22 | BigONE, global | TradFi funding caps and contract sizes, sections 3 and 6 |
| S8 | BigONE User Agreement, edited 2026-07-10 | https://bigone.zendesk.com/hc/en-us/articles/115001990533 | 2026-09-22 | BigONE, global | United States exclusion, section 1 |
| S9 | BigONE Eurasia User Agreement, edited 2023-09-12 | https://bigone.zendesk.com/hc/en-us/articles/20997939628441 | 2026-09-22 | Bigone Investment Ltd., AIFC, Kazakhstan | entity, Restricted Locations annex, section 1 |
| S10 | BigONE Perpetual Futures User Agreement, edited 2021-09-30 | https://bigone.zendesk.com/hc/en-us/articles/900000376246 | 2026-09-22 | BigONE, global | eligibility, section 1 |
| S11 | Enjoy 11.11 Exclusive Futures Fees Discount & Copy Trading Promotion!, 2025-11-11 | https://bigone.zendesk.com/hc/en-us/articles/52334621773593 | 2026-09-22 | BigONE, global | ended promotion, section 5 |
| S12 | BigONE Fee Policy, the page CCXT links as `urls.fees` | https://bigone.zendesk.com/hc/en-us/articles/115001933374 | 2026-09-22 | BigONE, global | "Trading fee 0.1%", signed August 11, 2018, the likely origin of CCXT's 0.001 |
| S13 | BigONE API general information | https://open.big.one/docs/general-info | 2026-09-22 | BigONE, global | rate limits, see [`rest.md`](./rest.md) section 6 |
| S14 | BigONE VIP Asset Holding Coefficient, 2025-01-17 | https://bigone.zendesk.com/hc/en-us/articles/42440565056281 | 2026-09-22 | BigONE, global | coefficients 1, 0.7 and 0.3, section 4 |
| S15 | Announcement of Changes to Trading Fee Rebate Calculation Method for ONE Holders, 2018-07-10 | https://bigone.zendesk.com/hc/en-us/articles/360006825493 | 2026-09-22 | BigONE, global | ONE rebate, section 5 |
| S16 | Perpetual Contract Overview, edited 2021-10-17 | https://bigone.zendesk.com/hc/en-us/articles/900000318706 | 2026-09-22 | BigONE, global | no settlement on perpetuals, section 7 |
| S17 | CCXT 4.5.68 `bigone.js`, `base/Exchange.js`, `base/functions/generic.js` | `server/node_modules/ccxt/js/src/` | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs catalog`, 04:13 UTC, and the second pass at 04:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bigone/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | catalog counts, margins, next funding time, CCXT taker |
| P2 | `rest-probe.mjs anchor`, 04:14 and 04:16 UTC, and the second pass at 04:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bigone/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | funding rates seen |
