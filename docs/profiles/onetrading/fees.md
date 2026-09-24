# One Trading Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:15 and 20:50 local time, which is 2026-09-23 03:15 to 03:50 UTC.

This profile covers the trading fees of One Trading (CCXT id `onetrading`) on its USD 5-Year Crypto Dated Futures, the product One Trading calls its perpetual futures.
A 5-Year Crypto Dated Future has a funding rate every 4 hours and an expiry about five years after listing, 2031-04-20 for every contract listed today.
One Trading describes it as "similar to classic perpetual futures", S11, and its API documentation says `DATED_FUTURE` is the type "for perpetual futures", S10.
The four true perpetuals (`PERP`, EUR quoted) are all `CLOSED`, see section 3.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operating entity | One Trading Exchange B.V., Amsterdam, Dutch Chamber of Commerce number 88528766 | S1 footer |
| licences | an investment firm operating an organised trading facility for derivatives with crypto-asset underlyings under the Dutch Wft, and a MiCA crypto-asset service provider, both supervised by the AFM | S1 footer |
| venue name | ONEX, the MiFID II venue the futures trade on | S7 section 2.1 |
| earlier entity | One Trading Markets S.r.l., "services terminated on 30 June 2025" | S5 terms page |
| CCXT country | `AT` (Austria), which is stale | `server/node_modules/ccxt/js/src/onetrading.js` line 22 |
| CoinGecko country | Italy, which is stale, trust score 7, trust rank 75, 10.25 BTC of 24 h volume on 3 spot tickers, no derivatives listing | S14, read 2026-09-22 |

Who may trade the dated futures.

- "Professional clients can trade dated futures once onboarding and KYC requirements are complete", S4.
- "Retail clients can trade dated futures once they pass the appropriateness test", S4.
- Futures orders are placed only from futures subaccounts, S15.
- Leverage is capped at 10x, S8 section 10.

Who may not.

- The General Terms version 1.7, effective 15 June 2026, clause 6.1.2, exclude "Persons (including, for the avoidance of doubt, legal entities) from the United States of America or a country that is subject to economic sanctions by the United Nations, the European Union, the United States of America, the United Kingdom or the Netherlands", S5.
- "From" covers citizenship, place of establishment, residence or centre of main interest, and trusts subject to such a country, clauses 6.1.2.1 to 6.1.2.4, S5.
- So a US person may not trade, even one resident in the EU.
- The ONEX Rulebook rule 4.2.7 admits a client only from "a jurisdiction in which One Trading is permitted to provide access to the ONEX" or one that does not prohibit its cross-border services, S6.
- The list of AET jurisdictions under rule 45 reads "[None specified]", S8 section 1.

Collateral is USD, EUR and GBP for every ONEX future, with a 1% haircut on EUR and GBP, S8 sections 3 and 4.
The API documentation still says "We currently only support EUR as collateral for futures positions", S15, which describes the closed EUR perpetuals.

The public REST and WebSocket endpoints answered every valid request from this host with HTTP 200 or 101, with no geoblock, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

| family | schedule | maker | taker | maker ppm | taker ppm | source |
|---|---|---|---|---:|---:|---|
| USD 5-Year Crypto Dated Futures | API trading, all volumes | -0.005% | 0.015% | -50 | 150 | S1, S2, S3 |
| USD 5-Year Crypto Dated Futures | standard schedule, 30-day volume 0 to 9,999 | 0.10% | 0.20% | 1,000 | 2,000 | S1, S2 |
| USD 5-Year Crypto Dated Futures | `GET /fees` group `FUTURES`, tier `volume` 0 | `"0.1000"` | `"0.2000"` | 1,000 | 2,000 | P1 |

The help center says "API Trading fees apply to both Spot and Futures trading when using the API", S3, and the dated futures fee article repeats the API row under "Futures API Trading", S2.
The engine would trade only through the API, so 150 ppm is the taker it would pay, if a new account's API orders are billed on that row.
The public fee-groups call knows only the groups `SPOT` and `FUTURES` and shows no API row, P1.
Whether the API row applies to every account from its first order could not be checked without an account, see section 9.

## 3. Coverage matrix

Counts are from `GET /fast/v1/instruments` on 2026-09-23 03:30 UTC, P1.

