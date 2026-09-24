# Zaif Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:23 to 04:50 UTC), from the development host near Seattle, through the Canadian VPN exit described in section 1.

Zaif (CCXT id `zaif`) is a Japanese spot exchange, and it lists no perpetual, dated future or option today.
Its futures product AirFX and its dated BTC/JPY futures are retired, and their public API still answers with frozen data from 2017 to 2021, see section 3.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | 株式会社Ｚａｉｆ (Zaif Inc.), founded 2016-04-12, Minami-Aoyama, Minato-ku, Tokyo | S5 |
| shareholder | 株式会社ＪＮグループ (JN Group) | S5 |
| licence | crypto-asset exchange service provider, 近畿財務局長 第00001号, registration No. 00001 with the Kinki Local Finance Bureau | S5 |
| association | Japan Virtual and Crypto Assets Exchange Association (一般社団法人 日本暗号資産等取引業協会) | S5 |
| country | Japan | CCXT `countries: ['JP']` at `server/node_modules/ccxt/js/src/zaif.js` line 23 |
| products researched | spot, 56 pairs listed, 27 quoted in JPY | P1, see [`rest.md`](./rest.md) section 2 |
| market context | CoinGecko trust score 5 and trust rank 104, 24 h volume 4.14 BTC, 17 tickers, on 2026-09-23 UTC | S10 |

Who may trade, from the trading commencement standards (取引開始基準), S3:

- An individual must be aged 18 to 79.
- An individual must clearly not live in the EEA, the United States, or another country Zaif designates ("EEA圏内、米国、その他当社が定める国にお住まいでないことが明らかであること").
- An individual must not be a US citizen, which the page spells out as a US national or US permanent resident ("米国市民（米国籍保有者・米国永住権保有者等）に該当しないこと").
- A corporation must be registered in Japan ("日本国内で登記されていること").
- Nobody may deal with sanctioned persons or regions, which the page says include the three northeastern provinces of China and the Russian-controlled regions of Ukraine.
- The terms of service let Zaif refuse any registration without giving a reason, Article 3, S4.

So a US person, resident or citizen, may not trade on Zaif, and neither may a resident of the EEA.
The standards do not say in so many words that an individual must live in Japan, and a resident of another country is left to Zaif's list of designated countries, which is not published.

Access from this host: every request in this profile went out through a Surfshark WireGuard tunnel whose exit geolocated to Canada, with Cloudflare's trace reporting `loc=CA` and `colo=YVR` on 2026-09-23.
The public REST API at `api.zaif.jp`, the WebSocket at `ws.zaif.jp`, the fee page, the terms and the API documentation all answered with HTTP 200 and data, and no geoblock or refusal was seen, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

The spot schedule has one tier per pair group, and no volume tier, S1 and S2.

| pairs | maker | taker | maker ppm | taker ppm |
|---|---:|---:|---:|---:|
| `BTC/JPY`, `ETH/JPY`, `ETH/BTC` | 0 % | 0.1 % | 0 | 1,000 |
| the other 38 pairs on the fee page | 0 % | 0.3 % | 0 | 3,000 |
| 15 catalog pairs absent from the fee page | Not publicly specified | Not publicly specified | | |

The 15 catalog pairs absent from the fee page are the six event pairs `csbtc_btc`, `cseth_eth`, `csxem_xem`, `cszaif_zaif`, `cscmseth_erc20.cms` and `cscmsxem_mosaic.cms`, and `dep_jpy`, `dep_btc`, `polygon.mv_jpy`, `polygon.mv_btc`, `polygon.rond_jpy`, `polygon.rond_btc`, `zpg_jpy`, `zpgag_jpy` and `zpgpt_jpy`, compared by P1.
Nine of them had no book on the wire, see [`websocket.md`](./websocket.md) section 4.

