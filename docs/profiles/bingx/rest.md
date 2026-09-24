# BingX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, in the local evening, which is 01:14 to 01:54 UTC on 2026-09-23.

This profile covers the public perpetual REST API of BingX (CCXT id `bingx`): the catalog, the anchor call the engine would poll, the book snapshot, limits and the clock.
Every number carries a probe reference, a source ledger row, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs), whose modes are `catalog`, `anchor`, `book` and `limits`.
Every call below is public and needs no key, except that the coin-M contracts call wants a `timestamp` parameter, section 2.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `open-api.bingx.com`, one host for spot, USDT-M, USDC-M and coin-M, under `/openApi/` | S1, CCXT at `server/node_modules/ccxt/js/src/bingx.js` lines 131 to 141 |
| resolved | AWS CloudFront: four IPv4 addresses in `18.172.170.0/24` on two lookups and in `18.172.185.0/24` on a third, and eight IPv6 addresses in `2600:9000::/28` | P4, `dig` at 01:14 UTC |
| edge | `x-amz-cf-pop` `SEA73-P3` on two runs and `YVR52-P1` on one, and `x-cache: Miss from cloudfront` on every call | P1 to P4 |
| origin | "AWS in the Singapore region (ap-southeast-1)" | S2 |
| server time, cold | 269 and 255 ms | P4 |
| server time, warm | 7 calls: min 189, median 231, p90 723 ms in one run, and min 177, median 186, max 193 ms in the other | P4 |
| contracts, 601 KB | 1.30 s on the first `curl`, 368, 454 and 1,131 ms in three probe runs | P1 |
| premium index, all rows | 1.07 s on the first `curl`, then 60 polls in each of three runs, see section 3 | P2 |
| refusals | none: every public call returned HTTP 200, except the coin-M contracts call sent without a `timestamp`, which answered 400 | P1 to P4 |

The round trip of about 180 ms fits the path to the CloudFront edge and on to Singapore, since the edge cached nothing.

## 2. Catalog

### The instruments call

`GET https://open-api.bingx.com/openApi/swap/v2/quote/contracts` returns USDT-M and USDC-M together, 1,269 rows in 601 KB, S3.
The documented `status` values are "1 online, 25 forbidden to open positions, 5 pre-online, 0 offline", S3.

| `status` | API state | settle | rows at 01:28 UTC | rows at 01:39 UTC | rows at 01:54 UTC |
|---|---|---|---:|---:|---:|
| 1 | open | USDT | 909 | 910 | 909 |
| 1 | open | USDC | 49 | 49 | 49 |
| 25 | open | USDT | 161 | 160 | 161 |
| 1 | closed | USDT | 78 | 78 | 78 |
| 25 | closed | USDT | 72 | 72 | 72 |

One contract moved from `status` 25 to 1 and back between reads 26 minutes apart, so the split is not fixed from one read to the next.

API state means `apiStateOpen` and `apiStateClose` both `"true"`.
The 626 rows whose symbol starts with `NC` are TradFi contracts: `NCSK` stocks, `NCFX` forex, `NCCO` commodities and `NCSI` indices, and 329 or 330 of them had `status` 1 and the API open, P1.
Fifteen `NCSK` stock rows carried an `offTime` of 2026-09-24 03:00 or 03:30 UTC, which the documentation defines as the "Delisting timestamp in milliseconds", S3 and P1.
No crypto contract carried one.

`GET /openApi/cswap/v1/market/contracts` lists the coin-M contracts, 20 rows, all `status` 1.
Without a `timestamp` query parameter it answers HTTP 400 `{"code":104414,"msg":"Invalid parameter","retryable":0}`, and with one it answers 200, in both runs, P1.

### How CCXT 4.5.68 maps it

`fetchMarkets` loads USDT-M and USDC-M, then coin-M and spot, at `bingx.js` lines 1130 to 1135, and `loadMarkets` took 917 to 1,191 ms in three runs, P1.

