# ApeX Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:15 to 22:39 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the trading fees, the funding cost and CCXT's fee numbers for ApeX Omni (CCXT id `apex`), a decentralised perpetual venue.
The researched product is its USDT-settled linear perpetuals, the `perpetualContract` family of `GET /api/v3/symbols`.
Every probed number comes from [`fees-probe.py`](../../../scripts/probes/venues/apex/fees-probe.py) or [`rest-probe.py`](../../../scripts/probes/venues/apex/rest-probe.py), run with `uv run` from the repository root.
P1 is the first run of each mode, from 22:15 to 22:31 UTC, and P2 is the rerun of every mode in the second pass, from 22:31 to 22:39 UTC.
The socket is in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-10-12 | S1 to S9 |
| software licensor | APEX DAO Inc. ("ADI"), under the laws of the Republic of Panama, with arbitration in Panama City | S4 sections 1 and 12 |
| operator of `omni.apex.exchange` | not named. The Terms say ADI "does not deploy APEX Software for public use or operate any infrastructure or website interface for any public deployments" | S4 section 4 |
| account | a wallet, onboarded by signing a message, with no KYC step in the API flow | S8 section "General" |
| excluded | persons who reside in, are located in, are incorporated in or are controlled from the United States, persons tied to Iran, Cuba, North Korea, Syria, Myanmar, Crimea, Donetsk or Luhansk, and sanctioned persons | S4 section 3 |
| VPN | "USE OF ANY TECHNOLOGY OR MECHANISM, SUCH AS A VIRTUAL PRIVATE NETWORK ("VPN") TO CIRCUMVENT THE RESTRICTIONS SET FORTH HEREIN IS PROHIBITED" | S4 preamble |
| Canada | not named among the restricted territories | S4 section 3 |
| US persons | may not trade | S4 section 3 |
| fee schedule date | the fee page says "Effective 1 October 2025", and the VIP page says it "was last updated on October 20, 2025" | S1, S2 |

From this host every public REST call and every public socket answered with no refusal and no geoblock, P1 and P2, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT perpetuals, `perpetualContract` | 0.020 %, 200 ppm | 0.050 %, 500 ppm | S1 and S2, level 1, P1 and P2 `fees-probe.py page` |
| TradFi perpetuals, `stockContract` | 0.02 %, 200 ppm | 0.05 %, 500 ppm | S3 section "Fees" |

ApeX numbers its base tier level 1, and that tier is the VIP 0 of this survey.

## 3. Coverage matrix

Counts are from `rest-probe.py catalog` in P1 and P2, which agreed.

| family | present | rows | trading | settlement | detailed here |
|---|---|---:|---:|---|---|
| linear perpetuals, crypto | yes, `contractConfig.perpetualContract` | 138 | 88 (`enableTrade`) | USDT on 138 of 138 | yes |
| linear perpetuals, TradFi and stock | yes, `contractConfig.stockContract` | 48 | 40 | USDT on 48 of 48 | named only, see [`rest.md`](./rest.md) section 2 |
| prediction contracts | yes, `contractConfig.predictionContract` | 184 | 169 | USDT | named only |
| pre-launch perpetuals | the key `prelaunchContract` exists | 0 | 0 | | no |
| USDC-margined perpetuals | no | 0 | | | |
| coin-margined perpetuals | no | 0 | | | |
| dated futures | no. Eleven perpetual rows carry a `deliveryTime`, and ten of them are not trading, so it reads as a removal time | 0 | | | |
| options | no | 0 | | | |
| spot | `spotConfig.spot` held 0 rows. A token swap and tokenized stocks are offered as "Spot Swap" and "Spot Stocks" | 0 order books | | | |

## 4. Perpetual tiers

The level is the better of the 14-day perpetual volume and the APEX plus esAPEX staked, S1 and S2.
Levels 5 to 7 count volume only, S2.
The level is recomputed daily from a 07:00 UTC snapshot and applied by 08:00 UTC, S2.

