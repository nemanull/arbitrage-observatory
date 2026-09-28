# Bitbase REST Profile

**Status:** Done.

**Retrieved:** 2026-09-23.

**Probed:** 2026-09-23 06:44 to 07:10 UTC and 2026-09-24 06:28 to 06:40 UTC, which are the evenings of 2026-09-22 and 2026-09-23 on the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, edge `YVR`).

This profile covers what a catalog, an anchor poller and a book resync would read from Bitbase (www.bitbase.com, no CCXT class) for its USDT-M and USDC-M perpetuals.
Bitbase publishes no API documentation, and none of the 309 help center articles documents an API, S3.
Every REST path of the web app answered this host with a Cloudflare managed challenge, so no REST call returned data.
This profile therefore records what was tried, what failed, and which socket topics carry the same fields.
The REST numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitbase/rest-probe.mjs) and the socket numbers from [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs), both run from `server/`.
The web app is built on the XT.com code base, see [`websocket.md`](./websocket.md) section 1.
So the paths tried are the web app's own catalog path and the XT futures paths that CCXT 4.5.68 names, with `https://fapi.xt.com/future/` replaced by `https://www.bitbase.com/fapi/`, S1.

## 1. Host and latency from this machine

### DNS

| host | DNS on 2026-09-24 | role |
|---|---|---|
| `www.bitbase.com` | CNAME `www.bitbase.com.cdn.cloudflare.net`, 104.18.4.232 and 104.18.5.232 | web site and every REST path the web app calls |
| `fstream.bitbase.com` | CNAME `fstream.bitbase.com.cdn.cloudflare.net`, the same two addresses | futures WebSocket |
| `stream.bitbase.com` | CNAME `stream.bitbase.com.cdn.cloudflare.net`, the same two addresses | spot WebSocket |
| `fapi.bitbase.com` | CNAME `fapi.bitbase.com.cdn.cloudflare.net`, with no address | the XT host name pattern, unusable |
| `sapi.bitbase.com` and `api.bitbase.com` | `ENOTFOUND` | none |
| `bitbase.com` and `static.bitbase.com` | four addresses each outside Cloudflare, which changed between runs | not requested |
| `support.bitbase.com` | CNAME `bitbase-support.zendesk.com`, 216.198.53.6 and 216.198.54.6 | help center, which answers this name with HTTP 403 and Cloudflare error 1034 |

The Cloudflare names resolved the same way in all three access runs, apart from the order of the two addresses, P1.
`https://www.bitbase.com/cdn-cgi/trace` read `colo=YVR`, `loc=CA`, `http=http/1.1`, `tls=TLSv1.3` and `warp=off` in all three runs, P1.

### What each path returned

| URL | purpose | reply in all three runs |
|---|---|---|
| `https://www.bitbase.com/` and `/rate` | home and fee page | 403 challenge |
| `https://www.bitbase.com/robots.txt` | crawler rules | 200, with `Disallow: /api/`, `/admin/`, `/user/`, `/search?` and `/404` |
| `https://www.bitbase.com/fapi/market/v1/public/symbol/list` | catalog, XT path | 403 challenge |
| `https://www.bitbase.com/fapi/market/v2/public/symbol/list?isPredict=true&isDelivery=true` | catalog, the web app's own call | 403 challenge |
| `https://www.bitbase.com/fapi/market/v1/public/q/tickers` | tickers, XT path | 403 challenge |
| `https://www.bitbase.com/fapi/market/v1/public/q/agg-tickers` | index and mark for every contract, XT path | 403 challenge |
| `https://www.bitbase.com/fapi/market/v1/public/q/depth?symbol=btc_usdt&level=50` | book, XT path | 403 challenge |
| `https://www.bitbase.com/fapi/market/v1/public/q/funding-rate?symbol=btc_usdt` | funding rate, interval and next settlement, XT path | 403 challenge |
| `https://www.bitbase.com/fapi/market/v1/public/time` and `/sapi/v4/public/time` | server time, XT paths | 403 challenge |
| `https://www.bitbase.com/sapi/v4/balance/public/currenciesV2` | spot currencies, a path the Wayback Machine captured, S8 | 403 challenge |
| `https://fstream.bitbase.com/ws/market`, a plain GET | the futures socket path without an upgrade | 403 with the 13 byte body `403 Forbidden` and no `cf-mitigated` header |
| `https://fapi.bitbase.com/future/market/v1/public/q/tickers` | the XT host pattern | `ENOTFOUND` |
| `https://support.bitbase.com/` | help center | 403, `error code: 1034` |
| `https://bitbase-support.zendesk.com/api/v2/help_center/en-us/categories.json` | help center API | 200 |

