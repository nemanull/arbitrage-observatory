# WazirX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 05:08 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

WazirX is CoinGecko's trust rank 107 on the survey list, and 110 in the CoinGecko API on 2026-09-23, and it has no CCXT class.
CoinGecko's derivatives list does not show it, but WazirX does list perpetuals, so this profile covers the perpetuals and names spot only in the coverage matrix.
Every WazirX perpetual turned out to be a Binance USD-M perpetual under the same name, with Binance's ticker, mark and index, and a book built from Binance's book, see [`rest.md`](./rest.md) section 2.
That shapes every section below.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/wazirx/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/wazirx/ws-probe.mjs).

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC, for every source row | source ledger |
| operator | Zanmai Labs Private Limited, Mumbai, India, registered with the Financial Intelligence Unit India under VA00031068 | S6, recital E |
| ownership context | the crypto-to-crypto services "previously operated by Binance since November 2019" are now operated by Zanmai under a Singapore scheme of arrangement, "subject to the ongoing dispute between Zettai Pte. Ltd. and Binance regarding the ownership of the WazirX Platform" | S6, recital B |
| restructuring context | trading restarted in phases from 2025-10-24 after the July 2024 hack, and the futures launch post says futures profits go to "additional recoveries for eligible creditors who hold Recovery Tokens" | S19, S1 |
| CoinGecko listing | "WazirX", India, established 2018, trust score 5, trust rank 110, 24 h volume 7.96 BTC, and absent from the 214 derivatives exchanges | S15, read 2026-09-23 04:59 UTC |
| who may open an account | the user represents "YOU ARE AN INDIAN NATIONAL AND ACCESSING THE SERVICES FROM INDIA" | S6, recital F |
| foreign nationals | "Currently, individuals with foreign KYC cannot sign up for a WazirX account." | S7, updated 2026-09-15 |
| excluded regions | anyone subject to sanctions or resident in a country that is itself sanctioned by the US, the UN or the EU | S6, clause 2.6 |
| US persons | not eligible, since only Indian nationals with Indian KYC in India may sign up | S6, S7 |
| who may trade futures | an account holder who passes a multiple choice knowledge quiz and accepts separate Futures Terms and Conditions in the app | S5 |
| futures terms | not public: the web app reads the link from a config key `futuresTermsOfService` that the public `global_configs` reply does not carry, and three guessed S3 names answered 403 | web bundle `index-CwsGc9qE.js`, `https://x.wazirx.com/api/v2/global_configs` on 2026-09-23 |
| official pages from this host | `docs.wazirx.com` 200 with 345,799 bytes, `support.wazirx.com` 200, the Zendesk help center API 200, `wazirx.com/blog` 200. `wazirx.com/fees` returns the 5,790 byte shell of a single page app | curl at about 04:26 UTC |
| API from this host | every public REST and WebSocket endpoint answered normally, with no geoblock | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

All access results above are from the Canadian VPN exit, not from an Indian or a US address.

## 2. Quick answer

| family | maker | taker | ppm maker | ppm taker | source |
|---|---|---|---:|---:|---|
| INR-quoted perpetuals, INR margin | 0.02 % | 0.04 % | 200 | 400 | S1, S2 |
| USDT-quoted perpetuals, INR margin | 0.02 % | 0.04 % | 200 | 400 | S1, S2, the USDT family launched after S1 and no separate schedule was found |
| with 18 % GST on the commission | 0.0236 % | 0.0472 % | 236 | 472 | GST is booked as its own income type, S4, and 18 % is the rate WazirX applies to its other fees, S12, S14 |

The launch post says "WazirX Futures will have a maker fee of 0.02% and a taker fee of 0.04%. Among Indian crypto exchanges, this is the lowest fee, with no volume threshold required to access it.", S1.
The futures fee page in the help center gives no number and says "Fee rates may change over time", S3.
So 400 ppm is the published VIP 0 taker, and 472 ppm is what a taker pays once GST is added.

## 3. Coverage matrix

