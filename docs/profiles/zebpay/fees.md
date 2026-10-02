# ZebPay Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:12 to 04:45 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare `loc=CA`, SEA edge).

This profile covers the fees of ZebPay perpetual futures, the only derivatives ZebPay lists.
ZebPay has a CCXT 4.5.68 class, `zebpay`, with spot and swap markets, see section 8.
Every ZebPay perpetual carries a Binance USD-M symbol, and its book, mark, index and next funding time are Binance's own, relayed with a price markup, see [`rest.md`](./rest.md) section 4 and [`websocket.md`](./websocket.md) section 4.
That shapes every section below.
All probe times are UTC on 2026-09-23.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "Awlencan Innovations India Limited (CIN: U72100TS2018FLC177177), which owns and operates the ZebPay Platform in India", the contracting party for "Futures trading" | S2, Terms of use preamble |
| registration | "a Virtual Digital Asset Service Provider registered with the Financial Intelligence Unit - India (FIU-IND)" | S2, AML policy |
| counterparty | "You can use INR and/ or USDT only to trade in crypto assets and/or to trade in perpetual Futures contracts with the Company through the ZebPay Platform" | S2, Futures Trading Policy clause 2 d |
| price source | "ZebPay's algorithm provides the price for a specific quantity of crypto assets or perpetual Futures contracts based on various factors like high volatile nature and market fluctuations, exchange fees, changes in prices in the order book" | S2, Futures Trading Policy clause 3 f |
| who may trade | "Clients who are not residents of India are not permitted to use the ZebPay Services." | S2, Terms of use |
| excluded regions | every place outside India, and "Persons and/or residents of certain countries including those on the Financial Action Task Force's blacklist" | S2 |
| US persons | excluded unless resident in India, since only Indian residents may use the services | S2 |
| access from this host | `futuresbe.zebpay.com`, `sapi.zebpay.com`, `zebpay.com` pages, `help.zebpay.com` and `raw.githubusercontent.com/zebpay/...` all returned 200 through the Canadian VPN exit, and no page or endpoint refused this host | P1, section 10 |

The fee schedule was read from the pricing page, S1, which states "All types of fees provided below are exclusive of Goods and Services Tax (GST) which shall be added to the fee at the applicable rate."
The KYC line on the same page shows the rate: "₹500 + 18% GST = ₹590".
The futures API names `GST_ON_COMMISSION`, `GST_ON_FUNDING_FEE` and `GST_ON_CLEARANCE_FEE` among its transaction types, P1 `pairs`.

## 2. Quick answer

| family | maker | taker | ppm, maker and taker | source |
|---|---|---|---|---|
| all perpetuals, pricing page, VIP 0 | 0.020 % plus GST | 0.050 % plus GST | 200 and 500 before GST, 236 and 590 with 18 % GST | S1, "Futures Trading Fees", row VIP 0 |
| 78 USDT perpetuals, public API | 0.02 | 0.06 | 200 and 600 read as percent, 236 and 708 with GST | `GET /api/v1/exchange/tradefees` and `market/markets`, P1 |
| 170 USDT and 177 INR perpetuals, public API | 0.05 | 0.1 | 500 and 1,000 read as percent, 590 and 1,180 with GST | same calls, P1 |

The documentation and the wire disagree, so both are written.
The pricing page gives one VIP 0 row, 0.020 % maker and 0.050 % taker, for "INR and USDT futures pairs".
The public fee call returns two sets per pair, and it needs no key, so it cannot know an account's tier.
The API numbers are percent: the pricing page's 0.020 % maker equals the API's `0.02` on the 78 low-fee pairs.
The 78 low-fee pairs include `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `XRPUSDT`, `XAUUSDT` and `XAGUSDT`, and no rule by quote or by INR twin separates the two sets, P1.
The API's `0.06` taker is within rounding of 0.050 % plus GST, which is 0.059 %, but that reading is an inference, and the `0.1` set does not fit it.
Whether the API values include GST is Not publicly specified.
The engine should model 590 ppm for a VIP 0 taker if the pricing page holds, and 708 or 1,180 ppm if the API set is what an account is charged, which only an account can settle.

## 3. Coverage matrix

| product | present | detail | source |
|---|---|---|---|
| USDT-quoted perpetuals | yes, 248 active | every one a Binance USD-M symbol: 243 `PERPETUAL` and 5 `TRADIFI_PERPETUAL` (`XAUUSDT`, `XAGUSDT`, `CLUSDT`, `BZUSDT`, `NATGASUSDT`) on Binance's exchangeInfo | P1 `markets`, P3 |
| INR-quoted perpetuals | yes, 177 active | the same Binance symbol priced in INR at about 95 INR per USDT, 170 with a USDT twin on ZebPay and 7 without (`LUMIA`, `W`, `TUT`, `STRK`, `THETA`, `IMX`, `ZRX`) | P1, P2 |
| margin currency | USDT pairs take INR or USDT margin, INR pairs take INR | `marginAssetsSupported` on 248 and 177 pairs | P1 `exchangeInfo` |
| inverse or coin-margined perpetuals | no | no row with a crypto quote | P1 |
| dated futures | no | CCXT sets `future: false` at `server/node_modules/ccxt/js/src/zebpay.js` line 33 | S5 |
| options | no | none in the API, CCXT leaves `option` undefined at line 34 | S5 |
| spot | yes | `https://sapi.zebpay.com`, 130 markets in CCXT 4.5.68, INR and USDT quotes, regular maker and taker 0.45 % | S1, P1 `ccxt` |