A challenge reply is HTTP 403 with `cf-mitigated: challenge`, `server: cloudflare`, `content-type: text/html; charset=UTF-8`, the page title `Just a moment...` and 5,641 to 6,012 bytes, and it carries no `Retry-After`, P1.
Passing it needs a browser that runs the challenge script, and the probes do not route around it.

### Latency

The challenge is served at the Cloudflare edge, so its times say nothing about the origin.
It came back in 12 to 125 ms cold and 20 to 125 ms warm over the eleven challenged URLs in three runs, P1.
The nearest origin readings come from the futures socket host.
A plain GET on `/ws/market` took 151 to 432 ms cold and 110 to 117 ms warm, a socket opened in 405 to 543 ms, and a text `ping` came back in 96 to 115 ms, see [`websocket.md`](./websocket.md) section 5.

### Terms

The Terms of Use forbid using "any automated system, bot, or scraper to extract data from the Platform, except with Bitbase's prior written consent via the API", S2.
They also define the API as "the application programming interface(s) made available by Bitbase to enable programmatic access to the Platform", S2.
A feed built on the web app's socket falls under that clause, so it would need Bitbase's consent or a documented API.

## 2. Catalog

### The instruments call

The web app's catalog call is `GET https://www.bitbase.com/fapi/market/v2/public/symbol/list?isPredict=true&isDelivery=true`.
It is the one URL under `/fapi/` that the Wayback Machine holds, captured on 2026-09-10 at 12:32 UTC, S8.
From this host it answers the challenge, section 1, so the archived reply is the only catalog readable here, S4 and P2.

| item | archived reply of 2026-09-10 |
|---|---|
| envelope | `{"returnCode": 0, "msgInfo", "error", "result": {"time", "version", "symbols"}}` |
| rows | 853, all `contractType` `PERPETUAL`, `productType` `perpetual` and `underlyingType` `U_BASED` |
| settlement | `quoteCoin` `usdt` on 818 rows and `usdc` on 35 |
| status fields | `tradeSwitch`, `openSwitch`, `isDisplay` and `isOpenApi` booleans, and `state` 0 on all 853 rows |
| tradable | 792 rows had `tradeSwitch` and `isDisplay` true, and 61 had both false |
| contract size | `contractSize`, a string in coins per contract, `"0.0001"` on `btc_usdt`, powers of ten from 0.0001 to 1,000,000, and `"164070"` on `soxs_usdt` |
| fees | `makerFee` and `takerFee`, see [`fees.md`](./fees.md) section 2 |
| precision | `pricePrecision`, `quantityPrecision`, `minStepPrice`, `minQty` and `minNotional` |
| fields | 67 per row |

`state` was 0 on the 61 rows that could not trade, so it does not mark a delisting.
`isOpenApi` was true on 845 rows, and its meaning is Not publicly specified.

### The live list

The socket gives the only live list.
`agg_tickers` on `wss://fstream.bitbase.com/ws/market` pushes one row per perpetual every 2.8 to 3.0 s, keyed by `s`, see section 3.

| reads | rows per frame | USDT-M | USDC-M |
|---|---|---:|---:|
| 2026-09-23, two catalog reads and two anchor reads, 44 frames | 795 in every frame | 761 | 34 |
| 2026-09-24, one anchor read and two catalog reads, 33 frames | 795, and 800 in 3 frames | 766 in the union | 34 |

In the 2026-09-24 anchor read the two 800 row frames came 30 s apart, at 17.7 s and 47.7 s, and five contracts appeared only in those, P5.
Which five is Not verified.
A list built from one frame can miss them, so a catalog takes the union of at least 30 s of frames.

The archive and the live list disagree, P2.
On 2026-09-24, 791 of 800 live contracts were in the archive and 9 were not, among them `gpro_usdt`, `standard_usdt`, `baton_usdt`, `cyph_usdt`, `allinu_usdt`, `musebook_usdt`, `agpu_usdt` and `moonshot_usdt`.
On 2026-09-23 the same count was 5.
62 archived contracts were no longer live, and 3 of those were tradable on 2026-09-10.
A catalog frozen on 2026-09-10 therefore lacks the contract size of every contract listed since, and the gap grows with each listing.

