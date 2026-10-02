# MAX (MaiCoin) Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:12 to 03:29 UTC, and the second pass 03:34 to 03:39 UTC, from the development host near Seattle.

MAX Exchange (CoinGecko "Max Maicoin", no CCXT class) is a Taiwanese spot exchange with a spot margin wallet called the M-wallet and no perpetual order book.
This profile therefore covers MAX spot, as the survey plan's template change 1 asks, and names every other product in the coverage matrix.
Deposit and withdrawal fees are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22, Pacific time | this profile |
| operator | Modernity Financial Holdings, Ltd., a Cayman Islands company, "authorizes Modernity Financial Technologies Co., Ltd. (the "Company") to manage and run the Site" | S3 |
| site | `https://max.maicoin.com` and the MAX Exchange app | S3 |
| CoinGecko | "Max Maicoin", country Taiwan, established 2018, trust score 7, trust rank 65 on 2026-09-23 UTC, 24 h volume 165.07 BTC | S9 |
| who may trade | terms section 2.2: "According to your citizenship and the regulations of the countries or areas that you are at (including but not limited to Japan, United States and European Economic Area), you may not be able to use part or all of the functions of the Site", and the Company may refuse persons, groups or areas on high risk or sanction lists | S3 |
| US persons | the terms name the United States among the places where the service may be unavailable in part or in whole. Whether a US resident can open an account at all is Not verified, because the help center refused this host | S3, section 1 below |
| age | legal age of majority and full legal capacity under the user's applicable law, terms section 2.1 | S3 |

What this host could read on 2026-09-23 UTC:

| host | reply to this host | read through |
|---|---|---|
| `max-api.maicoin.com` (public REST and the API docs) | 200 | direct |
| `max-stream.maicoin.com` (WebSocket) | 101, sockets open in 646 to 710 ms | direct, see [`websocket.md`](./websocket.md) section 5 |
| `max.maicoin.com`, including `/docs/fees`, `/docs/fees?lang=en`, `/documents/api`, `/robots.txt` | 403 from Cloudflare, `cf-ray` ending `-SEA`, a 39,866 byte page titled "MaiCoin block the request by the security rule" | nothing, WebFetch also got 403 on `/docs/fees` and `/docs/fees?lang=en` |
| `support.maicoin.com` help center folders | 403, 5,572 bytes | nothing, WebFetch also got 403 |
| `www.maicoin.com` | 403, 5,384 bytes | not needed |
| `campaign.maicoin.com/en/vip`, `/en/api`, `/en/api-document` | 200 | direct |
| `assets.maicoin.com/max/max-terms-of-use.html` | 200, a 2.25 MB pdf2htmlEX page in English and Chinese | direct |
| `maicoin.github.io/max-websocket-docs/` | 200 | direct |

The official fee page `https://max.maicoin.com/docs/fees` could therefore not be read.
The fee numbers below come from the public API's VIP table and the VIP campaign page, which agree on every level.

## 2. Quick answer

MAX lists no perpetual, so the numbers that matter for a survey row are spot.

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, every market | 0.080 %, 800 ppm | 0.160 %, 1,600 ppm | `GET /api/v2/vip_levels` level 0 returned `"maker_fee":0.0008,"taker_fee":0.0016` (P1), and the VIP page lists "0.080%" and "0.160%" for VIP0 (S1) |

Neither source splits the schedule by quote currency, so the same VIP 0 rates are taken to apply to TWD, USDT and BTC quoted markets.
That reading is an inference from one table covering all markets, since the fee page that might say otherwise refused this host.

## 3. Coverage matrix

| product | present | count on 2026-09-23 UTC | evidence |
|---|---|---:|---|
| spot | yes, researched | 74 markets: 41 `twd`, 32 `usdt`, 1 `btc` quoted, all `active` | Probed, `GET /api/v3/markets`, see [`rest.md`](./rest.md) section 2 |
| spot margin, the M-wallet | yes, not detailed | `m_wallet_supported` true on 6 markets: `btctwd`, `ethtwd`, `usdttwd`, `ethbtc`, `btcusdt`, `ethusdt` | Probed, and the `/api/v3/wallet/m/*` endpoints of S2 |
| perpetuals | Not offered | 0 | the v3 API has no futures, contract, funding or mark endpoint among its paths (S2), the market rows have no contract, settle or expiry field (P1), and the WebSocket docs list only spot, M-wallet and account channels (S4) |
| dated futures | Not offered | 0 | same evidence |
| options | Not offered | 0 | same evidence |
| instant convert | yes, not detailed | | `POST /api/v3/convert` in S2, private |
| CoinGecko derivatives list | absent | no entry among 214 matches `max` or `maicoin` other than `bitmax_futures`, which is AscendEX | S10 |
| CCXT | absent | no class in 4.5.68 or in master | section 8 |

