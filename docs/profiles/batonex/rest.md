# Batonex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:41 to 06:55 UTC (2026-09-23 evening Pacific), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of Batonex for its one perpetual family, USDT-margined, with the anchor in detail.
Batonex is a white label of the BHEX broker platform, and its documentation is the GitHub repository `github.com/batonex/openapi`, S1.
Every probed value comes from [`rest-probe.mjs`](../../../scripts/probes/venues/batonex/rest-probe.mjs) unless the line names another source.
The probes load `ws` and `ccxt` from `server/node_modules`, which the server's Rust rewrite removed at about 06:56 UTC, after these runs, so rerunning them needs those two packages installed there again.
Access results are from that Canadian VPN exit, and no call was refused.
What the engine needs from each section is set out in [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) section "What the engine needs from a venue".

## 1. Host and latency from this machine

| host | resolved on 2026-09-24 UTC | probed |
|---|---|---|
| `api.batonex.com` | `13.196.130.177`, `35.75.253.166`, AWS Tokyo | `/openapi/v1/time` in 1,025 and 988 ms cold, 249 ms warm |
| `wsapi.batonex.com` | the same two addresses | see [`websocket.md`](./websocket.md) |
| `www.batonex.com` | four CloudFront addresses in `18.64.67.0/24` | web app API in 110 to 770 ms |

The warm round trip is about 245 ms, and a request on a new connection takes about one second.
In the one second poll, the index call took 246 to 249 ms at the median and 90th percentile and 1,029 ms at worst, see section 4.

## 2. Catalog

### The instruments call

`GET https://api.batonex.com/openapi/v1/brokerInfo` returns `symbols` (spot), `options` and `contracts` in one 160,586 byte reply in about one second, S2.

| field | value on 2026-09-24 UTC |
|---|---|
| `contracts` | 119, every one `status` `TRADING`, `underlying` `USDT_MARGINED`, `marginToken` `USDT`, `inverse` false |
| symbol spelling | `<BASE>-SWAP-USDT` for 22 older contracts such as `BTC-SWAP-USDT`, `<BASE>-USDT-PERP` for 97 such as `0G-USDT-PERP` |
| `options` | 0 |
| `symbols` (spot) | 30 |
| `contractMultiplier` | one of 0.0001, 0.001, 0.01, 0.1, 1, 10, 100, 10,000, 100,000 or 1,000,000 coins per contract |
| `index` | the index symbol, such as `BTCUSDT`, 119 distinct |
| `rateLimits` | `REQUEST_WEIGHT` 3,000 per minute, `ORDERS` 60 per 60 s |

The list includes equity and commodity perpetuals such as `AAPL-USDT-PERP`, `TSLA-USDT-PERP`, `NVDA-USDT-PERP`, `CL-USDT-PERP` and `PAXG-USDT-PERP`, and three custom index contracts `INDEXAI-USDT-PERP`, `INDEXCHN-USDT-PERP` and `INDEXSOL-USDT-PERP`.
No base is listed twice.
The 24 h ticker call `/openapi/quote/v1/contract/ticker/24hr` returns 176 rows, and the 57 rows not in `brokerInfo` are demo contracts spelled `D<BASE>-QSDT-PERP`, which the web app uses for its test sub-account.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 lists 104 exchanges and none matches `bato`, `wise`, `bhex` or `hbtc`, from `node -e "console.log(require('ccxt').exchanges)"` in `server/`.
The master branch of `github.com/ccxt/ccxt` holds 104 `.ts` files in `ts/src` on 2026-09-24 UTC and none is named for Batonex, from the GitHub contents API.
So `loadMarkets` cannot build this catalog, and a venue loader would have to read `brokerInfo` itself.
A loader would set `market.id` to `symbol`, which is exactly the spelling of the socket and of the funding reply, `contractSize` to `contractMultiplier`, and `linear` to true.

### Size unit, pairs listed twice, and price scale

Sizes are contracts of `contractMultiplier` coins.
The 24 h ticker's `quoteVolume` divided by `volume` times `lastPrice` implies 0.0001007 for `BTC-SWAP-USDT`, 0.01001 for ETH, 0.1006 for SOL, 0.001005 for `AAPL-USDT-PERP` and 101 for `1MBABYDOGE-USDT-PERP`, against multipliers of 0.0001, 0.01, 0.1, 0.001 and 100.
`1MBABYDOGE-USDT-PERP` is quoted per million BABYDOGE, its index `1MBABYDOGEUSDT` reads `(x[BINANCE])/1`, and a cluster with another venue's BABYDOGE contract would need a price scale.

