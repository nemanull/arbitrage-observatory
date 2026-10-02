# BingX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, in the local evening, which is 01:14 to 01:54 UTC on 2026-09-23.

This profile covers perpetual trading on BingX (CCXT id `bingx`), and nothing else.
Spot, Standard Futures, deposit, withdrawal, card and earn schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bingx/ws-probe.mjs).
Probe timestamps are UTC, so the runs of the evening of 2026-09-22 in Seattle carry the date 2026-09-23.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 | this profile |
| contracting entity | Nieve Cruz PA Corporation, named as "the Company" in the Customer Agreement, latest update 2026-09-02 | S5 |
| fiat entities | other members of the "BingX group of companies" provide fiat support only and do not operate the trading platform | S5 |
| who may trade | an individual or legal entity with full capacity, at least 18, not on a sanctions list, and not a resident or passport holder of a restricted jurisdiction | S5 |
| US persons | excluded: the eligibility clause requires that the user "(e) are not a U.S or Canada user" | S5 |
| restricted jurisdictions | Afghanistan, Burundi, Cambodia, Canada, Central African Republic, China (Mainland), Cuba, Democratic Republic of the Congo, Hong Kong SAR, Iran, Laos, Macau SAR, Myanmar, Netherlands, North Korea, Panama, Singapore, Somalia, United Kingdom, United States including all territories, and the Crimea, Donetsk and Luhansk regions, "including but not limited to" | S6, latest update 2023-12-11 |
| stock perpetuals | not available in the UAE, Czech Republic, Indonesia, United Kingdom, Canada, United States, Hong Kong, Singapore, Cuba, North Korea, the Middle East and Austria | S9 |
| public API from this host | REST and WebSocket answered without refusal: HTTP 200 on every public call except one coin-M request sent without its `timestamp`, and sockets opened in 505 to 669 ms, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 5 | P1 to P6 |
| help center from this host | every article page cited here returned HTTP 200, and the fee tier page `https://bingx.com/en/support/costs/` returned 200 but renders its table client side, so no tier numbers could be read from it | S1 to S9 |
| server location | "AWS in the Singapore region (ap-southeast-1)", per the API FAQ | S11 |

The public data endpoints do not geofence this host.
Trading is a different matter, because the Customer Agreement excludes US and Canadian users outright.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, crypto | 0.020 %, 200 ppm | 0.050 %, 500 ppm | S1, S2, and `takerFeeRate` 0.0005 and `makerFeeRate` 0.0002 on 1,269 of 1,269 contract rows, P1 |
| USDC-M perpetuals | 0.020 %, 200 ppm | 0.050 %, 500 ppm | same contract rows, 49 of them USDC-settled, P1 |
| USDT-M TradFi perpetuals (`NC` prefix) | region dependent, see section 5 | region dependent, see section 5 | S8, S9 |
| Coin-M perpetuals | not published in the pages read | not published in the pages read | the coin-M contracts reply carries no fee field, P1 |

The contract rows are an unauthenticated reply, so they show the base rate and not any account's rate.

## 3. Coverage matrix

Counts are from the contracts replies and CCXT 4.5.68 `loadMarkets` on 2026-09-23 at 01:28 and 01:39 UTC, P1, and where the two runs differ both are given.
CoinGecko listed "BingX (Futures): 1292 perpetual pairs" the same day, against 1,269 USDT-M and USDC-M rows plus 20 coin-M rows here.

