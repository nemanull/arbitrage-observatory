# SafeTrade Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:41 to 04:57 UTC), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that Cloudflare places in Canada.
SafeTrade refuses Canada, so no SafeTrade endpoint answered, see [`rest.md`](./rest.md) section 1.

SafeTrade is a small spot exchange at `safetrade.com`, which still serves its API and sockets on `safe.trade`, S3.
It lists no perpetual, so this profile covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every live SafeTrade page and API path answered this host with HTTP 403 and a notice that SafeTrade does not serve Canadians, P1.
The fee rows below were therefore read from pages of the SafeTrade web app that the Internet Archive captured, decoded by [`archive-probe.mjs`](../../../scripts/probes/venues/safetrade/archive-probe.mjs), and never from SafeTrade itself.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 | |
| brand | SafeTrade, founded 2018 | S8 |
| legal entities | "SafeTrade Limited Co. and its wholly owned subsidiaries", and "Safetrade LLC" in the clause on automated trading | S2 |
| governing law | "the laws of SVG" | S2 |
| registered country | Saint Vincent and the Grenadines, as CoinGecko lists it | S8, P5 |
| who may trade | a user who is not "located in, under the jurisdiction of, or a national or resident of any Restricted Locations", and who certifies that they "pursue participation in blockchain-based networks as a part of your professional activity" | S2, sections 2.2 and 2.3 |
| regions excluded | the Terms name no Restricted Location. The geoblock page says "Safetrade does not currently allow trading or new signups for Canadians as of June 1, 2020." | S2, P1 |
| US persons | Not publicly specified. The Terms do not name the United States | S2 |
| arbitrage | the Terms define "Abusive Trading" to include "scalping, arbitrage, manipulations or exploitation of any temporal and/or minor inaccuracy in any rate or price", and "use of any robots" without written consent, and they allow suspension and withholding of funds for it | S2, sections 1.7 and 16 |

The Terms were read from the Internet Archive capture of 2026-05-08, because `https://safetrade.com/terms` refuses this host, P1.
An off-host fetch of `https://safetrade.com/` through the WebFetch tool got HTTP 403 as well on 2026-09-22.
The capture carries no "Last Updated" date.

## 2. Quick answer

| product | maker | taker | ppm | source |
|---|---|---|---|---|
| spot, every market, default group | 0.1 % | 0.1 % | maker 1,000, taker 1,000 | S4, P4 |

The default fee row is `{"id":29,"group":"any","market_id":"any","maker":"0.001","taker":"0.001"}`, identical in the captures of 2025-08-10 and 2026-09-07, P4.
The rates are fractions, so `0.001` is 0.1 % and 1,000 ppm.
No live fee reading was possible from this host.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | no market in the web app state of 2026-09-07 has a derivative name, and the market object has no type field, P4 |
| USDC-M perpetuals | absent | same |
| coin-M perpetuals | absent | same |
| dated futures | absent | same, and no help center article mentions futures, margin or leverage trading, S5 |
| options | absent | same |
| spot | present | 264 markets in the web app state of 2026-09-07, 101 `enabled` and 163 `disabled`, P4. CoinGecko listed 61 tickers on 2026-09-22, P5 |

CoinGecko's derivatives exchange list held 214 venues on 2026-09-22 and none is SafeTrade, P5.
The enabled spot markets by quote on 2026-09-07 were 54 USDT, 26 BTC, 3 ETH, 3 SAFE, 3 DAI, 2 USDC, 2 LTC, 2 PLS, and one each quoted in DOGE, SOL, KMD, QUBIC, RVN and XMR, P4.

## 4. Spot tiers

No volume tier is published.
The fee table is a list of rows keyed by member group and market, and the capture of 2026-09-07 holds four rows, P4.

| id | group | market_id | maker | taker | ppm |
|---:|---|---|---|---|---|
| 29 | `any` | `any` | 0.001 | 0.001 | 1,000 and 1,000 |
| 115 | `og` | `any` | 0.0005 | 0.0005 | 500 and 500 |
| 117 | `any` | `xntnpt` | 0 | 0 | 0 and 0 |
| 118 | `mm` | `/` | 0 | 0 | 0 and 0 |

How a member enters the `og` or `mm` group is Not publicly specified.
The names suggest early users and market makers, which is an inference.
Row 118 carries the market id `/` exactly as captured.
The row shape `id`, `group`, `market_id`, `maker`, `taker` is the `TradingFee` of Openware's Peatio `GET /public/trading_fees`, S7, which fits the Openware stack described in [`rest.md`](./rest.md) section 2.

The public fees page of 2025-08-10 rendered the table as "Showing 1 to 25 of 237 entries" with 0.1 % maker and 0.1 % taker on every row shown, and its state held only row 29, P4.

## 5. Discounts that change the spot taker

