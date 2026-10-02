# Paribu Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:51 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

Paribu is CoinGecko's trust rank 114 in the survey list and 117 in the CoinGecko API on 2026-09-23 04:42 UTC.
Its own exchange lists no perpetual, and CCXT 4.5.68 has no Paribu class.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The mobile app also offers perpetual positions through a third-party on-chain protocol, and section 3 records what that product is and why it is not a Paribu book.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/paribu/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs).
Every access result below is from that Canadian VPN exit, not from a United States address.

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC, for every source row | source ledger |
| operator | PARİBU KRİPTO VARLIK ALIM SATIM PLATFORMU A.Ş., MERSİS 0827062136100017, Huzur Mahallesi Maslak Ayazağa Caddesi Uniq İstanbul Sitesi B Blok No: 4B, Sarıyer, İstanbul | F4, article 1 |
| regulator named | SPK, the Capital Markets Board of Türkiye | F4, definitions |
| second entity on the site | Paribu Yatırım Menkul Değerler A.Ş., the title of `https://www.paribu.com/stocks`, a brokerage for stocks and not part of the crypto API | the page title, read 2026-09-23 |
| who may trade | a "Müşteri" is a natural or legal person who signs the framework agreement and completes identity verification, clause 6.1 asks a natural person for legal capacity under Turkish law | F4, definitions and 6.1 |
| identity verification | the web app carries the message "Identity verification is only available for Turkish citizens. Please contact Paribu Support for more information.", and a sign-up option "Citizens of other countries" that leads to a courier verification | F8, keys `kyc.only_turkish_citizen_body`, `sign_up.citizenship.foreign_option_label`, `system_messages.missing_field_foreign_body` |
| foreign citizenship list | the public config carries `whitelist_country` with 42 entries, among them UK, FR, NL, CH and SG, and neither US nor CA nor TR | F3. What the list gates is Not publicly specified, and reading it as the accepted foreign citizenships is an inference |
| US persons | no document read names US persons or excluded regions | Not publicly specified. The United States is absent from `whitelist_country` |
| fiat | TRY only, through Turkish banks | F11 |
| CoinGecko listing | "Paribu", Turkey, established 2017, trust score 5, trust rank 117, 24 h volume 1,765 BTC | F9, read 2026-09-23 04:42 UTC |
| derivatives on CoinGecko | absent from the 214 derivatives exchanges CoinGecko lists | F9 |
| official pages from this host | `https://www.paribu.com/` and `https://docs.paribu.com/api` answer 200. The help center pages under `https://destek.paribu.com/hc/tr` answer 403 with a Cloudflare "Just a moment..." challenge, and its Zendesk JSON API at `https://destek.paribu.com/api/v2/help_center/tr/articles/<id>.json` answers 200, so the help articles below were read through that API | fetched 2026-09-23 04:25 to 04:44 UTC |
| API from this host | public REST answers 200 through Cloudflare's Seattle and Vancouver edges, and both WebSocket endpoints upgrade with 101, no geoblock | [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 |

## 2. Quick answer

Paribu lists no perpetual on its own exchange, so there is no perpetual VIP 0 fee.
The spot fee depends on the quote currency.

| market | maker | taker | evidence |
|---|---|---|---|
| TRY markets, level 1 (30 day volume 0 to 1,000,000 TRY) | 0.12 %, 1,200 ppm | 0.28 %, 2,800 ppm | F1 table, and F3 `commission_rates[0]` `maker` `"0.0012"`, `taker` `"0.0028"` |
| USDT markets, fixed for every user | 0.01 %, 100 ppm | 0.10 %, 1,000 ppm | F1 "USDT piyasalarda piyasa yapıcı (maker) %0,01, piyasa alıcı (taker) %0,10 olmak üzere sabit komisyon oranı uygulanır", and F3 `usdt_default_rates` `{"maker":"0.0001","taker":"0.001"}` |
| an unverified user | 0.50 %, 5,000 ppm | 0.50 %, 5,000 ppm | F3 `unverified_user_commission_rate`. No help article states it |

