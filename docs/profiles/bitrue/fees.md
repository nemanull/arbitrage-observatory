# Bitrue Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 03:07 to 03:48 UTC, which is the evening of 2026-09-22 on the development host near Seattle.

This profile covers perpetual trading on Bitrue Futures (CCXT id `bitrue`), and nothing else.
Spot, margin, deposit, withdrawal, card and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitrue/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitrue/ws-probe.mjs).
The help center pages answer this host with a Cloudflare challenge, HTTP 403 "Just a moment...", so every article was read through the public Zendesk article API of the same help center, which returned HTTP 200, see the ledger.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 for the documents, 2026-09-23 UTC for the probes | this profile |
| operator | "straLink Innovations Technologies Limitada, a limited liability company registered in Costa Rica, which is the operator of Bitrue" | S1 |
| terms version | article updated 2026-08-21 | S1 |
| excluded regions | "the United States, Canada, China Mainland, Hong Kong Special Administrative Region, India and Singapore", every jurisdiction of the European Economic Area under MiCA, and OFAC-sanctioned regions "including Iran, North Korea, Russia, Cuba, Syria" | S1 |
| may US persons trade | no, the United States is excluded by name | S1 |
| what this host got | every public REST and WebSocket endpoint used by the probes answered normally, with no refusal | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The help center HTML pages answered HTTP 403 with a Cloudflare challenge page titled "Just a moment...", and the article API of the same help center answered HTTP 200.
One API documentation page, `https://www.bitrue.com/api_docs_includes_file/delivery.html`, answered HTTP 403 with a page that reads "Access Denied Very sorry, but your region is not supported."
A path that cannot exist, `https://www.bitrue.com/api_docs_includes_file/nope-<timestamp>.html`, returned the identical 43,669 byte page, while the futures and spot documentation pages on the same host returned HTTP 200.
So that region text is the site's error page for a missing file, and it is not a geoblock of this host.
The terms still exclude US persons, and nothing in this profile routes around that.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | evidence |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S2 lists 0.02 % and 0.06 % on 264 USDT pairs. The web contract list carries `openTakerFeeRate` and `closeTakerFeeRate` of 0.0006 on 549 of 550 USDT-M contracts, P1 |
| USDC-M perpetuals | 0.02 % | 0.06 %, 600 ppm, on 36 of 38 contracts, and 0.07 %, 700 ppm, on `E-ADA-USDC` and `E-AAVE-USDC` | S2 for the maker, P1 for the taker |
| COIN-M perpetuals | 0.02 % | 0.06 %, 600 ppm | S2 lists 0.02 % and 0.06 % on 27 USD pairs, P1 shows 0.0006 on all 20 web-listed COIN-M contracts |

The one USDT-M exception on the web list is `E-XAUT-USDT` at 0.0002 open and close, P1.
The web contract list carries no maker field, so every maker number here rests on S2 alone.

The rate in S2 is the 2024-03-04 reduction of S3, which set the opening maker 0.02 %, opening taker 0.06 %, closing maker 0.02 % and closing taker 0.02 % for USDT-based futures.
The live web contract list disagrees on the close: it gives `closeTakerFeeRate` 0.0006, equal to the open, on 549 USDT-M contracts, P1.
The engine should take 600 ppm for every taker leg, because the live list is newer and the higher number is the safe one.

## 3. Coverage matrix

| product | present | count on 2026-09-23 | evidence |
|---|---|---|---|
| USDT-M perpetuals | yes | 726, all `type` `E`, `status` 1 | P1, `GET /fapi/v1/contracts`. CoinGecko's derivatives list showed "Bitrue (Futures): 726 perpetual pairs" on 2026-09-22 |
| of which crypto, shown on the futures web page | yes | 550 | P1, web contract list |
| of which TradFi, equities, ETFs, indices, metals, energy and pre-IPO names, absent from that web list | yes | 176, for example `E-GME-USDT`, `E-NAS100-USDT`, `E-AAPLX-USDT`, `E-OPENAI-USDT`, `E-ANTHROPIC-USDT` | P1 |
| USDC-M perpetuals | yes | 38 | P1 |
| COIN-M perpetuals, inverse, quoted in USD | yes | 21 on `GET /dapi/v1/contracts`, 20 on the web list | P1 |
| dated futures | no | 0, every contract row has `type` `E`, and the web list shows `contractShowType` `Perpetual` on 608 of 608 | P1 |
| options | no | none found in the API, CCXT or the web page | CCXT `server/node_modules/ccxt/js/src/bitrue.js` lines 33 to 35 set `swap` true, `future` false and `option` false |
| spot | yes | 1,697 CCXT spot markets | P1, `ccxt_load` |

