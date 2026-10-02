# FameEX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:14 to 04:52 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the fees of FameEX on its one perpetual family, USDT-M linear perpetuals.
The fee page renders its table in the browser, so the numbers were read from the call that page makes, `GET https://www.fameex.com/fe-ex-api/vip/web/fee-table`, which answers without a login, S3.
A help centre article states the same VIP 0 futures rates, S6.
FameEX has no CCXT class, see section 8.

## 1. Scope and freshness

| item | fact | source |
|---|---|---|
| retrieved | 2026-09-22 local time, between 04:14 and 04:17 UTC on 2026-09-23 for the fee table | S3 |
| operator | FAMEEX INTERNATIONAL PTY LTD, "a company registered in Australia since 2020" | S5, dated 2026-07-24 |
| registration | "registered as a Digital Currency Exchange (DCE) service provider with AUSTRAC (Australia)" | S5 |
| entity in the Terms | none named, the Terms say "this website" and "FameEX" | S4 |
| who may trade the perpetuals | users 18 or older outside the restricted areas | S4 |
| restricted areas | the United States, Canada, Hong Kong (derivative services to retail users), Cuba, Iran, North Korea, Syria, Crimea, Bangladesh, Bolivia, the United Kingdom (retail users), Malaysia, Singapore, Bahamas, Netherlands, Donetsk, Lugansk and Malta | S4 |
| US persons | may not trade, since the United States is a restricted area | S4 |
| this host | every public REST and WebSocket endpoint answered from the Canadian VPN exit, with no refusal, no 403 and no geoblock page | P1 to P6 and W1 to W6 |

