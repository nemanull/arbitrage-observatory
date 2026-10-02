# x.me Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 06:36 to 07:08 UTC, which is the evening of 2026-09-22 in Seattle, from the development host near Seattle through its Surfshark WireGuard tunnel, whose exit geolocates to Canada.

This profile covers the USDT-margined perpetuals of x.me Exchange, formerly VOOX Exchange, which is the only perpetual family the venue lists.
x.me publishes no API documentation that this research could find, so the fee and funding rules come from its Zendesk help centre and the live numbers come from its public endpoints, see [`rest.md`](./rest.md) section 1.
The help centre pages were read through Zendesk's public help centre API, `https://support.x.me/api/v2/help_center/en-us/articles/<id>.json`, which answered 200 from this host.
Web search was not available to this research, so a document that no crawl of the venue's own pages reaches may exist and was not found.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| names | x.me, alternate names "VOOX" and "VOOX Exchange" in the site's structured data, "x.me Exchange" with slug `voox-exchange` on CoinMarketCap | the `https://www.x.me/` page head, S14 |
| operator | "VOOX Limited", the company named in the User Agreement | S8 |
| jurisdiction | Not publicly specified in the User Agreement. CoinMarketCap lists country `SG`, and its description names operational centres in Malaysia and Dubai | S8, S14 |
| launched | 2023-04-30 on CoinMarketCap, "Founded in 2022" in its description | S14 |
| platform | a ChainUp build: the `fe-co-api` and `fe-ex-api` web paths, the `futuresopenapi` and `openapi` hosts with the `/fapi/v1` and `/sapi/v1` shape, and the `kline-api/ws` sockets | [`rest.md`](./rest.md) section 1 |
| regions refused | "Afghanistan, Mainland China, Cuba, Crimea, Iran, North Korea, South Sudan, Syria, Zimbabwe, Myanmar, Cambodia, United States." | S7, edited 2026-07-01 |
| regions refused, older list | the same eleven without the United States | S8, edited 2026-07-09 |
| US persons | may not trade, since S7 lists the United States as a Restricted Region, although the User Agreement's own list omits it | S7, S8 |
| KYC | not required to trade: "KYC does not affect deposits, withdrawals, or trading", and an unverified account may withdraw the equivalent of 10,000 USDT a day | S18 |
| access from this host | every public REST and WebSocket endpoint probed answered 200 or 101 through the Canadian VPN exit, with no refusal, no challenge and no geoblock. The website's `public_info_v4` reply carried `"limitCountryList": []` | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |
| size | CoinMarketCap's derivatives ranking read at 06:53 UTC on 2026-09-23 placed it at position 50, with `derivativesMarketPairs` 258, `derivativesOpenInterests` 455,369,360 USD and `derivativesVol24h` 10,648,752,952 USD. The survey brief read rank 49 from the same page the same day | S15 |

All access results in this profile are what the Canadian VPN exit received, not what an address in the United States would receive.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.040 %, 400 ppm | 0.060 %, 600 ppm | S1, "regular user" row of the Futures Trading Fee table, and CoinMarketCap's `makerFee` 0.04 and `takerFee` 0.06 in S14 |

