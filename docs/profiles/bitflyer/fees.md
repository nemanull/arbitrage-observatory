# bitFlyer Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 03:21 to 03:42 UTC), from the development host near Seattle.

This profile covers the one perpetual that bitFlyer (CCXT id `bitflyer`) lists, the bitFlyer Crypto CFD `FX_BTC_JPY`.
The fee page on `bitflyer.com` refused this host and the fetch tool, so every fee below comes from the Lightning pages, the API and CCXT, and what could not be read is marked Not verified.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| product | bitFlyer Crypto CFD, product code `FX_BTC_JPY`, market type `FX`, the successor of Lightning FX since 2024-03-28 | S1, S2 |
| legal entity | bitFlyer, Inc., crypto asset exchange registration Kanto Local Finance Bureau No. 00003, Financial Instruments Business Kanto Local Finance Bureau (FIBO) No. 3294 | S2 footer |
| counterparty | "Over-the-counter crypto asset derivatives are negotiated transactions between you and bitFlyer, Inc. which is the counterparty for you on those derivatives." | S2 footer |
| leverage | 2x for individual customers, a corporate maximum published by `GET /v1/getcorporateleverage`, which read `current_max` 12.23 on 2026-09-23 UTC | S2, P1 |
| region | the API documentation lists the Crypto CFD only for the Japan region. bitFlyer USA lists `BTC_USD`, `BTC_JPY`, `ETH_BTC` and bitFlyer Europe lists `BTC_EUR`, `BTC_JPY`, `ETH_BTC` | S1 section "Regions" |
| region, probed | `GET /v1/getmarkets/usa` and `/v1/getmarkets/eu` returned 4 Spot rows each and no `FX` row | P1 |
| who may trade | customers of bitFlyer, Inc. in its JP region. A residency rule for opening an account is Not verified, because the account and terms pages sit on `bitflyer.com`, which refused this host | S5 |
| US persons | the US region lists no Crypto CFD, see the region rows above | S1, P1 |

`bitflyer.com` closed the TLS session with "unexpected eof while reading" on every path tried from this host, including `/`, `/en-us/` and `/en-jp/commission`, and the fetch tool got HTTP 403 on `/en-jp/s/commission`, `/ja-jp/s/commission` and `/ja-jp/s/crypto-cfd`.
Whether that is a regional block or bot filtering is not known.
`lightning.bitflyer.com` and `api.bitflyer.com` answered this host with 200, see [`rest.md`](./rest.md) section 1.
No archive or mirror of the refused pages was used.

## 2. Quick answer

| family | maker | taker | ppm maker | ppm taker | source |
|---|---|---|---|---|---|
| Crypto CFD `FX_BTC_JPY`, JPY margined, linear | 0 % | 0 % | 0 | 0 | S2: "Currently, there are no fees for buying and selling on bitFlyer Crypto CFD." |

A position also pays leverage points, which the same page names without a rate: "Leverage points occur separately. For more information on leverage points, please refer to the bitFlyer Crypto CFD User Guide.", S2.
The leverage point rate is Not verified, because the user guide is on `bitflyer.com`.
The positions reply names it `swap_point_accumulate`, "Accumulated leverage points for the position.", S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual, JPY margined, BTC only | yes, 1 contract: `FX_BTC_JPY` | P1, `GET /v1/getmarkets` |
| perpetual, USDT, USDC or USD margined | no | P1, all three region lists |
| perpetual, coin margined | no | P1 |
| dated futures | no. CCXT still parses `Futures` rows such as `BTCJPY11FEB2022`, and none were listed | P1, `server/node_modules/ccxt/js/src/bitflyer.js` lines 273 to 279 and 320 to 341 |
| options | no | P1 |
| spot | yes: JP region 8 spot pairs (`BTC_JPY`, `XRP_JPY`, `ETH_JPY`, `XLM_JPY`, `MONA_JPY`, `ELF_JPY`, `ETH_BTC`, `BCH_BTC`), US and EU regions 4 each | P1 |

CoinGecko's derivatives API listed "Bitflyer (Futures)" with 1 perpetual, `FX_BTC_JPY`, and a 24 h volume of 1,101.45 BTC, about 95.5 million USD, with `index` null, on 2026-09-23 UTC, S7.

## 4. Perpetual tiers

No tier table exists for the Crypto CFD.
The only published trading fee is the flat zero of section 2, S2.
The Lightning spot schedule has volume tiers, which the survey scope names only here: the tier table sits on `bitflyer.com` and is Not verified.

## 5. Discounts that change the perpetual taker

None applies, since the taker is zero.
No token, referral or market maker programme for the Crypto CFD was found on the reachable pages.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | 8 h, 500 of 500 history rows 8 h apart | P1 `funding` |
| settlement instants | 05:00, 13:00 and 21:00 UTC, which is 14:00, 22:00 and 06:00 JST. 167, 166 and 167 of the 500 rows | P1 |
| when the rate is fixed | at `calculation_date`, 8 h before `settlement_date`, on all 500 rows. Each row's calculation instant is the previous row's settlement instant | P1, S1 |
| published rate | `current_funding_rate`, "Funding rate transfer ratio that will be collected or granted", which equalled the newest history row, whose settlement was the next one | S1, P1 |
| unit | a fraction per 8 h: `0.0001` is 0.01 % | S1, P1 |
| observed range | from 2026-04-09 to 2026-09-23: min -0.00073, max 0.00199, 316 positive, 9 zero, 175 negative, 279 rows exactly 0.0001, 64 distinct values, five decimal places | P1 |
| first row | calculated 2024-03-28 21:00 UTC, settled 2024-03-29 05:00 UTC, rate 0.00163 | P1 |
| formula, cap and floor | Not verified. The formula is on `bitflyer.com`, which refused this host. The share of rows at exactly 0.0001 suggests a default band, which is an inference | S5 |
| who pays | the documentation says the rate is "collected or granted", and the positions reply carries `funding_fees`, where "Negative values indicate amounts paid" and "positive values indicate amounts received". Which side pays at a positive rate is Not verified | S1 |

