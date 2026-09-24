# Delta Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 21:12 and 21:42 Pacific time, which is 2026-09-23 04:12 to 04:42 UTC.

This profile covers the perpetual fees of Delta Exchange global (CCXT id `delta`), which CoinGecko lists as "Delta Exchange (Futures)" and as "Delta Exchange" spot, at trust rank 124 in the survey list and 128 in the CoinGecko API on 2026-09-23 UTC, S10.
Delta Exchange global lists perpetuals, so its one perpetual family is researched and spot is only named in the coverage matrix.
The brand runs two platforms on two hosts: Delta Exchange global at `global.delta.exchange` and `api.delta.exchange`, which CCXT's `delta` class reaches, and Delta Exchange India at `www.delta.exchange` and `api.india.delta.exchange`, which no CCXT 4.5.68 class reaches.
`https://www.delta.exchange/fees`, the fee URL in CCXT at `server/node_modules/ccxt/js/src/delta.js` line 129, served the India fee page to this host on 2026-09-22.
The global fee page is `https://global.delta.exchange/fees`, S1, and its numbers were read from the `tradingFeesData` block embedded in the page, which the rendered table repeats.
Access results are from this laptop's Surfshark WireGuard exit, which geolocates to Canada, and every page and every well-formed API call answered with 200.

## 1. Scope and freshness

| item | value |
|---|---|
| retrieved | 2026-09-22 Pacific, 2026-09-23 UTC |
| global operator | Bit Protocol S.A, "a company incorporated in Panama, which is a 100% owned subsidiary of Protocol Labs Pte Ltd, a company incorporated in Singapore", S2 |
| global law | the laws of Panama, S2 |
| excluded from global, citizens or residents | United States of America, including Puerto Rico and the U.S. Virgin Islands, Afghanistan, Russia, Iran, North Korea, S2 |
| excluded from global, residents or persons located there | India, Cambodia, Crimea, Cuba, Canada, Syria, St Vincent & the Grenadines, Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia, Czech Republic, Denmark, Estonia, Finland, France, France Metropolitan, French Guiana, Germany, Greece, Hungary, Iceland, Ireland, Italy, Latvia, Liechtenstein, Lithuania, Luxembourg, Malta, Netherlands, Norway, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden, United Kingdom, United Arab Emirates, S2 |
| partly excluded from global | Hong Kong persons may not trade spot, Singapore natural persons are excluded and Singapore legal persons may not trade spot, S2 |
| US persons | may not trade, S2 |
| India operator | Excelium Technologies Private Limited, "a FIU (Govt. of India) registered entity", S7 |
| who may use India | "only to eligible natural persons and legal entities that are residents of India", S8 |
| access from this host | the global fee page, terms, public REST and both public sockets answered from the Canadian exit without a refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 |

Canada is on the global exclusion list, so the exit this host uses is itself a region whose residents may not trade.

## 2. Quick answer

| family | VIP 0 taker | VIP 0 maker | taker ppm | maker ppm | source |
|---|---:|---:|---:|---:|---|
| BTC and ETH perpetuals, orders through the API | 0.03 % | 0.03 % | 300 | 300 | S1 row "BTC & ETH Futures - API", and `product_specs.api_taker_commission_rate` 0.0003 on both, P1 |
| SOL, XRP and DOGE perpetuals, API or not | 0.03 % | 0.03 % | 300 | 300 | S1 row "USDT Linear Futures(excluding BTC & ETH)", and `taker_commission_rate` and `api_taker_commission_rate` 0.0003, P1 |
| PAXG perpetual | 0.02 % in the catalog, 0.03 % on the fee page | 0.02 % in the catalog | 200 in the catalog | 200 in the catalog | `taker_commission_rate` and `api_taker_commission_rate` 0.0002, P1, against S1 |
| BTC and ETH perpetuals, orders outside the API | 0.01 % | 0.01 % | 100 | 100 | S1 row "BTC & ETH Futures - Non API", and `taker_commission_rate` 0.0001, P1 |

The engine would trade through the API, so its number is 300 ppm on five perpetuals and 200 ppm on PAXGUSDT.
Maker equals taker on every row, and no maker rebate is published.

## 3. Coverage matrix