The archived contract sizes still hold for the contracts both lists share.
On a `tickers` row, turnover `v` over amount `a` times last price `c` estimates coins per contract.
For every live contract with a `tickers` row in 6 s, that estimate fell within a factor of two of the archived `contractSize`: 678 and 644 contracts on 2026-09-23, and 570 on 2026-09-24, with none disagreeing, P2.
On `agg_tickers` rows `v` repeats `a`, so only `tickers` carries the turnover.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no Bitbase class, and neither has the CCXT master branch, P3 and [`fees.md`](./fees.md) section 8.
The `xt` class serves XT.com, with the linear host `https://fapi.xt.com` at `server/node_modules/ccxt/js/src/xt.js` line 136 and the catalog path `future/market/v1/public/symbol/list` at line 187, S1.
Pointing it at Bitbase fails twice: `fapi.bitbase.com` has no address, and the same paths under `https://www.bitbase.com/fapi/` answer the challenge.
So CCXT supplies no `market.id`, `contractSize`, `linear` or `active` for Bitbase.
The fields a catalog needs map as follows.

| engine need | Bitbase field | note |
|---|---|---|
| raw market id | `symbol`, lower case `btc_usdt` | equal to `pair` on all 853 archived rows and to the socket's `data.s`, and `BTC_USDT` is refused on the socket |
| base and quote | `baseCoin` and `quoteCoin`, lower case | `tao_usdt` carries `spotCoin` `TON`, the one row whose `spotCoin` differs from `baseCoin` |
| `contractSize` | `contractSize`, coins per contract | archive only |
| `linear` | `underlyingType` `U_BASED` on every row | archive only |
| `active` | `tradeSwitch` and `isDisplay` | archive only, and live presence in `agg_tickers` is the practical test |

### Pairs listed twice and price scale

33 of the 34 tradable USDC-M contracts in the archive have a USDT-M twin on the same base, and only `ordi_usdc` has none, P2.
The engine's quote family, `quoteFamily.ts`, folds USDC into USDT and ranks the USDT contract first, so each twin would be ranked out.
The USDT-M list also holds stock, commodity and index contracts, such as `nbis_usdt`, `xau_usdt` and `soxl_usdt`, see [`fees.md`](./fees.md) section 3.
Whether a Bitbase ticker names a different asset or a different price scale than the same ticker on another venue was not surveyed.

## 3. Anchor

### The bulk calls

The XT reference has two anchor calls, S1.
`future/market/v1/public/q/agg-tickers` returns index and mark for every contract, at `xt.js` line 173.
`future/market/v1/public/q/funding-rate` returns one contract's rate with `collectionInternal` and `nextCollectionTime`, at line 176, and CCXT parses those two fields at lines 4614 and 4615.
On Bitbase both answer the challenge, section 1, so no REST call carries any `AnchorRow` column.

The socket carries index, mark and rate, and nothing carries the interval or the next settlement, P5.

| topic | index | mark | funding rate | interval | next settlement | cadence | size |
|---|---|---|---|---|---|---|---|
| `agg_tickers` | `i` | `m` | absent | absent | absent | every 2.8 to 3.0 s, every perpetual in one frame | 153,351 to 154,504 bytes per frame |
| `fund_rate@<symbol>` | | | `r` | absent | absent | once a minute | one topic per contract |
| `agg_ticker@<symbol>` | `i` | `m` | | | | about once a second | one topic per contract |
| `index_price@<symbol>` | `p` | | | | | about once a second, each value sent twice | one topic per contract |
| `mark_price@<symbol>` | | `p` | | | | on change | one topic per contract |

No topic without a symbol exists for mark or index, since `mark_price` alone answers `Invalid method`, see [`websocket.md`](./websocket.md) section 2.
On 2026-09-24 one socket carried a `fund_rate` topic for each of the 795 contracts in one `agg_tickers` frame, sent as 100 topics per subscribe frame.
All eight subscribe frames were acknowledged, none drew `Invalid method`, and all 795 contracts pushed at 06:34 and again at 06:35 UTC, P5.
At 06:35 the pushes came 7 to 987 ms after the minute began.

