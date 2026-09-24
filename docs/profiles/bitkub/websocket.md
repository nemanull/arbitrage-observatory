# Bitkub WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 01:26 to 01:55 UTC, from the development host near Seattle.

This profile covers the public WebSocket of Bitkub Exchange, which carries spot markets only, because Bitkub lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs), and the capture is quoted beside the documented value.
Run 1 is the set of modes run from 01:41 to 01:48 UTC, run 2 is the rerun from 01:48 to 01:55 UTC.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation is the public `websocket-public.md` of the official GitHub repository, S1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, THB and USDT pairs, public | `wss://api.bitkub.com/websocket-api/<streamName>`, S1 | opens in 433 to 665 ms over all runs, one host for every pair |
| spot, private | `wss://stream.bitkub.com/v3/private`, S2 | not probed |
| perpetuals, futures, options | none | none exist, see [`fees.md`](./fees.md) section 3 |

The stream is chosen by the URL path, and there is no subscribe frame.
`api.bitkub.com` is a CNAME to `api.bitkub.com.eo.dnse5.com` and resolved to `43.174.224.42` and `43.174.225.42`, see [`rest.md`](./rest.md) section 1.
The upgrade reply carries `server: nginx`, `eo-log-uuid` and `eo-cache-status`, the header names of a CDN in front of the origin.

## 2. Channel matrix for public market data

| stream path | payload | depth and speed | probed |
|---|---|---|---|
| `orderbook/<pairing_id>`, documented as `orderbook.<symbol-id>` | events `tradeschanged`, `bidschanged`, `askschanged`, `depthchanged`, `ticker`, `global.ticker` | `depthchanged` is the whole aggregated book, up to 100 levels per side on THB pairs and 50 on USDT broker pairs, pushed when orders change | the dotted form answers HTTP 200 with an empty body and no upgrade. The slash form works, one pair per socket |
| `market.ticker.<quote>_<base>`, for example `market.ticker.thb_btc` | best bid and ask with sizes, last, 24 h stats | "Re-calculated on every order creation, cancellation, and fulfillment", S1 | 9 to 12 frames in 8 s on `thb_btc`, 122 and 124 frames in 120 s on the quietest pair |
| `market.trade.<quote>_<base>` | one trade per frame | documented as "permanently closed" on 2026-05-18, S1 | still upgrades, and delivered 1 trade frame in one of three 8 s holds on `thb_btc` |
| mark, index, funding | none | | spot only |

`global.ticker` is not a stream of its own.
Every `orderbook/<id>` socket receives it for every pair of the exchange, at 198 to 208 frames per second, and it made up 98.5 to 98.7 % of the frames on the fanout sockets.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, the stream named in the path, S1 | one host for THB and USDT pairs |
| subscribe frame shape | "Connect directly to the stream URL. No subscribe/unsubscribe events needed.", S1 | confirmed. Several `market.*` streams join with commas in one path. `orderbook/1,orderbook/2` answers HTTP 404 `404 page not found`, so an order book socket carries one pair |
| unknown symbol expectation | "Public streams do not return structured error codes. Connection failures result in WebSocket disconnect.", S1 | `market.ticker.thb_nope` upgrades and stays silent for 8 s. `orderbook/99999` upgrades and sent only `global.ticker` in run 1 and nothing in 8 s in run 2. `orderbook/abc`, `orderbook.1` and `market.nope.thb_btc` answer HTTP 200 with an empty body |
| chunk unit and budget | Not publicly specified | the URL is the budget: 366 ticker streams in an 8,359 character URL were refused with HTTP 414 `Request-URI Too Large`, and 183 streams in 4,149 and 4,244 character URLs were accepted in both runs |
| keepalive mechanism | "No explicit ping required. Reconnect on disconnect.", S1 | `market.ticker` sockets get a protocol ping every 5 s, 23 in 120 s in both runs. `orderbook` sockets got no ping in 120 s |
| connection lifetime and maintenance notice | Not publicly specified | no socket closed on its own within 120 s. No maintenance notice exists on the socket, and REST `/api/status` is the only status source, see [`rest.md`](./rest.md) section 6 |
| handshake and operation rate limits | Not publicly specified | 8 order book sockets opened at once from this host were all accepted in both runs, and 13 sockets opened at once in the streams mode were all answered |
| public market data authentication | none since 2022-08-31, S1 | none |
| message parse and routing | `{data, event, pairing_id}` on the order book stream, `{stream, id, ...}` on the ticker stream, S1 | as documented. `global.ticker` has no `pairing_id` and routes on `data.id` |
| subscribe acknowledgement shape | none | none. The first frame on an order book socket is `tradeschanged`, 0 to 1 ms after the open event |
| symbol identifier format | `<serviceName>.<serviceType>.<symbol>` case-insensitive, and the numeric id for the order book, S1 | `market.ticker.thb_btc` and `market.ticker.THB_BTC` deliver, `market.ticker.btc_thb` upgrades and stays silent. REST uses `BTC_THB`, so the ticker stream reverses the pair and the order book uses `pairing_id` from `/api/v3/market/symbols` |
| number representation | floats | JSON numbers on the order book and ticker streams, `global.ticker` numbers on the wire although S1 shows strings. Small prices arrive in exponent form, `"highestBid":1.3886e-8` in a run 1 `global.ticker` capture |
| timestamp representation | trade `data[0][0]` in seconds, S1 | `tradeschanged` trade rows carry Unix seconds. `depthchanged`, `bidschanged`, `askschanged`, `ticker` and `global.ticker` carry no time at all. `market.trade` carries `ts` in ms |
| size unit | `base_volume` "Amount in base currency", S1 | base asset. `quote_volume` equals `price` times `base_volume` on 9,600 of 9,600 BTC_THB levels checked in run 1 and 4,800 of 4,800 in run 2 |
| sequence semantics | none documented | no sequence, update id or checksum on any event |
| idle repeat behaviour | not documented | `depthchanged` comes in pairs a few ms apart, and 18 of 48 and 6 of 24 BTC_THB frames repeated the previous book exactly |

