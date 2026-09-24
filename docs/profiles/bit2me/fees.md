# Bit2Me Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 02:36 and 02:59 UTC on 2026-09-23.

Bit2Me has no class in CCXT 4.5.68, and it lists no tradable perpetual, no dated future and no option on 2026-09-22.
Its developer site documents a futures WebSocket for `BTCUSDC_PERP`, but no futures REST call, no futures instrument list and no futures fee schedule exist, and the documented socket stays silent exactly like a path that does not exist, see [`websocket.md`](./websocket.md) section 1.
This profile therefore covers the Bit2Me Pro spot market, as template change 1 of the venue survey plan says.
Deposit, withdrawal, card and Earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bit2me/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bit2me/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | BITCOINFORME, S.L., trading as Bit2Me, registered office in Elche, Alicante, Spain, N.I.F. B-54835301 | S2 |
| authorisation | authorised by the CNMV as a crypto-asset service provider under Regulation (EU) 2023/1114, for execution, reception and transmission, custody, exchange, transfer and placement | S4 |
| other registration | payment institution with the Banco de España, code 6947 | S4 |
| who may be a user | "Persons of legal age and with full capacity to contract", with tax residence in or subject to the jurisdiction of the territories listed at `https://bit2me.com/global` | S2 |
| accepted territories | 71 on 2026-09-22, from Andorra to Uruguay, among them 26 of the 27 EU member states, with Cyprus absent, and Switzerland, Norway, Argentina, Mexico, Brazil, India, Taiwan, Thailand, the United Arab Emirates and Puerto Rico | S3 |
| United States | not on the list of accepted territories, so a US resident may not become a user. Puerto Rico is listed separately | S3 |
| other absent territories | Canada, Japan, China, Russia, the United Kingdom and Singapore are not on the list | S3 |
| product scope | Bit2Me's own comparison page says "Bit2Me focuses on spot, Earn and Card under MiCA", dated 2026-07-01 | S5 |
| CoinGecko | trust rank 31, trust score 8, 3,547 BTC of 24 h volume, and no entry among 214 derivatives exchanges on 2026-09-22 | S11 |

Admission is "also subject to current regulations and internal policies of the company", S3.
Nothing public names a separate entity or terms for a futures product.

## 2. Quick answer

The Pro spot schedule at the lowest tier, 0 to 2,000 € of 30 day volume with no Space Center discount, S1.

| pair group | maker | taker | maker ppm | taker ppm |
|---|---:|---:|---:|---:|
| crypto against a stablecoin or EUR, such as BTC/USDC, BTC/EUR, B2M/EUR | 0.5 % | 0.6 % | 5,000 | 6,000 |
| EUR against USD, and a stablecoin as base, such as USDC/EUR, EURC/USDC | 0 % | 0.01 % | 0 | 100 |

The second row is flat at every volume, and "The volume traded in pairs based on a stablecoin does not count towards moving up a tier and reducing fees", S1.
The engine would cross crypto pairs, so 6,000 ppm is the number that matters.
That taker is 10 to 12 times the perpetual takers already in the registry, see section 9.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | no market, no documentation |
| USDC-margined perpetuals | documented, not live | the futures WebSocket description names `BTCUSDC_PERP` and `ETHUSDC_PERP`, S6. The socket answered nothing to three frame shapes in two runs, like a bogus path, and every guessed futures REST path returned 404 like a bogus path, P1 and P2 |
| coin-margined perpetuals | absent | |
| dated futures | absent | |
| options | absent | |
| spot, Bit2Me Pro | present | 287 markets on 2026-09-22, 281 `enabled` and 6 `frozen`, P1 |
| spot, Bit2Me Wallet brokerage | present | an app buy and sell service at its own price, outside the order book, S2 section on the Wallet service |
| margin or lending | a crypto-backed loan product only | S2, section on loans |
| deposit, withdrawal, card and Earn | not recorded | the lookup is the support centre, `https://support.bit2me.com/en/support/home` |

## 4. Spot tiers

### Crypto against a stablecoin or EUR

From S1, modified 2025-11-04.
Volume is the user's buys and sells over the last 30 days, "calculated in Euros", excluding stablecoin pairs.
The page writes each cell as taker over maker.

