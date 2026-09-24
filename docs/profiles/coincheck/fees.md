# Coincheck Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:47 UTC, from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare loc=CA, SEA edge), so every access result below is from that Canadian VPN exit.

This profile covers Coincheck (CCXT id `coincheck`), a Japanese spot exchange.
Coincheck lists no perpetual, no dated future and no option, so the spot market is profiled, as the survey plan's template change 1 says.
Every pair on the exchange is quoted in JPY.
The numbers come from the official fee page S1 and S2, the probes [`rest-probe.mjs`](../../../scripts/probes/venues/coincheck/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/coincheck/ws-probe.mjs), and CCXT 4.5.68.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Coincheck, Inc. (コインチェック株式会社), registered Crypto Asset Exchange Service Provider, Kanto Local Finance Bureau No. 00014, also a Type 1 Financial Instruments Business, Kanto Local Finance Bureau (kinsho) No. 3540, and a JVCEA member | footer of S1 |
| parent | Coincheck Group N.V., Amsterdam, listed as NASDAQ: CNCK | S7 |
| who may trade | identity verification is accepted only from a person whose country of residence is Japan and who is 18 to 74 years old, and registration from a person living outside Japan is not accepted | S5, S6 |
| excluded regions | every country other than Japan, since residence in Japan is the condition | S5, S6 |
| US persons | a person resident in the US may not open an account, since the condition is residence in Japan | S5, S6 |
| residence change | the terms let Coincheck cancel a registration when the user comes to reside in a country where it does not provide the service, Article 16 item 16 | S4 |
| public API access from this host | every public REST call and the public WebSocket answered from the Canadian VPN exit, with no geoblock | [`rest.md`](./rest.md) section 1 |

The documentation, the fee page and the terms were all fetched directly from this host with HTTP 200.
CoinGecko's exchange API reported Coincheck at trust score 5, trust score rank 107, and 646.8 BTC of 24 h volume at 04:25 UTC, and its derivatives exchange list does not name Coincheck, S8.

## 2. Quick answer

There is no perpetual on Coincheck, so the numbers that matter for the survey are the spot VIP 0 fees.
The schedule is flat per pair and has no volume tier, so VIP 0 is the only tier.

| market | maker | taker | ppm maker | ppm taker |
|---|---|---|---:|---:|
| BTC/JPY and 20 other pairs | 0.000 % | 0.000 % | 0 | 0 |
| ETC, IOST, FNCT, BRIL and FPL against JPY | 0.050 % | 0.100 % | 500 | 1,000 |

The 21 zero fee pairs are BTC, ETH, LSK, XRP, XEM, BCH, MONA, CHZ, IMX, SHIB, AVAX, DAI, WBTC, DOGE, PEPE, MASK, MANA, TRX, GRT, SOL and SUI against JPY, S1.
The same table is on the Japanese page, S2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | CCXT `has.swap` false at `server/node_modules/ccxt/js/src/coincheck.js` line 28, no derivative in the API documentation S3, not in CoinGecko's derivatives list S8 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | CCXT `has.future` false at line 29 |
| options | absent | CCXT `has.option` false at line 30 |
| margin | absent | CCXT `has.margin` false at line 27, and the account menu on S2 lists no leverage product |
| spot | present, 26 pairs, all quoted in JPY, all `available` | `GET /api/exchange_status`, [`rest.md`](./rest.md) section 2 |

The account menu on S2 lists the exchange (取引所), the broker desk (販売所), savings plans, crypto lending, large OTC trades, NFT and IEO, and no futures or leverage product.
CCXT's private API list still names `accounts/leverage_balance`, `exchange/leverage/positions` and two leverage transfers at `coincheck.js` lines 139, 147, 156 and 157, which the current documentation S3 does not mention.

## 4. Spot tiers

No tier table is published.
S1 gives one maker, one taker and one Itayose fee per coin, and CCXT marks the schedule `tierBased: false` at `coincheck.js` line 253.

| coin against JPY | maker | taker | Itayose |
|---|---|---|---|
| BTC, ETH, LSK, XRP, XEM, BCH, MONA, CHZ, IMX, SHIB, AVAX, DAI, WBTC, DOGE, PEPE, MASK, MANA, TRX, GRT, SOL, SUI | 0.000 % | 0.000 % | 0.000 % |
| ETC, IOST, FNCT, BRIL, FPL | 0.050 % | 0.100 % | 0.050 % |

The Itayose fee applies to fills in the call auction that reopens a pair after a halt, S1.
The Itayose column equals the maker column on every coin.
S1 says a fee on a JPY-amount purchase comes out of that amount, and a fee on a sale comes out of the proceeds.

## 5. Discounts that change the taker

None is published on S1 or S2.
Coincheck has no exchange token, and no market maker or referral schedule appears on the fee pages.
The broker desk (販売所) charges no stated fee and prices through its spread, which is outside the exchange book this profile covers.

