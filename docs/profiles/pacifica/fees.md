# Pacifica Fees Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 at 22:27 UTC and again in the second pass at 22:38 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the perpetual fees of Pacifica (CCXT id `pacifica`), a decentralised perpetual venue that settles on Solana and matches orders off chain.
Its 77 perpetuals are all linear and USDC-margined, and one USDC spot market sits beside them.
Every probed number comes from [`fees-probe.py`](../../../scripts/probes/venues/pacifica/fees-probe.py), run with `uv run` from the repository root, and the runs are listed in section 10.
The socket is in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | label |
|---|---|---|
| operator | Pacifica, founded in January 2025, mainnet since June 2025, self-funded, S12. No legal entity is named in the documentation read here | Not publicly specified |
| custody | a non-custodial Solana bridge, with a hot wallet run by the matching engine and a Squads multisig cold vault, S13 | Published |
| who may trade | anyone with a Solana wallet, S11, outside the Restricted Jurisdictions, which are "the United States of America, Cuba, the Crimean Peninsula (including Sevastopol), Iran, Afghanistan, Syria, and North Korea", S4 | Region-specific |
| US persons | may not trade, S4. "Access to trading functionality from IP addresses from any Restricted Jurisdiction is programmatically restricted", S4 | Region-specific |
| caps during the closed beta | deposits up to 500,000 USD of account equity, and withdrawals up to 500,000 USD per 24 h, S11 | Published |
| access from this host | `GET /api/v1/info/fees` answered 200 through CloudFront, P1 and P2, and no public call in this profile or its siblings met a refusal or a geoblock | Probed |

Deposit, withdrawal and spot schedules are out of scope.
Deposits cost network gas only and a USDC withdrawal costs 1 USD, S11.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label |
|---|---|---|---|
| USDC-margined linear perpetuals, all 77 | 0.015 %, 150 ppm | 0.040 %, 400 ppm | Published, S1, and Probed as fee level 0, P1 and P2 |

The engine models a taker cross at the base tier, so 400 ppm is the number that matters.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | every perpetual is USDC-margined, S5 and [`rest.md`](./rest.md) section 2 |
| USDC-margined linear perpetuals | yes, 77 | 53 crypto names, three of them priced per 1,000 tokens, and 24 equity, FX, index, ETF and commodity markets, [`rest.md`](./rest.md) section 2 |
| coin-margined perpetuals | no | none in the catalog |
| dated futures | no | the catalog types every row `perpetual` or `spot` |
| options | no | none in the catalog, and CCXT declares `option` false at `pacifica.js` line 37 |
| spot | yes, 1 | `SOL-USDC`, 1x, no funding, S14, and named only here |

## 4. Every published perpetual tier

Tiers follow the 30-day rolling volume of the account, are recomputed daily, and subaccounts share the main account's tier and volume, S1.
The wire publishes the same table as fee levels 0 to 7 at `GET /api/v1/info/fees`, S2.

| tier, S1 | fee level on the wire | 30-day volume, S1 | maker | taker | maker ppm | taker ppm | label |
|---|---:|---|---|---|---:|---:|---|
| 1 | 0 | 0 | 0.015 % | 0.040 % | 150 | 400 | Published and Probed |
| 2 | 1 | over 5,000,000 USD | 0.012 % | 0.038 % | 120 | 380 | Published and Probed |
| 3 | 2 | over 10,000,000 USD | 0.009 % | 0.036 % | 90 | 360 | Published and Probed |
| 4 | 3 | over 25,000,000 USD | 0.006 % | 0.034 % | 60 | 340 | Published and Probed |
| 5 | 4 | over 50,000,000 USD | 0.003 % | 0.032 % | 30 | 320 | Published and Probed |
| VIP 1 | 5 | over 100,000,000 USD | 0.000 % | 0.030 % | 0 | 300 | Published and Probed |
| VIP 2 | 6 | over 250,000,000 USD | 0.000 % | 0.029 % | 0 | 290 | Published and Probed |
| VIP 3 | 7 | over 500,000,000 USD | 0.000 % | 0.028 % | 0 | 280 | Published and Probed |

