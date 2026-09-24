# Mudrex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:16 to 04:31 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare loc=CA, SEA edge).

This profile covers Mudrex (CCXT id `mudrex`), an Indian retail crypto app whose futures product is USDT-quoted linear perpetuals margined in USDT or INR.
Mudrex lists perpetuals although CoinGecko's derivatives list does not show it: 745 perpetual symbols answered on the public socket, see [`rest.md`](./rest.md) section 2.
The trading API, the catalog included, needs an API secret that only a KYC-verified Indian account can create, so nothing here was read from an authenticated call.
Every access result below is from the Canadian VPN exit named above.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local, 2026-09-23 UTC | S1 to S6 |
| legal entities | Mudrex INC., Delaware, "which owns and operates the 'Mudrex' Technology Platform in US". Mudrex TR UAB Holdings, Vilnius, Lithuania, for residents of Lithuania and the EU. RPFAS Technologies Private Limited, India, for residents of India | S3 |
| entity behind derivatives | "Prices and execution are offered by Mudrex TR." | S3, section on derivatives |
| entity behind the API | RPFAS Technologies Private Limited, under the laws of India with courts in Bengaluru | S5, clauses 1.1 and 17 |
| who may use the API | "only to users who have successfully completed Know Your Customer ("KYC") verification", S5 clause 2.1, and the key requires "KYC (PAN & Aadhaar) verification and enable two-factor authentication (TOTP)", S4 | S4, S5 |
| excluded regions | Restricted Locations "at this time include Hong Kong, Belgium, Cuba, Iran, Japan, North Korea, Crimea, Malaysia, Singapore, Syria, United States of America including all U.S.A. territories", "the Bahamas, Canada", "Bolivia, Donetsk, Luhansk, and Malta" | S3, section 5 |
| US persons | may not trade, the United States is a Restricted Location | S3 |
| this host | the public market data REST and WebSocket answered from the Canadian exit with HTTP 200 and 101, and the catalog answered 401 `Invalid Authentication`, see [`rest.md`](./rest.md) section 1 | P1, P2 |

PAN and Aadhaar are Indian identity documents, so in practice the futures API is open to Indian residents only.
The futures landing page calls the product "tailored for India" and sells INR margin, S2.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | with 18 % GST |
|---|---|---|---|
| USDT-quoted linear perpetuals, USDT or INR margin | 0.02 %, 200 ppm | 0.05 %, 500 ppm | maker 0.0236 %, 236 ppm. Taker 0.059 %, 590 ppm |

The tier is called Non-Alpha, for a 30-day futures volume under ₹5 Cr, S1.
The fee page says "18% GST on Buy/Sell Trading fees is applicable.", S1, so an Indian trader pays 1.18 times the listed rate.
The API changelog for v1.0.10 on 2026-09-21 says trading fees moved "from a flat fee model to maker/taker", S6.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-quoted linear perpetuals | yes, 745 symbols with data on the public socket | P2 `streams`, [`rest.md`](./rest.md) section 2 |
| the same contracts margined in INR | yes, "The contracts are the same USDT-quoted linear perpetuals" | S4 overview |
| USDC perpetuals | absent: none of Bybit's 68 USDC perpetual symbols answered on the socket | P2 `streams` |
| coin-margined inverse perpetuals | absent: CCXT sets `inverse: false` at `server/node_modules/ccxt/js/src/mudrex.js` line 518, and `wss://trade.mudrex.com/fapi/v1/price/ws/inverse` answered 404 | S7, P2 `deflate` |
| dated futures | absent: CCXT `future: false` at line 33, and none of Bybit's 40 dated USDT futures answered on the socket | S7, P2 `streams` |
| options | absent: CCXT `option: false` at line 34, and none on the fee page | S7, S1 |
| spot | present in the app, INR-native with its own fee tiers, S1. No public spot API: the docs cover futures and spot wallet reads only, and `/fapi/v1/price/ws/spot` answered 404. CoinGecko counts 706 Mudrex pairs and 24.1 BTC of 24 h volume, and all 100 tickers on its first page are quoted in USDT | S1, S4, P2 `deflate`, S8 |

## 4. Perpetual tiers

Futures trading fees, from S1, retrieved 2026-09-22.
GST at 18 % is added on top of every row.

| tier | 30-day futures volume (INR) | maker | taker | maker ppm | taker ppm |
|---|---|---:|---:|---:|---:|
| Non-Alpha | under ₹5 Cr | 0.02 % | 0.05 % | 200 | 500 |
| Alpha 1 | ₹5 Cr to ₹20 Cr | 0.0192 % | 0.048 % | 192 | 480 |
| Alpha 2 | ₹20 Cr to ₹50 Cr | 0.0186 % | 0.0465 % | 186 | 465 |
| Alpha 3 | ₹50 Cr to ₹200 Cr | 0.018 % | 0.045 % | 180 | 450 |
| Alpha 4 | ₹200 Cr to ₹500 Cr | 0.016 % | 0.04 % | 160 | 400 |
| Alpha 5 | ₹500 Cr to ₹2,500 Cr | 0.014 % | 0.035 % | 140 | 350 |
| Alpha 6 | over ₹2,500 Cr | 0.012 % | 0.03 % | 120 | 300 |

### Qualification

"Futures trading volume from both USDT-Margined Futures and INR-Margined Futures is combined (in ₹) to determine Alpha tier eligibility. Tiers are calculated based on a rolling 30-day Futures trading volume.", S1.
No balance or holding rule is published.

## 5. Discounts that change the perpetual taker

| discount | status |
|---|---|
| volume tiers | the Alpha tiers of section 4, "our exclusive VIP program", S1 |
| exchange token | none, Mudrex has no fee token on S1 |
| referral | Not publicly specified on S1 or S4 |
| market maker program | Not publicly specified |
| zero fee promotions | none on S1 on 2026-09-22 |
| GST | a surcharge, not a discount: 18 % on every trading fee, S1 |