| product | present | count on 2026-09-23 | evidence |
|---|---|---|---|
| INR-quoted perpetuals, INR margin and INR settlement | yes | 229 | `/fapi/v1/exchangeInfo`, [`rest.md`](./rest.md) section 2 |
| USDT-quoted perpetuals, INR margin at a fixed rate | yes | 221 | same call, S13 |
| tokenized stock, metal and energy perpetuals | yes, inside both families | 61 category tags: 43 Global Markets, 12 Metals, 6 Energy | same call, `categories` |
| USDT-margined or coin-margined perpetuals | no | 0 | every contract has `marginAsset` `INR` |
| dated futures | no | 0 | every contract has `contractType` `PERPETUAL`, and the docs list no delivery contract, S4 |
| options | no | 0 | S4 |
| spot | yes, named only | 407 markets: 104 INR, 303 USDT, of which 99 and 226 `trading` | `/sapi/v1/exchangeInfo`, `rest-probe.mjs catalog` |
| P2P | yes, named only | 8 markets | `https://x.wazirx.com/api/v3/market-status` |

Spot fees, for the record only: the INR table starts at 0.40 % for under 5 lakh INR of 30 day volume and under 500 WRX, 0.472 % with GST, and falls to 0.10 %, S14.
USDT spot markets carry the label "0.2% | Incl. Appl. Taxes", S14.
Deposit, withdrawal and earn schedules are in the `assets` array of the same `market-status` reply.

## 4. Perpetual tiers

One tier is published for every user: maker 0.02 % and taker 0.04 %, with "no volume threshold", S1.
No VIP table, volume tier or market maker tier for futures was found in the API docs, the help center, the blog or the public config replies.
The docs offer "a dedicated rate-limit tier" to high throughput integrators, but no fee tier, S4.

## 5. Discounts that change the perpetual taker

| discount | effect on the futures taker | evidence |
|---|---|---|
| WazirX ZERO subscription | ₹99 a month plus 18 % GST for "unlimited trading with zero trading fee" across "supported markets" | S12. Whether futures are a supported market is Not publicly specified |
| WRX holdings | spot fee slabs depend on WRX held and 30 day INR volume | S14, spot only. No futures slab is published |
| `FEE_DISCOUNT` income type | the futures income history can carry a fee discount | S4. Its size and rule are Not publicly specified |
| referral and promotions | none found for futures | help center search for "fee", "ZERO" and "taker" on 2026-09-23 |

The docs example of an account trade shows `"quoteQty": "57000.00"`, `"commission": "28.50"` and `"maker": false`, which is 0.05 %, and the own trade stream example shows a fee of 0.07 INR on a 7 INR trade, S4.
Both are illustrations and disagree with each other, so neither is taken as a rate.

## 6. Funding as a cost

| item | value | evidence |
|---|---|---|
| direction | "If the funding rate is positive, Long positions pay Short positions", and the reverse when negative | S9 |
| formula | Not publicly specified | S4 and S9 give none |
| published rate | `lastFundingRate` in `/fapi/v1/premiumIndex`, 450 of 450 contracts, with up to 9 decimals | [`rest.md`](./rest.md) section 3 |
| observed relation to Binance | near 0.9 or 1.1 times Binance's predicted rate, equal to it on 53 and 58 of 221 USDT contracts in two reads, and different between the INR and USDT twin of the same base on 72 and 73 of 197 twins | `rest-probe.mjs funding`, [`rest.md`](./rest.md) section 4 |
| interval | not published by WazirX. `nextFundingTime` equalled Binance's on 450 of 450 contracts in three reads, and Binance runs 308 of the mapped contracts at 4 h, 141 at 8 h and 1 at 1 h | `rest-probe.mjs catalog` |
| cap and floor | Not publicly specified. Observed range −0.002875 to 0.000828 in the first read and −0.002944 to 0.000888 in the second, on 2026-09-23 | `rest-probe.mjs catalog` |
| tax on funding | the income types include `GST_ON_FUNDING_FEE` next to `FUNDING_FEE` | S4 |
| TDS | futures are exempt from the flat 1 % TDS "because trades are settled in INR" | S8 |