## 3. Anchor

### The bulk calls

| call | reply on 2026-09-24 UTC | carries |
|---|---|---|
| `GET /openapi/v1/contracts`, S3 | 119 rows, 62,322 bytes, 252 to 1,498 ms | `indexPrice`, `index`, `fundingRate` (the last settled rate), `nextFundingRate` (the upcoming rate), `nextFundingRateTs` in Unix seconds, plus `bid`, `ask`, `lastPrice`, `openInterest` |
| `GET /openapi/quote/v1/contract/index`, S4 | 122 index keys, 5,805 bytes, weight 0 | `index` and `edp` maps keyed by index symbol |
| `GET /openapi/contract/v1/fundingRate`, not in S1 | 116 rows, 12,477 bytes | `symbol`, `intervalStart`, `intervalEnd`, `rate`. The 3 `INDEX*` contracts are missing |
| `GET https://www.batonex.com/api/contract/funding_rates`, the web app's call | 119 rows | `tokenId`, `lastSettleTime`, `settleRate`, `nextSettleTime`, `fundingRate` |
| `GET /openapi/quote/v1/markPrice?symbol=BTC-SWAP-USDT` | HTTP 200 with an empty body, and HTTP 400 `Parameter symbol [String] missing!` without a symbol | nothing |

No call returns a mark price.
The `contracts` reply names the upcoming rate `nextFundingRate`, and the `fundingRate` field in it is the last settled rate: on `BTC-SWAP-USDT` it read `0.00000101`, equal to the web app's `settleRate` for the settlement at `1790208000000`, while `nextFundingRate` read `0.000133532357168806`, equal to the `rate` of the interval ending `1790236800000`.

### Row mapping

| `AnchorRow` column | field |
|---|---|
| `index` | `indexPrice` from `/openapi/v1/contracts`, or `index[<index>]` from `/openapi/quote/v1/contract/index` |
| `mark` | none published, so 0, and the engine refuses the route at open |
| `fundingRate` | `nextFundingRate` |
| `fundingIntervalHours` | 8, from `intervalEnd` minus `intervalStart` on all 116 rows of `/contract/v1/fundingRate`, and the settlement history 28,800,000 ms apart |
| `nextFundingAt` | `nextFundingRateTs` times 1,000 |

## 4. Anchor semantics

### Index

The index is another venue's perpetual mark price.
The socket `index` topic names the source of each index, see [`websocket.md`](./websocket.md) section 4: 107 of 119 read `MARK_PRICE_BINANCE`, 3 read `MARK_PRICE_BITGET`, 5 average two venues' numbers, and 3 read a `CUSTOM_EX2` source.
The `anchor` mode read Batonex's index and Binance's `/fapi/v1/premiumIndex` in one pass.
`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `EDGEUSDT`, `XRPUSDT`, `AVAXUSDT` and `TSLAUSDT` matched the Binance `markPrice` to the last digit, 0 ppm, and sat 221 to 1,894 ppm away from the Binance `indexPrice`.
109 of 113 indices that share a Binance symbol were within 500 ppm of the Binance mark.
A second pass at 06:56 UTC fetched both replies in parallel with curl: 83 of 113 were exactly equal to the Binance mark and 110 of 113 within 500 ppm, and BTC, ETH and SOL matched to the last digit again.
So for 107 contracts the Batonex index is not a spot basket, it is Binance's perp mark, which already trails and clamps the Binance perp.
This is the shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), made worse: a Batonex against Binance route would compare the Binance leg against its own mark.
`edp` is the documented "estimated delivery price", the average of the index over the last 10 minutes, S4.
No basket call exists.

### Mark

None is published on REST or on the socket.
The help centre says a take profit or stop loss triggers on "the index price or the market price", S6, and no page names a mark price.
So the liquidation price is Not verified, and the evidence points to the index doing that job.

### Funding

Funding settles every 8 hours at 00:00, 08:00 and 16:00 UTC, and only a position held at that instant pays or receives, per the perpetual guide at `https://www.batonex.com/en/guide/perpetual/intro`, rendered once headless, S7.
No formula, cap or floor is published there or in S1.
Across 116 rows the upcoming rate ranged from `-0.00023723` to `0.00027668`.
The settlement instant itself was not captured.