The CCXT pull request that adds Paribu measured 0.12 and 0.28 percent on its test account, which matches the TRY level 1 row, F10.
A market order and the "Al / Sat" (Easy Buy/Sell) screen always pay the taker rate, F1.

Crossing a Paribu book costs the half spread on top of the fee.
The median quoted spread in the CoinGecko ticker was 3,231 and 3,302 ppm over 232 TRY markets, and 4,202 and 3,731 ppm over 35 USDT markets, in two reads, see [`rest.md`](./rest.md) section 2.
`USDT_TRY` quoted 21 ppm, `BTC_TRY` 374 and 341 ppm, and `BTC_USDT` 1,221 and 830 ppm.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals on Paribu's own book | absent | no market among 278 in the catalog has a derivative label or id, P2, and no API page names a derivative, S1 |
| USDC-M perpetuals | absent | P2, S1 |
| coin-M perpetuals | absent | P2, S1 |
| dated futures | absent | P2, S1 |
| options | absent from the exchange | P2, S1 |
| spot | present: 278 markets, 242 quoted in TRY (spelled `tl`) and 36 in USDT, of which 11 carry `unlisted` true and 267 are open | P2 |
| margin or leverage on the exchange | absent from the API, the catalog and the web locale | S1, P2, F8 |
| "DeFi" perpetuals in the mobile app | present as an interface only, see below | F5, F8 |
| "DeFi" options and DEX swaps in the mobile app | present as an interface only | F5, and the locale category `polymarket`, F8 |
| stocks | a separate brokerage entity, Paribu Yatırım Menkul Değerler A.Ş., outside the crypto API | page title of `https://www.paribu.com/stocks` |

The "Vadeli İşlem Piyasaları Kullanım Koşulları" (futures markets terms of use) inside the DeFi terms of 2026-06-30 describe perpetual positions with no expiry, market orders only, isolated margin, a mark or oracle price, liquidation and a funding rate paid between longs and shorts, F5 clauses 6.2 to 6.10.
The same terms say Paribu is only an interface, not the counterparty, not the operator of any trading venue, and that the margin sits in the user's self-custody wallet on "HyperCore", F5 definitions and clause 6.12.
HyperCore is the name Hyperliquid gives its own execution layer, so the product reads as Hyperliquid perpetuals behind a Paribu screen, an inference from the name, since the terms name no protocol.
The web app says "DeFi transactions are currently available only in the mobile app", F8 key `trade.defi_app_only.title`.
No Paribu API page, catalog row or public channel exposes that product, so there is no Paribu perpetual book or anchor to research.
The fee on it is a "Sağlayıcı Ücreti" (provider fee) shown per trade, whose amount is Not publicly specified, plus network fees and a one-time activation fee paid to the protocol, F5 clauses 8.1, 8.2 and 8.4.

## 4. Spot tiers

### TRY markets, standard table for a user with 0 to 2 years in crypto

| level | 30 day buy and sell volume, TRY | maker | taker |
|---:|---|---:|---:|
| 1 | 0 to 1,000,000 | 0.12 % | 0.28 % |
| 2 | 1,000,000 to 10,000,000 | 0.11 % | 0.24 % |
| 3 | 10,000,000 to 50,000,000 | 0.10 % | 0.22 % |
| 4 | 50,000,000 to 100,000,000 | 0.08 % | 0.18 % |
| 5 | 100,000,000 to 500,000,000 | 0.06 % | 0.16 % |
| 6 | 500,000,000 to 1,000,000,000 | 0.04 % | 0.14 % |
| 7 | 1,000,000,000 to 2,500,000,000 | 0.02 % | 0.12 % |
| 8 | 2,500,000,000 and above | 0.01 % | 0.10 % |