| item | value on 2026-09-23 | source |
|---|---|---|
| markets | 3,560, of which 1,289 swaps and 607 active spot | P1 |
| active swaps | 1,119: 1,070 linear USDT and 49 linear USDC | P1 |
| inactive swaps | 150 USDT rows whose API is closed, and all 20 coin-M contracts | P1 |
| `active` rule | a swap is active when `apiStateOpen` and `apiStateClose` are both `"true"`, at lines 1050 to 1053. The coin-M rows carry neither field, so they fall to the spot branch at line 1054, which needs `apiStateSell`, and end inactive | `bingx.js` |
| `status` 25 | 160 or 161 active swaps carry `status` 25. None of them has a premium index row, the socket refuses them with 80015 and the REST book with 109415 "is pause currently" | P1, P3, [`websocket.md`](./websocket.md) section 4 |
| `market.id` | equal to the contracts `symbol` on 1,119 of 1,119, spelled `BTC-USDT`, which is also the socket topic prefix and the premium index `symbol` | P1, P2 |
| `contractSize` | 1 on every swap, set at line 1049. The socket and the REST book count base coins, so the unit matches | P1, [`websocket.md`](./websocket.md) section 4 |
| `linear` | true on all 1,119 active swaps, false on coin-M | P1 |
| `taker`, `maker` | 0.0005 and 0.0002 on every active swap, see [`fees.md`](./fees.md) section 8 | P1 |
| TradFi | 490 of the 1,119 active swaps are `NC` contracts, 160 or 161 of them in `status` 25 | P1 |

### Size unit, pairs listed twice, and price scale

- Sizes are base coins on the socket and in the REST book, and `bids` equals `bidsCoin` on every read, see section 5.
- 49 bases have both a USDT-M and a USDC-M contract, for example `BTC-USDT` and `BTC-USDC`, and no pair is listed twice within one settlement currency, P1.
  The quote family treats USDT and USDC as one family, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), and keeps one of the two.
- Bases that carry a multiplier spell it in the base: `1000PEPE`, `1000BONK`, `1000SHIB`, `1000CAT`, `1000CHEEMS`, `10000SATS`, `10000NEX`, `1000000BABYDOGE`, `1000000MOG` and `1000000BOB`, P1.
  No price scale is needed while other venues spell the same multiplier the same way.
- `displayName` differs from `symbol` on 664 rows, 38 of them crypto, P1.
  The engine reads `symbol`, so the display name never matches a pair, but it shows where BingX's own naming differs from other venues.
  `NEIROCTO-USDT` displays as `NEIRO-USDT`, `TRUMPSOL-USDT` as `TRUMP-USDT`, `MONAD-USDT` as `MON-USDT`, `LIGHTER-USDT` as `LIT-USDT`, and both `AIINU-USDT` and `GENSYN-USDT` display as `AI-USDT`.
  `CROSS-USDT` displays as `ONE-USDT` while its index was 0.15284 against 0.0054650 for `ONE-USDT` in the first `curl` of the premium index at 01:14 UTC, so it is not Harmony.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /openApi/swap/v2/quote/premiumIndex`, no `symbol` | `indexPrice` | `markPrice` | `lastFundingRate` | `fundingIntervalHours` | `nextFundingTime`, Unix ms | 244.3 to 244.6 KB, 1,036 or 1,037 rows | 60 polls per run: min 197 to 228, median 375 to 378, p90 396 to 489, max 493 to 641 ms, no poll over 1 s |
| `GET /openApi/swap/v2/quote/premiumIndex?symbol=BTC-USDT` | same fields, one row | | | | | 265 bytes | 196 and 219 ms |
| `GET /openApi/cswap/v1/market/premiumIndex` | `indexPrice` | `markPrice` | `lastFundingRate` | absent | `nextFundingTime` | 2.5 KB, 20 rows | 437 ms first request |
| `GET /openApi/swap/v2/quote/ticker` | absent | absent | absent | absent | absent | 372 KB, 1,036 or 1,037 rows | 726 and 773 ms |

One call carries every `AnchorRow` column for USDT-M and USDC-M, keyed by `symbol`, which is CCXT's `market.id`.
Its rows are every `status` 1 contract, including the 78 whose API is closed, and no `status` 25 contract, P1.
Every row carried a non-zero mark and index in the first poll of each of three runs, P2.
CCXT's `fetchFundingRates` reads the same call at `bingx.js` line 1721 and maps `lastFundingRate` to `fundingRate` at line 1747.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTC-USDT` | none |
| `index` | `indexPrice` | decimal string | `Number()` |
| `mark` | `markPrice` | decimal string, never 0 on 1,037 rows | `Number()` |
| `fundingRate` | `lastFundingRate` | decimal string, a fraction per interval: `"0.00001300"` is 0.0013 % | `Number()` |
| `fundingIntervalHours` | `fundingIntervalHours` | integer hours, 1, 4 or 8 on the wire, and 2 also in the enum, S4 | none |
| `nextFundingAt` | `nextFundingTime` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