Deposit and withdrawal fees are looked up on the official page `https://max.maicoin.com/docs/fees`, which refused this host with 403.

## 4. Spot tiers

One schedule, from S1 and P1, which match on all ten levels.

| level | 30 day trading volume, TWD | or MAX staked | maker | taker | maker ppm | taker ppm |
|---|---:|---:|---:|---:|---:|---:|
| VIP 0 | ≥ 0 | ≥ 0 | 0.080 % | 0.160 % | 800 | 1,600 |
| VIP 1 | ≥ 3,000,000 | ≥ 500 | 0.045 % | 0.140 % | 450 | 1,400 |
| VIP 2 | ≥ 10,000,000 | ≥ 3,000 | 0.040 % | 0.110 % | 400 | 1,100 |
| VIP 3 | ≥ 30,000,000 | ≥ 10,000 | 0.020 % | 0.090 % | 200 | 900 |
| VIP 4 | ≥ 150,000,000 | ≥ 50,000 | 0.010 % | 0.080 % | 100 | 800 |
| VIP 5 | ≥ 300,000,000 | ≥ 100,000 | 0.010 % | 0.070 % | 100 | 700 |
| VIP 6 | ≥ 600,000,000 | ≥ 150,000 | 0.010 % | 0.060 % | 100 | 600 |
| VIP 7 | ≥ 1,000,000,000 | ≥ 300,000 | 0.005 % | 0.055 % | 50 | 550 |
| VIP 8 | ≥ 1,500,000,000 | ≥ 500,000 | 0.000 % | 0.050 % | 0 | 500 |
| VIP 9 | ≥ 2,000,000,000 **and** ≥ 100,000 MAX staked | | -0.008 % | 0.045 % | -80 | 450 |

The API returns the same thresholds as `minimum_trading_volume` and `minimum_staking_volume`, with VIP 9 at `2000000000` and `100000` (P1).
The API does not say that VIP 9 needs both.
The VIP page prints "or" between the two columns for VIP 0 to VIP 8 and "&" for VIP 9 (S1).

### Qualification

- "Meet either the trading volume or staking requirement to upgrade to VIP.", S1.
- "VIP levels are recalculated every day 03:00 AM (UTC+8).", and a level earned takes effect at the next 03:00 snapshot, S1.
- The volume is "denominated in New Taiwan Dollar", using "the current year's yearly average crypto price", S1.
- "Rebate is distributed in MAX Token at 3:00 AM every day.", which is how the VIP 9 negative maker is paid, S1.
- A trader with more than 3,000,000 TWD of 30 day volume on other spot venues can apply by email to vip_max@maicoin.com for a VIP level that holds for 30 days, S1.

## 5. Discounts that change the spot taker

| discount | effect on the VIP 0 taker | source |
|---|---|---|
| paying fees in MAX token | the WebSocket key alias table defines `fd` as "fee discounted", "fee is discounted or not (e.g. use MAX TOKEN to pay fee)". The size of the discount is Not publicly specified on any page this host could read | S4 |
| staking MAX token | reaches VIP 1, 1,400 ppm taker, at 500 MAX staked, without any volume | S1 |
| market maker program | "Get access to better fees, higher VIP level and rebate". No public terms | S5 |
| "Low Fee Promotion" | the VIP page carries this heading and "Makers Can Earn Rebates!", which describes the VIP 8 and VIP 9 maker rates. No end date is printed | S1 |
| referral | Not publicly specified on any page this host could read | |

None of these lowers the retail VIP 0 taker for an account that holds no MAX token and trades below 3,000,000 TWD a month.

## 6. Funding as a cost

