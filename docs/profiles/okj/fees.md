# OKJ Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:11 to 03:35 UTC), from the development host near Seattle.

OKJ, formerly OKCoinJapan, is a Japanese spot exchange with no CCXT 4.5.68 class, and it lists no perpetual, dated future, option or margin product.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.
The help center pages at `support.okcoin.jp` answer this host with a Cloudflare challenge and HTTP 403, so the articles cited here were read as JSON through the public Zendesk help center API of the same host, `https://support.okcoin.jp/api/v2/help_center/ja/articles/<id>.json`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | OKCoin Japan K.K. (オーケーコイン・ジャパン株式会社) | S1 footer, "© 2026 OKCoin Japan K.K." |
| licence | crypto-asset exchange service provider, registration No. 00020 with the Kanto Local Finance Bureau | S1 footer, "暗号資産交換業者　関東財務局長　第00020号" |
| association | Japan Virtual and Crypto assets Exchange Association (一般社団法人日本暗号資産等取引業協会) | S1 footer |
| who may open an account | residents of Japan only, "日本に居住されている方のみ口座開設申込みが可能" | S5 |
| nationality | any nationality resident in Japan may apply, subject to country restrictions and review | S6 |
| US persons | a US person resident outside Japan cannot open an account, because residence in Japan is required. The United States is also on the list of countries a customer must declare no connection with before a crypto withdrawal | S5, S7 |
| other excluded regions | the declaration list as of June 2026: North Korea, Iran, Cuba, Syria, Crimea, Afghanistan, Central African Republic, DR Congo, Guinea-Bissau, Haiti, Iraq, Lebanon, Libya, Somalia, South Sudan, Sudan, Yemen, Belarus, Russia, the United States, the self-declared Donetsk and Luhansk republics, and the North Korean border region of north-east China | S7 |
| trading hours | 24 hours, 365 days, except announced maintenance | S4 |
| venue size | CoinGecko lists OKJ as `okcoin-japan`, trust score 7, rank 62, 41.04 BTC of 24 h volume, on 2026-09-23 03:27 UTC. The venue's own `platform-24-volume` read 208,621,784 JPY | S10, P1 |

The API accepts any caller for public data, see [`rest.md`](./rest.md) section 1.
Trading through it needs an OKJ account and therefore residence in Japan.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, exchange order book (取引所), level Lv1 | 0.07 %, 700 ppm | 0.14 %, 1,400 ppm | S1 |
| spot, broker desk (販売所) | no fee, the price carries a spread | no fee | S1 |

Both order book rates include Japanese consumption tax ("税込"), S1.
There is no perpetual taker, because there is no perpetual.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | `public/instruments?instType=SWAP` returned `{"code":"0","data":[],"msg":""}`, P1 |
| USDC-margined perpetuals | absent | same call, no row of any settlement asset, P1 |
| coin-margined perpetuals | absent | same call, P1 |
| dated futures | absent | `instType=FUTURES` returned an empty `data`, P1 |
| options | absent | `instType=OPTION` asks for `uly`, and `uly=BTC-JPY` answers code `51014` "Index doesn't exist", P1 |
| margin | absent | `instType=MARGIN` returned an empty `data`, P1, and the product menu of S1 lists no leverage product |
| spot | present | 47 pairs, all quoted in JPY, all `live`, P1 |

The documentation of S2 lists `SPOT` as the only instrument type on every public call.
The help center search for レバレッジ (leverage) returned 0 articles on 2026-09-22.

## 4. Spot tiers

One schedule applies to every pair on the exchange order book, S1.

