# Bitfinex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:13 to 03:34 UTC on 2026-09-23 for the first pass and 03:34 to 03:45 UTC for the second, from the development host near Seattle.

This profile covers the perpetual contracts of Bitfinex Derivatives (CCXT id `bitfinex`), whose ids end in `F0`, and nothing else.
Spot, margin, lending, deposit and withdrawal schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitfinex/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitfinex/ws-probe.mjs).

How the sources were read from this host.
The fee page and the zero fee page are served as HTML and were read with curl.
The Help Center at `support.bitfinex.com/hc/...` answered HTTP 403 with a Cloudflare "Just a moment..." challenge to curl and to WebFetch, so its articles were read through the public Zendesk Help Center API at `https://support.bitfinex.com/api/v2/help_center/en-us/articles/<id>.json`, which answered 200.
The legal pages under `www.bitfinex.com/legal/derivative/` render their text in the browser, and curl, WebFetch and the Wayback Machine copy returned only the navigation, so each was rendered once by a headless Chrome on this host and closed.

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 for every source row | source ledger |
| operator of the perpetuals | Bitfinex Derivatives El Salvador, S.A. de C.V. ("BFXD") since 7 January 2025, before that iFinex Financial Technologies Limited ("BFXD Seychelles") | S8, the notice of change in counterparty |
| stale name in the API docs | the API page on derivatives still says "The derivatives platform is provided by iFinex Financial Technologies Limited", page updated 2025-06-10 | S13 |
| governing law of the derivative terms | British Virgin Islands | S8, paragraph 1 and the governing law clause |
| who may trade | "Trading in derivatives on Bitfinex is only available to Intermediate, and higher-level verified users in approved eligible jurisdictions." The verification table adds "Restrictions applied in certain jurisdictions" for derivatives | S4, S11 |
| collateral | USDt or BTC in the Derivatives wallet, isolated margin per position | S4 |
| prohibited persons | any U.S. Person, South African Person, Non-Exempt Japanese Person, Non-Exempt United Kingdom Person, Spanish Person and Canadian Person, any citizen or resident of the British Virgin Islands, the Government of Venezuela, residents and officials of a Prohibited Jurisdiction, and any Sanctioned Person, listed in that order in the definition | S8, definition of Prohibited Person, terms last updated April 6, 2026 |
| prohibited jurisdictions | Cuba, North Korea, Iran, Syria, Crimea, and the self-proclaimed Donetsk, Luhansk, Kherson and Zaporizhzhia People's Republics | S8, definition of Prohibited Jurisdiction |
| US persons | may not open an account or use any service: "No U.S. Person may directly or indirectly use any of the Services or the Site." | S10 |
| public data from this host | REST and WebSocket both answered without refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | probe |
| market size context | CoinGecko lists "Bitfinex (Futures)" with 80 perpetual pairs, 0 dated futures, 825.9 BTC of 24 h volume and 10,082.53 BTC of open interest | S15, read 2026-09-23 03:30 UTC |

Nobody on this host may trade the product, since the operator excludes US persons.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | evidence |
|---|---|---|---|
| USDt-settled perpetuals (`…F0:USTF0`, 75 listed) | 0 %, 0 ppm | 0 %, 0 ppm | S1 "Derivatives Trades, Maker fees Zero, Taker Fees Zero", S2, S3 |
| BTC-settled perpetuals (`…F0:BTCF0`, 4 listed) | 0 %, 0 ppm | 0 %, 0 ppm | same, the zero fee rule covers every perpetual contract |
| paper trading perpetuals (`TEST…F0:TESTUSDTF0`, 14 listed) | not a fee schedule, test money | | [`rest.md`](./rest.md) section 2 |

The zero fee schedule started on 17 December 2025 and names no end date.
The Help Center says "Starting December 17th, 2025, no (Maker or Taker) fees apply for: Spot and Margin trading, Derivatives trading, Securities trading, OTC trading", S4.
The zero fee page answers "Are fees being lowered as part of a promotion?" with "No, the lowering of trading fees to zero will be an ongoing change and become the new standard for our platform", S2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDt-settled perpetuals, linear | yes, 75 contracts, among them 8 equity index perpetuals, 2 implied volatility index perpetuals, EUR and GBP, and metals and oil (`XAUT`, `XAG`, `XPT`, `XPD`, `UKOIL`) | conf list, [`rest.md`](./rest.md) section 2 |
| BTC-settled perpetuals | yes, 4: `ETHF0:BTCF0`, `LTCF0:BTCF0`, `XAUTF0:BTCF0`, `XRPF0:BTCF0` | conf list |
| paper trading perpetuals | yes, 14 `TEST…F0:TESTUSDTF0` contracts in the same catalog | conf list |
| USDC-settled or coin-margined inverse perpetuals | absent | conf list |
| dated futures | absent: CoinGecko counts 0 futures pairs, and the conf list holds only `F0` ids | S15, conf list |
| options | absent on Bitfinex. The site navigation links a separate "Thalex Derivatives" venue, which this profile does not cover | S1 navigation |
| spot | present, 197 of CCXT's 290 markets are not swaps | CCXT `loadMarkets`, [`rest.md`](./rest.md) section 2 |
| margin trading, lending, deposits and withdrawals | present, see the fee page https://www.bitfinex.com/fees/ | S1 |

