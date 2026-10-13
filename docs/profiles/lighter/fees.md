# Lighter Fees Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:18 to 22:48 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that ipinfo.io placed in Vancouver, British Columbia, Canada.

This profile covers the trading fees of Lighter (CCXT id `lighter`), a decentralised perpetual exchange whose order book runs on Lighter's own zero knowledge rollup over Ethereum.
It covers the one perpetual family, linear perpetuals margined and settled in USDC.
Every probed number comes from [`fees-probe.py`](../../../scripts/probes/venues/lighter/fees-probe.py) or [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py), run with `uv run` from the repository root, and the runs are listed in section 10.
The socket is in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).
Where the documentation and the wire disagree, both are written.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Elliot Technologies, Inc., which provides the interface and the API for the Lighter Protocol, under Florida law | S7 |
| who may trade | the Terms of Service of 2025-12-29 say the services are "not available to persons or entities who reside in, are located in, are incorporated in" the United States, Canada, the United Kingdom, China, North Korea, Russia, Ukraine, Cuba, Iran, Venezuela, Sudan, Belarus, Myanmar or Syria | S7 |
| US persons | may not trade | S7 |
| this host | the trading socket refused the Canadian exit with HTTP 400 and code 20558, "You are accessing Lighter from a restricted jurisdiction", while public REST and the read-only socket answered, see [`websocket.md`](./websocket.md) section 1 | Probed, W1 |
| account tiers | Standard by default, Plus and Premium by opt-in, chosen per L1 address and shared by its sub-accounts | S1, S2 |
| a separate exchange | Lighter on Robinhood Chain has its own endpoints, accounts and fee table, and CCXT's class does not read it, see [`rest.md`](./rest.md) section 9 | S10 |

The fee schedule is tied to the account tier, not to trading volume, on Lighter mainnet.
Lighter on Robinhood Chain ties its Premium tiers to 14 day volume instead, S10, and it is out of scope here.

## 2. Quick answer

| family | tier | maker | taker | maker ppm | taker ppm | evidence |
|---|---|---|---|---:|---:|---|
| USDC linear perpetuals | Standard, the default | 0% | 0% | 0 | 0 | Published, S1 and S2. Probed: `taker_fee` and `maker_fee` read `"0.0000"` on 239 of 239 perpetual rows, R2 |
| USDC linear perpetuals | Premium at 0 staked LIT | 0.0040% | 0.0280% | 40 | 280 | Published, S1 and S2 |
| USDC linear perpetuals | Plus | 0.005% | 0.005% | 50 | 50 | Published, S2. S1 writes the same rate as "0.5bps" |

The Standard taker is 0 ppm.
A Standard taker order waits 300 ms before it executes, S2 and S11, so a free cross is a slow one.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDC-margined linear perpetuals | yes, 239 rows, 213 `active` and 26 `inactive` | Probed, R2 and F1 |
| USDT-margined or coin-margined perpetuals | no. Every perpetual row has `quote_asset_id` 0 and CCXT sets quote and settle to `USDC` | Probed, R2 and F1 |
| dated futures | no. CCXT declares `future` false at `lighter.js` line 37 | S13 |
| options | no. CCXT declares `option` false at `lighter.js` line 38 | S13 |
| spot | yes, 11 rows, 10 active, among them `ETH/USDC`, `LIT/USDC` and the tokenised `rhSPY/USDC` and `rhQQQ/USDC`. Not detailed here | Probed, R2 |

Inside the one perpetual family the `funding_premium_multiplier` field separates three kinds of market.

| kind | `funding_premium_multiplier` | active markets | examples | evidence |
|---|---:|---:|---|---|
| crypto | 100, which S4 writes as 1 | 117 | `BTC`, `ETH`, `HYPE`, `1000PEPE` | Probed, R2 |
| RWA: equities, FX, commodities, indices and rates | 50, which S4 writes as 1/2 | 92 | `XAU`, `NVDA`, `EURUSD`, `US10Y`, `BB` | Probed, R2 |
| Pre-IPO and pre-market | 1, which S4 writes as 1/100 | 4 | `ANTHROPIC`, `OPENAI`, `OURA`, `VARIATIONAL` | Probed, R2 |

## 4. Perpetual tiers

### Standard

| maker | taker | taker latency | cancel and modify latency | maker latency | sub-accounts | source |
|---|---|---|---|---|---:|---|
| 0% | 0% | 300 ms | 300 ms | 0 ms | 4 | S2 |

S2 adds that a Standard TWAP order charges 1 bps, which is 100 ppm.
A Standard account is limited to 60 REST requests a rolling minute, S12.

### Plus

| maker and taker | taker latency | cancel and modify latency | maker latency | sub-accounts | source |
|---|---|---|---|---:|---|
| 0.005%, 50 ppm | 300 ms | 300 ms in S2, while S1 gives "Maker/Cancel Latency" as 200 ms | 0 ms | 16 | S1, S2 |

Plus is reached with the `changeAccountTier` call, which may run once every 24 hours, S2.

### Premium

