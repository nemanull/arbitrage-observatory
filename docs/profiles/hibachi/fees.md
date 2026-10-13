# Hibachi Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:21 to 22:39 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the fees of Hibachi (CCXT id `hibachi`), a decentralised perpetual venue whose order book and matching engine Hibachi runs, with collateral settled on Arbitrum.
Its only product is linear perpetuals settled in USDT, eight on crypto and gold and seven on currencies and silver.
Every probed number comes from [`fees-probe.py`](../../../scripts/probes/venues/hibachi/fees-probe.py) or [`rest-probe.py`](../../../scripts/probes/venues/hibachi/rest-probe.py), run with `uv run` from the repository root, and the runs are listed as P1 to P4 in section 10.
The socket is in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).
The work follows [`2026-10-12-dex-venues-design.md`](../../implemented/2026-10-12-dex-venues-design.md).

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| operator | Hibachi PTE. LTD. and its affiliates, governed by Singapore law with JAMS arbitration seated in Singapore | Published | S4, terms dated 2024-10-10 |
| what the operator says it is | "a developer of software", whose users trade "peer-to-peer directly between the users' Layer 1 addresses through a smart contract" | Published | S4 section 12.1 |
| blocked from the interface | persons who reside in, are located in, are incorporated in or have a registered office in the United States or the United Kingdom | Region-specific | S4, opening notice and section 2 |
| barred from every service | Iran, Cuba, North Korea, Syria, Myanmar, Crimea, Donetsk, Luhansk and any other region under comprehensive US sanctions, plus sanctioned persons | Region-specific | S4 section 2 |
| perpetuals for US and UK persons | "no Blocked Person may enter into Perpetual Contracts using the Services", citing the Commodity Exchange Act | Region-specific | S4 section 12.1 |
| VPN | "Use of a virtual private network ("VPN") to circumvent the restrictions set forth herein is prohibited" | Published | S4 |
| sign-up and collateral | a wallet or an email address, then USDT on Arbitrum or USDC on Base or Arc. No identity check is described | Published | S5 |
| access from this host | every valid public call answered 200 through Cloudflare edges SEA and YVR, the error cases answered JSON errors, and nothing was a geoblock or a challenge | Probed | P2, P3 and P4 |

Canada is in neither list, so the exit this host uses is not barred by the terms.
A US person may not use the interface or trade the perpetuals.

## 2. Quick answer

| family | maker | taker | label | source |
|---|---|---|---|---|
| USDT-settled linear perpetuals, tier 1 | 0.000 %, 0 ppm | 0.045 %, 450 ppm | Published and Probed | S1 tier 1. `tradeMakerFeeRate` `"0.00000000"` and `tradeTakerFeeRate` `"0.00045000"` in `/market/exchange-info` and `/market/inventory`, P1 and P3 |

Every perpetual pays the same rates.
The API documentation's own examples show older rates, 0.0002 and 0.0005 in one reply and 0.00015 and 0.00045 in two others, S9, and the live reply is what this profile records.

## 3. Coverage matrix

| product | present | count on 2026-10-12 | evidence |
|---|---|---|---|
| USDT-settled linear perpetuals, category `CRYPTO` | yes | 8: BTC, ETH, SOL, SUI, XRP, BNB, HYPE and PAXG | P2, `/market/exchange-info` |
| USDT-settled linear perpetuals, category `FX` | yes | 7: AUD, GBP, EUR, NZD, JPY, CAD and XAG | P2. They trade 24/5, S8 |
| USDC-settled perpetuals | no | 0 | every contract has `settlementSymbol` `USDT`, P2. USDC on Base and Arc is deposited collateral, S5 |
| coin-margined perpetuals | no | 0 | P2 |
| temp markets, time-limited perpetuals | none live | 0 live. `/market/inventory` holds 52 `CLOSED` contracts, most with an open and a close time a few weeks apart, the shape of a temp | S7, P2 |
| dated futures | no | 0 | CCXT declares `future` false, `hibachi.js` line 36 |
| options | no | 0 | CCXT declares `option` false, `hibachi.js` line 37 |
| spot | no | 0 | CCXT declares `spot` false, `hibachi.js` line 33 |