The pairs list also returns 215 inactive pairs, 640 in all, and names the categories "US Stocks" and "ETFs", P1.
No active pair on 2026-09-23 was a stock or an ETF by name.

## 4. Perpetual tiers

From S1, "Futures Trading Fees", 30 day rolling volume, all exclusive of GST.

| tier | 30 day volume | maker | taker | taker ppm before GST | taker ppm with 18 % GST |
|---|---|---:|---:|---:|---:|
| VIP 0 | up to USDT 2 mn, "Upto 17.6 CR" | 0.020 % | 0.050 % | 500 | 590 |
| VIP 1 | USDT 2 to 5 mn | 0.020 % | 0.048 % | 480 | 566 |
| VIP 2 | USDT 5 to 15 mn | 0.018 % | 0.048 % | 480 | 566 |
| VIP 3 | USDT 15 to 50 mn | 0.015 % | 0.045 % | 450 | 531 |
| VIP 4 | USDT 50 to 100 mn | 0.012 % | 0.040 % | 400 | 472 |
| VIP 5 | USDT 100 to 500 mn | 0.010 % | 0.040 % | 400 | 472 |
| VIP 6 | USDT 500 to 1000 mn | 0.008 % | 0.032 % | 320 | 378 |
| VIP 7 | USDT 1000 mn and above | 0.007 % | 0.029 % | 290 | 342 |

The INR bounds are given in crore beside each USDT bound, at 8.8 crore per USDT million.
Qualification is the 30 day rolling trading volume, in USDT or INR, and nothing else is named.
The account's tier is served by `https://futuresbe.zebpay.com/user/tier-info`, which the web app calls with a login, P2, and was not called.

## 5. Discounts that change the perpetual taker

- No token discount and no referral rate for futures is published on S1.
- The API names a `FEE_DISCOUNT` transaction type, P1, and no public page says what earns it.
- A help article "Modified on Wed, 13 May", with no year shown, and 13 May was a Wednesday in 2026, announces "newly introduced categories, Zero Fees, All, Gainers, Losers", S3.
  No row of the public fee call showed a zero fee on 2026-09-23, P1, so which pairs are zero fee, and until when, is Not verified.
- The women traders discount on S1 applies to Quick Trade only.
- Trading USDT pairs on INR margin carries "no fees or TDS on this conversion", S4.

## 6. Funding as a cost

- Formula on S1: "Funding Amount = Nominal Value of Position (of that contract) * Funding Rate (of that contract)", where "Nominal Value of Position= Mark Price* Size of a contract".
- Who pays: "Traders are required for funding payments only when they hold open positions during the designated funding times", S1.
- Interval: "Funding Fee payments generally occur every 4 (four) to 8 (eight) hours", S2 clause 4 c.
  The API's `fundingFeeInterval` is 4 h on 316 pairs, 8 h on 107 and 1 h on 2, and it equals Binance's interval for the same symbol on 425 of 425, P1 and P2.
- Rate: ZebPay publishes Binance's rate times 1.0, 1.1 or 0.9 per pair, held between refreshes, see [`rest.md`](./rest.md) section 4.
  No ZebPay cap or floor is published.
- Tax: the API names `GST_ON_FUNDING_FEE`, P1, so GST is charged on funding, on a base Not publicly specified.
- The settlement instant itself was not captured.
  ZebPay has no public funding history call, and the next settlement time on the socket equals Binance's `nextFundingTime`, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation clearance fee | 0.5 % on all futures pairs, "which includes the Taker fee as well", plus GST | S1 |
