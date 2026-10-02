# Phemex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 (2026-09-23 UTC), from the development host near Seattle.

This profile covers the trading fees of Phemex (CCXT id `phemex`) on its perpetual contracts.
The researched product is the USDⓈ-M perpetual family, and USDT-M is the leg the engine would trade.
The public API and the fee page answered this host, see [`rest.md`](./rest.md) section 1.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22, probes at 03:14 to 03:39 UTC on 2026-09-23 | P1, and the probes of [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md) |
| legal entity named in the terms | "PHEMEX POLAND SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", Katowice, Poland, listed as one of the entities that "Phemex Entity includes, but is not limited to" | S4, terms updated Jul 10, 2025 |
| who may trade the perpetuals | anyone who passes KYC and is not a citizen, resident of, or located in a Restricted Territory | S4 |
| excluded regions | United Arab Emirates, United States of America, United Kingdom, Ontario, Québec, Alberta and Saskatchewan in Canada, Afghanistan, Angola, Australia, Burundi, Central African Republic, China, Cuba, Crimea, Democratic Republic of the Congo, Ethiopia, Eritrea, Guinea, Guinea-Bissau, Haiti, Hong Kong, India, Iraq, Iran, Ivory Coast, Lebanon, Liberia, Libya, Mali, Myanmar, Nicaragua, North Korea, Palestine, Republic of Seychelles, Rwanda, Sierra Leone, Somalia, South Africa, South Sudan, Sudan, Syria, Venezuela, Yemen, Zimbabwe | S4 |
| US persons | may not trade: the user declares they are not a "specified U.S. Person", a U.S. citizen, a Green Card holder or a U.S. tax resident | S4 |
| public data from this host | every public REST call and the public socket answered, with no geoblock | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The terms page, the fee page and the API documentation all answered this host with HTTP 200.
The fee page renders its table in the browser, so it was read once through a headless Chrome render on 2026-09-22, S1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDⓈ-M perpetuals, USDT-M and USDC-M | 0.0100 % = 100 ppm | 0.0600 % = 600 ppm | S1 rendered on 2026-09-22, S2, S3 |
| COIN-M perpetuals | 0.0100 % = 100 ppm | 0.0600 % = 600 ppm | S1 and S2 publish one futures table and S3 names no per family rate |

The fee page names the base level "Standard", and the help center calls the same row "VIP 0", S1 and S2.
No published source gives a separate rate for USDC-M, COIN-M or the TradFi contracts, so the one futures table is taken to apply to all of them.
The per contract rate is behind authentication: `GET /api-data/futures/fee-rate?settleCurrency=USDT` answered 401 `{"code": "401","msg": "401 Miss Api Key."}` to this host, P1.

## 3. Coverage matrix

| product | present | active count on 2026-09-23 | note |
|---|---|---|---|
| USDT-M perpetuals | yes | 116 listed, 765 delisted | 45 crypto, 69 TradFi (stocks, indices, metals, energy), 2 pre-market (`ANTHROPICUSDT`, `OPENAIUSDT`), P1 |
| USDC-M perpetuals | yes | 10 listed | BTC, ETH, AVAX, LINK, SUI, ADA, XRP, SOL, AAVE and UNI, each also listed on USDT-M, P1 |
| COIN-M perpetuals, inverse | yes | 8 listed | `BTCUSD` and `cETHUSD`, `cSOLUSD`, `cXRPUSD`, `cADAUSD`, `cSUIUSD`, `cLINKUSD`, `cAVAXUSD`, each worth 1 USD and settled in its base coin, P1 |
| USD-settled linear perpetuals, the old model | no | 0 listed, 151 delisted | P1 |
| dated futures | no | none in the product catalog | P1 |
| options | no | none in the product catalog | P1 |
| spot | yes | 177 listed, 841 delisted | not researched here |

The catalog lists 134 perpetuals, and CoinGecko's derivatives page shows 137 perpetual pairs for Phemex (Futures) on 2026-09-22.

## 4. Perpetual tiers

One table covers every futures contract, S1 rendered on 2026-09-22 and S2 updated Feb 12, 2025.
The two sources agree on every rate.

| level | 30-day futures volume, USD | asset balance, USD | vePT balance | maker | taker | taker ppm |
|---|---|---|---|---|---|---:|
| Standard (VIP 0) | under 8M | under 50K | under 32K | 0.0100 % | 0.0600 % | 600 |
| VIP 1 | 8M to 18M, API at most 20 % | from 50K | from 32K | 0.0080 % | 0.0550 % | 550 |
| VIP 2 | 18M to 45M, API at most 20 % | from 150K | from 70K | 0.0060 % | 0.0500 % | 500 |
| VIP 3 | 45M to 85M, API at most 20 % | from 350K | from 140K | 0.0040 % | 0.0450 % | 450 |
| VIP 4 | 85M to 180M, API at most 20 % | from 1M | from 320K | 0.0020 % | 0.0375 % | 375 |
| VIP 5 | 180M to 380M, API at most 20 % | from 2M | from 700K | 0.0010 % | 0.0350 % | 350 |
| Star VIP | from 380M, API at most 20 % | | | 0.0000 % | 0.0300 % | 300 |
| Pro 1 | 8M to 100M, API over 20 % | | | 0.0000 % | 0.0475 % | 475 |
| Pro 2 | 100M to 380M, API over 20 % | | | 0.0000 % | 0.0450 % | 450 |
| Pro 3 | 380M to 1.5B, API over 20 % and 70 % maker | | | 0.0000 % | 0.0350 % | 350 |
| Pro 4 | from 1.5B, API over 20 % and 70 % maker | | | 0.0000 % | 0.0325 % | 325 |