| 30 day volume | taker / maker, no discount | level 1 (-0.5 %) | level 4 (-15 %) | level 7 (-50 %) |
|---|---|---|---|---|
| 0 € to 2,000 € | 0.6 % / 0.5 % | 0.597 % / 0.497 % | 0.51 % / 0.425 % | 0.3 % / 0.25 % |
| 2,001 € to 50,000 € | 0.3 % / 0.2 % | 0.298 % / 0.199 % | 0.255 % / 0.17 % | 0.15 % / 0.1 % |
| 50,001 € to 250,000 € | 0.26 % / 0.16 % | 0.259 % / 0.159 % | 0.221 % / 0.136 % | 0.13 % / 0.08 % |
| 250,001 € to 500,000 € | 0.16 % / 0.08 % | 0.159 % / 0.08 % | 0.136 % / 0.068 % | 0.08 % / 0.04 % |
| 500,001 € to 1,000,000 € | 0.15 % / 0.06 % | 0.149 % / 0.06 % | 0.128 % / 0.051 % | 0.075 % / 0.03 % |
| 1,000,001 € to 5,000,000 € | 0.14 % / 0.04 % | 0.139 % / 0.04 % | 0.119 % / 0.034 % | 0.07 % / 0.02 % |
| 5,000,001 € to 25,000,000 € | 0.13 % / 0.03 % | 0.129 % / 0.03 % | 0.111 % / 0.025 % | 0.065 % / 0.015 % |
| 25,000,001 € to 75,000,000 € | 0.12 % / 0.02 % | 0.119 % / 0.02 % | 0.102 % / 0.017 % | 0.06 % / 0.01 % |
| 75,000,001 € to 250,000,000 € | 0.11 % / 0.01 % | 0.109 % / 0.01 % | 0.093 % / 0.009 % | 0.055 % / 0.005 % |
| over 250,000,001 € | 0.1 % / 0 % | 0.1 % / 0 % | 0.085 % / 0 % | 0.05 % / 0 % |

The page also lists levels 2, 3, 5 and 6 at -2.5 %, -7.5 %, -25 % and -37.5 %.
Corporate accounts get "different discounts" handled by a specialised department, S1.

### Stablecoin and EUR pairs

| 30 day volume | maker | taker |
|---|---:|---:|
| 0 € to 1,000,000,000 € | 0 % | 0.01 % |

This applies "only to currency pairs (EUR/USD) and stablecoins in the base currency (USDC/EUR, EURC/USDC, etc.)", S1.

### The fee fields on the wire

Every one of the 287 rows of `GET /v1/trading/market-config` carries `"feeMakerPercentage": 0` and `"feeTakerPercentage": 0` in both probe runs, P1.
Those fields do not match the published schedule, and their meaning is Not publicly specified, so neither the fields nor a zero fee should be read from them.

## 5. Discounts that change the spot taker

| discount | effect | source |
|---|---|---|
| Space Center loyalty level | -0.5 % at level 1 up to -50 % at level 7, applied to the tier's taker and maker, by the level at the moment of the trade | S1, S8 |
| Space Center qualification | levels are reached by buying and holding B2M, the page names 2,000 € of B2M for level 1 up to 230,000 € for level 7, and the amounts vary with other "missions" | S7 |
| referral, market maker, promotions | Not publicly specified on the fee page, and no dated zero fee promotion was found | S1 |

Paying the fee in B2M is not mentioned on the fee page, S1.

## 6. Funding as a cost

Not applicable.
Bit2Me Pro is spot, and it publishes no funding rate, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement on spot.
A market can be `frozen`, which "does not allow orders to be added or deleted", S6, and 6 markets were frozen on 2026-09-22, P1.
Delisting charges are Not publicly specified.

## 8. CCXT