MAX lists no perpetual, so there is no funding rate.
The M-wallet charges hourly interest on borrowed coins instead.
`GET /api/v3/wallet/m/interest_rates` returned `hourly_interest_rate` and `next_hourly_interest_rate` per coin, for example `"usdt":{"hourly_interest_rate":"0.0000182"}` and `"btc":{"hourly_interest_rate":"0.00000126"}` on 2026-09-23 (P1).
That is a cost of a margin position, not of a spot taker cross, and it is not detailed further.

## 7. Liquidation, settlement and delisting

- Spot has no settlement.
- The M-wallet has liquidations, which the private `/api/v3/wallet/m/liquidations` endpoint lists, and an `ad_ratio` that a private channel reports (S2, S4).
- The M-wallet liquidation charge is Not publicly specified on any page this host could read.
- Market states are `active`, `suspended` and `cancel-only`, where "suspended: both placing and cancelling orders are forbidden" (S2).
- All 74 markets were `active` on 2026-09-23 (P1).

## 8. CCXT

CCXT 4.5.68 has no class for MAX.
`require('ccxt').exchanges` run from `server/` lists 104 ids, and none matches `max` or `maicoin` (P1).
CCXT master on 2026-09-22 has none either.
Its `ts/ccxt.ts` at version 4.5.82, commit `1d8b674` of 2026-09-22 12:48 UTC, registers no `max` or `maicoin` class, and `ts/src/max.ts`, `ts/src/maicoin.ts` and `ts/src/maxmaicoin.ts` return 404 on `raw.githubusercontent.com` (S6).
So `market.taker` cannot be read for any MAX market, and `ccxtTakerPpm` has no source line.

## 9. Recommended registry values

None.
MAX lists no perpetual, and the connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 203.
The connector also loads every venue through a CCXT class, and MAX has none, so it could not be registered even for spot without a hand written catalog loader.

If a later design adds spot legs and a loader, the fee would be `takerPpm: 1_600`, the VIP 0 taker of S1 and P1, with no `ccxtTakerPpm`.
Only the 32 USDT quoted markets would sit in the USD settlement family, see [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
The 41 TWD markets carry most of the venue's volume, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | MAX VIP Program | https://campaign.maicoin.com/en/vip | 2026-09-22 | MAX, Taiwan | VIP table, qualification, rebates, invitation program, sections 2, 4 and 5 |
| S2 | MAX V3 RESTful API List, OpenAPI 2.0 spec behind `https://max-api.maicoin.com/doc/v3.html` | https://max-api.maicoin.com/api/doc/external/v3 | 2026-09-22 | MAX | endpoint list, market states, M-wallet endpoints, sections 3, 6 and 7 |
| S3 | MAX Exchange Terms of Use | https://assets.maicoin.com/max/max-terms-of-use.html | 2026-09-22 | Modernity Financial Holdings, Ltd. and Modernity Financial Technologies Co., Ltd. | operator, eligibility, restricted regions, section 1 |
| S4 | MAX Exchange WebSocket API | https://maicoin.github.io/max-websocket-docs/ | 2026-09-22 | MAX | `fd` field, channel list, sections 3 and 5 |
| S5 | MAX Exchange API landing page | https://campaign.maicoin.com/en/api | 2026-09-22 | MAX | market maker program line, link to the fee page, section 5 |
| S6 | CCXT master `ts/ccxt.ts` and `ts/src` | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts | 2026-09-22 | CCXT | no MAX class in master, section 8 |
| S7 | MAX fee page | https://max.maicoin.com/docs/fees | 2026-09-22, refused with 403 | MAX | nothing could be read, sections 1 and 3 |
| S8 | MaiCoin help center | https://support.maicoin.com/en/support/home | 2026-09-22, folders refused with 403 | MaiCoin | nothing could be read, section 1 |
| S9 | CoinGecko exchange record `max_maicoin` | https://api.coingecko.com/api/v3/exchanges/max_maicoin | 2026-09-23 UTC | CoinGecko | name, country, trust score and rank, volume, section 1 |
| S10 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 UTC | CoinGecko | no MAX entry, section 3 |
| P1 | `rest-probe.mjs all`, 03:17 to 03:19 UTC, and the second pass at 03:34 to 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/max-maicoin/rest-probe.mjs) | 2026-09-23 UTC | this host | VIP table, catalog counts, M-wallet interest, CCXT class list, sections 2 to 8 |
