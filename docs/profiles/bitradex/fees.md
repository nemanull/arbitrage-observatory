# BitradeX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 between 06:41 and 06:58 UTC (the evening of 2026-09-23 local time), from the development host near Seattle through its Surfshark WireGuard exit, which Cloudflare placed at loc=CA, colo=YVR.

This profile covers the USDT-margined perpetuals of BitradeX (www.bitradex.ai, formerly www.bitradex.com), the only derivatives family it lists.
BitradeX publishes no API documentation and has no CCXT class.
Every fee number below comes from the JSON the www.bitradex.ai web app itself calls, read by [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs), because the public fee page renders "- -" until a user logs in, S2.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator named on the site | BITRADEX FINTECH LIMITED, registered in the United Kingdom, with a U.S. FinCEN MSB registration 31000295285682 | S3 |
| counterparty named in the terms | "the counterparty to each user transaction is BitradeX Singapore", governing law England and Wales, arbitration in Hong Kong | S4 |
| prohibited countries in the user agreement | Canada (Alberta), Crimea, Donetsk, Luhansk, Cuba, China, China (Hong Kong), Iran, North Korea, Singapore, Sudan, Syria, Iraq, Libya, Yemen, Afghanistan, Central African Republic, Democratic Republic of the Congo, Guinea-Bissau, Haiti, Lebanon, Somalia, the Netherlands and South Sudan | S5 |
| restricted areas in the disclaimer | Afghanistan, Algeria, Bangladesh, Bolivia, Canada, Cuba, El Salvador, France and its overseas territories, Hong Kong, Iran, India, Japan, Malaysia, Nepal, Nigeria, North Korea, Syria, Crimea, Donetsk and Luhansk, the United States of America and all US territories, and Uzbekistan | S6 |
| further restrictions | Australia and the United Kingdom "especially regarding our derivatives-related" services | S6 |

