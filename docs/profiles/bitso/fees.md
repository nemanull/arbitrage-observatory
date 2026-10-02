# Bitso Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 01:18 to 01:31 UTC, and the second pass 01:39 to 01:48 UTC, from the development host near Seattle.

Bitso (CCXT id `bitso`) is a Latin American spot exchange with a spot margin wallet and no perpetual order book of its own.
This profile therefore covers Bitso spot, as the survey plan's template change 1 asks, and names every other product in the coverage matrix.
Deposit, withdrawal and conversion fees are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitso/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitso/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| CoinGecko listing | "Bitso", country Gibraltar, established 2014, trust score 8, trust score rank 20, 42 tickers, 224.56 BTC of 24 h volume | Probed | S11, `https://api.coingecko.com/api/v3/exchanges/bitso` |
| CoinGecko derivatives list | no entry whose id or name matches `bitso` | Probed | S11, `https://api.coingecko.com/api/v3/derivatives/exchanges/list` |
| legal entity behind the fee page | "Bitso International", "a limited liability company incorporated and registered in Gibraltar, licensed by the Gibraltar Financial Services Commission ("GFSC"), with license number FSC1348B, as a distributed ledger technology provider", registration number 117775. The same terms also call it "THE BADGER TECHNOLOGY COMPANY LIMITED". The help center adds that "Bitso is authorized and regulated by the Gibraltar Financial Services Commission (GFSC) for its digital asset services" | Published | S4, terms last updated 2026-04-14, and S5 |
| regional entities | `MX` Nvio Pagos Mexico, `BR` Nvio Brazil, `AR` Nvio Argentina, `CO` Nvio Colombia, as the public terms service names them | Published | S13 |
| the fee page's scope | every tier table ends with "The Fees displayed in this section are applicable only to the services offered by Bitso International on the Exchange Platform to buy, sell and store Virtual Currencies." | Published | S1 |
| who may trade | a KYC-verified Account Holder, at least 18, who is not a resident or citizen of a Prohibited Jurisdiction | Published | S4 clauses 3.2 and 3.3 |
| excluded regions | Schedule A lists 35 Prohibited Jurisdictions: Afghanistan, Albania, Belarus, Bosnia and Herzegovina, Central African Republic, China, Cuba, North Korea, Democratic Republic of Congo, Ethiopia, Guinea, Guinea Bissau, Hong Kong, Iran, Iraq, Kosovo, Lebanon, Libya, Mali, Montenegro, Myanmar, Nicaragua, North Macedonia, Russia, Serbia, Somalia, South Sudan, Sudan, Syria, Ukraine, United Kingdom, United States of America, Venezuela, Yemen and Zimbabwe | Published | S4 Schedule A |
| whether US persons may trade | No. "Residents and/or citizens of a Prohibited Jurisdiction are not eligible to become Account Holders", and the United States of America is on Schedule A. The public terms service answers 400 `{"error":{"code":"0304","message":"Incorrect identifier: US"}}` for a `US` jurisdiction | Published and Probed | S4, S13 |
| margin trading | "Margin trading is enabled only upon request", after a suitability assessment | Published | S9 |
| website and docs from this host | `bitso.com/fees`, `docs.bitso.com` pages with `.md` appended, the docs index `docs.bitso.com/bitso-api/llms.txt` and the help center API answered 200. The help center article pages at `support.bitso.com/hc/...` answered 403 to `curl` and to a fetch tool, so articles were read through `support.bitso.com/api/v2/help_center/en-us/articles/<id>.json`, which answered 200 | Probed | `curl` on 2026-09-22 |
| public API from this host | every public REST and WebSocket call answered without a challenge or refusal, through Cloudflare colos `YVR` and `SEA` | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

