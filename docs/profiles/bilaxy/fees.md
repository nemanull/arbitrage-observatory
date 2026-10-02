# Bilaxy Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:43 to 05:10 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare loc=CA, SEA edge).

Bilaxy is CoinGecko's trust rank 161 in the survey list of 2026-09-22, it lists no perpetual, and it has no CCXT class.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Every access result below comes from that Canadian VPN exit, not from a US address.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bilaxy/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bilaxy/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 local time for every source row | source ledger |
| operator | no legal entity is named in the Terms of Service or on the site. CoinGecko lists the country as Seychelles | S3, S6 |
| CoinGecko listing | "Bilaxy", established 2018, country Seychelles, trust score 2, `trust_score_rank` 170 in the API reply of 2026-09-23 about 04:43 UTC against rank 161 in the survey list, 24 h volume 178.9 BTC, 45 pairs tracked | S6 |
| who may open an account | anyone who is "neither a United States user, a Mainland China user, a Singapore user or other users who are not allowed to register on this platform according to your local laws" | S3, Terms of Service section on eligibility, updated 2024-04-27 |
| US persons | excluded by the Terms of Service | S3 |
| Canada | not named among the excluded regions | S3 |
| KYC | a KYC FAQ exists and the site bundle calls `/api/v1/account/uploadAuth`, but the levels were not read | S5 |
| official pages from this host | the help center API at `bilaxy.zendesk.com` answered 200 for every article read, and `https://bilaxy.com/` answered 200 | curl, 2026-09-23 between 04:40 and 05:00 UTC |
| API from this host | public REST and WebSocket answer normally, no geoblock, but CloudFront answers HTTP 403 to any request that carries no `User-Agent` header | [`rest.md`](./rest.md) section 1 |
| history | the help center announced on 2021-11-27 that trading would resume "one by one from Nov.30" after "series of systems upgradings", and the site bundle still calls `/api/v1/account/case828CompensationPlan` | S7, site bundle `assets/index-DW28pl_G.js` |

## 2. Quick answer

Bilaxy lists no perpetual, so there is no perpetual VIP 0 fee.
The spot VIP 0 numbers are below.

| market | maker | taker | evidence |
|---|---|---|---|
| every spot pair, 96 trade-enabled | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | S1: "All trades are charged 0.2%" |
| every spot pair, with the BIA fee option switched on | 0.1 %, 1,000 ppm | 0.1 %, 1,000 ppm | S1 and S2, and the site bundle applies `discount:.5` to the fee it shows |

The fee page names one rate for all trades and no maker and taker split.
The site's own fee call, `GET https://bilaxy.com/api/v2/market/getFee?symbol=<pair_id>`, answered `{"buyFee":0.0,"sellFee":0.0}` without a session for pair 113, pair 79 and the nonexistent pair 999999, so the zero is the anonymous default and not a fee, `rest-probe.mjs catalog`.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals, any settlement | absent | the public API documents spot endpoints only, S4. `GET /v1/pairs` lists 204 spot pairs and no contract field, `rest-probe.mjs catalog`. CoinGecko's derivatives exchange list of 214 venues has no Bilaxy entry, S6. The help center search for "perpetual" returns 0 articles and "futures" returns 3 unrelated ones, S5 |
| dated futures | absent | same catalog and documentation |
| options | absent | same |
| margin | absent | no margin endpoint in S4. The `leverage` fields in the site bundle belong to a Hyperliquid testnet dashboard at `/dashboard/llm-trader`, whose code posts to `https://api.hyperliquid-testnet.xyz/info`, not to a Bilaxy product |
| spot, ETH quoted | present, 85 trade-enabled and 55 disabled | `rest-probe.mjs catalog` |
| spot, USDT quoted | present, 11 trade-enabled and 6 disabled: `AEVO_USDT`, `BIA_USDT`, `BTC_USDT`, `DIA_USDT`, `DOT_USDT`, `ETH_USDT`, `NIHAO_USDT`, `OP_USDT`, `PFI_USDT`, `POL_USDT`, `USDC_USDT` | same |
| spot, BNB, BTC and USDC quoted | 45, 1 and 1 pairs, all disabled | same |
| "Swap" | a web-only feature launched 2024-01-31 that routes "any token on the ETH chain" through a decentralized exchange, not a perpetual swap | S8 |

Deposit is free and withdrawal fees are per coin on the withdrawal page and in `GET /v1/currencies`, S1 and S4, and are not recorded here.

## 4. Spot tiers

The fee page lists one rate, 0.2 % "calculated by taking the (amount * purchase price * .002)", and no tier table and no volume rule, S1.
The page was created 2018-11-30, last edited 2021-05-19 and last updated 2024-03-16, S1.
It says the fee is taken from what the user receives: "you bought BTC, 0.2% of your btc bought amount will be charged as trading fee", S1.

## 5. Discounts that change the spot taker