Spot trades at 0.098 % on BTC, ETH and USDT pairs, S2, and is not profiled here.
Deposit, withdrawal, card and earn schedules are published per coin in the help center and in the `coins` array of the spot `exchangeInfo`, and are not recorded here.

## 4. Perpetual tiers

Bitrue publishes no perpetual fee tier table.
S2 lists one maker and one taker per contract, with no volume ladder.
The VIP program of 2025-07-29, S4, grades users on asset balance or 30-day volume, VIP 1 above 500,000 USDT of futures volume, VIP 2 above 2,000,000, VIP 3 above 5,000,000, and its benefits are reward pools, vouchers and a 10 % or 20 % fee rebate lottery, not a lower rate.

CCXT 4.5.68 carries a ten-row futures ladder from 0.04 % to 0.017 % taker and 0.02 % to 0 maker, at `server/node_modules/ccxt/js/src/bitrue.js` lines 306 to 340.
It matches nothing Bitrue publishes, and CCXT never copies it onto a market, see section 8.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| BTR fee payment | "Pay transaction fees with BTR and enjoy an instant 20% discount", stated under spot. Whether it reaches futures is Not publicly specified | S2 |
| VIP program | a rebate lottery of 10 % or 20 % of one month's fees for 1,000 winners, not a rate | S4 |
| zero maker on new futures listings | a promotion page titled "0 Maker Fees for New Futures Listings" exists at `https://www.bitrue.com/land/0-Maker-Fees-New-Futures-Trading`, and its body renders in the browser only, so its terms and end date were not read | page title, fetched 2026-09-22 |
| older zero fee campaigns | the help center lists campaigns from 2022 and 2023, such as zero fees on six new COIN-M pairs, 2023-11-08 | help center search, 2026-09-22 |

None of these changes the base VIP 0 taker the engine models.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays | longs pay shorts when the contract trades above the index, and shorts pay longs below it. "These transfers are entirely user-to-user. Bitrue does not collect any of these fees." | S5 |
| formula of the charge | "Fee = Position quantity * Value * Mark price * Capital expense rate" | S5 |
| formula of the rate | Not publicly specified. The web page labels `capitalRate` "base interest rate" and `capitalPremiumMax` / `capitalPremiumMin` "funding rate upper lower limit" | P1 and the web bundle, see [`rest.md`](./rest.md) section 4 |
| interval | 8 h on 265, 4 h on 459 and 1 h on 2 USDT-M contracts, and 8 h on 21 and 4 h on 17 USDC-M contracts, at 03:43 UTC, and the same USDT-M split by curl at 03:12 | P1, web funding list |
| settlement instants | 00:00, 08:00 and 16:00 UTC for 8 h contracts, S5. The funding history shows 4 h contracts settling on the hour every 4 h and 1 h contracts every hour | S5, P1 |
| listed limit | ±0.00375 per interval on 723 USDT-M and 38 USDC-M contracts, ±0.0075 on `BCH` and `TRX`, and -0.00375/-0.00375 on `JPN225` | P1 |
| is the limit a cap | no, `E-KERNEL-USDT` settled at -0.013178, -0.012547 and -0.010115 per 4 h on 2026-09-22 and 23, up to three and a half times its listed limit, and its live rate read -0.0082904 at 03:15 UTC | P1, funding history, and P2 |
| interval changes | `E-ONE-USDT` settled hourly until 09:00 UTC on 2026-09-22, then once after 3 h at 12:00, then every 4 h | P1, funding history |
| interval adjustments by notice | "Bitrue will adjust the funding rate interval of the following 9 perpetual future pairs", 8 h to 4 h, 2023-10-12 | S6 |

The funding settlement instant itself was not captured.
Settlement behaviour here comes from the funding history call and the documentation only.

## 7. Liquidation, settlement and delisting

- Liquidation is partial by a ladder of reductions, S5, and the liquidation fee is Not publicly specified.
- A delisted contract closes at a stated minute, and "Any remaining open positions will be liquidated at market price", as in the `uPEG/USDT` notice for 10:00 UTC on 2026-07-09, S7.
- Settlement of dated contracts does not apply, since every contract is perpetual.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | P1, `ccxt.version` |
| `market.taker` on every swap without credentials | `0.00098` on 785 of 785 swaps, and on 1,697 of 1,697 spot markets | P1, `ccxt_load` |
| where it comes from | the exchange-level spot block `'trading': { ... 'taker': this.parseNumber('0.00098'), 'maker': this.parseNumber('0.00098') }` | `server/node_modules/ccxt/js/src/bitrue.js` lines 299 to 305, taker on line 303 |
| why a swap gets the spot rate | `parseMarket` sets no fee, and `setMarkets` deep-extends `this.fees['trading']` into every market | `server/node_modules/ccxt/js/src/bitrue.js` lines 933 to 1040, `server/node_modules/ccxt/js/src/base/Exchange.js` line 3735 |
| the futures block | `'future'` taker 0.0004 and maker 0.0002 with tiers, never read by `setMarkets` | `server/node_modules/ccxt/js/src/bitrue.js` lines 306 to 340 |
| `market.active` on every swap | `false` on 785 of 785, see [`rest.md`](./rest.md) section 2 | P1 |