## 4. The book channel in detail

`orderbook/<pairing_id>` and its `depthchanged` event is the only streamed depth, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

No `depthchanged` is sent on connect.
The first frame is `tradeschanged`, whose `data[1]` and `data[2]` hold the top 30 bid orders and the top 30 ask orders as single orders, not levels.
The first `depthchanged` for BTC_THB arrived 4,327 and 4,763 ms after the socket was created in the two `sync` runs, so a feed has no book until the pair next changes.
On a quiet pair the wait is longer: the gap between two `depthchanged` frames reached 10,822 ms on GRAM_THB in run 2.
A feed would need the REST depth call to seed a book, see [`rest.md`](./rest.md) section 5.

### Delta semantics

There are no deltas.
Every `depthchanged` is a full replacement of the aggregated book: 100 bids and 100 asks on BTC_THB in every frame of both runs, and every level a thin pair has, 22 to 24 bids and 67 to 71 asks on BICO_THB in run 1 and 12 to 13 bids and 55 to 56 asks on GRAM_THB in run 2.
`bidschanged` and `askschanged` are the top 30 single orders of one side, `[volume, price, amount, 0, is_new, is_owner]`, with repeated prices: 113 repeated prices in 24 BTC_THB side frames of run 2.

### Sequence and gap rule

No frame carries a sequence, an id or a time, so a missed frame cannot be detected.
The book the socket shows is also incomplete in time.
In the `sync` mode a REST depth read every 500 ms for 30 s saw 26 and 32 distinct top 10 books on BTC_THB, while the socket sent 24 and 20 `depthchanged` frames holding 11 and 8 distinct books.
Only 10 of the 26 and 8 of the 32 REST books ever appeared on the socket, and every socket book but one was also seen by REST.
So `depthchanged` fires on some book changes and not on others, and a feed built on it holds a stale book between frames without knowing it.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `depthchanged` | descending, strictly, in every frame of both runs on BTC_THB, the quiet pair and BTC_USDT | ascending, strictly, in every frame |
| `bidschanged`, `askschanged` | orders by price, best first, equal prices repeated | same |
| REST `/api/v3/market/depth` | descending | ascending |

### Size unit

`base_volume` is in the base asset and `quote_volume` in the quote asset, on every level checked, see section 3.
There is no CCXT class, so no `contractSize` to compare with.
The engine's size multiplier would be 1.

### The touch against the ticker