| product | present | detail |
|---|---|---|
| USD 5-Year Crypto Dated Futures, type `DATED_FUTURE` | yes, 10 `ACTIVE` | `BTC_USD_P`, `ETH_USD_P`, `XRP_USD_P`, `SOL_USD_P`, `LTC_USD_P`, `SUI_USD_P`, `TAO_USD_P`, `DOGE_USD_P`, `LINK_USD_P`, `ADA_USD_P`, expiry `2031-04-20`, funding every 240 minutes, researched here |
| EUR perpetuals, type `PERP` | listed, 4 `CLOSED` | `BTC_EUR_P`, `ETH_EUR_P`, `SOL_EUR_P`, `XRP_EUR_P`, no expiry, funding every 240 minutes |
| USD 5-year equity futures, type `EQUITY_FUTURE` | yes, 2 `ACTIVE` and 1 `POST_ONLY` | `SPCX_USD_P` and `ONEX100_USD_P` active, `ONEX500_USD_P` post only, NASDAQ session funding twice a day. S8 names 13 equity contracts, and the API lists 3 |
| short-term dated crypto futures, no funding | described, none listed | S7 section 6.3 |
| USDT-M or USDC-M perpetuals | absent | |
| coin-margined perpetuals | absent | |
| options | absent | none in the catalog, and CCXT `option: false` at `onetrading.js` line 33 |
| spot | yes, 3 `ACTIVE` and 12 `CLOSED` | `BTC_USDC`, `ETH_USDC`, `USDC_EUR` active |
| margin spot | absent | CCXT `margin: false` at `onetrading.js` line 30 |

Settlement is cash only, in the quote asset, which is US dollars for every active future, S7 section 2.3.
USD is in the engine's quote family, which maps `USD` to `USDT`, at `server/src/engine/cluster/quoteFamily.ts` lines 3 to 6.

## 4. Dated futures tiers

### Standard schedule

| 30-day volume | maker, S1 page | taker, S1 page | maker, `GET /fees` | taker, `GET /fees` | taker ppm |
|---|---|---|---|---|---:|
| 0 to 9,999 | 0.10% | 0.20% | 0.1000 | 0.2000 | 2,000 |
| 10,000 to 99,999 | 0.04% | 0.08% | 0.0400 | 0.0800 | 800 |
| 100,000 to 999,999 | 0.025% | 0.06% | 0.0200 | 0.0600 | 600 |
| 1,000,000 to 4,999,999 | 0.02% | 0.05% | 0.0200 | 0.0500 | 500 |
| 5,000,000 to 24,999,999 | 0.015% | 0.045% | 0.0150 | 0.0450 | 450 |
| 25,000,000 to 99,999,999 | 0.01% | 0.04% | 0.0100 | 0.0400 | 400 |
| 100,000,000 to 499,999,999 | 0.003% | 0.035% | 0.0030 | 0.0350 | 350 |
| 500,000,000 to 999,999,999 | 0.002% | 0.03% | 0.0020 | 0.0300 | 300 |
| 1,000,000,000 to 9,999,999,999 | 0.001% | 0.028% | 0.0010 | 0.0280 | 280 |
| 10,000,000,000 and above | "-" | 0.025% | 0.0000 | 0.0250 | 250 |

The endpoint values are percent strings, and its `volume` column holds the lower bound of each tier, P1.
The spot schedule equals this one row for row, on the page and in the `SPOT` group, S1 and P1.

Three sources disagree in two places.

- The fees page heads the volume column "30-Day Volume (USD)", S1, while the two help articles and the endpoint's `volume_currency` say EUR, S2, S3 and P1.
- The 100,000 tier maker is 0.025% on the page and in both help articles, and `"0.0200"` on the endpoint, in both groups.

### API trading

| 30-day volume | maker | taker | source |
|---|---|---|---|
| All | -0.005% | 0.015% | S1, S2, S3 |

### Qualification

Fee tiers follow "your 30-day rolling trading volume, automatically calculated by our system", S2.
The private account fee call is described as "Fees are calculated and combined across all subccounts", S16.
All fees are "percentages of the notional trade value, deducted at the time of the trade", S2.

## 5. Discounts that change the taker