| item | value | source |
|---|---|---|
| CCXT 4.5.68 class | none: `require('ccxt').exchanges` lists 104 ids, and the only near match is `bit2c`, a different venue | P1, `catalog` |
| CCXT master | none: `ts/src` on the `master` branch lists 112 files, and the only near match is `bit2c.ts` | S9, listed 2026-09-22 |
| open pull request | ccxt/ccxt #22639 "New Exchange: Bit2Me", opened 2024-05-28 by the venue's `bit2me-devs` fork, unmerged, last updated 2026-05-15 | S9 |
| open issue | ccxt/ccxt #26464 "Add Bit2Me exchange", opened 2025-07-21 | S10 |
| `market.taker` | none, since there is no class | |

The unmerged class sets `'swap': false` and describes spot only, at `ts/src/bit2me.ts` line 29 of commit `487634d` in S9.
Its default fee is `'taker': this.parseNumber ('0.0026')` and `'maker': this.parseNumber ('0.0016')` at lines 148 and 149, which is the third tier and not the 0.6 % base tier.
Its own tier table starts at 0.006 taker and 0.005 maker, lines 150 to 174, which matches S1.

## 9. Recommended registry values

None.
Bit2Me cannot join the engine as a perpetual leg: it lists no perpetual, and CCXT 4.5.68 has no class to load a catalog from.
If a spot leg were ever modelled, `takerPpm` would be 6,000 from S1, and `ccxtTakerPpm` would have nothing to declare.
If the unmerged class ships as it stands, it would report 2,600 ppm, which understates the base taker by 3,400 ppm, so `takerPpm` would have to override it.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bit2Me Pro fees and limits, modified 2025-11-04 | https://support.bit2me.com/en/support/solutions/articles/35000172197-what-are-the-fees-for-the-bit2me-pro-service- | 2026-09-22 | Bit2Me, global | sections 2, 4, 5 |
| S2 | General terms and conditions of Bit2Me services, modified 2025-11-06 | https://legal.bit2me.com/en/support/solutions/articles/35000292850-general-terms-and-conditions-of-bit2me-services | 2026-09-22 | BITCOINFORME, S.L. | entity, user eligibility, services, sections 1 and 3 |
| S3 | Supported countries | https://bit2me.com/global | 2026-09-22 | Bit2Me, global | the 71 accepted territories, section 1 |
| S4 | About Bit2Me | https://bit2me.com/about | 2026-09-22 | BITCOINFORME, S.L. | CNMV and Banco de España registrations, section 1 |
| S5 | Alternative to Bybit in 2026, dated 2026-07-01 | https://bit2me.com/alternatives/bybit | 2026-09-22 | Bit2Me | product scope, section 1 |
| S6 | Bit2Me API documentation and its OpenAPI files `futures-websockets.json`, `trading-spot-rest.json`, `trading-spot-websockets.json` | https://api.bit2me.com/ | 2026-09-22 | Bit2Me | futures socket description, market status enum, sections 3 and 7 |
| S7 | Space Center | https://bit2me.com/space-center | 2026-09-22 | Bit2Me | level requirements, section 5 |
| S8 | Benefits in Bit2Me Pro with Space Center, modified 2025-08-26 | https://support.bit2me.com/en/support/solutions/articles/35000251978 | 2026-09-22 | Bit2Me | discount by level, section 5 |
| S9 | ccxt/ccxt pull request #22639 and the `ts/src` listing on `master` | https://github.com/ccxt/ccxt/pull/22639 | 2026-09-22 | CCXT | no class in master, the unmerged class and its fee constants, section 8 |
| S10 | ccxt/ccxt issue #26464 | https://github.com/ccxt/ccxt/issues/26464 | 2026-09-22 | CCXT | the open request, section 8 |
| S11 | CoinGecko API `exchanges/bit2me` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/bit2me | 2026-09-22 | CoinGecko | rank, volume, no derivatives entry, section 1 |
| P1 | `rest-probe.mjs catalog`, `book`, `errors`, `futures`, and `all` in the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2me/rest-probe.mjs) | 2026-09-22, 02:47 and 02:54 UTC on 2026-09-23 | this host | catalog, fee fields, futures paths, CCXT list |
| P2 | `ws-probe.mjs futures`, two runs | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2me/ws-probe.mjs) | 2026-09-22, 02:52 and 02:58 UTC on 2026-09-23 | this host | the silent futures socket, section 3 |
