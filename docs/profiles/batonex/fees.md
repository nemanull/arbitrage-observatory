# Batonex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:41 to 06:55 UTC (2026-09-23 evening Pacific), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the trading fees of Batonex for its one perpetual family, USDT-margined.
Batonex has no CCXT class, so the fee here comes from the venue's own pages only.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "Pointex LLC, the operator of this website" | S3 |
| governing law | the laws of Seychelles, spelled "Seychells" in both documents | S3, S4 |
| excluded regions | no list is published. The terms exclude "persons residing in any country where the provision of such services or investments would be contrary to the applicable local laws or regulation" | S3 |
| US persons | the United States is absent from the registration country list, which holds 214 countries, while Canada, the United Kingdom, Russia, Cuba and Syria are present with `allowRegister` 1 | S5 |
| earlier name | the level icons load from `static.wisebitcoin.pro`, a footer link points to `www.wisebitcoin.com/newsroom/notice`, and the Android app id is `com.wisebitcoin.broker.android` | S5, S6 |
| platform | the BHEX broker platform, from the `/openapi` routes and the `orgId` 9001 broker config | [`rest.md`](./rest.md) section 2 |

So a US person cannot register, and nothing published names another excluded country.
The site, the documentation, the REST API and the WebSocket all answered this host through the Canadian VPN exit with HTTP 200.
The help centre pages at `support.batonex.com` and `batonexsupport.zendesk.com` answered HTTP 403 with a Cloudflare "Just a moment..." challenge, and the same articles were read through the Zendesk help centre API, which answered HTTP 200.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-margined perpetuals | 0.02%, 200 ppm | 0.07%, 700 ppm | S1, S2 |

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes, 119 `TRADING` | `/openapi/v1/brokerInfo` `contracts`, [`rest.md`](./rest.md) section 2 |
| coin-margined or inverse perpetuals | no | every contract has `inverse` false and `marginToken` `USDT` |
| USDC-margined perpetuals | no | same |
| dated futures | no | no contract carries an expiry, and the guide calls them perpetual |
| options | no | `options` is an empty array in `brokerInfo` |
| spot | yes, 30 pairs, 0.1% maker and 0.1% taker | `brokerInfo` `symbols`, S1, S2 |
| margin | the web app has margin routes | not researched |

## 4. Perpetual tiers

None are published.
The commission page shows one row, "Perpetual Contracts Exchange (USDT, Crypto Contract)" at 0.02% maker and 0.07% taker, S2.
The user level call `/api/user/get_userlevel_configs` returns one level, `Lv.0`, with `contractBuyTakerDiscount` and every other discount at `"1"`, meaning no discount, S5.
The equity and commodity perpetuals such as `AAPL-USDT-PERP` are not priced separately anywhere, so whether they carry the same 0.07% is Not verified.

## 5. Discounts that change the perpetual taker

None is published.
The web app has an affiliate programme at `https://www.batonex.com/en/partnership/` and a BTX token with a mining scheme, S6, and neither page names a trading fee discount.
No zero fee promotion was listed on the commission page on 2026-09-24 UTC.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | 8 hours, at 00:00, 08:00 and 16:00 UTC | S7, and 116 of 116 rows of `/openapi/contract/v1/fundingRate` span 8 h, [`rest.md`](./rest.md) section 3 |
| who pays | "You will only pay or receive funding if you hold a position at one of these times." | S7 |
| formula, cap and floor | not published | S7 and the API documentation hold none |
| observed range | upcoming rate `-0.00023723` to `0.00027668` over 116 contracts | [`rest.md`](./rest.md) section 4 |
| observed settled rates, `BTC-SWAP-USDT` | `0.00000101` at `1790208000000`, `-0.000351420043580963` at `1790179200000`, `0.00000332` and `0.00001021` before | `https://www.batonex.com/api/contract/history_funding_rates?symbol_id=BTC-SWAP-USDT&limit=6` |

The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

The contract terms name a "Forced-Liquidation Fee Rate" that is added to the maintenance margin ratio as the trigger, S4, and publish no value for it.
The risk limit tiers are in `brokerInfo` per contract, as `riskLimits` with `initialMargin` and `maintMargin`, for example 0.02 and 0.01 up to 100,000 contracts on `0G-USDT-PERP`.
Delistings are announced on the notice page, for example "Delisting of BLAST Perpetual Contract" on 2026-09-08 and "Delisting of NEO Perpetual Contract" on 2026-09-01, S2.
No settlement or delisting charge is published.

## 8. CCXT

No class exists.
CCXT 4.5.68 in `server/node_modules` lists 104 exchanges and none matches `bato`, `wise`, `bhex` or `hbtc`.
The current master of `github.com/ccxt/ccxt` has no Batonex file in `ts/src` on 2026-09-24 UTC.
So `market.taker` for a Batonex market does not exist, and `ccxtTakerPpm` has no CCXT line to cite.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 700 | the published perpetual taker, S1 and S2, with no tier or discount below it |
| `ccxtTakerPpm` | unset | no CCXT class |

The venue is not recommended for the engine in its current shape, see [`rest.md`](./rest.md) sections 3 and 4.

## 10. Source ledger

| id | source | used for |
|---|---|---|
| S1 | "Fees", `https://support.batonex.com/hc/en-001/articles/35514809669785-Fees`, updated 2025-06-25, read through `https://batonexsupport.zendesk.com/api/v2/help_center/en-001/articles.json` | 0.02% maker, 0.07% taker, spot 0.1% |
| S2 | `https://www.batonex.com/en/commission`, rendered once with headless Chrome because the site is a client-side app | commission table, notices |
| S3 | `https://www.batonex.com/en/about_us/terms_conditions`, rendered the same way | operator, governing law, regional clause |
| S4 | `https://www.batonex.com/en/about_us/contract_terms_conditions`, rendered the same way | eligibility, funding, forced liquidation fee, governing law |
| S5 | `https://www.batonex.com/s_api/basic/countries` and `https://www.batonex.com/api/user/get_userlevel_configs`, the web app's public calls | registration countries, level discounts |
| S6 | `https://www.batonex.com/s_api/basic/index_config` and the help centre article list | footer links, `wisebitcoin` asset hosts, BTX mining articles |
| S7 | `https://www.batonex.com/en/guide/perpetual/intro`, rendered once with headless Chrome | funding schedule and who pays |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/batonex/rest-probe.mjs) | catalog, funding rows, CCXT list |
