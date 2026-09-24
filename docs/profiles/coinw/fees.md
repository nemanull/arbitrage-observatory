# CoinW Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 02:38 to 03:10 UTC, from the development host near Seattle.

This profile covers the fees of the CoinW perpetual futures, which CCXT does not implement.
The public API answered this host, and the rest of `www.coinw.com` did not.
Every page of `www.coinw.com` outside `/api-doc/`, and the help center at `coinw.zendesk.com`, returned HTTP 403 with a Cloudflare "Just a moment..." challenge to curl from this host, and HTTP 403 to the fetch tool, which does not originate here.
So the fee page, the legal statement and the funding and mark price articles were not read, and every claim that depends on them says where it came from instead.
The venue's own `GET /v1/perpum/instruments` reply carries a fee on every contract, and that is the primary source below, see [`rest.md`](./rest.md) section 2.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | CoinW, established 2017, CoinGecko trust rank 28, CoinGecko derivatives id `coinw_futures` | S6 |
| legal entities | Not verified. The legal statement returned 403. A secondary source says CoinW holds a FinCEN MSB registration "without any authorization to serve US customers" | S7 |
| headquarters | Dubai, United Arab Emirates, per a review of 2025-04-14 | S5 |
| who may trade perpetuals | an account holder outside the restricted list, after a futures risk quiz that activates the futures account | S1 precautions page, S7 |
| regions excluded | the secondary source lists Afghanistan, Algeria, Bahamas, Bangladesh, Barbados, Bolivia, Botswana, Burundi, Mainland China, Cambodia, Canada, Congo, Crimea, Cuba, Egypt, Ethiopia, Ghana, Hong Kong, Jamaica, Japan, Iran, Iraq, Laos, Lebanon, Libya, Mali, Myanmar, Mongolia, Morocco, Nepal, Nicaragua, North Korea, Pakistan, Panama, Qatar, Singapore, Somalia, Sri Lanka, Sudan, Syria, Tunisia, the United States, the U.A.E., Uganda, Venezuela and Zimbabwe, attributed to CoinW's "Legal Statement" | S7 |
| US persons | may not trade, per the same secondary source. The official statement was not read | S7 |
| public API from this host | answered: REST `api.coinw.com` with HTTP 200 behind Cloudflare, WebSocket `ws.futurescw.com` with 101 behind a CDN named "Cdn Cache Server V2.0" | P1, P2 |

The restricted list names the United States and the U.A.E., while the review places the headquarters in Dubai.
Both come from secondary sources, and the official legal statement at `https://www.coinw.com/tr_TR/help-center/faq/official-updates/2025-09-15/legal-statement/6585` is the page that would settle them.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals, 385 contracts | 0.02 %, 200 ppm | 0.06 %, 600 ppm | `makerFee` `"0.0002"` and `takerFee` `"0.0006"` on 387 of 387 rows of `GET /v1/perpum/instruments`, P1. A search result snippet of `https://www.coinw.com/fees` gives the same pair, S3 |
| USDC-M perpetuals, 2 contracts | 0.02 %, 200 ppm | 0.06 %, 600 ppm | the same rows, P1 |

The maker rate has two published values.
A press release of 2024-11-15 says CoinW "permanently reduced its futures trading Maker fee to 0.01%", from 0.04 %, with a 0.06 % taker, S4.
CoinGecko's venue description and the 2025-04-14 review also say 0.01 % maker and 0.06 % taker, S5 and S6.
The API reply of 2026-09-23 says 0.02 % maker on every contract, and so does the fee page's search snippet.
The taker is 0.06 % in every source, and the taker is the number the engine uses.

## 3. Coverage matrix

