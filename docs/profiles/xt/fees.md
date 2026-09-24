# XT.COM Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:16 to 04:01 UTC, from the development host near Seattle.

This profile covers the perpetual futures of XT.COM (CCXT id `xt`), both the USDT-margined family on `fapi.xt.com` and the coin-margined family on `dapi.xt.com`.
Every number carries a source from section 10, a probe run of [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs), or a CCXT file and line.
The help center pages at `xtsupport.zendesk.com/hc/...` answer this host and WebFetch with HTTP 403 and a Cloudflare "Just a moment..." page.
They were read through the public Zendesk help center API, `https://xtsupport.zendesk.com/api/v2/help_center/en-us/articles/<id>.json`, which answered HTTP 200.
The fee page `https://www.xt.com/en/rate` answered HTTP 200, but its tier table is filled in the browser and is empty in the served HTML, so the tiers come from the VIP announcement S2 and the page's own public endpoint S12.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| legal entity | not named in the User Agreement, which says "the company" throughout | S7 |
| registration | Seychelles, per CCXT `'countries': ['SC']` at `server/node_modules/ccxt/js/src/xt.js` line 23 and CoinGecko's `country` field | S13, S14 |
| prohibited users | "Users located in [United States, Canada, Mainland China, Cuba, North Korea, Singapore, Sudan, Venezuela, Crimea] are prohibited from using the services provided by XT.COM", clause 3.3.4, and the list is "non-exclusive and is subject to change" | S7, updated 2026-09-21 |
| United Arab Emirates | added to the restricted jurisdictions, all services ceased on 2026-04-14 | S9 |
| Singapore | users offboarded from 2025-06-15, and "all IP addresses from Singapore will be officially blocked" from 2025-06-20 | S8 |
| US persons | may not trade, by clause 3.3.4 | S7 |
| what this host saw | every public REST and WebSocket endpoint answered from the host near Seattle through CloudFront POP `SEA900`, with no geoblock and no refusal, see [`rest.md`](./rest.md) section 1 | P1, W1 |

Nothing was traded and no account was opened, so whether an order from a US address would be refused was not tested.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | S2, S3, S12 |
| coin-M perpetuals | 0.0200 %, 200 ppm | 0.0600 %, 600 ppm | S2, S3, S12 |

The VIP table S2 lists one futures rate per level and does not split it by family.
The fee structure article S3 gives an opening fee of "Maker fee: 0.02%" and "Taker Process rate: 0.06%", and the same two rates for closing.

The per market fields of the public symbol list disagree on the maker side.
Of the 789 swaps CCXT marks active, which it reads from `takerFee` and `makerFee`, the taker is 0.0006 on 788 and 0 on `skr_usdt`, and the maker is 0.0004 on 554, 0.0002 on 234 and 0 on `skr_usdt`, in all four catalog runs, P2.
The taker agrees with S2 everywhere except `skr_usdt`.
Whether a `makerFee` of 0.0004 is what an account is charged was not verified, since that needs an account.

## 3. Coverage matrix

| product | present | count on 2026-09-23 03:17 UTC | source |
|---|---|---|---|
| USDT-M perpetuals | yes | 1,096 listed, 728 with `tradeSwitch` true, 691 of those also `isOpenApi` true | P2 |
| coin-M perpetuals | yes | 78 listed, 30 with `tradeSwitch` and `isOpenApi` true, inverse, settled in the base coin | P2 |
| USDT-M dated futures | yes | 52 listed, 4 trading: `btc_usdt_260925`, `eth_usdt_260925`, `btc_usdt_261225`, `eth_usdt_261225` | P2, P3 |
| coin-M dated futures | yes | 134 listed, 7 trading | P2 |
| options | no | CCXT reports `'option': false` on every market | S13 |
| spot | yes | 1,185 spot markets in CCXT's catalog | P2 |