## 4. Perpetual tiers

None.
The zero fee page says "Zero thresholds. Zero tiers." and "All Bitfinex customers are eligible for zero trading fees. There are no volume requirements, no token holdings and no tier conditions to meet.", S2.
The fee page lists one row for derivatives trades, "Maker fees Zero" and "Taker Fees Zero", with no volume table, S1.

CCXT 4.5.68 still carries a pre zero fee table: taker 0.2 % falling to 0.1 % at 30,000,000 of volume, and maker 0.1 % falling to 0 at 7,500,000, at `server/node_modules/ccxt/js/src/bitfinex.js` lines 310 to 336.
That table matches neither the current schedule nor any derivatives schedule found, so it is context only.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | evidence |
|---|---|---|
| LEO holding | none on trading. The fee page applies LEO only to lending: "The discount in P2P lending fees reduces the fees by the equivalent of 0.05% for every 10,000 Tether (USDt) in LEO tokens held" | S1 |
| referral or affiliate | none can lower a zero fee, and none was found that pays a rebate on perpetual taker volume | S1, S2 |
| market maker program | none published | S1, S2 |
| promotion with an end date | none, the zero fee rule is stated as permanent | S2, S3 |

## 6. Funding as a cost

| item | value | evidence |
|---|---|---|
| interval | 8 hours for every perpetual, funding times 0:00, 8:00 and 16:00 UTC | S6 Table 2, and `NEXT_FUNDING_EVT_MTS` read `2026-09-23T08:00:00.000Z` on all 91 status rows, [`rest.md`](./rest.md) section 3 |
| average spread | "equally weighted samples consisting of the difference between (1) Derivative Mid-Price and (2) the last Mark Price for every three seconds of a Funding Period", as `(Derivative Mid-Price / Mark Price) - 1` | S6 |
| dead band | "When the Average Spread over the Funding Period is equal to or within -0.05% and 0.05%, a Funding Payment will not be required." | S6 |
| formula | positive: `MIN(cap, MAX(0.00%, Average Spread - 0.05%))`, longs pay. Negative: `MAX(-cap, MIN(0.00%, Average Spread + 0.05%))`, shorts pay | S6 |
| cap | 0.25 % on 86 of 91 status rows, 2.5 % on `SOLF0:USTF0`, 0.5 % on `CRVF0:USTF0`, and none published (`CLAMP_MAX` null) on `EUROPE50IX`, `FRANCE40IX` and `SPAIN35IX` | S6 Table 1 lists 0.25 % for 80 contracts and 2.50 % and 0.50 % for SOL and CRV, and the status reply agrees, [`rest.md`](./rest.md) section 4 |
| which period sets the payment | the one before: "At the Funding Time 8:00 (UTC), the Average Spread published for the Funding Period of 16:00 (UTC) to 0:00 (UTC) will determine whether a Funding Payment will be made at the 8:00 (UTC) Funding Time" | S6 |
| size | "(Position Size) * (Mark Price or Index Mark Price) * (Average Spread T-1)", on the final mark price before the end of the period | S6 |
| who is charged | only positions open "at the specific moment of a Funding Time" | S6 |
| trading pause | "all trade and order matching and accounting for Margin Collateral in Derivative Wallets will be paused for a period of time lasting several seconds or longer" at each funding time | S6 |
| probed | the rate charged at a settlement equals the dead band formula applied to the last average spread of the period before it, on all three BTC settlements of 2026-09-22 and 2026-09-23 | [`rest.md`](./rest.md) section 4 |

