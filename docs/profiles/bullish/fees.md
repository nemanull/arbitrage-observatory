# Bullish Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, where the production API refused every call by location and only the SimNext test environment answered, see [`rest.md`](./rest.md) section 1.

This profile covers perpetual trading on Bullish (CCXT id `bullish`), and nothing else.
Spot, margin, options, dated futures, deposit and withdrawal schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bullish/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bullish/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entities | Bullish (GI) in Gibraltar, Bullish HK, Bullish EU in Germany, and Bullish US Operations LLC. The fee article sends each customer to the terms of its onboarded entity: "US: Legal US", "HK: Legal HK", "EU: Legal EU", "GI / Other: Legal ROW". | Published | S1, S6 |
| regulators | "Bullish is regulated by the German Federal Financial Supervisory Authority (BaFIN ID 10162355), the Hong Kong Securities and Futures Commission (CE No BUQ956) and the Gibraltar Financial Services Commission (GFSC 119714). In the United States, Bullish US Operations LLC is regulated by the New York State Department of Financial Services (NYDFS 0000046)" | Published | S6 |
| who may trade the perpetuals | Customers of Bullish GI only. The product matrix reads "Perpetuals Trading" Yes for Bullish GI and No for Bullish HK, Bullish EU and Bullish US. Inside Bullish GI, an "Individual" may not, and an "Individual (Professional Investor)" or an "Institutional and Corporate (Professional Investor)" may. | Published | S3 |
| derivatives venue | "one of the world's leading crypto derivatives venues in Gibraltar, regulated by the GFSC, available to eligible institutional clients in 20+ jurisdictions" | Published | S6 |
| margin prerequisite | "To trade perpetuals, you also need to be eligible for margin trading and have it enabled on your trading account." | Published | S4 |
| excluded regions | The United States, and "Prohibited Jurisdictions: countries and territories targeted by Sanctions Laws" in the Bullish GI terms. The help center footer adds "residents of jurisdictions where trading in virtual assets is restricted or banned, including residents of Mainland China". Hong Kong and EU customers are served by other entities without perpetuals. | Published | S9, S4, S3 |
| US persons | May not. The Bullish GI terms require a natural person to warrant "you are not a citizen or resident of, or located in, the United States or any Prohibited Jurisdiction" (clause 6.1.1), and a corporate body that it is "not incorporated, established or registered and/or operating in the United States" (clause 6.1.2). Bullish US offers spot only. | Published | S9, S3 |
| geoblocking | "We may implement measures such as geo-blocking that are designed to prevent access to the Services from certain locations" (clause 6.2) | Published | S9 |
| public API from this host | `api.exchange.bullish.com` answered HTTP 403 with the page "The Bullish platform is not currently available in your location." on every REST path and every WebSocket path, from a Cloudflare edge in Seattle or Vancouver. | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |
| documentation from this host | `docs.exchange.bullish.com`, `support.exchange.bullish.com` and `www.bullish.com` answered HTTP 200. | Probed | `curl` on 2026-09-22 |

The development host sits in the United States, where Bullish perpetuals are not offered, and the production API refuses it outright.
No proxy, VPN or other route around the refusal was tried.
The fee article, the product matrix and the funding, mark and index articles were read directly from this host.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDC-settled linear perpetuals (every Bullish perpetual) | -0.015 % = -150 ppm, a rebate | 0.020 % = 200 ppm | Published | S1, row "Delta 1 markets", "-1.5 / 2" bps, identical in the Individual and both Institution columns |

The fee article places "All perpetual futures and dated futures markets" in the Delta 1 category, S1.
The engine models a taker cross at the base tier, so 200 ppm is the number that matters.
Bullish has no VIP ladder for perpetuals, so VIP 0 here means the published schedule that every customer type pays.
The article also says "Bullish may choose at any time to implement a different schedule than shown for specific customers", and the rate shown at the time of trading, which a private call returns, takes precedence, S1.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USDC-settled linear perpetuals | yes | 22 on CoinGecko's production listing, 19 of them with a ticker. 22 enabled and 25 disabled on SimNext. The production catalog was refused. | S7, P2 |
| USDT, USD or coin-settled perpetuals | none seen | 0 of 47 SimNext perpetuals settle in anything but USDC, and every CoinGecko ticker targets USDC | P2, S7 |
| dated futures | yes, not detailed | 16 enabled on SimNext, 0 on CoinGecko's production listing | P2, S7 |
| options | yes, not detailed | 2,605 on SimNext | P2 |
| spot | yes, not detailed | 124 enabled on SimNext | P2 |

