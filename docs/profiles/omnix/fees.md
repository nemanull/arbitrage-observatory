# OmniX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:36 to 06:59 UTC), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the fees of OmniX, CoinMarketCap exchange id 7699, which CoinMarketCap marks with the notice "CoinChief has rebranded as OmniX.", S1.
No CCXT class exists for it, see section 8.
OmniX lists USDT-margined perpetuals only, and every number below is about them unless it says otherwise.
The public API is the ChainUP white-label API that the CoinChief exchange ran before the rebrand, on `coinchief.live` hosts, see [`rest.md`](./rest.md) section 1.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| brand | OmniX, announced as the new name of CoinChief on 2026-09-21 | S13, notice 675 in the venue's own notice list, P1 |
| earlier names | CoinChief, website `https://www.coinchief.io/` on CoinMarketCap on 2025-08-28 | S16 |
| website on CoinMarketCap | `https://www.omnix.vin/#top`, launched 2021-03-31 per CoinMarketCap | S1 |
| operator | the venue's own config names `company_name` `"Coin Chief"` and gives no legal entity, address or licence | S4, P1 |
| terms and excluded regions | Not publicly specified. `www.omnix.vin` has no terms page, its footer links are in-page anchors | S3 |
| help center legal pages | the risk warning and the AML agreement at `coinchief.freshdesk.com` still name BitonEx, and the AML agreement cites Singapore's AML/CFT law | S14 |
| region field in config | `limitCountryList` `["980"]`, a code whose meaning is Not publicly specified | S4, P1 |
| US persons | Not publicly specified | |
| access from this host | every public REST call and the futures socket answered, nothing was refused, see [`rest.md`](./rest.md) section 1 | P1, W1 |

The site at `www.omnix.vin` is a static single-page app.
Its futures page shows hard-coded numbers, a BTC mark of `64281.7`, a funding countdown fixed at `04:26:13` and an equity of `12480.25`, in `/assets/FuturesTradingPage-BtanXydj.js`, S3.
So OmniX publishes no fee schedule, entity or terms of its own on 2026-09-22.
Every fee number below comes from the venue's CoinMarketCap feed and CoinMarketCap's listing.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, 45 contracts | 0.025 %, 250 ppm | 0.06 %, 600 ppm | `maker_fee` `0.00025` and `taker_fee` `0.0006` on all 45 rows of `GET /cmc/specifications`, P2. CoinMarketCap shows `makerFee` 0.025 and `takerFee` 0.06, S1. The venue's CMC-api page shows the same two numbers in its example reply, S6 |

These are the numbers the venue reports to CoinMarketCap.
No official fee page, tier table or help center article confirms them for futures, see section 4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 45 in `GET /fapi/v1/contracts`, all `type` `E` and `status` 1, and 43 on the web contract list | P2 |
| USDC-M perpetuals | no | every contract is `*-USDT`, P2 |
| coin-margined perpetuals | no | every contract has `side` 1, "forward", P2 and S7 |
| dated futures | no | `type` is `E` on all 45 rows, where `E` is "Perpetual contract", S7 |
| options | no | none listed in any catalog read, P2 |
| spot | yes, 65 USDT pairs in `GET https://openapi.coinchief.live/sapi/v1/symbols`, and 48 pairs on CoinMarketCap | P2, S1 |

CoinMarketCap's perpetual list for OmniX held 27 pairs on 2026-09-23 06:24 UTC, S2.

## 4. Perpetual tiers

Not publicly specified.
No VIP table, volume rule or tier name was found on `www.omnix.vin`, `www.coinchief.live`, the help center, or the API documentation.
The help center's only fee article is "Spot Trading Fees", which is addressed to "Dear BitonEx Users" and lists spot pairs at 0.20 % or 0.10 % maker and taker, S12.
It is inherited from another ChainUP white-label and does not describe futures.

## 5. Discounts that change the perpetual taker

Not publicly specified.
No platform token discount, referral rebate, market maker programme or zero fee promotion was found.
The venue's twenty latest notices, from 2026-02-14 to 2026-09-21, announce a computing power programme, airdrops, a prediction market and the rebrand.
None of their titles names a futures fee, P1.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | 8 h, "Settlement 3 times a day, namely 00:00, 08:00, 16:00 (GMT+8)", that is 16:00, 00:00 and 08:00 UTC | S9 |
| interval in the catalog | `capitalFrequency` 8 on all 43 web contracts | P2 |
| who pays | longs pay shorts when the rate is positive, "The funding fee is completely settled between users" | S9 |
| charge | position value times the rate, where position value is size times contract size times mark price | S9 |
| formula | `clamp(average premium index + clamp(composite rate - average premium index, upper, lower), funding upper limit, funding lower limit)`, composite rate 0.01 % per period | S9 |
| cap and floor | named in the formula, values Not publicly specified | S9 |
| published rates on 2026-09-23 | `nextFundRate` 0.0001 on 19 contracts, 0.0075 on 20, 0.00375 on 3, 0.015 on 2, 0 on 1 | P3 |

A `nextFundRate` of 0.00375 is 0.375 % per 8 h, 0.0075 is 0.75 % and 0.015 is 1.5 %.
The contracts at those three rates include BTC and ETH at 0.00375, SOL at 0.0075, and BNB and DOGE at 0.015, whose index is 27 % to 36 % below the market, see [`rest.md`](./rest.md) section 4.
A rate that large is what the formula gives when the index lags the traded price, so a long position on those contracts would pay a large funding charge if it is settled at that rate.
No public funding history call exists in the documented API, so the settled rates and the settlement instant itself were not captured, S5 and S7.

