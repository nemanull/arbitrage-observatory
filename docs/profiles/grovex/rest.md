# GroveX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:06 to 03:37 UTC, from the development host near Seattle.

This profile covers the public spot REST API of GroveX at `https://openapi.grovex.io`, since GroveX lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/grovex/rest-probe.mjs), which ran each mode twice, unless a row names a document.
The official API document is one Markdown file on GitHub, S1.

## 1. Host and latency from this machine

| host | addresses on 2026-09-23 UTC | role |
|---|---|---|
| `openapi.grovex.io` | 104.26.2.168, 104.26.3.168, 172.67.75.251, and 2606:4700:20::681a:2a8, ::681a:3a8, ::ac43:4bfb | the documented REST API, behind Cloudflare |
| `ws.grovex.io` | the same six addresses | the WebSocket, see [`websocket.md`](./websocket.md) |
| `webapi.grovex.io` | the same six addresses | the web app's own API |
| `www.grovex.io` | 216.150.1.193 and 216.150.16.193, then 216.150.1.65 and 216.150.16.65 | the web site, on Vercel |
| `futuresopenapi.grovex.io` | no address, `ENOTFOUND` | a futures host named only on expired certificates, see [`fees.md`](./fees.md) section 3 |

Every reply whose headers the probe logged carried `server: cloudflare` and `cf-cache-status: DYNAMIC`, and the logged `cf-ray` values end in `SEA`, so the edge is Cloudflare's Seattle site and no reply is cached at the edge.

| request | run 1, 03:13 UTC | run 2, 03:34 UTC |
|---|---|---|
| cold `GET /open/api/common/symbols`, new TLS each, 5 requests | min 235.2, median 276.0, max 737.5 ms | min 225.5, median 678.7, max 787.3 ms |
| warm, keep-alive, 10 requests | min 195.5, median 198.1, max 458.4 ms | min 181.1, median 185.6, max 462.0 ms |

The origin's location was not determined.
Two hints point to East Asia: trade times in the socket's `ds` field are written eight hours ahead of UTC, and the fee JSON's asset icons are served from `grovex-oss.oss-cn-hongkong.aliyuncs.com`, S2.

## 2. Catalog

### The instruments call

`GET /open/api/common/symbols`, no parameters, public, S1.

| item | value |
|---|---|
| reply | `{"code":"0","msg":"suc","data":[…],"message":null,"success":true}`, 55,317 bytes, 184.5 to 300.8 ms |
| rows | 433 in both runs |
| fields | `symbol`, `count_coin`, `amount_precision`, `base_coin`, `limit_volume_min`, `price_precision` |
| status values | none in this reply. `isShow` is 0 on 6 rows of the bulk ticker: `hoskyusdt`, `audusdt`, `gatorusdt`, `blurusdt`, `ltcusdt`, `usdcusdt` |
| quote assets | 387 USDT, 16 USDC, 11 FDUSD, 11 USD1, 3 MUSDT, 2 AUD, 2 ETH, 1 SOL |
| example | `{"symbol":"btcusdt","count_coin":"USDT","amount_precision":5,"base_coin":"BTC","limit_volume_min":"0.00001","price_precision":2}` |

There is no perpetual in the catalog, and no call that lists one.

### How the engine's catalog would map it

The engine's catalog is CCXT `loadMarkets` filtered to active swaps, at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 79.
GroveX has no CCXT class and no swap, so it contributes no market, see [`fees.md`](./fees.md) section 8.
For the record, the symbol would map cleanly.
The REST `symbol` `btcusdt` is exactly the symbol inside the socket channel `market_btcusdt_depth_step0`.
Sizes are base coin on both, so a size multiplier would be 1.
An uppercase symbol is refused with code `"2"` on REST and ignored in silence on the socket.

Sixteen bases are listed against more than one member of the USD family, among them BTC, ETH, SOL and BNB against USDT, USDC, USD1 and FDUSD.
A spot study would pick one per base, as the quote family does for perpetuals.

### The bulk tickers

| call | rows | reply | time | notes |
|---|---|---|---|---|
| `GET /open/api/get_allticker` | 433, 431 with `last`, 374 or 375 with both `buy` and `sell` | about 89.9 KB | 5,590 to 9,460 ms over 6 reads | `buy`, `sell` and `last` are JSON numbers, the other fields strings, S1 |
| `GET /pub/tickers` | 431 | about 69.6 KB | 1,302 to 2,130 ms over 3 reads | the CoinGecko integration call, S3. `btcusdt` `last_price` read 86461.69 at 03:09 and 03:14 UTC, and 86650.65 at 03:35 UTC, the price of a trade printed at 03:29:10 |
| `GET /open/api/get_ticker?symbol=btcusdt` | 1 | 0.2 KB | 183 to 330 ms over 12 reads | `buy` and `sell` equal the socket's best bid and ask, see [`websocket.md`](./websocket.md) section 4 |

