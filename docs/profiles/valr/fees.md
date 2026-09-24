# VALR Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in Seattle time, which was 03:05 to 03:37 UTC on 2026-09-23, from the development host near Seattle, in two passes.

This profile covers the fees of VALR for its perpetual futures, which VALR names VALR Futures and lists as `FUTURE` pairs.
VALR also sells a second product named VALR Perps, which routes orders to Hyperliquid, and this profile names it in the coverage matrix only.
Every number below carries a source id from section 10.
The help center pages answer this host with HTTP 403 and a Cloudflare "Just a moment..." challenge, so every help center article was read through the public Zendesk JSON of the same help center, `https://support.valr.com/api/v2/help_center/en-us/articles/<id>.json`, which answered 200.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local, the fee article was last updated 2026-09-21T11:28:59Z | S1 |
| platform owner | VALR (Pty) Ltd, registration 2018/211274/07, South Africa | S3 clause 1.3 |
| perpetual provider | VALR DAM (Pty) Ltd, registration 2022/869848/07, FSP 54897 under the FAIS Act, an Over-the-Counter Derivatives Provider | S3 clauses 1.1 and 1.2, S2 last line |
| who may trade the perpetuals | fully verified account holders "in qualifying jurisdictions", on a sub-account with futures enabled, after accepting the Futures Terms and the Risk Disclosures | S5, S3 clause 4.3 |
| qualifying jurisdictions | Not publicly specified. The Futures Terms say the service "may not be available or may be restricted in certain jurisdictions" | S3 clause 1.5 |
| regions VALR does not serve at all | Canada, Cuba, India, Iran, Kazakhstan, North Korea, Myanmar, Russia, Somalia, Sudan, South Sudan, Syria, Ukraine, United States Of America | S4, updated 2026-09-22 |
| US persons | may not trade, since VALR does not serve residents of the United States | S4 |
| sanctions | no service to anyone in or from a jurisdiction under US embargo, UN sanctions or the SDN and Denied Persons lists | S12 clause 14.4 |

What this host saw, as a fact and not a permission: the public REST API and the public trade WebSocket answered this host near Seattle without refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
The Perps v1 market data routes refused this host with 400 `{"code":-11268,"message":"API key header missing: X-VALR-API-KEY"}`, see [`rest.md`](./rest.md) section 6.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| VALR Futures, USDT-margined perpetuals, 4 active | 0.030 %, 300 ppm | 0.070 %, 700 ppm | S1, "Derivative Fee Tiers", tier 1 |
| VALR Perps, USDC, routed to Hyperliquid | no maker, every order is IOC | 0.055 % VALR fee plus the provider fee of 0.009 %, 0.045 % or 0.09 % by pair as at 4 July 2026 | S1 "VALR Perps" table, S6 "Trading Fees" |

The launch post of 2023-11-21 quoted "0.05% for takers and -0.01% for makers", S10.
That is not the current schedule, and a third party summary that repeats it is stale.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals, VALR's own book | yes, 4 active: `BTCUSDTPERP`, `ETHUSDTPERP`, `XRPUSDTPERP`, `SOLUSDTPERP` | `/v1/public/pairs`, P1, and CoinGecko "VALR Futures" lists the same 4, S11 |
| inactive `FUTURE` pairs still in the catalog | 21, among them `BTCUSDCPERP`, `ETHUSDCPERP`, `BTCZARPERP`, `USDTZARPERP`, `DOGEUSDTPERP` and `AVAXUSDTPERP` | P1 |
| USDC or ZAR margined perpetuals on VALR's book | absent today, the four such pairs are inactive | P1 |
| coin-margined or inverse perpetuals | absent | P1 |
| VALR Perps, USDC, routed to Hyperliquid and its trade[xyz] builder pairs | yes, "200+ Perps markets" per VALR, not countable here because every Perps route needs an API key | S8, S6, P3 |
| dated futures | absent, the catalog has only `SPOT` and `FUTURE` types and every `FUTURE` is a `PERP` | P1 |
| options | absent | P1 |
| spot | yes, 205 active spot pairs, with margin on some | P1 |

## 4. Perpetual tiers

"Derivative Fee Tiers" for perpetual futures, S1.