The fee page heads the orderbook column "0%~", and its footnote defines the maker fee as the fee for an order that rests on the book and the taker fee as the fee for an order that takes one, S1.
The easy trading desk (かんたん売買) charges no explicit fee, and its prices include a spread of 0.1 % to 8.0 %, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT, USDC or coin-margined perpetuals | absent | the pairs catalog lists spot pairs only, P1. CCXT declares `'swap': false` at `zaif.js` line 31 and sets `'swap': false` on every parsed market at line 283. The CoinGecko derivatives list of 214 venues had no Zaif entry on 2026-09-23 UTC, S10 |
| JPY perpetual (AirFX) | retired | `GET /fapi/1/groups/all` still lists group 1, `btc_jpy`, `use_swap` true, with an end of 2099-12-31. Its book is empty, its newest trade is 2021-09-28 06:00:27 UTC, and its swap history ends at 2021-09-27 05:00 UTC with every rate 0, P3 |
| dated futures | retired | groups 2 to 5 of the same call are BTC/JPY futures that ended between 2017-06-30 and 2018-03-31, with empty books and newest trades from 2017-07-12 to 2018-03-24, P3 |
| margin trading (信用取引) | retired | the current API document v2.1.0 lists only the spot public API, the spot trading API, WebSocket, OAuth, payment, Q&A and other pages, S6. The legacy v1.1.1 document kept pages for the futures public API and the leverage trading API, S9. The annual report guide still names 信用取引, AirFX and 先物 as categories of past trades, S11. The fee page, the terms and the risk notice name no margin product today, S1, S4, S14 |
| options | absent | CCXT `'option': false` at `zaif.js` line 33, and no options page or API was found |
| spot | present | 56 pairs, 27 quoted in JPY, 24 in BTC and 5 in other assets, P1 |
| easy trading desk (かんたん売買) | present, not researched | S1 |
| deposits and withdrawals | named only | the lookup is https://zaif.jp/fee, S2 |

CCXT still carries the `fapi` public endpoints at `zaif.js` lines 154 to 162 and the `tlapi` leverage endpoints at lines 144 to 153, with the comment "has but unimplemented" on `'margin'` at line 30.

## 4. Spot tiers

No volume tier, VIP programme or market maker schedule is published, S1 and S2.
The whole schedule is the per pair table in section 2.
The fee page says fees may change without notice ("手数料は予告なく変更する場合がございます"), S2.

## 5. Discounts that change the spot taker

| discount | status | source |
|---|---|---|
| token holding | none found | S1, S2 |
| referral | none found on the fee page | S1 |
| market maker programme | none found | S1, S2 |
| zero fee promotion | none found: the campaign page listed no current campaign, and the news list of September 2026 carried only a coin savings plan campaign and an ETH reward programme, neither of which changes the taker | S13 |

## 6. Funding as a cost

Spot has no funding, and no margin product is offered today, see section 3.
The retired AirFX published a swap rate per side, `swap_rate_bid` and `swap_rate_ask`, every 2 hours, and all 24 readings of its last 46 hours, 2021-09-25 07:00 to 2021-09-27 05:00 UTC, were 0, P3.
Nothing here feeds an `AnchorRow`.

## 7. Liquidation, settlement and delisting

- No liquidation or settlement charge applies to spot.
- An account that has not finished identity verification pays an account maintenance fee each month: 200 JPY on a balance under 10,000 JPY and 10 % on a balance of 10,000 JPY or more, computed from the balance at midnight on the 1st and charged on the 15th, at a rate changed on 2024-07-10, S1 and S2.
- An account that has not entered its KYC details, such as occupation and purpose of trading, pays 250 JPY a month on the same schedule, S1.
- No delisting charge is published, S1.

## 8. CCXT

CCXT 4.5.68 sets one exchange-wide constant, `'taker': this.parseNumber('0.001')` and `'maker': this.parseNumber('0')`, at `server/node_modules/ccxt/js/src/zaif.js` lines 104 and 105.
`parseMarket` sets no per market fee, at lines 264 to 320, so every market inherits the constant through `this.fees['trading']` in `setMarkets`, at `server/node_modules/ccxt/js/src/base/Exchange.js` line 3735.

Without credentials, loadMarkets returned 56 markets, all spot, 0 swaps and 0 futures, P1.

| symbol | `market.taker` | `market.maker` | fee page taker |
|---|---:|---:|---:|
| `BTC/JPY`, `ETH/JPY`, `ETH/BTC` | 0.001 | 0 | 0.1 % |
| the other 53 markets | 0.001 | 0 | 0.3 % on 38 of them, unpublished on 15 |

So CCXT is right for the three main pairs and understates the taker of 38 pairs by 2,000 ppm.
`market.active` is `undefined` on every market, at line 286, and `contractSize` is `undefined`, at line 290, P1.
The engine's connector keeps only markets with `type === 'swap'` and `swap === true`, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 203, so Zaif contributes no market and the connector logs "no usable swap markets", at line 51.