The bulk ticker takes five to ten seconds to answer, so it cannot feed a one second poll.

## 3. Anchor

GroveX publishes no index, no mark price and no funding rate, because it lists no perpetual.
No call returns any `AnchorRow` column.

It does publish one number that behaves like an outside reference.
For a pair Binance also lists, the REST book of `market_dept` and `newOrderBook` is a copy of Binance's spot book taken every 420 s, see section 5.
That copy is not an index, it is up to seven minutes old, and it is not the book GroveX trades on, so it is no anchor.

No anchor poller is recommended.

## 4. Anchor semantics

There is no index, mark or funding formula to record.
This section records instead how often the published REST numbers change, because a spot study would meet them.

| number | how often it changed | evidence |
|---|---|---|
| `market_dept` book of `btcusdt` | once every 420 s: `lastUpdateId` read 1790132865208, 1790133285214, 1790133705209, 1790134125212 and 1790134545208, which are 03:07:45.208, 03:14:45.214, 03:21:45.209, 03:28:45.212 and 03:35:45.208 UTC | both runs of `book` and `poll`, and one extra read at 03:23 UTC |
| `market_dept` book of `ethusdt` | the same cycle, 0.76 to 1.02 s after `btcusdt` | `lastUpdateId` 1790132866224, 1790133285970, 1790134125975 and 1790134545981 |
| its distance from Binance | 0 ppm soon after a refresh, then drifting: over 60 s of one second polls the `btcusdt` mid was a median 220 and 89 ppm and at most 399 and 695 ppm from Binance's mid, and `ethusdt` a median 311 and 61 and at most 478 and 434 ppm | `poll` at 03:15 and 03:35 UTC |
| its distance at the end of a cycle | about 400 s after a refresh, the `xrpusdt` copy's bid sat 2,026 ppm below Binance's mid and the `dogeusdt` copy's bid 4,034 ppm above it | `mirror` at 03:34 UTC |
| `get_ticker` `time` | a whole second that steps about every 11 s: five reads 2.4 s apart returned 1790133205000 four times, then 1790133216000 | `latency` at 03:13 and 03:34 UTC |
| `get_ticker` `last` | tracks Binance: 0 ppm from Binance's mid on `btcusdt` in all three `mirror` runs, and 2 to 729 ppm in absolute value on the other four pairs | `mirror` at 03:15, 03:26 and 03:34 UTC |

The poll of `market_dept` saw 0 touch changes on either pair in 30 polls in the first run, and 1 in the second, which was the 03:35:45 refresh.
The funding settlement instant does not exist here, so nothing was waited for.

## 5. REST book snapshot

| call | levels per side | keys | reply | notes |
|---|---|---|---|---|
| `GET /open/api/market_dept?symbol=btcusdt&type=step0` | 100 | `lastUpdateId`, `asks`, `bids`, `time` | 6,944 bytes, 174 to 1,200 ms | the Binance copy. `lastUpdateId` is the copy's time in ms, `time` is the reply's |
| `type=step1`, `step2`, `step0time` | 100 | same | same | the same copy with the same prices, no merging |
| `type` missing or `step9` | 100 | same | same | falls back to the same book |
| `GET /pub/newOrderBook?symbol=btcusdt&depth=0`, `100`, `200` | 100 at every depth | `asks`, `bids` | 6,899 bytes, 174 to 178 ms | the same copy. The CoinGecko document says `depth=100` means 50 per side, S3 |
| `market_dept?symbol=grxusdt&type=step0` | 23 bids and 30 asks, then 20 and 20 | `asks`, `bids`, `time` | 1,118 to 1,435 bytes | GRX is not on Binance, so this is GroveX's own book, and its touch equalled `get_ticker` `buy` and `sell` in both `mirror` runs that checked |

