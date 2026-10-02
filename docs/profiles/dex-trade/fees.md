# Dex-Trade Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:29 to 03:48 UTC, from the development host near Seattle.

This profile covers spot trading on Dex-Trade, because Dex-Trade lists no perpetual, see section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees and spot tiers stand where the perpetual numbers would.
Every number carries a source ledger row, a probe reference, or a CCXT source reference.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs).
The fee page at `https://dex-trade.com/fees` is a client-side page, so its numbers were read from the two JSON calls it renders, S5 and S6, and its labels from its page code, S7.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "Dex-Trade.com (CoreLead Technologies Ltd (Seychelles)" | S2 |
| established | 2017, Seychelles | S8 |
| product researched | spot, 46 pairs in `GET /v1/public/symbols` | P1 |
| who may trade | registered users outside the excluded list below, and verification is optional: "You can deposit, trade, and withdraw without passing verification (KYC). The only limit is that you can't withdraw more than 5 BTC per 24h without passing a verification (KYC)" | S3 |
| excluded regions | "Dex-Trade does not technically serve the following countries: the Russian Federation and Crimea, the United States of America, Cuba, Iran, Iraq, North Korea, Syria, Algeria, Pakistan, Sudan, UK, Canada, Singapore, Japan, Belarus, Kazakhstan, as well as countries that are members of the European Union" | S2, S3 |
| US persons | excluded by the terms, S2 | |
| what this host saw | every public REST call answered 200 or its documented error and every socket upgraded with 101, through Cloudflare, with no geoblock, see [`rest.md`](./rest.md) section 1 | P1, P2 |

Serving this host is not permission to trade from it.
The terms exclude the United States, so the engine could read Dex-Trade books from here but a US operator could not trade them.

## 2. Quick answer

Dex-Trade prices a trade by its order type, not by the maker or taker role.

| order type, VIP 0 | percent | ppm | source |
|---|---:|---:|---|
| limit | 0.1 % | 1,000 | S5 `limit_commission`, S6 `limit_percent` on 46 of 46 pairs |
| market | 0.2 % | 2,000 | S5 `market_commission`, S6 `market_percent` on 46 of 46 pairs |
| quick market | 0.4 % | 4,000 | S6 `quick_market_percent` on 46 of 46 pairs |
| hidden limit, surcharge | 0 % | 0 | S6 `commission_percent_limit_hidden` `"0.00000000"` on 46 of 46 pairs |

The site ticker `GET /api/default/ticker` repeats the same pair on 48 of 48 rows: `commission_percent` 0.1 and `commission_percent_market` `"0.2"`, P1.
A market order always takes liquidity, so 2,000 ppm is the taker cost this profile records.
Whether a limit order that crosses the book pays the limit rate of 1,000 ppm is Not verified, because it needs an account.
The order types are those of the private create order call, `type_trade` "Limit/Market/Stop Limit/Quick Market/Hidden limit (0/1/2/3/4)", S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes, 46 pairs: 38 quoted in USDT, 2 in USDC, 2 in ETH, 1 each in BTC, SOL, BNB and AUSDT | P1 `catalog` |
| USDT-M, USDC-M or coin-M perpetuals | absent | no futures route in the API docs S1, the words "perpetual" and "funding" occur 0 times in the 46 page scripts the home page loads, S11, and CoinGecko's derivatives list does not carry Dex-Trade, S8 |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| margin | built but switched off | the margin terms describe borrowing with interest, S4, but `GET /api/default/ticker-margin` returned `"data":[]`, `GET /api/default/margin-settings` returned `"state":-1`, and the config's `margin_pair_list` was empty, P1 |

The catalog holds no major base.
BTC, ETH, SOL, XRP, BNB and DOGE are absent as bases, and `GET /v1/public/ticker?pair=BTCUSDT` answers 400 `Incorrect pair`, P1.
Of the 44 bases, only `VRT` also names a Bybit linear perpetual among 845 trading on 2026-09-23, P5 and P6, and whether the two are the same token is Not verified.

## 4. Spot tiers

The tier table is the VIP table the fee page loads for a visitor who is not logged in, S5, with the column labels of the page code, S7.

| level | monthly turnover, BTC | condition | DXU balance | limit | market | limit ppm | market ppm | `total_discount_percent` |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| VIP 0 | 0 | or | 0 | 0.10 % | 0.20 % | 1,000 | 2,000 | 0 |
| VIP 1 | ≥ 0.1 | or | ≥ 10 | 0.09 % | 0.18 % | 900 | 1,800 | 0 |
| VIP 2 | ≥ 1 | or | ≥ 100 | 0.08 % | 0.16 % | 800 | 1,600 | 0 |
| VIP 3 | ≥ 10 | or | ≥ 1,000 | 0.07 % | 0.14 % | 700 | 1,400 | 0 |
| VIP 4 | ≥ 30 | or | ≥ 5,000 | 0.06 % | 0.12 % | 600 | 1,200 | 10 |

### Qualification

A level is reached by the turnover or by the balance, since every row has `condition_symbol` `"or"`, S5.
The page code labels the first column "Trade Turnover BTC" and the second "DXU Balance", where DXU is the config's `default_currency`, S6 and S7.
The progress bar divides the user's `month_trade_volume` by the next level's `trade_volume`, so the window is a month, S7.
Whether the month is calendar or rolling is Not publicly specified.
How `total_discount_percent` 10 on VIP 4 changes the charged rate is Not verified, because the page shows it only beside an `actual_limit_commission` that the logged-out reply does not carry.

## 5. Discounts that change the taker

