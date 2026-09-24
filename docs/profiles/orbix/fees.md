# Orbix Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:24 to 05:01 UTC), from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocated to Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

Orbix (orbixtrade.com) is a Thai spot exchange, formerly Satang Pro and before that TDAX, which is why CoinGecko still files it under the id `tdax`.
It lists no perpetual, dated future, option or margin product, so this profile covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every one of its 111 pairs is quoted in Thai baht.
CCXT 4.5.68 has no class for it, and neither does CCXT master on GitHub, see section 8.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Orbix Trade Company Limited, "a company incorporated under the laws of Thailand" | S2 |
| owner | Unita Capital Co. Ltd, "a subsidiary of Kasikorn Bank", acquired Satang and rebranded it to Orbix | S6 public notice |
| licence | digital asset business of the exchange type (ประเภทศูนย์ซื้อขายสินทรัพย์ดิจิทัล) under the Thai SEC | S7, S5 |
| who may trade | an individual "must be at least 20 years of age", "must reside in Thailand", must hold a bank account opened in Thailand in the registered name, and a Thai telephone number | S2 section 2.1 clauses 1 to 4 |
| US persons | not named as excluded. A user "subject to compliance with the Foreign Account Tax Compliance Act (FATCA) must provide evidence of tax payment and their own compliance with FATCA", so a US person resident in Thailand is admitted on that condition, and a US person living outside Thailand fails the residence clause | S2 section 2.1 clauses 2 and 9 |
| foreigners | the public configs call returns `"kyc": {"foreigner_use_version": "closed", "thai_use_version": "v2"}`, which reads as onboarding of foreign nationals being closed. That reading is an inference from a field name | P1 |
| regions excluded | every region outside Thailand, by the residence clause, plus persons on the Thai AMLO lists and UN sanctions lists | S2 section 2.1 clauses 2 and 10 |
| public API from this host | every public REST call and every WebSocket stream answered normally through the Canadian VPN exit, with no geoblock, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | P1 to P7 |
| CoinGecko | trust score 5, trust rank 112 in the API on 2026-09-23 UTC against 109 in the survey's list, 27 pairs tracked, 3.45 BTC of 24 h volume, every ticker quoted in THB | S6 |
| freshness | fee call and FAQ read on 2026-09-22 local time. The FAQ article carries "Nov 18,2025" | P1, S3 |

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, every THB pair | 0.25 %, 2,500 ppm | 0.25 %, 2,500 ppm | `GET https://www.orbixtrade.com/api/trading-fees/` returned `{"exchange":{"maker_fee":"0.25","taker_fee":"0.25"}}` in both probe runs, P1. The FAQ says "The transaction fee for buying and selling all cryptocurrencies on the platform is 0.25% per transaction.", S3 |

The web app's "Trading Conditions & Fees" page reads the same call and falls back to 0.25 for both numbers when the call fails, S4.
The fee "will be automatically deducted from the transacted cryptocurrency amount", and the FAQ's examples are 2.50 THB on a 1,000 THB purchase and 12.50 THB on a 5,000 THB sale, S3.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | no futures path in the API collection S1, `/api/v3/premiumIndex`, `/api/v3/fundingRate` and `/api/fapi/v1/premiumIndex` answer 404, P3 |
| USDC-M and coin-M perpetuals | absent | same evidence |
| dated futures | absent | same evidence, and CoinGecko's derivatives list of 214 exchanges does not name Orbix, TDAX or Satang, S9 |
| options | absent | no options path in S1 |
| margin | absent | `isMarginTradingAllowed` is false on 111 of 111 symbols in `exchangeInfo`, P1 |
| spot | present, researched here | 111 pairs, all quoted in THB, 104 `TRADING` and 7 `BREAK`, P1 |
| brokerage | named in the web app only | the bundle names a `brokerage` platform with default pair `BTC_USDT` and paths `/broker/ticker/24h` and `/broker/depth`, S4. `https://www.orbixtrade.com/api/broker/ticker/24h` and `/api/broker/depth` answered nginx 404, P3, and `wss://www.orbixtrade.com/ws/broker/btc_usdt@depth20@1000ms` answered HTTP 404, P6, so nothing public serves it |

## 4. Spot tiers

No tier table is published.
The fee call returns one maker and one taker figure for the `exchange` platform and nothing else, P1.
The per pair fee call the web app uses, `GET /api/fees/?pair=btc_thb`, answered 401 `invalid_authentication_header`, so an account's own rate is not readable without a key, P3.
The trading rule page itself is served from a CMS that this host did not render, so any table on it beyond the two numbers the call returns is Not verified, S4.

## 5. Discounts that change the spot taker

None is published.
The FAQ applies 0.25 % to "all cryptocurrencies", S3.
No token discount, referral rebate, market maker programme or zero fee promotion was found in S1, S3 or the fee call.
The API documentation names "Market Maker customers" only in its rate limit table, S1.

## 6. Funding as a cost

Not applicable.
Orbix lists no perpetual and no margin, so there is no funding rate, no borrow interest and no settlement instant to capture.