| product | present | detail |
|---|---|---|
| USDT-M perpetuals | yes | 1,220 rows: 909 or 910 with `status` 1 and the API open, 160 or 161 with `status` 25, "forbidden to open positions", and the API open, 78 with `status` 1 and the API closed, 72 with `status` 25 and the API closed |
| TradFi perpetuals inside USDT-M | yes | 626 of the rows carry an `NC` prefix, and 329 or 330 of them are tradable: 255 or 256 stocks `NCSK`, 37 forex `NCFX`, 25 commodities `NCCO`, 12 indices `NCSI` |
| USDC-M perpetuals | yes | 49 rows, all `status` 1 and API open, every one on a base that also has a USDT-M contract |
| Coin-M perpetuals | yes | 20 inverse contracts on `/openApi/cswap/v1/market/contracts`, all `status` 1, all inactive in CCXT, see [`rest.md`](./rest.md) section 2 |
| dated futures | no | none in any catalog reply |
| options | no | none in any catalog reply, EventX is an event prediction product on the site menu |
| Standard Futures | yes, not via API | a spread-based product with a 0.045 % fee charged on close, S2. The API FAQ answers "Does the API support standard contract trading?" with "Currently not supported.", S11 |
| spot | yes | 607 active spot markets in CCXT, at CCXT's constant 0.1 % maker and taker, `server/node_modules/ccxt/js/src/bingx.js` lines 162 to 166 |
| deposit, withdrawal, card, earn | yes | not recorded here, the official lookup is the fee schedule, S2 |

## 4. Perpetual tiers

The live tier table at `https://bingx.com/en/support/costs/` renders client side and could not be read, see section 1.
The table below is the last complete perpetual tier table BingX published as an article, effective 2023-10-25 03:20 UTC+8, S3.
It is followed by the two changes BingX announced later, S4.

### Perpetual tiers, effective 2023-10-25

| level | 30 day perpetual volume (USDT) | or previous day's assets (USDT) | maker | taker | taker ppm |
|---|---|---|---:|---:|---:|
| VIP 0 | < 10,000,000 | < 50,000 | 0.0200 % | 0.0500 % | 500 |
| VIP 1 | ≥ 10,000,000 | ≥ 50,000 | 0.0140 % | 0.0400 % | 400 |
| VIP 2 | ≥ 20,000,000 | ≥ 200,000 | 0.0120 % | 0.0375 % | 375 |
| VIP 3 | ≥ 50,000,000 | ≥ 1,000,000 | 0.0100 % | 0.0350 % | 350 |
| VIP 4 | ≥ 100,000,000, with API volume ≤ 20 % | ≥ 2,000,000 | 0.0080 % | 0.0315 % | 315 |
| VIP 5 | ≥ 200,000,000, with API volume ≤ 20 % | ≥ 3,000,000 | 0.0060 % | 0.0300 % | 300 |
| Supreme VIP | ≥ 600,000,000, with API volume ≤ 20 % | none | 0.0000 % | 0.0280 % | 280 |

### Changes effective 2026-06-26

| item | before | after | source |
|---|---|---|---|
| Futures Elite level | a trial | permanent, entry at a 30 day futures volume ≥ 5,000,000 USDT, maker 0.018 %, taker 0.045 %, 450 ppm | S4 |
| Supreme VIP entry | 600,000,000 USDT | 500,000,000 USDT | S4 |
| Supreme VIP futures taker | 0.028 % | 0.025 %, 250 ppm | S4 |

Where Elite sits against VIP 1 to VIP 5 in the current table is Not verified, because the announcement gives its threshold and rates only.

### Qualification

- Either condition unlocks a level: the 30 day perpetual volume or the previous day's assets, S3.
- Previous day's assets are the sum of all account balances in the 00:00 UTC+8 snapshot, S3.
- Only perpetual volume counts, including USDT-M perpetuals, Futures Grid and Futures Copy Trading, and main and sub-account volume is summed, S3.
- TradFi volume counts toward Elite and above after a conversion that depends on the KYC or KYB region, S4.
- Levels are evaluated on a rolling 30 days and updated daily, S4.
- VIP 4, VIP 5 and Supreme VIP require that API trading be at most 20 % of volume, S3.
  An engine that trades only through the API cannot reach those levels by volume.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| platform token | none found in any page read | S1 to S4 |
| Elite level | taker 0.045 % from 5,000,000 USDT of 30 day futures volume | S4 |
| TradFi promotions | "gradually end promotional fee discounts" on forex, stocks, commodities and indices "in certain regions" from 2025-12-15, and "Fees applicable to different regions and users may vary" | S8 |
| stock perpetual promotion | "promotional rates as low as 0-0.003%" at the stock perpetual launch, with no end date given | S9 |
| new user discount of 2022 | maker 0.016 %, taker 0.04 % for 180 days to users registered before 2022-12-09, long expired | S10 |
| market maker programme | not read | none |