GST on a funding payment is a cost on top of the rate itself.
Who bears it, the payer or both sides, is Not publicly specified.
The settlement instant itself was not captured, and no public funding history endpoint exists, since `/fapi/v1/fundingRate` answers 403, see [`rest.md`](./rest.md) section 6.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| liquidation | "Your position is automatically closed" and "You may lose the margin allocated to that position" | S11 |
| liquidation fee | Not publicly specified | S4, S11 |
| clearance fee | the income types include `CLEARANCE_FEE` and `GST_ON_CLEARANCE_FEE`, with no amount or rule | S4 |
| settlement currency | INR for both families. USDT-quoted contracts convert margin and P&L at a fixed USDT-INR rate that WazirX displays, 102 in the catalog reply | S13, `conversionRates` in [`rest.md`](./rest.md) section 2 |
| delisting | open positions still open at the delisting time are closed "at the prevailing market price" | S10 |
| delisting pace | 26 INR contracts go on 2026-09-28 at 12 PM IST, and thirteen earlier futures delisting notices since 2026-06-05 named 1 to 10 contracts each | S10, help center search for "futures" on 2026-09-23 |

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 `ccxt.exchanges` from `server/` | 104 ids, none matching `waz` or `wrx`, `rest-probe.mjs catalog` |
| `server/node_modules/ccxt/js/src/` | no `wazirx.js` |
| CCXT master `ts/src` on GitHub, 2026-09-23 | 112 entries, no `wazirx.ts`, S16 |
| history | CCXT had a `wazirx` spot class, and removed it in "delist wazirx (#25277)" on 2025-02-13, whose description reads "trading is disabled" and links the 2024 WazirX hack, S16 |
| the removed class | spot only, `'spot': true` and `'swap': false` at lines 23 and 25, REST base `https://api.wazirx.com/sapi/v1` at `ts/src/wazirx.ts` line 124, fees read from `this.fees[quote]` with a default of `'0.2'` percent at lines 325 to 328, commit `ca0c70a6d3`, S17 |

So `market.taker` has no value to report, and `ccxtTakerPpm` is null.
A catalog would have to be built from `/fapi/v1/exchangeInfo`, see [`rest.md`](./rest.md) section 2.

## 9. Recommended registry values

No registry entry is recommended, because the verdict is that WazirX adds no independent price, see [`websocket.md`](./websocket.md) section 8.
If an adapter is built anyway, the values would be these.