| level | 30-day volume, JPY equivalent | maker | taker | taker ppm |
|---|---|---:|---:|---:|
| Lv1 | under 1,000,000 | 0.07 % | 0.14 % | 1,400 |
| Lv2 | 1,000,000 or more | 0.06 % | 0.12 % | 1,200 |
| Lv3 | 10,000,000 or more | 0.05 % | 0.10 % | 1,000 |
| Lv4 | 100,000,000 or more | 0.04 % | 0.08 % | 800 |
| Lv5 | 500,000,000 or more | 0.03 % | 0.07 % | 700 |
| Lv6 | 1,500,000,000 or more | 0.02 % | 0.06 % | 600 |
| Lv7 | 3,000,000,000 or more | negotiated (応相談) | negotiated | |

Qualification, from S1:

- The volume is the JPY value of every exchange order book trade over the last 30 days, across all pairs.
- The applied level is recomputed every day at 16:00 JST.
- A buy pays its fee in the base asset and a sell pays in the quote asset, deducted from what the trade delivers.
- The fee is rounded up to 8 decimal places.
- Corporate customers with stable volume may negotiate their rate.

## 5. Discounts that change the spot taker

| discount | effect on the taker | status on 2026-09-22 | source |
|---|---|---|---|
| token holding | none published | | S1 |
| referral (友達紹介) | no fee effect is published on S1 | | S1 menu |
| negative maker campaign on 20 pairs | maker -0.02 %, taker unchanged | ended 2025-01-31 16:00 JST | S8 |
| discount campaign on ADA, ARB, AVAX, DOGE, MKR, OP, SOL | maker -0.01 %, taker 0.02 % | ended 2025-10-07 16:00 JST | S9 |
| corporate negotiation | Lv7 and corporate customers only | standing | S1 |

The newest fee campaign in the help center search on 2026-09-22 was the one of S9, and it is marked 【終了】 (ended).
No discount applies to a retail taker today, so Lv1 at 1,400 ppm is the rate.

## 6. Funding as a cost

OKJ lists no perpetual and no margin product, so there is no funding rate, no borrow interest and no settlement instant.
No funding, mark or index endpoint exists on the public API, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

- There is no liquidation, because there is no leverage.
- Spot trades settle into the account at once, and the fee is deducted from the delivered asset, S1.
- A circuit breaker halts a pair for 5 minutes when a trade would print outside ±50 % of a reference price, which is the market price 10 minutes earlier computed from the prices of several companies, S4.
  During the halt only limit orders are accepted, and trading resumes with a call auction, S4.
- Pairs are suspended by notice.
  `FNCT` and `OAS` were suspended (一時停止) on 2026-06-08, S13, and `DAI` on 2026-07-07, S14, and none of the three is in the live catalog of P1.
- Deposit and withdrawal fees are listed on S1.

## 8. CCXT

| check | result | source |
|---|---|---|
| class in CCXT 4.5.68 | none. `ccxt.exchanges` from `server/` lists 104 ids, and none is `okj`, `okcoin` or `okcoinjapan` | P1 `ccxt` mode |
| class in CCXT master | none. `ts/src` on `github.com/ccxt/ccxt` master held 112 files on 2026-09-23, and none is named for OKJ | S11 |
| history | an `okcoin` class existed until commit `656969bbfe` "chore(okcoin): delist (#27026)" on 2025-10-13. It targeted `okcoin.com`, with `countries` `['CN', 'US']` and `hostname` `okcoin.com`, not OKJ | S11 |
| the `okx` class with its hostname swapped | `new ccxt.okx({ hostname: 'api.okj.com', options: { fetchMarkets: { types: ['spot'] } } })` loads all 47 OKJ spot pairs, because OKJ serves the same V5 paths | P1 `ccxt` mode |
| `market.taker` in that setup | 0.0015, the OKX spot default, against OKJ's 0.0014 | `server/node_modules/ccxt/js/src/okx.js` lines 677 to 679 |
| `market.maker` in that setup | 0.001, against OKJ's 0.0007 | same lines |

`market.taker` for a swap market cannot be reported, because OKJ lists none.
The hostname swap is a workaround and not a supported class, so the survey records `ccxt` as none.