CoinGecko's derivatives API lists "XT.COM (Derivatives)" with 763 perpetual pairs and 10 futures pairs, 104,770 BTC of open interest and 133,278 BTC of 24 h volume, S14.
Within the USDT-M family, 217 of the 691 tradable contracts sit in the `TradFi` plate of `GET /future/market/v1/public/plate/list`, 161 in `Tokenized Stocks`, 32 in `FOREX`, 8 in `Commodities` and 7 in `INDEX`, see [`rest.md`](./rest.md) section 4.

## 4. Perpetual tiers

### VIP tiers, effective 2026-03-05 02:00 UTC

From S2, updated 2026-07-07.
A level applies when any one of the three criteria is met.

| level | 30-day average assets (USDT) | 30-day spot volume (USDT) | 30-day futures volume (USDT) | XT asset multiplier | futures maker | futures taker | taker ppm |
|---|---|---|---|---|---|---|---:|
| VIP 0 | < 30K | < 20K | < 200K | 1.4 | 0.0200 % | 0.0600 % | 600 |
| VIP 1 | ≥ 30K | ≥ 20K | ≥ 200K | 1.4 | 0.0180 % | 0.0540 % | 540 |
| VIP 2 | ≥ 50K | ≥ 100K | ≥ 1M | 1.4 | 0.0150 % | 0.0460 % | 460 |
| VIP 3 | ≥ 100K | ≥ 250K | ≥ 8M | 1.6 | 0.0130 % | 0.0410 % | 410 |
| VIP 4 | ≥ 200K | ≥ 500K | ≥ 15M | 1.6 | 0.0120 % | 0.0370 % | 370 |
| VIP 5 | ≥ 500K | ≥ 1M | ≥ 35M | 1.8 | 0.0100 % | 0.0350 % | 350 |
| VIP 6 | ≥ 1000K | ≥ 5M | ≥ 85M | 1.8 | 0.0080 % | 0.0330 % | 330 |
| VIP 7 | ≥ 2000K | ≥ 10M | ≥ 150M | 2 | 0.0060 % | 0.0300 % | 300 |
| Premium VIP | ≥ 5000K | ≥ 15M | ≥ 215M | 2 | 0.0040 % | 0.0280 % | 280 |

The public endpoint the fee page calls, `https://www.xt.com/fapi/user/v1/public/user/step-rate/getStepRates`, returned the same maker and taker at every level on 2026-09-23, with `tradeVolume` thresholds 0, 200,000, 1,000,000, 8,000,000, 15,000,000, 35,000,000, 85,000,000, 150,000,000 and 300,000,000, and `updatedTime` 2026-07-15, S12.
Its Premium VIP threshold of 300,000,000 disagrees with the 215M of S2.

### Qualification

Levels are recomputed daily at 03:00 UTC, S2.
The fee page says 11:00 UTC+8, which is the same instant, S12.
Volume is summed over 30 days from daily snapshots at 16:00 UTC, and master and sub-accounts share one level, S2.

### CCXT's table is an older schedule