| level | 14-day volume, USD | or staked APEX and esAPEX | maker | taker | taker ppm |
|---|---|---|---|---|---:|
| 1 | under 5,000,000 | under 25,000 (S2), "≤ 25,000" on S1 | 0.020 % | 0.050 % | 500 |
| 2 | 5,000,000 or more | 25,000 or more | 0.015 % | 0.045 % | 450 |
| 3 | 25,000,000 or more | 100,000 or more | 0.010 % | 0.040 % | 400 |
| 4 | 100,000,000 or more | 250,000 or more | 0.005 % | 0.035 % | 350 |
| 5 | 500,000,000 or more | | 0.000 % | 0.030 % | 300 |
| 6 | 1,000,000,000 or more | | 0.000 % | 0.028 % | 280 |
| 7 | 2,000,000,000 or more | | 0.000 % | 0.025 % | 250 |

`fees-probe.py page` read the same seven rows from S1 and S2 in P1 and P2.
TradFi perpetuals "follow the same fee structure as crypto perpetuals", S3.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| staking APEX or esAPEX | 25,000 staked reaches level 2, 100,000 level 3 and 250,000 level 4 without the volume | S2 |
| referral and affiliate | a separate discount, and VIP discounts "do **not** stack" with it, the best single rate applies | S2 |
| custom rates | "High-volume traders, institutional accounts, and professional market makers can apply for tailored fee arrangements" | S2 |
| gas | "ApeX Omni fully subsidises gas", so no network fee is added to a trade | S1 |
| zero fee promotions | none published on S1 or S2 on 2026-10-12 | S1, S2 |
| Grid Bot and Vault trades | always at the standard rate | S2 |

## 6. Funding as a cost

| item | documented | probed |
|---|---|---|
| interval | "Funding settles every hour, on the hour (UTC)", S1, and every 1 hour, S8 | 24 settled rows in 24 h, each exactly on the hour (0 ms past it), on `BTC-USDT`, `ETH-USDT`, `TRX-USDT` and `DOGE-USDT`, P1 and P2 `rest-probe.py funding` |
| who pays | positive rate, longs pay shorts, and only positions held at the exact settlement timestamp pay or receive, S1 | |
| fee | `Funding Fee = Position Size × Index Price × Funding Rate`, S1 and S8 | |
| formula | `F = P + clamp(I − P, +0.05%, −0.05%)`, with `P` and `I` updated every minute and averaged as a one hour TWAP, S1 | |
| interest | `I = (USDT Interest − Underlying Asset Interest) ÷ 24`, with the example 0.00125 % for BTC, S1 | `fundingInterestRate` is `0.0003` on 88 of 88 trading rows, and 0.0003 / 24 is the `0.0000125` that 69 of 88 tickers showed as `fundingRate`, P1 |
| cap | "ApeX Omni **caps the hourly funding rate at ±0.05%**", and the excess "is absorbed by the platform", S1 | `fundingMaxRate` and `fundingMinRate` are per contract: ±0.000305 on 45, ±0.005 on 29, ±0.02 on 10, ±0.000469 on 3 and ±0.01 on 1 of the 88, P1 and P2 `catalog` |
| settled range | | the largest settled rate over 24 h was 0.00002489 on `BTC-USDT`, and no settled row sat at its contract's `fundingMaxRate`, P1 and P2 |
| TradFi | hourly like crypto perpetuals, and no funding during market closures, S3 | |