| field | value | reason |
|---|---|---|
| `takerPpm` | 472 | the published 0.04 % taker plus 18 % GST on the commission, the cost a taker actually pays |
| `ccxtTakerPpm` | unset | no CCXT class exists |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WazirX Launches Crypto Futures, published 2026-05-13, modified 2026-07-01 | https://wazirx.com/blog/wazirx-launches-crypto-futures/ | 2026-09-23 | Zanmai, India | maker 0.02 %, taker 0.04 %, no volume threshold, restructuring link, sections 1, 2, 4 |
| S2 | 5 Best Crypto Futures Trading Platforms in India in 2026, published 2026-07-27 | https://wazirx.com/blog/5-best-crypto-futures-trading-platforms-in-india-in-2026/ | 2026-09-23 | Zanmai, India | "0.02% maker and 0.04% taker fees", section 2 |
| S3 | What fees are charged for Futures trading?, updated 2026-09-05 | https://support.wazirx.com/hc/en-us/articles/10894874472346 | 2026-09-23 | Zanmai, India | no number, "Fee rates may change over time", section 2 |
| S4 | WazirX API documentation, spot and futures | https://docs.wazirx.com/ | 2026-09-23 | Zanmai, India | income types, rate limits, examples, sections 2, 5 to 7 |
| S5 | How to Get Started with Crypto Futures Trading on WazirX, updated 2026-09-14 | https://support.wazirx.com/hc/en-us/articles/10182139665562 | 2026-09-23 | Zanmai, India | quiz, terms, futures wallet, section 1 |
| S6 | WazirX User Agreement, PDF created 2025-10-23 | https://s3.ap-south-1.amazonaws.com/wrx-assets/WazirXUserAgreement.pdf | 2026-09-23 | Zanmai Labs Private Limited, India | entity, eligibility, sanctions clause 2.6, section 1 |
| S7 | Can foreign nationals create an account on WazirX?, updated 2026-09-15 | https://support.wazirx.com/hc/en-us/articles/360000654353 | 2026-09-23 | Zanmai, India | foreign KYC refused, section 1 |
| S8 | How are Crypto Futures profits taxed in India?, updated 2026-08-22 | https://support.wazirx.com/hc/en-us/articles/10894871820826 | 2026-09-23 | India | TDS exemption, section 6 |
| S9 | What is a funding fee?, updated 2026-08-10 | https://support.wazirx.com/hc/en-us/articles/10894828978202 | 2026-09-23 | Zanmai, India | funding direction, section 6 |
| S10 | WazirX Futures Will Delist Certain Pairs on 28th September, 2026, created 2026-09-22 | https://support.wazirx.com/hc/en-us/articles/11274655348122 | 2026-09-23 | Zanmai, India | delisting rule and list, section 7 |
| S11 | What is liquidation in Futures trading?, updated 2026-06-12 | https://support.wazirx.com/hc/en-us/articles/10894858581146 | 2026-09-23 | Zanmai, India | liquidation, section 7 |
| S12 | FAQs on WazirX ZERO, updated 2026-09-16, and How to Subscribe to WazirX ZERO, updated 2026-09-08 | https://support.wazirx.com/hc/en-us/articles/9995397097626 and https://support.wazirx.com/hc/en-us/articles/10078101037850 | 2026-09-23 | Zanmai, India | ZERO plan, 18 % GST, section 5 |
| S13 | Introducing Crypto-USDT Futures on WazirX, published 2026-08-11 | https://wazirx.com/blog/introducing-crypto-usdt-futures-on-wazirx/ | 2026-09-23 | Zanmai, India | USDT family, INR margin at a fixed rate, sections 3 and 7 |
| S14 | public market status reply with the spot fee table | https://x.wazirx.com/api/v3/market-status | 2026-09-23 | Zanmai, India | spot fees with and without GST, section 3 |
| S15 | CoinGecko API, `exchanges/wazirx` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/wazirx | 2026-09-23 | CoinGecko | listing context, section 1 |
| S16 | CCXT GitHub, `ts/src` listing on master and the commit history of `ts/src/wazirx.ts`, PR 25277 | https://github.com/ccxt/ccxt/pull/25277 | 2026-09-23 | CCXT | no class, delisting, section 8 |
| S17 | CCXT `ts/src/wazirx.ts` at commit `ca0c70a6d3`, the last before the delisting | https://github.com/ccxt/ccxt/blob/ca0c70a6d3/ts/src/wazirx.ts | 2026-09-23 | CCXT | removed spot class, section 8 |
| S18 | WazirX May 2026 Product Update, published 2026-06-09 | https://wazirx.com/blog/wazirx-may-2026-product-update/ | 2026-09-23 | Zanmai, India | futures open to every user in May 2026, 30,000 early access traders, 20x leverage in May |
| S19 | Trading to Resume on WazirX with Zero Trading Fee from 24th October, created 2025-10-24, updated 2026-07-13 | https://support.wazirx.com/hc/en-us/articles/9865129990554 | 2026-09-23 | Zanmai, India | phased restart from 2025-10-24, section 1 |
| P1 | `rest-probe.mjs catalog`, `funding` and `errors`, runs at 04:35 to 04:49 UTC, 04:56 to 04:58 UTC and 05:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/wazirx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | CCXT list, catalog counts, funding comparisons, sections 3, 6, 8 |
