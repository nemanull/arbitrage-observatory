# Aster Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:18 to 22:28 UTC, with the second pass from 22:34 to 22:40 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the fees of Aster's order book perpetuals, which the venue calls Pro mode and which CCXT 4.5.68 reads as `aster`.
Shield mode, 1001x and spot are separate products and are only named in the coverage matrix.
Every probed number comes from [`fees-probe.py`](../../../scripts/probes/venues/aster/fees-probe.py) or [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py), and the runs are listed as P1 to P7 and R1 to R3 in section 10.
The socket is in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| operator | "Aster", with no legal entity named in the terms | Published | S10 |
| governing law | the laws of Hong Kong, with HKIAC arbitration seated in Hong Kong | Published | S10 section 12 |
| terms date | "Last updated: February 25, 2026" | Published | S10 |
| who may trade | anyone aged 18 or over outside the Prohibited Jurisdictions, with no KYC described beyond "limited identity verification procedures" | Published | S10 sections 2.1 and 2.3 |
| regions excluded | the United States, Canada, the United Kingdom, China, North Korea, Russia, Ukraine, Cuba, Iran, Venezuela and Syria, plus any comprehensively sanctioned territory | Published | S10 section 2.1 c |
| US persons | may not use the services | Published | S10 section 2.1 c |
| this host | the exit geolocates to Canada, a Prohibited Jurisdiction, yet every public REST call and every socket answered, see [`rest.md`](./rest.md) section 1 | Probed | P1 |

Trading from this host is not allowed by the terms, so every number here is for observation only.

## 2. Quick answer

The base tier is called VIP 1, and no VIP 0 exists.

| perpetual family | maker | taker | ppm | label | source |
|---|---|---|---|---|---|
| USDT-margined, Crypto General | 0 % | 0.040 % | 400 | Published | S1, S2 |
| USDT-margined, Crypto Group B, 19 or 20 kept markets, section 4 | 0 % | 0.100 % | 1,000 | Published | S1, S2 |
| USDT-margined, RWA (stocks, ETFs, commodities) | 0 % | 0.0125 % | 125 | Published, effective 2026-09-07 | S1, S2 |
| USD1-quoted BTC, ETH and SOL | 0 % | 0.040 % | 400 | Published | S1 |
| USD1-quoted RWA | 0 % | 0.0125 % | 125 | Published | S1 |

The engine keeps only quotes in USDT, USDC or USD, so the 22 USD1 and 2 `U` perpetuals fall outside it, see [`rest.md`](./rest.md) section 2.

## 3. Coverage matrix

| product | present | how established |
|---|---|---|
| USDT-margined linear perpetuals, Pro mode order book | yes, 577 `TRADING`, 22 `SETTLING`, 6 `PENDING_TRADING` | P1 `catalog` |
| USD1-margined linear perpetuals | yes, 22 `TRADING` | P1 `catalog` |
| `U`-margined linear perpetuals, AOS-2 listings | yes, `BTCU` and `ETHU` | P1 `catalog` |
| USDC-margined or USD-margined perpetuals | Not offered in the order book catalog | P1 `catalog`, every `quoteAsset` is USDT, USD1 or U |
| coin-margined inverse perpetuals | Not offered | P1 `catalog`, every `marginAsset` equals `quoteAsset` |
| dated futures | Not offered, every row with a contract type says `PERPETUAL`, the six `PENDING_TRADING` rows carry an empty one, and the two kept pre-launch contracts are perpetual | P1 `catalog`, S5 section "ENUM definitions", S8 |
| options | Not offered | S5, and CCXT's `has` map sets `option` false at `aster.js` line 55 |
| spot | yes, on `sapi.asterdex.com`, 77 markets in CCXT | P7 `ccxt` |
| Shield mode | yes, a separate AMM-style product with no order book, whose mark equals its last price | S16 |
| 1001x | yes, an on-chain pool product priced by Pyth, Chainlink and Binance Oracle | S17 |