The documented example reply of the fee level call shows level 0 at a maker of `0.00020` and a taker of `0.00050`, S2.
The wire answered `0.00015` and `0.0004` for level 0, which matches the tier table, so the example is illustrative and the wire is the value.
The reply carried `cache-control: public, max-age=3600`, and P1 and P2 were CloudFront hits 609 and 1,236 s old.
Spot uses the same schedule, and spot fees are taken from the received asset, S14.

## 5. Discounts that change the perpetual taker

| program | effect on the taker | label |
|---|---|---|
| VIP program | a trader who proves 30 days of volume on another exchange gets the matching Pacifica tier for 30 days, by a support ticket, S6 | Negotiated |
| market maker program | zero maker fees and higher rate limits, while "MM accounts pay regular taker fees based on total trading volume", S7 | Negotiated |
| referrals | points only: referrers get 10 % of referees' points and referees a 5 % point bonus, S8. No fee discount | Published |
| affiliates | up to 40 % of referees' fees shared with the affiliate, by selection, S8. Not a discount to the trader | Negotiated |
| builder codes | a third-party front end adds its own fee rate on top of the order fee once the user approves a `max_fee_rate`, S9. CCXT 4.5.68 asks for approval of builder code `CCXT` at `0.01`, which its comment reads as 0.01 %, so an order sent through CCXT can pay up to 100 ppm more, at `pacifica.js` lines 404 to 406 and 545 to 566 | Published |
| zero-fee promotions | none found in the documentation read on 2026-10-12 | Not publicly specified |

No token holding discount exists in the documentation read here.

## 6. Funding as a cost

| item | value | label |
|---|---|---|
| interval | 1 h on every perpetual, S3 and S5 | Published |
| formula | `funding_rate = (premium_index + clamp(interest_rate - premium_index, -0.05%, 0.05%))/8`, with an 8-hour interest rate of 0.01 %, S3 | Published |
| premium | the impact price difference over the oracle, with impact notionals of 20,000 USD for BTC and 6,000 USD for other assets, S3. The contract page also names ETH at 20,000 USDC, S5 | Published |
| sampling | every 5 s, shown as a TWAP of the estimated next 1 h rate, and averaged at the end of each hour, S3 | Published |
| cap | ±4 % per hour, S3 | Published |
| floor at rest | the interest term alone gives 0.0000125 per hour, and 67 to 68 of 77 perpetuals sat on it, see [`rest.md`](./rest.md) section 4 | Probed |
| who pays | longs pay shorts when the rate is positive, and shorts pay longs when it is negative, S3 | Published |
| isolated positions | funding comes out of the isolated margin, and the liquidation price is recomputed after each payment, S3 | Published |
| settlement instant | history rows land 2.1 s after each whole UTC hour, see [`rest.md`](./rest.md) section 4. The instant itself was not captured, by design | Probed |
| which published rate is charged next | the docs and the wire disagree, see [`rest.md`](./rest.md) section 4 | Not publicly specified |

## 7. Liquidation, settlement and delisting charges

| item | value | label |
|---|---|---|
| maintenance margin | half the initial margin, where the initial margin fraction is 1 over the selected leverage, S5 and S10 | Published |
| market liquidation fee | `max(0.75%, maintenance_margin_ratio * 0.4)` of the value of positions liquidated by market orders, S10 | Published |
| backstop liquidation | below two thirds of maintenance margin, all positions and remaining collateral pass to Pacifica's backstop liquidator, S10 | Published |
| auto-deleveraging | below zero equity, profitable opposing positions are closed by risk priority, S10 | Published |
| markets the backstop does not take | `URNM, GOLD, SILVER, PAXG, CL, COPPER, NATGAS, EURUSD, USDJPY, NVDA, TSLA, PLTR, SP500, GOOGL, CRCL, HOOD, MEGA, BP`, S10 | Published |
| settlement or delivery | none, the contracts are perpetual, S5 | Not offered |
| delisting | no procedure or charge is documented | Not publicly specified |

## 8. CCXT

