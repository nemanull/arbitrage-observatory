# P2B Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:05 to 03:34 UTC), from the development host near Seattle, in two passes.

P2B, formerly P2PB2B (CCXT id `p2b`), is a centralized spot exchange, and it lists no perpetual, dated future, option or margin product.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22, the fee API and the Terms of Use read the same evening | S1, S2, S4 |
| operators | "the P2B operators, including the companies TECHTONIC SOFTWARE S.A., SMART DIGITAL SOLUTIONS LIMITED, DIGITAL ONE SOFTWARE LIMITED, P2B SOLUTIONS LLC", with "Special Tokens" services run "exclusively by the company FINPEAKS LLC" | S4, section I |
| governing law | Republic of Estonia, arbitration in Tallinn | S4, section XXII |
| country | Lithuania on CoinGecko, founded 2018, and `countries: ['LT']` in CCXT at `server/node_modules/ccxt/js/src/p2b.js` line 22 | S6, S7 |
| Restricted Locations | 26 countries: Afghanistan, Iran, Iraq, Yemen, North Korea, Libya, Palestine, Somalia, Syria, Sudan, Burundi, the Central African Republic, Chad, Cote D'Ivoire, Cuba, the Democratic Republic of the Congo, Eritrea, Ethiopia, Guinea, Haiti, Liberia, Myanmar, Uganda, Zimbabwe, Russia and Belarus | S4, section III |
| further restriction | "P2B currently may restrict trading activity for Users (including residents and citizens, or through agency or representation) in the certain jurisdictions (including, but not limited to): United States, Canada, UK, Australia, France, Japan, People's Republic of China." | S4, section III |
| US persons | the United States is not a Restricted Location, but it heads the list above. The terms also say P2B "does not offer securities services in the United States or to U.S. persons" and that U.S. persons "shall not use the P2B platform to acquire or trade Digital Currency(ies), which according to U.S. laws, might be considered security token(s)" | S4, section III |
| access from this host | the website, the fee API and the public market data API all answered 200 on 2026-09-22, with no geoblock and no challenge page, see [`rest.md`](./rest.md) section 1 | P1 |

So US persons are not barred outright by the terms, but the venue reserves the right to restrict them, and the Terms of Use are the only statement found.
No account was opened, so what the signup flow does with a US address is Not verified.

## 2. Quick answer

| product | maker | taker | ppm maker | ppm taker | source |
|---|---|---|---:|---:|---|
| spot, level 0 | 0.2 % | 0.2 % | 2,000 | 2,000 | S1 level 0, S2 |
| spot, level 0, fee paid in PACT | 0.15 % | 0.15 % | 1,500 | 1,500 | S1 level 0 `takerFeeExchangeCurrency` |

The fee API answers with fractions: level 0 is `"takerFee":"0.002","makerFee":"0.002"`, S1.
The trade settings call an anonymous visitor gets answers `{"fee":"0.002","isExchangeCurrencyPayFeeEnabled":false,"discountForPayFeeExchangeCurrency":"0.25"}`, S2.
The same 0.2 % applies to every market, except that three tokens carry an extra fee, section 5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes, 173 markets | [`rest.md`](./rest.md) section 2 |
| USDT-M, USDC-M or coin-M perpetuals | absent | no futures route, page or string on the site, `https://p2pb2b.com/futures/` answered 404, the API documentation has no futures section, CCXT has `swap: false` at `p2b.js` line 30, and P2B is not in CoinGecko's derivatives exchange list, S3, S5, S6, P1 |
| dated futures | absent | `future: false` at `p2b.js` line 31, and nothing on the site |
| options | absent | `option: false` at `p2b.js` line 32 |
| margin | absent | `margin: false` at `p2b.js` line 29, and no margin page on the site |

A web search on 2026-09-22 surfaced a third-party review, S8, which says "P2B offers both spot and futures trading" and "margin trading is not available".
No official page, API route, site bundle string, CCXT flag or CoinGecko listing supports the futures claim, so this profile treats P2B as spot only.

## 4. Spot tiers

Every level from the fee API, S1, which is the table the fee schedule page renders in the browser.
The page itself ships an empty table in its HTML and fills it from this call, S3.

| level | 30 day volume in BTC | or PACT balance | taker | maker | taker, fee in PACT | maker, fee in PACT |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0.20 % | 0.20 % | 0.15 % | 0.15 % |
| 1 | 1 | 150 | 0.19 % | 0.18 % | 0.1425 % | 0.135 % |
| 2 | 5 | 300 | 0.18 % | 0.16 % | 0.135 % | 0.12 % |
| 3 | 10 | not reachable | 0.17 % | 0.14 % | 0.1275 % | 0.105 % |
| 4 | 25 | not reachable | 0.16 % | 0.12 % | 0.12 % | 0.09 % |
| 5 | 75 | not reachable | 0.15 % | 0.10 % | 0.1125 % | 0.075 % |
| 6 | 100 | not reachable | 0.14 % | 0.08 % | 0.105 % | 0.06 % |
| 7 | 150 | not reachable | 0.13 % | 0.06 % | 0.0975 % | 0.045 % |
| 8 | 300 | not reachable | 0.12 % | 0.04 % | 0.09 % | 0.03 % |
| 9 | 450 | not reachable | 0.11 % | 0.02 % | 0.0825 % | 0.015 % |
| 10 | 500 | not reachable | 0.10 % | 0.01 % | 0.075 % | 0.0075 % |

### Qualification