The settlement instant itself was not captured.
Because the rate is fixed a whole interval ahead, a position opened after the calculation instant knows exactly what it will pay or receive at the next settlement.

Lightning FX also charged an SFD, a "Special Fee for Deviation", which survives as the `sfd` field of the positions reply, S1.
Whether the Crypto CFD still charges it is Not verified.
The Crypto CFD instead suspends trading for about 5 minutes when an order would trade more than 5 % from the spot reference price, S3, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| margin rule | "Margin required for maintenance of position" is "Most recent spot trading price per unit of the applicable crypto asset on Lightning Spot × Position quantity × Margin rate." | S2 |
| position valuation | the CFD position is valued at "the most recent trading price on bitFlyer Crypto CFD" | S2 |
| margin call and sell out | named, with rules in the Crypto CFD Trading Rules on `bitflyer.com`, Not verified | S2 |
| liquidation fee | Not verified | S5 |
| BTC as margin | valued at 50 % of the Lightning Spot `BTC_JPY` last trade | S2 |
| sudden move breaker | trading suspends when a trade would move more than 15 % from the last trade 10 minutes earlier, and resumes by Itayose, a single price auction | S3 |
| delisting | no delisting of the only product is announced. `FX_BTC_JPY` "will remain as product_code for the time being" | S1 |

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `bitflyer`, no CCXT Pro class in 4.5.68 | `server/node_modules/ccxt/js/src/bitflyer.js`, and `server/node_modules/ccxt/js/src/pro/` has no bitflyer file |
| swap mapping | `market_type` `FX` becomes `type` `swap`, base and quote from the second and third parts of `FX_BTC_JPY` | `bitflyer.js` lines 303 and 316 to 318 |
| `market.taker` and `maker` for `FX_BTC_JPY` | 0 and 0, set for every contract | `bitflyer.js` lines 350 and 351, probed in P1 |
| settle | `JPY`, symbol `BTC/JPY:JPY` | `bitflyer.js` line 352, P1 |
| spot default | `fees.trading.taker` and `maker` 0.002 | `bitflyer.js` lines 138 to 143, P1 |
| authenticated fee | `fetchTradingFee` reads `commission_rate` from the private `gettradingcommission` and returns it as both maker and taker | `bitflyer.js` lines 638 to 660 |

CCXT's zero is the Crypto CFD fee of S2, so the constant and the published fee agree.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 0 | the published Crypto CFD trading fee is zero, S2. Leverage points are a holding cost and not a taker fee |
| `ccxtTakerPpm` | 0 | `market.taker` is 0 at `server/node_modules/ccxt/js/src/bitflyer.js` line 351 |

These values only matter if the venue is ever added, and [`rest.md`](./rest.md) section 8 explains why it is not addable as is.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | bitFlyer Lightning API Documentation | https://lightning.bitflyer.com/docs?lang=en | 2026-09-22 | bitFlyer, Inc., JP, US and EU regions | regions, product codes, funding calls, positions fields, sections 1, 2, 6 and 7 |
| S2 | What is bitFlyer Crypto CFD? | https://lightning.bitflyer.com/about-crypto-cfd?region=JP&lang=en | 2026-09-22 | bitFlyer, Inc., JP | zero trading fee, leverage points, 2x leverage, margin and valuation rules, entity and counterparty, sections 1, 2 and 7 |
| S3 | Circuit Breaker | https://lightning.bitflyer.com/docs/circuitbreaker?region=JP&lang=en | 2026-09-22 | bitFlyer, Inc., JP | 15 % sudden move breaker, 5 % divergence breaker, sections 6 and 7 |
| S4 | bitFlyer Lightning Realtime API | https://bf-lightning-api.readme.io/docs/realtime-api | 2026-09-22 | bitFlyer, Inc. | cited in [`websocket.md`](./websocket.md) |
| S5 | bitFlyer fees page, refused | https://bitflyer.com/en-jp/s/commission | 2026-09-22 | bitFlyer, Inc. | TLS closed from this host, HTTP 403 to the fetch tool, section 1 |
| S6 | CCXT 4.5.68 `bitflyer.js` | `server/node_modules/ccxt/js/src/bitflyer.js` | 2026-09-22 | CCXT | section 8 |
| S7 | CoinGecko derivatives exchange `bitflyer_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/bitflyer_futures?include_tickers=all | 2026-09-23 UTC | CoinGecko | contract count and volume, section 3 |
| P1 | `rest-probe.mjs catalog`, `latency`, `funding`, `book`, `errors` at 03:22 UTC, and the second pass `all` at 03:40 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitflyer/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3, 6 and 8 |