The bulk anchor call returns 781 rows, 628 of them catalog rows and 153 symbols that no catalog row names, such as `BTCUSD` and `AAPLUSD`, which are most likely the Shield and 1001x pairs, see [`rest.md`](./rest.md) section 3.
That they belong to those products is an inference, because no document maps them.

## 4. Perpetual tiers

VIP status is assessed daily at 23:59 UTC, and both a rolling 14-day spot plus perpetual volume and an average $ASTER balance must be met, S2.
The tier tables are images on the VIP page, S2, read on 2026-10-12.

| tier | 14-day volume, USD | $ASTER held | General taker | Group B taker | RWA taker | maker |
|---|---|---|---:|---:|---:|---:|
| VIP 1 | < 5M | ≥ 0 | 4.0 bps | 10.0 bps | 1.25 bps | 0 bps |
| VIP 2 | ≥ 5M | ≥ 500 | 3.5 bps | 5.0 bps | 1.25 bps | 0 bps |
| VIP 3 | ≥ 25M | ≥ 2,500 | 3.3 bps | 3.3 bps | 1.25 bps | 0 bps |
| VIP 4 | ≥ 100M | ≥ 25,000 | 2.3 bps | 2.3 bps | 1.25 bps | 0 bps |
| VIP 5 | ≥ 500M | ≥ 250,000 | 2.0 bps | 2.0 bps | 1.25 bps | 0 bps |
| VIP 6 | ≥ 1B | ≥ 2,500,000 | 1.6 bps | 1.6 bps | 1.25 bps | 0 bps |

Maker fees are 0 bps on every tier since 2026-02-02, and RWA maker volume counts ten times toward the tiers since 2026-06-10, S2.

The Group B list differs between the two pages.
The fees page, S1, names 21 symbols, and 20 of them are kept markets, including `SKHYNIXUSDT`, while `PENGUINUSDT` is `SETTLING`, P7 `pages`.
The VIP page, S2, names 19, all kept, and leaves out `SKHYNIXUSDT` and `PENGUINUSDT`.
`SKHYNIXUSDT` is a Korean stock perpetual with `symbolType` 1, so it is RWA by the catalog and Group B by the fees page.

No catalog field names the fee class.
The 121 kept markets with `symbolType` 1 are exactly the kept rows tagged `STOCK`, `ETF` or `Commodities` in `underlyingSubType`, P1 `catalog` and P7 `pages`, so `symbolType` 1 is the best available marker of the RWA class.
That mapping is an inference from the catalog, not a documented rule.

## 5. Discounts that change the perpetual taker

| discount | effect | label | source |
|---|---|---|---|
| referral | the referrer's default 10 % commission can be split, so a referee gets back up to 10 % of its fees | Published | S11 |
| AFEE | 1 AFEE pays 1 USDT of fees, total supply 100,000, and it changes who pays rather than the rate | Published | S13 |
| $ASTER holding | gates every tier above VIP 1, section 4 | Published | S2 |
| market maker program | a maker-side program, not read for the taker | Negotiated | not read |
| builder fee, Aster Code | a builder may add its own fee up to the maximum the user approves | Published | S12 |
| zero-fee promotion | none on Pro mode perpetuals on 2026-10-12. Shield mode advertises a limited zero-fee event | Published | S1, S16 |

CCXT 4.5.68 enables a builder fee by default.
`aster.js` lines 462 to 464 set `builderFee` true, a CCXT builder address and `builderRate` `0.001`, and line 2766 sends that rate as `feeRate` on orders.
So an order placed through CCXT with default options would pay up to 10 bps on top of the venue's taker, once the user approved that builder.
The engine places no orders, so this matters only to a later execution stage.

## 6. Funding as a cost