The TradFi rate depends on the account's region, and the unauthenticated contract rows show 0.0005 for every TradFi row as well.
So the TradFi taker cannot be pinned without an account, which this survey does not open.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | `F = P + Clamp(I - P, β, -β)`, where `P` is the average premium index and `I` the interest rate | S7 |
| interest `I` | 0.01 % per 8 h for crypto, 0.004 % per 8 h for forex, "proportionally adjusted based on the settlement cycle" | S7 |
| premium index | `PI = {max(0, Impact Bid − Index) − max(0, Index − Impact Ask)} / Index`, sampled every 5 minutes through the period | S7 |
| impact notional | `IMN = 200 USDT / Initial Margin Ratio of Maximum Leverage Level` | S7 |
| average | weighted over the period, with higher weights near the settlement | S7 |
| `β` | 0.05 % in the worked example, the value per contract is not published | S7 |
| rate cap | per contract, `minFundingRate` and `maxFundingRate` on `/openApi/swap/v2/quote/premiumIndex`: ±0.02 on 747 of 1,037 rows, ±0.005 on 135, and from ±0.0005 to ±0.06 on the rest | P2 |
| older cap | "All trading pairs in Perpetual Futures: a=-0.3%, b=0.3%" in the 2020 articles, which the per contract caps above no longer match | S1, S2 |
| interval | per contract: 8 h on 508 or 509 rows, 4 h on 510, 1 h on 18, from `fundingIntervalHours` | P2 |
| 8 h instants | 00:00, 08:00 and 16:00 UTC+8, which are 16:00, 00:00 and 08:00 UTC | S1, S2 |
| who pays | longs pay shorts when the rate is positive, users pay each other and "The exchange itself does not charge any funding fee." | S7 |
| charge | position amount times mark price times the rate at settlement | S7 |
| timing caveat | settlement can take up to one minute, and orders placed within 30 s before it "may not be counted" | S1 |

The published `lastFundingRate` is a running estimate for the upcoming settlement and not the last settled rate, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured, and the behaviour here comes from the funding history call and the documentation.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | "Margin Rate ≤ Maintenance Margin Rate + Taker Fee Rate" | S1 |
| liquidation price | the position closes at the bankruptcy price, a better fill goes to the insurance fund and a worse one is covered by it | S1 |
| separate liquidation fee | none named | S1 |
| maintenance margin | "0.5%, and there are currently no tiered ratios" in the 2020 article, current tiers not read | S1 |
| delisting | the contract row carries `offTime`, the delisting instant in ms, and 15 `NCSK` stock contracts carried 2026-09-24 03:00 or 03:30 UTC on 2026-09-23, no crypto contract | P1 |
| settlement charge | none named | S1, S2 |

## 8. CCXT

| item | value |
|---|---|
| `market.taker` on every active swap | 0.0005, on 1,119 of 1,119, P1 |
| `market.maker` | 0.0002 |
| where it comes from | the static `fees.swap` block at `server/node_modules/ccxt/js/src/bingx.js` lines 167 to 171, taker at line 170 |
| how it reaches the market | `parseMarket` reads `this.fees[type]` at line 1048 and writes `taker` at line 1086 |
| the per contract fee field | ignored: CCXT never reads `takerFeeRate` from the contracts reply, which also said 0.0005 on every row |

CCXT reads the same constant whether or not credentials are present, since `parseMarket` never calls a fee endpoint.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 500 | the VIP 0 perpetual taker in S1 and S2, equal to the contract rows' `takerFeeRate` |
| `ccxtTakerPpm` | leave unset | CCXT's 0.0005 at `bingx.js` line 170 equals `takerPpm`, so the check at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 33 to 39 passes without it |