The CoinGecko production tickers on 2026-09-22 were `ADA`, `ARB`, `AVAX`, `BCH`, `BTC`, `CHZ`, `CMWTI`, `DOGE`, `DOT`, `ETH`, `GALA`, `LINK`, `LTC`, `NEAR`, `SHIB1M`, `SOL`, `TON`, `UNI` and `XRP`, each as `<base>-USDC-PERP`, S7.
BTC carried 84.6 million USD of the 24 h volume and ETH 11.3 million, and no other perpetual reached 0.15 million, S7.
The SimNext perpetual list differs from that production list, for example `SOL-USDC-PERP` and `XRP-USDC-PERP` are disabled on SimNext, so SimNext is not a stand-in for the production catalog.
Spot, margin, options and dated futures fees sit in the same article, S1, and deposit and withdrawal fees are listed further down that page.

## 4. Perpetual tiers

The schedule is quoted in basis points as maker / taker, S1, read on 2026-09-22, when the page's newest edit stamp was 2026-09-22 11:11 UTC.

| market type | Individual | Institution, SDS under 50 % | Institution, SDS 50 % to 100 % |
|---|---|---|---|
| Delta 1 markets (all perpetuals and dated futures) | -1.5 / 2 | -1.5 / 2 | -1.5 / 2 |
| Derivatives (OTC & Broker) (Perpetuals and Dated Futures) | 1.5 / 1.5 | 1.5 / 1.5 | 1.5 / 1.5 |
| Standard markets (spot), for comparison | 0 / 0.5 | 0 / 0.5 | 0 / [0.5 to 2.5] |

### Qualification

"Clients whose ADTV (calculated on active trading days) exceeds 0.01% of the Exchange's 12-month Average Daily Trading Volume are subject to the Institutional fee schedule", S1.
All other clients pay the Individual schedule, S1.
The Same Direction Score "only applies to standard markets", S1, so it never changes a perpetual fee.
A notice on the page says the changes that took effect on 2026-09-11 touched the Standard markets minimum taker and the Options fees, not Delta 1, S1.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | evidence |
|---|---|---|
| token holding | none published | S1 |
| referral | none published, and CCXT carries an empty `referral` URL at `server/node_modules/ccxt/js/src/bullish.js` line 151 | S1, S8 |
| market maker | the Delta 1 maker already earns 1.5 bps. Automated Market Making Instructions share taker fees and spread income with the exchange in 75:25, 90:10 or 100:0 splits, and "Automated Market Making Instructions can only be submitted by institutional customers." | S1 |
| promotional zero taker | the Promotional list names spot pairs only, and no perpetual appears in it | S1 |
| customer specific schedule | "Bullish may choose at any time to implement a different schedule than shown for specific customers" | S1 |

## 6. Funding as a cost

| item | value | evidence |
|---|---|---|
| interval | 1 hour. "Bullish Exchange runs on an hourly perpetual funding schedule." | S2 |
| snapshot of positions | "at the end of every hour" | S2 |
| formula | each minute k of 1 to 59: premium = (mark − index) / index, a ±2 bp dead zone subtracts 2 bp toward zero, a clamp to ±5 bp, then divided by 8. The final rate is the average of the 59 values. | S2 |
| cap and floor | ±0.625 bp per hour, "≈ 54.75% APR" | S2 |
| who pays | long pays when the rate is positive: "Funding Amount = -Funding rate x Notional Value of position in the Settlement Asset, if you are long" | S2 |
| settlement | "Funding Amounts are calculated and added to your unsettled P&L during the hourly settlement-to-market process. The unsettled P&L is then settled immediately afterwards." | S2 |
| outage | "Bullish Exchange may choose to set the funding rate to zero" when an hour lacks good data | S2 |
| settled history on SimNext | 24 hourly rows for `BTC-USDC-PERP`, each stamped `hh:59:59.999Z`, 18 at `-0.0000625` and 6 at `0` | P2 |

The SimNext rate of `-0.0000625` is the floor of -0.625 bp as a fraction, which fits a SimNext perpetual whose book sits far from a real world index, see [`rest.md`](./rest.md) section 4.
Why 6 of the hours read `0` is Not verified, and the documentation allows a zero rate for an hour without good data, S2.
The settlement instant itself was not captured, because the production API is refused and no probe waited on a clock event.

## 7. Liquidation, settlement and delisting