| item | value | label | source |
|---|---|---|---|
| formula | F = [P + clamp(interest − P, 0.05 %, −0.05 %)] / (8 / N), N the interval in hours | Published | S3 |
| interest | 0.01 % per 8 h except `BNBUSDT` at 0 %. On the wire `interestRate` is `0.00010000` on 457 kept markets, `0` on 118 and `0.00005000` on 2 | Published and Probed | S3, P1 `anchor` |
| premium index | sampled every 5 s from the impact bid and ask at a configurable impact notional | Published | S3 |
| average | time-weighted for intervals over 1 h, plain mean for 1 h | Published | S3 |
| interval | 8 h on 180 kept markets, 4 h on 347 and 1 h on 50, from `fundingIntervalHours` | Probed | P1 `anchor` |
| cap and floor | per market `fundingFeeCap` and `fundingFeeFloor`: ±0.02 on 544 kept markets, ±0.003 on `BTCUSDT` and `ETHUSDT`, others between ±0.00375 and ±0.03 | Probed | P1 `anchor` |
| settlement instants | on the interval grid in UTC: the six latest `BTCUSDT` settlements fell at 00:00, 08:00 and 16:00 UTC with `fundingTime` 0 to 2 ms after the hour | Probed | P1 `funding` |
| who pays | longs pay shorts when the rate is positive, peer to peer, and "Aster does not charge or receive funding" | Published | S3 |
| charge timing | "a 15-second deviation between the actual time and when the funding fee is charged" | Published | S3 |
| interval changes | made without announcement when the rate hits its cap or floor | Published | S3 |

The settlement instant itself was not captured, as the survey's rule says.

## 7. Liquidation, settlement and delisting

| item | value | label | source |
|---|---|---|---|
| liquidation fee | `liquidationFee` `0.025000`, 2.5 %, on all 577 kept markets | Probed | P1 `catalog` |
| delisting notice | at least 24 hours, on X, Telegram and Discord | Published | S9 |
| reduce-only window | the last 10 minutes before trading stops | Published | S9 |
| final mark | the mean of the index sampled every second over the last hour, 3,600 points | Published | S9 |
| settlement fee | trading fees are charged on the automatic close at delisting | Published | S9 |
| pre-launch delivery | Aster keeps "final authority over the delivery price" | Published | S8 |

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/aster.js`, `dex: true` at line 32 | CCXT 4.5.68 |
| taker constant | `0.00035` at line 431, 350 ppm | CCXT 4.5.68 |
| maker constant | `0.0001` at line 430, 100 ppm | CCXT 4.5.68 |
| per market | `parseMarket` copies the constants at lines 899 and 900 | CCXT 4.5.68 |
| `market.taker` without credentials | `0.00035` on all 577 kept markets, and `maker` `0.0001` | P7 `ccxt` |

CCXT's 350 ppm equals the VIP 2 General taker of 3.5 bps, not the base tier's 4.0 bps.
It also ignores the RWA and Group B classes.
CCXT's 100 ppm maker is also stale, because every maker fee is 0 since 2026-02-02, S2.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm`, Crypto General | 400 | VIP 1 General taker, S1 and S2 |
| `takerPpm`, Group B | 1,000, for the 19 kept symbols both pages list, plus `SKHYNIXUSDT` if the stricter fees page is followed | VIP 1 Group B taker, S1 and S2 |
| `takerPpm`, RWA | 125, for kept markets with `symbolType` 1 | RWA taker, S1 and S2, with the class marker inferred in section 4 |
| `ccxtTakerPpm` | 350 | CCXT's constant at `aster.js` line 431, P7 |

