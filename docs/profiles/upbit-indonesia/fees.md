# Upbit Indonesia Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:13 UTC), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

Upbit Indonesia is the Indonesian spot exchange of PT Upbit Exchange Indonesia, and it lists no perpetual, dated future or option.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
CCXT has no class of its own for it, and the `upbit` class reaches it through `hostname: 'id-api.upbit.com'`, see section 8.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.
The probe is [`rest-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/rest-probe.mjs), and R1 and R2 are its two runs, listed in section 10.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local time, 2026-09-23 UTC | all |
| legal entity | PT Upbit Exchange Indonesia, "licensed and supervised by the Financial Services Authority (Otoritas Jasa Keuangan/OJK)" | S4 |
| exchange and clearing membership | migrated to a new exchange and clearing house membership, effective 19 May 2026, with a warning that "This migration process may affect service fees" | S5 |
| products | spot only, 444 pairs on 2026-09-23: 32 IDR, 262 BTC and 150 USDT | R1, [`rest.md`](./rest.md) section 2 |
| who may trade | users who pass a three stage KYC. An Indonesian user submits an identity document. A foreign user must also submit a "permanent residence permit card, or limited stay permit card (KITAS or KITAP)" | S3 Article 5 |
| excluded | residents of sanctioned countries, persons on the OFAC, EU, UN, OJK and Bank Indonesia lists, and anyone under 18 | S3 Articles 5, 24 and 26 |
| FATF grey list | new applications from FATF grey list countries are refused, as announced for Haiti, Malta, the Philippines and South Sudan in 2021 | S6 |
| US persons | the terms name no US exclusion, but a foreigner needs an Indonesian stay permit, so a US person who does not live in Indonesia cannot pass KYC. The web app's country list, `kv/supported_countries.json`, holds 125 countries with phone codes and has no United States entry, while it does list Canada | S3, S9 |
| access from this host | public REST and WebSocket answered 200 and 101 with no refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1. These results are from the Canadian VPN exit | R1, R2 |

## 2. Quick answer

There is one rate per quote market and no volume tier.

| market | maker | taker | maker ppm | taker ppm |
|---|---:|---:|---:|---:|
| IDR | 0.23 % | 0.33 % | 2,300 | 3,300 |
| BTC | 0.51 % | 0.51 % | 5,100 | 5,100 |
| USDT | 0.51 % | 0.51 % | 5,100 | 5,100 |

The guest fee table the web site reads, `https://ccxid.upbit.com/api/v1/market_status/base_trade_fee_conditions/guest`, returned exactly these ratios in R1 and R2, S2.
They match the last fee notice, effective 21 April 2025 at 12:00 WIB, S1.
The USDT market is the one a USD family leg could use, so its 5,100 ppm taker is the number that matters for the engine.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | `/v1/market/all` lists 444 pairs and all are spot, CCXT maps 0 swaps, R1 |
| USDC-M or coin-M perpetuals | absent | same |
| dated futures | absent | same, and no announcement names a futures product, S10 |
| options | absent | same |
| margin or lending | absent | Article 15 of the terms lists wallets, a spot exchange and a conversion service, and the terms never mention leverage, lending or futures, S3 |
| spot, IDR quote | present, 32 pairs | R1 |
| spot, BTC quote | present, 262 pairs | R1 |
| spot, USDT quote | present, 150 pairs | R1 |

CoinGecko's derivatives exchange list of 214 ids has no Upbit entry at 05:15 UTC, S16, and its exchange record lists Upbit Indonesia as a centralized venue with trust score 3 and trust rank 147 at 05:00 UTC, S11.
An announcement search for "futures", "perpetual", "derivative", "leverage" and "margin" returned only coin listing and delisting notices, S10.

## 4. Spot tiers

The guest fee table has one row per quote, and each row carries `bid_ratio`, `ask_ratio`, `maker_bid_ratio`, `maker_ask_ratio` and `watch_*` variants, S2.
Buy and sell are equal, and the `watch_*` ratios, which apply to pairs under an investment warning, equal the normal ratios on all three rows.
No VIP or volume program was found: an announcement search for "VIP" returned no fee notice, S10.
The web app says "If a fee discount event is in progress, the discounted trading fee will be displayed", which is the only per user variation it describes, S12.

The rate history, from the notices:

| effective | IDR maker | IDR taker | BTC and USDT maker | BTC and USDT taker | source |
|---|---:|---:|---:|---:|---|
| before 20 Nov 2024 | 0.00 % | 0.51 % | 0.46 % | 0.46 % | S7, notice 3945, the "from" values |
| 20 Nov 2024, 12:00 WIB | 0.23 % | 0.33 % | 0.51 % | 0.51 % | S7, notice 3945, citing CFX and KKI joint circular letters 003 and 004 of October 2024 |
| 19 Feb 2025 | 0.24 % | 0.34 % | 0.52 % | 0.52 % | S7, notice 4001 for IDR, citing tax law HPP 7 of 2021 and PMK 81 of 2024, and S1 for the BTC and USDT "from" values |
| 21 Apr 2025, 12:00 WIB | 0.23 % | 0.33 % | 0.51 % | 0.51 % | S1, "to comply with tax regulations set by the government" |

So the published rate is the all in rate, and the notices tie it to exchange, clearing and tax rules rather than to the user.

## 5. Discounts that change the spot taker

| discount | state on 2026-09-22 | source |
|---|---|---|
| token holding | none found: the guest fee table has no token field, and no notice names a token discount | S2, S10 |
| referral | terminated, notice of 18 Nov 2025 | S8, notice 4296 |
| market maker | no public program found | S10 |
| USDT market discount | ran from 16 Aug 2024 and ended, notice of 4 Oct 2024 | S8, notices 3863 and 3914 |
| zero fee promotions | none active. The last free trading events were in 2020 and 2021 | S10 |

## 6. Funding as a cost

Upbit Indonesia lists no perpetual, so there is no funding rate, interval, cap or settlement to record.

## 7. Liquidation, settlement and delisting

There is no margin, so there is no liquidation or settlement charge.
A pair can be designated an investment warning, which shows as `market_warning` `CAUTION` in the catalog, and 10 pairs carried it in R1, see [`rest.md`](./rest.md) section 2.
A delisting notice gives a trading end time and a later withdrawal end date, for example ICX/IDR trading ends at 13:00 WIB on 19 October 2026 and withdrawals on 18 November 2026, S13.
Deposit and withdrawal fees are listed on the web site's fee page, `https://id.upbit.com/service_center/fees`, and are not recorded here.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | none for Upbit Indonesia. `ccxt.exchanges` in 4.5.68 has 104 ids, and the only ones matching `upbit`, `indo` or `tokocrypto` are `indodax`, `tokocrypto` and `upbit` | `node -e "console.log(require('ccxt').exchanges)"` run from `server/` at 04:40 UTC |
| CCXT master | `ts/src` on GitHub holds `upbit.ts` and no Indonesian Upbit class, at version 4.5.82 | S14 |
| host switch | `'hostname': 'api.upbit.com', // 'api.upbit.com' for KR, '{countryCode}-api.upbit.com' for ID, SG, TH` | `server/node_modules/ccxt/js/src/upbit.js` line 97, and `'ws': 'wss://{hostname}/websocket/v1'` at `server/node_modules/ccxt/js/src/pro/upbit.js` line 31 |
| markets with `hostname: 'id-api.upbit.com'` | 444, all `spot`, ids identical to `/v1/market/all` | R1 `catalog` |
| `market.taker` and `market.maker` | 0.0025 on all 444 pairs of every quote, which is 2,500 ppm | R1 `catalog` |
| why | the default `fees.trading` is 0.0025, and `tradingFeesByQuoteCurrency` overrides only `KRW` with 0.0005 | `upbit.js` lines 181 and 182, 277 to 279, and 546 and 547 |
| real rate | 3,300 ppm taker on IDR and 5,100 ppm on BTC and USDT | section 2 |
| per account fee | `fetchTradingFee` reads the private `orders/chance` call | `upbit.js` line 992 |

CCXT therefore understates the Indonesian taker by 800 ppm on IDR pairs and by 2,600 ppm on BTC and USDT pairs.

## 9. Recommended registry values

Upbit Indonesia cannot be registered today, because the connector keeps only active swap markets, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 203, and it has none.
If a spot leg is ever added, these are the values.

| field | value | reason |
|---|---|---|
| `createExchange` | `new ccxt.upbit({ hostname: 'id-api.upbit.com' })` | the default host is Upbit Korea, section 8 |
| `takerPpm` for a USDT or BTC pair | 5,100 | S1 and S2 |
| `takerPpm` for an IDR pair | 3,300 | S1 and S2 |
| `ccxtTakerPpm` | 2,500 | `upbit.js` lines 181 and 182, the constant every Indonesian pair inherits |

The USDT market turned over 0.95 to 1.01 million USDT in 24 h and the IDR market 3,810 to 3,865 USDT equivalent, see [`rest.md`](./rest.md) section 2.
So the USDT market is the only one with any volume a USD family leg could use, and its taker of 5,100 ppm is ten times the 500 ppm KRW taker of Upbit Korea in [`../upbit/fees.md`](../upbit/fees.md).

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Notice 4087, Trading Fee Adjustment (Completed) | https://id-api-manager.upbit.com/api/v1/announcements/4087, shared as https://id.upbit.com/web-static/announcement/share/en/4087 | 2026-09-23 UTC | Upbit Indonesia | current rates, sections 2 and 4 |
| S2 | Guest trade fee table | https://ccxid.upbit.com/api/v1/market_status/base_trade_fee_conditions/guest | 2026-09-23 UTC, R1 and R2 `fees` | Upbit Indonesia, `country_code` `id` | rates per quote, sections 2 and 4 |
| S3 | Terms of Use, last updated 13 March 2026 | https://id-upbit-static.upbit.com/lang/en/terms/terms_of_use_md.txt | 2026-09-23 UTC | PT Upbit Exchange Indonesia | KYC, foreign users, exclusions, sections 1 and 3 |
| S4 | Notice 4615, User Data Update reminder, footer | https://id-api-manager.upbit.com/api/v1/announcements/4615 | 2026-09-23 UTC | Upbit Indonesia | OJK licence, section 1 |
| S5 | Notice 4460, Update on Migration of Exchange and Clearing House Membership | https://id-api-manager.upbit.com/api/v1/announcements/4460 | 2026-09-23 UTC | Upbit Indonesia | membership migration, section 1 |
| S6 | Notice 2883, Additional Countries in Denylist | https://id-api-manager.upbit.com/api/v1/announcements/2883 | 2026-09-23 UTC | Upbit Indonesia | FATF grey list refusal, section 1 |
| S7 | Notices 3945 and 4001, Trading Fee Adjustment | https://id-api-manager.upbit.com/api/v1/announcements/3945 and https://id-api-manager.upbit.com/api/v1/announcements/4001 | 2026-09-23 UTC | Upbit Indonesia | rate history, section 4 |
| S8 | Notices 3863, 3914 and 4296 | https://id-api-manager.upbit.com/api/v1/announcements/3863, https://id-api-manager.upbit.com/api/v1/announcements/3914 and https://id-api-manager.upbit.com/api/v1/announcements/4296 | 2026-09-23 UTC | Upbit Indonesia | USDT discount and its end, referral termination, section 5 |
| S9 | Web app country list | https://id-api-manager.upbit.com/api/v1/kv/supported_countries.json | 2026-09-23 UTC | Upbit Indonesia | 125 countries, no United States, section 1 |
| S10 | Announcement search | https://id-api-manager.upbit.com/api/v1/announcements/search with `search` set to fee, promotion, VIP, market maker, discount, referral, futures, perpetual, derivative, leverage and margin | 2026-09-23 UTC | Upbit Indonesia | absence of derivatives, tiers and promotions, sections 3 to 5 |
| S11 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/upbit_indonesia | 2026-09-23 05:00 UTC | CoinGecko | trust score and rank, 24 h volume 24.4 BTC, section 3 |
| S12 | Upbit web app bundle for the Indonesian site | https://upbit-web-dist.upbit.com/upbit-web/sri-v2-ID_PC-bundle-CLt3YNqT.js | 2026-09-23 UTC | Upbit Indonesia web | the guest fee call, the discount display text, section 4 |
| S13 | Notice 4614, Delisting Notice (ICX) | https://id-api-manager.upbit.com/api/v1/announcements/4614 | 2026-09-23 UTC | Upbit Indonesia | delisting schedule, section 7 |
| S14 | CCXT master `ts/src` listing and `package.json` | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master and https://raw.githubusercontent.com/ccxt/ccxt/master/package.json | 2026-09-23 UTC | CCXT | no Indonesian class, section 8 |
| S15 | CCXT 4.5.68 `upbit.js` and `pro/upbit.js` | `server/node_modules/ccxt/js/src/upbit.js`, `server/node_modules/ccxt/js/src/pro/upbit.js` | 2026-09-23 UTC | CCXT | host switch and fee constants, section 8 |
| S16 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 05:15 UTC | CoinGecko | no Upbit derivatives venue, section 3 |
| R1 | `rest-probe.mjs all`, first run at 04:49 to 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1, 2, 3 and 8 |
| R2 | `rest-probe.mjs all`, second pass at 05:07 to 05:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | the same, second readings |
