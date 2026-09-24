# Emirex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 04:23 and 04:46 UTC on 2026-09-23, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the fees of Emirex, which has no CCXT class, on its spot market.
Emirex lists no perpetual, no dated future, no option and no margin pair, so the venue is profiled on spot as the survey plan's template change 1 says, see section 3.
Emirex publishes no readable fee schedule page.
Every fee number below comes from the public config call that the Emirex web app loads on every page, and from the web app code that renders it, see section 2.
Probe references are to [`rest-probe.mjs`](../../../scripts/probes/venues/emirex/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/emirex/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "Emiverse SVG LLC, a limited liability company duly incorporated and registered under the laws of Saint Vincent and the Grenadines", the counterparty of the Terms of Use | S2 |
| terms version | "Last modified: 3 months ago" on 2026-09-23, with no absolute date on the page | S2, S3 |
| other claims | the About us article and CoinGecko's description say Emirex was "Established in Estonia", with "a wider presence in the Czech Republic and Lithuania", and that `emirex.com` is "regulated by the authorities of the Czech Republic and Lithuania". No licence number or regulator register entry is cited. CoinGecko lists the country as United Arab Emirates and the year as 2014 | S4, S6 |
| second domain | CoinGecko's description names `emirex.ee` as the Estonian platform. `emirex.ee` and `www.emirex.ee` did not resolve in DNS from this host on 2026-09-23 | S6, P1 |
| excluded regions | the Terms say "You must not use the Services if" you are "located in a restricted jurisdiction" or "listed on any sanctions list". No list of restricted jurisdictions is published. The Terms defer "Restricted Person" to the AML/KYC Policy, and that policy does not contain the term | S2, S3 |
| US persons | Not publicly specified. Neither the Terms nor the AML/KYC Policy names the United States | S2, S3 |
| KYC | the AML/KYC Policy applies customer due diligence to every user, with simplified and enhanced tiers by risk | S3 |
| public API from this host | every public REST call answered 200, apart from the 400 and 404 replies to deliberately wrong requests, and the socket.io endpoint answered 101, through Cloudflare edges tagged SEA and YVR, with no geoblock. The host reaches the internet through a Canadian VPN exit, so these results are from that exit | P1, P3 |

Who may open an account is decided at KYC, which this profile did not reach.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, all 12 pairs | 0.8 %, 8,000 ppm | 0.8 %, 8,000 ppm | P1, `POST /api/default/config` field `trade_commission`, `limit_percent` 0.8 and `market_percent` "0.8" on every pair |

The web app's fee page renders those two fields as `market_percent` followed by "%" and `limit_percent` followed by "%", in the fee page chunk S5, so 0.8 is a percent and not a fraction.
The bulk ticker repeats the same numbers per pair as `commission_percent` "0.8" and `commission_percent_market` "0.8", P1.
`https://emirex.com/fees` redirects with 301 to `/fees/`, a Tilda export whose record container is empty, so no rendered schedule could be read, S5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals | absent | no perpetual in the API documentation S1, no futures, perpetual or funding string in the 29 web app bundles of the trading page, CoinGecko's derivatives list of 214 venues has no Emirex entry, and `/v1/public/fundingRate` answers 404, P1, S6 |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| margin | absent in practice | the web app has `/margin/trading/` routes, but `margin_pair_list`, `margin_currency_list` and `margin_trade_commission` are `[]` in the config, and `GET /api/default/ticker-margin` returns `{"status":true,"data":[],"is_login":false}`, P1 |
| spot | present, researched here | 12 pairs: BTC, LINK, ETH, SOL, DOGE, DOT, BNB, BCH, ADA, LTC and ALGO against USDC, and USDC against USDT, P1 |

## 4. Spot tiers

No tier table is published, and the config carries none.
Every pair's `trade_commission` entry has `fixed` 0, `min_commission` 0, `percent` 0.8, `market_percent` "0.8", `limit_percent` 0.8, `quick_market_percent` 0 and `special` `[]`, P1.
The config lists five order types: "Limit", "Market", "Stop Limit", "Quick market" and "Limit Hidden", P1.
`commission_percent_limit_hidden` is "0.00000000" on every pair, and whether that means hidden limit orders trade free is Not publicly specified.

## 5. Discounts that change the taker

None published.
The `special` array, the only per pair override the config carries, is empty on all 12 pairs, P1.
The config lists an Ethereum contract for an `EMRX` token, but no `EMRX` pair is listed and no token holding discount is documented, P1.
No referral rebate, market maker programme or zero fee promotion was found in the knowledge base index of 60 articles, S7.

## 6. Funding as a cost

Not applicable.
Emirex lists no perpetual, so there is no funding rate, interval or settlement, see section 3.

## 7. Liquidation, settlement and delisting

Not applicable to spot trading.
Withdrawal fees are published per coin in the config field `commission`, 22 currencies on 2026-09-23, and on the web app fee page, P1 and S5.

## 8. CCXT

CCXT 4.5.68 has no Emirex class.
`require('ccxt').exchanges` run from `server/` lists 104 ids, and the only ids matching `emi` or `mirex` are `gemini` and `mudrex`, P1.
`server/node_modules/ccxt/js/src/` has no `emirex.js`, and no file under it contains the string `emirex`.
The CCXT master branch on GitHub had no Emirex class either: the `ts/src` listing at commit `1d8b674` of 2026-09-22 12:48 UTC held 112 entries, and the only names matching are `gemini.ts` and `mudrex.ts`, S8.
So `market.taker` has no source, and `ccxtTakerPpm` is null.

## 9. Recommended registry values

No registry entry is recommended, because Emirex has no perpetual and no CCXT class for the connector to load.
If a spot stage ever needs the number, the taker is 8,000 ppm from `trade_commission`, and it should be read from the config rather than hard coded, since the config is the only published source.
At 8,000 ppm a leg costs about eleven times the 702 and 718 ppm `BTCUSDC` spreads measured on the Emirex book, see [`rest.md`](./rest.md) section 5.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Emirex Exchange API, apidoc 0.22.0, generated 2022-04-14 | https://docs.emirex.com/ (data in `api_project.js` and `api_data.js`) | 2026-09-22 | Emirex | public, socket and private calls, no derivatives, section 3 |
| S2 | Terms of Use | https://emirex.userecho.com/knowledge-bases/2/articles/668-terms-of-use | 2026-09-22 | Emiverse SVG LLC | operator, restricted jurisdictions clause, section 1 |
| S3 | KYC/AML Policy | https://emirex.userecho.com/knowledge-bases/2/articles/665-kycaml-policy | 2026-09-22 | Emiverse SVG LLC | due diligence, no restricted list, section 1 |
| S4 | About us | https://emirex.userecho.com/knowledge-bases/2/articles/1071-about-us | 2026-09-22 | Emirex | Estonia, Czech Republic and Lithuania claims, section 1 |
| S5 | Fee page and its web app chunk | https://emirex.com/fees and https://emirex.com/_nuxt/pages/fees/f075b844.5fc97bc.js | 2026-09-22 | Emirex | empty Tilda page, fields rendered as a percent, section 2 |
| S6 | CoinGecko exchange record and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/emirex and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | country, year, trust score rank 130, 12 pairs, 28.76 BTC 24 h volume, no derivatives entry, sections 1 and 3 |
| S7 | Knowledge base index | https://emirex.userecho.com/knowledge-bases/2-knowledge-base-emirexcom | 2026-09-22 | Emirex | 60 articles, none on trading fees, section 5 |
| S8 | CCXT `ts/src` on GitHub | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Emirex class in master, section 8 |
| P1 | `rest-probe.mjs all` at 04:32 UTC, rerun at 04:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/emirex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | config, bulk ticker, margin lists, CCXT ids, sections 1 to 8 |
| P3 | `ws-probe.mjs book` at 04:34 UTC, rerun at 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/emirex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | socket reachable, section 1 |