| discount | finding | source |
|---|---|---|
| API trading | a flat -0.005% maker and 0.015% taker for orders sent through the API, on spot and futures, whatever the volume | S1, S2, S3 |
| token holding | none published on the fees page or in the fee articles | S1, S2, S3 |
| referral | none published | S1 |
| market maker programme | none published | S1 |
| zero fee promotion | none published on 2026-09-22 | S1 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays | a positive rate means longs pay shorts, a negative rate means shorts pay longs | S9, S12, S17 |
| interval | every 4 hours, at 00:00, 04:00, 08:00, 12:00, 16:00 and 20:00 UTC | S17. The settled history of all 10 contracts over three days held 18 rows each, 4 h apart, at exactly those hours, P3 |
| amount | "the then current Funding Rate" times the position size, valued at the Settlement Price | S7 sections 5.3 and 7.7 |
| update cadence | the preliminary rate is recalculated every minute | S15, S17, and P2 saw it change at most once in each of three runs of 60 one-second polls |
| interest component | `r = (1 + R)^(1/n) - 1`, with `R` the annual rate and `n` the funding periods in a year | S9 |
| annual rate `R` | 0.04 on every contract | `GET /funding-rate/settings`, P3 |
| interest per 4 h | 0.0000179092, since `n` is 6 times 365 = 2,190 | computed, P3. The settled BTC rate was 0.0000179007 at 2026-09-23 00:00 UTC |
| premium component | a time-weighted average of the minute premium of mark over index over the 4 h period, with weights rising linearly through the period | S9, S7 section 7.7 |
| clamp | `clamp_threshold` 0.0005 on the dampening adjustment | S9, P3 |
| cap | `cap` 0.001 on the final rate, 0.1% per 4 h | S9, P3 |
| observed range | -0.000648 (`LTC_USD_P`) to +0.000822 (`TAO_USD_P`) over 180 settlements, none at the cap | P3 |
| fee on funding | "One Trading does not charge fees on the funding rate" | S9 |
| equity futures | twice a day in US market hours, 3 h 15 min apart, none outside them | S12 |

The formulas for the premium index, the weighted average and the final rate are images on S9, not text.
Their shape is the one S7 section 7.7 describes in words: a clamped premium term plus the interest term, then capped.
The instant of a settlement was not captured, so when a position must be open to be charged is Not verified.
S7 section 5.4 only says the account must be funded "at the end of each 4-hour period".

## 7. Liquidation, settlement and delisting

- Liquidation fee: "3% applies to liquidated positions", S1.
- Liquidation orders are immediate-or-cancel limit orders priced "at up to 300 basis points each side from the Mark Price", then without a limit if unfilled, S7 section 8.3.
- Auto-deleveraging applies when liquidation orders would exceed 10 times the resting volume within 300 basis points of the mark, S7 section 8.4.
- Profit and loss settle with every Settlement Price tick, once a minute, S7 section 5.1.
- At expiry every open position is cash settled at a TWAP of the index over the Expiry TWAP Window, with no roll, S7 sections 6.4 and 7.3.
- On delisting "all open positions are terminated at the effective date and time specified", S7 section 2.1.
- An account with no trade in 90 days pays a custody fee of 0.17% of its balance, excluding futures collateral, on the 12th of each month, S1.
- Deposit and withdrawal charges are in the help center articles linked from S1.

## 8. CCXT

| item | value | source |
|---|---|---|
| exchange default taker | `this.parseNumber('0.0015')`, 1,500 ppm | `server/node_modules/ccxt/js/src/onetrading.js` line 203 |
| exchange default maker | `this.parseNumber('0.001')`, 1,000 ppm | same file, line 204 |
| `market.taker` for `BTC_USD_P` without credentials | 0.0015 | P1 |
| market type for `BTC_USD_P` | `spot`, symbol `BTC/USD` | P1, because `isPerp` is `type === 'PERP'` at line 537 and the type is `isPerp ? 'swap' : 'spot'` at line 551 |
| `fetchPublicTradingFees` | reads the `SPOT` group for any market CCXT calls spot, so it would give a dated future the spot tier | same file, line 678 |

CCXT's 1,500 ppm matches neither the standard 2,000 ppm nor the API 150 ppm.
The tier table beside it, lines 205 to 226, is an old schedule by BTC volume.
CCXT master, version 4.5.82 on 2026-09-22, still maps only `PERP` to a swap, at `ts/src/onetrading.ts` lines 552 to 576 of the GitHub master branch.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 150 | the API trading taker of S1, S2 and S3, the only schedule the engine's orders would meet |
| `ccxtTakerPpm` | 1500 | what CCXT 4.5.68 reports on every market, at `onetrading.js` line 203 |