The documentation calls `nextFundingTime` "The remaining time for the next settlement, in milliseconds", S4.
The wire says otherwise: on all 1,037 rows it was an absolute instant in the future, 02:00, 04:00 or 08:00 UTC on 2026-09-23, P2.
The documentation calls `updateTime` the "Data update time", S4, and on the wire it held the last settlement instant, 00:00 UTC, or 01:00 UTC on hourly contracts, unchanged across every poll.
So `updateTime` is not a freshness stamp, and the poller stamps each reading on arrival as it already does.

## 4. Anchor semantics

### Index

The index is an equal weight average of the last prices of external venues, S5.

- The sources are "Binance, Gate.io, OKX, MEXC, and more", and BingX adds or removes venues "depending on actual conditions", S5.
- One pair per venue is used, USDT-margined first, then USDC or USD, S5.
- A venue whose data is more than 5 s early or late against system time is dropped for that calculation, S5.
- A venue whose last price is 3 % or more from the median of all venues is dropped, S5.
  The older version of the article adds that such a venue is rechecked after 5 minutes and goes to manual review after four exclusions in 30 minutes, S6.
- No per contract basket is published: the API documentation has only the two premium index calls, and its text never names a constituent or a weight, S1.

Whether any BingX index includes BingX's own perpetual is Not verified, because the basket is not published.

### Mark

`Mark Price = Median of (Price 1, Price 2, Last Price)`, where Price 1 is the index and Price 2 is the index plus a 5 minute moving average of `(Best Bid + Best Ask)/2 − Index`, updated every second, S5.

- In "extreme market conditions or deviations in price sources" BingX sets the mark to Price 2, S5.
- During downtime the moving average in Price 2 is set to 0, S5.
- No clamp on the mark against the index is documented.

So the mark follows the perpetual whenever the last trade and the basis average sit on the same side of the index, with no cap.
On 2026-09-23 the mark sat more than 1 % from the index on 9 of 1,036 rows in the first run and 11 of 1,037 in the second, P2.
`ONE-USDT` read mark 0.0031420 against index 0.0054160, 42 % below, and `UPHOOD-USDT` read mark 0.5185 against index 0.4713, 10 % above.
`ONE|USDT` is already in `DENIED_PAIRS` at [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) line 11.

### Funding

The formula, interest, premium sampling, per contract caps and intervals are in [`fees.md`](./fees.md) section 6.
The caps are symmetric on 1,037 of 1,037 rows, and one row sat at its cap: `NCFXUSDBRL2USD-USDT` at 0.0005, P2.

### Upcoming or last settled

The documentation calls `lastFundingRate` the "Last updated funding rate", S4, and says the history call returns "completed historical funding settlement records only", S7.
The wire shows the published rate is the running rate for the upcoming settlement, P2:

| contract | interval | published | last settled, with its instant |
|---|---|---|---|
| `BTC-USDT` | 8 h | 0.0000120 to 0.0000130 | 0.0000020, 00:00 UTC |
| `ETH-USDT` | 8 h | 0.0001000 | 0.0000940, 00:00 UTC |
| `LSK-USDT` | 1 h | −0.0011520 to −0.0012070 | −0.0003640, 01:00 UTC |
| `ESPORTS-USDT` | 4 h | 0.0003820 to 0.0004260 | 0.0012180, 00:00 UTC |
| `COAI-USDT` | 4 h | 0.0004740 to 0.0004900 | 0.0000500, 00:00 UTC |

Across an even spread of 20 contracts, 8 published a rate other than their last settled one and 12 the same one, in both runs.
The 12 are contracts whose running rate had not moved since the settlement, so they do not contradict the reading.
The settlement instant itself was not captured, and what the published rate does across it is Not verified.

### How often each number changed

Changes counted between consecutive polls, 60 polls a second apart, in three runs starting at 01:29, 01:40 and 01:42 UTC, P2.

| contract | index changes | mark changes | rate changes |
|---|---|---|---|
| `BTC-USDT` | 28, 24, 32 | 37, 33, 36 | 0, 6, 0 |
| `ETH-USDT` | 24, 27, 32 | 41, 35, 44 | 0, 0, 0 |
| `TURBO-USDT` | 2, 1, 0 | 25, 10, 8 | 0, 0, 0 |
| `AIINU-USDT` | 5, 6, 1 | 11, 23, 12 | 0, 0, 0 |
| `BTC-USDC` | 20, 19, 29 | 35, 40, 45 | 17, 0, 17 |
| `NCCOGOLD2USD-USDT` | 11, 20, 12 | 17, 23, 12 | 0, 6, 0 |