## 7. Liquidation, settlement and delisting

Not publicly specified.
The help center describes the mark price as the median of the latest price, a "reasonable price" and a moving average price, S10.
No liquidation fee, insurance fund charge or delisting settlement rule was found.

## 8. CCXT

CCXT 4.5.68 has no class for OmniX or CoinChief.
`node -e "console.log(require('ccxt').exchanges)"` run from `server/` lists 104 ids, and none of `omnix`, `coinchief` or `chainup` is among them, P2.
The current CCXT master on GitHub has no such file under `ts/src` either, checked at commit `af2441ab5b` of 2026-09-23 05:39 UTC, S15.
So `market.taker` has no value to report for OmniX.

The CCXT `bitrue` class speaks a ChainUP-derived futures API, with the `X-CH-APIKEY` header at `server/node_modules/ccxt/js/src/bitrue.js` line 3316 and a `kline-api/ws` futures socket at `server/node_modules/ccxt/js/src/pro/bitrue.js` line 31.
Its URLs are fixed to Bitrue's hosts, so it cannot load the OmniX catalog.
Bitrue is profiled in [`../bitrue/`](../bitrue/).

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the `taker_fee` the venue reports on every contract, P2, and CoinMarketCap's `takerFee`, S1 |
| `ccxtTakerPpm` | none | no CCXT class exists, so a custom catalog connector would be needed first, see [`rest.md`](./rest.md) section 2 |

The venue is not recommended for the engine today, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

Source ids are shared across the three OmniX profiles, so this ledger lists only the ids this file cites.

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap exchange page for OmniX | https://coinmarketcap.com/exchanges/omnix/ | 2026-09-22 | CoinMarketCap | rebrand notice, website, launch date, `makerFee` and `takerFee`, spot pair count, sections 1 to 3 |
| S2 | CoinMarketCap market pairs, perpetual | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=omnix&category=perpetual&start=1&limit=100 | 2026-09-22 | CoinMarketCap | 27 perpetual pairs, section 3 |
| S3 | OmniX website and its futures page bundle | https://www.omnix.vin/ and https://www.omnix.vin/assets/FuturesTradingPage-BtanXydj.js | 2026-09-22 | OmniX | static page, hard-coded numbers, no terms, section 1 |
| S4 | OmniX site config, `POST /fe-ex-api/common/public_info` | https://www.omnix.vin/fe-ex-api/common/public_info | 2026-09-22 | OmniX, served from the CoinChief backend | `company_name`, `base_url`, `wsUrl`, `limitCountryList`, section 1 |
| S5 | CoinChief open API document, English | https://www.coinchief.live/openapi/open-api-en.html | 2026-09-22 | CoinChief | endpoint list, no funding history call, section 6 |
| S6 | CoinChief CMC interface document | https://www.coinchief.live/CMC-api/ | 2026-09-22 | CoinChief | `/cmc/specifications` fields and example fees, section 2 |
| S7 | ChainUP Pri-openapi, Futures Trading API | https://exchangeopenapi.gitbook.io/pri-openapi/openapi-doc/futures-trading-api | 2026-09-22 | ChainUP, the white-label vendor | contract `type` and `side` meanings, endpoint list, sections 3 and 6 |
| S9 | Help center, Funding Rate | https://coinchief.freshdesk.com/en/support/solutions/articles/154000126070-funding-rate | 2026-09-22 | CoinChief help center, text last modified 2025-04-21 | interval, times, formula, section 6 |
| S10 | Help center, Mark Price | https://coinchief.freshdesk.com/en/support/solutions/articles/154000126229-mark-price | 2026-09-22 | CoinChief help center | mark formula, section 7 |
| S12 | Help center, Spot Trading Fees | https://coinchief.freshdesk.com/en/support/solutions/articles/154000133884-spot-trading-fees | 2026-09-22 | CoinChief help center, addressed to BitonEx users | spot fees only, section 4 |
| S13 | OmniX Official Announcement, Strategic Brand Upgrade | https://coinchief.freshdesk.com/zh-CN/support/solutions/articles/154000262174-omnix-official-announcement-strategic-brand-upgrade-a-new-era-of-the-all-sector-financial-ecosystem-begins | 2026-09-22 | CoinChief help center | "CoinChief is officially evolving into: OmniX", section 1 |
| S14 | Help center, Risk Warning and Anti-Money Laundering Agreement | https://coinchief.freshdesk.com/en/support/solutions/articles/154000126467-risk-warning and https://coinchief.freshdesk.com/en/support/solutions/articles/154000126304-anti-money-laundering-agreement | 2026-09-22 | CoinChief help center | BitonEx wording, Singapore AML reference, section 1 |
| S15 | CCXT master, `ts/src` listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-22 | CCXT | no OmniX or CoinChief class, section 8 |
| S16 | CoinMarketCap page for CoinChief, Wayback capture of 2025-08-28 | https://web.archive.org/web/20250828060432/https://coinmarketcap.com/exchanges/coinchief/ | 2026-09-22 | Internet Archive | earlier website `www.coinchief.io`, section 1 |
| P1 | `rest-probe.mjs host` | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | access, config, sections 1 and 5 |
| P2 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host | contract counts, fees in the CMC feed, CCXT ids, sections 2, 3 and 8 |
| P3 | `rest-probe.mjs anchor` | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host | published funding rates, section 6 |
| W1 | `ws-probe.mjs book` | [`ws-probe.mjs`](../../../scripts/probes/venues/omnix/ws-probe.mjs) | 2026-09-22 | this host | the futures socket answered, section 1 |