US persons may not trade, by the disclaimer, S6.
The user agreement does not mention the United States at all, and the two documents disagree on Canada: the agreement names only Alberta, the disclaimer names all of Canada.
The access results in [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 come from the Canadian VPN exit, and every public endpoint answered it.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, fee step table | 0.04 %, 400 ppm | 0.06 %, 600 ppm | `getStepRates` VIP0, P1 |
| USDT-M perpetuals, per symbol field, 51 and 54 of 56 trading symbols | 0.04 %, 400 ppm | 0.06 %, 600 ppm | `symbol/list` `makerFee` and `takerFee`, P1 |
| `btc_usdt` per symbol field | 0.02 %, 200 ppm | 0.065 %, 650 ppm | P1 |
| `eth_usdt` per symbol field | 0.02 %, 200 ppm | 0.65 %, 6,500 ppm | P1 |
| `sol_usdt`, `xrp_usdt`, `bnb_usdt` per symbol field | 0.02 %, 200 ppm | 0.06 %, 600 ppm | P1 |

Which of the two sources a VIP 0 fill is charged, the step table or the per symbol field, is Not verified, because it needs an account.
The `eth_usdt` taker of 0.0065 is ten times its neighbours and reads like a data entry slip, but it is what the venue publishes, and it was the same in the Wayback Machine capture of 2026-09-14, P3.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 72 listed, 56 with `tradeSwitch` true | `symbol/list`, all `contractType` `PERPETUAL`, `underlyingType` `U_BASED`, P1 |
| a SOL-quoted perpetual | listed but not trading, `xaut_sol` with `tradeSwitch` false | P1 |
| coin-margined perpetuals | a `future-c` path exists in the web app, not probed | `/v1/future-c/market/v2/public/symbol/list` in the `_app` bundle, S1 |
| dated futures | none listed | P1 |
| options | none seen | S1 |
| spot | yes, `/v1/spot/...` paths in the web app | S1 |

The 56 trading perpetuals include tokenised equity and commodity contracts: `nvda_usdt`, `mu_usdt`, `skhynix_usdt`, `sndk_usdt`, `xau_usdt` and `paxg_usdt`, P1.

## 4. Perpetual tiers

From `GET https://www.bitradex.ai/v1/future-u/user/public/user/step-rate/getStepRates`, read live on 2026-09-24 and identical in the Wayback capture of 2026-09-14, P1 and P3.

| step | 30 day volume, field `tradeVolume` | maker | taker | retention days |
|---|---:|---:|---:|---:|
| VIP0 | 0 | 0.0004 | 0.0006 | 30 |
| VIP1 | 100 | 0.00038 | 0.000588 | 30 |
| VIP2 | 1,000,000 | 0.00036 | 0.00057 | 30 |
| VIP3 | 5,000,000 | 0.00034 | 0.00054 | 90 |
| VIP4 | 10,000,000 | 0.00032 | 0.00051 | 90 |
| VIP5 | 15,000,000 | 0.00028 | 0.00048 | 90 |
| VIP6 | 30,000,000 | 0.00024 | 0.00045 | 180 |
| VIP7 | 50,000,000 | 0.0002 | 0.00045 | 180 |

The unit of `tradeVolume` is not stated in the reply, and the fee page heads the column "Trading Volume in the Last 30 Days (Equivalent USDT)" with a "BitradeX Holdings" column beside it, S2.
Every step was last updated in June or July 2023.

## 5. Discounts that change the perpetual taker

The fee page shows a "BitradeX Holdings" column, so holding the BXC token may move a user between steps, S2.
Its thresholds render only after login and are Not verified.
No zero fee promotion, market maker programme or API fee schedule was found in the web app or by search.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | 8 h on 55 trading perpetuals, 4 h on `trump_usdt` | `q/funding-rate` `collectionInternal`, P2 |
| settlement instants | 00:00, 08:00 and 16:00 UTC in the `btc_usdt` history | `q/funding-rate-record`, P2 |
| next settlement | 2026-09-24 08:00 UTC on all 56, including the 4 h contract | P2 |
| published rate | moves between reads, so it is the rate for the upcoming settlement | `cookie_usdt` read 0.007119 and then 0.007166 about 3 minutes later, P2 |
| observed range | 0.007166 on `cookie_usdt` to -0.006461 on `rune_usdt`, 31 of 56 at exactly 0.0001 | P2 |
| formula, cap and floor | not published | S1, S7 |
| who pays | positive rate, longs pay shorts, per a search summary of the funding page | S7 |

The settlement instant itself was not captured.
The funding page at S7 renders its numbers only in the browser, so the rules above come from the JSON and not from a published rule.

## 7. Liquidation, settlement and delisting

`btc_usdt` carries `liquidationFee` 0.0125, 1.25 %, in `symbol/list`, P1.
No settlement or delisting charge is published.
16 of the 72 listed perpetuals have `tradeSwitch` false, and they stay in `symbol/list` and in the tickers.

## 8. CCXT

CCXT 4.5.68 has no BitradeX class.
`ccxt.exchanges` lists 104 ids, and the only ids matching `trade` are `bittrade` and `modetrade`, checked from `server/` on 2026-09-24 before the TypeScript server moved to `old_ts_server/`.
The CCXT master tree on GitHub has no `ts/src/bitradex.ts` (HTTP 404 from the contents API) and no file whose name contains `radex` except `paradex.ts`, checked the same day.

The web app's paths and payloads match the shape of XT.com's futures API, for example `q/agg-tickers`, `q/funding-rate` and `step-rate`, and CCXT's `xt` class carries `'future/market/v1/public/q/agg-tickers'` at `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/xt.js` line 173 on host `https://fapi.xt.com` at line 136.
The prefixes differ, `/v1/future-u/market/public/` on BitradeX, so the `xt` class cannot be pointed at BitradeX by a URL override alone.
That BitradeX runs on XT's software is an inference from the shape, not a published fact.

`market.taker` without credentials: none, since there is no class.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 in the step table and the per symbol field of 54 of 56 trading perpetuals |
| per market exception | `btc_usdt` 650 and `eth_usdt` 6,500, if the per symbol field is what a fill pays | Not verified without an account |
| `ccxtTakerPpm` | none | no CCXT class |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | www.bitradex.ai `_app` JavaScript bundles | `https://static3.bitradex.mobi/web/web/_next/static/chunks/pages/_app-759ef86c4e08dba3.js` (archived 2026-09-16 page) and `_app-162d08fa1081a2f4.js` (live page) | 2026-09-24 | BitradeX | API paths, socket URL, ping, coverage |
| S2 | BitradeX fees page | https://www.bitradex.ai/en/fees | 2026-09-24 | BitradeX | column headings, values need login |
| S3 | BitradeX Background and Regulation, blog | https://www.bitradex.ai/en/blog/ecosystem/bitradex-background-and-regulation-what-traders-should-know/ | 2026-09-24 | BitradeX | entity, MSB number |
| S4 | Crypto Trading Terms of Service | https://www.bitradex.ai/en/user/terms_of_service | 2026-09-24 | BitradeX | counterparty, governing law, API rate clause |
| S5 | Platform Service User Agreement | https://www.bitradex.ai/en/user/user_agreement | 2026-09-24 | BitradeX | prohibited countries |
| S6 | Disclaimer | https://www.bitradex.ai/en/user/disclaimer | 2026-09-24 | BitradeX | restricted areas, US, Canada, derivatives |
| S7 | Futures funding rates and details | https://www.bitradex.ai/en/futures/information/fund-rate | 2026-09-24 | BitradeX | funding page, renders client side |
| P1 | `rest-probe.mjs catalog` at 06:53 and 06:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | sections 2 to 4, 7 |
| P2 | `rest-probe.mjs funding`, two runs at 06:54 and 06:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | section 6 |
| P3 | `rest-probe.mjs archive`, Wayback captures of 2026-09-14 and 2026-09-16 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | web.archive.org | sections 2 and 4 |