| discount | effect | source |
|---|---|---|
| DXU fee deduction | "When you pay spot trading fees for DXU token, you can save up to 10%", with `percent_commission_project_coin` 10 on every level | S5, S7 |
| per pair special rates | `special` is `[]` on 46 of 46 pairs | S6 |
| zero fee promotions | none found in the config or the fee page code | S6, S7 |
| market maker programme | none published | |

## 6. Funding as a cost

Nothing applies.
Dex-Trade lists no perpetual, so no funding rate, interval, cap or settlement exists, section 3.
Margin interest is named in the margin terms, S4, but no rate is published while margin is switched off.

## 7. Liquidation, settlement and delisting

Spot carries no liquidation or settlement charge.
The config marks each of 219 currencies with a `delisting` flag, and it was 0 on all 219 on 2026-09-23, P6.
Two pairs in the site ticker, `GTCUSDT` and `US7USDT`, have `status` 3 and are missing from `GET /v1/public/symbols`, P1, and the meaning of status 3 is Not publicly specified.
Deposit and withdrawal fees are listed per currency on the Deposit and Withdraw tab of `https://dex-trade.com/fees`, S7, and the config's `commission` object carries per currency `fixed`, `percent` and `min_withdraw` fields, S6.

## 8. CCXT

CCXT 4.5.68 has no Dex-Trade class.
`require('ccxt').exchanges` from `server/` lists 104 ids, none named `dextrade` or `dex-trade`, and the only ids matching "dex" or "trade" are `bittrade`, `modetrade` and `paradex`, P1 `ccxt`.
No file under `server/node_modules/ccxt/js/src/` matches either.
The current CCXT master has none either: `ts/src` at commit `fbc5f21`, committed 2026-09-22 10:33 UTC, has no `dextrade.ts`, `dex-trade.ts` or `dex_trade.ts`, and those three raw URLs answered 404, S10.
The request to add the venue, CCXT issue 8625 "New Exchange: dex-trade.com", has been open since 2021-03-14, S9.
So `market.taker` cannot be read, and there is no source line to cite.

## 9. Recommended registry values

None.
The connector builds a venue from CCXT `loadMarkets` filtered to active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 68, 79 and 196 to 202, and Dex-Trade has neither a CCXT class nor a swap.
If a spot stage ever adds it, `takerPpm` would be 2,000, the VIP 0 market order, and `ccxtTakerPpm` would stay unset because no CCXT constant exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Dex-Trade API, apidoc 1.1.7, generated 2025-10-06 07:55 UTC | https://docs.dex-trade.com/ | 2026-09-22 | Dex-Trade, global | order types, sections 2 and 3 |
| S2 | Terms and conditions of Dex-Trade, read through `POST https://api.dex-trade.com/api/page` with `{"url":"terms-of-use"}`, the call the page makes | https://dex-trade.com/info/terms-of-use | 2026-09-22 | CoreLead Technologies Ltd, Seychelles | operator, excluded countries, section 1 |
| S3 | Anti-Money Laundering (AML) Policy, read the same way with `{"url":"aml-kyc-policy"}` | https://dex-trade.com/info/aml-kyc-policy | 2026-09-22 | same | optional KYC, 5 BTC limit, excluded countries, section 1 |
| S4 | Margin terms of use, read the same way with `{"url":"margin-terms-of-use"}` | https://dex-trade.com/info/margin-terms-of-use | 2026-09-22 | same | margin is borrowing with interest, sections 3 and 6 |
| S5 | VIP levels, `POST https://api.dex-trade.com/api/vip/info`, the call the fee page makes for a visitor who is not logged in | https://dex-trade.com/fees#vip | 2026-09-22 | same | VIP table, sections 2, 4 and 5 |
| S6 | Site config, `GET https://api.dex-trade.com/api/default/config`, fields `trade_commission`, `default_currency`, `margin_pair_list`, `commission` | https://api.dex-trade.com/api/default/config | 2026-09-22 | same | per pair rates, sections 2 to 7 |
| S7 | Fee page code, chunks `3840091.modern.js` and `8f2c175.modern.js` | https://dex-trade.com/_nuxt/5.4.7/3840091.modern.js | 2026-09-22 | same | column labels, DXU deduction text, monthly turnover, the Deposit and Withdraw tab, sections 4, 5 and 7 |
| S8 | CoinGecko, Dex-Trade | https://www.coingecko.com/en/exchanges/dextrade | 2026-09-22 | CoinGecko | established 2017, Seychelles, no derivatives, section 3 |
| S9 | CCXT issue 8625, New Exchange: dex-trade.com | https://github.com/ccxt/ccxt/issues/8625 | 2026-09-22 | CCXT | no class requested and not built, section 8 |
| S10 | CCXT master `ts/src`, commit `fbc5f21` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Dex-Trade source file, section 8 |
| S11 | Dex-Trade web app, the 46 distinct `/_nuxt/5.4.7/*.modern.js` scripts named by the home page, searched for "perpetual", "funding" and "futures" | https://dex-trade.com/ | 2026-09-22 | Dex-Trade | no perpetual product in the app, section 3 |
| P1 | `rest-probe.mjs all`, 03:29 to 03:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog, rates, VIP table, margin state, CCXT check |
| P5 | `rest-probe.mjs all`, second pass, 03:41 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | the same rates, VIP table, margin state and CCXT check as P1 |
| P6 | `rest-probe.mjs main`, 03:46 to 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | the same again, and the `delisting` flags, section 7 |
| P2 | `ws-probe.mjs book`, 03:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs) | 2026-09-23 UTC | this host | the socket served this host, section 1 |