The copy's touch can equal Binance's to the cent.
At 03:15:05 UTC, 20 s after a refresh, the `btcusdt` copy read `86546.56` and `86546.57`, and Binance's best bid and ask read the same two prices at the same instant, `mirror` run 1.
The copy never matched GroveX's own best bid and ask on any of the 15 socket comparisons or 15 `mirror` rows of Binance pairs, so a REST book read of a Binance pair shows Binance, not GroveX.
The CoinGecko integration document names `/pub/newOrderBook` as GroveX's order book call, S3, so any depth or spread figure built from it describes that copy.

Level order is descending bids and ascending asks on every call.
Prices and sizes are JSON numbers, written with trailing zeros such as `86444.01000000`.
Nothing is cached at the Cloudflare edge, and the copy is frozen at the origin between refreshes, so four reads one second apart returned the same `lastUpdateId` in both runs.

## 6. Rate limits and errors

The document publishes 6 requests per 2 s per IP for public calls and 6 per 2 s per user for private calls, and says an excess returns HTTP 429, S1.
No reply carried a rate limit header, a `Retry-After` or a weight.
The probe sent at most two GroveX requests in any 1.2 s, under half the published limit, and was never refused, so the 429 shape and its pause were not observed.

| request | HTTP | body |
|---|---|---|
| unknown symbol, `market_dept?symbol=nopeusdt` | 200 | `{"code":"100004","msg":null,"data":null,"message":null,"success":false}` |
| underscore symbol, `BTC_USDT` | 200 | code `"100004"`, same shape |
| uppercase symbol, `BTCUSDT` | 200 | code `"2"`, same shape |
| unknown symbol, `get_ticker?symbol=nopeusdt` | 200 | code `"1"`, same shape |
| unknown path, `/open/api/nope` | 404 | `{"timestamp":1790134531360,"status":404,"error":"Not Found","message":"No message available","path":"/open/api/nope"}` |

An error arrives with HTTP 200 and a non-zero string `code`, so a client must check `code` and not the status.

## 7. Server time and clock offset

No time call is documented, and `/sapi/v1/time`, `/sapi/v1/ping` and `/open/api/common/timestamp` all answer 404.
The 404 body carries the server's `timestamp` in ms, and against the midpoint of each request it read +7 to +9 ms in run 1 and +5 to +61 ms in run 2, with round trips of 172 to 282 ms.
So this host's clock and GroveX's agree to within the round trip.
The `get_ticker` `time` field is no clock, because it is cached for about 11 s, section 4.

## 8. Recommended poller shape

None.
GroveX has no perpetual, no index, no mark and no funding, so there is nothing for an `AnchorPoller` to read.

| item | recommendation | reason |
|---|---|---|
| anchor poller | do not build one | no anchor data exists |
| REST book | do not read `market_dept` or `newOrderBook` for a Binance pair as GroveX's book | it is a Binance copy up to 420 s old |
| bulk ticker | do not poll `get_allticker` | it takes 5.6 to 9.5 s |
| spot study | read the book from the socket, see [`websocket.md`](./websocket.md) section 8 | the socket book is the one `get_ticker` `buy` and `sell` describe |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GroveX official API document | https://github.com/GroveXchange/grovexfile/blob/main/api_doc_en.md | 2026-09-23 UTC | GroveX, global | base URL, public calls, depth types, rate limits, sections 2, 5 and 6 |
| S2 | GroveX public fee JSON | https://www.grovex.io/api/fees/public | 2026-09-23 UTC | GroveX, global | asset icon host, section 1 |
| S3 | GroveX CoinGecko integration document | https://github.com/GroveXchange/grovexfile/blob/main/CoinGecko%20API%20Integration%20for%20GroveX_en.md | 2026-09-23 UTC | GroveX, global | `/pub/tickers` and `/pub/newOrderBook`, sections 2 and 5 |
| P1 | `rest-probe.mjs latency`, `catalog`, `book`, `mirror` and `poll`, run 1 at 03:13 to 03:16 UTC, `mirror` again at 03:26 UTC, and one-off curl reads at 03:07 to 03:23 UTC of `/sapi/v1/ping`, `/open/api/common/timestamp`, `/pub/tickers` and `market_dept` | [`rest-probe.mjs`](../../../scripts/probes/venues/grovex/rest-probe.mjs) | 2026-09-23 | this host | sections 1 to 7, the first readings |
| P2 | `rest-probe.mjs all`, run 2 at 03:34 to 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/grovex/rest-probe.mjs) | 2026-09-23 | this host | sections 1 to 7, the second readings |
| P3 | `ws-probe.mjs book`, two runs, for the socket comparisons | [`ws-probe.mjs`](../../../scripts/probes/venues/grovex/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