## 9. Recommended registry values

None, because Zaif cannot join the engine as a perpetual leg.

If a later design adds spot legs, `takerPpm` cannot be one number, since the fee page charges 1,000 ppm on three pairs and 3,000 ppm on 38.
`ccxtTakerPpm` would be 1,000, the constant at `zaif.js` line 104, and a per pair override of 3,000 would be needed for every pair other than `btc_jpy`, `eth_jpy` and `eth_btc`.
Every Zaif market is quoted in JPY, BTC or a Zaif token, which the quote family does not merge with USD, USDC or USDT, at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a Zaif market would only ever pair with another JPY or BTC market.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fee Lists, English | https://zaif.jp/fee?lang=en | 2026-09-22 | Zaif Inc., Japan | per pair maker and taker, easy trading spread, maintenance fee, sections 2, 4, 5 and 7 |
| S2 | 手数料について, Japanese | https://zaif.jp/fee | 2026-09-22 | Zaif Inc., Japan | the same 41 pairs and rates, "予告なく変更", sections 2 and 4 |
| S3 | 取引開始基準 (trading commencement standards) | https://zaif.jp/terms_commencement_standards | 2026-09-22 | Zaif Inc., Japan | age, EEA and US exclusion, US citizens, Japanese corporations, sanctions, section 1 |
| S4 | 利用規約 (terms of service) | https://zaif.jp/terms | 2026-09-22 | Zaif Inc., Japan | Article 3 registration and refusal, section 1, and no margin product named, section 3 |
| S5 | 会社概要 (company outline) | https://corp.zaif.jp/outline/ | 2026-09-22 | Zaif Inc., Japan | operator, shareholder, registration number, association, section 1 |
| S6 | Zaif API document v2.1.0, table of contents | https://zaif-api-document.readthedocs.io/ja/latest/ | 2026-09-22 | Zaif Inc., Japan | the current API set, section 3 |
| S7 | 現物公開API (spot public API) | https://zaif-api-document.readthedocs.io/ja/latest/PublicAPI.html | 2026-09-22 | Zaif Inc., Japan | catalog fields, see [`rest.md`](./rest.md) |
| S8 | WebSocket API | https://zaif-api-document.readthedocs.io/ja/latest/WebSocket_API.html | 2026-09-22 | Zaif Inc., Japan | see [`websocket.md`](./websocket.md) |
| S9 | Zaif api document v1.1.1, legacy, with 先物公開API and the leverage trading API | https://techbureau-api-document.readthedocs.io/ja/latest/index.html | 2026-09-22 | techbureau, 2017 | the retired futures and leverage APIs, section 3 |
| S10 | CoinGecko exchange record and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/zaif | 2026-09-23 UTC | CoinGecko | trust score and rank, volume, no derivatives listing, sections 1 and 3 |
| S11 | 年間取引報告書(CSV)のご利用方法, updated 2026-08-05 | https://support.zaif.jp/hc/ja/articles/900005396903 | 2026-09-22 | Zaif Inc., Japan | 信用取引, AirFX and 先物 as past report categories, section 3 |
| S12 | CCXT 4.5.68 `zaif.js` | `server/node_modules/ccxt/js/src/zaif.js` | 2026-09-22 | CCXT | lines 23, 29 to 33, 104, 105, 144 to 162, 264 to 320 |
| S13 | Campaign page and news list | https://corp.zaif.jp/campaign and https://corp.zaif.jp/info | 2026-09-22 | Zaif Inc., Japan | no fee promotion, section 5 |
| S14 | 契約締結前交付書面 (pre-contract disclosure and risk notice) | https://zaif.jp/terms_risk | 2026-09-22 | Zaif Inc., Japan | no margin, leverage or futures product named, section 3 |
| P1 | `rest-probe.mjs catalog`, and the fee page parsed against the catalog | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | pairs, quotes, CCXT values, the 15 unlisted pairs |
| P2 | `rest-probe.mjs tickers` | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | volume context, see [`rest.md`](./rest.md) section 2 |
| P3 | `rest-probe.mjs futures` | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | retired AirFX and futures groups, sections 3 and 6 |
