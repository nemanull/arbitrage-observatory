# BTCC Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, which was 2026-09-23 04:23 to 04:57 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=SEA`).

This profile covers the perpetual futures of BTCC (www.btcc.com), which has no CCXT class, for every perpetual family the venue lists.
BTCC publishes no fee API.
The fee numbers below come from the JSON call that renders the public fee page, read by [`rest-probe.mjs`](../../../scripts/probes/venues/btcc/rest-probe.mjs), and from the help centre, whose articles were read through the public Zendesk API at `https://btccexchange.zendesk.com/api/v2/help_center/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22, Pacific time | this profile |
| operator named in the terms | BTCC Limited, "a private limited company incorporated in Hong Kong (CR No: 1956541)" | S8, `mtime` 2026-09-22 13:17 |
| country in CoinGecko | Lithuania, established 2011, trust score 3, trust rank 153 on 2026-09-23 UTC | S10 |
| who may trade | an individual of 18 or more, or an organisation, who is not sanctioned, not "residing in a sanctioned jurisdiction", and "not prohibited from using our Services by any Applicable Laws" | S8 clause 2.1 |
| excluded regions | no list is published in the terms, and the help centre search API found no list under "restricted", "United States" or "jurisdiction" on 2026-09-22 | S8, S12 |
| US persons | Not publicly specified. The requester of CCXT issue 22623 wrote in 2024 that BTCC "is one of few that is allowing for leveraged spot trading and futures trading in the United States", which is a user claim, not a venue statement | S9 |
| what this host got | every call the probe made to `www.btcc.com` answered HTTP 200, and the web IP limit call `POST /v2/common/getIpLimitConfig` returned `countryCode: null`, `authCodes: null`, `status: null` for the Canadian exit | P1 |
| CoinGecko derivatives | `btcc_futures` is in `/derivatives/exchanges/list`, and `/derivatives/exchanges/btcc_futures` returned 404 `{"error":"market not found"}` on 2026-09-23 UTC | S10 |

Access results are from the Canadian VPN exit, not from a United States address.

## 2. Quick answer

One futures column covers every perpetual family on the fee page, S1 and S2.

| product | VIP 0 maker | VIP 0 taker | maker ppm | taker ppm | source |
|---|---:|---:|---:|---:|---|
| USDT-M, USDC-M and coin-M perpetuals | 0.030 % | 0.048 % | 300 | 480 | S1, P1 |
| spot, every VIP level | 0.2 % | 0.3 % | 2,000 | 3,000 | S2, the page prints the literal `0.3% / 0.2%` in the spot column of every row |
| TradFi contracts | 0 | 0 | 0 | 0 | the site menu says "Zero Fees on TradFi" and links a campaign page, whose end date was not read |

VIP 1 needs only 200 USDT of account value and brings the taker to 0.045 %, so the VIP 0 number applies to a fresh account that has not deposited, S1.

## 3. Coverage matrix

Counts are from the web quote socket's product dictionary on 2026-09-23 UTC, because the OpenAPI product list needs a login token, see [`rest.md`](./rest.md) section 2.

| product | present | count | note |
|---|---|---:|---|
| USDT-M perpetuals | yes | 346 | named `BTC/USDT.100x`, 35 to 41 of them carry a trading schedule and 4 trade less than a full day, `TECH100USDT`, `SPX500USDT`, `DJ30USDT` and `USOILUSDT` |
| USDC-M perpetuals | yes | 11 | `BTC/USDC.500x` and ten more |
| coin-M perpetuals | yes | 6 | `BTC/USD.100x`, `ETH/USD.100x`, `XRP/USD.100x`, `LTC/USD.50x`, `ADA/USD.50x`, `SOL/USD.50x` |
| TradFi contracts margined in USDX | yes | 21 | metals, forex, indices and stocks, such as `XAUUSD/USDX.500x` |
| dated futures | absent from the dictionary | 0 | the site has a `/markets/futures-quarterly` route and the trade page names daily, weekly and quarterly pages, but every dictionary entry has `TimeType` 1 |
| options | absent | 0 | |
| spot | yes | 100 tickers in CoinGecko's first page | S10, not researched further |

## 4. Perpetual tiers

The futures taker and maker below apply to every futures family, S1.
The page says "VIP levels and fee rates are updated and effective from 17:00 (UTC) every day", S2.

| level | account value, USDT | or 30 day futures volume, USDT | or 30 day spot volume, USDT | taker | maker | taker ppm | maker ppm |
|---|---:|---:|---:|---:|---:|---:|---:|
| VIP 0 | 0 | 0 | 0 | 0.048 % | 0.030 % | 480 | 300 |
| VIP 1 | 200 | | | 0.045 % | 0.025 % | 450 | 250 |
| VIP 2 | 10,000 | 5,000,000 | 500,000 | 0.040 % | 0.022 % | 400 | 220 |
| VIP 3 | 50,000 | 30,000,000 | 3,000,000 | 0.035 % | 0.020 % | 350 | 200 |
| VIP 4 | 200,000 | 100,000,000 | 10,000,000 | 0.030 % | 0.018 % | 300 | 180 |
| VIP 5 | 1,000,000 | 300,000,000 | 25,000,000 | 0.025 % | 0.015 % | 250 | 150 |
| VIP 6 | 2,000,000 | 500,000,000 | 40,000,000 | 0.020 % | 0.012 % | 200 | 120 |
| VIP 7 | 3,000,000 | 1,000,000,000 | 60,000,000 | 0.015 % | 0.010 % | 150 | 100 |
| PVIP | 5,000,000 | 2,000,000,000 | 80,000,000 | 0.045 % | 0.025 % | 450 | 250 |

### Qualification

The page heads the three threshold columns "Account's estimated total value (USDT)", "OR Last 30 days Futures Trading Volume (USDT)" and "OR Last 30 days Spot Trading Volume (USDT)", so any one of them qualifies, S2.
VIP 1 has 0 in both volume columns, so it is reached by account value alone.
The PVIP row carries the VIP 1 fees with the highest thresholds, and what it is for is Not publicly specified.
Every row carries `originalTakerFee` 0.048 and `originalMakerFee` 0.03, S1.
The help centre adds that "all fees are calculated to two decimal places" of the settlement unit, S3.

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | source |
|---|---|---|
| VIP level | the table in section 4 | S1 |
| coupons, trading funds and trading vouchers | the fee page has a "Fee coverage rate with coupons" column, and the help centre has guides for vouchers, which pay fees from a voucher rather than lower the rate | S2, help centre section "Coupons, Trading Funds & Vouchers" |
| token holding | none found | |
| referral | the help centre describes referral commissions paid to the referrer, not a lower rate for the trader | help centre article 48697412640921 |
| market maker programme | Not publicly specified | |
| zero fee promotion | TradFi contracts only, "Zero Fees on TradFi", end date not read | site menu |

## 6. Funding as a cost

From S4, updated 2026-08-13.

| item | value |
|---|---|
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative, and "BTCC does not take any funding fees" |
| interval | 8 h, "at 00:00, 08:00, 16:00 (UTC)" |
| charged on | "As long as you have open positions at these three specific times", and a position opened or closed at 08:00:05 may still be charged |
| USDT-M amount | position value × funding rate, where position value is "Counterparty Best Price × Position Quantity" |
| coin-M amount | position quantity × funding rate, as printed in S4 |
| formula | `Funding rate = {average premium index (P) + Clamp[interest rate (I) − average premium index (P), a, b}`, with I = 0.01 % |
| premium index | `[Max(0, Impact bid price − price index) − Max(0, benchmark price − Impact ask price)] / benchmark price`, computed every minute |
| impact size | 200 USDT of margin divided by the minimum maintenance margin rate, 40,000 USDT on BTCUSDT at 0.5 % |
| cap and floor | the clamp bounds a and b are not given, and BTCC "reserves the right to modify the maximum and minimum limits of the funding rate" and to settle more than three times a day |
| rounding | fees rounded to two decimal places |

The public funding history showed every BTCUSDT settlement from 2026-09-16 00:00 to 2026-09-23 00:00 UTC at 00:00, 08:00 or 16:00 UTC, three of them stamped 16:01, with rates from −0.0419 % to +0.0426 %, P1.
The settlement instant itself was not captured.
Each settled rate and the current rate call are in [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | 1 % of liquidation price × quantity for BTCUSDT, BTCUSD, ETHUSDT, ETHUSD, XRPUSDT, XRPUSD, SOLUSDT, SOLUSD and DOGEUSDT, and 1.2 % for every other product, paid to the insurance fund | S5 |
| liquidation trigger | "Forced-liquidation margin = Used margin × 40%", monitored against the platform's two-way quote, the best bid for a long and the best ask for a short, not a mark price | S6 |
| rollover fee | tokenized stocks, commodities and forex only, "Opening price × Number of lots × Rollover fee rate × Days held", charged daily at 16:00 UTC, "Cryptocurrency futures trading does not charge rollover fees" | S7 |
| delisting | the token delisting criteria list the reasons, and no delisting charge is named | S11 |
| deposit, withdrawal and card fees | out of scope, see the help centre article "About Withdrawal Limits and Fees", 48642019645209 | |

## 8. CCXT

CCXT 4.5.68 in `server/node_modules` has no BTCC class: `ccxt.exchanges` lists 104 ids and none matches `btcc`, P1.
The CCXT master branch at commit `1d8b674434fde39ef282988b066812adf8d19b9e`, 2026-09-22 12:48 UTC, has no `ts/src/btcc.ts` among the 105 `.ts` files in `ts/src`, S13, and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/btcc.ts` returned 404.
Issue 22623 "New Exchange Request: BTCC", opened 2024-05-26, was still open, S9.
So there is no `market.taker` to report.

## 9. Recommended registry values

None.
BTCC has no CCXT class, so there is no `ccxtTakerPpm` to declare, and the venue cannot be registered in its current shape, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.
If it were ever added through a custom catalog, `takerPpm` would be 480 from S1.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | VIP table behind the fee page | `https://www.btcc.com/v2/common/getVipLevelConditionList` | 2026-09-22 | BTCC, global | sections 2 and 4 |
| S2 | Fees and VIP page, and its page bundle | https://www.btcc.com/en-US/fees and `https://www.btcc.com/_next/static/chunks/pages/fees-ea0f9a5c75a8cd13.js` | 2026-09-22 | BTCC, global | spot literal, qualification columns, 17:00 UTC update, coupon column, sections 2, 4 and 5 |
| S3 | VIP Benefits & Trading Fees, updated 2026-08-27 | https://btccexchange.zendesk.com/hc/en-gb/articles/13995545240729-VIP-Benefits-Trading-Fees | 2026-09-22 | BTCC, global | rounding, section 4 |
| S4 | BTCC Funding Fees Explained and Calculation Method, updated 2026-08-25 | https://btccexchange.zendesk.com/hc/en-gb/articles/22348642432025-BTCC-Funding-Fees-Explained-and-Calculation-Method | 2026-09-22 | BTCC, global | section 6 |
| S5 | BTCC Forced Liquidation Fee Rules, updated 2026-08-13 | https://btccexchange.zendesk.com/hc/en-gb/articles/25537056593817-BTCC-Forced-Liquidation-Fee-Rules | 2026-09-22 | BTCC, global | section 7 |
| S6 | BTCC Futures Forced Liquidation Rules, updated 2026-08-13 | https://btccexchange.zendesk.com/hc/en-gb/articles/50605528595225-BTCC-Futures-Forced-Liquidation-Rules | 2026-09-22 | BTCC, global | section 7 |
| S7 | Explanation and Calculation Method of Rollover Fees for Futures, updated 2026-03-23 | https://btccexchange.zendesk.com/hc/en-gb/articles/50574140919193-Explanation-and-Calculation-Method-of-Rollover-Fees-for-Futures | 2026-09-22 | BTCC, global | section 7 |
| S8 | BTCC Terms of Use | https://www.btcc.com/en-US/terms | 2026-09-22 | BTCC Limited, Hong Kong | section 1 |
| S9 | CCXT issue 22623, New Exchange Request: BTCC | https://github.com/ccxt/ccxt/issues/22623 | 2026-09-22 | CCXT | sections 1 and 8 |
| S10 | CoinGecko API, `/exchanges/btcc`, `/derivatives/exchanges/list` and `/derivatives/exchanges/btcc_futures` | https://api.coingecko.com/api/v3/exchanges/btcc | 2026-09-23 UTC | CoinGecko | sections 1 and 3 |
| S11 | BTCC Token Delisting Criteria, updated 2026-07-08 | https://btccexchange.zendesk.com/hc/en-gb/articles/54268350635417-BTCC-Token-Delisting-Criteria | 2026-09-22 | BTCC, global | section 7 |
| S12 | help centre article search | `https://btccexchange.zendesk.com/api/v2/help_center/articles/search.json?locale=en-gb&query=restricted` | 2026-09-22 | BTCC, global | section 1 |
| S13 | GitHub contents API, `ccxt/ccxt` `ts/src` on master | `https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master` | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs`, runs at 04:30, 04:38, 04:44, 04:48 and 04:53 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/btcc/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | sections 1, 2, 4, 6 and 8 |
| P2 | `ws-probe.mjs web`, runs at 04:34, 04:42, 04:50 and 04:55 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/btcc/ws-probe.mjs) | 2026-09-22 | this host, Canadian exit | section 3 |