Reading public market data is not an account service, and Bitso refused none of it.
Trading is another matter: the United States and the United Kingdom are Prohibited Jurisdictions, so an operator in either cannot open the account an execution stage would need.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, books quoted in `usd` (Digital dollars) and `usdt` | 0.300 % = 3,000 ppm | 0.360 % = 3,600 ppm | Published and Probed | S1 "Markets vs USDC (Digital Dollars) (USD)" and "Markets vs USDT", and `available_books` `fees.structure[0]` `"0.003"` and `"0.0036"` on 31 books |
| spot, books quoted in `mxn` | 0.600 % = 6,000 ppm | 0.780 % = 7,800 ppm | Published and Probed | S1, and `"0.006"` and `"0.0078"` on 12 books |
| spot, books quoted in `brl` | 0.200 % = 2,000 ppm | 0.400 % = 4,000 ppm | Published and Probed | S1, 3 books |
| spot, books quoted in `ars` | 0.450 % = 4,500 ppm | 0.600 % = 6,000 ppm | Published and Probed | S1, 3 books |
| spot, books quoted in `cop` | 0.500 % = 5,000 ppm | 0.650 % = 6,500 ppm | Published and Probed | S1, 2 books |
| spot, `btc_usds` | 0.250 % = 2,500 ppm | 0.300 % = 3,000 ppm | Published and Probed | S1 "Markets vs USDS", 1 book |
| spot, `tusd_btc` | 0.075 % = 750 ppm | 0.098 % = 980 ppm | Published and Probed | S1 "Markets vs Bitcoin (BTC)", 1 book |
| spot, `brl1_brl` | 0 | 0.01 % = 100 ppm | Probed, not on the fee page | `available_books`, 2 tiers |
| perpetuals | none on a Bitso order book | | see section 3 | |

The 31 USD and USDT books are 26 `*_usd` books and 5 `*_usdt` books, and the 54 books add up as 31 plus 12, 3, 3, 2, 1, 1 and 1, in `rest-probe.mjs catalog`, tag `ccxt_fields`.
The engine prices in the USD, USDC and USDT family, so 3,600 ppm is the Bitso number that would matter for a cross.
It is 7.2 times the 500 ppm VIP 0 perpetual taker of Gate in [`../gate/fees.md`](../gate/fees.md) section 2, and a leg paying it needs a gross cross above 0.36 % before any other cost.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| spot | yes, researched | 54 books: 26 `usd`, 12 `mxn`, 5 `usdt`, 4 `brl`, 3 `ars`, 2 `cop`, 1 `usds`, 1 `btc` quoted | Probed, `available_books`, see [`rest.md`](./rest.md) section 2 |
| spot margin | yes, not detailed | `margin_enabled` true on 53 of 54 books, false on `brl1_brl` | Probed, and S9, S8 |
| perpetuals on a Bitso order book | Not offered | 0 | CCXT `'swap': false` at `server/node_modules/ccxt/js/src/bitso.js` line 30. The Trading API docs index lists no perpetual or futures page (S15). The help center search for "perpetual" returns 0 articles (S14) |
| perpetuals through Bitso Onchain | announced, not a Bitso book | | S10 announced a "Perps Aggregator" for early Q1 2026, "engineered as a true execution layer across multiple onchain perpetual futures platforms". The bitso.com web bundle of 2026-09-22 carries a "Perps" navigation entry at `/perps` and a feature flag named `defi-alpha-hyperliquid-perps-support`. That points to Hyperliquid perpetuals reached through Bitso's app, which is an inference, and whether it is live for any region is Not verified. The Trading API has no endpoint for it |
| dated futures | Not offered | 0 | CCXT `'future': false` at line 31, S15 |
| options | Not offered | 0 | CCXT `'option': false` at line 32, S15 |
| CoinGecko derivatives list | absent | no entry matches `bitso` | S11 |

Nine books stopped trading on Alpha on 2026-09-10: `EUR/MXN`, `AVAX/MXN`, `USDS/MXN`, `BCH/MXN`, `SOL/BRL`, `XRP/BRL`, `ETH/BRL`, `ETH/ARS` and `ETH/BTC`, per S6.
None of them appears in `available_books` on 2026-09-22.

Bitso's `usd` is not a fiat dollar book in the usual sense.
The fee page heads the `usd` table "Markets vs USDC (Digital Dollars) (USD)", and S7 says "Digital dollar is Bitso's name for two stable digital currencies pegged 1:1 to the US dollar: USD Coin (USDC) and Tether (USDT)", held as one balance that withdraws as either coin or as US dollars at 1:1.
Separate `*_usdt` books and a `usd_usdt` book also trade, see [`rest.md`](./rest.md) section 2.