The table is F1, and F3 `commission_rates` carries the same eight rows as fractions with `min` and `max` in TRY, for example `{"level":"8","maker":"0.0001","max":null,"min":"2500000000","taker":"0.0010"}`.

### USDT markets

A fixed maker 0.01 % and taker 0.10 % for every user, with no tiers, F1 and F3 `usdt_default_rates`.

### Qualification

- The volume is the user's own buy and sell volume over the last 30 days in TRY, recomputed every night at 00:00, F1 and F8 key `account.commission_rates.infoItems.2`.
- Volume on the `USDT/TL` pair does not count toward the TRY table, F1.
- The market maker programme started on 2025-09-17, F7.
- It had two versions on the help center on 2026-09-23, both edited 2026-06-15.
  Article 360027232174 says users with 30 day volume of 1 billion TRY or more may apply, F1.
  Article 115005829385 says the programme needs 50,000,000 USD of monthly volume across all pairs and lists VIP 1 to VIP 5 with maker 0.010 % down to 0.006 % and taker 0.10 % at every level, F2.

## 5. Discounts that change the spot taker

| discount | effect | evidence |
|---|---|---|
| time in crypto | users with 2 or more years in crypto get lower taker rates, and time on another exchange can be proven with documents | F1 |
| the numbers behind it | F3 `loyalty_discount_rates` `{"taker":{"2":0.05,"3":0.1,"4":0.15,"5":0.2}}` | reading the keys as years and the values as a fractional cut of the taker rate, 5 % at 2 years up to 20 % at 5 years, is an inference, and no article prints the table |
| segment and campaign discounts | the account page can show "{percentage}% {segment} discount" and "{percentage}% campaign discount" on top of the tier | F8 keys `account.commission_rates.pairs.discount_tag_*` |
| referral | the referrer earns 10 % of Paribu's net commission income on the referee's trades, and the referee's rate is unchanged | F6 clause 9 |
| token holding | none found | F1, F3 |
| zero fee promotion | none active found, and the "Yeni versiyon, sıfır komisyon" campaign articles date from 2020 | help center search for "komisyon", 2026-09-23 |

## 6. Funding as a cost

Paribu's exchange lists no perpetual, so there is no funding.
The DeFi perpetual product has a funding rate paid between position holders and not to Paribu, whose formula and interval the terms do not state, F5 clauses 6.10 and 8.5.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement on the exchange, since nothing is margined.
Delisting follows the "Kripto Varlık Listeleme ve Listeden Çıkarma Prosedürü", help article 9694184554650, which was not read for fees.
Withdrawal fees are per currency and network in the `fee_matrix` scope of `GET https://api.paribu.com/initials/config`, S3, and the help article "Yatırma ve Çekme Ücretleri" names them.

## 8. CCXT

CCXT 4.5.68 has no Paribu class.
`ccxt.exchanges` lists 104 ids and none is `paribu`, P2.
The CCXT master branch at commit `1d8b674` of 2026-09-22 12:48 UTC has 105 TypeScript exchange files under `ts/src` and none is named after Paribu, and `ts/src/paribu.ts` and `ts/src/pro/paribu.ts` answer 404 on `raw.githubusercontent.com`.
An open pull request, ccxt/ccxt#30536 of 2026-09-18, adds `ts/src/paribu.ts` and `ts/src/pro/paribu.ts` as a spot-only class with `swap` false, F10.
In that pull request `fees.trading.maker` and `taker` are `undefined` at lines 256 to 261 of `ts/src/paribu.ts`, with the comment that the exchange publishes no fee schedule endpoint, and every market's `taker` is `undefined` at line 452.
That comment does not hold on 2026-09-23, since `GET /initials/config` carries `commission_rates` and `usdt_default_rates`, F3.
So `market.taker` has no CCXT value in 4.5.68, and would be `undefined` if the pull request merged as it stands.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 1,000 for a USDT market and 2,800 for a TRY market, if the venue were ever added | F1 and F3. Only the USDT markets fall in the engine's USD quote family |
| `ccxtTakerPpm` | none | no CCXT class in 4.5.68 |

