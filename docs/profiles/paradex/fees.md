# Paradex Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:17 to 22:34 UTC for the first runs and again in the second pass listed in the source ledger, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers perpetual trading on Paradex (CCXT id `paradex`), a decentralised venue whose order book runs off chain and whose trades settle on its own Starknet appchain.
It covers the 66 USD-quoted, USDC-settled perpetuals, and names dated options and spot in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line, with the evidence labels of [`2026-09-22-venue-survey-design.md`](../../plans/2026-09-22-venue-survey-design.md).
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/paradex/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/paradex/rest-probe.py), run with `uv run` from the repository root.
The socket is in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-12 for every source row | | source ledger |
| legal entity | "References to “Paradex” means Paradex Corp. and its affiliates" | Published, terms last updated 2026-02-15 | S6 preamble |
| licensing | "Paradex is not registered or licensed by any regulatory agency or authority." | Published | S6 |
| settlement layer | "All transactions between users of Paradex are executed, settled, and cleared on self-executing smart contracts (the “Protocols”) that are deployed on the StarkNet Appchain." | Published | S6 |
| restricted persons | a "US person", a "Canadian person (as defined under Canadian securities laws)", sanctioned persons, and residents of comprehensively sanctioned territories | Published | S6 and S7 |
| restricted territories | Crimea, Donetsk, Luhansk and Sevastopol, Cuba, Iran, North Korea, Syria, Canada, the United States and eight US associated territories | Published | S7 |
| location concealment | "THE USE OF A VIRTUAL PRIVATE NETWORK (“VPN”) TO CIRCUMVENT ANY APPLICABLE ACCESS RESTRICTIONS IS PROHIBITED." | Published | S6 |
| governing law | the laws of England and Wales | Published | S6 |
| scope of the terms | the terms cover "all related mobile applications and APIs provided by Paradex" | Published | S6 preamble |
| location check in the public API | none seen. Every public REST call answered 200 or a documented 4xx, and every socket with the SBE parameters opened, from the Canadian exit. The error enums name `GEO_IP_BLOCK` on REST and code `40112` "Geo IP blocked" on the socket, and neither appeared | Probed from the Canadian exit | P1 and P2, and S9 and S13 for the error names |

The exit geolocates to Canada, which is a restricted territory under S7, and the development host itself sits in the United States, which is one too.
So a person at this host, or at the exit's location, may not trade on Paradex under S6 and S7.
The public market data answered anyway, and the network was not changed to see whether another location is treated differently.
The observatory only reads public market data and never trades.

## 2. Quick answer

Paradex classifies each order, not each account, as Retail or Pro, and the two classes pay different fees, S2.
An API order is Pro unless it is sent with an interactive token, S2.

| order class | how an order gets it | maker | taker | label | evidence |
|---|---|---|---|---|---|
| Pro, tier Pro 0 | default for any API order | 0.003 % = 30 ppm | 0.045 % = 450 ppm | Published and probed | S1, and `GET /v1/system/volume-tiers` returned `"MAKER_FEE_RATE":"0.00003","TAKER_FEE_RATE":"0.00045"` for `Pro 0`, P1 mode `tiers` |
| Retail, tier VIP 0 | web interface, or an API order with a JWT from `POST /v1/auth?token_usage=interactive` | 0 | 0 | Published and probed | S1 and S2, and `volume-tiers` returned `"0"` and `"0"` for every retail tier from `VIP 0` to `VIP 6`, P1 mode `tiers` |
| per market override in `GET /v1/markets` | `fee_config.api_fee` | 0 | 0.02 % = 200 ppm | Probed, and it contradicts the Pro rows above | `fee_config` was `api_fee` taker `"0.0002"` maker `"0"`, `interactive_fee` taker `"0"` maker `"0"`, `rpi_fee` taker `"0.0002"` maker `"0"` on 66 of 66 perpetuals, P1 mode `catalog` |