| product | Delta Exchange global | note |
|---|---|---|
| USDT-settled linear perpetuals | present, 6 live: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, DOGEUSDT, PAXGUSDT | researched here, P1 |
| USDC-settled or coin-settled perpetuals | absent | P1 |
| dated futures | absent from the catalog on 2026-09-23 UTC | P1 |
| options | present, 190 calls, 188 puts, 12 binary calls, 12 binary puts | P1 |
| spot | present, 6 pairs: BTC_USDT, ETH_USDT, SOL_USDT, XRP_USDT, USDC_USDT, DETO_USDT | taker and maker 0.075 %, S1 |
| Delta Exchange India perpetuals | a separate platform: 220 live perpetuals quoted and settled in USD, taker 0.05 % and maker 0.02 % plus 18 % GST, residents of India only | S7, S8 and P1. Not reachable through CCXT 4.5.68 |

## 4. Perpetual tiers

The global fee page publishes one flat row per product group and no volume tiers, S1.

| row on S1 | taker | maker | settlement fee | liquidation factor |
|---|---:|---:|---:|---:|
| BTC & ETH Futures - Non API | 0.01 % | 0.01 % | 0.01 % | 0.2 |
| BTC & ETH Futures - API | 0.03 % | 0.03 % | 0.03 % | 0.2 |
| USDT Linear Futures(excluding BTC & ETH) | 0.03 % | 0.03 % | 0.03 % | 0.2 |
| Options | 0.015 % | 0.015 % | 0.015 % | 0.5 |
| Spot | 0.075 % | 0.075 % | NA | |

The page's heading promises "Attractive rebates and volume-based discounts", and no rebate or volume table appears on it.
The catalog carries the same two rates per perpetual, `taker_commission_rate` for orders outside the API and `product_specs.api_taker_commission_rate` for API orders, P1.
They agree with S1 on BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT and DOGEUSDT, and PAXGUSDT reads 0.0002 in both fields where S1 says 0.03 %.
CCXT carries an older tier table, 0.15 % down to 0.065 % taker over seven volume steps, at `server/node_modules/ccxt/js/src/delta.js` lines 200 to 227, which matches nothing on S1.

### Qualification

Not publicly specified, since no tier exists on S1.
How Delta tells an API order from a web order is Not publicly specified.

## 5. Discounts that change the perpetual taker

| discount | what S1 says | value |
|---|---|---|
| paying fees in DETO | "Enjoy {{percentage}}% discount when you pay fees in DETO", a template string in the page | Not publicly specified |
| Delta Cash | "You can use this to pay upto {{tradingFeeDiscount}}% of the trading fee per trade", a template string | Not publicly specified |
| referral code | "{{discountPercentage}}% discount in trading fees applied!", a template string | Not publicly specified |
| market maker program | the user guide has a Market Makers' Guide, S5 | not read for rates |
| zero fee promotion | none on S1 | |

Every discount on S1 is a placeholder filled per account, so none changes the public VIP 0 number.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | `Avg. Premium + clamp(Interest Rate − Avg. Premium, 0.05 %, −0.05 %)`, the premium `(Mark − Index) / Index` measured each minute and averaged over the interval | S3 |
| interest rate | 0.01 % per 8 h | S3 |
| clamp | ±0.05 %, `product_specs.funding_clamp_value` 0.05 on all six | S3, P1 |
| weighting | `funding_twap_linear_weighted_enabled` true on all six | P1 |
| interval | 8 h on five perpetuals, 4 h on PAXGUSDT | `product_specs.rate_exchange_interval` 28800 and 14400, P1 |
| settlement times | 00:00, 08:00 and 16:00 UTC for 8 h contracts | S3 |
| cap | `annualized_funding`, the "Maximum allowed annualized funding rate": 10.95 on BTCUSDT and ETHUSDT, 21.9 on XRPUSDT and DOGEUSDT, 200 on SOLUSDT, 43.8 on PAXGUSDT | S4, P1 |
| cap per interval, derived | 1 % per 8 h on BTCUSDT and ETHUSDT, 2 % on XRPUSDT and DOGEUSDT, 18.3 % on SOLUSDT, 2 % per 4 h on PAXGUSDT | annual cap × interval / 8,760 h |
| who pays | longs pay shorts when positive, shorts pay longs when negative, peer to peer, "Faida does not charge any fees on funding" | S3 |
| base | the position value at the index price at the settlement | S3 |
| who is charged | every position in the snapshot the matching engine takes at the settlement, whatever its holding time | S3 |
| history | changed from a minute-by-minute exchange to three settlements a day at 12:00 UTC on 2025-09-08 | S3 |

The user guide at `guides.delta.exchange` is now titled "Faida - User Guide & Rule Book" and names the exchange Faida in its text, while the global site and terms still say Delta Exchange.
The published `funding_rate` is in percent and is a running estimate for the interval in progress, see [`rest.md`](./rest.md) section 4.
S3 says the rate charged at a settlement is the average over the 8 h before it, and its worked example charges the average of the interval before that.
Which of the two is charged was not determined here, because no settlement instant was captured.