| product | present | count on 2026-09-23 UTC | source |
|---|---|---|---|
| USDT-M perpetuals | yes | 385, all `online` | P1 catalog |
| USDC-M perpetuals | yes | 2, `BTC_USDC` and `ETH_USDC`, both `online` | P1 catalog |
| coin-M perpetuals | no | 0 in the API. The tickers call documents `contract_id` 1 as "linear perpetuals", but the field is the contract id, see [`rest.md`](./rest.md) section 2 | P1 catalog, S1 |
| `…PROPW` perpetuals | in the tickers reply only | 17, such as `BTCPROPWUSDT`, maximum leverage 5, not in the instruments reply, meaning Not publicly specified | P1 catalog |
| contracts CoinGecko lists that the API catalog omits | yes | CoinGecko lists 455 perpetuals, and 70 of them are not in the instruments reply. They are mostly equity names such as `AVGO`, `AMAT` and `ARM`, last traded days before. `AVGO` still answers the REST book and last settled funding | P1, S6 |
| dated futures | no | CoinGecko `number_of_futures_pairs` 0, and no delivery call in the API | S6, S1 |
| options | no | none in the API reference | S1 |
| spot | yes | not detailed, CoinGecko's description says "more than 500 spot trading pairs" | S6 |

The 387 instruments include equity-named contracts, such as `SKHYNIX`, `SAMSUNG`, `DELL`, `IBM`, `MSTR`, `CRCL` and `SNDK`.
The `tradfiTag` field was empty on all 387 rows, so the API gives no flag that separates them from crypto, P1.

## 4. Perpetual tiers

No perpetual tier table was read, because the fee page returned 403.
All 387 contracts carry the same `takerFee` `"0.0006"`, `makerFee` `"0.0002"` and `commissionRate` `0.0006` in the unauthenticated catalog, P1.
The 2025-04-14 review describes futures fees as "fixed maker and taker fees", and places the CWT-holding VIP levels on spot only, S5.
A search result summary says "VIP level upgrades for futures trading are currently not supported", and its source page was not identified, so that sentence is Not verified.

### Qualification

Not publicly specified in any source this host or the fetch tool could read.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| CWT holding | VIP levels by CWT holding apply to spot, per the review | S5 |
| Mega Coupon | "can be used as initial margin or to offset trading fees, losses, and funding payments in futures trading" | S1 precautions page |
| zero fees on new pairs | an article titled "CoinW Futures, Zero Fees for Taker/ Makers on New Trading Pairs" exists, and it returned 403, so its pairs and end dates are Not verified | S8 |
| referral, market maker | Not publicly specified | |

Each instrument row also carries `openSpread` and `closeSpread`, documented only as "Opening spread" and "Closing spread".
They were 0.0003 and 0.0002 on 359 and 358 contracts, 0.0001 on 27 and 28, and one contract each had other values, P1.
Whether a market order pays these on top of the taker fee is Not publicly specified, and the probe placed no order.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| intervals | 8 h on 211 contracts, 4 h on 175, 1 h on 1 (`G`), from `settledPeriod` | P1 catalog |
| settlement instants | 8 h contracts next settled at 08:00 UTC, 4 h at 04:00, the 1 h at 03:00, read at 02:43 UTC, and the last settled funding was stamped 00:00 UTC for 8 h and 4 h contracts and 02:00 for `G` | P1 catalog and funding |
| published rate | the socket's `funding_rate` channel sends `r`, a fraction per interval, every 5 s, with `h` the interval in hours and `nt` the next settlement in ms. The REST `fundingRate` call returns the last settled rate only | P2, S1 |
| relation to Binance | on 164 of 165 contracts that both list, the socket's `r` equalled Binance USD-M `lastFundingRate` read right after it, in both runs | P2 anchorbatch |
| observed range | over 171 contracts, the lowest `r` was -0.004099 and -0.004149 on `ONE`, 4 h, and the highest 0.00056839 and 0.00055309 on `ARC`, 4 h, in two runs. 75 read 0.00005 and 51 read 0.0001 in both | P2 anchorbatch |
| formula, cap and floor | Not verified. The funding article returned 403. Its search snippet says "Funding Fee = Position Notional Value × Current Funding Rate", with notional at the mark price, and "When the funding rate is positive, longs pay shorts" | S9 |
| trading during settlement | "During the funding period, operations related to transaction such as placing orders or closing positions are not permitted", and "The funding process typically takes 30 to 40 seconds" | S1 precautions page |

The settlement instant itself was not captured, because this survey never waits for one.
The halt around settlement matters for a taker leg: an order sent in the 30 to 40 s window is refused.

## 7. Liquidation, settlement and delisting