S9 describes `fee_config` as the "override fee for the market", and says the global exchange fee config applies when it is not set.
Read that way the API taker would be 200 ppm, while the fee page and the tier endpoint both say 450 ppm for Pro 0.
The override also shows a Pro maker of 0, while S1 says a flat 0.003 % maker took effect on July 3, which the tier endpoint repeats.
So the override looks older than the July schedule, and which number a fill is charged was not observable without an account.
This profile recommends 450 ppm, the documented and tier-endpoint Pro 0 taker, see section 9.

## 3. Coverage matrix

| product | present | count on 2026-10-12 | evidence |
|---|---|---:|---|
| perpetuals, USD quote, USDC settlement, `asset_kind` `PERP` | yes | 66, all `trading_mode` `STANDARD` and `market_kind` `cross`, none opening later | P1 mode `catalog` |
| of which tagged `RWA`: BZ, CL, CRCL, DRAM, EWY, GOOGL, INTC, META, MRVL, MSFT, MSTR, MU, NG, NVDA, SNDK, SPCX, TSLA, US100, US500, XAG, XAU, XCU and XPT | yes | 23 | P1 mode `catalog`, and S12 for their oracle and trading hours |
| perpetual options, `PERP_OPTION` | listed in the API enum, none live | 0 | S9 enum, P1 mode `catalog` |
| dated options, `OPTION` | yes, named only | 9,440 | P1 mode `catalog` |
| dated futures, `FUTURE` | listed in the API enum, none live | 0 | S9 enum, P1 mode `catalog` |
| spot, `SPOT` | yes, named only | 2, `DIME-USD` and `ETH-USD` | P1 mode `catalog` |
| USDT-margined or coin-margined perpetuals | no | 0 | every perpetual settles in USDC, P1 mode `catalog` |

## 4. Perpetual tiers

Pro tiers, by 14-day volume across the main account and its subaccounts, S1 and P1 mode `tiers`.

| tier | 14-day volume, USD | maker | taker |
|---|---:|---:|---:|
| Pro 0 | 0 | 0.003 % | 0.045 % |
| Pro 1 | 1,000,000 | 0.003 % | 0.042 % |
| Pro 2 | 5,000,000 | 0.003 % | 0.039 % |
| Pro 3 | 10,000,000 | 0.003 % | 0.037 % |
| Pro 4 | 25,000,000 | 0.003 % | 0.035 % |

Retail tiers `VIP 0` to `VIP 6` run from 0 to 50,000,000 USD of 14-day volume, and every one reads maker 0 and taker 0, P1 mode `tiers`.
Retail orders carry a 300 ms submission and cancellation speed bump and limits of 3 orders a second, 30 a minute, 300 an hour and 1,000 a day, S2.
"If an account exceeds Retail rate limits, the account automatically switches to Pro Order behavior and loses access to RPI liquidity", S2.

Retail Price Improvement (RPI) orders are post-only maker orders that "match only against Retail Taker orders, and are never eligible to match against regular API orders", S3.
They are left out of the API book, S3, and [`websocket.md`](./websocket.md) section 4 shows that on 2026-10-12 most of the visible liquidity was RPI.

## 5. Discounts that change the perpetual taker

All three discounts apply to the Pro taker only, add up, and cannot take it below 1.75 bps, 0.0175 %, S1.

| discount | size | condition | label | evidence |
|---|---|---|---|---|
| staking DIME | 5 % at 10,000 DIME up to 30 % at 2,000,000 DIME, in seven tiers | staked DIME, with a 24-hour unstaking cooldown | Published and probed | S1, and `GET /v1/staking/config` listed `DISCOUNT_TAKER` 5 to 30 from `min_staked` 10,000 to 2,000,000, P1 mode `tiers` |
| paying fees in DIME | 40 % | "for all orders during initial rollout", no end date given | Published | S1 |
| FastFills | 30 % | a Pro taker order that matches a passive Retail order | Published | S1 |
| floor | 0.0175 % = 175 ppm | applies after every discount | Published | S1 |
| XP fee config | `{"fee_percentage":0}` | public, meaning not documented | Probed | `GET /v1/xp/fee-config`, P1 mode `tiers` |