| `liquidationFee` in exchangeInfo | `0.02` on 425 of 425 pairs, unit not stated | P1 |
| settlement | perpetual only, no delivery | S2 clause 7 |
| delisting | Not publicly specified | S1, S2 |

The two liquidation numbers disagree and are both written.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `zebpay`, no CCXT Pro class | `server/node_modules/ccxt/js/src/zebpay.js` line 27 `'pro': false`, and no `zebpay.js` under `js/src/pro/` |
| swap catalog call | `GET https://futuresbe.zebpay.com/api/v1/market/markets` | lines 91 and 1660 |
| `market.taker` for `BTC/USDT:USDT` without credentials | `0.06`, which the connector turns into 60,000 ppm | line 1712, `'taker': this.safeNumber(market, 'takerFee')`, P1 `ccxt` |
| `market.taker` on the other 347 swaps | `0.1`, which is 100,000 ppm | line 1712, P1 |
| exchange-level fee | none, `'fees': {}` | line 176 |

CCXT reads ZebPay's percent field as a fraction, so its taker is 100 times the real fee.
The spot parser does the same, and `UNI/USDT` reports `taker` 0.45, P1.
The connector compares each market's CCXT taker with one expected value at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 32 to 38 and 118 to 122.
With two CCXT values on ZebPay, 60,000 and 100,000 ppm, one `ccxtTakerPpm` would leave 347 or 78 markets reported as unexpected.
The option `ignoreCcxtTakerPpm` at [`../../../server/src/ccxt/types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/types.ts) line 21 exists for a CCXT fee no single number describes.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 590 | S1 VIP 0 taker 0.050 % plus 18 % GST, the basis the CoinDCX profile used. The public API's 0.06 or 0.1 per pair, 708 or 1,180 ppm with GST, is the alternative only an account can settle |
| `ccxtTakerPpm` | unset | CCXT reports 60,000 ppm on 78 swaps and 100,000 ppm on 347, line 1712 |
| `ignoreCcxtTakerPpm` | true | the two CCXT values are the percent field read as a fraction, so no single expected value fits |

The venue is not recommended for the engine, see [`rest.md`](./rest.md) section 8, so these values are recorded for completeness.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ZebPay pricing page | https://zebpay.com/in/features/pricing | 2026-09-22 | Awlencan India | futures tiers, GST statement, funding formula, liquidation clearance fee, spot fees, sections 1 to 7 |
| S2 | ZebPay Legal and Privacy, Terms of use and Futures Trading Policy | https://zebpay.com/in/legal-privacy | 2026-09-22 | Awlencan India | operator, residency rule, counterparty, pricing algorithm, funding interval, section 1, 6 and 7 |
| S3 | "Futures just got a big upgrade", modified 13 May | https://help.zebpay.com/support/solutions/articles/44002726885-futures-just-got-a-big-upgrade- | 2026-09-22 | ZebPay help centre | Zero Fees category, section 5 |
| S4 | "ZebPay Futures: Trade USDT Pairs Using INR as Margin", modified 6 May 2025 | https://help.zebpay.com/support/solutions/articles/44002621329-zebpay-futures-trade-usdt-pairs-using-inr-as-margin | 2026-09-22 | ZebPay help centre | no fee on INR margin conversion, section 5 |
| S5 | CCXT 4.5.68 `zebpay.js` | `server/node_modules/ccxt/js/src/zebpay.js` | 2026-09-22 | CCXT | lines 27, 33, 34, 91, 176, 1660, 1712, section 3 and 8 |
| S6 | ZebPay API references, futures public endpoints, commit `1be7da7` of 2026-09-19 | https://github.com/zebpay/zebpay-api-references | 2026-09-22 | ZebPay | fee call shapes, section 2 |
| P1 | `rest-probe.mjs catalog` at 04:21 UTC, rerun in the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/zebpay/rest-probe.mjs) | 2026-09-23 | this host | fee sets, catalog, transaction types, CCXT values |
| P2 | `rest-probe.mjs anchor` at 04:21 UTC and the futures web app bundle, build `0Kc68usOOBbT9wHTy5daF` | [`rest-probe.mjs`](../../../scripts/probes/venues/zebpay/rest-probe.mjs) | 2026-09-23 | this host | INR factor, funding factor, intervals against Binance, tier-info URL |
| P3 | `rest-probe.mjs mirror` at 04:22 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zebpay/rest-probe.mjs) | 2026-09-23 | this host | Binance contract types of the 248 USDT symbols |