| item | value | evidence in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pacifica.js` |
|---|---|---|
| constant | `fees.swap.taker` `0.0004` and `fees.swap.maker` `0.00015` | lines 235 to 239 |
| per market | `parseMarket` copies `this.fees[type]` into `taker` and `maker`, so swaps get the constant and the spot market gets nothing | lines 703 to 705, 728 and 729 |
| `market.taker` on a swap, no credentials | `0.0004`, 400 ppm, on 77 of 77 swaps, and `BTC/USDC:USDC` read `0.0004`, P1 and P2 | Probed |
| `market.taker` on spot | `None` on `SOL/USDC`, because `fees.spot` is undefined, P1 and P2 | Probed |
| `tierBased`, `percentage` | not set on the market or in `fees.trading`, P1 | Probed |
| `fetchTradingFee` | declared true at line 110, and needs an account | Account-gated |

CCXT's constant equals the venue's level 0 taker, so CCXT and the wire agree on 400 ppm.

## 9. Recommended registry values

A recommendation for the builder, not a decision.

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 400 | the VIP 0 perpetual taker, S1, and fee level 0 on the wire, P1 and P2 |
| `ccxtTakerPpm` | 400 | CCXT 4.5.68 reports `0.0004` on every swap, from `pacifica.js` line 237 |

The constant covers every perpetual, because Pacifica publishes one schedule for all markets.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading Fees | https://docs.pacifica.fi/trading-on-pacifica/trading-fees | 2026-10-12 | Pacifica, docs | tier table, sections 2 and 4 |
| S2 | Get Fee Levels | https://docs.pacifica.fi/api-documentation/api/rest-api/markets/get-fee-levels | 2026-10-12 | Pacifica, API docs | fee level call and its example, section 4 |
| S3 | Funding Rates | https://docs.pacifica.fi/trading-on-pacifica/funding-rates | 2026-10-12 | Pacifica, docs | funding formula, sampling, cap and payer, section 6 |
| S4 | Overview | https://docs.pacifica.fi/trading-on-pacifica/overview | 2026-10-12 | Pacifica, docs | Restricted Jurisdictions, section 1 |
| S5 | Contract Specifications | https://docs.pacifica.fi/trading-on-pacifica/contract-specifications | 2026-10-12 | Pacifica, docs | linear USDC contracts, hourly funding, impact notional, margins, sections 3, 6 and 7 |
| S6 | VIP Program | https://docs.pacifica.fi/programs/vip-program | 2026-10-12 | Pacifica, docs | tier match, section 5 |
| S7 | Market Maker Program | https://docs.pacifica.fi/programs/market-maker-program | 2026-10-12 | Pacifica, docs | maker program terms, section 5 |
| S8 | Referral and Affiliate Program | https://docs.pacifica.fi/programs/referral-and-affiliate-program | 2026-10-12 | Pacifica, docs | referral points and affiliate share, section 5 |
| S9 | Builder Program | https://docs.pacifica.fi/programs/builder-program | 2026-10-12 | Pacifica, docs | builder fee approval, section 5 |
| S10 | Liquidations | https://docs.pacifica.fi/trading-on-pacifica/liquidations | 2026-10-12 | Pacifica, docs | liquidation tiers and fee, section 7 |
| S11 | Deposits & Withdrawals | https://docs.pacifica.fi/trading-on-pacifica/deposits-and-withdrawals | 2026-10-12 | Pacifica, docs | closed beta caps and transfer fees, section 1 |
| S12 | About Us | https://docs.pacifica.fi/pacifica/readme | 2026-10-12 | Pacifica, docs | founding, launch and funding, section 1 |
| S13 | Fund Security | https://docs.pacifica.fi/trading-on-pacifica/fund-security | 2026-10-12 | Pacifica, docs | custody design, section 1 |
| S14 | Spot Trading and Market Specifications | https://docs.pacifica.fi/trading-on-pacifica/spot-trading and https://docs.pacifica.fi/trading-on-pacifica/contract-specifications/market-specifications | 2026-10-12 | Pacifica, docs | spot fee rule and the `SOL-USDC` market, sections 3 and 4 |
| S15 | CCXT 4.5.68 `pacifica.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pacifica.js` | 2026-10-12 | CCXT | fee constant and builder approval, sections 5 and 8 |
| P1 | `fees-probe.py`, 22:27:49 UTC | [`fees-probe.py`](../../../scripts/probes/venues/pacifica/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 4 and 8 |
| P2 | `fees-probe.py`, the second pass rerun at 22:38:16 UTC | [`fees-probe.py`](../../../scripts/probes/venues/pacifica/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 4 and 8 |
