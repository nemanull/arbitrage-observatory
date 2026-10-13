# GRVT Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:21 to 22:35 UTC for the first pass and from 22:43 to 22:54 UTC for the second, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the perpetual fees of GRVT (CCXT id `grvt`), a hybrid decentralised venue whose order book is matched off chain and settled on its own ZKsync-stack Layer 2.
Every fee number comes from the help center, and the probe [`fees-probe.py`](../../../scripts/probes/venues/grvt/fees-probe.py) reads the fee article and CCXT 4.5.68.
P1 is the first pass of each mode and P2 is the second pass, both listed in section 10.
The socket is in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).
The API documentation host `api-docs.grvt.io` answered a Cloudflare 403 page, "Sorry, you have been blocked", to curl's and httpx's default clients from this host, and answered 200 to curl with a browser user agent, so it filters clients and does not block the exit, see [`rest.md`](./rest.md) section 1.
The help center at `help.grvt.io` answered every client.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-10-12 | this profile |
| legal entity | Albatross Group Overseas S.A., incorporated in Panama, "GRVT International", the sole "Company" of the User Agreement dated 14 September 2026, which operates the central limit order book | S6 |
| who may trade | anyone outside the restricted jurisdictions who registers an email or a wallet and signs orders with a registered wallet | S5, S6, [`rest.md`](./rest.md) section 9 |
| regions excluded | the United States and its territories, Singapore, Hong Kong, North Korea, Iran, Myanmar, Belarus, Cuba, Crimea, Donetsk, Luhansk, Kherson, Zaporizhzhya, Sevastopol, Afghanistan, Canada, Libya, Russia, Somalia, South Sudan, Sudan and Syria, page dated August 3, 2026 | S5 |
| this host | the Canadian exit is in an excluded region, yet the public market data REST and socket answered with no refusal, see [`rest.md`](./rest.md) section 1 | P1 of `rest-probe.py` |

Canada and the United States are both excluded, so no account could trade these perpetuals from this host or from a US address.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-margined linear perpetuals, crypto, equity and commodity alike | -0.0001 %, -1 ppm, a rebate | 0.0450 %, 450 ppm | S1 Level 1, S2 Tier 1, P1 |

The help center lists one table for all perpetuals, so equity and commodity perpetuals pay the crypto rates.
The table in force carries the heading "Fee Tiers (Active after March 23, 2026, 4:00 AM UTC)", S1, and the article was "Updated over 3 weeks ago" on 2026-10-12, P1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined linear perpetuals | yes, 184 `ACTIVE` and 10 `DELISTED` on 2026-10-12, all quoted and settled in USDT | [`rest.md`](./rest.md) section 2, P1 of `rest-probe.py` |
| of which crypto | 78, `asset_class` `CRYPTO` | same |
| of which equity, ETF and pre-IPO | 98, `asset_class` `EQUITY`, such as `AAPL`, `SPY`, `SAMSUNG`, `OPENAI` and `ANTHROPIC` | same |
| of which commodity | 8, `asset_class` `COMMODITY`: `BZ`, `CL`, `COPPER`, `NATGAS`, `XAG`, `XAU`, `XPD`, `XPT` | same |
| USDC-margined or inverse perpetuals | absent: no instrument has another quote | same |
| `STABLE_PERP`, "Stable Funding Perp on an RWA underlying, USDC-settled" | documented kind, 0 instruments | S12, P1 of `rest-probe.py` |
| dated futures | documented kind `FUTURE`, 0 instruments | S12, P1 of `rest-probe.py` |
| options | documented kinds `CALL` and `PUT`, 0 instruments | S12, P1 of `rest-probe.py` |
| spot | present in the app since the article of June 25, 2026, with the pair USDC/USDT and its own maker and taker columns in S1, and absent from the perpetual catalog | S10, S1 |

## 4. Perpetual tiers

The tier is set daily at 08:00 UTC from the 30-day futures trading volume, S1.
The old model, which also counted option volume and total assets, expired on March 23, 2026 at 04:00 UTC, S1.

| level | perps maker | perps taker | taker ppm | 30D trading volume (USD) |
|---|---:|---:|---:|---:|
| 1 | -0.0001 % | 0.0450 % | 450 | 0 |
| 2 | -0.0004 % | 0.0420 % | 420 | 1,000,000 |
| 3 | -0.0008 % | 0.0390 % | 390 | 5,000,000 |
| 4 | -0.0010 % | 0.0370 % | 370 | 10,000,000 |
| 5 | -0.0015 % | 0.0340 % | 340 | 50,000,000 |
| 6 | -0.0020 % | 0.0320 % | 320 | 100,000,000 |
| 7 | -0.0023 % | 0.0290 % | 290 | 250,000,000 |
| 8 | -0.0025 % | 0.0260 % | 260 | 500,000,000 |
| 9 | -0.0030 % | 0.0240 % | 240 | 1,000,000,000 |