No referral, market maker or zero-fee promotion for Pro takers is published on S1.
Retail takers already pay 0.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| mechanism | continuous. The rate is recomputed every second, and a funding index accrues it every 1 s tick, so a position pays or receives by the index change while it is held | Published | S4 sections 6 and "Funding updates" |
| settlement instant | none. "Positions held through a pause accrue no funding during it. Partial holding periods settle exactly by the index delta, with no "next funding" countdown." | Published | S4 section 6 |
| settlement instant on the wire | none. Around 00:00, 08:00 and 16:00 UTC on 2026-10-12 the largest 5 s step of the BTC funding index in a minute was 0.000310, 0.001154 and 0.000495, against median steps of 0.000305, 0.001153 and 0.000493 | Probed | P1 and P2 mode `funding` |
| quoted period | 8 h. `funding_period_hours` was 8 on 66 of 66 perpetuals, and `funding_rate_8h` equalled `funding_rate` on 100 of 100 history rows of BTC and of XAU | Published and probed | S4, P1 modes `catalog` and `funding` |
| formula | the premium rate is a weighted median of impact premiums on Paradex, Binance, Bybit, OKX, Hyperliquid and Lighter, divided by spot. The raw rate is `clip(multiplier × (premium + clip(0.01 % − premium, ±clamp)), ±max)`, and the published rate is its EWMA with a 30 minute half-life, or 30 s in a post-only period | Published | S4 sections 1 to 4 |
| baseline and clamp | 0.01 % and 0.05 % per 8 h. On the wire `interest_rate` `"0.0001"` and `clamp_rate` `"0.0005"` on 66 of 66 | Published and probed | S4, P2 mode `catalog` |
| multiplier | 0.5 for TradFi and 1 otherwise. On the wire 0.5 on the 23 `RWA` perpetuals and 1 on the other 43 | Published and probed | S4, P1 and P2 mode `catalog` |
| cap per 8 h, documented | 2 % for BTC, ETH and SOL, 0.5 % for TradFi, 5 % for the others | Published | S4 section 3 |
| cap per 8 h, on the wire | `max_funding_rate` `"0.02"` on BTC, ETH and SOL, `"0.01"` on the 23 `RWA` perpetuals, `"0.05"` on 34, and `"0.1"` on CC, LIT, MON, MORPHO, STRK and XMR | Probed, and it differs from the documented cap for TradFi and for six others | P2 mode `catalog` |
| change cap | `max_funding_rate_change` `"0.0005"` on 63 and `"0.0002"` on 3 | Probed, meaning not documented | P2 mode `catalog` |
| direction | a positive rate means longs pay shorts | Published | S4 section 7 |
| pauses | funding pauses while the oracle is in maintenance, the USDC price is invalid or the market is halted, and a gap over 30 s accrues nothing | Published | S4 section 6 and "Funding updates" |

Because funding accrues every second, an arbitrage leg pays funding pro rata for exactly the time it is held, and there is no settlement instant to dodge or to capture.

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation | partial, in multiples of 20 % of every position, until the margin ratio falls below 90 % | Published | S5 |
| liquidation penalty | share × 70 % × MMR, paid to the insurance fund. `GET /v1/system/config` returned `"liquidation_fee":"0.7"` and `"partial_liquidation_share_increment":"0.2"` | Published and probed | S5, P1 mode `tiers` |
| delisting settlement fee | 0.015 % on spot and perpetual positions still open when a market is delisted, and 0.0075 % on dated options | Published | S1 section "Settlement" |
| deposits, withdrawals and bridges | out of scope, see the official bridges page | Published | S11 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` for a perpetual without credentials | `0.0003`, 300 ppm, on 67 of 67 kept swaps | `parseMarket` sets `takerFee` to the constant `0.0003` at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/paradex.js` line 622, P1 mode `ccxt` |
| `market.maker` | `-0.00005`, a 5 ppm rebate | same file line 623, P1 mode `ccxt` |
| describe-level `fees.swap` | taker `0.0002`, maker `0.0002` | same file lines 280 to 284, P1 mode `ccxt` printed `{'taker': 0.0002, 'maker': 0.0002}` |
| `fetchTradingFees` | reads `fee_config.api_fee` from the public `GET /markets`, so it would report 200 ppm | same file lines 686 to 720 and 773 to 777 |
| kept swaps | 67: the 66 perpetuals plus the spot market `DIME-USD`, which `parseMarket` types as a swap because only the two option kinds become `option` | same file lines 605 to 609, P1 mode `ccxt` |