The volume bands with upper bounds and the maker share on Pro 3 and Pro 4 are from the rendered fee page, S1.
S2 gives Star VIP as N/A in every column and the Pro levels only a lower volume bound.

### Qualification

- "Traders are only required to meet one of the criteria to unlock the fee discount of the respective VIP Level.", S2.
- The API share decides the ladder: at most 20 % API volume climbs the VIP ladder, and more than 20 % climbs the Pro ladder, S1 and S2.
- "If the trading volume from API trading or spot trading volume exceeds 20%, the associated benefits of the rules will be applicable to", and the sentence is cut off on the rendered page, S1.
- Levels are "calculated based on metrics everyday at 0:00 UTC", S1, while S2 says "The VIP level will be updated daily at 7AM UTC".
- Futures volume is the sum of daily futures volume for the past 30 days, and sub-accounts share the main account's volume, balances and rates, S1.
- "Institutional clients are not eligible to receive the benefits outlined of Standard~Star VIP in these rules", S1.

## 5. Discounts that change the perpetual taker

| discount | effect on the futures taker | source |
|---|---|---|
| PT, the Phemex token, used to pay fees | 10 % off futures fees, 20 % off spot | S1, the "PT Discount" row |
| referral | CCXT carries a referral code with `discount: 0.1` at `server/node_modules/ccxt/js/src/phemex.js` lines 133 to 136, and no Phemex page read here states a referral fee discount | S10 |
| market maker program | "up to 0.005% in maker fee rebate", maker side only | S2 |
| TradFi zero fee promotion | 0 % maker and taker on "Selected Tradfi Futures" from "February 05, 2026, 11:00 – May 05, 2026, 11:00 (UTC)", ended | S9 |
| other promotions | "These rates do not apply to a few select currencies during special promotion periods. Refer to fees on actual transaction records as final" | S1 |

No active zero fee promotion on perpetuals was found on 2026-09-22.
Which contracts a "select currencies" exception covers cannot be read without an API key, section 2.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate (F) = Premium Index (P) + clamp (Interest Rate (I) – Premium Index (P), 0.05%, -0.05%)" | S5, updated Mar 26, 2025 |
| premium index | "{[Max (0, Impact Bid Price – Price Index) – Max (0, Price Index – Impact Ask Price)]} / Price Index", sampled every minute and averaged over the interval | S5 |
| interest rate | 0.01 % per 8 h by the formula, and `interestRate` read `0.0001` on 49 rows, all 8 h, `0.00005` on 17 rows, 16 of them 4 h, and `0` on 68 rows | S5, P1 |
| interval | 8 h on 96 USDⓈ-M contracts and all 8 COIN-M, 4 h on 30 USDⓈ-M contracts | P1 |
| settlement instants | 00:00, 08:00 and 16:00 UTC for 8 h, and the 4 h history of `TSLAUSDT` shows 12:00, 16:00, 20:00 and 00:00 UTC | S5, P1 |
| cap and floor | per contract in `fundingRateCap` and `fundingRateFloor`: ±2 % on 106 of 134 rows, ±3 % on 8, ±0.375 % on 3 (`BTCUSD`, `XAUUSDT`, `XAGUSDT`), ±0.02 % on 14 TradFi and pre-market rows, ±1 % on `BNBUSDT`, ±1.5 % on `NGUSDT`, ±0.01 % on `PAXGUSDT` | P1 |
| who pays | "Positive rates mean longs pay shorts", and "You only pay/receive funding if holding a position at these timestamps" | S5 |
| amount | "Funding Fee = Position Value x Funding Rate", with a linear position value of quantity times mark price | S6 |
| changes | "Phemex reserves the right to update the funding rate floor and cap, as well as the funding interval" in extreme volatility | S6, updated Apr 22, 2024 |

The published rate is the running estimate for the next settlement, not the last settled one.
At 03:15 UTC on 2026-09-23 `BTCUSDT` read `-0.00000326` for the 08:00 UTC settlement while the funding history had settled `-0.00003988` at 00:00 UTC, P1.
The settlement instant itself was not captured, so whether the last estimate equals the settled rate is Not verified.

## 7. Liquidation, settlement and delisting