The table above is S1 as P1 parsed it, and the MM program page, S2, dated May 26, 2026, repeats the same maker and taker columns.
S2 adds that "All special tiers past Level 9 receives the same Taker fee."

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | source |
|---|---|---|
| token holding | none published | S1, S2 |
| referral | none on the taker published, and "referral rewards do not apply on trades that specify a builder code" | S7 |
| market maker program | maker rebates of 0.003 % to 0.011 % by category, Basic to Diamond, and the taker stays at the account's level | S2 |
| builder code | adds the builder's fee on top, capped by what the user authorised, settled daily | S7 |
| zero fee promotions | none found | S1, S2 |

CCXT 4.5.68 sends a builder code with every order it signs, builder `0x21d2a053495994b1132a38cd1171acec40c6741e` at a `builderRate` of `0.01`, at `grvt.js` lines 191 to 193 and 2086 to 2090, S13.
GRVT reads a futures builder rate in percent, and its own example reads "0.1" as 0.1 %, S7, so an order placed through CCXT would pay 0.01 %, 100 ppm, more than the table.
The engine reads market data only, so this changes nothing here.

The MM program also states "a 25ms speedbump for major trading pairs and a 50ms speedbump for altcoins to minimize toxic flow", S2.
That is a delay on orders, not a fee, and a later execution stage has to count it.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| payment | the absolute position size × mark price × funding rate at the settlement instant, and longs pay when the rate is positive | S3, S4 |
| interval | 1 h, 4 h or 8 h per market, set to match Binance's interval, and a market switches to 1 h when its average hourly premium would exceed its cap | S3 |
| intervals on 2026-10-12 | 124 markets on 8 h, 59 on 4 h, 1 on 1 h (`KAIA`) | P1 of `rest-probe.py`, [`rest.md`](./rest.md) section 2 |
| settlement times | on the UTC hour boundary of the interval: 00, 08 and 16 for 8 h, every fourth hour for 4 h, every hour for 1 h, with `funding_time` exactly on the second | P1 of `rest-probe.py` funding history |
| formula | `min(max(clampedPremium, floor), cap)` where `clampedPremium = [avgPremium + clamp(0.01 % - avgPremium, 0.05 %, -0.05 %)] / (8 / intervalHours)` | S3, S4 |
| premium sample | `(Fair Price - Index Price) / Index Price`, with fair price the median of best bid, best ask and last trade, every 5 s in S3 and "once every second" in S4 | S3, S4 |
| cap and floor | per market, "We mirror Binance's per-interval cap/floor", S3, while the contract specification PDF says "within ± 0.05%", S4 | S3, S4 |
| caps on the wire | `adjusted_funding_rate_cap` 2.0 on 146 markets, 0.3 on `BTC` and `ETH`, and 0.375 to 3.0 on the rest, with the floor its negative | P1 and P2 of `rest-probe.py` |
| caps against Binance | 180 of 183 caps equal Binance's `adjustedFundingRateCap` times 100, and 182 of 183 intervals equal Binance's, with `KODEX200`, `KORU` and `KSTR` the exceptions | P2 of `rest-probe.py`, [`rest.md`](./rest.md) section 2 |
| unit | percent per interval: `BTC` read `funding_rate` `0.01` under a cap of `0.3`, where Binance's own cap reads 0.00300 as a fraction | P1 and P2 of `rest-probe.py`, [`rest.md`](./rest.md) section 4 |

The wire's caps, 0.3 to 3.0 percent, contradict S4's ± 0.05 %, and they match S3's rule of mirroring Binance on 180 of 183 markets.
No probe waited for a settlement instant, so the settlement itself was not captured, and the funding history and S3 stand in for it.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation fee | charged on liquidated positions, "based on the position size liquidated and the liquidation price", with no rate published | S4, S11 |
| withdrawal fee | flat: 2 USDT on Ethereum, 1.01 USDT on Arbitrum One and BNB Smart Chain, 1.5 USDT on Solana, 1.4 USDT on Tron | S1 |
| settlement fee | named in the User Agreement's list of fees, with no rate published | S6 |
| socialized loss | a charge on withdrawals while the insurance fund is short, applied only to users who withdraw in that window | S4 |
| delisting | reduce-only 24 h before, then the mark freezes and open positions close at that mark through "Close Delisted Position", with no fee named | S9 |
| multi-asset margin repayment | the greater of 0.1 % or the asset's haircut over 8, 4 or 2, on converted collateral | S1 |

## 8. CCXT