If an account shows the standard schedule for API orders, `takerPpm` becomes 2000, the tier 0 taker of S1 and of `GET /fees`.
The engine cannot load this venue today anyway, because CCXT types every dated future as spot and the connector keeps only active swaps, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees at One Trading | https://www.onetrading.com/fees | 2026-09-22 | One Trading Exchange B.V. | standard and API schedules, liquidation fee, custody fee, entity footer, sections 1 to 7 |
| S2 | What fees can I expect when trading dated futures at One Trading?, updated 2026-08-24 | https://support.onetrading.com/hc/en-gb/articles/34960068992913 | 2026-09-22 | One Trading Exchange B.V. | dated futures schedule in EUR, Futures API Trading row, sections 2, 4 and 5 |
| S3 | What fees can I expect to pay for trading on the Exchange?, updated 2026-08-24 | https://support.onetrading.com/hc/en-gb/articles/21953902771473 | 2026-09-22 | One Trading Exchange B.V. | API fees apply to spot and futures through the API, sections 2 and 5 |
| S4 | Am I eligible to trade futures?, updated 2026-08-24 | https://support.onetrading.com/hc/en-gb/articles/34863040867729 | 2026-09-22 | One Trading Exchange B.V. | professional and retail eligibility, section 1 |
| S5 | General Terms and Conditions version 1.7, effective 15 June 2026, from the terms page | https://www.onetrading.com/terms | 2026-09-22 | One Trading Exchange B.V. | clause 6.1.2 exclusions, earlier entity, section 1 |
| S6 | ONEX Rulebook, effective 23 April 2026, from the terms page | https://www.onetrading.com/terms | 2026-09-22 | ONEX | rule 4.2.7 access, section 1 |
| S7 | ONEX Crypto Futures, Product Specifications, April 2026, from the futures specifications page | https://www.onetrading.com/futures-specifications | 2026-09-22 | ONEX | tenor, settlement, mark, index, funding, liquidation, sections 1, 3, 6 and 7 |
| S8 | Supplemental Information to ONEX Rulebook and ONEX Futures, June 2026 | https://www.onetrading.com/supplemental_information_to_onex_rulebook_and_onex_futures | 2026-09-22 | ONEX | AET jurisdictions, instrument list, collateral, leverage, sections 1 and 3 |
| S9 | Funding Rate Methodology | https://docs.onetrading.com/futures/funding-rate-methodology | 2026-09-22 | One Trading API | interest formula, clamp, cap, no fee on funding, section 6 |
| S10 | Instruments, One Trading API docs | https://docs.onetrading.com/rest/public/instruments | 2026-09-22 | One Trading API | `DATED_FUTURE` is the type for perpetual futures, introduction |
| S11 | What are 5-Year Crypto Dated Futures?, updated 2026-08-24 | https://support.onetrading.com/hc/en-gb/articles/34862729268241 | 2026-09-22 | One Trading Exchange B.V. | product behaves like a perpetual, introduction |
| S12 | What is the funding rate?, updated 2026-08-24 | https://support.onetrading.com/hc/en-gb/articles/34887951693841 | 2026-09-22 | One Trading Exchange B.V. | direction of payment, equity schedule, section 6 |
| S13 | CCXT 4.5.68 `onetrading.js` | `server/node_modules/ccxt/js/src/onetrading.js` | 2026-09-22 | CCXT | default fees, market mapping, section 8 |
| S14 | CoinGecko exchange `bitpanda` and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/bitpanda | 2026-09-22 | CoinGecko | country, trust rank, volume, section 1 |
| S15 | Futures Introduction, One Trading API docs | https://docs.onetrading.com/futures/introduction | 2026-09-22 | One Trading API | futures subaccounts, EUR collateral note, minute recalculation, sections 1 and 6 |
| S16 | One Trading API docs index | https://docs.onetrading.com/llms.txt | 2026-09-22 | One Trading API | fees combined across subaccounts, section 4 |
| S17 | Current Funding Rate | https://docs.onetrading.com/futures/current-funding-rate | 2026-09-22 | One Trading API | settlement hours, minute recalculation, section 6 |
| S18 | CCXT master `onetrading.ts`, version 4.5.82 | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/onetrading.ts | 2026-09-22 | CCXT | the mapping is unchanged upstream, section 8 |
| P1 | `rest-probe.mjs catalog` at 03:30, 03:45 and 03:55 UTC, the last run printing the fee groups | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | fee groups, catalog counts, CCXT market, sections 2, 3, 4 and 8 |
| P2 | `rest-probe.mjs anchor` at 03:34, 03:46 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | rate changes once a minute, section 6 |
| P3 | `rest-probe.mjs funding` at 03:35 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | settings, settled history, section 6 |
