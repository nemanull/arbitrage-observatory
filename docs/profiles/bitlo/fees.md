# Bitlo Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:15 to 03:56 UTC, from the development host near Seattle.

Bitlo is CoinGecko's trust rank 87 in the survey list and 89 in the CoinGecko API on 2026-09-23 03:21 UTC, it lists no perpetual, and it has no CCXT class.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Every fee number below comes from Bitlo's own public API, which the website renders, and each row names the call.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs).

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC, for every source row | source ledger |
| operator in Türkiye | Bitlo Kripto Varlık Alım Satım Platformu A.Ş., MERSİS 0175068202000001, Esentepe Mahallesi Büyükdere Caddesi Ferko No: 175/7, Şişli, İstanbul, tax number 1750682020, trade registry 125540-5, paid capital 300,000,000 TL | S6 names the company and MERSİS as the contracting party, S8 carries the rest |
| second entity | Bitlo Corporation, Calle 53 Este, Edificio Nova, Panama, shown on the company page only when the site is served from `bitlo.exchange`, `bitlo.io`, `bitlo.global`, `global.bitlo.com` or `bitloglobal.com` | S8 and S12 |
| sign-up on the global host | the global host opens `https://www.bitlo.com/kayit?step=1&redirectToGlobal=https://www.bitlo.com`, and its pages read "Üyelikler Bitlo Tr'den alınmaktadır", memberships are taken by Bitlo TR | S12 and the page shell of `https://www.bitlo.com/komisyonlar` |
| who may trade | clause 4.5 of the framework agreement: a user declares being over 18, having full legal capacity, not being restricted, and being a real person allowed to transact under the laws of the Republic of Türkiye | S6, version 1.0.3 |
| identity | sign-up asks for a "T.C. or Foreign Identity Number" | the `tc-veya-yabanci-kimlik-numaraniz` string of S5 |
| fiat | TRY only. TRY withdrawals go only to an active Turkish bank account in the user's name, and transfers to foreign bank accounts are not possible "T.C. mevzuatı gereği" | S7 |
| regulators named | SPK, the Capital Markets Board, and MASAK, the Financial Crimes Investigation Board | S6 definitions |
| US persons | no document read names US persons or lists excluded countries | Not publicly specified. A US person without a Turkish identity number and a Turkish bank account cannot meet S5 and S7 |
| CoinGecko listing | "Bitlo", Turkey, established 2018, trust score 6, trust rank 89, 228 coins, 299 pairs, 24 h volume 16.96 BTC | S9, read 2026-09-23 03:21 UTC |
| derivatives on CoinGecko | absent from the 214 derivatives exchanges CoinGecko lists | S10 |
| official pages from this host | `https://www.bitlo.com/komisyonlar` and the global `https://www.bitlo.exchange/` answer HTTP 200 with a JavaScript shell whose content comes from the API, and `https://docs.bitlo.com/` answers 200 with the full API document | P1 and S1 |
| API from this host | public REST answers 200 and the WebSocket upgrades with 101 through Cloudflare's Seattle edge, no geoblock | [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 |

## 2. Quick answer

Bitlo lists no perpetual, so there is no perpetual VIP 0 fee.
The spot VIP 0 numbers are below, and they apply to every market.

| market | maker | taker | evidence |
|---|---|---|---|
| all spot markets, 227 TRY and 72 USDT pairs trading | 0.35 %, 3,500 ppm | 0.35 %, 3,500 ppm | S3, level 0 "Standard" `MAKER_FEE` 0.35 and `TAKER_FEE` 0.35 in `%`, and S2, first band `makerFee` 0.0035 and `takerFee` 0.0035 |

The fee page's own text says a taker pays "between 0.35%-0.01%" and a maker pays "no commission or at most 0.35% commission, depending on your monthly volume", S5.
The lowest taker in the level table is 0.08 %, not 0.01 %, so the page text and its table disagree at the bottom, and the VIP 0 number agrees in all three sources.