## 6. Funding as a cost

Not applicable, since Coincheck lists no perpetual.

## 7. Liquidation, settlement and delisting

No liquidation or settlement charge exists on spot.
Deposit and withdrawal fees are on S9, the official lookup, and are not recorded here.
Two pairs in CCXT's static list, `fct_jpy` and `etc_btc`, are no longer listed, and the REST book answers 400 `invalid pair` for both, see [`rest.md`](./rest.md) section 6.

## 8. CCXT

| item | value | source |
|---|---|---|
| class-level constant | `fees.trading.taker` 0 and `maker` 0, `percentage: true`, `tierBased: false` | `server/node_modules/ccxt/js/src/coincheck.js` lines 251 to 257 |
| `market.taker` on BTC/JPY without credentials | `undefined` | `rest-probe.mjs catalog`, and a one-line check of `loadMarkets` at 04:40 UTC |
| why | each static market is built with `safeMarketStructure`, which sets `taker` and `maker` to `undefined`, and `setMarkets` applies the market after the trading fees, so the explicit `undefined` wins | `coincheck.js` line 171, `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3653 to 3654 and 3732 to 3735 |
| `fetchTradingFees` | private, reads `maker_fee` and `taker_fee` per pair | `coincheck.js` lines 99 and 723 to 730 |

CCXT 4.5.68 has no `fetchMarkets` of its own for Coincheck.
The base class returns the five hard-coded markets at `coincheck.js` lines 170 to 195, of which only `btc_jpy`, `etc_jpy` and `mona_jpy` are still listed, see [`rest.md`](./rest.md) section 2.
None is a swap, so the connector's `isActiveSwapMarket` at `server/src/ccxt/connector.ts` lines 196 to 202 keeps none.

## 9. Recommended registry values

None.
Coincheck has no perpetual, so it has no entry in `server/src/venues/registry.ts`.
If a spot stage ever used it, `takerPpm` would be 0 for BTC/JPY and the 20 other zero fee pairs and 1,000 for the five others, set per pair, because CCXT's `market.taker` is `undefined`.
`ccxtTakerPpm` would be left unset, since CCXT reports no per market taker to compare against.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading fee | https://coincheck.com/exchange/fee | 2026-09-22 | Coincheck, Inc., Japan | maker, taker and Itayose fee per coin, registration numbers, sections 1, 2 and 4 |
| S2 | 取引所手数料 | https://coincheck.com/ja/exchange/fee | 2026-09-22 | Coincheck, Inc., Japan | the same table in Japanese, the account menu, sections 2 and 3 |
| S3 | Coincheck Exchange API documentation | https://coincheck.com/documents/exchange/api | 2026-09-22 | Coincheck, Inc., Japan | public and private API, no derivative, section 3 |
| S4 | Coincheck 利用規約 (terms of service, file dated 2025-08-04) | https://coincheck.com/info/terms, which redirects to `https://assets.coincheck.com/uploads/agreement/document/english_file/Coincheck_Terms_of_Service_20250804_jp.pdf` | 2026-09-22 | Coincheck, Inc., Japan | Article 3 registration, Article 16 item 16 residence, section 1 |
| S5 | Coincheck（コインチェック）の口座開設方法と手順を解説 | https://coincheck.com/ja/article/267 | 2026-09-22 | Coincheck, Inc., Japan | "本人確認申請の受け付けは、次の条件にあてはまる方のみ": 居住国が日本, 18歳以上74歳以下, and "日本国外に居住" not accepted, section 1 |
| S6 | Coincheck（コインチェック）の本人確認にかかる時間は？ | https://coincheck.com/ja/article/96 | 2026-09-22 | Coincheck, Inc., Japan | the same residence and age condition, section 1 |
| S7 | Coincheck Group | https://coincheckgroup.com/ | 2026-09-22 | Coincheck Group N.V., Netherlands | parent and listing, section 1 |
| S8 | CoinGecko API, `exchanges/coincheck` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/coincheck | 2026-09-22 | CoinGecko | trust score, rank, volume, absence from the derivatives list, sections 1 and 3 |
| S9 | Fee (deposit and withdrawal) | https://coincheck.com/info/fee | 2026-09-22 | Coincheck, Inc., Japan | official lookup for transfer fees, section 7 |
| C1 | CCXT 4.5.68 `coincheck.js` | `server/node_modules/ccxt/js/src/coincheck.js` | 2026-09-22 | CCXT | `has` flags, static markets, fee constant, sections 3 and 8 |
| C2 | CCXT 4.5.68 `Exchange.js` | `server/node_modules/ccxt/js/src/base/Exchange.js` | 2026-09-22 | CCXT | why `market.taker` is `undefined`, section 8 |
| P1 | `rest-probe.mjs catalog`, 04:28 UTC and the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/coincheck/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | pair count, CCXT market fields, section 8 |