| tier | 30-day volume, USDT | maker | taker | taker ppm |
|---|---:|---:|---:|---:|
| 1 | 0 | 0.030 % | 0.070 % | 700 |
| 2 | 150,000 | 0.030 % | 0.060 % | 600 |
| 3 | 750,000 | 0.030 % | 0.050 % | 500 |
| 4 | 3,000,000 | 0.020 % | 0.040 % | 400 |
| 5 | 15,000,000 | 0.010 % | 0.040 % | 400 |
| 6 | 20,000,000 | 0.010 % | 0.035 % | 350 |
| 7 | 40,000,000 | 0.000 % | 0.030 % | 300 |
| 8 | 150,000,000 | 0.000 % | 0.025 % | 250 |
| 9 | 500,000,000 | 0.000 % | 0.020 % | 200 |

### Qualification

- The tier follows 30-day rolling volume on spot and futures, converted to USDT, and the most favourable of the two applies to both, S1.
- Tiers are assessed on the whole account, so every sub-account pays the same rate, S1.
- An upgrade takes effect the next day at 10:00 UTC, and a downgrade waits a 7 day protection period, S1.
- Stable to stable and OTC volume does not count toward spot volume, S1.
- VALR Perps volume does not count toward any tier, S1 and S6.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| referral, as the referrer | a rebate of 10 % or 15 % of the referrer's own trading fees, capped at about $100 in value | S13 |
| referral, as the referred user | 10 % of the user's own trading fees rebated, up to $100 | S13 |
| referral on VALR Perps | "Fees charged on Perps are not eligible for referral commission/rebates." | S6 |
| token holding | none found, VALR has no exchange token discount in S1 | S1 |
| market maker programme | VALR pays negative maker fees from spot tier 7 upward, and the perpetual schedule bottoms at a 0.000 % maker, no separate programme terms were found | S1, S14 |
| zero fee promotion | none found on 2026-09-22 | S1 |

The capped referral rebate does not move a steady taker rate, so the engine models the tier 1 taker.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | every hour, at the start of the hour | S2 "Funding", S9 "Futures Information" `nextFundingRun` |
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative | S2, S9 funding history field note |
| payment | `funding rate × position quantity × mark price`, in the quote currency, added to or taken from the balance each hour | S2 |
| formula | 24 hour time weighted average market price of the future, and 24 hour time weighted average index, then `[(future - index) / index] / 24` | S2 |
| floor | "If the rate is less than 0.0001% per hour, set funding rates to 0" | S2 |
| cap | "If the rate is greater than 1% per hour, set funding rates to 1%" | S2 |
| VALR's cut | none, "funding is exchanged directly peer-to-peer" | S2 |
| market price in the formula | `median(best bid, best ask, last traded price)` of the future | S2 glossary |
| observed rates | hourly rates between -0.000018 and 0.000009 on the four perpetuals over the 100 newest rows, which reached back to 2026-09-18 | P1 `funding_history` |

The floor is written one-sided, yet the history holds negative rates such as -0.000018, so in practice it applies to the size of the rate.
The history holds no row with a rate of 0, yet it skips hours: 1 six-hour step on `BTCUSDTPERP`, and two and three hour steps on `ETHUSDTPERP` and `SOLUSDTPERP`, P1.
That the skipped hours are the hours the floor set to 0 is an inference that the probe did not prove.
The settlement instant itself was not captured, and the behaviour across it comes from the funding history and the documentation.

VALR Perps funding is Hyperliquid's funding passed through unchanged, "generally every hour", S6.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation fee, stage 1 | 0.5 % on perpetuals | S1 "Liquidation fee" |
| stage 1 order | IOC order for 10 % of the largest debt, at least 500 units of the reference currency | S3 clause 10.5.1 |
| stage 2 | backstop takeover or auto-deleveraging below the auto-close margin, and the remaining equity goes to the insurance fund | S2 "Stage 2" |
| unrealised PnL | realised into balances at the end of each 4 hour session from 00:00 UTC, measured on the mark every 3 s | S2 |
| delisting | open positions close at "the average mark price in the 30 minutes preceding the delisting time", and open orders are cancelled, as for AVAX and DOGE on 2026-08-26 12:30 UTC | S8 |
| VALR Perps activation | 1 USDC once, on the first Perps trade | S1, S6 |

## 8. CCXT