- No liquidation fee, settlement fee or delisting charge is stated in S1, S2, S3 or the liquidation help article read on 2026-09-22, S8.
- The product catalog marks delisted contracts with `status` `Delisted`, and `/public/products-plus` carries the list time in `timeline[1]` and the delist time in `timeline[3]`, S7.
- `LSKUSDT` was `Delisted` in the catalog and still served a ticker and a book on 2026-09-23, see [`rest.md`](./rest.md) section 2.

## 8. CCXT

| market | `market.taker` without credentials | `market.maker` | why |
|---|---|---|---|
| USDT-M, 116 active, for example `BTC/USDT:USDT` | `undefined` | `undefined` | `parseSwapMarket` reads `takerFeeRateEr` at `server/node_modules/ccxt/js/src/phemex.js` line 755, the `perpProductsV2` rows carry no fee field (0 of 126), and the `undefined` overrides the class default |
| USDC-M, 10 active | `undefined` | `undefined` | same line |
| `BTCUSD`, COIN-M | 0.0075, 7,500 ppm | -0.0025 | `takerFeeRateEr` 750000 from the legacy `/exchange/public/products` list of 15 old contracts, read at line 1051 and merged into the swap row at lines 1098 and 1108 to 1109 |
| the 7 `c…USD` COIN-M contracts | `undefined` | `undefined` | not in the legacy list |

The class default is `taker: 0.001` and `maker: 0.001` at `server/node_modules/ccxt/js/src/phemex.js` lines 311 to 318, and no market reports it, P1.
The engine's connector drops a market with no taker fee unless the registry sets `takerPpm`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 162 to 166.
So without a registry `takerPpm`, every USDT-M market would be skipped.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 futures taker, S1 and S2, and CCXT reports no number for any USDⓈ-M market |
| `ccxtTakerPpm` | unset | CCXT reports `undefined` on every USDT-M market, so the connector has nothing to compare |
| `marketFilter` | `market.linear === true && market.settle === 'USDT'` | keeps the 116 USDT-M contracts, drops the 8 inverse COIN-M contracts whose size unit is 1 USD, and drops the 10 USDC-M twins whose CCXT `contractSize` is 0, see [`rest.md`](./rest.md) section 2 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees & Conditions, rendered once by headless Chrome from this host | https://phemex.com/fees-conditions | 2026-09-22 | Phemex, global | futures tier table with volume bands, PT discount, qualification notes, sections 2, 4 and 5 |
| S2 | Phemex Trading Fee Structure, updated Feb 12, 2025 | https://phemex.com/help-center/phemex-trading-fee-structure | 2026-09-22 | Phemex, global | futures and spot tiers with balance and vePT columns, one criterion rule, 7 AM update, market maker rebate, sections 4 and 5 |
| S3 | Phemex Futures Fee Structure & Fee Calculations, updated Apr 22, 2024 | https://phemex.com/help-center/Phemex-Future-fee-structure-and-calculation | 2026-09-22 | Phemex, global | "0.01% maker fee and a 0.06% taker fee for contracts", section 2 |
| S4 | Phemex Terms of Use, updated Jul 10, 2025, fetched from this host with HTTP 200 | https://phemex.com/help-center/phemex-terms-of-use | 2026-09-22 | Phemex Poland sp. z o.o. | entity, Restricted Territories, US person declaration, section 1 |
| S5 | How are Funding Rates calculated?, updated Mar 26, 2025 | https://phemex.com/help-center/how-are-funding-rates-calculated | 2026-09-22 | Phemex, global | funding formula, clamp, instants, direction, section 6 |
| S6 | Introduction to Phemex Futures Funding Rate, updated Apr 22, 2024 | https://phemex.com/help-center/Introduction-to-phemex-futures-funding-rate | 2026-09-22 | Phemex, global | funding fee amount, right to change cap and interval, section 6 |
| S7 | Phemex API documentation, USDⓈ-M Perpetual Rest API | https://phemex-docs.github.io/ | 2026-09-22 | Phemex, global | `products-plus` timeline fields, fee-rate endpoint, section 7 |
| S8 | How to Reduce Chances of Liquidation, updated Apr 30, 2024 | https://phemex.com/help-center/how-to-reduce-chances-of-liquidation | 2026-09-22 | Phemex, global | no liquidation fee stated, section 7 |
| S9 | Tradfi Futures Zero Fee announcement, Feb 5, 2026 | https://phemex.com/announcements/tradfi-futures-zero-fee-maker-taker-fees-0 | 2026-09-22 | Phemex, global | ended TradFi promotion, section 5 |
| S10 | CCXT 4.5.68 `phemex.js` | `server/node_modules/ccxt/js/src/phemex.js` | 2026-09-22 | CCXT | fee constants and market parsing, section 8 |
| P1 | `rest-probe.mjs main` at 03:14 and 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/phemex/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog counts, funding fields, CCXT market fees, the 401 on the fee-rate call, sections 2, 3, 6 and 8 |