CCXT reports 980 ppm, which is the spot fee, while the published perpetual taker is 600 ppm.
The difference is 380 ppm, and CCXT's number overstates the cost of every Bitrue leg.

## 9. Recommended registry values

```ts
bitrue: {
  takerPpm: 600,
  ccxtTakerPpm: 980,
  // ccxt/js/src/bitrue.js:303 gives every market the spot fee 0.00098, and the perpetual taker is 0.06 % open and close on the web contract list.
}
```

`takerPpm: 600` is the VIP 0 taker for USDT-M, USDC-M and COIN-M, S2 and P1.
`ccxtTakerPpm: 980` declares the constant the connector should expect, so the connector's mismatch warning stays quiet until CCXT changes the literal.
The two USDC-M contracts at 700 ppm are `E-ADA-USDC` and `E-AAVE-USDC`, and the quote family ranks each after its USDT contract, so a single 600 is safe for the markets the engine would trade.
These values matter only after the catalog change of [`rest.md`](./rest.md) section 2, since without it the connector keeps no Bitrue market.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitrue Terms of Use, updated 2026-08-21 | https://support.bitrue.com/hc/en-001/articles/4405473110681-Bitrue-Terms-of-Use, read through https://support.bitrue.com/api/v2/help_center/en-001/articles/4405473110681.json | 2026-09-22 | straLink Innovations Technologies Limitada, Costa Rica | operator, excluded regions, section 1 |
| S2 | Trading Fees on Bitrue, updated 2024-12-19 | https://support.bitrue.com/hc/en-001/articles/360045151354-Trading-Fees-on-Bitrue, read through the article API | 2026-09-22 | Bitrue, global | per-pair futures maker and taker, spot rate, BTR discount, sections 2, 4, 5 |
| S3 | Reduction in USDT-Based Futures Trading Fees, 2024-03-04 | https://support.bitrue.com/hc/en-001/articles/29475614739609-Reduction-in-USDT-Based-Futures-Trading-Fees, read through the article API | 2026-09-22 | Bitrue, global | opening and closing maker and taker after the reduction, section 2 |
| S4 | Bitrue VIP Program Launch Announcement, 2025-07-29 | https://support.bitrue.com/hc/en-001/articles/49305431211161, read through the article API | 2026-09-22 | Bitrue, global | VIP levels and benefits, sections 4 and 5 |
| S5 | Beginners Guide to USDT Futures, 2021-11-12 | https://support.bitrue.com/hc/en-001/articles/4409416662937, read through the article API | 2026-09-22 | Bitrue, global | funding direction, formula of the charge, settlement times, mark and index definitions, liquidation ladder, sections 6 and 7 |
| S6 | Adjustment on 9 Perpetual Futures Funding Rates, 2023-10-11 | https://support.bitrue.com/hc/en-001/articles/23902057154457, read through the article API | 2026-09-22 | Bitrue, global | interval changes by notice, section 6 |
| S7 | Bitrue Futures to Delist USDT-Based Perpetual Pairs: uPEG, 2026-07-09 | https://support.bitrue.com/hc/en-001/articles/59859314821273, read through the article API | 2026-09-22 | Bitrue, global | delisting at market price, section 7 |
| S8 | Disclosure About Handling Fees of Bitrue USDT Futures, 2023-07-07, and of COIN-M Futures, 2023-04-11 | https://support.bitrue.com/hc/en-001/articles/12853619163545 and https://support.bitrue.com/hc/en-001/articles/12853708253977, read through the article API | 2026-09-22 | Bitrue, global | the superseded 0.038 % maker and 0.07 % taker, context for S3 |
| S9 | CCXT 4.5.68 `bitrue.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/bitrue.js`, `server/node_modules/ccxt/js/src/base/Exchange.js` | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs main`, two runs at 03:14 and 03:43 UTC, and curl calls from 03:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitrue/rest-probe.mjs) | 2026-09-23 | this host | CCXT fields, contract counts, web contract list fees, web funding list intervals and limits, funding history, sections 2, 3, 6, 8 |
| P2 | `rest-probe.mjs anchor`, two runs at 03:15 and 03:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitrue/rest-probe.mjs) | 2026-09-23 | this host | the live rate of `E-KERNEL-USDT` beyond its limit, section 6 |