CCXT 4.5.68 has no VALR class.
`require('ccxt').exchanges` run from `server/` lists 104 ids and none matches `valr`, and `server/node_modules/ccxt/js/src/` has no `valr.js`, P4.
The current CCXT master, commit `1d8b674` of 2026-09-22T12:48:27Z, has no `ts/src/valr.ts`: the GitHub contents listing of `ts/src` has no match and the raw file URL answers 404, P4.
Pull request 23445 "New exchange: Valr" of 2024-08-16 and issue 5320 "New Exchange: VALR" of 2019-06-19 are both still open, and pull request 21755 of 2024-03-16 was closed, S15.
So no `market.taker` exists to read, and `ccxtTakerPpm` has no CCXT constant to declare.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 700 | tier 1 perpetual taker, 0.070 %, S1 |
| `ccxtTakerPpm` | none | no CCXT class, section 8 |
| `createExchange` | cannot be a CCXT constructor | [`../../../server/src/venues/registry.ts`](../../../server/src/venues/registry.ts) line 29 types it as `() => ccxt.Exchange`, so VALR needs a catalog that does not come from CCXT, see [`rest.md`](./rest.md) section 2 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | What are VALR's charges? | https://support.valr.com/hc/en-us/articles/360015777451 | 2026-09-22, updated 2026-09-21 | VALR, global | tiers, VIP 0, liquidation fee, Perps fees, sections 2, 4, 5 and 7 |
| S2 | Perpetual Futures Trading Guide | https://support.valr.com/hc/en-us/articles/11078306427420 | 2026-09-22, updated 2026-09-14 | VALR DAM | funding, mark, liquidation stages, PnL sessions, sections 6 and 7 |
| S3 | Futures Terms of Service | https://support.valr.com/hc/en-us/articles/11154102227100 | 2026-09-22, updated 2026-09-09 | VALR DAM and VALR (Pty) Ltd | entities, eligibility, liquidation order size, sections 1 and 7 |
| S4 | Which countries does VALR support? | https://support.valr.com/hc/en-us/articles/360020320351 | 2026-09-22, updated 2026-09-22 | VALR, global | excluded countries, section 1 |
| S5 | How to enable Futures trading on VALR? | https://support.valr.com/hc/en-us/articles/11224098420892 | 2026-09-22, updated 2026-08-25 | VALR DAM | qualifying jurisdictions, sub-account rule, section 1 |
| S6 | VALR Perps - Technical Guide | https://support.valr.com/hc/en-us/articles/28651439052572 | 2026-09-22, updated 2026-08-27 | VALR DAM, Hyperliquid | Perps fees, IOC routing, funding pass-through, sections 2, 3 and 6 |
| S7 | Index price sources | https://support.valr.com/hc/en-us/articles/12616208965532 | 2026-09-22, updated 2026-06-18 | VALR | index baskets, see [`rest.md`](./rest.md) section 4 |
| S8 | VALR to Delist AVAX and DOGE Futures Pairs | https://support.valr.com/hc/en-us/articles/29548948460572 | 2026-09-22, updated 2026-08-12 | VALR DAM | delisting settlement, "200+ Perps markets", sections 3 and 7 |
| S9 | VALR API documentation, Postman collection | https://docs.valr.com/ and its collection JSON at https://docs.valr.com/api/collections/7185612/S1Lr5XDq | 2026-09-22 | VALR | funding fields, section 6 |
| S10 | VALR Launches Perpetual Futures Trading | https://blog.valr.com/blog/valr-launches-perpetual-futures-trading | 2026-09-22, published 2023-11-21 | VALR | the old launch fees, section 2 |
| S11 | CoinGecko API, exchange `valr` and derivatives exchange `valr-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/valr-futures | 2026-09-22 | CoinGecko | 4 perpetual pairs, trust rank 44, section 3 |
| S12 | Terms of Service | https://support.valr.com/hc/en-us/articles/360019021931 | 2026-09-22, updated 2026-09-23 UTC | VALR (Pty) Ltd | sanctions clause 14.4, section 1 |
| S13 | VALR Referral programme | https://support.valr.com/hc/en-us/articles/360018627872 | 2026-09-22, updated 2026-09-09 | VALR | referral rebates, section 5 |
| S14 | What is a market maker and why do we pay them? | https://support.valr.com/hc/en-us/articles/360018953371 | 2026-09-22 | VALR | maker payments, section 5 |
| S15 | CCXT on GitHub: `ts/src` at master, pull requests 23445 and 21755, issue 5320 | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no VALR class, section 8 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/valr/rest-probe.mjs) | 2026-09-22 | this host | catalog counts, funding history, sections 3 and 6 |
| P3 | `rest-probe.mjs errors` | [`rest-probe.mjs`](../../../scripts/probes/venues/valr/rest-probe.mjs) | 2026-09-22 | this host | Perps routes refused without a key, sections 1 and 3 |
| P4 | `node -e "console.log(require('ccxt').exchanges)"` from `server/`, and the GitHub contents API for `ccxt/ccxt` `ts/src` | local and https://api.github.com/repos/ccxt/ccxt/contents/ts/src | 2026-09-22 | this host | section 8 |