Each level is reached by volume or by balance, since every row carries `"conditionUnionType":"or"`, S1.
The balance is PACT, the venue's community token, because the fee page's strings include "Your PACT Balance", S3.
Levels 3 to 10 carry `"conditionBalance":"9999999"`, so in practice only levels 1 and 2 can be bought with a PACT balance.
"Cumulative 30-day trading volume is automatically calculated daily at 00:00 (UTC). Your level and fees are updated daily at 02:00 (UTC) to correspond with the table below.", S3.

## 5. Discounts that change the spot taker

| discount | effect | source |
|---|---|---|
| pay the fee in PACT | 25 % off every level, level 0 taker 0.15 % | S1, S2, "25% discount with PACT" on S3 |
| PACT balance | 150 PACT buys level 1, 300 PACT buys level 2 | S1 |
| per token extra fee | `UTOPIA` 0.05, `PIT` 0.04 and `TREAT` 0.02, each `isEnabled: true`, starting 2022-06-01, 2022-08-09 and 2025-11-24, and ending in 2050 | S9 |
| zero fee pairs | the site carries the notice "Please note that this pair - {{pair}} has Zero trading fee now", and no public call listing such pairs was found | S3 |
| referral | a referral program and "Referral games" exist on the site, and their effect on the fee was not researched | S3 |

The extra fee is shown to users as "The additional trading fee for this pair is {{extraFee}} % due to the project tokenomics.", S3.
Its unit is not stated, and the fee API's other numbers are fractions, so 0.05 is either 5 % or 0.05 %.
Of the three tokens, only `UTOPIA_USDT` is in the 173 market catalog on 2026-09-22, so the question touches one market.
No promotion with an end date was found.

## 6. Funding as a cost

P2B lists no perpetual and no margin, so there is no funding rate, interest or settlement charge.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement on a spot only venue.
Delisting follows the "Listing/Delisting policy" page linked from the site footer, which was not researched further.
Deposit and withdrawal fees are on the "Deposit & Withdrawal Fees" tab of the fee schedule page, S3.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `p2b`, spot only, `rateLimit: 100` | `server/node_modules/ccxt/js/src/p2b.js` lines 20 to 32 |
| fee block | `tierBased: true`, `percentage: true`, `taker` and `maker` given as arrays of `[volume, fee]` pairs | `p2b.js` lines 187 to 218 |
| tier values | taker `[0, 0.2]` to `[500, 0.1]`, maker `[0, 0.2]` to `[500, 0.01]`, the same eleven thresholds and rates as S1, written in percent | `p2b.js` lines 191 to 216, the taker array ending at line 202 and the maker array at line 215 |
| `market.taker` without credentials | the whole taker tier array, `[[0, 0.2], [1, 0.19], …]` | P2 `catalog`, and the base class merges `fees.trading` into every market at `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3732 to 3735 |

CCXT's `market.taker` for a P2B market is therefore not a number.
The connector's `toPpm` returns null for anything that is not a finite number, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 180 to 186, so `ccxtTakerPpm` has no value to declare.
Even read as a number, the first tier's `0.2` is in percent while CCXT fees are fractions, so it would read as 20 % and not 0.2 %.
Without a registry `takerPpm`, `toMarket` would drop every market for a missing taker, at the same file lines 162 to 166.

## 9. Recommended registry values

P2B cannot join the engine as it stands, because the connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202, and P2B has none.
If a spot leg is ever modelled, the values would be:

| key | value | reason |
|---|---|---|
| `takerPpm` | 2,000 | level 0 taker, S1 and S2 |
| `ccxtTakerPpm` | unset | CCXT reports a tier array, which `toPpm` reads as null, section 8 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | P2B fee levels, the call behind the fee schedule page | https://p2pb2b.com/v2/level-fees?limit=30 | 2026-09-22 | P2B, global | levels, rates, PACT rates, qualification, sections 2, 4 and 5 |
| S2 | P2B trade settings for an anonymous visitor | https://p2pb2b.com/v2/trade/settings | 2026-09-22 | P2B, global | default fee 0.002, PACT discount 0.25, sections 2 and 5 |
| S3 | P2B Fee Schedule page and its translation strings | https://p2pb2b.com/fee-schedule/ | 2026-09-22 | P2B, global | level update times, PACT wording, extra fee and zero fee notices, sections 3 to 5 and 7 |
| S4 | P2B Terms of Use, sections I, III and XXII | https://p2pb2b.com/terms-of-use/ | 2026-09-22 | P2B operators | operators, Restricted Locations, US persons, governing law, section 1 |
| S5 | P2B API documentation and errors table | https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md | 2026-09-22 | P2B, global | no futures endpoints, section 3 |
| S6 | CoinGecko exchange and derivatives exchange lists | https://api.coingecko.com/api/v3/exchanges/p2pb2b and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | Lithuania, 2018, trust rank 40, absent from derivatives, sections 1 and 3 |
| S7 | CCXT 4.5.68 `p2b.js` | `server/node_modules/ccxt/js/src/p2b.js` | 2026-09-22 | CCXT | product flags, fee tiers, section 8 |
| S8 | TradingFinder, P2B Exchange review, a third party | https://tradingfinder.com/exchanges/p2b/ | 2026-09-22 | third party | the unsupported futures claim, section 3 |
| S9 | P2B per token extra fees | https://p2pb2b.com/v2/currency-extra-fees?limit=100 | 2026-09-22 | P2B, global | `UTOPIA`, `PIT`, `TREAT`, section 5 |
| P1 | `curl` of the site, `/futures/`, the fee calls and the API | this host | 2026-09-22 | this host | access and the 404, sections 1 and 3 |
| P2 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/p2b/rest-probe.mjs) | 2026-09-22 | this host | CCXT `market.taker`, section 8 |