None of CCXT's numbers is the published Pro 0 taker of 450 ppm, and none is the Retail taker of 0.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 450 | the Pro 0 taker of S1 and of `volume-tiers`. The feed in [`websocket.md`](./websocket.md) section 8 reads the API book, which only Pro orders and Retail orders can take, and RPI liquidity is open to Retail orders only. An API order is Pro by default, with no speed bump |
| `ccxtTakerPpm` | 300 | `market.taker` from the constant at `paradex.js` line 622 |
| the Retail alternative | 0, but only with the interactive book | a Retail taker pays nothing and can take RPI orders, but waits 300 ms on every order and cancel, and RPI makers quote behind that speed bump on purpose, S3. Pairing 0 ppm with the API book, or 450 ppm with the interactive book, would misstate the cost of the book the engine reads |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading Fees | https://docs.paradex.trade/trading/trading-fees | 2026-10-12 | Paradex, docs | Pro and Retail fees, discounts, floor, settlement fee, sections 2, 4, 5 and 7 |
| S2 | Retail and Pro Orders | https://docs.paradex.trade/trading/trader-profiles | 2026-10-12 | Paradex, docs | order classes, speed bump, Retail rate limits, sections 2 and 4 |
| S3 | Retail Price Improvement | https://docs.paradex.trade/trading/rpi | 2026-10-12 | Paradex, docs | RPI matching rules and the API book without RPI, sections 4 and 9 |
| S4 | Funding Mechanism | https://docs.paradex.trade/risk/funding-mechanism | 2026-10-12 | Paradex, docs | funding formula, caps, continuous accrual, section 6 |
| S5 | Liquidations | https://docs.paradex.trade/risk/liquidations | 2026-10-12 | Paradex, docs | partial liquidation and penalty, section 7 |
| S6 | Terms of Service, last updated 2026-02-15 | https://www.paradex.trade/terms-of-service | 2026-10-12 | Paradex Corp., terms | entity, restricted persons, VPN clause, governing law, section 1 |
| S7 | Restricted Persons | https://www.paradex.trade/restricted-persons | 2026-10-12 | Paradex Corp., terms | restricted territories including Canada and the United States, section 1 |
| S8 | Get volume tiers | https://docs.paradex.trade/api/prod/system/get-volume-tiers | 2026-10-12 | Paradex, API docs | the tier endpoint, section 2 |
| S9 | List available markets | https://docs.paradex.trade/api/prod/markets/get-markets | 2026-10-12 | Paradex, API docs | `fee_config` meaning, asset kinds, `GEO_IP_BLOCK` error name, sections 1 to 3 |
| S10 | CCXT 4.5.68 `paradex.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/paradex.js` | 2026-10-12 | CCXT | section 8 |
| S11 | Bridges and On-Ramps | https://docs.paradex.trade/docs/getting-started/bridges | 2026-10-12 | Paradex, docs | out-of-scope pointer, section 7 |
| S12 | TradFi Price Oracle | https://docs.paradex.trade/trading/tradfi-markets | 2026-10-12 | Paradex, docs | TradFi asset classes, section 3 |
| S13 | WebSocket Error Handling | https://docs.paradex.trade/ws/general-information/error-handling | 2026-10-12 | Paradex, docs | socket code 40112, section 1 |
| P1 | `fees-probe.py` modes `ccxt` and `tiers` at 22:23 UTC, and `rest-probe.py` modes `catalog` at 22:20 and `funding` at 22:21 UTC | [`fees-probe.py`](../../../scripts/probes/venues/paradex/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/paradex/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 8 |
| P2 | the same modes rerun in the second pass from 22:38 to 22:40 UTC, plus `catalog` at 22:45 UTC printing the caps by base | [`fees-probe.py`](../../../scripts/probes/venues/paradex/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/paradex/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 8 |