## 9. Recommended registry values

None, because OKJ lists no perpetual and the engine trades perpetuals only, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 202.
If a spot leg were ever added, `takerPpm` would be 1,400, the Lv1 taker of S1.
A `ccxtTakerPpm` of 1,500 would describe the `okx` class under a hostname swap, and it would be wrong for OKJ by 100 ppm.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 手数料一覧 (fee list) | https://www.okj.com/pages/products/fees.html | 2026-09-22 | OKCoin Japan K.K., Japan | tiers, rules, tax, broker desk, operator and licence footer, sections 1, 2, 4, 5, 7 |
| S2 | OKJ API guide, V5 | https://dev.okj.com/apidoc/v5/en/ | 2026-09-22 | OKJ | instrument types, sections 3 and 6 |
| S3 | OKJ API V5 change log | https://dev.okj.com/apidoc/v5/log_en/ | 2026-09-22 | OKJ | "API v5 released." on 2026-09-16 |
| S4 | 取引ルール (trading rules) | https://www.okj.com/pages/products/trade-rules.html | 2026-09-22 | OKCoin Japan K.K. | hours, circuit breaker, section 7 |
| S5 | 海外に居住している場合、口座開設できますか, article 360044689854 | https://support.okcoin.jp/hc/ja/articles/360044689854 | 2026-09-22, via the help center API | Japan | residence rule, section 1 |
| S6 | 日本国籍を保有していなくても口座開設可能ですか, article 360045198833 | https://support.okcoin.jp/hc/ja/articles/360045198833 | 2026-09-22, via the help center API | Japan | nationality rule, section 1 |
| S7 | 当社指定取引禁止国について, article 58922203763225, updated 2026-07-17 | https://support.okcoin.jp/hc/ja/articles/58922203763225 | 2026-09-22, via the help center API | Japan | declaration list, section 1 |
| S8 | マイナスメイカー手数料導入キャンペーン, article 38451223644697 | https://support.okcoin.jp/hc/ja/articles/38451223644697 | 2026-09-22, via the help center API | Japan | the 2024 to 2025 campaign, section 5 |
| S9 | 【終了】取引手数料割引キャンペーン, article 48248803684889 | https://support.okcoin.jp/hc/ja/articles/48248803684889 | 2026-09-22, via the help center API | Japan | the 2025 campaign and the normal range, section 5 |
| S10 | CoinGecko exchange `okcoin-japan` | https://www.coingecko.com/en/exchanges/okcoin-japan | 2026-09-23 03:27 UTC, through `api.coingecko.com/api/v3/exchanges/okcoin-japan` | global | trust score, rank, volume |
| S11 | CCXT master `ts/src` listing and the `okcoin.ts` history | https://github.com/ccxt/ccxt/tree/master/ts/src and https://github.com/ccxt/ccxt/pull/27026 | 2026-09-23 | CCXT | no class, the delisted `okcoin` class, section 8 |
| S12 | CCXT 4.5.68 `okx.js` | `server/node_modules/ccxt/js/src/okx.js` lines 672 to 689 | 2026-09-22 | CCXT | OKX default fees, section 8 |
| S13 | 【2026/06/08】FNCT及びOASの取引所・販売所取引サービス一時停止について, article 58543881569689 | https://support.okcoin.jp/hc/ja/articles/58543881569689 | 2026-09-22, title from the help center search API | Japan | suspension, section 7 |
| S14 | 【2026/07/07】DAIの取引所・販売所取引サービス一時停止について, article 59770676800921 | https://support.okcoin.jp/hc/ja/articles/59770676800921 | 2026-09-22, title from the help center search API | Japan | suspension, section 7 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/okj/rest-probe.mjs) `all`, at 03:16 UTC and rerun in the second pass at 03:33 UTC | | 2026-09-23 UTC | this host | catalog, volume, CCXT, sections 1, 3, 8 |