Premium tiers are set by LIT staked across the L1 address and its sub-accounts, S1.
Fee credits bought through the LIT Fee Credits program count as staked LIT, S2 and S3.

| staked LIT | discount | maker | taker | maker ppm | taker ppm | taker latency |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | none | 0.0040% | 0.0280% | 40 | 280 | 140 ms |
| 1,000 | 2.5% | 0.0039% | 0.0273% | 39 | 273 | 140 ms |
| 3,000 | 5% | 0.0038% | 0.0266% | 38 | 266 | 140 ms |
| 10,000 | 10% | 0.0036% | 0.0252% | 36 | 252 | 140 ms |
| 30,000 | 15% | 0.0034% | 0.0238% | 34 | 238 | 140 ms |
| 100,000 | 20% | 0.0032% | 0.0224% | 32 | 224 | 140 ms |
| 300,000 | 25% | 0.0030% | 0.0210% | 30 | 210 | 140 ms |
| 500,000 | 30% | 0.0028% | 0.0196% | 28 | 196 | 140 ms |

Source: S1 and S2, which agree row for row.
Premium maker orders and cancels skip the speed bump, S2.

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | source |
|---|---|---|
| staking LIT | Premium only, from 2.5% at 1,000 LIT to 30% at 500,000 LIT, section 4 | S1 |
| LIT Fee Credits | bought credits count as staked LIT toward a Premium tier | S3 |
| referral | the CCXT class names a referral link whose discount is "10% of the points", which is a points share and not a fee rebate, at `lighter.js` lines 164 to 167 | S13 |
| market maker programs | Points Season 2 for market makers ended on 2025-12-26, by the docs index | S15 |
| zero fee promotion | the Standard tier is free with no published end date, S1 says "currently" | S1 |

An integrator, which Lighter also calls a partner, may add its own fee to every order sent through its front end.
The cap is in `systemConfig`, in millionths of the trade, S6.
On 2026-10-12 it was 1,000 for perpetual takers and makers, which is 10 bps, and 10,000 for spot, F1 and F2.
Only Plus and Premium accounts may send orders that carry a non-zero integrator fee, S6.
CCXT sets an integrator fee of 1,000, 0.1%, to its own account 718718 by default, at `lighter.js` lines 348 and 355 to 357, so an order placed through CCXT with its defaults pays 1,000 ppm on top of the tier.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | one hour on every deployed market. "Funding period is a configuration of each market", so a new market may differ | S14, and Probed: the `fundings` history for `BTC` and `ETH` held 26 hourly rows on whole UTC hours, R4 |
| who pays | a positive rate means longs pay shorts, and a negative rate means shorts pay longs | S4 |
| exchange share | none: "These payments are fully peer-to-peer with no fees taken by the exchange" | S4 |
| payment | funding = minus position times index price times funding rate, so the payment is valued at the index and not the mark | S4 |
| premium | sampled once a minute at a random time, from the impact bid and ask against the index | S4 |
| rate | the hourly average premium times the market's `FundingPremiumMultiplier`, pulled toward the interest rate by a clamp of ±0.05%, then clamped at ±4% and divided by 8 | S4 |
| interest | 0.01% per 8 hours on most markets. `base_interest_rate` read `0.0100` on 116 active markets, `0.0032` on 87 and `0.0000` on 10, among them the FX pairs, `US10Y` and `STRC` | S4, and Probed, R2 |
| cap | ±4% per 8 hours, which is ±0.5% per hour. `funding_clamp_big` read `4.0000` on 211 active markets, `16.0000` on `RIVER` and `20.0000` on `ARC` | S4, and Probed, R2 |
| unit on the wire | percent per hour: the socket's `current_funding_rate` and `funding_rate` and the history's `rate` are strings such as `"0.0011"`, which is 0.0011% | Probed, see [`rest.md`](./rest.md) section 4 |