## 4. Perpetual tiers

The tier is set by the 14-day rolling perpetual volume in USD, assessed daily at 00:00 UTC and applied from about 03:00 UTC, S1.
Sub-accounts share the master account's tier and add to its volume, and vault volume counts apart, S1.

| tier | 14-day volume | maker | taker | taker ppm |
|---|---|---|---|---:|
| 1 | 0 | 0.000 % | 0.045 % | 450 |
| 2 | over $5,000,000 | 0.000 % | 0.038 % | 380 |
| 3 | over $10,000,000 | 0.000 % | 0.036 % | 360 |
| 4 | over $25,000,000 | 0.000 % | 0.034 % | 340 |
| 5 | over $50,000,000 | 0.000 % | 0.032 % | 320 |
| 6 | over $250,000,000 | 0.000 % | 0.025 % | 250 |
| 7 | over $500,000,000 | 0.000 % | 0.020 % | 200 |

All seven rows are Published, S1, and P1 parsed the same seven rows from the page.
`/market/inventory` also returns `tradingTiers`, 15 levels titled from "Flicker" to "Supernova" with lower and upper thresholds and no rate, P1, so they are not the fee table.

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | label | source |
|---|---|---|---|
| volume tiers | section 4 | Published | S1 |
| token holding | none found | Not offered | S1 lists no token discount |
| referral program | commissions paid weekly to the referrer, and no stated discount for the referred trader | Published | S10 |
| affiliate program | boosted commissions and points multipliers for partners, by application | Negotiated | S10 |
| market maker program | none published | Not publicly specified | |
| zero fee promotion | none found on 2026-10-12 | Not publicly specified | S1 |
| maker rate | 0 at every tier | Published | S1, P1 |

## 6. Funding as a cost

| item | value | label | source |
|---|---|---|---|
| interval | every hour, on the whole UTC hour | Published and Probed | S2. 80 rows a market, one per hour with no gap, over 80 h for BTC, EUR, XAG, JPY and PAXG, P2 |
| formula | `ρ_t = clamp((M_t - S_t) / S_t, -1, +1)` with `M_t` the mid and `S_t` the spot index, and `Funding Rate = (1/8) × mean(ρ_t)` over the trailing hour | Published | S2 |
| sampling | "The funding process operates in discrete intervals of 5 seconds", while the same page calls `ρ_t` a per-second premium | Published | S2 |
| cap and floor | "Funding Rate Limits: -10% to 10%" | Published | S3 |
| payment | `Q × Funding Rate × S_settlement`, with `S_settlement` the spot index at the settlement instant | Published | S2 |
| who pays | longs pay shorts when the rate is positive, peer to peer, with no exchange fee collected | Published | S2 |
| FX and XAG halts | no funding while paused. Every EUR and XAG row from Friday 22:00 to Sunday 21:00 UTC settled at 0 with an unchanged index, and the XAG row of 2026-10-12 22:00 also settled at 0 | Published and Probed | S8, P2 |
| largest hourly rate seen | XAG `-0.007986` at 2026-10-12 07:00 UTC, and BTC from `-0.000010` to `0.000067` over the same 80 h | Probed | P2 |

The settlement instant itself was not captured, because the research did not wait for an hour to turn.

## 7. Liquidation, settlement and delisting

| item | value | label | source |
|---|---|---|---|
| liquidation | partial, by market orders, until the risk score is back at 0.99 | Published | S6 |
| liquidation fee | "a small liquidation fee" that goes to the insurance fund, with no rate given | Not publicly specified | S6 |
| temp market expiry | open positions settle at the final mark price | Published | S7 |
| delisting | 52 contracts are `CLOSED`, with their close time in `marketCloseTimestamp` | Probed | P2 |
| transfer between accounts | `transferFeeRate` `"0.00010000"`, 100 ppm | Probed | P1 |
| deposit and withdrawal | gas costs, `depositFees` `"0.007515"` and `withdrawalFees` `"0.020041"` USDT at 22:21 UTC and `"0.007459"` and `"0.019891"` at 22:37 UTC, and an instant withdrawal schedule from 0.2 % above 1,000 USDT to 2 % above 5 USDT | Dynamic | S9, P1 and P4 |