The venue does not fit the engine, because the engine loads only active swap markets from CCXT, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202, and Paribu has neither swaps nor a CCXT class.
Nothing is added to [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts).

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| F1 | Komisyonlar, help article 360027232174, edited 2026-06-15 15:12 UTC | https://destek.paribu.com/hc/tr/articles/360027232174-Komisyonlar | 2026-09-23 | Paribu, Türkiye | TRY table, USDT fixed rate, qualification, time in crypto, market maker entry at 1 billion TRY, sections 2, 4 and 5 |
| F2 | Komisyonlar, help article 115005829385, edited 2026-06-15 14:42 UTC | https://destek.paribu.com/hc/tr/articles/115005829385-Komisyonlar | 2026-09-23 | Paribu, Türkiye | the same table, and the market maker VIP table at 50,000,000 USD, section 4 |
| F3 | Exchange config, full reply | `GET https://api.paribu.com/initials/config` | 2026-09-23 04:23 UTC | Paribu | `commission_rates`, `usdt_default_rates`, `unverified_user_commission_rate`, `loyalty_discount_rates`, `whitelist_country`, sections 1, 2, 4 and 5 |
| F4 | Kripto Varlık Hizmetleri Çerçeve Sözleşmesi, help article 9693584100122, edited 2025-10-24 | https://destek.paribu.com/hc/tr/articles/9693584100122 | 2026-09-23 | Paribu, Türkiye | operator, MERSİS, address, SPK, customer definition, clause 6.1, section 1 |
| F5 | DeFi Kullanım Koşulları, help article 10960817426330, edited 2026-06-30 | https://destek.paribu.com/hc/tr/articles/10960817426330 | 2026-09-23 | Paribu, Türkiye | DEX, options and futures terms, HyperCore, provider fee, funding, section 3 |
| F6 | Referans Programı Koşulları, help article 7963842122138 | https://destek.paribu.com/hc/tr/articles/7963842122138 | 2026-09-23 | Paribu, Türkiye | referral reward, section 5 |
| F7 | Paribu'da Piyasa Yapıcılık Programı başladı, help article 9725076075930, 2025-09-17 | https://destek.paribu.com/hc/tr/articles/9725076075930 | 2026-09-23 | Paribu, Türkiye | market maker programme start, section 4 |
| F8 | Web app English locale | https://www.paribu.com/i18n/en.json?v=0e4e7274b574 | 2026-09-23 | Paribu | identity verification strings, discount tags, DeFi strings, sections 1, 3 and 5 |
| F9 | CoinGecko API, `exchanges/paribu` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/paribu | 2026-09-23 04:42 UTC | CoinGecko | listing context, section 1 |
| F10 | ccxt/ccxt pull request 30536 "feat(paribu): add Paribu exchange with REST and WebSocket support", head `4aff599` | https://github.com/ccxt/ccxt/pull/30536 | 2026-09-23 | CCXT | the class, its fee fields and the measured 0.12 and 0.28 percent, section 8 |
| F11 | Paribu Nedir?, help article 115005841469, edited 2026-06-09 | https://destek.paribu.com/hc/tr/articles/115005841469 | 2026-09-23 | Paribu, Türkiye | TRY banks, more than 190 assets, section 1 |
| S1 | Paribu API documentation index | https://docs.paribu.com/api/llms.txt | 2026-09-23 | Paribu | the public API surface, section 3 |
| S3 | Exchange Config | https://docs.paribu.com/api/market-data/exchange-config | 2026-09-23 | Paribu | scopes including `fee_matrix`, section 7 |
| P2 | `rest-probe.mjs catalog`, runs at 04:31 and 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paribu/rest-probe.mjs) | 2026-09-23 | this host | catalog counts, spreads, CCXT list, sections 2, 3 and 8 |