The `ticker` event on the same socket disagreed with the latest `depthchanged` touch about half the time in run 2: 19 of 38 ticker frames matched on BTC_THB, 20 of 34 on GRAM_THB and 23 of 41 on BTC_USDT.
One mismatch on BTC_THB read ticker bid 2,856,054.43 against book bid 2,856,196.51 with the same ask.
Neither frame carries a time, so which one is older is Not verified.

### One-sided and empty books

`LTC_THB`, a stopped pair, sent no `tradeschanged`, no side event and no `depthchanged` in 60 s in either run, only `global.ticker`.
The USDT broker pair `BTC_USDT` sent `depthchanged` with 50 levels per side, but its `bidschanged` and `askschanged` arrays were always empty, and its first `tradeschanged` held empty order arrays.
No active pair was one-sided in the bulk REST ticker, see [`rest.md`](./rest.md) section 2.

### Idle repeats

`depthchanged` follows each `bidschanged` and each `askschanged`, so it usually comes twice within 20 ms: 17 of 47 and 10 of 23 BTC_THB gaps were under 20 ms.
18 of 48 and 6 of 24 BTC_THB frames were identical to the previous frame, and 25 of 48 and 8 of 22 on the quiet pair.
The quietest active pair, BLUR_THB with 87.98 THB of 24 h volume, still sent 59 and 64 `depthchanged` frames in 120 s, with the longest gap between its own events 4,673 and 3,088 ms.

### Unknown, closed and wrong-form streams

| request | reply | then |
|---|---|---|
| `orderbook.1`, the documented form | HTTP 200, empty body, no upgrade | |
| `orderbook/abc` | HTTP 200, empty body | |
| `orderbook/99999` | upgrade | only `global.ticker`, 1,510 and 1,499 frames in the two 8 s holds of run 1, and nothing in 8 s in run 2 |
| `orderbook/9`, stopped `LTC_THB` | upgrade | only `global.ticker` for 60 s |
| `orderbook/1,orderbook/2` | HTTP 404, `404 page not found` | |
| empty path | HTTP 404, `404 page not found` | |
| `market.ticker.thb_nope` | upgrade | nothing in 8 s |
| `market.ticker.btc_thb`, base first | upgrade | nothing in 8 s |
| `market.nope.thb_btc` | HTTP 200, empty body | |
| 366 ticker streams in one URL | HTTP 414 `Request-URI Too Large` | |

Because a wrong stream either upgrades and stays silent or fails the upgrade with a 200, a feed has to treat a socket with no own event as unserved.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | "No explicit ping required.", S1 | order book sockets got no protocol ping and no application ping in 60 s and 120 s holds. Ticker sockets got a protocol ping every 5 s, the first at 5,482 and 5,497 ms |
| silence the server tolerates | Not publicly specified | a client that never sent a frame kept an order book socket for 120 s in both runs, with automatic pongs and with pongs turned off, and a ticker socket for 120 s with automatic pongs |
| forced disconnect | Not publicly specified | none within 120 s |
| maintenance notice | none on the socket | REST `/api/status` answered `ok` for both endpoint groups, see [`rest.md`](./rest.md) section 6 |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in both runs |
| handshake | | 433 to 665 ms to open from this host over all runs |
| subscription limits | Not publicly specified | one order book per socket. The ticker path is capped by URL length, see section 3 |
| throughput, one order book socket | | 39 to 55 KB per second, almost all of it `global.ticker` |
| throughput, 8 order book sockets for the 8 busiest THB pairs | | 1,541 and 1,598 frames per second, 398 and 424 KB per second, 98.7 and 98.5 % `global.ticker`, 5.33 and 6.13 `depthchanged` per second in total, 3.69 and 4.75 µs `JSON.parse` per frame |
| throughput, every active pair on two ticker sockets | | 12,594 and 12,795 frames in 30 s from 337 and 342 of 366 pairs, median 37 frames per pair per 30 s, 129 and 131 KB per second |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked with fewer rows than the frame held are cut to two or three rows.

There is no subscribe frame and no acknowledgement.
The socket path is the subscription.

```text
wss://api.bitkub.com/websocket-api/orderbook/1
wss://api.bitkub.com/websocket-api/market.ticker.thb_btc,market.ticker.thb_eth
```

First frame on an order book socket, `tradeschanged`: trades, then bid orders, then ask orders.

