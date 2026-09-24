# Bitbaby Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:12 to 04:50 UTC, from the development host near Seattle through its Canadian VPN exit.

This profile covers the perpetual futures of Bitbaby, which has no CCXT class, for every perpetual family it lists.
Bitbaby publishes no working API documentation, S1, so every fee number below comes from the fee schedule endpoint the website's own VIP page calls, read by [`rest-probe.mjs`](../../../scripts/probes/venues/bitbaby/rest-probe.mjs).
The venue runs on a ChainUp white label, and its funding rules come from the ChainUp futures help center that Bitbaby's own futures configuration links to.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator named in the User Agreement | ECO-CYBER, Inc | S3 |
| country on CoinGecko | United Arab Emirates, established 2024 | S6 |
| CoinGecko trust rank | 143 on 2026-09-22 per the survey, 149 in the API reply at 04:3x UTC on 2026-09-23 | S6 |
| CoinGecko derivatives list | Bitbaby absent from all 214 derivatives exchanges on 2026-09-23 | S6 |
| excluded regions in the User Agreement | none listed | S3 |
| `limitCountryList` in the spot site configuration | `[]` | P1 |
| US persons | refused by the site: `POST /spot/api/common/is_us_ip` answered `"isUS": true` for this host with the popup text "We have detected that your IP address originates from a restricted region where Bitbaby does not provide products or services." | P1 |

The User Agreement names ECO-CYBER, Inc as the "company" that provides the services.
It cites Korea's "Regulation of Standardized Contracts Act" and restricts users under 19, but it lists no prohibited country.
CoinGecko lists the venue in the United Arab Emirates, and no licence was found.

Access results are from a Canadian VPN exit.
The laptop sends all traffic through a pre-existing Surfshark WireGuard tunnel, and Cloudflare's trace endpoint on `www.bitbaby.com` answered `ip=216.246.31.78`, `loc=CA`, `colo=SEA`.
Bitbaby's own region check classified the same address as US, so a person at this exit is treated as a US person by the site.
The public market data endpoints still answered normally, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker |
|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm |
| USDC-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm |

The futures schedule is one table, `type` 2 of `get_level_fee_config_list`, and nothing in it or in the contract catalog splits it by margin coin, P1.
The contract catalog carries no per contract fee field, so every perpetual uses this table, see [`rest.md`](./rest.md) section 2.

## 3. Coverage matrix

| product | present | count on 2026-09-23 | source |
|---|---|---|---|
| USDT-M linear perpetuals | yes | 335, including `E-XAU-USDT` and `E-PAXG-USDT`, the two tagged `Tradfi` | P1 |
| USDC-M linear perpetuals | yes | 23, every one also listed as USDT-M | P1 |
| coin-M inverse perpetuals | no | every contract has `contractSide` 1 and a USDT or USDC margin coin | P1 |
| dated futures | no | every contract has `deliveryKind` `"0"` and `contractType` `"E"` | P1 |
| options | no | none in the site configuration or the catalog | P1 |
| spot | yes, named only | 83 pairs, 77 USDT and 6 USDC, maker 0.2 % and taker 0.2 % at every level | P1 |

## 4. Perpetual tiers

Read from `POST https://web-api.bitbaby.com/spot/api/membership/get_level_fee_config_list` with body `{"type":2}`, P1.
The volume column is `futures_trade` and the asset column is `total_asset`, both as the reply spells them.

| level | 30-day futures volume | asset balance | maker | taker | maker ppm | taker ppm |
|---|---:|---:|---:|---:|---:|---:|
| Regular User (VIP 0) | below 100,000,000 | below 100,000 | 0.02 % | 0.06 % | 200 | 600 |
| VIP1 | 100,000,000 | 100,000 | 0.019 % | 0.058 % | 190 | 580 |
| VIP2 | 200,000,000 | 150,000 | 0.0185 % | 0.056 % | 185 | 560 |
| VIP3 | 300,000,000 | 170,000 | 0.018 % | 0.054 % | 180 | 540 |
| VIP4 | 400,000,000 | 200,000 | 0.0175 % | 0.052 % | 175 | 520 |
| VIP5 | 500,000,000 | 1,000,000 | 0.017 % | 0.05 % | 170 | 500 |
| VIP6 | 600,000,000 | 2,000,000 | 0.0165 % | 0.048 % | 165 | 480 |
| VIP7 | 700,000,000 | 3,000,000 | 0.0155 % | 0.044 % | 155 | 440 |
| VIP8 | 800,000,000 | 4,000,000 | 0.0145 % | 0.042 % | 145 | 420 |
| VIP9 | 900,000,000 | 5,000,000 | 0.0125 % | 0.04 % | 125 | 400 |
| VIP10 | 1,000,000,000 | 6,000,000 | 0.01 % | 0.035 % | 100 | 350 |

### Qualification

The reply's `condition` is `{"firstKey":"futures_trade","secondKey":"total_asset","rule":"|,|","saveDays":7,"platformOpen":0,"platformRate":0}`, P1.
The VIP page labels the two columns with "and/or", and its translation strings say the 30-day futures volume is computed at 01:00 the next day, the asset balance is a daily snapshot converted to USD, and levels update daily at 02:00, S2.
The unit of the volume column is not printed in the reply, and the page renders it with a currency placeholder, so USD or USDT is an inference.
`saveDays` 7 matches the page text that an upgraded user keeps the level for a number of days without downgrading.
The page also says a VIP level reached under any trading type applies to all types, S2.

