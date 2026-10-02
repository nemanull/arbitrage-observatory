# Hotcoin Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:17 to 03:46 UTC in two passes, from the development host near Seattle.

This profile covers what a taker pays on the Hotcoin perpetuals, for every perpetual family the venue lists.
CCXT 4.5.68 has no Hotcoin class, so no CCXT constant exists to cite, see section 8.
The fee numbers come from the public JSON call behind Hotcoin's fee page, read with an unauthenticated GET, and the rules come from the fee page text and help center articles.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/hotcoin/rest-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC | this profile |
| entity named by the User Agreement | Hotcoin FZE, a Dubai entity supervised by the Dubai Virtual Assets Regulatory Authority | S3 |
| entity named by "About Hotcoin" | AUSTRALIAN HOTCOIN GLOBAL EXCHANGE PTY LTD, Sydney, with AUSTRAC registration in Australia and FinCEN MSB registration in the United States | S4 |
| country on CoinGecko | Seychelles, trust rank 58 in the API on 2026-09-23 UTC | S9 |
| who may trade | individuals aged 21 or more, who under the UAE terms must also hold at least AED 500,000 in cash or equivalents, and corporations that are not Restricted Persons | S3 clause 3.1 |
| regions excluded | "High-Risk – Not Accepted": Afghanistan, Botswana, Burundi, Cameroon, Chad, DR Congo, Côte d'Ivoire, Cuba, Eritrea, Gambia, Ghana, Guinea, Haiti, Iran, Iraq, China, North Korea, Kyrgyzstan, Lebanon, Lesotho, Liberia, Libya, Mali, Myanmar, Niger, Somalia, Sudan, Syria, Uganda, USA, Yemen, Zimbabwe | S5 Article 8 |
| enhanced due diligence | 58 more countries, among them Hong Kong, India, Russia, Turkey and the United Arab Emirates | S5 Article 8 |
| US persons | may not trade, since the Legal Statement lists the USA as not accepted | S5 |

The User Agreement defines the platform operator as Hotcoin FZE, while the About page names an Australian company, and neither page says which entity contracts with a user outside the UAE.
The Legal Statement names no entity.
That split is recorded as found, not resolved.

The public REST and WebSocket endpoints answered this US host with HTTP 200 and live data, and nothing refused or redirected it, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
Answering a US IP is not permission to trade from the US.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, crypto and TradFi | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S1 `futureVip` level 0 |
| USDC-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S1, one futures table for every family |
| coin-M inverse perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S1, one futures table for every family |

The fee page shows one "Futures Trading Fee Rate" table and no per family split, S2.
The TradFi FAQ says VIP fee rates apply to TradFi futures as well, S8.
The fee JSON carries the rates as percent strings: `"takerFee":"0.06"` is 0.06 %, the same unit in which the spot VIP 0 reads `"0.2"`, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 567: 364 crypto, 197 `us_stock`, 3 `hk_stock`, 2 `forex`, 1 `bond` | P1 `catalog` |
| USDC-M linear perpetuals | yes, 9: AAVE, DOGE, ETH, HYPE, BTC, WLFI, XRP, BNB and SOL | P1 `catalog` |
| coin-M inverse perpetuals | yes, 9: AVAX, BCH, BTC, DOGE, ETH, LINK, SOL, SUI and XRP, quoted in USD | P1 `catalog` |
| dated futures | not in the public API: `/api/v1/deliver/public` and `/api/v1/delivery/public` return nginx 404. The web app's code names a `/swap/v1/deliver/public/latest-fee-rate` path, and a help article describes delivery futures only in general terms | `curl` on 2026-09-23 UTC, S7 |
| options | none found | S6 lists no options section |
| spot | yes, 363 symbols from `https://api.hotcoinfin.com/v1/common/symbols` | P1 `catalog` |

The 585 perpetuals are what `GET /api/v1/perpetual/public` listed at 03:17, 03:37 and 03:43 UTC on 2026-09-23.
CoinGecko's derivatives list showed "Hotcoin (Futures): 598 perpetual pairs" on 2026-09-22, per the survey tracker.

## 4. Perpetual tiers

All thirteen futures tiers from S1, retrieved 2026-09-23 03:11 UTC.