| discount | effect | evidence |
|---|---|---|
| pay the fee in BIA | 50 % off, so 0.1 % | S1 and S2. The article title says "Enjoy 50% of Fee Deducted", and the fee page links it under an older slug that says 80 %. The site toggles it through `/api/v1/account/updateUseBiaFee` and multiplies the fee by `discount:.5` |
| market maker plan | "free for trading" for approved market makers who hold at least 200 ETH and meet a daily volume, applied by Telegram, dated 2018-07-16 | S9 |
| trading resumption credit | a free trading fee allowance of 200 USDT per withdrawal made between 2021-09-23 and 2021-11-27, until used up | S7 |
| referral | a "Super Referral Program" article exists, dated 2019-04-08, and was not read | S5 |

No zero fee promotion with an end date was found in the first ten results of the help center search for "trading fee", which are the fee pages above, the resumption plan, the referral program and trading competitions from 2020 and 2021, S5.

## 6. Funding as a cost

Not applicable.
Bilaxy lists no perpetual, so there is no funding rate, interval, cap or settlement.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement on a spot-only venue.
Delistings are announced in the help center, most recently "Announcement on Delisting of Some Tokens - June.12.2026", S5.
The catalog carries `trade_enabled` false on 108 of 204 pairs and `closed` false on all 204, so `closed` does not mark a delisted pair, [`rest.md`](./rest.md) section 2.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids and none matches `bilaxy`, from `node -e "console.log(require('ccxt').exchanges)"` run from `server/`, and `rest-probe.mjs catalog`. `server/node_modules/ccxt/js/src` has no file whose name contains `bil` |
| CCXT master on GitHub | `exchanges.json` on the `master` branch, package version 4.5.82, lists 105 REST ids and none is Bilaxy. `ts/src/bilaxy.ts` and `ts/src/pro/bilaxy.ts` answer 404 on `raw.githubusercontent.com`, S10. The GitHub contents API refused the listing with a rate limit, so the directory was not listed |
| open requests | CCXT issue 18053 "New Exchange: bilaxy" of 2023-05-28 is closed, S10 |
| `market.taker` | none, there is no class to report one |

## 9. Recommended registry values

No registry entry is recommended.
Bilaxy has no swap market and no CCXT class, so the connector at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 63 to 68 and 196 to 202 would load nothing.
If a spot leg were ever built outside CCXT, `takerPpm` would be 2,000 and `ccxtTakerPpm` would stay unset.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bilaxy Fee Structure, help center article 360020409731 | https://bilaxy.zendesk.com/hc/en-us/articles/360020409731-Bilaxy-Fee-Structure- | 2026-09-22, through the help center API | Bilaxy, global | 0.2 % on all trades, BIA 0.1 %, charging rule, sections 2, 4 and 5 |
| S2 | Use BIA to Pay Trading Fee, Enjoy 50% of Fee Deducted, article 360026485691 | https://bilaxy.zendesk.com/hc/en-us/articles/360026485691 | 2026-09-22, the article body is empty in the API reply, only the title was read | Bilaxy, global | BIA discount, section 5 |
| S3 | Terms of Service, article 360020731311 | https://bilaxy.zendesk.com/hc/en-us/articles/360020731311-User-Agreement | 2026-09-22, updated 2024-04-27 | Bilaxy, global | excluded users, no entity named, section 1 |
| S4 | Official Documentation for the Bilaxy APIs and Websockets, `restapi.md` and `websocket.md` | https://github.com/bilaxy-exchange/bilaxy-api-docs | 2026-09-22 | Bilaxy | spot endpoints only, sections 3 and 5 |
| S5 | help center search API, queries "futures", "perpetual", "contract", "trading fee", "API", and the newest articles | https://bilaxy.zendesk.com/api/v2/help_center/articles/search.json | 2026-09-22 | Bilaxy | product absence, delistings, referral, section 3, 5 and 7 |
| S6 | CoinGecko exchange record and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/bilaxy and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 about 04:43 and 04:58 UTC | CoinGecko | country, trust rank, volume, derivatives absence, sections 1 and 3 |
| S7 | Trading Resumption Plan, article 4410515495065 | https://bilaxy.zendesk.com/hc/en-us/articles/4410515495065 | 2026-09-22 | Bilaxy | 2021 resumption and fee credit, sections 1 and 5 |
| S8 | Important Notice on Bilaxy's Launch of New Features: "Filter Tool" and "Swap", article 28244590464665 | https://bilaxy.zendesk.com/hc/en-us/articles/28244590464665 | 2026-09-22 | Bilaxy | "Swap" is an on-chain token swap, section 3 |
| S9 | Bilaxy Launches Market Maker Plan, article 360020414471 | https://bilaxy.zendesk.com/hc/en-us/articles/360020414471 | 2026-09-22 | Bilaxy | market maker fee waiver, section 5 |
| S10 | CCXT `master` branch: `exchanges.json`, `package.json`, `ts/src/bilaxy.ts`, and issue 18053 | https://github.com/ccxt/ccxt | 2026-09-23 about 04:42 UTC | CCXT | no class in 4.5.68 or on master, section 8 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/bilaxy/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | catalog counts, the fee call, CCXT ids, sections 2, 3 and 8 |