| charge | value | evidence |
|---|---|---|
| liquidation | "Any order sent by the automated liquidation engine will incur an additional fee of 50bps (0.5%) for any fills that arise from use of the engine." | S1 |
| hourly settlement | no fee, except interest when an unsettled loss is covered by an auto-borrow | S1, S4 |
| delayed settlement | an APR of twice the margin borrowing rate, or 50 % when the asset has no loan market, charged hourly on an unpaid loss | S1 |
| expiry | "No fees are charged for positions in derivative contracts that expire", which covers dated futures and options | S1 |
| delisting | Not publicly specified | |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` for a swap, no credentials | `0.001`, which is 1,000 ppm | P2, `ccxt_sandbox`, 47 of 47 SimNext swaps |
| `market.maker` | `0.001` | P2 |
| source | `'taker': this.parseNumber('0.001')` and `'maker': this.parseNumber('0.001')` under the comment `// todo check fees`, at `server/node_modules/ccxt/js/src/bullish.js` lines 230 to 232, with `'tierBased': false` at line 228 | S8 |
| copied into each market | `'taker': this.fees['trading']['taker']` at line 853 and `'maker'` at line 854 | S8 |
| against production | `loadMarkets` threw `ExchangeNotAvailable` on `GET /trading-api/v1/assets 403 Forbidden`, because CCXT loads currencies first | P1 |

CCXT's constant is five times the published taker and ignores the maker rebate.
The markets reply carries `feeGroupId` and a `feeTiers` list of `staticSpreadFee` values for Automated Market Making tiers, and neither is the trade fee, S5.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 200 | the published Delta 1 taker of 2 bps for every customer type, S1 |
| `ccxtTakerPpm` | 1,000 | CCXT 4.5.68 reports `0.001` on every swap, at `server/node_modules/ccxt/js/src/bullish.js` line 231 |

These values only matter once a host that Bullish serves runs the engine, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bullish Help Center, Understanding fees, edit stamp 2026-09-22 | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/9373547 | 2026-09-22 | all Bullish entities | schedule, Delta 1 row, qualification, SDS, liquidation, settlement, expiry, sections 1 to 7 |
| S2 | Bullish Help Center, Understanding funding, edit stamp 2026-08-11 | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/9373871 | 2026-09-22 | Bullish GI | funding interval, formula, cap, sign, settlement, section 6 |
| S3 | Bullish Help Center, Supported Assets, Products and Services, edit stamp 2026-09-04 | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/42041387 | 2026-09-22 | GI, HK, EU, US | product matrix by entity and customer type, section 1 |
| S4 | Bullish Help Center, What are Bullish perpetual futures? | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/9373825 | 2026-09-22 | Bullish GI | hourly settlement, margin prerequisite, footer exclusions, sections 1 and 7 |
| S5 | Bullish Trading API OpenAPI specification | https://docs.exchange.bullish.com/assets/files/bullish-trading-api-ed81ea9ddf394481dce1122ec500c9bf.yml | 2026-09-22 | global | `feeGroupId`, `feeTiers`, section 8 |
| S6 | Bullish, Crypto derivatives for institutions | https://www.bullish.com/us/derivatives | 2026-09-22 | Bullish GI | derivatives venue, regulators, section 1 |
| S7 | CoinGecko API, derivatives exchange `bullish-futures` with tickers | https://api.coingecko.com/api/v3/derivatives/exchanges/bullish-futures?include_tickers=all | 2026-09-22 | production listing | 22 perpetual pairs, 19 tickers, volumes, section 3 |
| S8 | CCXT 4.5.68 `bullish.js` | `server/node_modules/ccxt/js/src/bullish.js` | 2026-09-22 | CCXT | fee constants, market mapping, section 8 |
| S9 | Bullish GI Exchange Terms of Service, last updated 23 June 2026 | https://cdn.prod.website-files.com/67e428d18ac85216b5a9d0e4/6a3a7d07b9945c427cbafc9c_Bullish%20GI%20Exchange%20Terms%20of%20Service%20(23%20June%202026)%20.pdf | 2026-09-22 | Bullish GI | eligibility clauses 6.1.1, 6.1.2 and 6.2, Prohibited Jurisdictions definition, section 1 |
| P1 | `rest-probe.mjs access`, at 01:25 and 01:38 UTC on 2026-09-23, 18:25 and 18:38 local on 2026-09-22 | [`rest-probe.mjs`](../../../scripts/probes/venues/bullish/rest-probe.mjs) | 2026-09-22 | this host | production refusal, CCXT error, section 1 and 8 |
| P2 | `rest-probe.mjs sim`, at 01:25, 01:39 and 01:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bullish/rest-probe.mjs) | 2026-09-22 | this host, SimNext | SimNext catalog, CCXT sandbox mapping, funding history, sections 3, 6 and 8 |