So the rate a position will pay at the next funding time is fixed eight hours ahead, when the previous period closes.
The settlement instant itself was not captured, and the probe read it from the one minute status history.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| liquidation | no separate fee. The collateral of a liquidated position and any profit in it are forfeited to the Liquidation Fund | S8 paragraphs on the Position Liquidation Process, S4 |
| termination | when the Liquidation Fund cannot cover a loss, BFXD closes the profitable positions with the highest percentage gain, "at prices worse than the prevailing market price" | S8, S12 |
| maintenance margin | base 0.5 % on `BTCF0:USTF0` for a position up to 150 BTC, rising by 0.5 % per 75 BTC step, capped at 29.5 % | S9 |
| settlement fee | none, the contracts are perpetual | S7 |
| delisting charge | Not publicly specified | S8 and S7 were searched |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` for every swap without credentials | 0.002, which is 2,000 ppm, on 93 of 93 swap markets | probe `catalog`, from `fees.trading.taker` at `server/node_modules/ccxt/js/src/bitfinex.js` line 309 |
| `market.maker` | 0.001, which is 1,000 ppm | same file, line 308 |
| where it comes from | `fetchMarkets` sets no fee, so each market inherits the exchange default | same file, lines 611 to 724 |
| authenticated fee call | `fetchTradingFees` splits fiat, derivative and default rates from an account endpoint, which this profile did not call | same file, lines 2701 to 2710 |

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 0 | the published taker for every perpetual since 2025-12-17, S1 to S4 |
| `ccxtTakerPpm` | 2,000 | what CCXT 4.5.68 reports on every swap, from line 309, so the connector's check passes |

The connector reads `takerPpm` with `??`, so a registry value of 0 is used as 0 and does not fall back to CCXT, at `server/src/ccxt/connector.ts` line 162.
The registry comment should cite `bitfinex.js` line 309 for the 2,000.
A zero taker means the engine sees Bitfinex legs as free, so the book depth and the funding dead band, not the fee, set what a Bitfinex leg can earn.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitfinex, Our Fees | https://www.bitfinex.com/fees/ | 2026-09-22 | Bitfinex, global | zero maker and taker on derivatives, LEO applies to lending, sections 2, 4, 5 |
| S2 | Bitfinex, Zero Trading Fees for Every Customer | https://www.bitfinex.com/zero-fee-trading/ | 2026-09-22 | Bitfinex, global | no tiers, no end date, sections 2, 4, 5 |
| S3 | Bitfinex blog, Bitfinex Introduces Zero Fee Trading, 17 December 2025 | https://blog.bitfinex.com/products/bitfinex-introduces-zero-fee-trading/ | 2026-09-22 | Bitfinex, global | start date, perpetuals included, section 2 |
| S4 | Help Center, Derivatives Trading on Bitfinex, edited 2026-02-02 | https://support.bitfinex.com/hc/en-us/articles/360035475374 | 2026-09-22 | Bitfinex Derivatives | eligibility, collateral, zero fees from 2025-12-17, sections 1, 2, 7 |
| S5 | Help Center, The Bitfinex Derivatives trading interface, edited 2025-12-20 | https://support.bitfinex.com/hc/en-us/articles/360035973913 | 2026-09-22 | Bitfinex Derivatives | mark price as BFXCI, accrued funding every 3 s, [`rest.md`](./rest.md) section 4 |
| S6 | Perpetual Contract Funding Payment Summary, last updated August 24th, 2026 | https://www.bitfinex.com/legal/derivative/funding/ | 2026-09-22 | BFXD | funding formula, Table 1 caps, Table 2 times, section 6 |
| S7 | Derivative Product Description | https://www.bitfinex.com/legal/derivative/product/ | 2026-09-22 | BFXD | contract terms, BFXCI mark, section 7 and [`rest.md`](./rest.md) section 4 |
| S8 | Derivative Terms of Service, last updated April 6, 2026 | https://www.bitfinex.com/legal/derivative/terms/ | 2026-09-22 | BFXD, British Virgin Islands law | operator, prohibited persons and jurisdictions, liquidation and termination, sections 1 and 7 |
| S9 | Derivative Margin Schedule | https://www.bitfinex.com/legal/derivative/margin/ | 2026-09-22 | BFXD | margin steps, section 7 |
| S10 | Help Center, U.S. Person FAQ | https://support.bitfinex.com/hc/en-us/articles/115003461254 | 2026-09-22 | Bitfinex | US persons excluded, section 1 |
| S11 | Help Center, Verification levels at Bitfinex, edited 2026-09-04 | https://support.bitfinex.com/hc/en-us/articles/360017321633 | 2026-09-22 | Bitfinex | derivatives "Restrictions applied in certain jurisdictions", section 1 |
| S12 | Help Center, What is Termination on Bitfinex | https://support.bitfinex.com/hc/en-us/articles/360035477394 | 2026-09-22 | Bitfinex Derivatives | termination stages, section 7 |
| S13 | Bitfinex API docs, API Derivatives Trading, updated 2025-06-10 | https://docs.bitfinex.com/docs/derivatives | 2026-09-22 | Bitfinex | provider named as iFinex Financial Technologies Limited, section 1 |
| S14 | CCXT 4.5.68 `bitfinex.js` | `server/node_modules/ccxt/js/src/bitfinex.js` | 2026-09-22 | CCXT | taker and maker defaults, tier table, section 8 |
| S15 | CoinGecko API, derivatives exchange `bitfinex_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/bitfinex_futures | 2026-09-22 | CoinGecko | pair count, volume and open interest, section 1 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitfinex/rest-probe.mjs) | 2026-09-22 | this host | CCXT taker on every swap, family counts, sections 2, 3, 8 |
| P2 | `rest-probe.mjs anchor` and `history` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitfinex/rest-probe.mjs) | 2026-09-22 | this host | caps, funding times, settlement rule, section 6 |