The documented cap of 0.05 % an hour and the catalog's per contract `fundingMaxRate` disagree.
For 48 contracts the catalog's bound of 0.0305 % or 0.0469 % is tighter, and for 40 it is looser, from 0.5 % to 2 %.
Which bound the settlement engine applies is Not publicly specified, and no settled rate in the probed history reached either.
The settlement instant itself was not captured, because this research does not wait for a clock event.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | margin ratio at or above 100 %, on the mark price | S6 |
| liquidation fee | Not publicly specified. S6 names no fee, while S9 says Protocol Vaults are "backed by real protocol liquidation fees" | S6, S9 |
| delisting settlement price | the average of the mark sampled every second over the last 30 minutes before trading is suspended | S5 |
| delisting settlement fee | "(taker fee + maker fee) / 2" | S5 |
| delisting phases | announcement, reduce-only, trading suspended, settlement, removal | S5 |
| cancellation and gas | no cancellation fee and no gas fee | S1 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` without credentials | `0.0002` on 88 of 88 active swaps, 200 ppm | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/apex.js` line 656, P1 and P2 `fees-probe.py ccxt` |
| `market.maker` | `0.0005` on 88 of 88, 500 ppm | `apex.js` line 657 |
| `fees.swap` | `taker` `0.0005` and `maker` `0.0002` | `apex.js` lines 221 to 225 |
| order fee fallback | `taker` `0.0005` and `maker` `0.0002` | `apex.js` lines 1346 and 1347 |

CCXT's per market constants are swapped.
`parseMarket` sets `takerFee` to `0.0002` and `makerFee` to `0.0005`, so every market reports the venue's maker as its taker.
The exchange-level `fees.swap` holds the published pair the right way round.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 500 | the level 1 taker of 0.050 %, S1 and S2, for crypto and TradFi perpetuals alike |
| `ccxtTakerPpm` | 200 | what `market.taker` reports on every market, `apex.js` line 656, which is the swapped maker fee |

Decision 5 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) already takes the taker from this file, so CCXT's swap costs nothing once the constant is set.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading & Funding Fees | https://apex-pro.gitbook.io/apex-pro/apex-omni/trading-and-funding-fees | 2026-10-12 | ApeX docs | tiers, gas, funding interval, formula and cap, sections 2, 4 to 7 |
| S2 | VIP Program | https://apex-pro.gitbook.io/apex-pro/apex-omni/vip-program | 2026-10-12 | ApeX docs | tiers, staking, referral, custom rates, sections 4 and 5 |
| S3 | TradFi Perpetuals | https://apex-pro.gitbook.io/apex-pro/apex-omni/tradfi-perpetuals | 2026-10-12 | ApeX docs | TradFi fees and funding, sections 2 and 6 |
| S4 | Terms of Use, "Last updated: 27 July 2026" | https://apex-pro.gitbook.io/apex-pro/about/terms-of-use | 2026-10-12 | APEX DAO Inc., Panama | who may use the software, section 1 |
| S5 | Delisting Mechanism | https://apex-pro.gitbook.io/apex-pro/apex-omni/margin-risk-management-and-liquidations/delisting-mechanism | 2026-10-12 | ApeX docs | delisting settlement, section 7 |
| S6 | Margin, Risk Management & Liquidations | https://apex-pro.gitbook.io/apex-pro/apex-omni/margin-risk-management-and-liquidations | 2026-10-12 | ApeX docs | liquidation trigger, section 7 |
| S7 | Price Markers | https://apex-pro.gitbook.io/apex-pro/apex-omni/price-markers | 2026-10-12 | ApeX docs | which price each fee uses, see [`rest.md`](./rest.md) section 4 |
| S8 | ApeX Omni API v3 docs | https://api-docs.omni.apex.exchange/ | 2026-10-12 | ApeX API docs | onboarding, hourly funding, section 6 |
| S9 | What is ApeX Omni | https://apex-pro.gitbook.io/apex-pro/what-is-apex-omni | 2026-10-12 | ApeX docs | products and Protocol Vaults, sections 3 and 7 |
| S10 | CCXT 4.5.68 `apex.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/apex.js` | 2026-10-12 | CCXT | fee constants, section 8 |
| P1 | `fees-probe.py page` and `ccxt`, `rest-probe.py catalog` and `funding`, 22:28 to 22:31 UTC | [`fees-probe.py`](../../../scripts/probes/venues/apex/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/apex/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 4, 6 and 8 |
| P2 | the same modes rerun in the second pass, 22:37 to 22:39 UTC | [`fees-probe.py`](../../../scripts/probes/venues/apex/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/apex/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 4, 6 and 8 |
