# Coinstore Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, evening in Seattle (2026-09-23 02:42 to 03:13 UTC), from the development host near Seattle.

This profile covers the USDT-margined linear perpetuals of Coinstore, the only perpetual family it lists, with spot named in the coverage matrix only.
Coinstore has no CCXT class, and its documented perpetual API was deleted on 2026-06-12, see section 8 and [`rest.md`](./rest.md) section 2.
Every fee number below therefore comes from the public, unauthenticated calls that the futures web app at `futures.coinstore.com` makes, read by [`rest-probe.mjs`](../../../scripts/probes/venues/coinstore/rest-probe.mjs).
The help center at `support.coinstore.vip` and `coinstore-support.zendesk.com` refuses this host and the fetch tool, so help center articles were read from Internet Archive copies, labelled with their snapshot date.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Veraxa Ltd., "Coinstore is the brand name under which the Company provides these services" | S1 |
| country on CoinGecko | British Virgin Islands, established 2020, trust score 8, trust rank 29 | S9 |
| excluded regions | "USE OF THE SERVICE BY PERSONS LOCATED IN THE UNITED STATES OF AMERICA AND JAPAN IS PROHIBITED." | S1 |
| US persons | may not trade, same sentence | S1 |
| futures terms | Coinstore Futures Service Agreement, updated 2025-09-03, which names no further region in the archived copy | S2 |
| UK | the FCA warning list has carried "CoinStore / COINSTORE PTE. LTD. / https://www.coinstore.com/" as an unauthorised firm since 2024-11-20 | S10 |
| current futures system | "Coinstore Futures Trading officially launches" on 2025-10-15, and the earliest `onboardDate` in the instrument list is 2025-09-29 04:00 UTC | S11, P1 |

The User Agreement copy is the Internet Archive snapshot of 2025-09-08, which shows "July 01, 2025 12:19 Updated".
The live page answered this host with HTTP 403 and Cloudflare `error code: 1034`, so a later revision may exist.
The public calls in section 2 were open to this host with HTTP 200, and no call was refused on location, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M linear perpetuals, 38 of 59 symbols including `BTCUSDT` and `ETHUSDT` | 0.02 %, 200 ppm | 0.06 %, 600 ppm | P1 |
| USDT-M linear perpetuals, 12 of 59 symbols, among them `TUSDT`, `AMDUSDT` and `1000PUMPUSDT` | 0.04 %, 400 ppm | 0.06 %, 600 ppm | P1 |
| USDT-M linear perpetuals, 9 of 59 symbols: `AVAXUSDT`, `LINKUSDT`, `ARBUSDT`, `AAPLUSDT`, `NVDAONUSDT`, `MRVLUSDT`, `CRCLUSDT`, `HAJIMIUSDT`, `AINUSDT` | 0.02 %, 200 ppm | 0.04 %, 400 ppm | P1 |

The 59 rows are the fee page call `GET https://futures.coinstore.com/api/v1/trade/web/query/querySymbolFee`, read without a login.
Its top-level default is `"makerFee": "0.0004"` and `"takerFee": "0.0006"`, and each row carries `myMakerFee` and `myTakerFee` equal to the public rate when no user is logged in.
The instrument list `GET /api/v1/public/web/instruments` carries the same `makerRate` and `takerRate` for all 58 symbols it lists, with 0 disagreements.
`QNTXUSDT` has a fee row, a ticker and a book but is absent from the instrument list, see [`rest.md`](./rest.md) section 2.
The spot web fee page says "For trading fee specification, please refer to the trading pair table.", so the per-symbol table is the published schedule, S3.

## 3. Coverage matrix