```json
{"data":[[[1790127746,2859919.58,0.00033631,"BUY",0,0,true,false,false],[1790127746,2858570,0.00177629,"BUY",0,0,true,false,false]],[[102140.83,2858000.04,0.03573856,0,true,false],[415451.1,2858000.03,0.14536427,0,true,false]],[[3399.98,2859969.58,0.00118882,0,false,false],[3499.97,2859969.58,0.00122378,0,false,false]]],"event":"tradeschanged","pairing_id":1}
```

`bidschanged`, single orders, the first three of 30.

```json
{"data":[[415451.1,2858000.05,0.14536427,0,true,false],[102140.83,2858000.04,0.03573856,0,false,false],[107.73,2858000,0.00003769,0,false,false]],"event":"bidschanged","pairing_id":1}
```

`askschanged`, two orders at one price.

```json
{"data":[[3399.98,2859969.58,0.00118882,0,false,false],[3499.97,2859969.58,0.00122378,0,false,false],[295165.63,2860132.11,0.1032,0,true,false]],"event":"askschanged","pairing_id":1}
```

`depthchanged`, the first two of 100 levels per side.

```json
{"data":{"bids":[{"price":2858000.05,"base_volume":0.14536427,"quote_volume":415451.1},{"price":2858000.04,"base_volume":0.03573856,"quote_volume":102140.81}],"asks":[{"price":2859969.58,"base_volume":0.0024126,"quote_volume":6899.97},{"price":2860132.1,"base_volume":0.00046153,"quote_volume":1320.04}]},"event":"depthchanged","pairing_id":1}
```

`bidschanged` on the USDT broker pair, always empty.

```json
{"data":[],"event":"bidschanged","pairing_id":484}
```

`ticker` on the order book socket.

```json
{"data":{"baseVolume":85.99848612,"change":13371.9,"close":2859919.58,"high24hr":2875813.95,"highestBid":2858305.52,"highestBidSize":1.1540603,"id":1,"isFrozen":0,"last":2859919.58,"low24hr":2827000,"lowestAsk":2859969.58,"lowestAskSize":0.0024126,"open":2846547.68,"percentChange":0.47,"quoteVolume":245153741.55,"stream":"market.ticker.thb_btc"},"event":"ticker","pairing_id":1}
```

`global.ticker`, one of about 200 per second, for another pair.

```json
{"data":{"baseVolume":4083365722,"high24hr":0.0048731,"highestBid":0.0044403,"id":369,"last":0.004502,"low24hr":0.0041581,"lowestAsk":0.0045055,"percentChange":7.14,"quoteVolume":18119329.38},"event":"global.ticker"}
```

`market.ticker` stream frames, a THB pair and the USDT broker pair.

```json
{"stream":"market.ticker.thb_btc","id":1,"last":2858318.29,"lowestAsk":2859970.08,"lowestAskSize":0.00192875,"highestBid":2858169.59,"highestBidSize":0.02877144,"change":12149.35,"percentChange":0.43,"baseVolume":85.99558595,"quoteVolume":245145589.16,"isFrozen":0,"high24hr":2875813.95,"low24hr":2827000,"open":2846168.94,"close":2858318.29}
```

```json
{"stream":"market.ticker.usdt_btc","id":484,"last":86406.2,"lowestAsk":86406.3,"lowestAskSize":0.204851,"highestBid":86164.5,"highestBidSize":0.059056,"change":601.7,"percentChange":0.7,"baseVolume":6831.110042,"quoteVolume":587565576.9003879,"isFrozen":0,"high24hr":86957.5,"low24hr":84990.6,"open":85804.5,"close":86406.2}
```

`market.trade`, the stream documented as closed since 2026-05-18.

```json
{"stream":"market.trade.thb_btc","sym":"THB_BTC","txn":"6ab32eec5130371b12460f79m8a2qe","rat":2859476.25,"amt":0.00034884,"bid":"6ab32eeca93ee78778f21d9cm8a2qe","sid":"6ab32eea7ca099cfea79d07cm8a2qe","ts":1790127852102}
```

Keepalive: a protocol ping frame every 5 s on `market.ticker` sockets, answered by the client library's automatic pong, and nothing on `orderbook` sockets.

Errors: the replies are HTTP, not frames.

```text
GET /websocket-api/orderbook.1               HTTP/1.1 200 OK, Content-Length: 0
GET /websocket-api/orderbook/1,orderbook/2   HTTP 404, "404 page not found"
GET /websocket-api/<366 ticker streams>      HTTP 414, "414 Request-URI Too Large"
```

