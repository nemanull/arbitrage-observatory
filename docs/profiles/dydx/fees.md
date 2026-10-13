# dYdX Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:32 to 22:33 UTC, and again in the second pass, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers perpetual trading on dYdX (CCXT id `dydx`), the dYdX Chain, which its software terms call the v4 protocol.
dYdX keeps its fee schedule in chain state, so the tiers below were read from a public full node, not from a web page.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/dydx/fees-probe.py), run from the repository root with `uv run`.
P1 is the first run, and P2 is the second pass, listed in section 10.
The socket is covered in [`websocket.md`](./websocket.md), and the Indexer API, the anchor and the decentralised layer in [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-12 for every source row | | source ledger |
| what is being used | the dYdX Chain, where validators "take turns proposing blocks of trades every ~1 second" | Published | S4 |
| software developer | dYdX Trading Inc. ("DTI") publishes the dYdX Software Terms of Use, last updated March 12, 2026, and states it "DOES NOT AND WILL NOT HAVE CONTROL OVER THE DEVELOPMENT, GROWTH, MAINTENANCE OR OPERATIONS OF ANY WEBSITE INTERFACE OR PROTOCOL USING THE DYDX SOFTWARE" | Published | S5 |
| foundation site | dYdX International Ltd, a Cayman Islands company, runs `www.dydx.xyz` and "does not deploy or run dYdX v4 open-source software for public use", terms last updated 6 June 2025 | Published | S6 |
| who may trade the perpetuals | anyone who is not a Restricted Person, with a self-custodied wallet. Restricted Persons for the perpetuals trading software are those who reside in, are located in, are incorporated in or are operated from "the United States, Canada or the United Kingdom", plus Iran, Cuba, North Korea, Crimea, Donetsk, Luhansk and sanctioned persons | Published | S5 section 3 and the notice on prohibited use |
| location concealment | "USE OF ANY TECHNOLOGY OR MECHANISM, SUCH AS A VIRTUAL PRIVATE NETWORK (“VPN”) TO CIRCUMVENT THE RESTRICTIONS SET FORTH HEREIN IS PROHIBITED." | Published | S5, notice on prohibited use |
| location check in the public API | every Indexer reply to this host carried `geo-origin-country: CA`, `geo-origin-region: CA-BC` and `geo-origin-status: restricted`, and every public market data call still answered 200 | Probed from the Canadian exit | [`rest.md`](./rest.md) section 1 |
| regions excluded | the United States, Canada and the United Kingdom for the perpetuals, and the sanctioned territories for all dYdX software | Published | S5 |

This host's exit is in Canada, where a person is a Restricted Person under S5, so trading from it is not allowed.
The observatory only reads public market data, which the Indexer served, and it never trades.
The network was not changed to see what another location receives.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USD-quoted perpetuals settled in USDC, 73 active, every one a cross margin market | 0.01 % = 100 ppm | 0.05 % = 500 ppm | Probed from chain state | `perpetual_fee_params` tier `"1"`: `maker_fee_ppm` 100, `taker_fee_ppm` 500, `absolute_volume_requirement` `"0"`, P1 and P2 |

The engine models a taker cross at the base tier, so 500 ppm is the number for every dYdX perpetual.
The chain stores fees in ppm already, so no conversion stands between the wire and the registry constant.

## 3. Coverage matrix

| product | present | count on 2026-10-12 | evidence |
|---|---|---:|---|
| perpetuals quoted in USD, settled in USDC, cross margin | yes | 73 `ACTIVE` | Probed, [`rest.md`](./rest.md) section 2 |
| perpetuals in final settlement | listed, not tradable | 223 `FINAL_SETTLEMENT`, 43 cross and 180 isolated | Probed, [`rest.md`](./rest.md) section 2 |
| isolated margin perpetuals, the instant listing family | none active | 180, all in final settlement | Probed, [`rest.md`](./rest.md) section 2 |
| USDT-margined or coin-margined perpetuals | no | 0 | every market is `BASE-USD` with USDC collateral, CCXT hard codes quote and settle `USDC` at `dydx.js` lines 505 and 512 |
| dated futures | no | 0 | CCXT `'future': false` at `dydx.js` line 36, and the Indexer lists perpetual markets only |
| options | no | 0 | CCXT `'option': false` at `dydx.js` line 37 |
| spot | not on the Indexer. S5 names "SPOT TRADING SOFTWARE" beside the perpetuals, and CCXT declares `'spot': false` at `dydx.js` line 33 | 0 on the Indexer | S5, the HTTP API of S11 has no spot route |

The tickers end in `-USD`, but the collateral and the settlement asset is USDC, which the engine folds under USDT with USD.

## 4. Perpetual tiers

Read from `GET /dydxprotocol/v4/feetiers/perpetual_fee_params` on `dydx-ops-rest.kingnodes.com`, P1 and P2.
Volumes are 30-day trading volume in quote quantums, and USDC has an atomic resolution of -6 on the chain, so 1,000,000,000,000 quantums is 1,000,000 USDC, P2 `quote_asset`.
None of the seven tiers set a total or maker volume share requirement, so every tier qualifies on volume alone.

| tier | 30-day volume at least | maker | taker |
|---|---:|---|---|
| 1 | 0 | 0.010 % = 100 ppm | 0.050 % = 500 ppm |
| 2 | 1,000,000 USDC | 0.010 % = 100 ppm | 0.045 % = 450 ppm |
| 3 | 5,000,000 USDC | 0.005 % = 50 ppm | 0.040 % = 400 ppm |
| 4 | 25,000,000 USDC | 0 | 0.035 % = 350 ppm |
| 5 | 50,000,000 USDC | 0 | 0.030 % = 300 ppm |
| 6 | 100,000,000 USDC | -0.007 % = -70 ppm, a rebate | 0.025 % = 250 ppm |
| 7 | 200,000,000 USDC | -0.011 % = -110 ppm, a rebate | 0.025 % = 250 ppm |

Governance sets these parameters, so they can change by vote without a web page changing.
CCXT's describe block carries only tier 1, as maker 0.0001 and taker 0.0005 at `dydx.js` lines 229 and 230.

## 5. Discounts that change the perpetual taker

| discount | rule | effect on the 500 ppm taker | label | evidence |
|---|---|---|---|---|
| referral | "Referred user automatically gets set to this fee tier", with `referee_minimum_fee_tier_idx` 2, the third entry of the tier list, tier `"3"` | a referred account pays at least tier 3, a 400 ppm taker | Probed from chain state | S9 lines 46 and 47, `affiliate_parameters` P1 and P2 |
| staking DYDX | tier 1 takes a 25 % discount from 3,000 DYDX staked and 50 % from 20,000. Higher tiers take 5 % to 45 % at larger stakes | 375 ppm or 250 ppm at tier 1 | Probed from chain state | `staking_tiers` P1 and P2, `fee_discount_ppm` 250,000 and 500,000 on `min_staked_base_tokens` 3,000 and 20,000 times 10^18, and "1_000_000 is 100% discount" in S8 line 28 |
| per market fee holiday | `charge_ppm` is the share of the normal fee charged, "0 = completely free". Three holidays are recorded: BTC-USD (clob pair 0) from 2026-05-01 to 2026-06-30, SOL-USD (clob pair 5) from 2025-12-01 to 2026-01-31, and BONK-USD (clob pair 47) from 2026-05-01 to 2026-06-30, each at `charge_ppm` 0 | none on 2026-10-12, since every window had ended | Probed from chain state | S7 lines 23 to 26, `market_fee_discount_params` P1 and P2 |
| affiliate share | an affiliate receives 30 % to 50 % of the referred taker fee, by referred volume | none on the trader's taker | Probed from chain state | `affiliate_tiers` P1 and P2 |
| market maker program | the docs proposed maker rebates of "0.5bps to 1.1bps" on volume share. The live tiers 6 and 7 pay 0.7 and 1.1 bps on volume alone | none on the taker | Published and probed | S4, section 4 |

The engine cannot know whether a counterparty route would be referred or staked, so the registry keeps the undiscounted 500 ppm.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| purpose | keeps "the price of each perpetual market trading close to its Oracle Price" | Published | S1 |
| premium | "Premium = (Max(0, Impact Bid Price - Index Price) - Max(0, Index Price - Impact Ask Price)) / Index Price", where the index price is the oracle price | Published | S1 |
| sampling | the block proposer votes a premium each block, the median vote of each one-minute `funding-sample` epoch is a sample, and the hourly rate averages the samples | Published and probed | S1, epochs `funding-sample` 60 s and `funding-tick` 3,600 s in [`rest.md`](./rest.md) section 4 |
| formula | "Funding Rate = (Premium Component / 8) + Interest Rate Component" | Published | S1 |
| interest component | 0 for cross markets, and "0.125 bps per hour or 1 bps per 8 hours" for isolated markets since governance vote 220. On the chain 114 perpetuals carry `default_funding_ppm` 0 and 182 carry 100, and the Indexer shows `defaultFundingRate1H` `"0.0000125"` on one active market, `MON-USD` | Published and probed | S1, [`rest.md`](./rest.md) sections 2 and 4 |
| interval | one hour. Settlements in `historicalFunding` sat 3,599 to 3,601 s apart | Published and probed | S1, [`rest.md`](./rest.md) section 4 |
| settlement instant | "every hour at the start of the hour". The last 48 settlements took effect 27 to 812 ms after the hour, which is the first block after the epoch boundary | Published and probed | S1, [`rest.md`](./rest.md) section 4 |
| cap | "The 8-hour rate cap is calculated by 600% * (Initial Margin - Maintenance Margin)", and the chain holds `funding_rate_clamp_factor_ppm` 6,000,000 and `premium_vote_clamp_factor_ppm` 60,000,000 | Published and probed | S1, [`rest.md`](./rest.md) section 4 |
| cap on BTC-USD | initial margin 0.02 and maintenance 0.012 on the Indexer, so the 8-hour cap is 600 % of 0.008, 4.8 %, which is 0.6 % an hour | Derived from probed values | [`rest.md`](./rest.md) section 2 |
| who pays | "When the price is too high, longs pay shorts", and the reverse when it is too low | Published | S1 |
| when it is charged | "every hour", as realized PnL | Published | S1 |

The settlement instant itself was not captured, because the probes never wait for a clock event, and the history above stands for it.
The upcoming rate and how the anchor reads it are in [`rest.md`](./rest.md) sections 3 and 4.

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation trigger | "Oracle Price is used to estimate the value of an account's positions", and an account below its maintenance margin requirement is liquidatable | Published | S2 |
| liquidation penalty | "Maximum Liquidation Penalty of 1.5%", paid to the insurance fund, and governance may change it | Published | S2 |
| liquidation fill | a protocol liquidation order matches resting liquidity at a "Fillable Price" computed from the oracle price, the maintenance margin fraction and two governance ratios | Published | S2 |
| delisting | a delisted market moves to `FINAL_SETTLEMENT`. 223 markets were in that state, every one with `volume24H` 0 | Probed | [`rest.md`](./rest.md) section 2 |
| final settlement price and charge | Not publicly specified in the pages read | Not publicly specified | S1 to S4 |
| deposit and withdrawal | "To move assets in and out of the dYdX network, the Noble network is commonly employed", and transfer charges were not researched | Published | S12 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| class | `dydx`, `'dex': true`, `'swap': true`, `'spot': false` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/dydx.js` lines 23, 29, 33 and 35 |
| exchange level fees | `fees.trading` maker `0.0001` and taker `0.0005`, `tierBased: true` | `dydx.js` lines 229 and 230, and P1 and P2 `fees_trading` |
| what `market.taker` reports without credentials | `undefined`, on all 73 active markets, for example `BTC/USDC:USDC` | `dydx.js` line 545 sets `'taker': undefined` and line 546 `'maker': undefined`, and P1 and P2 read `taker` `None` on 73 of 73 |
| symbol | `BTC/USDC:USDC` for the venue's `BTC-USD`, because the quote is hard coded `USDC` | `dydx.js` lines 505 and 512 |
| `market.id` | the venue ticker, `BTC-USD`, on 73 of 73 active markets | `dydx.js` line 525, P1 and P2 `ids_equal_info_ticker` |

So CCXT has no per market taker for dYdX, and its exchange level constant equals tier 1 on the chain.

## 9. Recommended registry values

| constant | value | reason |
|---|---|---|
| `takerPpm` | 500 | tier 1 `taker_fee_ppm` in chain state, P1 and P2, the base tier the engine models, as decision 5 of the waves design asks |
| `ccxtTakerPpm` | undefined | CCXT 4.5.68 sets `market.taker` to `undefined` at `dydx.js` line 545. Its exchange level `fees.trading.taker` is 0.0005, 500 ppm, at line 230 |

A governance vote can change the tiers, so a check of `perpetual_fee_params` before activation is cheap insurance.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | dYdX Documentation, Funding | https://docs.dydx.xyz/concepts/trading/funding | 2026-10-12 | dYdX docs | premium, formula, interval, cap, who pays, sections 6 and 7 |
| S2 | dYdX Documentation, Liquidations | https://docs.dydx.xyz/concepts/trading/liquidations | 2026-10-12 | dYdX docs | liquidation price, penalty, fillable price, section 7 |
| S3 | dYdX Documentation, Margin | https://docs.dydx.xyz/concepts/trading/margin | 2026-10-12 | dYdX docs | the oracle price in the margin formula, section 7 |
| S4 | dYdX Documentation, Onboarding FAQs | https://docs.dydx.xyz/concepts/onboarding-faqs | 2026-10-12 | dYdX docs | block cadence, proposed maker rebates, sections 1 and 5 |
| S5 | dYdX Software Terms of Use, last updated March 12, 2026 | https://dydx.exchange/v4-terms | 2026-10-12 | dYdX Trading Inc. | Restricted Persons, the VPN clause, spot trading software, section 1 |
| S6 | dYdX International terms of use, last updated 6 June 2025, reached from `https://www.dydx.xyz/terms` | https://www.dydx.xyz/legal/terms-of-use | 2026-10-12 | dYdX International Ltd, Cayman Islands | the foundation site's role and exclusions, section 1 |
| S7 | v4-chain `per_market_fee_discount.proto` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/proto/dydxprotocol/feetiers/per_market_fee_discount.proto#L23-L26 | 2026-10-12 | dYdX Chain source | `charge_ppm` meaning, section 5 |
| S8 | v4-chain `staking_tier.proto` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/proto/dydxprotocol/feetiers/staking_tier.proto#L28-L29 | 2026-10-12 | dYdX Chain source | `fee_discount_ppm` meaning, section 5 |
| S9 | v4-chain `affiliates.proto` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/proto/dydxprotocol/affiliates/affiliates.proto#L46-L47 | 2026-10-12 | dYdX Chain source | the referee fee tier, section 5 |
| S10 | CCXT 4.5.68 `dydx.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/dydx.js` | 2026-10-12 | CCXT | sections 3 and 8 |
| S11 | dYdX Documentation, Indexer HTTP API | https://docs.dydx.xyz/indexer-client/http | 2026-10-12 | dYdX docs | perpetual market routes only, section 3 |
| S12 | dYdX Documentation, Connecting to dYdX | https://docs.dydx.xyz/interaction/endpoints | 2026-10-12 | dYdX docs | public node REST hosts and their limits, Noble for transfers, sections 4 and 7 |
| P1 | `fees-probe.py chain` at 22:32 UTC and `fees-probe.py ccxt` at 22:33 UTC | [`fees-probe.py`](../../../scripts/probes/venues/dydx/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2, 4, 5, 8 and 9 |
| P2 | `fees-probe.py`, both modes, the second pass, which added the `quote_asset` read | [`fees-probe.py`](../../../scripts/probes/venues/dydx/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2, 4, 5, 8 and 9 |