Not verified.
The trading rules at `https://www.coinw.com/trading-rules` and the help center returned 403.
The instrument rows carry `stopSurplusRate` and `stopCrossPositionRate`, documented as the minimum remaining margin ratio and the cross margin risk rate, and a `configBo.margins` table by leverage, P1 and S1.
A liquidation fee, a settlement fee and a delisting procedure are Not publicly specified in the API reference.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `coinw` | P1 catalog, `node -e "console.log(require('ccxt').exchanges)"` run from `server/` |
| CCXT master on GitHub | no `coinw.ts` in `ts/src` at commit `1d8b674` of 2026-09-22 12:48 UTC, 105 `.ts` files listed, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/coinw.ts` returns 404 | S10 |
| pending work | pull request #15929 "New exchange: Coinw (public methods)", open since 2022-12-02 and last updated 2026-09-20, adds a spot-only `coinw.ts` with `'swap': undefined, // has but unimplemented`. Pull request #17234 "New exchange: Coinw (private methods)" and issue #21381 "New Exchange: CoinW" are open | S10 |
| `market.taker` for a swap | none, since there is no class to load | |

So there is no CCXT source line to cite, and no `ccxtTakerPpm` to declare.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | `takerFee` `"0.0006"` on every contract, and 0.06 % in every source |
| `ccxtTakerPpm` | unset | no CCXT class exists |

A registry entry needs a catalog loader first, because the engine's catalog is CCXT `loadMarkets`, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinW API documentation: Introduction, Precautions, Futures Trading market pages, Change Log | https://www.coinw.com/api-doc/en/common/precautions and https://www.coinw.com/api-doc/en/futures-trading/market/get-instrument-information | 2026-09-22 | CoinW, global | fee fields, coupon, funding halt, futures activation, sections 1 to 7 |
| S2 | CoinW fees page | https://www.coinw.com/fees | 2026-09-22, HTTP 403 to curl and to the fetch tool | CoinW | not read |
| S3 | web search result snippet for the fees page | https://www.coinw.com/fees | 2026-09-22 | CoinW | "0.02% for makers and 0.06% for takers", section 2 |
| S4 | "CoinW Slashes Futures Trading Maker Fee to Industry-Low 0.01%", Newsworthy.ai, 2024-11-15 | https://www.newsworthy.ai/curated/coinw-slashes-futures-trading-maker-fee-to-industry-low-0-01-res/20248596 | 2026-09-22 | CoinW | maker 0.01 % from 0.04 %, taker 0.06 %, section 2 |
| S5 | "CoinW Review 2026", Coin Bureau, last updated 2025-04-14 | https://coinbureau.com/review/coinw-review | 2026-09-22 | CoinW | fixed futures fees, CWT VIP on spot, Dubai, sections 1, 2 and 4 |
| S6 | CoinGecko derivatives exchange `coinw_futures` with tickers | https://api.coingecko.com/api/v3/derivatives/exchanges/coinw_futures?include_tickers=all | 2026-09-23 UTC | CoinW | 455 perpetuals, 0 futures, description fees, sections 1 to 3 |
| S7 | "CoinW Supported and Restricted Countries (2026)", Datawallet, updated 2026-07-13 | https://www.datawallet.com/crypto/coinw-restricted-countries | 2026-09-22 | CoinW | restricted list, US, FinCEN MSB, section 1 |
| S8 | help center article titles | https://coinw.zendesk.com/hc/en-us/articles/29292122142873-CoinW-Futures-Zero-Fees-for-Taker-Makers-on-New-Trading-Pairs | 2026-09-22, HTTP 403 | CoinW | title only, section 5 |
| S9 | "Introduction to CoinW Futures Funding Rates", search result snippet | https://coinw.zendesk.com/hc/en-us/articles/22097751078169-Introduction-to-CoinW-Futures-Funding-Rates | 2026-09-22, page HTTP 403 | CoinW | funding fee formula and direction, section 6 |
| S10 | CCXT on GitHub: commits API, `ts/src` listing, pull requests #15929 and #17234, issue #21381 | https://github.com/ccxt/ccxt | 2026-09-23 UTC | CCXT | section 8 |
| P1 | `rest-probe.mjs`, every mode, in two runs at 02:43 and 02:55 UTC, and `errors`, `binance` and `funding` again at 03:06 to 03:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinw/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 8 |
| P2 | `ws-probe.mjs` modes `anchor` and `anchorbatch` | [`ws-probe.mjs`](../../../scripts/probes/venues/coinw/ws-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