VIP 0 is called "regular user" on x.me.
S3 says the VIP system "is currently being upgraded and optimized" and that "VIP upgrade tasks and related benefits are temporarily unavailable", so every account pays the regular rate today unless a tier was kept from before, which S3 does not say.
No public call found returns a fee rate.
S2 sends readers to `https://futures.x.me/en_US/myRate`, which redirected to `https://www.x.me/futures/my-rate`, a page of the website's single page app that shows the account's own rate.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 266 active of 343 listed | `GET https://futuresopenapi.x.me/fapi/v1/contracts`: 266 with `status` 1 and 77 with `status` 0, all `type` `E`, all quoted in USDT, P1 |
| equity, ETF, commodity and pre-IPO perpetuals inside USDT-M | yes, at least 41 | read by eye from the 266 base names: AAOI, AAPL, AMD, AMZN, AXTI, BZ, CBRS, CL, COPPER, CRCL, DELL, EWY, GOOGL, HOOD, HYUNDAI, INTC, KORU, META, MRVL, MSFT, MSTR, MU, NBIS, NVDA, OPENAI, PLTR, POPMART, QQQ, RKLB, SAMSUNG, SKHYNIX, SNDK, SOXL, SOXS, SPCX, SPY, TQQQ, TSLA, XAG, XAU and ZHIPU. DRAM, LITE, MVLL, RE and SNXX may be more. The website's sector list has no TradFi sector, P1 |
| USDC-M perpetuals | no | `marginCoinList` is `["USDT"]` in the website's futures `public_info`, P1 |
| coin-M perpetuals | no | no contract is quoted in a coin. One inactive contract, `E-PENGU-USDT`, carries `side` 0 where the other 342 carry 1, and its meaning is Not publicly specified, P1 |
| dated futures | no | `deliveryKind` `"0"` on all 266 active contracts, P1 |
| options | no | none in any catalog or web page read |
| spot | yes, named only | `GET https://openapi.x.me/sapi/v1/symbols` returned 200 symbols, P1 |

## 4. Perpetual tiers

The futures table of S1, edited 2026-07-01.
A tier is reached by 30 day futures volume or by asset balance, and "or" is the word S1 prints between the two columns.

| level | 30 day futures volume, USD | or asset, USD | maker | taker | taker ppm |
|---|---|---|---|---|---:|
| regular user | < 10,000,000 | < 50,000 | 0.040 % | 0.060 % | 600 |
| VIP1 | ≥ 10,000,000 | ≥ 50,000 | 0.038 % | 0.057 % | 570 |
| VIP2 | ≥ 30,000,000 | ≥ 80,000 | 0.036 % | 0.054 % | 540 |
| VIP3 | ≥ 50,000,000 | ≥ 100,000 | 0.034 % | 0.051 % | 510 |
| VIP4 | ≥ 80,000,000 | ≥ 500,000 | 0.032 % | 0.048 % | 480 |
| VIP5 | ≥ 100,000,000 | ≥ 1,000,000 | 0.030 % | 0.045 % | 450 |

### Qualification

- S1: "A user's tier determines the transaction fees they will incur on the next trading day."
- S1: a user who qualifies for different tiers on spot and on futures gets the higher tier on both.
- S2 repeats the VIP5 taker of 0.045 % and maker of 0.03 % in its worked example.
- S3 suspends VIP upgrades for now, see section 2.

