# WEEX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 03:06 to 03:47 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the trading fees of the WEEX (CCXT id `weex`) USDT-margined perpetuals, which are the venue's only perpetual family, split by the catalog into crypto and TradFi contracts.
The tier table comes from the fee schedule page, which renders its table in the browser, so it was read once through a headless browser, S1.
The per contract rates come from the public catalog, read by [`rest-probe.mjs`](../../../scripts/probes/venues/weex/rest-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 Pacific time, and the probes ran 03:06 to 03:47 UTC on 2026-09-23 | |
| counterparty | "WEEX", with no incorporated entity named on the Terms of Use page | S2 |
| governing law | "the laws of Saint Vincent and the Grenadines" | S2, clause 20 |
| Terms of Use | last updated 7 July 2026 | S2 |
| Futures Trading Terms of Use | last updated 30 June 2025 | S7 |
| excluded jurisdictions | "Canada, South Korea, United States of America, United States Territories and Commonwealths, China (Mainland), Hong Kong, Singapore, United Arab Emirates, North Korea, Cuba, Iran, Sudan, Belarus, Russia and Russian-controlled regions of Ukraine, Somalia, Myanmar, Venezuela, or any other jurisdictions in which we may determine from time to time to terminate the services" | S2 |
| US persons | may not trade: "Residents of the Excluded Jurisdictions are not permitted to open Accounts with WEEX or to access WEEX's services" | S2 |
| sanctions | no service to persons on the OFAC, US Commerce, EU or UN lists | S2 |
| country on record | Singapore in CCXT's `countries`, at `server/node_modules/ccxt/js/src/weex.js` line 23, and on CoinGecko, although Singapore is itself an excluded jurisdiction | S9, S10 |
| access from this host | every public REST call answered 200 and every socket opened, with no geoblock | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| family | contracts | VIP 0 maker | VIP 0 taker |
|---|---:|---|---|
| USDT-M crypto perpetuals, `PERPETUAL` | 577 | 0.020 %, 200 ppm | 0.080 %, 800 ppm |
| USDT-M TradFi perpetuals, `TRADIFI_PERPETUAL` | 418 | 0.020 %, 200 ppm | 0.080 %, 800 ppm |

The schedule is one table for all futures, S1, and the catalog agrees on the taker.
Each catalog row also carries its own `takerFeeRate` and `makerFeeRate`, P1.

| catalog field | value | contracts |
|---|---|---:|
| `takerFeeRate` | 0.0008 | 994 |
| `takerFeeRate` | 0.0016, on `USDCUSDT` | 1 |
| `makerFeeRate` | 0.0002, every TradFi contract and 444 crypto contracts | 862 |
| `makerFeeRate` | 0.0003 | 74 |
| `makerFeeRate` | 0.0004 | 1 |
| `makerFeeRate` | 0.0005, for example `ENJUSDT`, `SNXUSDT`, `CFXUSDT` | 39 |
| `makerFeeRate` | 0.0008, for example `CELOUSDT`, `OGNUSDT` | 19 |

So 133 crypto contracts charge a maker above the published 0.020 %, and the schedule page does not mention it.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals, crypto | present, 577 | catalog `contractType` `PERPETUAL`, P1 |
| USDT-M perpetuals, TradFi: 350 stocks, 40 indices, 14 metals, 7 forex, 4 commodities, 3 pre-IPO | present, 418 | catalog `contractType` `TRADIFI_PERPETUAL`, P1 |
| coin-margined perpetuals | absent | `marginAsset` is `USDT` on 995 of 995, P1 |
| USDC-margined perpetuals | absent | only `USDT` and the demo `SUSDT` are margin assets, P1 |
| demo perpetuals in `SUSDT` | present, not real money | 51 `…SUSDT` names in `apiTradingSymbols`, P1 |
| dated futures | absent | CCXT `future` false at line 33, and CoinGecko counts 0 futures pairs, S10 |
| options | absent | CCXT `option` false at line 34 |
| spot | present | CCXT `spot` true at line 30, and 3,510 spot markets loaded, P1 |

## 4. Perpetual tiers

The futures tab of the fee schedule, read on 2026-09-22, S1.
A level is reached by meeting any one of its three requirements.

| level | 30 d futures volume, USDT | 1 d WXT balance | 5 d asset value, USDT | maker | taker |
|---|---|---|---|---|---|
| VIP 0 | ≥ 0 | ≥ 0 | ≥ 0 | 0.020 % | 0.080 % |
| VIP 1 | ≥ 1,000,000 | ≥ 5,000 | ≥ 10,000 | 0.020 % | 0.075 % |
| VIP 2 | ≥ 5,000,000 | ≥ 50,000 | ≥ 30,000 | 0.018 % | 0.060 % |
| VIP 3 | ≥ 10,000,000 | ≥ 250,000 | ≥ 50,000 | 0.018 % | 0.055 % |
| VIP 4 | ≥ 30,000,000 | ≥ 500,000 | ≥ 100,000 | 0.016 % | 0.050 % |
| VIP 5 | ≥ 50,000,000 | ≥ 1,000,000 | ≥ 200,000 | 0.016 % | 0.048 % |
| VIP 6 | ≥ 100,000,000 | ≥ 1,500,000 | ≥ 300,000 | 0.014 % | 0.045 % |
| VIP 7 | ≥ 300,000,000 | ≥ 2,500,000 | ≥ 500,000 | 0.012 % | 0.042 % |
| VIP 8 | ≥ 500,000,000, plus non-API futures volume ≥ 450,000,000 | | | 0.010 % | 0.040 % |

VIP 8 is the one level that needs two conditions together, and 90 % of its volume must come from outside the API.
CCXT's contract tier table carries the same rates against the same volume steps, in percent units, at `server/node_modules/ccxt/js/src/weex.js` lines 451 to 474.

### Qualification

The page names the three measures "30d futures vol. (USDT)", "1d WXT balance" and "5d asset value (USDT)", S1.
When the level is recalculated is Not publicly specified on the page.

## 5. Discounts that change the perpetual taker

| discount | what the sources say |
|---|---|
| WXT holding | a WXT balance is one of the three routes to each VIP level, S1. The VIP program page is titled "Trading Fees as Low as 0.006%", S11, and any further WXT percentage discount is Not verified |
| API orders | the catalog documents `apiMakerFeeRate` and `apiTakerFeeRate` as "This field may not be returned", S3, and none of the 995 rows carried them on 2026-09-23. So no separate API rate was published |
| market maker | only a contact, "Quant Trading & MM : bd@weex.com", in the site footer, S1 |
| zero fee promotion | "0 fees for all TradFi futures", maker and taker, from May 1, 12:00 AM to May 31, 2026, 11:59 PM (UTC+8), S5. It has ended, and the catalog listed a 0.0008 taker on all 418 TradFi contracts on 2026-09-23 |
| referral | CCXT's referral link carries a `vipCode`, at line 203, and its fee effect is Not publicly specified |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | `F = P + clamp(I - P, premium deviation floor, premium deviation ceiling)`, then the final rate is `clamp(F, funding rate floor, funding rate ceiling)` | S4 |
| interest rate | `I = (quote interest index - base interest index) / funding interval`, and the anchor reply's `interestRate` read `0.0003` on 985 of 995 contracts | S4, [`rest.md`](./rest.md) section 4 |
| premium index | `[max(0, depth weighted bid - mark) - max(0, mark - depth weighted ask)] / spot price + fair basis of mark price` | S4 |
| interval | per contract, `collectCycle` in minutes: 480 on 497, 240 on 494, 60 on 4 | P1 |
| settlement times | the catalog's `delivery` list per contract, for example `00:00:00`, `08:00:00`, `16:00:00`. 196 contracts carry stray spaces or tabs in those strings | P1 |
| cap and floor | per contract, Not publicly specified. The largest upcoming rates seen were 0.00601 to 0.00715 per interval on `KERNELUSDT` | [`rest.md`](./rest.md) section 4 |
| who pays | "When the funding rate is positive, long positions pay funding fees to short positions", and the reverse when negative | S4 |
| who is charged | "Funding fees apply only if you hold a position at the settlement time" | S4 |
| venue share | "WEEX does not charge funding fees. Fees are exchanged directly between users" | S4 |
| base | `funding rate × position value`, with position value `face value × number of lots × latest mark price` | S4 |
| deduction | from the position's margin, down to the maintenance margin rate, and "The actual funding fee received depends on the total fees collected from counterparties" | S4 |

The settlement instant itself was not captured.
The funding history shows each settlement on the contract's `delivery` times, 8 h, 4 h or 1 h apart, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | Not publicly specified in the pages read | |
| insurance fund | a bankrupt user's positions may be taken over and offloaded "with the use of an Insurance Fund", and when the fund cannot take them, "counterparty liquidation will occur" | S7, clause 6.1 |
| expiry settlement | none, since no dated futures are listed | section 3 |
| delisting | opening is suspended about two hours before the delisting instant, then "all unfilled orders will be automatically canceled, and any open positions will be automatically closed" | S6 |
| delisting price | Not publicly specified | S6 |

For example, `IKAUSDT` stopped opening at 1:00 PM and was delisted at 3:00 PM (UTC+8) on June 23, 2026, S6.

## 8. CCXT

`market.taker` for a swap market, loaded without credentials, is the catalog's `takerFeeRate`, at `server/node_modules/ccxt/js/src/weex.js` line 1057, and `market.maker` is `makerFeeRate` at line 1058.
On 2026-09-23 it reported 0.0008, 800 ppm, on 994 of 995 swaps and 0.0016 on `USDC/USDT:USDT`, P1.
`BTC/USDT:USDT` read taker 0.0008 and maker 0.0002.

The class also declares `fees.contract` with `taker` 0.08 and `maker` 0.02 at lines 449 and 450, and `percentage` true.
Those constants are written in percent, so read as fractions they would be 8 % and 2 %, but no swap market reports them, since `parseMarket` takes the rates from the catalog row.
The spot and `trading` constants of 0.1 at lines 387 and 418 are percent units in the same way.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 800 | the VIP 0 perpetual taker on the schedule and on 994 of 995 catalog rows |
| `ccxtTakerPpm` | 800 | what CCXT reports per market. The one market at 1,600 ppm, `USDCUSDT`, would log the connector's one warning, which is harmless since USDC is not a traded base |
| `contractSize` | 1 | not a fee, but it belongs in the same registration, see [`rest.md`](./rest.md) section 2 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WEEX Fee Schedule, Futures tab, rendered once by a headless browser | https://www.weex.com/support/rate | 2026-09-22 | WEEX, global | VIP table and qualification, footer contacts, sections 2, 4 and 5 |
| S2 | Terms of Use, last updated 7 July 2026 | https://www.weex.com/help/articles/4417379529241 | 2026-09-22 | WEEX, global | counterparty, governing law, excluded jurisdictions, sanctions, section 1 |
| S3 | WEEX Futures API, Get Exchange Information | https://www.weex.com/api-doc/contract/Market_API/GetContractInfo | 2026-09-22 | WEEX, global | per contract fee fields and the API fee fields, sections 2 and 5 |
| S4 | Funding Fees | https://www.weex.com/help/articles/4410862743449 | 2026-09-22 | WEEX, global | funding formula, who pays, deduction, section 6 |
| S5 | 0 fees for all TradFi futures | https://www.weex.com/help/articles/help_article_89209 | 2026-09-22 | WEEX, global | the May 2026 zero fee event, section 5 |
| S6 | IKA USDT-M perpetual futures delisting announcement | https://www.weex.com/help/articles/a6a22y1l0vwiwycx9knc58fo | 2026-09-22 | WEEX, global | delisting procedure, section 7 |
| S7 | Futures Trading Terms of Use, last updated 30 June 2025 | https://www.weex.com/help/articles/48842594089625 | 2026-09-22 | WEEX, global | insurance fund, counterparty liquidation, section 7 |
| S8 | Spot and Futures Trading Fee Calculation | https://www.weex.com/help/articles/4415852872601 | 2026-09-22 | WEEX, global | "Maker: 0.02% fee rate" and "Taker order: 0.08% fee rate", charged on opening, closing or reducing a position, section 2 |
| S9 | CCXT 4.5.68 `weex.js` | `server/node_modules/ccxt/js/src/weex.js` | 2026-09-22 | CCXT | `countries`, `has` flags, fee constants, tiers, market fee fields, sections 1, 3, 4 and 8 |
| S10 | CoinGecko derivatives exchanges list, "WEEX (Futures)" | https://www.coingecko.com/en/exchanges/derivatives | 2026-09-22 | CoinGecko | country Singapore, 1,048 perpetual and 0 futures pairs, sections 1 and 3 |
| S11 | WEEX VIP Program page, title only | https://www.weex.com/vip-program | 2026-09-22 | WEEX, global | "Trading Fees as Low as 0.006%", section 5 |
| P1 | `rest-probe.mjs catalog`, runs at 03:26, 03:41 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/weex/rest-probe.mjs) | 2026-09-23 | this host | catalog fee fields, coverage counts, intervals, CCXT market fees, sections 2, 3, 6 and 8 |