The access results above are from a Surfshark WireGuard exit that geolocates to Canada, not from a US address.
Canada is itself a restricted area in the Terms, so the open public endpoints say nothing about whether an account could be opened from here.
CoinGecko lists FameEX as established in 2020 in Australia, with a 24 h volume of 18,347 BTC on its spot market, S10.
Its API gave a trust score rank of 162 on 2026-09-22, while the survey's list had 154.
CoinGecko's derivatives list carries the id `fameex_futures`, but its detail call answered 404 `market not found`, S10.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.020 %, 200 ppm | 0.060 %, 600 ppm | S3 `contractMakerFee` 0.00020000 and `contractTakerFee` 0.00060000, and S6 "Maker 0.020% / Taker 0.060% on futures" |
| spot, for comparison | 0.100 %, 1,000 ppm | 0.100 %, 1,000 ppm | S3 `spotMakerFee` 0.00100000 and `spotTakerFee` 0.00100000 |

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 213 active of 246 listed | `type` E and `side` 1 on every row of `/fapi/v1/contracts`, see [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | absent | every contract is quoted in USDT |
| coin-M inverse perpetuals | absent | `side` 0, inverse, appears on no row |
| dated futures | absent | `type` is E on every row and `deliveryKind` is 0 on all 213 rows of `contract_config` |
| options | absent | none in the API, and the site menu lists Futures, TradFi, On-Chain Trading and a prediction market, but no options |
| spot | present, 95 symbols on the OpenAPI, all quoted in USDT | `/sapi/v1/symbols`, P1. CoinGecko tracks 72 spot tickers, S10. Named only |

The equity, commodity and index contracts, such as `E-AAPL-USDT` and `E-XAU-USDT`, sit in the same USDT-M list and carry no flag, see [`rest.md`](./rest.md) section 2.

## 4. Perpetual tiers

From S3, as the fee table call returned it.

| level | 30 day spot volume, USDT | 30 day futures volume, USDT | 30 day average assets, USDT | futures maker | futures taker | futures taker ppm |
|---|---:|---:|---:|---:|---:|---:|
| VIP0 | 0 | 0 | 0 | 0.020 % | 0.060 % | 600 |
| VIP1 | 30,000 | 1,000,000 | 10,000 | 0.019 % | 0.058 % | 580 |
| VIP2 | 100,000 | 5,000,000 | 30,000 | 0.018 % | 0.055 % | 550 |
| VIP3 | 500,000 | 10,000,000 | 50,000 | 0.017 % | 0.052 % | 520 |
| VIP4 | 1,000,000 | 30,000,000 | 100,000 | 0.016 % | 0.050 % | 500 |
| VIP5 | 3,000,000 | 50,000,000 | 200,000 | 0.015 % | 0.048 % | 480 |
| VIP6 | 5,000,000 | 100,000,000 | 300,000 | 0.014 % | 0.045 % | 450 |
| VIP7 | 10,000,000 | 250,000,000 | 500,000 | 0.012 % | 0.040 % | 400 |
| VIP8 | 20,000,000 | 500,000,000 | 1,000,000 | 0.010 % | 0.032 % | 320 |
| VIP9 | 50,000,000 | 1,000,000,000 | 2,000,000 | 0.006 % | 0.025 % | 250 |
| VIP10 | 100,000,000 | 2,000,000,000 | 3,000,000 | 0.005 % | 0.015 % | 150 |
| VIP11 | 200,000,000 | 3,000,000,000 | 5,000,000 | 0.003 % | 0.010 % | 100 |
| VIP12 | 500,000,000 | 5,000,000,000 | 10,000,000 | 0.000 % | 0.003 % | 30 |

The same call gives the spot maker and taker per level, from 0.100 % and 0.100 % at VIP0 to 0.000 % and 0.010 % at VIP12.

### Qualification

The fee page says "VIP levels are automatically calculated based on 30-day Spot/Futures volume or average assets. Meet any single requirement to upgrade.", and that the level "is automatically calculated and updated at 00:00 (UTC+8). Upgrades take effect immediately.", S3.
The VIP guide adds a 7 calendar day retention of the current level for VIP1 and above, and a "Cross-Exchange VIP+1" level granted on proof of a VIP level elsewhere, valid for 30 days, S8.
The fee page's own example disagrees with its table.
It says a 30 day spot volume of 1,000,000 USDT, a futures volume of 10,000,000 USDT, or average assets of 50,000 USDT reach VIP 2, S3.
The table puts VIP2 at 100,000, 5,000,000 and 30,000, and those three example figures are the VIP4, VIP3 and VIP3 thresholds.
The table is what the page renders, so this profile takes the table.

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | source |
|---|---|---|
| platform token holding | none found. No token discount is named on the fee page, in the VIP guide or in the futures overview | S3, S6, S8 |
| Cross-Exchange VIP+1 | a temporary VIP level for 30 days, so a lower tier rate, on review of another platform's VIP proof | S8 |
| Futures Deduction Credit | none on the fee. The coupon offsets realized losses at a stated rate and "cannot be used as margin" | S9, dated 2026-08-20 |
| referral | the site links an affiliate programme and an invite page. Their rebate terms were not read | site menu |
| market maker programme | Not publicly specified | |
| zero fee promotions | none found on the fee page on 2026-09-22 | S3 |

The engine models a taker at VIP0, so none of these moves the number that matters.

## 6. Funding as a cost

| item | fact | source |
|---|---|---|
| formula | Not publicly specified | S1, S7 |
| interval | 4 h on 124 active contracts, 8 h on 87, 2 h on `E-FLOKI-USDT` and 1 h on `E-G-USDT`, from `capitalFrequency` | [`rest.md`](./rest.md) section 4, P6 |
| settlement instants | every multiple of the interval from 00:00 UTC, on 213 of 213 contracts | [`rest.md`](./rest.md) section 4, P3 |
| older published schedule | every 8 hours at 00:00, 08:00 and 16:00 UTC+8, in an article dated 2023-07-22 | S7 |
| cap and floor | Not publicly specified. `capitalPremiumMin` and `capitalPremiumMax` are ±0.0005 on every contract, yet `E-KERNEL-USDT` settled at −0.01285754 on 2026-09-23 00:00 UTC, so they are not a rate cap | [`rest.md`](./rest.md) section 4, C4 |
| rates seen | `nextFundRate` from −0.00427332 to 0.00098702 across 213 contracts at 04:33 UTC, and from −0.00392366 to 0.00091316 at 04:43 UTC, median 0.00005 both times | [`rest.md`](./rest.md) section 4, P3 |
| who pays whom | Not publicly specified | |
| trading during settlement | "During the settlement period, the trading will be suspended, and the range of the interrupted transaction depends on the settlement time of the system." | S7 |

The settlement instant itself was not captured, so the charge, its timing within the hour and any suspension were not observed.
A rate beyond 1 % per 4 h settled on `E-KERNEL-USDT` twice in one day, C4, so funding can outweigh the taker fee many times over on such a contract.

## 7. Liquidation, settlement and delisting

| item | fact | source |
|---|---|---|
| liquidation trigger | "When the risk rate reaches 100%, it will trigger forced deleveraging or liquidation." | S7 |
| liquidation fee | Not publicly specified | |
| insurance fund | Not publicly specified | |
| delisting | 33 contracts sit in the list with `status` 0, "Not tradable", among them `E-PEPE-USDT`, `E-SHIB-USDT`, `E-MKR-USDT` and `E-TON-USDT`. The REST book of the closed `E-HIFI-USDT` still returns one stale level per side | P1, P4 |
| delisting notice and final settlement price | Not publicly specified | |
| deposits and withdrawals | out of scope, see the per coin pages on the FameEX site | |

## 8. CCXT

CCXT 4.5.68 has no FameEX class: `require('ccxt').exchanges` from `server/` lists 104 ids and none contains `fame`, P1.
So there is no `server/node_modules/ccxt/js/src/fameex.js`, and no `market.taker` to report.
CCXT master at commit `1d8b674434` of 2026-09-22 has no FameEX file in `ts/src` either, S11.
Pull request 28154, "Add FameEX exchange (futures/swap)", has been open and unmerged since 2026-03-16, S12.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP0 futures taker from S3 and S6 |
| `ccxtTakerPpm` | none | there is no CCXT class, so there is no CCXT constant to declare |

The registry today builds each venue's catalog from a CCXT class, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68.
FameEX would need a catalog read from `/fapi/v1/contracts` instead, with `multiplier` as the contract size, see [`rest.md`](./rest.md) section 2.
The other two changes it needs are a gunzip step in the book feed and a per contract anchor poller, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | FameEX OpenAPI Docs, Slate source `source/includes/_doc.en.md` at commit `7c8ed3c1` of 2026-08-12 | https://github.com/fameexDocs/docs-v1, rendered at https://fameexdocs.github.io/docs-v1/en/ | 2026-09-22 | FameEX, global | no funding formula, sections 6 and 7 |
| S3 | FameEX Trading Fee Rates page, and the call it makes, `fee-table` | https://www.fameex.com/en-US/fee/trade and https://www.fameex.com/fe-ex-api/vip/web/fee-table | 2026-09-22 | FameEX, global | VIP table, qualification text, the conflicting example, sections 2, 4 and 5 |
| S4 | FameEX Terms of Service | https://www.fameex.com/en-US/terms | 2026-09-22 | FameEX, global | age, restricted areas, section 1 |
| S5 | FameEX help centre, "Is FameEX a Registered Company? Operating Entity & Registration", dated 2026-07-24 | https://www.fameex.com/en-US/support/faq/is-fameex-a-registered-company | 2026-09-22 | FAMEEX INTERNATIONAL PTY LTD, Australia | operator and AUSTRAC registration, section 1 |
| S6 | FameEX help centre, "FameEX Futures: Max Leverage, Fees & USDⓈ-M Perpetuals", dated 2026-07-24 | https://www.fameex.com/en-US/support/swap/fameex-futures-overview | 2026-09-22 | FameEX | maker 0.020 % and taker 0.060 %, section 2 |
| S7 | FameEX help centre, "Introduction to USDⓈ-M Perpetual", dated 2023-07-22 | https://www.fameex.com/en-US/support/swap/introduction-to-usd-m-perpetual | 2026-09-22 | FameEX | 8 h schedule, suspension at settlement, liquidation trigger, sections 6 and 7 |
| S8 | FameEX help centre, "How to Qualify for the FameEX VIP Program? VIP Upgrades and Cross-Exchange VIP+1 Guide", dated 2026-09-09 | https://www.fameex.com/en-US/support/rewards/how-to-become-fameex-vip | 2026-09-22 | FameEX | retention, Cross-Exchange VIP+1, sections 4 and 5 |
| S9 | FameEX help centre, "FameEX Futures Deduction Credit Rules and Usage Guide", dated 2026-08-20 | https://www.fameex.com/en-US/support/rewards/futures-deduction-credit-rules | 2026-09-22 | FameEX | deduction credit, section 5 |
| S10 | CoinGecko API, `exchanges/fameex`, `derivatives/exchanges/list` and `derivatives/exchanges/fameex_futures` | https://api.coingecko.com/api/v3/exchanges/fameex | 2026-09-22 | CoinGecko | year, country, trust rank, volume, 72 tickers, the 404 on the derivatives entry, sections 1 and 3 |
| S11 | CCXT master, `ts/src` at commit `1d8b674434` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no FameEX class, section 8 |
| S12 | CCXT pull request 28154 | https://github.com/ccxt/ccxt/pull/28154 | 2026-09-22 | CCXT | open and unmerged, section 8 |
| P1 | `rest-probe.mjs catalog`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | contract counts, spot count, CCXT check, access, sections 1, 3, 7 and 8 |
| P3 | `rest-probe.mjs survey`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | rates and settlement grid, section 6 |
| P4 | `rest-probe.mjs book`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | the stale book of a closed contract, section 7 |
| P6 | `rest-probe.mjs config`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | funding intervals, `deliveryKind`, sections 3 and 6 |
| C4 | `curl` of `/fapi/v1/fundingRate?symbol=E-KERNEL-USDT` | https://futuresopenapi.fameex.com/fapi/v1/fundingRate?symbol=E-KERNEL-USDT | 2026-09-23 04:27 UTC | this host | settled rates beyond 1 %, section 6 |

P2, P5, W1 to W6 and C1 to C3 are described in [`rest.md`](./rest.md) section 9 and [`websocket.md`](./websocket.md) section 9.