Every `agg_tickers` row carries its own `t`.
In the 75 s anchor read at least nine in ten contracts showed a new `t` in each of the 25 frames, and no contract kept one `t`, so `t` stamps the frame and not the last change of the row, P5.
Frames arrived 0.5 to 1.1 s after their rows' `t` in 32 of 33 frames on 2026-09-24, and no row of the anchor read was more than 0.87 s old.
The first frame of one catalog read was the exception: its newest row was 84,047,689 ms, about 23.3 h, old on arrival, and the next frame's newest row was 1.1 s old, P4.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `agg_tickers` row `s` | string, lower case `btc_usdt` | none |
| `index` | `i` | decimal string with 12 decimals, `"84183.938945900000"` | `Number()` |
| `mark` | `m` | decimal string at the contract's price precision, `"84152.8"` | `Number()` |
| `fundingRate` | `fund_rate@<s>` field `r` | decimal string, a fraction, so `"0.00005551"` is 0.005551 % | `Number()`, and whether it is per 8 h or per the contract's own interval is Not verified |
| `fundingIntervalHours` | none readable | the Futures Services Agreement names Funding Times "at each 8-hour interval", S5 | a constant 8 would be an assumption, and per contract intervals are Not verified |
| `nextFundingAt` | none readable | | none |
| `ts` | row `t` | integer Unix ms | none, and it restamps on every frame |

## 4. Anchor semantics

### Index

The Risk Disclosure Statement says the mark is "derived from the underlying index price of an asset across multiple reference exchanges", S6 section 5.3.
Neither the basket nor its weights are published, and no REST call is readable to look for a basket call.
The index is spelled with 12 decimals.
`index_price@<symbol>` sent each value twice, 19 to 32 ms apart at the median, P5.
A delisted contract settles at the average index over the 30 minutes before delisting, see [`fees.md`](./fees.md) section 7.

### Mark

The mark article gives the formula, S7.

```text
Mark Price = Current Index Price + Moving Average Basis
Basis = (Contract Best Bid + Contract Best Ask) ÷ 2 − Index Price at the same time
```

The basis is sampled every second, and the moving average takes the latest 30 samples with weights that halve every 15 s for major pairs and every 30 s for the rest, S7.
The article says "Bitbase recalculates and updates the mark price every second."
It publishes no clamp.

On the wire the mark moved more often than once a second on busy contracts.
`mark_price@btc_usdt` pushed 150 frames with 149 changes in 75 s, and 164 frames with 163 changes in 65 s, P5.
In one BTC sample the mark minus the index was -31.1 while the current basis was -32.9, which fits a smoothed basis.

| reading over every perpetual in `agg_tickers` | 2026-09-23 06:51 UTC | 2026-09-23 07:04 UTC | 2026-09-24 06:33 UTC |
|---|---|---|---|
| median of the magnitude of mark minus index, over index | 686 ppm | 635 ppm | 663 ppm |
| p90 | 2,939 ppm | 3,112 ppm | 2,564 ppm |
| p99 | 12,624 ppm | 9,693 ppm | 16,929 ppm |
| largest | 40,217 ppm, `toad_usdt` | 31,702 ppm, `baton_usdt` | 62,522 ppm, `one_usdt` |
| contracts over 1 % | 9 | 7 | 13 |
| mark equal to the last price `c` | 182 of 795 | 157 of 795 | 265 of 800 |
| mark equal to the mid of `bp` and `ap` | 20 | 23 | 26 |

A mark 6.25 % above its index was read, so any clamp is at least that wide.

### Funding

The formula, the cap and the floor are Not publicly specified, see [`fees.md`](./fees.md) section 6.
The Futures Services Agreement sets Funding Times "at each 8-hour interval or as may be amended or varied by Bitbase from time to time", and adds that "the actual Funding Times may be subject to a deviation of up to 60 seconds", S5.
No settlement was captured, because the probes never wait for one.

`fund_rate` pushes one rate per contract once a minute.
At 06:35 UTC on 2026-09-24 the 795 contracts read as follows, P5.

| reading | value |
|---|---|
| positive, negative, zero | 594, 63 and 138 |
| exactly 0.00005 | 340 |
| exactly 0.0001 | 75 |
| exactly 0.0002 | 11 |
| median and p90 of the magnitude | 0.00005 and 0.0002075 |
| largest magnitude | -0.0070758 on `cvc_usdt`, then -0.00448289 on `one_usdt` and -0.00441873 on `steem_usdt` |

The clusters at 0.00005 and 0.0001 look like default rates, which is an inference, and whether 0.00005 marks contracts on a shorter interval is Not verified.
A rate of -0.0070758 shows that any cap is at least 0.71 % per settlement.
The rate moved between two minute pushes on BTC, ETH and DOGE on 2026-09-24, and on BTC and ETH on 2026-09-23.
That fits a predicted rate for the coming settlement rather than the last settled one, and which of the two it is remains Not verified.