`Market.taker_ppm` is per market at [`index_builder.rs`](../../../server/src/engine/cluster/index_builder.rs) lines 75 and 76, so the loader can set the three classes itself.
A single venue constant of 400 would overstate the RWA cost and understate the Group B cost, and the Group B understatement can show a cross that is not there.
The Group B list is a published constant with no API, so the loader should carry it with its retrieval date.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees | https://docs.asterdex.com/trading/perpetuals/fees-and-specs/fees.md | 2026-10-12 | Aster, docs | fee classes, Group B list, RWA and USD1 rates, sections 2 to 4 |
| S2 | VIP Program, and its three tier images | https://docs.asterdex.com/program-and-rewards/vip-program.md | 2026-10-12 | Aster, docs | tiers, assessment, maker change dates, section 4 |
| S3 | Funding Rate | https://docs.asterdex.com/trading/perpetuals/fees-and-specs/funding-rate.md | 2026-10-12 | Aster, docs | funding formula, interest, premium sampling, section 6 |
| S4 | Mark price, for Pro mode | https://docs.asterdex.com/trading/perpetuals/fees-and-specs/mark-price-1.md | 2026-10-12 | Aster, docs | mark formula, see [`rest.md`](./rest.md) section 4 |
| S5 | Aster Futures API V3 | https://github.com/asterdex/api-docs/blob/master/V3(Recommended)/EN/aster-finance-futures-api-v3.md | 2026-10-12, repository head `eeddec8d97` of 2026-09-23 | Aster, API docs | enums and endpoints, section 3 |
| S6 | Stock Perpetuals | https://docs.asterdex.com/trading/perpetuals/stock-perpetuals.md | 2026-10-12 | Aster, docs | RWA class context, section 4 |
| S7 | Pre-IPO Perpetuals | https://docs.asterdex.com/trading/perpetuals/pre-ipo-perpetuals.md | 2026-10-12 | Aster, docs | OPENAI and ANTHROPIC markets, section 3 |
| S8 | Pre-Launch Contracts | https://docs.asterdex.com/trading/perpetuals/pre-launch-contracts.md | 2026-10-12 | Aster, docs | delivery authority, section 7 |
| S9 | Delistings | https://docs.asterdex.com/trading/perpetuals/delistings.md | 2026-10-12 | Aster, docs | delisting process, section 7 |
| S10 | Terms & Conditions | https://docs.asterdex.com/resources/terms-and-conditions.md | 2026-10-12 | Aster, terms dated 2026-02-25 | eligibility, Prohibited Jurisdictions, governing law, section 1 |
| S11 | Referral Program | https://docs.asterdex.com/program-and-rewards/referral-program.md | 2026-10-12 | Aster, docs | referral split, section 5 |
| S12 | Aster Code | https://docs.asterdex.com/program-and-rewards/aster-code.md | 2026-10-12 | Aster, docs | builder fees, section 5 |
| S13 | AFEE & BonusUSD | https://docs.asterdex.com/trading/perpetuals/afee-and-bonususd.md | 2026-10-12 | Aster, docs | AFEE, section 5 |
| S14 | CCXT 4.5.68 `aster.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/aster.js` | 2026-10-12 | CCXT | fee constants and builder options, sections 5 and 8 |
| S15 | What is Aster? | https://docs.asterdex.com/overview/what-is-aster.md | 2026-10-12 | Aster, docs | the four products, section 3 |
| S16 | Shield Mode, Fees & Specs and Mark Price | https://docs.asterdex.com/trading/shield-mode/fees-and-specs.md | 2026-10-12 | Aster, docs | Shield mode fees and mark, sections 3 and 5 |
| S17 | 1001x, Price Oracles | https://docs.asterdex.com/trading/1001x/price-oracles.md | 2026-10-12 | Aster, docs | 1001x pricing, section 3 |
| P1 | `rest-probe.py` modes `host`, `catalog`, `anchor`, `refs`, `funding`, `book`, `errors` and `time`, 22:18:35 to 22:19:13 UTC | [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 3, 6 and 7 |
| P7 | `fees-probe.py` modes `ccxt` and `pages`, 22:27:45 UTC | [`fees-probe.py`](../../../scripts/probes/venues/aster/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3, 4, 8 and 9 |
| R1 to R3 | the second pass, every mode rerun, `rest-probe.py` from 22:34 UTC and `fees-probe.py` at 22:39:53 UTC | [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py) and [`fees-probe.py`](../../../scripts/probes/venues/aster/fees-probe.py) | 2026-10-12 | this host, Canadian exit | every probed number |