CCXT's `fees.contract`, at `server/node_modules/ccxt/js/src/xt.js` lines 390 to 422, starts at maker 0.0004 and taker 0.0006 and steps the taker to 0.000588, 0.00057, 0.00054 and down to 0.0003.
Only the VIP 0 taker matches S2.
The engine never reads this table, since CCXT fills `market.taker` from each market's `takerFee`, section 8.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | source |
|---|---|---|
| XT token holding | none on the rate itself. XT holdings count toward the 30-day average assets with the multiplier in section 4, which can lift the level | S2 |
| "25% OFF on XT" | a spot fee column only, the futures columns carry no such discount | S2 |
| 20 % new user discount | ran from 2022-10-20 to 2022-11-20 and is over | S15 |
| market maker program | not found in the help center search on 2026-09-22 | |
| referral | the affiliate program exists, and its effect on the payer's taker was not found | |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | `Funding Rate = Avg. Premium Index + clamp((Interest Rate − Avg. Premium Index), −0.05%, 0.05%)` | S4 |
| premium index | `[(Best Bid Price + Best Ask Price) ÷ 2 − Spot Index Price] ÷ Spot Index Price`, "calculated once per minute" | S4 |
| averaging | a time weighted mean over the N hours of the interval, weights 1 to n, n = N × 60 | S4 |
| interval, documented | "Perpetual futures settle funding every 8 hours at 16:00 UTC, 00:00 UTC, and 08:00 UTC" | S4 |
| interval, on the wire | 435 USDT-M perpetuals on 4 h, 291 on 8 h and `lsk_usdt` on 1 h in `collection_internal` of `cg/contracts` | P3 |
| cap and floor | none published per contract. A 2022 announcement set `+2.50% / -2.50%` for FTT, so caps exist per contract | S10 |
| observed extremes | `kernel_usdt` −0.00678408 on 4 h, `1000btt_usdt` −0.00489852 on 8 h and `one_usdt` −0.0044691 on 4 h at 03:34 UTC, the same three leading at 03:47 and 03:57 with smaller values, and no value repeated at a common ceiling | P3 |
| charged to | holders at the settlement instant only: "If you do not hold a position at the settlement time, you won't pay or receive funding fees" | S4 |
| amount | `Funding Fee = Position Value × Funding Rate`, with `Position Value = Contract Quantity × Mark Price`, and a positive rate means longs pay shorts | S4 |
| pre-market contracts | a fixed rate, "Premium Index is not applicable" | S11 |

The published rate is an estimate of the next settlement that moves one to two times a minute on average, see [`rest.md`](./rest.md) section 4.
The settled history shows `btc_usdt` settling 0.000031 at 2026-09-23 00:00 UTC while the published rate for 08:00 UTC read 0.00003728 to 0.00004304 during the probes, P3.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | the mark price reaches the liquidation price, open orders on that contract are cancelled, and partial liquidation reduces the position in steps | S16 |
| liquidation fee | `liquidationFee` `"0.0125"` on `btc_usdt` in a curl read of `symbol/list` at 03:16 UTC, 1.25 %, and the help article states no rate | S16 |
| guaranteed stop loss fee | `gslFeeRate` `"0.0005"` on `btc_usdt`, same read | |
| delisting | a delisted contract keeps `isOpenApi` true and `tradeSwitch` false, as `ftt_usdt` and `matic_usdt` do, and its mark stops, `ftt_usdt` last read `t` 1737702036066, 2025-01-24 | P2, P6 |
| deposit and withdrawal | see `https://www.xt.com/en/rate`, tab "Deposit & Withdrawal Fees" | S12 |

## 8. CCXT

`market.taker` for an XT swap comes from the market's own `takerFee` field, `'taker': this.safeNumber(market, 'takerFee')` at `server/node_modules/ccxt/js/src/xt.js` line 1356, and `maker` from `makerFee` at line 1357.
Without credentials, CCXT 4.5.68 reported 0.0006, 600 ppm, on 788 of the 789 swaps it marks active and 0 on `skr_usdt`, P2.
It reported maker 400 ppm on 554, 200 ppm on 234 and 0 on 1.
`BTC/USDT:USDT` read taker 0.0006 and maker 0.0004, and `BTC/USD:BTC` read taker 0.0006.

