# CoinTR Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:15 to 03:41 UTC, from the development host near Seattle.

CoinTR is CoinGecko's trust rank 50 on 2026-09-22, it serves no perpetual, and it has no CCXT class.
Its API documentation has a futures section, but every futures call answers "Request URL NOT FOUND", see section 3.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs).
The fee pages load in plain `curl` from this host, and their fee tables are images, which were downloaded and read.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 | |
| operating entity | COİNTR Kripto Varlık Alım Satım Platformu Anonim Şirketi, formerly METX Dijital Bilişim Teknoloji A.Ş., renamed "in line with the SPK principle decisions on crypto asset service providers" | S4, dated 2024-11-04 |
| regulator listing | row 14 of the Capital Markets Board (SPK) "Faaliyette Bulunanlar Listesi" names Cointr Kripto Varlık Alım Satım Platformu AŞ, former name Metx Dijital Bilişim Teknoloji AŞ | S5 |
| what that listing means | the page says the list names institutions that declared they would operate under provisional article 11 of Law 6362, and that being on it does not mean the institution is authorised | S5 |
| who may trade | identity verification requires a new-type Turkish Republic identity card read over NFC, then a residence document from e-Devlet whose 16-digit address code is entered | S6, dated 2026-06-02 |
| foreign nationals | the verification article names no other identity document, so an account needs a Turkish identity card and a Turkish address registration | S6 |
| US persons | no page read names the United States. A US person without a Turkish identity card cannot pass the verification in S6 | S6 |
| excluded regions | Not publicly specified in the pages read | |
| CoinTR Pro | CoinGecko's exchange record carries the notice "CoinTR Pro had ceased operation and has recently been rebranded to CoinTR". The linked termination article on `coin1.zendesk.com` returned HTTP 403 with a JavaScript challenge to `curl` and to the web fetch tool | S7 |
| legacy API | `https://api.cointr.pro` answered HTTP 404 from openresty on every path tried, and `stream.cointr.pro` does not resolve | P2 |
| public API from this host | REST answered HTTP 200 through Cloudflare, and the public socket opened and delivered, with no refusal | P1, P5, [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

There is no perpetual, so there is no perpetual taker.
The spot VIP 0 rates are these.

| market | maker | taker | maker ppm | taker ppm | source |
|---|---:|---:|---:|---:|---|
| USDT pairs, VIP 0 ("Normal kullanıcı") | 0.100 % | 0.120 % | 1,000 | 1,200 | S1, S2 |
| TRY pairs, VIP 0 | 0.120 % | 0.200 % | 1,200 | 2,000 | S1, S2 |
| catalog fields `makerFeeRate` and `takerFeeRate`, every pair | 0.1 % | 0.1 % | 1,000 | 1,000 | P1 |

The published schedule and the catalog disagree.
All 263 rows of `/api/v2/spot/public/symbols` carry `"takerFeeRate":"0.001"` and `"makerFeeRate":"0.001"`, for TRY and USDT pairs alike, while the help center charges a USDT taker 0.12 % and a TRY taker 0.20 %.
The published schedule is what an account is charged according to the venue, and the catalog field is what a generic parser would read.
Only USDT pairs sit in the engine's quote family, at [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 4 and 5, so 1,200 ppm is the number that would matter.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | the docs list product type `USDT-FUTURES` (S3). `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES`, the lowercase `usdt-futures`, `tickers`, `ticker`, `current-fund-rate`, `funding-time`, `symbol-price` and `merge-depth` all answer HTTP 400 `{"code":"40404","msg":"Request URL NOT FOUND"}` (P2). A socket subscribe with `instType` `USDT-FUTURES` answers code 30001 "doesn't exist" (P6) |
| coin-M perpetuals | absent | product type `COIN-FUTURES` in S3, same 40404 on `contracts` and `tickers` (P2) |
| USDC-M perpetuals | absent | product type `USDC-FUTURES` in S3, same 40404 (P2) |
| dated futures | absent | the S3 ticker example names `ETHUSDM24` under `COIN-FUTURES`, and every `/api/v2/mix` call answers 40404 (P2) |
| options | absent | no options section in the docs (S3) |
| margin | absent | `/api/v2/margin/currencies` answers 40404 (P4) |
| spot | present | 263 symbols: 134 USDT, 128 TRY and 1 `SUSDT` (`SBTCSUSDT`). 261 are `online` and 2 are `gray` (`REEFTRY`, `RNDRTRY`) (P1) |

CoinGecko's derivatives exchange list does carry an id `cointr_derivatives` named "CoinTR Pro (Derivatives)", and its record answered HTTP 404 `{"error":"market not found"}` on 2026-09-22 (S7).
The live site's navigation offers spot, Easy Buy/Sell, convert, a spot grid bot, OTC, savings and Launchpool, and no futures page (S8).

## 4. Spot tiers

The schedule is two tables in one image in S1, dated 2026-08-05.
The same numbers are in the image of S2, which introduced them as a pilot on 2024-08-28.

| level | USDT pairs, 30-day volume (USDT) | USDT maker | USDT taker | TRY pairs, 30-day volume (TRY) | TRY maker | TRY taker |
|---|---:|---:|---:|---:|---:|---:|
| VIP 0 ("Normal kullanıcı") | 0 | 0.100 % | 0.120 % | 0 | 0.120 % | 0.200 % |
| VIP 1 | ≥ 1,000,000 | 0.090 % | 0.110 % | ≥ 5,000,000 | 0.100 % | 0.200 % |
| VIP 2 | ≥ 5,000,000 | 0.080 % | 0.100 % | ≥ 25,000,000 | 0.080 % | 0.160 % |
| VIP 3 | ≥ 25,000,000 | 0.050 % | 0.080 % | ≥ 100,000,000 | 0.060 % | 0.135 % |
| VIP 4 | ≥ 100,000,000 | 0.040 % | 0.060 % | ≥ 300,000,000 | 0.050 % | 0.130 % |
| VIP 5 | ≥ 300,000,000 | 0.030 % | 0.054 % | ≥ 1,000,000,000 | 0.050 % | 0.120 % |
| VIP 6 | ≥ 1,000,000,000 | 0.024 % | 0.048 % | ≥ 2,000,000,000 | 0.050 % | 0.110 % |

### Qualification

- The level follows the last 30 days of total spot volume, recomputed every day at 19:00 Turkish time (S2).
- The level itself is updated every day at 12:00 Turkish time (S1, S2).
- S1 says spot volume counts and "vadeli işlemler bu hesaba dahil edilmez", futures are not included, although no futures product is served.
- S2 reserves the right to change a level when a risk control is triggered.

## 5. Discounts that change the spot taker

| discount | status | source |
|---|---|---|
| exchange token | none found in the fee pages read | S1, S2 |
| VIP rates with other discounts | "VIP komisyon oranları diğer indirimlerle birleştirilemez", VIP rates cannot be combined with other discounts, and S2 adds the rebate system | S1, S2 |
| referral | Not publicly specified in the pages read | |
| market maker program | Not publicly specified. S2 names `business@cointr.com` for questions | S2 |
| TRY campaign of 2024-11-19 | zero maker and 0.065 % taker on TRY pairs for 30 days, for users with 30-day volume up to 50,000 TRY, so it ended in December 2024 | S9 |
| fee lookup by API | `GET /api/v2/spot/market/vip-fee-rate` is documented (S3) and answered HTTP 500 `{"code":"40725","msg":"service return an error","data":null}` | P1 |

## 6. Funding as a cost

Not applicable.
CoinTR serves no perpetual and no margin, so no funding is charged, see section 3.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement.
A delisting fee is Not publicly specified, and the announcements page has a "Delist Duyuruları" section (S9).
Deposit and withdrawal limits and fees are in the help articles "Kripto Para Yatırma ve Çekme Limitleri" and "TL Yatırma ve Çekme Limitleri", linked from S2.

## 8. CCXT

| check | result | evidence |
|---|---|---|
| CCXT 4.5.68 class | none: `ccxt.exchanges` has 104 ids, and none contains `cointr` or `metx` | P4 |
| CCXT master | none: the `ts/src` listing of `github.com/ccxt/ccxt` on 2026-09-22, head commit `1d8b674` of 2026-09-22 12:48 UTC, has no file whose name contains `cointr` | S10 |
| `market.taker` without credentials | nothing to report, since no class exists | |
| the `bitget` class pointed at `api.cointr.com` | `fetchMarkets` fails with `BadRequest` 40404, because `fetchDefaultMarkets` adds `publicMarginGetV2MarginCurrencies` for spot at `server/node_modules/ccxt/js/src/bitget.js` line 2022, and CoinTR does not serve that path | P4 |
| the same with the margin call stubbed | 263 markets, 261 active, `BTC/USDT` with `taker` 0.001 and `maker` 0.001, read from the catalog's `takerFeeRate` at `bitget.js` line 2223 | P4 |

The `bitget` result shows that CoinTR's REST API follows Bitget's V2 paths and field names closely enough for Bitget's parser.
It is not a CCXT class for CoinTR, and the 0.001 it reports is the catalog field, not the published 0.12 %.

## 9. Recommended registry values

None.
The engine's catalog is `loadMarkets` filtered to active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 79 with the predicate at lines 199 and 200, and CoinTR has no swap to contribute.
If a spot leg is ever modelled, `takerPpm` should be 1,200 for USDT pairs, the published VIP 0 taker, and not the catalog's 1,000.
`ccxtTakerPpm` stays unset, because no CCXT class exists to declare a constant for.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Alım Satım Komisyon Oranları, dated 2026-08-05, with its table image | https://www.cointr.com/tr/destek/kripto-al-sat/alim-satim-komisyon-oranlari | 2026-09-22 | CoinTR, Türkiye | VIP 0 and all tiers, qualification, no combining, sections 2, 4 and 5 |
| S2 | CoinTR Spot İşlem Ücretleri, dated 2024-08-28, with its table image | https://www.cointr.com/tr/destek/kripto-al-sat/cointr-spot-islem-ucretleri | 2026-09-22 | CoinTR, Türkiye | the same tiers, the 19:00 and 12:00 schedule, risk control clause, sections 4 and 5 |
| S3 | CoinTR API docs: futures intro, spot market pages, VIP fee rate | https://www.cointr.com/api-doc/contract/intro | 2026-09-22 | CoinTR | documented product types and paths, section 3 |
| S4 | CoinTR Unvan Değişikliği Duyurusu, dated 2024-11-04 | https://www.cointr.com/tr/destek/articles/cointr-kripto-varlik-alim-satim-platformu-duyuru | 2026-09-22 | CoinTR, Türkiye | entity name, section 1 |
| S5 | SPK, Kripto Varlık Hizmet Sağlayıcılar, Faaliyette Bulunanlar Listesi | https://spk.gov.tr/kurumlar/kripto-varlik-hizmet-saglayicilar/faaliyette-bulunanlar-listesi | 2026-09-22 | Capital Markets Board of Türkiye | listing and its disclaimer, section 1 |
| S6 | CoinTR Kimlik Doğrulama (KYC), dated 2026-06-02 | https://www.cointr.com/tr/destek/hesap-ve-kimlik/kimlik-dogrulama-kyc | 2026-09-22 | CoinTR, Türkiye | who may open an account, section 1 |
| S7 | CoinGecko API: exchange `cointr`, derivatives list and `cointr_derivatives` | https://api.coingecko.com/api/v3/exchanges/cointr | 2026-09-22 | CoinGecko | rank 50, CoinTR Pro notice, the derivatives id and its 404, sections 1 and 3 |
| S8 | CoinTR home page, Turkish | https://www.cointr.com/tr | 2026-09-22 | CoinTR, Türkiye | product navigation, delist announcements, sections 3 and 7 |
| S9 | Türk Lirası Paritelerinde Avantajlı Komisyon Oranlarını Kaçırmayın, dated 2024-11-19 | https://www.cointr.com/tr/duyuru/kampanyalar/cointr-de-turk-lirasi-paritelerinde-avantajli-komisyon-oranlari | 2026-09-22 | CoinTR, Türkiye | the expired TRY campaign, section 5 |
| S10 | CCXT `ts/src` directory listing, master | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no CoinTR class in master, section 8 |
| P1 | `rest-probe.mjs catalog` at 03:15 and 03:34 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) | 2026-09-22 | this host | catalog fee fields, statuses, VIP fee call, sections 1 to 5 |
| P2 | `rest-probe.mjs futures` at 03:15 and 03:34 UTC, with one run between them for the legacy host | [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) | 2026-09-22 | this host | every futures call and the legacy host, sections 1 and 3 |
| P4 | `rest-probe.mjs ccxt` at 03:17 and 03:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) | 2026-09-22 | this host | no CCXT class, the `bitget` class on CoinTR, the margin call, sections 3 and 8 |
| P5 | `ws-probe.mjs book` at 03:19 and 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | the socket delivers from this host, section 1 |
| P6 | `ws-probe.mjs errors` at 03:18 and 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | futures `instType` refused on the socket, section 3 |