| level | 30-day trading volume, USDT | or total asset balance, USDT | maker | taker | taker ppm |
|---|---:|---:|---:|---:|---:|
| VIP 0 | 0 | 0 | 0.02 % | 0.06 % | 600 |
| VIP 1 | 500,000 | 10,000 | 0.0195 % | 0.059 % | 590 |
| VIP 2 | 1,000,000 | 30,000 | 0.019 % | 0.057 % | 570 |
| VIP 3 | 3,000,000 | 50,000 | 0.0185 % | 0.056 % | 560 |
| VIP 4 | 10,000,000 | 100,000 | 0.018 % | 0.054 % | 540 |
| VIP 5 | 30,000,000 | 300,000 | 0.0175 % | 0.052 % | 520 |
| VIP 6 | 100,000,000 | 500,000 | 0.017 % | 0.05 % | 500 |
| VIP 7 | 300,000,000 | 800,000 | 0.0165 % | 0.0485 % | 485 |
| VIP 8 | 500,000,000 | 1,000,000 | 0.016 % | 0.0465 % | 465 |
| VIP 9 | 800,000,000 | 1,500,000 | 0.0155 % | 0.0445 % | 445 |
| VIP 10 | 1,000,000,000 | 2,000,000 | 0.0145 % | 0.0415 % | 415 |
| VIP 11 | 2,000,000,000 | 2,500,000 | 0.0135 % | 0.0395 % | 395 |
| VIP 12 | 3,000,000,000 | 3,000,000 | 0.0125 % | 0.0375 % | 375 |

For context, the spot table in the same reply starts at 0.2 % maker and 0.2 % taker at VIP 0 and ends at 0.1 % and 0.11 % at VIP 12, S1.

### Qualification

The fee page defines both columns, S2.

- The 30-day volume is Spot and Futures volume in all currencies over the past 30 days, converted to USDT and updated daily at 00:00 UTC+8.
- The balance is a daily 00:00 UTC+8 snapshot of all crypto in the Spot, USDT-M Futures, Coin-M Futures, P2P and Earn accounts, valued in USDT.
- The VIP level updates daily at 02:00 UTC+8, and "you will automatically fulfil the VIP level for all types" when you meet any one level's condition, so the better of the two columns counts.

## 5. Discounts that change the perpetual taker

| discount | rule | source |
|---|---|---|
| fee discount coupons | a percentage off or a fixed amount off the computed fee, from the Rewards Center or campaigns, each campaign with its own terms | S7 |
| market maker program | "Market maker onboarding, ultra-low fees and high transaction limits", terms not public | S6 |
| VIP trial | the fee page's script names a `/hk-web/vip/trial/apply` call, and its terms were not read | S2 |
| token holding | no platform token discount appears in the fee reply or on the fee page | S1, S2 |
| zero fee promotion | none found on the fee page on 2026-09-23 UTC | S2 |

None of these applies to an unqualified account, so the engine's VIP 0 taker stands.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | F = P + clamp(I − P, cap, −cap), where P is the premium index and I the interest rate | S10, formula image |
| interest rate | I = (Quote Interest Rate Index − Base Interest Rate Index) / Funding Interval, with no index values published | S10, formula image |
| clamp | "the buffer limit parameter (cap) used in the Clamp mechanism is generally set at 0.05%" | S10 |
| absolute cap and floor | "may be subject to a maximum limit", set from the initial and maintenance margin rates, with no number published | S10 |
| interval | the help center says "typically settled every 8 hours". The funding history shows 8 h on 19 of 38 sampled contracts and 4 h on the other 19, and every listed contract's next settlement was 04:00 or 08:00 UTC on 2026-09-23 | S11, P1 `history` and `catalog` |
| who pays | a positive rate means longs pay shorts, a negative rate means shorts pay longs, and "The platform is only responsible for settlement and does not collect funding fees." | S11 |
| fee | Funding Fee = Position Value × Funding Rate, charged only on positions held at the settlement time | S11 |
| settlement record | each history row is stamped 4 to 213 s after the hour, median 44 s, over 380 rows | P1 `history` |
| observed range | the last settled rate across all 585 contracts ran from −0.00228087 to 0.00229731, about ±0.23 % per interval | P1 `catalog` |
| recurring value | among the 76 lows and highs of the 38 sampled histories, 0.00005 appeared 22 times and 0.0001 8 times, which matches a 0.01 % per 8 h interest leg scaled to a 4 h interval | P1 `history`, inference |

The settlement instant itself was not captured, and the behaviour at the instant comes from the history call and the help center.

## 7. Liquidation, settlement and delisting charges