The spot table of S1, for the coverage matrix only: regular user 0.100 % maker and 0.100 % taker, down to 0.050 % and 0.050 % at VIP5.

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | source |
|---|---|---|
| VIP tiers | suspended while the VIP system is upgraded | S3 |
| futures bonus | a bonus balance "can also be used to offset fees, trading losses, and funding fees", and it is spent before the user's own funds. It pays the fee rather than lowering the rate | S12 |
| points | S2 says "Points cannot be used to offset maker fees." Whether points offset a taker fee, and at what rate, is Not publicly specified | S2 |
| platform token | none found. The website's `public_info_v4` carries `"fee_coin_rate": "30.00"`, whose meaning is Not publicly specified | [`rest.md`](./rest.md) section 1 |
| referral commission | paid to the spot wallet at 15:30 UTC+8 the next day, the rate is per invitation and Not publicly specified | S4 |
| market maker programme | none found | |
| zero fee promotion | spot only, 2025-12-12 08:00 UTC to 2026-03-11 08:00 UTC, ended. "Fees for futures, copy trading, and other products remain unchanged." | S13 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays | at settlement a positive rate makes longs pay shorts, and a negative rate makes shorts pay longs. "The funding fee is completely settled between users, and the platform will not charge any fees for it." | S5, S4 |
| who is charged | only positions held at the settlement instant | S5 |
| amount | funding fee = position value × funding rate, with position value = size × contract size × mark price, added to or taken from the position margin | S5 |
| rate formula | `clamp(average premium index + clamp(composite rate − average premium index, premium deviation upper limit, premium deviation lower limit), funding rate upper limit, funding rate lower limit)` | S5 |
| composite rate | (quote rate 0.06 % − base rate 0.03 %) / 3 = 0.01 % per 8 h settlement | S5 |
| premium index | computed every minute from 8,000 USDT depth weighted bid and ask against a "reasonable price", and averaged over the last hour | S5 |
| interval | 8 h on 103 active contracts and 4 h on 163, from `capitalFrequency` | P1 |
| settlement instants | S5 says 00:00, 08:00 and 16:00 GMT+8, which is 16:00, 00:00 and 08:00 UTC. The settled history shows BTC at 00:00, 08:00 and 16:00 UTC and DOS every 4 h from 00:00 UTC, and all 266 contracts showed `nextCapitalSettTime` 2026-09-23 08:00 UTC at 06:49 UTC | P2 |
| cap and floor | not published as numbers in S5. Caps are set per contract by announcement, for example HYPER was set to +1.5 % and −1.5 % with hourly settlement on 2025-07-10 | S5, S6 |
| observed extremes | `E-KERNEL-USDT` settled at −1.288242 % per 4 h at 00:00 UTC on 2026-09-23, and the largest live rate was KERNEL's, −0.302743 % at 06:50 UTC and −0.291999 % at 07:06 UTC | P2, P3 |
| baseline on 4 h contracts | many quiet 4 h contracts settle at exactly 0.00005, which is 0.005 %, half the 8 h composite rate, for example SOPH on five settlements from 2026-09-21 12:00 to 2026-09-22 04:00 UTC | P2 |

The settlement instant itself was not captured.
Settlement behaviour here comes from the settled history call and S5, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | "No closing fee will be charged to the user." | S9 |
| liquidation trigger | margin rate computed from the mark price, and "liquidation is not triggered when the mark price simply reaches the liquidation price" | S9 |
| insurance fund | "Risk Insurance", funded by the surplus when the engine closes a liquidated position better than its bankruptcy price, "without charging additional fees to users" | S10 |
| delisting | trading and cancellation stop, pending orders are cancelled, the contract is settled automatically an hour later, then delisted. The settlement price basis is Not publicly specified | S11, the MUSDT notice of 2025-09-09 |

## 8. CCXT

CCXT 4.5.68 has no class for x.me or VOOX.
`node -e "console.log(require('ccxt').exchanges)"` run from `server/` printed 104 ids, and none matched `voox`, `xme`, `koo` or `chainup`, S16.
`server/node_modules/ccxt/js/src/` holds no such file either.
CCXT's current source at `github.com/ccxt/ccxt`, `ts/src` on `master` at commit `af2441ab5b` of 2026-09-23 05:39 UTC, holds 105 `.ts` files and none for x.me or VOOX, and an issue search for `voox`, `x.me` or `xme` in `ccxt/ccxt` returned 0 results, S16.
So there is no `market.taker` to report and no source line to cite.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the regular user USDT-M perpetual taker of 0.060 %, S1 |
| `ccxtTakerPpm` | none | no CCXT class exists, section 8 |