## 7. Private channels

Named for a future execution stage, from S2, not probed.

- `wss://stream.bitkub.com/v3/private`, logged in with `{"event":"auth","data":{"X-BTK-APIKEY", "X-BTK-SIGN", "X-BTK-TIMESTAMP"}}`.
- Channels `order_update` and `match_update`, subscribed with `{"event":"subscribe","channel":"order_update"}`.
- Keepalive `{"event":"ping"}`.
- The official MCP server's client notes that the private host rejects an upgrade without a `User-Agent` header and pings every 240 s, S3.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Bitkub cannot be a perpetual leg, so no engine feed is recommended.
If a THB spot book were ever wanted, this is the shape the probes support.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket per pair, `wss://api.bitkub.com/websocket-api/orderbook/<pairing_id>` | the dotted documented form does not upgrade, and two ids in one path answer 404 |
| markets per connection | 1 | same |
| subscribe frames | none | the path subscribes |
| book | `resetBook` from every `depthchanged` | each frame is the whole aggregated book, up to 100 levels per side |
| seed | REST `/api/v3/market/depth?sym=<base>_<quote>&lmt=100` right after the open | no book arrives on connect, and the first `depthchanged` took 4.3 to 4.8 s on BTC_THB |
| resync | none possible | no sequence, id or time on any book event |
| freshness | treat the book as unverified between frames | 16 to 24 of 26 to 32 REST books in 30 s never appeared on the socket |
| keepalive | none sent | the order book socket gets no ping and needs none for at least 120 s |
| `maxSilenceMs` | 30,000 on the socket, with a per pair check on own events | `global.ticker` keeps every socket busy, so socket silence only catches a dead socket, and the longest gap between own events on the quietest pair was 4,673 ms |
| filtering | drop `global.ticker` before parsing when possible | 98.5 to 98.7 % of frames and bytes |
| receive time | stamp on arrival | no event carries a time |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

At 356 active THB pairs this is 356 sockets, each receiving about 200 `global.ticker` frames a second, so about 71,000 frames and 17 to 19 MB a second before any book event, by scaling the fanout measurement.
Two `market.ticker` sockets carry the top of book with sizes, and reached 337 and 342 of 366 pairs in 30 s at 129 and 131 KB a second, which is the lighter source of L1.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitkub Official API Docs, `websocket-public.md` | https://github.com/bitkub/bitkub-official-api-docs/blob/master/websocket-public.md | 2026-09-22, repository head `d65eafa538` of 2026-09-09 | Bitkub | URL, stream names, event shapes, keepalive, trade stream closure, sections 1 to 5 |
| S2 | Bitkub Official API Docs, `websocket-private.md` | https://github.com/bitkub/bitkub-official-api-docs/blob/master/websocket-private.md | 2026-09-22 | Bitkub | private URL, channels, ping, section 7 |
| S3 | Bitkub trading MCP server, `src/ws-client.ts` | https://github.com/bitkub/bitkub-trading-mcp-official/blob/HEAD/src/ws-client.ts | 2026-09-22 | Bitkub | private host notes, section 7 |
| S4 | GitHub issue 61, "wss://api.bitkub.com/websocket-api/orderbook/<symbol-id> sends global.ticker data" | https://github.com/bitkub/bitkub-official-api-docs/issues/61 | 2026-09-22 | Bitkub repository | the slash form of the order book path, and `global.ticker` on it since 2022, sections 2 and 4 |
| P1 | `ws-probe.mjs book`, run 1 at 01:42 UTC and run 2 at 01:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs streams`, at 01:41, 01:44 and 01:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs) | 2026-09-23 UTC | this host | stream forms, errors, URL cap, sections 2 to 5 |
| P3 | `ws-probe.mjs fanout`, at 01:45 and 01:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs) | 2026-09-23 UTC | this host | throughput, section 5 |
| P4 | `ws-probe.mjs silence`, at 01:45 and 01:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs) | 2026-09-23 UTC | this host | keepalive and silence, section 5 |
| P5 | `ws-probe.mjs deflate`, at 01:41 and 01:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs) | 2026-09-23 UTC | this host | compression, section 5 |
| P6 | `ws-probe.mjs sync`, at 01:53 and 01:54 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs) | 2026-09-23 UTC | this host | first book time and missing books, section 4 |