The engine treats funding as a separate leg cost, so the funding numbers belong to the anchor and are mapped in [`rest.md`](./rest.md) sections 3 and 4.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | up to 1% of a partial liquidation fill, paid to the LLP insurance fund. `liquidation_fee` read `"1.0000"` on 213 of 213 active rows | S5, and Probed, R2 |
| prelaunch markets | no liquidation fee, and a position below the close-out margin is auto-deleveraged | S9 |
| Pre-IPO markets | may be settled early when a stock split moves the price far from the feed, and are converted to normal markets after the IPO | S8 |
| delisting | no delisting charge is published. 26 perpetual rows are `inactive`, and 16 active rows carry `force_reduce_only` true | Not publicly specified, and Probed, R2 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` without credentials | `0.0` on 239 of 239 swaps, `BTC/USDC:USDC` included | Probed, F1 and F2 |
| where it comes from | `this.safeNumber(market, 'taker_fee')` on the `orderBookDetails` row, at `lighter.js` line 1218 | S13 |
| the class constant | `fees.taker` 0 and `fees.maker` 0, at `lighter.js` lines 334 and 335 | S13 |
| unit | the wire value is a percent, S16 says "Taker and maker fees are in percentage", while CCXT reads it as a fraction, so a non-zero value would be read 100 times too large. On 2026-10-12 every value was zero, so the two agree | S16, S13 |
| integrator fee | 1,000 millionths to account 718718 on every order CCXT signs, at `lighter.js` lines 348 and 355 to 357 | S13 |

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 0 | the VIP 0 taker of the default Standard account, section 2, which is what any account pays until it opts into Plus or Premium |
| `ccxtTakerPpm` | 0 | CCXT 4.5.68 reads `taker_fee` `"0.0000"`, at `lighter.js` line 1218 |

Two caveats go with the zero.
A Standard taker order waits 300 ms before it executes, S2 and S11, so the book it crosses may have moved.
An arbitrage desk at size would most likely run Premium at 280 ppm for a 140 ms taker delay, so 280 is the number to use if the observatory ever models a Premium leg.
The Rust adapters declare the fee as a `u32` constant, and bitfinex already ships 0 at [`markets.rs`](../../../server/src/venues/bitfinex/markets.rs) line 10.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Lighter Docs, Trading Fees | https://docs.lighter.xyz/trading/trading-fees | 2026-10-12 | Lighter, docs | tiers, staking discounts, sections 2, 4 and 5 |
| S2 | Lighter API Docs, Account Types | https://apidocs.lighter.xyz/docs/account-types | 2026-10-12, page updated in October 2026 | Lighter, API docs | tier table, latencies, TWAP fee, sections 2 and 4 |
| S3 | Lighter Docs, LIT Fee Credits | https://docs.lighter.xyz/trading/trading-fees/lit-fee-credits | 2026-10-12 | Lighter, docs | credits count as stake, section 5 |
| S4 | Lighter Docs, Funding | https://docs.lighter.xyz/trading/funding | 2026-10-12 | Lighter, docs | formula, clamps, interest, multiplier, payment, section 6 |
| S5 | Lighter Docs, Liquidations and LLP (Insurance Fund) | https://docs.lighter.xyz/trading/liquidations-and-llp-insurance-fund | 2026-10-12 | Lighter, docs | liquidation fee, section 7 |
| S6 | Lighter API Docs, Partner Attribution | https://apidocs.lighter.xyz/docs/partner-integration | 2026-10-12 | Lighter, API docs | integrator fee unit and tier rule, section 5 |
| S7 | Lighter Terms of Service, last updated 2025-12-29 | https://lighter.xyz/terms | 2026-10-12 | Elliot Technologies, Inc. | operator, excluded regions, governing law, section 1 |
| S8 | Lighter Docs, Pre-IPO Markets | https://docs.lighter.xyz/trading/real-world-assets-rwas/pre-ipo-markets | 2026-10-12 | Lighter, docs | settlement and conversion, section 7 |
| S9 | Lighter Docs, Prelaunch Markets | https://docs.lighter.xyz/trading/prelaunch-markets | 2026-10-12 | Lighter, docs | no liquidation fee, section 7 |
| S10 | Lighter API Docs, Lighter on Robinhood Chain | https://apidocs.lighter.xyz/docs/lighter-rh | 2026-10-12 | Lighter, API docs | the separate exchange and its fees, section 1 |
| S11 | Lighter API Docs, Core concepts | https://apidocs.lighter.xyz/docs/core-concepts | 2026-10-12 | Lighter, API docs | the speed bump, section 2 |
| S12 | Lighter API Docs, Rate Limits | https://apidocs.lighter.xyz/docs/rate-limits | 2026-10-12, page updated 2026-10-08 | Lighter, API docs | Standard request budget, section 4 |
| S13 | CCXT 4.5.68 `lighter.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/lighter.js` | 2026-10-12 | CCXT | taker mapping, integrator defaults, sections 3, 5 and 8 |
| S14 | Lighter Docs, Contract Specifications | https://docs.lighter.xyz/trading/contract-specifications | 2026-10-12 | Lighter, docs | one hour funding period, section 6 |
| S15 | Lighter Docs index | https://docs.lighter.xyz/llms.txt | 2026-10-12 | Lighter, docs | Points Season 2 end date, section 5 |
| S16 | Lighter API Docs, orderBooks reference | https://apidocs.lighter.xyz/reference/orderbooks | 2026-10-12 | Lighter, API docs | fees are in percent, section 8 |
| F1 | `fees-probe.py p1` at 22:24 UTC, CCXT 4.5.68 `load_markets` and `systemConfig` | [`fees-probe.py`](../../../scripts/probes/venues/lighter/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3, 5 and 8 |
| F2 | `fees-probe.py p2` at 22:41 UTC, the rerun | [`fees-probe.py`](../../../scripts/probes/venues/lighter/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 5 and 8 |
| R2 | `rest-probe.py catalog` at 22:19 UTC, `orderBookDetails` with and without `filter=perp` | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2, 3, 6 and 7 |
| R4 | `rest-probe.py anchor` at 22:20 UTC, with `fundings` for `BTC` and `ETH` | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | section 6 |
| W1 | `ws-probe.py deflate` at 22:27 UTC | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 1 |