Deposit, withdrawal and network fees are looked up on the "Deposits and Withdrawals" tab of `https://bitso.com/fees` (S1).

## 4. Spot tiers

Tiers step down with the account's 30 day volume in the quote currency of the book's group: "The trading fees you pay decrease as your volume increases within a 30-day range and are both based on a Maker-Taker scheme." (S1).
The API's `fees.structure[].volume` is the upper bound of a tier, "the first tier goes from 0 to 1,500,000, the second from 1,500,001 to 2,000,000", in S2's example.
The fee page states the same tiers by their lower bound.

### Books quoted in `usd` and `usdt`, volume in USD or USDT

| tier | 30 day volume | maker | taker | taker ppm |
|---|---|---:|---:|---:|
| 1 | under 1,000 | 0.300 % | 0.360 % | 3,600 |
| 2 | over 1,000 | 0.239 % | 0.333 % | 3,330 |
| 3 | over 5,000 | 0.205 % | 0.282 % | 2,820 |
| 4 | over 10,000 | 0.171 % | 0.243 % | 2,430 |
| 5 | over 50,000 | 0.137 % | 0.205 % | 2,050 |
| 6 | over 100,000 | 0.114 % | 0.154 % | 1,540 |
| 7 | over 1,000,000 | 0.085 % | 0.095 % | 950 |
| 8 | over 5,000,000 | 0.072 % | 0.082 % | 820 |
| 9 | over 10,000,000 | 0.060 % | 0.069 % | 690 |
| 10 | over 20,000,000 | 0.050 % | 0.060 % | 600 |
| 11 | over 30,000,000 | 0.040 % | 0.050 % | 500 |

The page states both tables with the same rows (S1).
The `btc_usd` `fees.structure` in `available_books` carries the same eleven rows, with upper bounds 1000, 5000, 10000, 50000, 100000, 1000000, 5000000, 10000000, 20000000, 30000000 and 9999999999, probed on 2026-09-23 at 01:18 UTC.

### Books quoted in `mxn`, volume in MXN

| tier | 30 day volume | maker | taker | taker ppm |
|---|---|---:|---:|---:|
| 1 | under 20,000 | 0.600 % | 0.780 % | 7,800 |
| 2 | over 20,000 | 0.590 % | 0.760 % | 7,600 |
| 3 | over 100,000 | 0.570 % | 0.741 % | 7,410 |
| 4 | over 500,000 | 0.560 % | 0.728 % | 7,280 |
| 5 | over 1,000,000 | 0.550 % | 0.715 % | 7,150 |
| 6 | over 1,500,000 | 0.500 % | 0.650 % | 6,500 |
| 7 | over 5,000,000 | 0.450 % | 0.585 % | 5,850 |
| 8 | over 50,000,000 | 0.200 % | 0.260 % | 2,600 |
| 9 | over 150,000,000 | 0.100 % | 0.130 % | 1,300 |

The `btc_mxn` structure matches all nine rows.

### Other quote groups

| group | tier 1 maker and taker | best tier maker and taker | tiers | wire against page |
|---|---|---|---:|---|
| `brl`, volume in BRL | 0.200 % and 0.400 % under 541,000 | 0.080 % and 0.150 % over 162,300,000 | 10 | three cells differ: tier 4 taker 0.274 % on the page and `0.00275` on the wire, tier 6 taker 0.224 % and `0.00225`, tier 9 maker 0.084 % and `0.00085` |
| `ars`, volume in ARS | 0.450 % and 0.600 % under 1,625,000 | 0.100 % and 0.150 % over 4,875,000,000 | 10 | tier 1 matches |
| `cop`, volume in COP | 0.500 % and 0.650 % under 15,000,000 | 0.120 % and 0.170 % over 190,000,000,000 | 13 | tier 1 matches |
| `usds`, volume in USDS | 0.250 % and 0.300 % under 40,000 | 0.090 % and 0.130 % over 5,200,000 | 9 | all nine rows match |
| `btc`, volume in BTC | 0.075 % and 0.098 % under 8 | 0.050 % and 0.065 % over 950 | 10 | tier 1 matches |

All group tables are from S1, and the wire column is from `available_books` on 2026-09-23 at 01:18 UTC.

### Qualification