The private asset listing carries a `trading_fee_perc` field, and the documentation example shows `"0.1"` for `ETHUSDT`, S4.
That example predates or ignores the maker and taker split, and it could not be read for any real market without a key.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | Not publicly specified. The fee page says only "Funding Fee rates are dynamic and may vary based on market conditions." | S1 |
| interval | Not publicly specified. The private `funding_interval` field is "Unix epoch seconds of the next funding time", and the FAQ says to compare consecutive values "or ask support for the schedule" | S4, FAQ 40 |
| cap and floor | the private asset detail carries `max_funding_rate` and `min_funding_rate`, documented as "can be null" | S4 |
| rate | the private asset detail carries `funding_fee_perc`, documented as "Funding fee percentage", example `"0.0001"` | S4 |
| who pays | a `FUNDING` fee record, where "a negative `fee_amount` is a funding credit (paid to you rather than charged)" | S4, FAQ 30 |
| public source | none: no REST path and no socket stream carries a funding rate, see [`websocket.md`](./websocket.md) section 2 and [`rest.md`](./rest.md) section 3 | P1, P2 |

The settlement instant itself was not captured, and no funding history is public.
Mudrex's last price equals Bybit's and its mark follows Bybit's mark about a second behind, see [`rest.md`](./rest.md) section 4.
That makes it plausible that Mudrex also passes Bybit's funding rate through, but this is an inference that no public call can check.

## 7. Liquidation, settlement and delisting

No liquidation fee, insurance fund charge, settlement fee or delisting rule is published on S1, S2 or the liquidation article S9.
The mark is "Used for liquidation and funding calculations", S9.

## 8. CCXT

| item | value |
|---|---|
| class | `mudrex`, `server/node_modules/ccxt/js/src/mudrex.js`, 60 KB, `countries: ['IN']` at line 21 |
| `market.taker` | 0.00059, which is 590 ppm, from `fees.trading.taker` at line 151, copied into every market at line 519 |
| `market.maker` | 0.00023, from line 152, copied at line 520 |
| what they match | the Non-Alpha 0.05 % taker times 1.18 for GST is 0.059 %, and the 0.02 % maker times 1.18 is 0.0236 %, which CCXT writes as 0.023 % |
| without credentials | no market is returned: `loadMarkets` calls `privateGetFutures` at line 450, and `sign` calls `checkRequiredCredentials` at line 195 because `requiredCredentials.secret` is true at lines 143 to 146. The probe got `AuthenticationError: mudrex requires "secret" credential` before any request left the host, P1 `catalog` |

So CCXT 4.5.68 reports 590 ppm for a Mudrex swap market, but only after a Mudrex key has loaded the markets.

## 9. Recommended registry values

Mudrex should not be registered, because it has no public book and its catalog needs an Indian KYC key, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.
If an Indian account ever makes it reachable, the values would be as follows.

| field | value | reason |
|---|---|---|
| `takerPpm` | 590 | the Non-Alpha 500 ppm taker plus 18 % GST, which is what an Indian trader pays per fill |
| `ccxtTakerPpm` | omit | CCXT's 0.00059 already equals `takerPpm`, so the connector's check at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) line 38 passes without it |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Mudrex Fee Structure | https://mudrex.com/fee | 2026-09-22 | RPFAS Technologies, India | futures tiers, GST, Alpha rules, spot tiers, funding sentence, sections 2 to 6 |
| S2 | Trade Crypto Futures in INR | https://mudrex.com/futures | 2026-09-22 | Mudrex, India | "tailored for India", INR margin, section 1 |
| S3 | Mudrex Terms of Use | https://mudrex.com/terms | 2026-09-22 | all three entities | entities, derivatives by Mudrex TR, Restricted Locations, section 1 |
| S4 | Mudrex API docs: Overview, Authentication and Rate Limits, Asset listing, Asset by id, Fees, FAQ | https://docs.trade.mudrex.com/docs/overview (each page also as `.md`) | 2026-09-22 | RPFAS Technologies, India | PAN and Aadhaar KYC, INR margin, private asset fields, funding fields, sections 1, 3, 5, 6 |
| S5 | API Terms and Conditions | https://docs.trade.mudrex.com/docs/api-terms-conditions | 2026-09-22 | RPFAS Technologies, India | API entity, KYC clause 2.1, governing law, section 1 |
| S6 | API Changelogs, v1.0.10 of 2026-09-21 | https://docs.trade.mudrex.com/docs/changelogs | 2026-09-22 | RPFAS Technologies, India | move from flat to maker and taker, section 2 |
| S7 | CCXT 4.5.68 `mudrex.js` | `server/node_modules/ccxt/js/src/mudrex.js` | 2026-09-22 | CCXT | fee constants, credentials, product flags, sections 3 and 8 |
| S8 | CoinGecko exchange API for `mudrex` and the derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/mudrex | 2026-09-22 | CoinGecko | 706 pairs, 24.1 BTC volume, absent from the 214 derivatives exchanges, section 3 |
| S9 | Mudrex Learn articles on perpetuals, INR-margined futures and liquidation | https://mudrex.com/learn/inr-margined-crypto-futures/ | 2026-09-22 | Mudrex, India | mark used for liquidation and funding, section 7 |
| P1 | `rest-probe.mjs catalog`, two runs at 04:22 and 04:27 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/mudrex/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | 401 on the catalog, the CCXT error and constants, section 8 |
| P2 | `ws-probe.mjs streams` and `deflate`, two runs each between 04:17 and 04:30 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/mudrex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | 745 symbols, absent families, section 3 |