Across all rows, between the first and the last poll of a run, the index moved on 654 and 688 of 1,037 rows and the mark on 763 and 781, P2.
The rate moved on 1 and 4 rows, and the 4 were all USDC contracts.

Some numbers return to the value before on the next poll, A then B then A.
In the third run that happened 546 times on the index of 250 rows, 2,706 times on the mark of 581 rows, and 40 times on the rate of 4 rows, P2.
The `BTC-USDC` rate took the values 0.0000130, 0.0000128, 0.0000124 and 0.0000120 and went back and forth 10 times in one minute.
The `BTC-USDT` rate changed six times in the second run, and the single symbol call right after that run read 0.0000120 while the bulk call's last poll had read 0.0000130.
A lagging replica behind the edge and a genuine bounce both fit a mark or index return, and a funding rate estimate going back and forth fits a replica better.
The engine's 1,000 ppm move guard reads the index and the mark, and a bounce between two ticks moves well under it on liquid contracts.

## 5. REST book snapshot

`GET /openApi/swap/v2/quote/depth?symbol=BTC-USDT&limit=<n>`, S8.

| item | value |
|---|---|
| limits | 5, 10, 20, 50, 100, 500 and 1,000 all returned exactly that many levels per side, P3 |
| a bad limit | `limit=30` answered HTTP 200 with code 109400 and "failed on the 'len=0\|oneof=5 10 20 50 100 500 1000' tag" |
| fields | `T`, `bids`, `asks`, `bidsCoin`, `asksCoin`. `bidsCoin` and `asksCoin` equalled `bids` and `asks` on every read, including `NCCOGOLD2USD-USDT` |
| level order | bids descending, asks ascending, at every limit |
| size and time | 512 to 514 bytes at 5 levels, 84.5 KB at 1,000, 187 to 316 ms |
| caching | none seen: six reads 100 ms apart each carried a new `T`, about 300 ms apart, and changed sizes, with `x-cache: Miss from cloudfront` |
| `status` 25 contract | code 109415 "NCCOCOFFEE2USD-USDT is pause currently" |
| API closed contract | `POWER-USDT` returned a full book |

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| market data limit | "IP Rate Limit :500 requests per 10 seconds." on the contracts, premium index, depth, funding history and ticker calls, S1 | `x-ratelimit-requests-remain: 499` and `x-ratelimit-requests-expire: 10000` on the first call |
| window | "Users can check the current rate-limiting status using 'X-RateLimit-Requests-Remain' ... and 'X-RateLimit-Requests-Expire'", S9 | a fixed window: 20 calls in a row took `remain` from 499 to 480 while `expire` counted down from 10,000 to 4,122 and 5,777 ms |
| scope | "each API having its own independent rate limit", S9 | per endpoint: after 20 calls to `bookTicker`, `ticker` still read 499 |
| on excess | HTTP 429, then 418 "Continued access after receiving 429, IP has been banned", business code 100410, and "restore after 5 minutes", S9, S10 | not reached, the anchor loop's lowest `remain` was 489 |
| `Retry-After` | not documented | never seen |
| error shape | JSON `{code, msg, data}` | HTTP 200 with a non-zero `code`: 109425 "NOPE-USDT not exist, please verify it in api: /openApi/swap/v2/quote/contracts", 109400 "Invalid parameters, err:symbol: This field must end with -USDT or -USDC.", 100400 "this api is not exist", 109415 for a paused contract. The coin-M contracts call without `timestamp` is the only HTTP 400 seen |

A poller must check `code` in the body, since a failing call still answers HTTP 200.

## 7. Server time and clock offset

`GET /openApi/swap/v2/server/time` returns `{"code":0,"msg":"","data":{"serverTime":1790127596258}}`, S9.
Five samples in each of two runs, each offset measured against the midpoint of the request, P4:

| run | offsets, ms | round trips, ms |
|---|---|---|
| 01:31 UTC | −1, 0.5, 258.5, 5, −3 | 190, 199, 731, 200, 192 |
| 01:40 UTC | −0.5, −1, 1, 4.5, 0.5 | 185, 188, 196, 197, 187 |