Volume is the account's own 30 day traded volume in the book group's quote currency (S1).
No holding, deposit or balance requirement is published.
The authenticated `GET /fees` call returns the account's own rates, and it was not called (S12 lists it at `server/node_modules/ccxt/js/src/bitso.js` line 183).

## 5. Discounts that change the spot taker

| discount | effect | label | evidence |
|---|---|---|---|
| token holding | none, Bitso has no exchange token. S10 announced a "Bitso Onchain token" for 2026 with no fee role stated | Not publicly specified | S10 |
| referral | a referral program exists, and no fee discount is published for the referred trader | Not publicly specified | help center article 51293035091476, "How Bitso's referral program works", not read beyond its title |
| market maker | the terms reserve affiliated market makers who "may have access to public information and receive special prices", and no public program is published | Published, no rate | S4 |
| zero fee promotions | none found on 2026-09-22 | | S1 |

## 6. Funding as a cost

Spot has no funding.
A margin position pays interest instead: "Interest accrues hourly on borrowed amounts", and the rate per currency comes from the authenticated "Get margin available currencies" call (S9).
Liquidation starts when "Margin Level ≤ 1.10×" (S8).

## 7. Liquidation, settlement and delisting

| charge | value | evidence |
|---|---|---|
| margin liquidation | "open positions are liquidated automatically in your Margin wallet", and the surplus after debt, interest and fees goes back to that wallet. No liquidation fee rate is published | S8 |
| settlement | none, spot settles at the trade | |
| delisting or hibernation | a hibernated book's pending orders are cancelled "as if you never placed it", and balances stay untouched | S6 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| class | `bitso`, REST only. CCXT Pro 4.5.68 has no `bitso` file under `server/node_modules/ccxt/js/src/pro/` | `ls server/node_modules/ccxt/js/src/pro/` |
| market type | every market is `type: 'spot'`, and the class declares `'swap': false`, `'future': false`, `'option': false` | `server/node_modules/ccxt/js/src/bitso.js` lines 28 to 32 and 544 to 549 |
| `market.taker` for `BTC/USD`, no credentials | `0.0036`, which is 3,600 ppm | Probed, `rest-probe.mjs catalog`, tag `ccxt_btc_usd` |
| where it comes from | `fetchMarkets` first reads `fees.flat_rate` and divides it by 100, then overwrites `taker` and `maker` with `fees.structure[0]` when a structure exists | `server/node_modules/ccxt/js/src/bitso.js` lines 502 to 507 for the division, 515 to 527 for the overwrite, 535 to 585 for the market object |
| the flat rate trap | the wire's `flat_rate` is a fraction today, `{"maker":"0.003","taker":"0.0036"}` on `btc_usd`, while S2's example and CCXT's comment show a percent, `"0.650"`. A book with an empty `structure` would therefore get a taker 100 times too small. All 54 books carried a structure of 2 to 13 tiers on 2026-09-23 | Probed, tag `ccxt_btc_usd`, and `server/node_modules/ccxt/js/src/bitso.js` line 473 |
| per market values | `0.0036/0.003` on 31 markets, `0.0078/0.006` on 12, `0.006/0.0045` on 3, `0.004/0.002` on 3, `0.0065/0.005` on 2, `0.003/0.0025` on 1, `0.00098/0.00075` on 1, `0.0001/0` on 1 | Probed, tag `ccxt_fields` |
| `rateLimit` | 2,000 ms, commented "30 requests per minute" | `server/node_modules/ccxt/js/src/bitso.js` line 24 |

## 9. Recommended registry values

None today, because Bitso lists no perpetual and the connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203.
Registering Bitso as it stands would load 54 spot markets, keep 0, and skip the venue with "no usable swap markets", at the same file line 51.

If a later design adds spot legs on the USD family, the entry would read as follows.

```ts
bitso: {
  takerPpm: 3_600,
  ccxtTakerPpm: 3_600, // server/node_modules/ccxt/js/src/bitso.js lines 524 to 527 copy fees.structure[0].taker, 0.0036 on every usd and usdt book
}
```