Crossing a Bitlo book costs the half spread on top of the fee.
The median quoted spread was 10,233 and 10,850 ppm over 72 USDT pairs, and 10,331 and 10,695 ppm over 226 TRY pairs with two sides, in two reads of the bulk ticker, see [`rest.md`](./rest.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | no market in the 376 row catalog has a derivative shape, P2 |
| USDC-M perpetuals | absent | P2 |
| coin-M perpetuals | absent | P2 |
| dated futures | absent | P2 |
| options | absent | P2 |
| spot | present: 376 markets, 227 TRY and 72 USDT trading, 77 TRY disabled with `MARKET_DISABLED` | P2 |
| "swap" | a convert service ("Dönüştür", `market/swap-api` in the website), not a swap contract, fee 0.3 % at level 0 | S3 `SWAP_FEE`, S12 |
| margin or leverage | absent from the API document, the catalog and the website routes read | S1, P2, S12 |

The catalog tags `ERA-TRY` with the category "stocks", and eleven metal tokens such as `GRAMG-TRY` and `PAXG-TRY` with "Metal", P2.
Both are spot tokens in the same catalog, not derivatives.

## 4. Spot tiers

### Level table served to the fee page, `GET https://api.bitlo.com/vip/levels`

The page `https://www.bitlo.com/komisyonlar` renders this reply, S5 and S12.

| level | name | maker | taker | maker ppm | taker ppm |
|---|---|---:|---:|---:|---:|
| 0 | Standard | 0.35 % | 0.35 % | 3,500 | 3,500 |
| 1 | VIP 1 | 0.25 % | 0.35 % | 2,500 | 3,500 |
| 2 | VIP 2 | 0.20 % | 0.30 % | 2,000 | 3,000 |
| 3 | VIP 3 | 0.15 % | 0.25 % | 1,500 | 2,500 |
| 4 | VIP 4 | 0.12 % | 0.20 % | 1,200 | 2,000 |
| 5 | VIP 5 | 0.10 % | 0.15 % | 1,000 | 1,500 |
| 6 | VIP 6 | 0 % | 0.08 % | 0 | 800 |

### Qualification, `GET https://api.bitlo.com/vip/conditions`

The VIP page says "Meeting any one of the following requirements is enough to qualify for" a level, S12, and the thresholds are S4.

| criterion | unit | VIP 1 | VIP 2 | VIP 3 | VIP 4 | VIP 5 | VIP 6 |
|---|---|---:|---:|---:|---:|---:|---:|
| `MONTHLY_TRADING_VOLUME`, "Son 30 gün içindeki spot+swap işlem hacmi" | TRY | 500,000 | 2,500,000 | 10,000,000 | 25,000,000 | 100,000,000 | 250,000,000 |
| `TOTAL_ASSET_VALUE` | TRY | 500,000 | 2,500,000 | 10,000,000 | 15,000,000 | 25,000,000 | 50,000,000 |
| `STAKE_AMOUNT` | TRY | 300,000 | 2,000,000 | 8,000,000 | 12,000,000 | 20,000,000 | 25,000,000 |
| `AUTO_SAVING_MONTHLY` | TRY | 100,000 | 250,000 | 500,000 | 1,000,000 | none | none |
| `MEMBERSHIP_DURATION` | years | 2 | 3 | 4 | 5 | none | none |
| `SOCIAL_FOLLOWER_COUNT` | followers | 1,000 | 2,500 | 5,000 | 10,000 | none | none |
| `BTL_TOKEN_HOLDING`, `REFERRAL_COUNT` | | none | none | none | none | none | none |

"swap" in the volume rule is the convert service of section 3.
The website says "Trading volume data is refreshed in 60-minute intervals", S5.

### Band table in the catalog, `GET https://api4.bitlo.com/config`, field `exchangeFeeSchedule`

The catalog reply and the API document carry a second, volume-only table, S1 and S2.

| minimumVolume | maximumVolume | makerFee | takerFee |
|---:|---:|---:|---:|
| 0 | 250,000 | 0.0035 | 0.0035 |
| 250,000 | 1,000,000 | 0.0025 | 0.0035 |
| 1,000,000 | 5,000,000 | 0.0015 | 0.0018 |
| 5,000,000 | 10,000,000 | 0.0012 | 0.0015 |
| 10,000,000 | 25,000,000 | 0.001 | 0.0012 |
| 25,000,000 | 50,000,000 | 0.0008 | 0.001 |
| 50,000,000 | 0 | 0 | 0.0008 |

Its bands and rates differ from the level table above band 1, and its volume unit and window are Not publicly specified.
The level table is what the fee page shows today, so this profile treats the band table as a legacy field.
Both tables agree on 0.35 % maker and taker at the entry level.

## 5. Discounts that change the spot taker

| discount | rule | effect | evidence |
|---|---|---|---|
| VIP by holdings, staking, savings, tenure or followers | any one criterion of section 4 qualifies | the taker of that level | S4 |
| Bitlo Token (BTL) holding | criterion present with no threshold at any level | none today | S4 |
| referral | criterion present with no threshold at any level | none today | S4 |
| per market rates | the fee page says "In the list below, you can view the rates that differ from your VIP level", so some markets may carry their own rate. The list is served only to a signed-in account (`customer/fee-schedules`) | Not verified | S5, S12 |
| zero fee promotion | none found in the fee sources read | | S3, S5 |

## 6. Funding as a cost

Bitlo lists no perpetual, so there is no funding.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement, since nothing is margined.
Delisting follows the "Listeleme Prosedürü", a legal document served at `https://api.bitlo.com/legal-document/get-all-by-category` with type `listing_procedure`, which was not read for fees.
Deposit and withdrawal fees are per network in `assets[].assetNetworks[].withdrawFee` of `GET https://api4.bitlo.com/config`, and the page `https://www.bitlo.com/komisyonlar` shows them.

## 8. CCXT

CCXT 4.5.68 has no Bitlo class.
`ccxt.exchanges` lists 104 ids and none matches `bitlo`, P2.
The CCXT master branch on GitHub at commit `1d8b674` of 2026-09-22 12:48 UTC has 105 TypeScript exchange files under `ts/src` and none is named after Bitlo, and GitHub code search for "bitlo" in `ccxt/ccxt` returned 0 results, S11.
So `market.taker` has no CCXT value, and no source line exists in `server/node_modules/ccxt/js/src/`.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 3,500 if the venue were ever added | spot VIP 0 taker, S3 and S2 |
| `ccxtTakerPpm` | none | no CCXT class |

The venue does not fit the engine, because the engine loads only active swap markets from CCXT, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 202, and Bitlo has neither swaps nor a CCXT class.
Nothing is added to [`registry.ts`](../../../server/src/venues/registry.ts).

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitlo API Documentation | https://docs.bitlo.com/ | 2026-09-22 | Bitlo, Türkiye | public calls, the `exchangeFeeSchedule` example, sections 4 and 8 |
| S2 | catalog reply, `exchangeFeeSchedule` | https://api4.bitlo.com/config | 2026-09-22 | Bitlo | band table, section 4 |
| S3 | VIP level table | https://api.bitlo.com/vip/levels | 2026-09-22 | Bitlo | maker, taker and convert fee per level, sections 2 and 4 |
| S4 | VIP qualification table | https://api.bitlo.com/vip/conditions | 2026-09-22 | Bitlo | thresholds per criterion, sections 4 and 5 |
| S5 | website strings in English and Turkish | https://www.bitlo.com/assets/i18n/en.json and https://www.bitlo.com/assets/i18n/tr.json | 2026-09-22 | Bitlo | fee page text, volume refresh, identity number, sections 1, 2 and 5 |
| S6 | "Kripto Varlık Hizmetlerine İlişkin Çerçeve Sözleşme", version 1.0.3 | https://api.bitlo.com/legal-document/get?type=user_agreement&lang=en, shown at https://www.bitlo.com/sozlesmeler?tur=user_agreement | 2026-09-22 | Bitlo Kripto Varlık Alım Satım Platformu A.Ş. | contracting party, clause 4.5, regulators, section 1 |
| S7 | "Para Çekme İşlemleri ve Kimlik Belgesi Geçerliliği Hakkında Bilgilendirme" | https://api.bitlo.com/legal-document/get-all-by-category, type `foreign_customer_try_withdrawal_id_validity_notice` | 2026-09-22 | Bitlo, Türkiye | TRY withdrawals to Turkish bank accounts only, section 1 |
| S8 | company information page and its component | https://www.bitlo.com/sirket-bilgileri and https://www.bitlo.com/resources/bitlo-frontend/chunk-KLUDRCYR.js | 2026-09-22 | both entities | registry numbers, addresses, capital, section 1 |
| S9 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/bitlo | 2026-09-23 03:21 UTC | CoinGecko | listing, trust rank, volume, section 1 |
| S10 | CoinGecko derivatives exchanges list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 | CoinGecko | no Bitlo entry, section 1 |
| S11 | CCXT master `ts/src` listing and code search | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23, commit `1d8b674` | CCXT | no Bitlo class, section 8 |
| S12 | website bundle: API base URLs, global host list, fee page, VIP page and sign-up guard | https://www.bitlo.com/resources/bitlo-frontend/chunk-OVZ4F74R.js, chunk-ABUTHAIP.js, chunk-C5VA6MBH.js, chunk-YBPF63MA.js and main-EPTVBOIC.js | 2026-09-22 | Bitlo | sections 1, 3, 4 and 5. Chunk names change with each deploy |
| P1 | `rest-probe.mjs host` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) | 2026-09-23 | this host | reachability, section 1 |
| P2 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) | 2026-09-23 | this host | catalog shape and CCXT check, sections 2, 3 and 8 |