| item | value | source |
|---|---|---|
| liquidation | tiered, with partial liquidation before a full close, triggered by the mark price. No liquidation fee rate is published | S12 |
| insurance fund | an article exists, and the public history rows carry an `insuranceSize` field of 249,782,267.67 on `btcusdt` | S12, P1 `history` |
| TradFi market closed | "When the underlying market is closed or its trading hours change, the affected TradFi Futures product enters Reduce-Only mode." | S8 |
| delisting | a delisted contract leaves the catalog but stays in the tickers call and the `fund_rates` channel with zero volume and a negative settlement countdown, 383 such rows on 2026-09-23 UTC. No delisting charge is published | P1 `catalog`, [`websocket.md`](./websocket.md) section 2 |
| deviation margin | an order priced far from the market freezes extra margin, which is released on cancel or fill, and it is not a fee | S13 |

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `hot` or `hcoin` | P1 `catalog`, and `node -e "console.log(require('ccxt').exchanges)"` run from `server/` |
| CCXT master on GitHub | no `hotcoin.ts` in `ts/src` at commit `1d8b674` of 2026-09-22 12:48 UTC, 105 `.ts` files listed, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/hotcoin.ts` returns 404 | S14 |
| exchange requests | a search of the repository's issues for "hotcoin" returns 6 closed issues, none of them a request for a Hotcoin class | S14 |
| `market.taker` for a swap | none, since there is no class to load | |

So there is no CCXT source line to cite, and no `ccxtTakerPpm` to declare.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 futures taker of 0.06 % in S1, the same for every family |
| `ccxtTakerPpm` | unset | CCXT has no Hotcoin class, so the connector at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68 has no `loadMarkets` to call |

The registry entry cannot be added as it stands, because every entry in [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) builds its catalog from a CCXT class through `createExchange` at line 29.
A Hotcoin leg needs a catalog loader that reads `GET /api/v1/perpetual/public` directly, and that loader would carry the 600 ppm.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | fee schedule JSON behind the fee page | https://www.hotcoin.com/hk-web/vip/level-fee-rate | 2026-09-23 03:11 UTC | Hotcoin, global | tiers, VIP 0 maker and taker, spot table, sections 2 and 4 |
| S2 | Fee Rate page | https://www.hotcoin.com/en_US/rateStandard/index/ | 2026-09-23 UTC | Hotcoin, global | column names, qualification rules, sections 2, 4 and 5 |
| S3 | User Agreement | https://www.hotcoin.com/en_US/support/article/?code=11675574997487617 | 2026-09-23 UTC | Hotcoin FZE, UAE | entity, eligibility clause 3.1, section 1 |
| S4 | About Hotcoin | https://www.hotcoin.com/en_US/support/article/?code=11675575132753921 | 2026-09-23 UTC | Australian Hotcoin Global Exchange Pty Ltd | entity and registrations, section 1 |
| S5 | Legal Statement | https://www.hotcoin.com/en_US/support/article/?code=11675575085043713 | 2026-09-23 UTC | Hotcoin, global | excluded and restricted countries, section 1 |
| S6 | Hotcoin API landing page | https://www.hotcoin.com/en_US/apiDocument/ | 2026-09-23 UTC | Hotcoin, global | API product list, market maker line, sections 3 and 5 |
| S7 | Understanding Futures Trading Fees, and Perpetual Futures vs. Delivery Futures | https://www.hotcoin.com/en_US/support/futures-trading-fee/ and https://www.hotcoin.com/en_US/support/Perpetual-vs-Delivery/ | 2026-09-23 UTC | Hotcoin, global | fee formula, coupons, delivery futures wording, sections 3 and 5 |
| S8 | TradFi FAQ | https://www.hotcoin.com/en_US/support/TradFi-FAQ/ | 2026-09-23 UTC | Hotcoin, global | VIP rates apply to TradFi, reduce-only when closed, sections 2 and 7 |
| S9 | CoinGecko exchange API | https://api.coingecko.com/api/v3/exchanges/hotcoin_global | 2026-09-23 UTC | CoinGecko | country and trust rank, section 1 |
| S10 | Funding Rate Mechanism | https://www.hotcoin.com/en_US/support/Funding-Rate-Mechanism/ | 2026-09-23 UTC | Hotcoin, global | funding formula images, clamp, limits, section 6 |
| S11 | Funding Rate | https://www.hotcoin.com/en_US/support/What-Is-the-Funding-Rate/ | 2026-09-23 UTC | Hotcoin, global | who pays, 8 h wording, fee formula, section 6 |
| S12 | Forced Liquidation, and Insurance Fund | https://www.hotcoin.com/en_US/support/forced-liquidation/ and https://www.hotcoin.com/en_US/support/insurance-fund/ | 2026-09-23 UTC | Hotcoin, global | liquidation mechanism, section 7 |
| S13 | Price Deviation Mechanism | https://www.hotcoin.com/en_US/support/deviation-price/ | 2026-09-23 UTC | Hotcoin, global | deviation margin, section 7 |
| S14 | CCXT on GitHub, master commit and issue search | https://github.com/ccxt/ccxt/tree/master/ts/src and https://api.github.com/search/issues?q=repo:ccxt/ccxt+hotcoin | 2026-09-23 UTC | CCXT | no class, section 8 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/hotcoin/rest-probe.mjs) modes `catalog` and `history` | run from `server/` | 2026-09-23 03:17 to 03:37 UTC, and rerun at 03:43 to 03:44 UTC with the same counts | this host | sections 1, 3, 6, 7 and 8 |