A swap is `active` when its `isOpenApi` is true, at line 1330, whatever its `tradeSwitch` says.
So the connector's active swap filter keeps 68 contracts that no longer trade, see [`rest.md`](./rest.md) section 2.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 futures taker of S2 and S3, and the value of `takerFee` on every tradable USDT-M perpetual but one |
| `ccxtTakerPpm` | 600 | what CCXT reads from `takerFee` at `xt.js` line 1356. The connector will warn once for `skr_usdt`, whose `takerFee` is `"0"`, which is a per contract promotion or an error that an account could confirm |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | XT Futures API, Basic Information of the Interface | https://doc.xt.com/docs/futures/Access%20Description/BasicInformationOfTheInterface | 2026-09-22 | XT.COM, global | hosts, rate limits, section 1 of [`rest.md`](./rest.md) |
| S2 | XT.COM Announcement on VIP Fee Rate Adjustment | https://xtsupport.zendesk.com/hc/en-us/articles/55724657460889 | 2026-09-22 | XT.COM, global | VIP tiers, qualification, discounts, sections 2, 4 and 5 |
| S3 | Futures Trading Fee Structure | https://xtsupport.zendesk.com/hc/en-us/articles/7243975123993 | 2026-09-22 | XT.COM, global | 0.02 % maker, 0.06 % taker, section 2 |
| S4 | Calculation of Funding Fees | https://xtsupport.zendesk.com/hc/en-us/articles/7214299007129 | 2026-09-22 | XT.COM, global | funding formula, interval, who pays, section 6 |
| S7 | User Agreement | https://xtsupport.zendesk.com/hc/en-us/articles/900001631023 | 2026-09-22 | XT.COM, global | prohibited countries, section 1 |
| S8 | XT.COM Announcement on Access Restrictions for Singapore IP Addresses | https://xtsupport.zendesk.com/hc/en-us/articles/47861336091161 | 2026-09-22 | Singapore | section 1 |
| S9 | XT.COM Discontinues Services in the United Arab Emirates | https://xtsupport.zendesk.com/hc/en-us/articles/56757294542617 | 2026-09-22 | United Arab Emirates | section 1 |
| S10 | XT.COM Announcement on Funding Rate Settlement Frequency and Capped Funding Rate Multiplier of FTT USDT-M Perpetual Contracts | https://xtsupport.zendesk.com/hc/en-us/articles/12364040504089 | 2026-09-22 | XT.COM, global | a per contract funding cap, section 6 |
| S11 | Pre-Market Perpetual Contracts Product Rules | https://xtsupport.zendesk.com/hc/en-us/articles/58170113162137 | 2026-09-22 | XT.COM, global | fixed funding on pre-market contracts, section 6 |
| S12 | XT fee page and its step rate endpoint | https://www.xt.com/en/rate and https://www.xt.com/fapi/user/v1/public/user/step-rate/getStepRates | 2026-09-22 | XT.COM, global | level update time, per level maker and taker, section 4 |
| S13 | CCXT 4.5.68 `xt.js` | `server/node_modules/ccxt/js/src/xt.js` | 2026-09-22 | CCXT | country, fee table, `takerFee` read, `isOpenApi` as active, sections 1, 4 and 8 |
| S14 | CoinGecko derivatives exchange `xt_derivatives` | https://api.coingecko.com/api/v3/derivatives/exchanges/xt_derivatives | 2026-09-22 | CoinGecko | perpetual count, open interest, volume, country, section 3 |
| S15 | XT.COM Announcement on 20% Discount on Transaction Fees for New Registered Users | https://xtsupport.zendesk.com/hc/en-us/articles/11602533289241 | 2026-09-22 | XT.COM, global | an ended discount, section 5 |
| S16 | Forced liquidation | https://xtsupport.zendesk.com/hc/en-us/articles/7219807415705 | 2026-09-22 | XT.COM, global | liquidation mechanics, section 7 |
| P1 | `rest-probe.mjs host` at 03:17 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | hosts answered, section 1 |
| P2 | `rest-probe.mjs catalog` at 03:17, 03:34, 03:47 and 04:00 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | CCXT fees, counts, per market fields, sections 2, 3, 7 and 8 |
| P3 | `rest-probe.mjs anchor` at 03:18, 03:34, 03:47 and 03:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | intervals, funding extremes, settled history, section 6 |
| P6 | `rest-probe.mjs errors` at 03:29 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | the frozen mark of a delisted contract, section 7 |
| W1 | `ws-probe.mjs book` at 03:26, 03:38 and 03:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs) | 2026-09-23 UTC | this host | the public socket answered, section 1 |