### How often each number changed

| number | topic | `btc_usdt` | `eth_usdt` | `doge_usdt` | read |
|---|---|---|---|---|---|
| index | `index_price` | 72 changes in 150 frames | 66 in 150 | 58 in 150 | 75 s, 2026-09-24 |
| index | `index_price` | 64 in 130 | 64 in 130 | 59 in 130 | 65 s, 2026-09-23 |
| mark | `mark_price` | 149 in 150 | 86 in 87 | 40 in 41 | 75 s, 2026-09-24 |
| mark | `mark_price` | 163 in 164 | 141 in 142 | 69 in 70 | 65 s, 2026-09-23 |
| mark | `agg_ticker` | 64 in 77 | 47 in 77 | 31 in 77 | 75 s, 2026-09-24 |
| rate | `fund_rate` | 1 in 2 | 1 in 2 | 1 in 2 | 75 s, 2026-09-24 |
| rate | `fund_rate` | 1 in 2 | 1 in 2 | 0 in 2 | 65 s, 2026-09-23 |

Over 25 `agg_tickers` frames in 75 s, the median contract showed 11 distinct index values and 4 distinct mark values, P5.
17 contracts showed one index value and 44 showed one mark value in every frame that carried them.

## 5. REST book snapshot

The XT book path is `future/market/v1/public/q/depth`, at `xt.js` line 175, S1.
On Bitbase, `https://www.bitbase.com/fapi/market/v1/public/q/depth?symbol=btc_usdt&level=50` answers the challenge, so no REST book, depth limit, level order or cache could be read, P1.
The socket topic `depth@<symbol>,50` replaces it.
It sends a full 50 level book with its update `id` once a second, bids descending and asks ascending, and a feed seeds and reseeds from it, see [`websocket.md`](./websocket.md) section 4.
On 2026-09-24 it gave 59 or 60 snapshots in 60 s on each of four books, each with 50 levels a side, P6.
The level must be 5, 10, 20 or 50, and 30 and 100 answer `Invalid method`, P6.

## 6. Rate limits and errors

| item | value |
|---|---|
| published REST limits | none, since no API documentation is published, S3 |
| XT reference | CCXT's `xt` class sets `rateLimit` to 100 ms and a cost of 1 on each public futures market path, `xt.js` lines 28 and 173 to 211, S1, which describe XT.com and not Bitbase |
| status codes seen | 403 challenge on every REST path, 403 with error 1034 on `support.bitbase.com`, and `ENOTFOUND` on `fapi.bitbase.com` |
| `Retry-After` | absent on every reply |
| 429 or a venue error body | never seen, since no request reached a Bitbase REST handler |
| socket errors | bare text frames `Invalid method` and `Invalid parameter`, see [`websocket.md`](./websocket.md) section 4 |

The challenge answered the first request of every run, so it is an access rule and not a rate limit.

## 7. Server time and clock offset

`https://www.bitbase.com/fapi/market/v1/public/time` and `https://www.bitbase.com/sapi/v4/public/time`, the XT style time paths, answer the challenge, section 1.
The socket gives a bound instead.
On 2026-09-24 the smallest delay from a `mark_price` frame's `t` to its arrival was 66 ms over 278 frames, while a text `ping` came back in 97 to 98 ms on the same socket, P5.
The local clock was NTP synchronised, per `timedatectl`.
So the venue clock trails the local clock by at most 66 ms, and by at most about 17 ms if the one-way trip is half the round trip, which is an inference.
How far the venue clock could run ahead is not bounded by this reading.
Book frames arrive 242 to 300 ms and index frames 407 to 669 ms after their `t` at the median, so a feed stamps receive time on arrival, see [`websocket.md`](./websocket.md) section 5.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

No REST poller is possible from this host, and none is recommended.
Three things stand in the way.

1. Catalog: contract sizes exist only in an archive of 2026-09-10 that lacks the 9 contracts listed since, and the socket carries symbols without sizes.
   Without a size the engine cannot turn book sizes into coins, see [`websocket.md`](./websocket.md) section 4.
2. Anchor: `fundingIntervalHours` and `nextFundingAt` have no readable source.
3. Terms: scraping without Bitbase's consent is forbidden, section 1, and the API that would carry the consent is not documented in public.

If Bitbase grants API access, or its REST opens to this host, the XT paths of section 1 are the first to try, since the web app and the XT code base share them.
Until then, a socket anchor is the only shape the wire supports, and it looks like this.