## 5. Discounts that change the perpetual taker

| discount | state on 2026-09-23 | source |
|---|---|---|
| platform token fee discount | off: `platformOpen` 0 and `platformRate` 0 in the fee condition, and `fee_coin_open` `"0"` in the spot site switches | P1 |
| per user discount | `get_user_fee_discount` exists but needs a login, so it was not read | S2 |
| referral | an invitation program exists, its fee effect is Not publicly specified | S2 |
| market maker program | Not publicly specified | |
| zero fee promotion | none found | |

## 6. Funding as a cost

The rules below are the ChainUp futures help center, which Bitbaby's futures configuration links as `contractProInfo`, S4.
It is a generic white label document, so where Bitbaby's wire differs, both are written.

| item | documented | observed on Bitbaby |
|---|---|---|
| interval | "Every 8 hours is a period", settled at 00:00, 08:00 and 16:00 GMT+8 | `capitalFrequency` 8 h on 91 contracts, 4 h on 260 and 1 h on 7, P1 |
| next settlement | not documented as a field | `nextCapitalSettTime` 2026-09-23 08:00 UTC on 351 contracts and 05:00 UTC on 7, read at 04:38 UTC, P1 |
| who pays | holders at the settlement instant, longs pay shorts when the rate is positive | not captured |
| charge | "Funding fee = position value \* funding rate", position value = size \* contract size \* mark price, taken from or added to position margin | not captured |
| formula | clamp(average premium index + clamp(composite rate minus average premium index, premium limits), funding rate limits), with a composite rate of 0.01 % per 8 h | not how Bitbaby sets it, see below |
| cap and floor | "funding rate upper limit" and "lower limit", values not published | not published per contract |

Every ticker frame on the socket carried `"admin_fund_rate_source":"\"third\""`, 14,191 frames over 358 contracts and 12,919 in the rerun, P3.
The REST `currentFundRate`, which equals the socket's `last_fund_rate_third`, sat within 3 ppm of Binance USD-M `lastFundingRate` on BTC and ETH over 60 polls in two runs, and within 22 ppm on IOTX, P2.
So the rate Bitbaby shows as current is most likely copied from a third venue, very likely Binance, and the ChainUp formula above does not produce it.
That is an inference from the numbers, and Bitbaby does not publish which rate it charges.
The socket also carries `funding_rate_next` and `funding_rate_last`, and their meaning is Not verified, see [`rest.md`](./rest.md) section 4.
No public funding history endpoint was found, and the settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

- The futures UI strings say a position is closed when "margin ratio \<= maintenance margin rate + liquidation taker fee", S2, and the liquidation fee rate itself is Not publicly specified.
- `POST /futures/api/common/get_ladder_info` with `{"contractId":1}` returns an 11 tier leverage ladder named "BTC 200X杠杆", P1.
- The help center describes a tiered liquidation, an insurance fund and auto deleveraging, S4.
- Settlement and delisting charges: Not publicly specified.
- Deposit and withdrawal fees: the VIP page's coin list, from `get_coin_withdraw_fee_list`, is the official lookup.

## 8. CCXT

CCXT 4.5.68 has no Bitbaby class.
`require('ccxt').exchanges` from `server/` lists 104 ids and none matches `baby` or `chainup`, P1.
The CCXT master branch on GitHub had 105 exchange files under `ts/src` at commit `1d8b674` of 2026-09-22 12:48 UTC, and none is Bitbaby or a ChainUp base class, S5.
So there is no `market.taker` to read and no source line to cite.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | VIP 0 perpetual taker from the venue's own schedule, section 4 |
| `ccxtTakerPpm` | none | no CCXT class exists, so the catalog would have to come from a custom loader first |

These values only matter if a catalog outside CCXT is built, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbaby footer list | `POST https://web-api.bitbaby.com/operations/api/cms/footerList` | 2026-09-22 | Bitbaby | the API Documentation and Fee Structure links, sections 1 and 8 |
| S2 | Bitbaby VIP Levels page and its translation strings | https://www.bitbaby.com/en-us/myRate | 2026-09-22 | Bitbaby | qualification text, discounts, liquidation wording, sections 4, 5 and 7 |
| S3 | Bitbaby User Agreement | https://www.bitbaby.com/en-us/cms/agreement | 2026-09-22 | ECO-CYBER, Inc | operator, age limit, no region list, section 1 |
| S4 | ChainUp futures help center, Funding Rate, Mark Price, Index Price | https://futuresdoc.gitbook.io/help-center/perpetual/overview/funding-rate.md | 2026-09-22 | ChainUp white label | funding rules and formula, section 6 |
| S5 | CCXT master, `ts/src` listing | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Bitbaby class, section 8 |
| S6 | CoinGecko exchange record and derivatives list | https://www.coingecko.com/en/exchanges/bitbaby-exchange | 2026-09-22 | CoinGecko | country, year, rank, absence from derivatives, section 1 |
| P1 | `rest-probe.mjs catalog`, runs at 04:32, 04:38, 04:44 and 04:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbaby/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | fee tiers, catalog counts, region check, CCXT id list, sections 1 to 5, 7 and 8 |
| P2 | `rest-probe.mjs anchor`, runs at 04:33 and 04:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbaby/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `currentFundRate` against Binance, section 6 |
| P3 | `ws-probe.mjs tickers`, runs at 04:34 and 04:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbaby/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `admin_fund_rate_source` on every ticker frame, section 6 |