## 7. Liquidation, settlement and delisting

- Liquidation: a position whose liquidation fill beats the bankruptcy price pays a liquidation charge from its remaining margin, S6, and S1 states it as maintenance margin times the liquidation factor, 0.2 for every perpetual row and `liquidation_penalty_factor` "0.2" on BTCUSDT, P1.
  Partial liquidation deducts a charge equal to the minimum maintenance margin from the partial position's margin, S6.
- Settlement fee: S1 lists 0.01 % and 0.03 % "applies to all open contracts at the time of settlement", which concerns contracts that expire, so it does not apply to a perpetual that is never settled.
- Delisting: no charge is published, and no perpetual was delisting on 2026-09-23 UTC.

## 8. CCXT

| item | value |
|---|---|
| class | `delta`, CCXT 4.5.68, `server/node_modules/ccxt/js/src/delta.js` |
| `market.taker` without credentials | the product's `taker_commission_rate`, line 933, which is the rate for orders outside the API: 0.0001 on BTC/USDT:USDT and ETH/USDT:USDT, 0.0002 on PAXG/USDT:USDT, 0.0003 on SOL/USDT:USDT, XRP/USDT:USDT and DOGE/USDT:USDT, P1 |
| `market.maker` | `maker_commission_rate`, line 934, the same numbers |
| class constant | `fees.trading.taker` 0.0015 and `maker` 0.0010, lines 204 and 205, not used for these markets because the market field wins |
| API rate | `product_specs.api_taker_commission_rate`, which CCXT does not read |
| CCXT Pro | no `delta` class in `server/node_modules/ccxt/js/src/pro/` |

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 300 | the API rate on S1 for BTC, ETH and the other linear perpetuals, and `api_taker_commission_rate` on five of six, and it overstates PAXGUSDT's catalog rate by 100 ppm |
| `ccxtTakerPpm` | none | CCXT reports 100, 200 and 300 on different markets, and no single constant describes them |
| `ignoreCcxtTakerPpm` | true | CCXT's number is the web rate and not the rate the engine's orders would pay, so no market should be compared |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees - Delta Exchange Global | https://global.delta.exchange/fees | 2026-09-22 | Delta Exchange global | fee rows, settlement fee, liquidation factor, discount templates, sections 2, 4, 5 and 7 |
| S2 | Terms of Use, Delta Exchange Global | https://global.delta.exchange/terms-of-use | 2026-09-22 | Bit Protocol S.A, Panama | operator, law, restricted locations, section 1 |
| S3 | Perpetual Contracts Guide | https://guides.delta.exchange/delta-exchange-user-guide/derivatives-guide/docs | 2026-09-22 | Delta Exchange global, titled Faida | funding formula, interest, clamp, times, snapshot, the 2025-09-08 change, section 6 |
| S4 | Delta Exchange Global API documentation, Product schema, Wayback Machine capture of 2026-01-30 | https://web.archive.org/web/20260130043054/https://docs-global.delta.exchange/ | 2026-09-22 | Delta Exchange global | `annualized_funding` and `basis_factor_max_limit` descriptions, section 6 |
| S5 | Faida - User Guide & Rule Book, page index | https://guides.delta.exchange/delta-exchange-user-guide/llms.txt | 2026-09-22 | Delta Exchange global | the guide's title and the Market Makers' Guide, sections 5 and 6 |
| S6 | Liquidation of Isolated Margined Positions | https://guides.delta.exchange/delta-exchange-user-guide/trading-guide/margin-explainer/margin-explainer/liquidation | 2026-09-22 | Delta Exchange global | liquidation charge, section 7 |
| S7 | Fees - Delta Exchange India | https://www.delta.exchange/fees | 2026-09-22 | Delta Exchange India | India futures fees, GST, operator, sections 1 and 3 |
| S8 | Terms of Use, Delta Exchange India | https://www.delta.exchange/terms-of-use | 2026-09-22 | Delta Exchange India | residents of India only, section 1 |
| S9 | CCXT 4.5.68 `delta.js` | `server/node_modules/ccxt/js/src/delta.js` | 2026-09-22 | CCXT | fee URL, tier table, market fee fields, sections 4 and 8 |
| S10 | CoinGecko exchange list and `delta_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/delta_futures | 2026-09-22 | CoinGecko | listing names, introduction |
| P1 | `rest-probe.mjs catalog` at 04:13 and 04:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/delta/rest-probe.mjs) | 2026-09-23 UTC | this host | per product fee fields, funding settings, CCXT `market.taker`, sections 2 to 4 and 6 to 8 |