| item | shape | reason |
|---|---|---|
| URL | `wss://fstream.bitbase.com/ws/market` | one socket carries both families |
| index and mark | `agg_tickers`, one topic | every perpetual in one frame every 2.8 to 3.0 s |
| funding rate | `fund_rate@<rawMarketId>` for every contract seen in `agg_tickers`, 100 topics per subscribe frame | 795 topics on one socket all pushed each minute |
| interval and next settlement | none | no readable source |
| row time | stamp on arrival, and drop a frame whose newest `t` is more than 5 s old | one first frame arrived 23.3 h old |
| contract list | the union of `agg_tickers` over at least 30 s | five contracts appeared in only 2 of 25 frames |
| topics | build every topic from `agg_tickers` symbols | an unknown symbol drops the rest of its subscribe frame, see [`websocket.md`](./websocket.md) section 4 |
| keepalive | text `ping` every 15 s | the server drops a socket that has sent nothing for 31.8 to 42.0 s |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CCXT 4.5.68 `xt.js` | `server/node_modules/ccxt/js/src/xt.js` | 2026-09-23 | CCXT, XT.com | XT hosts at lines 135 to 137, paths at lines 173 to 211, `rateLimit` at line 28, funding fields at lines 4614 and 4615 |
| S2 | Terms Of Use, updated 2026-07-22 | https://bitbase-support.zendesk.com/hc/en-us/articles/5181225937566-Terms-Of-Use | 2026-09-23 | Bitbase Corp., Panama | the scraper clause and the API definition |
| S3 | Bitbase help center article list, 309 articles | https://bitbase-support.zendesk.com/api/v2/help_center/en-us/articles.json | 2026-09-23 | Bitbase | no article documents an API |
| S4 | Wayback Machine copy of the web app's symbol list, 2026-09-10 | https://web.archive.org/web/20260910123242id_/https://www.bitbase.com/fapi/market/v2/public/symbol/list?isPredict=true&isDelivery=true | 2026-09-23 | Bitbase | the archived catalog, section 2 |
| S5 | Futures Services Agreement, updated 2026-08-02 | https://bitbase-support.zendesk.com/hc/en-us/articles/5199905354910-Futures-Services-Agreement | 2026-09-23 | Bitbase | Funding Times every 8 h, the 60 s deviation |
| S6 | Risk Disclosure Statement, updated 2026-09-12 | https://bitbase-support.zendesk.com/hc/en-us/articles/5205541097374-Risk-Disclosure-Statement | 2026-09-23 | Bitbase | index across reference exchanges |
| S7 | Explanation of Bitbase futures Mark Price, 2026-08-25 | https://bitbase-support.zendesk.com/hc/en-us/articles/5605761537054-Explanation-of-Bitbase-futures-Mark-Price | 2026-09-23 | Bitbase | mark formula, sampling and half-lives |
| S8 | Wayback Machine CDX listings of `www.bitbase.com/fapi/*` and `www.bitbase.com/sapi/*` | https://web.archive.org/cdx/search/cdx?url=www.bitbase.com/fapi/*&fl=original,timestamp,statuscode | 2026-09-23 | Wayback Machine | one capture under each path, both on 2026-09-10 |
| P1 | `rest-probe.mjs access`, at 2026-09-23 07:01 and 07:09 UTC and 2026-09-24 06:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbase/rest-probe.mjs) | 2026-09-23 | this host | sections 1, 5, 6 and 7 |
| P2 | `rest-probe.mjs archive`, at 2026-09-23 07:02 and 07:09 UTC and 2026-09-24 06:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbase/rest-probe.mjs) | 2026-09-23 | this host | section 2 |
| P3 | `rest-probe.mjs ccxt`, at 2026-09-23 07:01 and 07:10 UTC and 2026-09-24 06:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbase/rest-probe.mjs) | 2026-09-23 | this host | section 2 |
| P4 | `ws-probe.mjs catalog`, at 2026-09-23 06:44 and 07:03 UTC and 2026-09-24 06:28 and 06:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | sections 2 and 3 |
| P5 | `ws-probe.mjs anchor`, 45 s at 2026-09-23 06:51 UTC, 65 s at 07:04 UTC, and 75 s with a funding topic for every perpetual at 2026-09-24 06:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | sections 2, 3, 4 and 7 |
| P6 | `ws-probe.mjs book` and `errors`, at 2026-09-24 06:31 and 06:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