| product | present | notes |
|---|---|---|
| USDT-M linear perpetuals, current system | present | 58 in the instrument list, all `tradeType` `linearPerpetual`, `status` 3, settled in USDT, P1 |
| USDT-M perpetuals, legacy system | present in a catalog only | `GET /api/configs/public` still lists 35 contracts such as `MATICUSDT` and `FTMUSDT`, and their market call answers `user-not-login`, see [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | absent | no `USDC` quote or settle currency in either catalog, P1 |
| coin-margined (inverse) perpetuals | absent | the web app names an `inversePerpetual` trade type, S4, and no instrument uses it, P1 |
| dated futures | absent | none listed, P1 |
| options | absent | none found |
| spot | present | 377 and 376 pairs in two reads, all `openTrade` true, taker 0.2 % on all but one, maker 0.2 % on 345 and 344, from `POST https://api.coinstore.com/api/v2/public/config/spot/symbols`, P1 |

CoinGecko's derivatives list of 112 exchanges on 2026-09-22 does not contain Coinstore, S9.
The perpetuals exist nonetheless, and CoinGecko's exchange page counts 144 spot pairs, S9.

## 4. Perpetual tiers

No public VIP or volume tier table for the perpetuals was found.
The fee call in section 2 returns one maker and one taker per symbol and no tier field.
An archived help center section of 2022 lists an article "Coinstore Futures VIP Program", S5.
That article belongs to the legacy futures system, and its current text could not be read, because the help center refuses this host and the fetch tool.
Third-party pages describe a flat schedule of 0.02 % maker and 0.06 % taker with no tiers, S12, which matches the majority row above.

### Qualification

Not publicly specified for the current system.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| per user rate | the fee call returns `myMakerFee` and `myTakerFee` beside the public rate, so an account can carry its own rate | P1 |
| coupons and rebates | the spot web app renders a "rebate ratio" per coupon, tagged spot or futures | S3 |
| referral | a third-party article claims a permanent 20 % discount with a referral code, not confirmed by Coinstore | S12 |
| zero fee promotions | none found | |

None of these is public, so the engine's base retail taker stays the public row.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | 8 h on all 58 symbols, settled at 00:00, 08:00 and 16:00 UTC over the last 100 settlements of each symbol | P2 |
| last settlement read | 2026-09-23 00:00 UTC on all 58, and the socket's `nextFundRateTime` was 1790150400000, 2026-09-23 08:00 UTC, on all 58 | P2, P3 |
| rates settled | 5,510 settlements over 58 symbols: −0.00005 on 2,692, +0.00005 on 2,131, and 220 distinct values between −0.005 and +0.005 | P2 |
| largest settled rate | 0.005 on `NIULAIUSDT` and `AINUSDT`, below 0.75 times their maintenance margin ratio | P2 |
| formula, legacy article | premium index sampled every minute, "Forecast fund rate (T) = forecast average premium index (T) + clamp [interest rate - forecast average premium index (T), - 0.05%, 0.05]", interest 0.01 % per period, and a cap of "0.75 * maintenance margin ratio" | S6 |
| who pays | "When the market trend is bullish, the funding rate is positive, and the long positions pay the funding fee to short positions." | S6 |
| fee formula | "funding fee = nominal value of position x funding rate", with the nominal value at the mark price | S6 |

The formula article was archived on 2022-12-30 and describes the legacy system.
The current system does not follow it, because that formula yields exactly the 0.01 % interest rate whenever the premium sits inside the ±0.05 % band, and only 2 of the 5,510 current settlements equal 0.0001 while 4,823 are ±0.00005.
The current funding formula, its interest rate and its cap are therefore Not publicly specified.
The settlement instant itself was not captured, and the numbers above come from the funding history call and the index stream, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

No public schedule of liquidation, settlement or delisting charges was found for the current system.
The help center that would hold it refuses this host, and none of the archived help center copies read for this profile postdates the 2025-10-15 launch.
The instrument list carries `maintMarginRatio` from 0.005, on 4 symbols including `BTCUSDT`, to 0.05, and a leverage ceiling from 20 to 125, P1.

## 8. CCXT

CCXT 4.5.68 has no Coinstore class.
`require('ccxt').exchanges` run from `server/` lists 104 ids, and none is `coinstore`, P1.
CCXT master on 2026-09-22 has no `ts/src/coinstore.ts`: the raw file answers HTTP 404, and the GitHub listing of `ts/src` holds no file whose name contains `store`, S7.
A pull request "New Exchange: Coinstore", ccxt/ccxt#18865, has been open since 2023-08-11, and the issue of the same name, #18091, since 2023-05-31, S7.
So there is no `market.taker` to report.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 taker on 50 of 59 perpetual fee rows including `BTCUSDT`, and the call's default |
| `ccxtTakerPpm` | none | CCXT has no Coinstore class, so the connector has no CCXT constant to expect |

A per-symbol override would be needed for the 9 symbols at 400 ppm, since the registry holds one taker per venue.
The recommendation is conditional on the venue ever being wired, which needs a catalog outside CCXT, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coinstore User Agreement, Internet Archive snapshot of 2025-09-08 | http://web.archive.org/web/20250908094712/https://support.coinstore.vip/hc/en-us/articles/8007229258009-User-Agreement | 2026-09-22 | Veraxa Ltd., global | operator, US and Japan prohibited, section 1 |
| S2 | Coinstore Futures Service Agreement, Internet Archive snapshot of 2025-09-08 | http://web.archive.org/web/20250908092537/https://support.coinstore.vip/hc/en-us/articles/8509321332505-Coinstore-Futures-Service-Agreement | 2026-09-22 | Coinstore, global | futures terms date, section 1 |
| S3 | Coinstore spot web app, fee page strings and the chunk that renders the fee and coupon tables | https://www.coinstore.com/js/lang-en_US-fee-js.6dca5493.js and https://www.coinstore.com/js/chunk-1b204698.4ee3b231.js | 2026-09-22 | Coinstore, global | "refer to the trading pair table", rebate ratio, sections 2 and 5 |
| S4 | Coinstore futures web app bundle | https://futures.coinstore.com/app-c5871e5f35262e33814e.js | 2026-09-22 | Coinstore, global | trade type names, API paths, section 3 |
| S5 | Coinstore help center, Futures Trading section, Internet Archive snapshot of 2022-12-30 | http://web.archive.org/web/20221230070203/https://coinstore-support.zendesk.com/hc/en-us/articles/8514933935257-Funding-Rate | 2026-09-22 | Coinstore, global | article list naming a futures VIP program, section 4 |
| S6 | Coinstore "Funding Rate", updated 2022-07-15, same snapshot as S5 | http://web.archive.org/web/20221230070203/https://coinstore-support.zendesk.com/hc/en-us/articles/8514933935257-Funding-Rate | 2026-09-22 | Coinstore, legacy futures | formula, clamp, cap, payer, section 6 |
| S7 | CCXT master `ts/src` listing, raw `coinstore.ts`, pull request 18865 and issue 18091 | https://github.com/ccxt/ccxt/tree/master/ts/src and https://github.com/ccxt/ccxt/pull/18865 | 2026-09-22 | CCXT | no class, section 8 |
| S8 | Coinstore commit "删除永续合约部分的api文档" (deleted the perpetual contract API documentation), b7bcf588, 2026-06-12 | https://github.com/coinstore-openapi/coinstore-openapi.github.io/commit/b7bcf588e19d60bc2690294ce2da092e67f5287f | 2026-09-22 | Coinstore, global | no documented perpetual API, preamble |
| S9 | CoinGecko API, exchange `coinstore` and derivatives exchanges | https://api.coingecko.com/api/v3/exchanges/coinstore and https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=250 | 2026-09-22 | CoinGecko | country, trust rank, pair count, absence from the derivatives list, sections 1 and 3 |
| S10 | FCA warning list, CoinStore / COINSTORE PTE. LTD. | https://www.fca.org.uk/news/warnings/coinstore-coinstore-pte-ltd-https-wwwcoinstorecom | 2026-09-22 | UK | unauthorised firm since 2024-11-20, section 1 |
| S11 | "Coinstore Futures Trading Officially Launches to Empower Global Derivatives", press release of 2025-10-15 | https://markets.financialcontent.com/franklincredit/article/binary-2025-10-15-coinstore-futures-trading-officially-launches-to-empower-global-derivatives | 2026-09-22, search result only | Coinstore, global | launch date of the current system, section 1 |
| S12 | Traders Union, "All Coinstore Fees", July 2026, and MEXC News "The Coinstore Referral Code" | https://tradersunion.com/brokers/crypto/view/coinstore/fees/ and https://www.mexc.com/news/885086 | 2026-09-22, search result only | third party | flat schedule and referral claims, sections 4 and 5 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/coinstore/rest-probe.mjs) | 2026-09-22 | this host | fee rows, instruments, spot symbols, CCXT list, sections 2, 3, 7 and 8 |
| P2 | `rest-probe.mjs anchor` | [`rest-probe.mjs`](../../../scripts/probes/venues/coinstore/rest-probe.mjs) | 2026-09-22 | this host | funding history, section 6 |
| P3 | `ws-probe.mjs index` | [`ws-probe.mjs`](../../../scripts/probes/venues/coinstore/ws-probe.mjs) | 2026-09-22 | this host | `nextFundRateTime`, section 6 |