| discount | value | source |
|---|---|---|
| member group `og` | 500 ppm maker and taker | P4 |
| member group `mm` | 0 maker and taker | P4 |
| market `xntnpt` | 0 maker and taker, for every group | P4 |
| token holding | Not publicly specified. The SAFE coin is a quote asset on 3 markets, and no fee rule names it | P4 |
| referral | Not publicly specified | |
| zero fee promotions | none found in the 107 help center articles | S5 |

## 6. Funding as a cost

Not applicable.
SafeTrade lists no perpetual, so no funding is charged.

## 7. Liquidation, settlement and delisting

No margin product exists, so no liquidation or settlement fee applies.
A delisted market turns `disabled` in the market list, and 163 of 264 markets were `disabled` on 2026-09-07, P4.
Deposit and withdrawal fees are per currency and network in the web app's currency list, and this profile does not record them.

## 8. CCXT

CCXT 4.5.68 has no SafeTrade class.
`ccxt.exchanges` lists 104 ids, the only ids that match `safe` or `trade` are `bittrade` and `modetrade`, and no file under `server/node_modules/ccxt/js/src/` or its `pro/` folder contains `safe.trade` or `safetrade.com`, P2.
CCXT master has no class either.
`ts/src/safetrade.ts` and `ts/src/pro/safetrade.ts` return 404 from `raw.githubusercontent.com` on master, P6.
The `ts/src` listing at master commit `1d8b674`, dated 2026-09-22T12:48:27Z, holds 105 files with no SafeTrade name, S6.
A GitHub code search for `"safe.trade"` in `ccxt/ccxt` returned 0 results, S6.
So `market.taker` has no value to report.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | none | SafeTrade cannot join as a perpetual leg: it lists no perpetual, CCXT has no class for it, and it refuses this host |
| `ccxtTakerPpm` | none | no CCXT class |

Were SafeTrade spot ever modelled, the taker is 1,000 ppm at the default group, section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | SafeTrade home page, Internet Archive capture of 2026-09-07 11:18:23 UTC | http://web.archive.org/web/20260907111823/https://safetrade.com/ | 2026-09-22 | SafeTrade, global | fee rows, market list, sections 2 to 5 |
| S2 | SafeTrade Terms of Use, Internet Archive capture of 2026-05-08 12:11:45 UTC | http://web.archive.org/web/20260508121145/https://safetrade.com/terms | 2026-09-22 | SafeTrade Limited Co., SVG law | entities, eligibility, Abusive Trading, section 1 |
| S3 | "Safetrade.com is now the offical home of Safetrade!", help center, 2024-06-19 | https://support.safetrade.com/hc/en-us/articles/27715005079693-Safetrade-com-is-now-the-offical-home-of-Safetrade | 2026-09-22 | SafeTrade | `safe.trade` kept for the API |
| S4 | SafeTrade fees page, Internet Archive capture of 2025-08-10 12:52:49 UTC | http://web.archive.org/web/20250810125249/https://safetrade.com/fees | 2026-09-22 | SafeTrade, global | 0.1 % maker and taker per market, section 4 |
| S5 | SafeTrade help center article list, Zendesk API | https://support.safetrade.com/api/v2/help_center/en-us/articles.json | 2026-09-22 | SafeTrade | 107 articles, no fee schedule, no derivative product, no API documentation |
| S6 | CCXT repository, master branch | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no SafeTrade class, section 8 |
| S7 | Openware Peatio user API v2, branch 2-6-stable | https://github.com/openware/peatio/blob/2-6-stable/docs/api/peatio_user_api_v2.md | 2026-09-22 | Openware | `TradingFee` row shape, section 4 |
| S8 | CoinGecko exchange record `safe_trade` | https://api.coingecko.com/api/v3/exchanges/safe_trade | 2026-09-22 | CoinGecko | country, year, listing context |
| P1 | `rest-probe.mjs access` | [`rest-probe.mjs`](../../../scripts/probes/venues/safetrade/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | the geoblock, section 1 |
| P2 | `rest-probe.mjs ccxt` | [`rest-probe.mjs`](../../../scripts/probes/venues/safetrade/rest-probe.mjs) | 2026-09-22 | this host | no class in CCXT 4.5.68, section 8 |
| P4 | `archive-probe.mjs wayback` | [`archive-probe.mjs`](../../../scripts/probes/venues/safetrade/archive-probe.mjs) | 2026-09-22 | Internet Archive | fee rows and markets, sections 2 to 5 and 7 |
| P5 | `archive-probe.mjs coingecko` | [`archive-probe.mjs`](../../../scripts/probes/venues/safetrade/archive-probe.mjs) | 2026-09-22 | CoinGecko | tickers, derivatives list, section 3 |
| P6 | `archive-probe.mjs ccxt-master` | [`archive-probe.mjs`](../../../scripts/probes/venues/safetrade/archive-probe.mjs) | 2026-09-22 | GitHub | no master class, section 8 |