The TradFi contracts may carry a different regional rate, see section 5, which is one more reason to filter them out, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Perpetual Futures, Fee Schedule, 2020-04-08 | https://bingx.com/en/support/articles/360046487573-perpetual-futures-fee-schedule | 2026-09-22 | BingX, global | VIP 0 maker and taker, 8 h instants, the ±0.3 % clamp, liquidation, sections 2, 6, 7 |
| S2 | Fee Schedule, 2019-07-19 | https://bingx.com/en/support/articles/360027240173 | 2026-09-22 | BingX, global | taker 0.050 %, maker 0.020 %, Standard Futures, funding instants, sections 2, 3, 6 |
| S3 | BingX Adjusts Perpetual Futures Trading Fees for VIP Users & Introduces Supreme VIP Level, 2023-10-13 | https://bingx.com/en/support/articles/23996776295449-bingxadjustsperpetualfuturestradingfeesforvipusers&introducessupremeviplevel | 2026-09-22 | BingX, global | the tier table and its qualification rules, section 4 |
| S4 | Announcement: BingX VIP Fee Structure Upgrade and Official Launch of Elite Level, 2026-06-12 | https://bingx.com/en/support/articles/16455102764943 | 2026-09-22 | BingX, global | Elite, the Supreme changes, TradFi volume, sections 4, 5 |
| S5 | Customer Agreement, latest update 2026-09-02 | https://bingx.com/en/support/articles/360033286474 | 2026-09-22 | Nieve Cruz PA Corporation | entity, eligibility, US and Canada exclusion, section 1 |
| S6 | Disclaimer, latest update 2023-12-11 | https://bingx.com/en/support/articles/360034028153 | 2026-09-22 | BingX, global | restricted jurisdictions, section 1 |
| S7 | [Notice] Perpetual Futures Funding Rate Mechanism Explained, 2026-01-12 | https://bingx.com/en/support/articles/14857605906575 | 2026-09-22 | BingX, global | funding formula, interest, premium index, payment rule, section 6 |
| S8 | BingX Adjusts Fee Rates for Traditional Financial Perpetual Futures, 2025-12-10 | https://bingx.com/en/support/articles/14574559567887 | 2026-09-22 | BingX, certain regions | TradFi promotions ending, region dependent rates, section 5 |
| S9 | Stock Perpetual Futures Now Live!, 2025-11-02 | https://bingx.com/en/support/articles/14216402396943 | 2026-09-22 | BingX, stock perpetual regions | stock perpetual regional exclusions and promotional rates, sections 1, 5 |
| S10 | Notice on the Taker Fee Rate Adjustment for Perpetual Futures, 2022-12-07 | https://bingx.com/en/support/articles/13253576466329-notice-on-the-taker-fee-rate-adjustment-for-perpetual-futures | 2026-09-22 | BingX, global | the 2022 move from 0.04 % to 0.05 %, section 5 |
| S11 | BingX API docs v3, Quick Start pages "FAQ" and "Basic Information" | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | server location, Standard Futures not in the API, section 1 and 3 |
| S12 | CCXT 4.5.68 `bingx.js` | `server/node_modules/ccxt/js/src/bingx.js` | 2026-09-22 | CCXT | the fee constant, section 8 |
| S13 | CoinGecko derivatives exchange list | https://www.coingecko.com/en/exchanges/derivatives | 2026-09-22 | CoinGecko | 1,292 perpetual pairs, as given in the survey task, section 3 |
| P1 | `rest-probe.mjs catalog`, 01:28, 01:39 and 01:54 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs) | 2026-09-22 | this host | contract counts, fee fields, CCXT taker, `offTime`, sections 2, 3, 7, 8 |
| P2 | `rest-probe.mjs anchor`, runs starting at 01:29, 01:40 and 01:42 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs) | 2026-09-22 | this host | funding caps and intervals, section 6 |
| P3 to P6 | the other probe runs | [`ws-probe.mjs`](../../../scripts/probes/venues/bingx/ws-probe.mjs), [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs) | 2026-09-22 | this host | access from this host, section 1, detailed in [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md) |

The documentation site at S11 is a client rendered page, so its text was read from the site's own bundle `https://bingx-api.github.io/docs-v3/static/js/app.8bc50bc0c8a6a308c3e4.js`, fetched on 2026-09-22.