`takerPpm: 3_600` is the fee page's tier 1 taker for `usd` and `usdt` books, and it equals CCXT's per market value on those books.
An MXN, BRL, ARS or COP book would carry a different taker, which the registry cannot express per market today.
The catalog, book seeds and any ticker poll would share the public limit of 60 requests a minute per IP (S3).

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitso fees, "Trading fees" tab | https://bitso.com/fees | 2026-09-22 | Bitso International | tiers by quote group, 30 day volume rule, scope line, sections 2 and 4 |
| S2 | Trading API, List Available Books, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/list-available-books | 2026-09-22 | Bitso | `fees.flat_rate` as fallback, `structure` tier bounds, `margin_enabled`, sections 4 and 8 |
| S3 | Trading API, General, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/general-concepts | 2026-09-22 | Bitso | the public limit of 60 requests a minute per IP, section 9 and [`rest.md`](./rest.md) section 6 |
| S4 | Bitso International Terms of Service, last updated 2026-04-14, read through `https://api.bitso.com/v3/terms_public/GI?include_text=1&markdown=0` | https://bitso.com/legal/GI/terms | 2026-09-22 | Bitso International, Gibraltar | entity, license FSC1348B, eligibility clauses 3.2 and 3.3, Schedule A, market maker clause, section 1 |
| S5 | Help center, "Bitso's Gibraltar regulation and invoices for trading operations", updated 2026-09-02 | https://support.bitso.com/hc/en-us/articles/4416524729364 | 2026-09-22 | Bitso International | GFSC authorization, section 1 |
| S6 | Help center, "Why is Bitso hibernating some trading books on Alpha?", updated 2026-09-08 | https://support.bitso.com/hc/en-us/articles/53207916539924 | 2026-09-22 | Bitso | nine books hibernated on 2026-09-10, sections 3 and 7 |
| S7 | Help center, "How do Digital dollars work on Bitso?", updated 2026-09-14 | https://support.bitso.com/hc/en-us/articles/4414977550996 | 2026-09-22 | Bitso | `usd` is a USDC and USDT balance, section 3 |
| S8 | Help center, "Common questions about margin trading", updated 2026-09-03 | https://support.bitso.com/hc/en-us/articles/44171976942868 | 2026-09-22 | Bitso | liquidation at a 1.10 margin level, sections 6 and 7 |
| S9 | Trading API, Creating a Margin Account and Borrowing and Repayments | https://docs.bitso.com/bitso-api/docs/create-margin-account | 2026-09-22 | Bitso | margin on request, hourly interest, sections 1 and 6 |
| S10 | "Bitso Accelerates Its Onchain Expansion With Upcoming Perps Aggregator and 2026 Token Launch", GlobeNewswire, 2025-11-24 | https://www.globenewswire.com/news-release/2025/11/24/3193772/0/en/Bitso-Accelerates-Its-Onchain-Expansion-With-Upcoming-Perps-Aggregator-and-2026-Token-Launch.html | 2026-09-22 | Bitso Onchain | perps aggregator and token plans, sections 3 and 5 |
| S11 | CoinGecko API, `/exchanges/bitso` and `/derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/bitso | 2026-09-22 | CoinGecko | listing context, section 1 |
| S12 | CCXT 4.5.68 `bitso.js` | `server/node_modules/ccxt/js/src/bitso.js` | 2026-09-22 | CCXT | market type, fee parsing, `rateLimit`, section 8 |
| S13 | Bitso public terms service per jurisdiction, `MX`, `BR`, `AR`, `CO` and `US` | https://api.bitso.com/v3/terms_public/MX?include_text=0 | 2026-09-22 | Bitso | regional entity names, the `US` refusal, section 1 |
| S14 | Help center search API, query "perpetual" | https://support.bitso.com/api/v2/help_center/articles/search.json?query=perpetual&locale=en-us | 2026-09-22 | Bitso | 0 articles, section 3 |
| S15 | Trading API documentation index | https://docs.bitso.com/bitso-api/llms.txt | 2026-09-22 | Bitso | 84 lines, no perpetual, futures or options page, section 3 |
| P1 | `rest-probe.mjs catalog`, two runs at 01:20 and 01:39 UTC, and `curl` of `available_books` at 01:18 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitso/rest-probe.mjs) | 2026-09-23 UTC | this host | CCXT values, book counts, sections 2, 3 and 8 |