## 7. Liquidation, settlement and delisting

- No leverage exists, so there is no liquidation charge.
- Spot trades settle on the Orbix ledger, and THB leaves through Thai bank withdrawal only, S2 clause 3.
- Seven pairs sit in status `BREAK` with `createOrderEnabled` false: `busd_thb`, `hbar_thb`, `ltc_thb`, `luna_thb`, `lunc_thb`, `xmr_thb`, `xzc_thb`, P1.
  Their REST book answers HTTP 500, see [`rest.md`](./rest.md) section 6.
- Withdrawal fees are looked up per coin and network through `/api/crypto-withdrawals/fees?network=&currency=`, which the trading rule page's "deposit-withdrawal-fee" tab calls, S4.
  They are not recorded here, per the scope guard.

## 8. CCXT

| check | result | evidence |
|---|---|---|
| CCXT 4.5.68 `ccxt.exchanges` | 104 ids, none matching `orbix`, `satang` or `tdax` | P1, `node -e "console.log(require('ccxt').exchanges)"` from `server/` |
| CCXT 4.5.68 files | no match under `server/node_modules/ccxt/js/src/` | `ls` of that folder, 2026-09-22 |
| CCXT master, `ts/src` | 105 `.ts` files at commit `1d8b674`, committed 2026-09-22 12:48 UTC, none matching | S8 |
| CCXT master, `ts/src/pro` | 78 entries, none matching | S8 |

So there is no `market.taker` to read, and `ccxtTakerPpm` has nothing to declare.

## 9. Recommended registry values

None.
Orbix cannot join the engine: it has no perpetual, no CCXT class for the catalog, and its only quote currency is THB, which [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6 does not fold into the USDT family.
If a THB spot leg were ever designed, `takerPpm` would be 2,500 from the fee call, and `ccxtTakerPpm` would stay unset because no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | orbix Trade API, Postman collection, published 2023-11-27 | https://docs.orbixtrade.com/ and https://docs.orbixtrade.com/api/collections/17936236/UV5UmKvP?segregateAuth=true&versionTag=latest | 2026-09-22 | Orbix Trade, Thailand | endpoint list, rate limit table, no futures, sections 3 and 5 |
| S2 | Terms and Conditions for Use of ORBIX Services | https://www.orbixtrade.com/en/legal/terms | 2026-09-22 | Orbix Trade Company Limited, Thailand | entity, section 2.1 qualifications, FATCA clause, sections 1 and 7 |
| S3 | FAQ, "What is the trading fee per transaction?", Nov 18 2025 | https://www.orbixtrade.com/en/blog/article/FAQ-Question-About-Crypto | 2026-09-22 | Orbix, Thailand | 0.25 % on all pairs, deduction examples, sections 2 and 5 |
| S4 | Orbix web app bundle | https://www.orbixtrade.com/exchange/assets/index-DGMi0for.js and https://www.orbixtrade.com/exchange/assets/esm-CZR8IjTb.js | 2026-09-22 | Orbix | the trading rule page calls `/trading-fees/` with a 0.25 fallback, brokerage paths, withdrawal fee lookup, sections 2, 3, 4 and 7 |
| S5 | Standard and compliance page | https://www.orbixtrade.com/en/about/compliances | 2026-09-22 | Orbix Trade Co.,Ltd | "under the supervision of the Securities and Exchange Commission of Thailand" |
| S6 | CoinGecko exchange page and API, id `tdax` | https://www.coingecko.com/en/exchanges/tdax and https://api.coingecko.com/api/v3/exchanges/tdax | 2026-09-22 | CoinGecko | former names, owner notice, trust rank, pairs, volume, section 1 |
| S7 | SEC Thailand licence check, company 0000028740 | https://market.sec.or.th/LicenseCheck/CompanyDetail/0000028740 | 2026-09-22 | SEC Thailand | licence type, section 1 |
| S8 | CCXT source on GitHub, `ts/src` and `ts/src/pro` on `master` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Orbix class, section 8 |
| S9 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | Orbix absent, section 3 |
| P1 | `rest-probe.mjs catalog` at 04:29, 04:46 and 04:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orbix/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | fee call, catalog, configs, CCXT ids, sections 1 to 4 and 7 to 8 |
| P3 | `rest-probe.mjs errors` at 04:30, 04:48 and 05:00 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orbix/rest-probe.mjs) | 2026-09-23 UTC | this host | 404 on the anchor and broker paths, 401 on the per pair fee call, sections 3 and 4 |
| P6 | `ws-probe.mjs variants` at 05:00 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/orbix/ws-probe.mjs) | 2026-09-23 UTC | this host | 404 on the broker socket, section 3 |
| P2, P4, P5, P7 | REST `book`, `poll` and `time`, and WebSocket `book`, `batch` and `silence` | [`rest.md`](./rest.md) section 9 and [`websocket.md`](./websocket.md) section 9 | 2026-09-23 UTC | this host | access, section 1 |