The registry cannot hold x.me as it stands, since the connector's catalog is CCXT's `loadMarkets` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68.
A catalog built from `GET /fapi/v1/contracts` would have to replace it, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading Fee Structure: Spot & Futures, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/10647636623631-Trading-Fee-Structure-Spot-Futures | 2026-09-22 | x.me, global | tiers, qualification, VIP 0 rates, sections 2 and 4 |
| S2 | Futures Trading Fee Rules, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/13558870386575-Futures-Trading-Fee-Rules | 2026-09-22 | x.me, global | fee formula, points, the `myRate` page, sections 2, 4 and 5 |
| S3 | VIP Rules and Fees, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/16252744952335-VIP-Rules-and-Fees | 2026-09-22 | x.me, global | VIP system suspended, sections 2 and 5 |
| S4 | Platform Fee System, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/16252716225935-Platform-Fee-System | 2026-09-22 | x.me, global | funding paid between users, commission timing, sections 5 and 6 |
| S5 | Funding Rate, edited 2024-08-29 | https://support.x.me/hc/en-us/articles/10565408952079-Funding-Rate | 2026-09-22 | x.me, global | funding formula, schedule, who pays, section 6 |
| S6 | x.me Will Adjust the Funding Rate and Settlement Frequency for HYPER U-Margined Perpetual Futures, 2025-07-10 | https://support.x.me/hc/en-us/articles/13211618039311 | 2026-09-22 | x.me, global | a per contract cap of ±1.5 %, section 6 |
| S7 | Account Function Region Restrictions, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/13575859273871-Account-Function-Region-Restrictions | 2026-09-22 | x.me, global | Restricted Regions including the United States, section 1 |
| S8 | User Agreement, edited 2026-07-09 | https://support.x.me/hc/en-us/articles/10649320208143-User-Agreement | 2026-09-22 | VOOX Limited | operator, the older region list, section 1 |
| S9 | Forced Liquidation Explanation, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/13817603282575-Forced-Liquidation-Explanation | 2026-09-22 | x.me, global | no liquidation fee, section 7 |
| S10 | Risk Insurance, edited 2025-12-24 | https://support.x.me/hc/en-us/articles/14707112338575-Risk-Insurance | 2026-09-22 | x.me, global | insurance fund, section 7 |
| S11 | x.me to Delist MUSDT Futures Trading Pair, 2025-09-09 | https://support.x.me/hc/en-us/articles/13721727771535 | 2026-09-22 | x.me, global | delisting sequence, section 7 |
| S12 | About x.me Futures Bonus, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/11126243537807 | 2026-09-22 | x.me, global | bonus offsets fees, section 5 |
| S13 | Welcome to the Zero-Fee Era: Trade Spot with 0 Fees!, edited 2026-07-03 | https://support.x.me/hc/en-us/articles/14598755572367 | 2026-09-22 | x.me, global | the ended spot campaign, section 5 |
| S14 | CoinMarketCap, x.me Exchange | https://coinmarketcap.com/exchanges/voox-exchange/ | 2026-09-23 06:52 UTC | CoinMarketCap | names, country, launch date, maker 0.04 and taker 0.06, section 1 |
| S15 | CoinMarketCap derivatives exchange ranking | https://coinmarketcap.com/rankings/exchanges/derivatives/ | 2026-09-23 06:53 UTC | CoinMarketCap | position 50, 258 pairs, open interest and volume, section 1 |
| S16 | CCXT 4.5.68 `exchanges` list, and CCXT `ts/src` on `master` with an issue search | `server/node_modules/ccxt`, https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master and https://api.github.com/search/issues?q=repo:ccxt/ccxt+voox+OR+x.me+OR+xme | 2026-09-23 06:36 UTC | CCXT | no class, section 8 |
| S17 | Zendesk help centre search API | https://support.x.me/api/v2/help_center/articles/search.json?query=API | 2026-09-23 06:36 UTC | x.me | eight results for "API", none of them API documentation |
| S18 | KYC Identity Verification and Compliance, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/16252598949007 | 2026-09-22 | x.me, global | KYC not needed to trade, withdrawal limit, section 1 |
| P1 | `rest-probe.mjs catalog` at 06:49 UTC and its rerun at 07:05 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | counts, intervals, families, sections 3 and 6 |
| P2 | `rest-probe.mjs anchor` at 06:49 UTC and its rerun at 07:05 UTC, and one `curl` each of `funding_rate_list` for KERNEL and SOPH at 06:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | settled history, section 6 |
| P3 | `rest-probe.mjs round` at 06:50 UTC and its rerun at 07:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | the largest live rates, section 6 |
