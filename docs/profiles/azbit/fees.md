# Azbit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:17 and 03:51 UTC on 2026-09-23.

This profile covers the fees of Azbit, which has no CCXT class, for its one perpetual family, USDT-margined linear contracts.
CoinGecko's derivatives list does not show Azbit, but the public API lists 161 active perpetuals, so the venue is researched on its perpetuals and its spot market is named in the coverage matrix only.
The perpetual book Azbit publishes is a delayed copy of Bybit's linear book, see [`websocket.md`](./websocket.md) section 4 and [`rest.md`](./rest.md) section 2, and that finding decides the verdict more than any fee does.
Probe references are to [`rest-probe.mjs`](../../../scripts/probes/venues/azbit/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/azbit/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "Azbit.com is operated by AZ Strategic Ltd", site footer, and the Terms of Use name "the companies AZ Strategic Ltd and other parties that run Azbit Exchange" | S2, S3 |
| jurisdiction | the AML policy cites "the Belize AML legislation obligations", and CoinGecko lists the country as Seychelles, established 2018 | S4, P1 |
| terms version | "Last update: 02 Feb 2025" | S3 |
| excluded regions | the limits page lists 244 countries, and 47 carry `noAccess: true` with every service unavailable, spot and futures trading included | S5 |
| the 47 | AF AT BG BY CA CU CY CZ DE DK EE ES FI FR GB GR GU HR HU IE IR IS KP LI LT LU LV LY MM MT NL NO PL PR PS PT RO SD SE SI SO SY UM US VE VI YE | S5 |
| futures only restrictions | none: no country on the limits page blocks futures while allowing other services, although the web app carries the text "Unfortunately, futures trading is not yet available for your region" | S5, S2 |
| US persons | may not trade. The United States is `noAccess` on the limits page, and the Terms of Use say Azbit "does not offer securities services in the United States or to U.S. persons" | S3, S5 |
| Terms of Use list | "Azbit currently may restrict trading activity for Users ... in the certain jurisdictions (including, but not limited to): United States, Canada, UK, Australia, France, Japan, People's Republic of China, European Union." Japan, Australia and China are not `noAccess` on the limits page | S3, S5 |
| KYC | futures need verification: "Kindly pass through the KYC verification procedure to gain access to futures trading" | S2 |
| public API from this host | every public REST call answered 200 and every public WebSocket route answered 101, through Cloudflare edges tagged SEA and YVR, with no geoblock | P1, P3 |

The legal entity, the regulator and the licence are not stated beyond the lines above.
Whether a user outside the 47 countries can open futures is decided at KYC, which this profile did not reach.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.0200 %, 200 ppm | 0.0500 %, 500 ppm | S1, "Perpetual futures trading fees", "MAKER PLATFORM FEE RATE" and "TAKER PLATFORM FEE RATE" |
| spot | 0.2 %, 2,000 ppm, on both the buy and the sell side | same | P1, the public commissions call, see section 3 |

The perpetual numbers are the only futures fees Azbit publishes.
No tier table exists on the page, see section 4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined linear perpetuals | yes, 161 active | `GET /api/futures/exchange-data/pairs` on 2026-09-23 03:23 UTC, P1: 157 codes of the form `BTCUSDT`, one index pair `$BTC_TOP`, and three non-crypto codes `TSLA`, `BRENT` and `EURUSD` |
| USDC-margined perpetuals | no | no such code in the catalog, P1 |
| coin-margined perpetuals | no | no such code in the catalog, P1 |
| dated futures | no | the futures API has one pairs call and every row carries a funding interval, S6 |
| options | no | no options call in the API reference, S6, although a dashboard string says "Offer 800+ Spot, Futures, Options and Perpetual trading pairs and contracts", S2 |
| spot | yes, 448 pairs | `GET /api/currencies/pairs`, P1: 361 quoted in USDT, 21 in BTC, 17 in ETH, 15 in USDC, 13 in BNB, 11 in `MUSDT`, 6 in TRX, 2 in SOL, 1 in POL and 1 in LTC |

Spot fees come from `GET /api/currencies/commissions`, 3,830 rows, P1.
Type codes 3 and 4 read 0.2 % on 901 and 900 currencies, BTC among them, 0 % on 47 and 46, and 0.4 %, 0.5 % or 0.8 % on a handful.
The fees page renders a per currency "Buy fee" and "Sell fee" column, S1, and the code that maps type 3 and 4 to those columns was not found, so reading 3 and 4 as the buy and sell fee is an inference.
No maker and taker split is published for spot.

## 4. Perpetual tiers

No tier table is published.
The fees page shows one maker and one taker rate for perpetuals, S1.
Its "VIP upgrade overview" paragraph reads "Users who meet the requirements spot trading volume, futures trading volume, and new BGB holders for different VIP levels will enjoy the highest level VIP perks", S1.
BGB is the token of another exchange, Bitget, so the paragraph looks copied, and no VIP level, threshold or rate is listed anywhere on the page.
Tiers are therefore Not publicly specified.

## 5. Discounts that change the perpetual taker

| discount | value | source |
|---|---|---|
| token holding | the AZ token page lists "Fee discounts (soon)", so none today | S7 |
| referral | the affiliate programme pays the referrer 30 % of spot and futures fees at the basic level and 50 % at the expert level, which is a rebate to the referrer, not a lower taker for the trader | S8 |
| market maker | Not publicly specified | S1 |
| zero fee promotion | none found | S1 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| published rate | `fundingRate` on every row of `GET /api/futures/exchange-data/pairs`, "Funding rate in force for the current interval", "Positive means longs pay shorts", and "Charged only while a position is open" | S6 |
| interval | `fundingRateStartTimestamp` to `fundingRateFinishTimestamp`, "End of that interval (UTC), when funding is settled and the next rate takes over" | S6 |
| intervals on the wire | 87 contracts on 8 h, whose current interval ran from 00:00 to 08:00 UTC, and 74 on 4 h, from 00:00 to 04:00 UTC, at 03:23 and 03:43 UTC on 2026-09-23 | P1 |
| formula | Not publicly specified | S6 |
| cap and floor | Not publicly specified. The published rates ranged from -0.00458819 to 0.00083243 with 4 at 0 at 03:23 UTC, and from -0.00478773 to 0.00078461 with 5 at 0 at 03:43 UTC | P1 |
| funding history | no public call in the API reference | S6 |

The funding interval and the next settlement of every one of the 154 contracts that Bybit also lists were identical to Bybit's `fundingInterval` and `nextFundingTime`, P1.
The rate itself equalled Bybit's current `fundingRate` on 116 of 154 contracts at 03:23 UTC and on 119 at 03:43 UTC.
On six that differed at 03:43 UTC, the Azbit rate matched neither Bybit's current rate nor any of Bybit's last three settled rates, for example `CROUSDT` at 0.00023033 against Bybit's current 0.00028499 and settled 0.0001, 0.0001 and 0.00023344, P1.
The rate did not change on any contract over 60 one second polls in either run, P2, but it changed between the runs, `BTCUSDT` from 0.0000476 to 0.00002382, P1.
So Azbit copies Bybit's schedule exactly and Bybit's current rate with a delay, which reads as a copy made at a cadence slower than a minute, and how its rate is derived is Not publicly specified.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | futures page tooltips: "At 80% collateral withdrawals are blocked, at 85% new positions are blocked, at 90% the account is liquidated", on loan to value, and "Your positions are liquidated as this ratio approaches 100%", on margin ratio | S2 |
| liquidation fee | Not publicly specified | S1, S6 |
| settlement fee | none, perpetuals only | S6 |
| delisting | Not publicly specified. The pairs call has `isActive`, "False while the pair is suspended: it still appears in listings but takes no new orders", and all 161 were active | S6, P1 |
| upstream refusal | the API reference lists error codes 110601 to 110604, "The upstream venue refused the order" and the like, under "Mirror / upstream venue" | S6 |

The upstream error codes and the copied book together say that Azbit futures orders are passed on to another venue.
The API reference does not name that venue, and the book and schedule comparisons point to Bybit.

## 8. CCXT

CCXT 4.5.68 has no Azbit class.
`require('ccxt').exchanges` from `server/` lists 104 ids and none matches `azbit`, P1.
The current CCXT master has none either.
`ts/src/azbit.ts` and `ts/src/pro/azbit.ts` answered 404 on raw.githubusercontent.com on 2026-09-23, and the master `exchanges.json` lists 105 ids without Azbit, with `ts/ccxt.ts` at version 4.5.82, P4.
The GitHub search API answered 403 for rate limit, so the check used the raw files.
There is therefore no `market.taker` to report.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 500, only if Azbit is ever registered | the published perpetual taker, S1 |
| `ccxtTakerPpm` | none | no CCXT class exists |

The recommendation is not to register Azbit.
Its perpetual book is Bybit's, republished 90 to 168 ms later at the median, see [`websocket.md`](./websocket.md) section 4, so an Azbit leg would set Bybit's liquidity against a delayed copy of the same book.
It also publishes no mark and no index, see [`rest.md`](./rest.md) section 3, so the engine would refuse every route as `anchor_no_mark`.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Azbit Fees page, server rendered strings under `fees` | https://azbit.com/fees | 2026-09-22 | AZ Strategic Ltd, global | perpetual maker and taker, VIP paragraph, buy and sell fee columns, sections 2 to 5 |
| S2 | Azbit web app strings, footer, dashboard and futures trade page | https://azbit.com/futures | 2026-09-22 | AZ Strategic Ltd, global | operator, KYC for futures, region message, liquidation tooltips, options wording, sections 1, 3 and 7 |
| S3 | Azbit Terms of Use, last update 02 Feb 2025 | https://azbit.com/terms-of-use | 2026-09-22 | AZ Strategic Ltd, global | entity, restricted jurisdictions, US persons, section 1 |
| S4 | Azbit AML and KYC policy | https://azbit.com/aml-kyc | 2026-09-22 | AZ Strategic Ltd, Belize | Belize AML legislation, section 1 |
| S5 | Azbit Limits page, `countries` list in the page data | https://azbit.com/limits | 2026-09-22 | AZ Strategic Ltd, global | 47 `noAccess` countries, section 1 |
| S6 | Azbit PublicApi reference, OpenAPI v1 | https://data.azbit.com/swagger/v1/swagger.json | 2026-09-22 | AZ Strategic Ltd, global | futures pairs fields, funding wording, upstream error codes, no funding history, sections 3, 6 and 7 |
| S7 | Azbit AZ token page | https://azbit.com/token | 2026-09-22 | AZ Strategic Ltd, global | "Fee discounts (soon)", section 5 |
| S8 | Azbit affiliates page | https://azbit.com/affiliates | 2026-09-22 | AZ Strategic Ltd, global | referral levels, section 5 |
| P1 | `rest-probe.mjs main`, runs at 03:23 and 03:43 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/azbit/rest-probe.mjs) | 2026-09-22 | this host | catalogs, commissions, funding fields, Bybit comparison, CCXT list, CoinGecko, sections 1 to 8 |
| P2 | `rest-probe.mjs poll`, runs at 03:24 and 03:44 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/azbit/rest-probe.mjs) | 2026-09-22 | this host | rate stability, section 6 |
| P3 | `ws-probe.mjs` all modes, runs between 03:26 and 03:51 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/azbit/ws-probe.mjs) | 2026-09-22 | this host | socket access, section 1 |
| P4 | CCXT master raw files, `ts/src/azbit.ts`, `ts/src/pro/azbit.ts`, `exchanges.json`, `ts/ccxt.ts` | https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json | 2026-09-22 | CCXT | no class in master, section 8 |