The 258.5 ms sample came with a 731 ms round trip and is asymmetric delay rather than skew.
The clock agrees within 5 ms.
Signed requests must fall within 5 s of server time, S9, which matters only for a future execution stage.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex`, without `symbol` | one call carries all five `AnchorRow` fields for every `status` 1 USDT-M and USDC-M contract |
| interval | 1,000 ms, the default | median 375 to 378 ms and max 641 ms over 180 polls, and 10 of the 500 per 10 s budget |
| row mapping | section 3, key `symbol`, and `nextFundingTime` taken as absolute ms | the documentation's "remaining time" is wrong on the wire |
| body check | treat a reply whose `code` is not 0 as a failed round | errors arrive as HTTP 200 |
| rate limit pause | `rateLimitPauseMs` 300,000 | the documentation says a limited IP is restored after 5 minutes and that calling on after a 429 earns a 418 ban, and no `Retry-After` is sent |
| skip | nothing in the reply: `status` 25 contracts are absent already | |
| catalog filter | `marketFilter: (m) => m.linear === true && (m.info as { status?: number }).status === 1` | drops the 160 or 161 `status` 25 contracts CCXT keeps active, which have no anchor row and no book |
| optional filter | also drop ids starting with `NC` | 330 TradFi contracts whose names match no other venue, whose fee depends on the account's region, see [`fees.md`](./fees.md) section 5, and which would take two of the book sockets |
| deny list input | section 4 | `ONE-USDT` reads a mark 42 % under its index, already denied. `UPHOOD-USDT` read 10 % over. The display names in section 2 show where BingX's base spelling differs from its token's usual ticker |

The bulk reply is about 21 GB a day at one hertz, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BingX API docs v3, the site bundle holding every page | https://bingx-api.github.io/docs-v3/static/js/app.8bc50bc0c8a6a308c3e4.js | 2026-09-22 | BingX, global | the 500 per 10 s market data limit, the absence of a basket call, sections 4, 6 |
| S2 | BingX API docs v3, Quick Start, "FAQ" | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | server location, section 1 |
| S3 | BingX API docs v3, Swap, Market Data, "USDT-M Perp Futures symbols" | https://bingx-api.github.io/docs-v3/#/en/Swap/Market%20Data/USDT-M%20Perp%20Futures%20symbols | 2026-09-22 | BingX, global | the contracts call and its `status` values, section 2 |
| S4 | BingX API docs v3, Swap, Market Data, "Mark Price and Funding Rate" | https://bingx-api.github.io/docs-v3/#/en/Swap/Market%20Data/Mark%20Price%20and%20Funding%20Rate | 2026-09-22 | BingX, global | premium index fields and their documented meanings, section 3 |
| S5 | Perpetual Futures, Mark Price & Index Price, 2022-11-24 | https://bingx.com/en/support/articles/12823291011865-perpetualfuturesmarkprice&indexprice | 2026-09-22 | BingX, global | index and mark formulas, section 4 |
| S6 | Perpetual Futures, BingX Index Price Calculation, 2021-12-16 | https://bingx.com/en/support/articles/4412259589401 | 2026-09-22 | BingX, global | the recheck and manual review rules, section 4 |
| S7 | BingX API docs v3, Swap, Market Data, "Get Funding Rate History" | https://bingx-api.github.io/docs-v3/#/en/Swap/Market%20Data/Get%20Funding%20Rate%20History | 2026-09-22 | BingX, global | history holds settled records only, section 4 |
| S8 | BingX API docs v3, Swap, Market Data, "Order Book" | https://bingx-api.github.io/docs-v3/#/en/Swap/Market%20Data/Order%20Book | 2026-09-22 | BingX, global | depth limits and the coin arrays, section 5 |
| S9 | BingX API docs v3, Quick Start, "Basic Information" | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | rate limit headers, per API limits, the 5 minute restore, the server time call, the 5 s signing window, sections 6, 7 |
| S10 | BingX API docs v3, Quick Start, "Error Code Reference" | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | 429, 418 and 100410, section 6 |
| S11 | CCXT 4.5.68 `bingx.js` | `server/node_modules/ccxt/js/src/bingx.js` | 2026-09-22 | CCXT | hosts, `fetchMarkets`, `parseMarket`, `fetchFundingRates`, sections 1 to 3 |
| P1 | `rest-probe.mjs catalog`, 01:28, 01:39 and 01:54 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs) | 2026-09-22 | this host | section 2 |
| P2 | `rest-probe.mjs anchor`, runs starting at 01:29, 01:40 and 01:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4. The window wide changes and returns come from the second and third runs |
| P3 | `rest-probe.mjs book`, 01:31 and 01:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs) | 2026-09-22 | this host | section 5 |
| P4 | `rest-probe.mjs limits`, 01:31 and 01:40 UTC, and `dig` and `curl` at 01:14 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bingx/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 6, 7 |