| item | value | source |
|---|---|---|
| `market.taker` for `BTC/USDT:USDT` without credentials | `undefined` (`None` in Python), and the same on all 194 swaps | P1, P2 |
| `market.maker` | `undefined` on all 194 | P1, P2 |
| why | `grvt.js` sets `urls.fees` to the help article at line 104 and defines no `fees.trading`, so `setMarkets` merges the base default `taker: undefined` from `Exchange.js` line 2373 at line 3735 | S13, S14 |
| `market.active` | `undefined` on all 194, including the 10 `DELISTED`, at `grvt.js` line 720 | S13, P1 |

## 9. Recommended registry values

| constant | value | reason |
|---|---|---|
| `takerPpm` | 450 | the Level 1 perps taker, 0.0450 %, S1 and S2, as decision 5 of the waves design takes the VIP 0 taker from this file |
| `ccxtTakerPpm` | none | CCXT 4.5.68 reports no taker for any GRVT market, section 8 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | How does Grvt's Fee Model work? | https://help.grvt.io/en/articles/9614699-how-does-grvt-s-fee-model-work | 2026-10-12 | GRVT, help center | tiers, spot columns, withdrawal and repayment fees, sections 2, 4 and 7 |
| S2 | Grvt MM Program, dated May 26, 2026 | https://help.grvt.io/en/articles/13606302-grvt-mm-program | 2026-10-12 | GRVT, help center | the same tiers, maker rebates, the speedbump, sections 4 and 5 |
| S3 | Funding Rate Mechanism, from 15 October 2025 | https://help.grvt.io/en/articles/12555039-funding-rate-mechanism | 2026-10-12 | GRVT, help center | funding formula, intervals, caps mirroring Binance, section 6 |
| S4 | Contract Specifications (Cryptocurrency), last update 29 April 2026, a PDF attached to the article | https://help.grvt.io/en/articles/10258593-what-are-grvt-s-perpetual-contract-specifications | 2026-10-12 | GRVT, contract terms | funding terms, the ± 0.05 % cap sentence, liquidation fees, sections 6 and 7 |
| S5 | Restricted Jurisdictions, dated August 3, 2026 | https://help.grvt.io/en/articles/9711621-restricted-jurisdictions | 2026-10-12 | GRVT, help center | excluded regions, section 1 |
| S6 | User Agreement, PDF dated 14 September 2026 | https://help.grvt.io/en/articles/9614719-user-agreement | 2026-10-12 | Albatross Group Overseas S.A., Panama | entity, fee list, section 1 |
| S7 | Builder Codes, and the API docs page on builder integration | https://help.grvt.io/en/articles/13134727-builder-codes and https://api-docs.grvt.io/builder_codes/ | 2026-10-12 | GRVT | builder fees and their percent unit, section 5 |
| S8 | What are Retail Price Improvement (RPI) Orders? | https://help.grvt.io/en/articles/11410051-what-are-retail-price-improvement-rpi-orders | 2026-10-12 | GRVT, help center | RPI orders are out of the API book, see [`websocket.md`](./websocket.md) section 4 |
| S9 | Perpetual Futures Delistings | https://help.grvt.io/en/articles/14780440-perpetual-futures-delistings | 2026-10-12 | GRVT, help center | delisting rules, section 7 |
| S10 | Spot Trading on Grvt, dated June 25, 2026 | https://help.grvt.io/en/articles/15456179-spot-trading-on-grvt | 2026-10-12 | GRVT, help center | spot, section 3 |
| S11 | What's the liquidation process on Grvt? | https://help.grvt.io/en/articles/10255070-what-s-the-liquidation-process-on-grvt | 2026-10-12 | GRVT, help center | liquidation, section 7 |
| S12 | Market Data API, Get All Instruments and Funding Rate, fetched with a browser user agent | https://api-docs.grvt.io/market_data_api/ | 2026-10-12 | GRVT, API docs | kinds, funding history unit "percentage points", sections 3 and 6 |
| S13 | CCXT 4.5.68 `grvt.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/grvt.js` | 2026-10-12 | CCXT | lines 104, 191 to 193, 720 and 2086 to 2090, sections 5 and 8 |
| S14 | CCXT 4.5.68 `Exchange.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/base/Exchange.js` | 2026-10-12 | CCXT | lines 2373 and 3735, section 8 |
| P1 | `fees-probe.py` modes `ccxt` and `article` at 22:24 UTC, and `rest-probe.py` modes `catalog` and `funding` at 22:21 and 22:23 UTC | [`fees-probe.py`](../../../scripts/probes/venues/grvt/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/grvt/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 4, 6 and 8 |
| P2 | `fees-probe.py` rerun at 22:46 UTC and its `article` mode again at 22:54 UTC, and `rest-probe.py` modes `catalog`, `funding` and `binance` rerun from 22:43 to 22:52 UTC | [`fees-probe.py`](../../../scripts/probes/venues/grvt/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/grvt/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2, 4, 6 and 8 |