### How often each number changed

60 rounds of one second polls of the index call and the contracts call, in the `poll` mode.

| number | changes per symbol per minute |
|---|---:|
| `index` from the index call | 21.5 |
| `indexPrice` from the contracts call | 23.8 |
| `nextFundingRate` | 0.04 |
| `nextFundingRateTs` | 0 |

The two calls disagreed on the BTC index by 88 ppm at the median and 511 ppm at worst, because they were read about 250 ms apart and the index republishes each second.
The upcoming rate is nearly static, so the published rate is a periodic estimate and not a live premium.

## 5. REST book snapshot

`GET /openapi/quote/v1/contract/depth?symbol=<symbol>&limit=<n>`, S4.
The documentation says it updates every 3 s with at most 100 levels.
The wire returned 20, 100 and, for `limit=300`, 200 levels per side, bids descending and asks ascending.
Five reads 300 ms apart returned book `time` values 228 to 812 ms old, and the top five levels equalled the socket frame with the same `t`, so REST and socket serve the same book.
`/openapi/quote/v1/contract/depth/merged` answered too, documented at a 0.5 s update.

## 6. Rate limits and errors

The documented limit is 3,000 request weight per minute, S2 and S5.
HTTP 429 answers a breach and HTTP 418 an automatic IP ban that scales from 2 minutes to 3 days, S5.
No reply carried a rate limit header or `Retry-After`, and no limit was reached.

| request | status | body |
|---|---|---|
| depth on `NOPE-SWAP-USDT` | 400 | `{"code":-100011,"msg":"Not supported symbols"}` |
| depth with no symbol | 400 | `{"code":-100012,"msg":"Parameter symbol [String] missing!"}` |
| index on `NOPEUSDT` | 200 | `{"index":{},"edp":{}}` |
| fundingRate on `NOPE-SWAP-USDT` | 400 | `{"code":-1130,"msg":"Data sent for parameter 'symbol' is not valid."}` |
| unknown path `/quote/v1/nope` | 404 | `{"code":404,"msg":""}` |

## 7. Server time and clock offset

`GET /openapi/v1/time` returns `{"serverTime": <ms>}`.
Five reads gave an offset of 74 to 75 ms at a 242 to 253 ms round trip, server ahead of this host.

## 8. Recommended poller shape

No poller is recommended while the venue publishes no mark, because every route would be refused at open.
If the engine ever accepted an index-only venue, the shape would be:

- URL: `GET https://api.batonex.com/openapi/v1/contracts` once a second, one reply for every perpetual.
- Row: `index` from `indexPrice`, `mark` 0, `fundingRate` from `nextFundingRate`, `fundingIntervalHours` 8, `nextFundingAt` from `nextFundingRateTs` times 1,000.
- Skip: the three `INDEX*` contracts, which have no row in `/contract/v1/fundingRate`.
- Rate limit pause: none is announced by header, so one minute on 429 or 418.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | `https://github.com/batonex/openapi`, last pushed 2024-08-20 | the documentation set |
| S2 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/01-endpoint.md` and `04-contract.md` lines 98 to 250 | hosts, brokerInfo |
| S3 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/04-contract.md` lines 250 to 318 | the contracts call and its funding fields |
| S4 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/04-contract.md` lines 325 to 500 | index, edp, depth, merged depth |
| S5 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/02-general-information.md` lines 15 to 50 | 429, 418, ban durations |
| S6 | `https://support.batonex.com/hc/en-001/articles/35511944599321`, read through the Zendesk help centre API because the page itself answers 403 behind a Cloudflare challenge | trigger price wording |
| S7 | `https://www.batonex.com/en/guide/perpetual/intro`, rendered once with headless Chrome | funding schedule |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/batonex/rest-probe.mjs) modes `catalog`, `anchor`, `poll`, `book`, `errors` | every probed value |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/batonex/ws-probe.mjs) mode `anchor` | index formula names |