## 8. CCXT

CCXT 4.5.68 reports `market.taker` 0.00045 and `market.maker` 0.00015 on every one of the 15 perpetuals without credentials, P1.
Neither comes from the market row, because `parseMarket` sets no fee, so both are the class constants at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/hibachi.js` lines 195 and 196, S11.
The taker, 450 ppm, matches the venue.
The maker, 150 ppm, does not, since the venue charges 0.
`fetchTradingFees` reads `/trade/account/info`, which needs an account id and a key, at line 783.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 450 | tier 1 taker, S1, and `tradeTakerFeeRate` in the live reply, P1 |
| `ccxtTakerPpm` | 450 | `market.taker` 0.00045 on every perpetual, `hibachi.js` line 196, P1 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hibachi Docs, Fees | https://docs.hibachi.xyz/hibachi-docs/trading/fees | 2026-10-12 | Hibachi, docs | tiers and their schedule, sections 2, 4 and 5 |
| S2 | Hibachi Docs, Funding | https://docs.hibachi.xyz/hibachi-docs/trading/funding | 2026-10-12 | Hibachi, docs | funding interval, formula and payment, section 6 |
| S3 | Hibachi Docs, Limits | https://docs.hibachi.xyz/hibachi-docs/trading/limits | 2026-10-12 | Hibachi, docs | funding rate limits, section 6 |
| S4 | Hibachi Terms of Service, dated 2024-10-10 | https://hibachi.xyz/terms | 2026-10-12 | Hibachi PTE. LTD., Singapore | operator, blocked and restricted regions, section 1 |
| S5 | Hibachi Docs, Signing Up | https://docs.hibachi.xyz/hibachi-docs/getting-started/signing-up | 2026-10-12 | Hibachi, docs | sign-up and collateral, sections 1 and 3 |
| S6 | Hibachi Docs, Liquidations | https://docs.hibachi.xyz/hibachi-docs/trading/liquidations | 2026-10-12 | Hibachi, docs | liquidation, section 7 |
| S7 | Hibachi Docs, Temp Markets | https://docs.hibachi.xyz/hibachi-docs/trading/temp-markets | 2026-10-12 | Hibachi, docs | time-limited perpetuals, sections 3 and 7 |
| S8 | Hibachi Docs, FX trading | https://docs.hibachi.xyz/hibachi-docs/trading/fx-trading | 2026-10-12 | Hibachi, docs | 24/5 trading and no funding while paused, sections 3 and 6 |
| S9 | Hibachi API documentation, Market API, Fees | https://api-doc.hibachi.xyz/ | 2026-10-12 | Hibachi, Postman documenter | fee fields of `/market/exchange-info` and the older example rates, sections 2 and 7 |
| S10 | Hibachi Docs, FAQ, Referrals | https://docs.hibachi.xyz/faq | 2026-10-12 | Hibachi, docs | referral and affiliate programs, section 5 |
| S11 | CCXT 4.5.68 `hibachi.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/hibachi.js` | 2026-10-12 | CCXT | fee constants and the coverage flags, sections 3 and 8 |
| P1 | `fees-probe.py` modes `ccxt`, `feeconfig` and `docs`, 22:21 UTC | [`fees-probe.py`](../../../scripts/probes/venues/hibachi/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2, 4, 7 and 8 |
| P2 | `rest-probe.py` modes `host`, `catalog`, `funding`, `book`, `errors` and `time`, 22:23 UTC | [`rest-probe.py`](../../../scripts/probes/venues/hibachi/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 3, 6 and 7 |
| P3 | `rest-probe.py` modes `anchor` and `identity`, 22:24 to 22:26 UTC | [`rest-probe.py`](../../../scripts/probes/venues/hibachi/rest-probe.py) | 2026-10-12 | this host, Canadian exit | section 1 |
| P4 | the second pass, every mode of both probes rerun, 22:37 to 22:39 UTC | [`fees-probe.py`](../../../scripts/probes/venues/hibachi/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/hibachi/rest-probe.py) | 2026-10-12 | this host, Canadian exit | every section |

The second pass, P4, reproduced every fee and every rate of this profile, and only the gas-based deposit and withdrawal fees moved.
