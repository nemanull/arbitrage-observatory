# Kanga Global WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:57 to 05:22 UTC, from the development host near Seattle.

This profile covers the public market data socket of Kanga Global, which lists no perpetual, so the spot book stands where the perpetual book would, see [`fees.md`](./fees.md) section 3.
Kanga publishes no WebSocket documentation.
Neither the API documentation, S1, nor the CoinGecko-format public API file, S2, names a socket.
The socket below is the one the Kanga Global web app opens, read from its bundle, S3, and every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/kanga/ws-probe.mjs).
So the "documented" column below records what the web app does, and it is marked Not publicly specified where the app says nothing.
All traffic from this host leaves through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada, so the access results are from that Canadian VPN exit.

## 1. Endpoints

| product | URL | probed |
|---|---|---|
| spot, every market | `wss://ws.kanga.global/socket.io/?EIO=4&transport=websocket` | open in 128 to 189 ms on every socket timed in P1, P2 and P6, Cloudflare in front |
| perpetuals | none | Kanga lists none |
| leveraged futures | none | the futures web app polls REST every 5 s and opens no socket, S5 |

The server speaks Socket.IO over Engine.IO protocol 4.
The web app connects with `io("wss://ws.kanga.global", {transports: ["websocket"]})`, S3, which is the URL above once the Socket.IO client adds its default path and query.
The polling transport is refused: `GET https://ws.kanga.global/socket.io/?EIO=4&transport=polling` and the same with `EIO=3` answered HTTP 400 `{"code":0,"message":"Transport unknown"}`, P4.
One socket reaches every spot market, but it keeps only one market live at a time, see section 4.
`ws.kanga.global` resolved to 104.20.38.228 and 172.66.158.195 and two IPv6 addresses, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

A client subscribes with one event, `subscribe market`, whose argument is the market id.
The server then pushes four events for that market, each as `[event, data, marketId]`.

| event | payload | depth and speed | probed |
|---|---|---|---|
| `bid` | the whole bid side, one array per price grouping, levels `[size, price]` | 30 levels per grouping, pushed on change on a server cycle of about 3 s | snapshot on subscribe, then whole-side pushes, recommended |
| `ask` | the whole ask side, same shape | same | same |
| `trn` | the last 30 trades as `[unixSeconds, size, price]`, newest first | sent on subscribe, and again after a trade | one per subscribe in P2, and 3 `BTC-USDT` frames for 2 subscribes in the P1 rerun |
| `graph` | candles as `[periodIndex, number, number, number, number]` | sent on subscribe | about 61 KB per market, 15,052,651 and 15,069,629 bytes for 245 markets in two runs of P2, not decoded further |

No best bid and ask channel, ticker channel, or mark, index or funding channel exists, since Kanga publishes no such numbers, see [`rest.md`](./rest.md) section 3.
The web app also listens for `balance`, `user-staking`, `ieo`, `packages-ieo`, `ieo-public`, `packages-ieo-public` and `kantor-confirmation-request`, S3.
They concern accounts and token sales rather than markets, and were not probed.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S3 | one URL for every spot market, and only the latest `subscribe market` on a socket keeps updating, section 4 |
| subscribe frame shape | the app sends `emit("subscribe market", id)`, S3, which is the text packet `42["subscribe market","BTC-USDT"]` | one market per packet, and a namespace connect `40` must come first |
| unknown symbol expectation | Not publicly specified | `NOPE-USDT`, `BTC_USDT` and `btc-usdt` got no frame and no error in about 55 s, in both runs of P1 |
| chunk unit and budget | Not publicly specified | 245 subscribe packets on one socket got 245 snapshots in each of three runs, but only the last market kept updating, P2. Ten sockets from this host, one market each, all delivered in both runs, P6 |
| keepalive mechanism | Engine.IO 4: the server sends `2`, the client answers `3` | `pingInterval` 3000 and `pingTimeout` 5000 in every open packet. Pings came every 3,047 to 3,060 ms, P1 |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 67 s, other than after a malformed packet, and no notice event seen |
| handshake and operation rate limits | Not publicly specified | ten sockets opened within the same second, and 245 subscribe packets sent in one burst, all accepted, P2 and P6 |
| public market data authentication | none for `subscribe market` | none. The app passes a `websocketToken` only for private subscriptions, S3 |
| message parse and routing | Socket.IO event packets | strip the `42` prefix, parse JSON, route on element 0 for the event and element 2 for the market id |
| subscribe acknowledgement shape | Not publicly specified | none: a subscribe with an ack id, `420[...]`, got no `43` answer, P1. The snapshot is the only reply |
| symbol identifier format | the web app's market id, `BTC-USDT`, S3 | the `id` of `POST /api/markets` exactly, dash separated and case sensitive, including `BTC-oPLN` |
| number representation | Not publicly specified | JSON numbers for price and size, for example `[0.046815,87150]` |
| timestamp representation | Not publicly specified | book frames carry no time at all. `trn` carries Unix seconds |
| size unit | Not publicly specified | base currency, the same number the REST book prints at the same price, section 4 |
| sequence semantics | none | no sequence or update id in any frame. Each `bid` or `ask` frame replaces that side |
| idle repeat behaviour | Not publicly specified | no frame repeated the previous one on any market in P1. A side that does not change sends nothing, and pushes after the first were never closer than 2,994 ms, section 4 |

## 4. The book channel in detail

### Snapshot on subscribe

The first `bid` and `ask` frames arrive right after `subscribe market`: 371 to 534 ms and 52 to 213 ms after the subscribe packet in the two runs of P1, and 579, 684 and 647 ms at the median, 746, 862 and 867 ms at most, for 245 markets in the three runs of P2.
Each frame is a full side, so the first pair is a complete snapshot.

### Delta semantics

There are no deltas.
Every `bid` frame carries the whole bid side again, and every `ask` frame the whole ask side.
A frame for one side can arrive without a frame for the other, so a feed keeps the last of each side.
The web app does exactly that, `setState({bid: fr(e)})` on every `bid` event, S3.

### One live market per socket

A socket keeps pushing updates only for the market it subscribed last.
In P5, a socket that subscribed `BTC-USDT` alone got 9 bid and 11 ask frames in 45 s, and 11 and 11 in the rerun.
A socket that subscribed `BTC-USDT` and then `ETH-USDT` 3 s later got 1 `BTC-USDT` frame per side, the snapshot, and nothing after, in both runs.
Its `ETH-USDT` pushes arrived within a few milliseconds of those of a socket that subscribed `ETH-USDT` alone.
In P2, 245 markets subscribed in one burst got 245 snapshots and then 12 and 8 update frames in 60 s in the two runs that counted them, all on `ZRO-USDT`, the last market in the burst.
The P1 book runs show the same rule: `BTC-oPLN` updated until the unknown ids were subscribed after it at 10 s, and `BTC-USDT` updated only after it was subscribed a second time at 15 s.
The web app never needs more, because it shows one market and swaps the subscription with `unsubscribe market` and `subscribe market` when the page changes, S3.
Whether `unsubscribe market` stops a live market was Not verified, because the market it was sent for in P1 had already stopped updating.
A second `subscribe market` for a market sends a fresh snapshot of both sides, 53 ms later in the P1 rerun, and makes that market the live one.

### Push cadence

Pushes after the snapshot arrive on a server cycle of about 3 s.
Over 124 consecutive push pairs in the P1 rerun and both P5 runs, the gap was 2,994 ms at least, 3,141 ms at the tenth percentile, 3,557 ms at the median and 25,292 ms at most.
The first push after a snapshot came 91 to 14,371 ms after it, so a snapshot is not tied to the cycle.
Bid and ask pushes for the same market often arrive in the same millisecond.
So a book on this socket is up to about 3 s behind the matching engine by design, before any network delay.

### Checksum

None exists.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket `bid` and `ask`, every grouping | best first, descending, in every frame of P1 | best first, ascending, in every frame of P1 |
| REST `orderbook/raw` | descending, 50 levels | ascending, 50 levels |
| REST `depth` | descending, whole side | descending, worst first, see [`rest.md`](./rest.md) section 5 |

### Price groupings

The data object has one key per grouping, from `"0"` to the market's `pricePrecision`, and each key holds up to 30 levels, P1.
Key `k` rounds prices to `k` decimals, bids down and asks up.
The last `BTC-USDT` frames of P1 read best bid 87094, 87094.4 and 87094.49 under keys `"0"`, `"1"` and `"2"`, and best ask 87313, 87312.6 and 87312.6.
Only the key equal to `pricePrecision` carries exact prices, and `pricePrecision` comes from `POST /api/markets`, 2 for `BTC-USDT` and 3 for `NEAR-USDT`.
A coarse key can hold a level at price 0: `NEAR-USDT` key `"0"` held `[30634.49,0]`, P1.
A feed reads only `data[String(pricePrecision)]`.

### Level window

The exact key held 30 levels on every busy market, so the socket carries 30 levels per side.
That covers the engine's 20, at [`ClusterIndexBuilder.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/ClusterIndexBuilder.ts) line 17.
A coarse grouping holds fewer: `NEAR-USDT` held 2, 4, 15 and 30 bid levels under keys `"0"` to `"3"` in P1, and 2, 5, 23 and 30 in the rerun.

### Size unit

The size is in the base currency.
In the P1 rerun the REST snapshot of `BTC-USDT` happened to be 33 ms old, and its 20 best bids equalled the socket's last bid frame, 660 ms old, in price and in size, level for level.
The asks matched at the touch, `[0.04475806,87039.17]` against `["87039.17","0.04475806"]`, and differed below it, which fits an ask change the socket had not pushed yet.
In the first run the REST snapshots were 64 and 73 s old and at most 2 of 20 levels matched, because the REST book is a snapshot up to 120 s old, see [`rest.md`](./rest.md) section 5.
There is no contract size, and no CCXT market to compare against, see [`fees.md`](./fees.md) section 8.

### One-sided and empty books

No empty side was seen: every `bid` and `ask` snapshot of the 245 markets in the third P2 run held at least one level.
What the socket sends for a side with no orders is Not verified.
The engine's `resetBook` accepts an empty side.

### Unknown, closed and wrong-format symbols

| request | reply |
|---|---|
| `subscribe market` `NOPE-USDT` | nothing in about 55 s |
| `subscribe market` `BTC_USDT`, the CoinGecko form | nothing in about 55 s |
| `subscribe market` `btc-usdt` | nothing in about 55 s |
| event `nope` | nothing, and the socket stayed open for the 1.5 s until the next packet |
| text packet `42not json` | the server closed the socket at once with code 1005 and no reason, in both runs, at 66,944 and 66,803 ms after open |

Because an unknown market is silently ignored, a feed has to notice a market with no snapshot on its own.
A closed or delisted market was not available to probe, since the catalog has no status field, see [`rest.md`](./rest.md) section 2.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO 4 server ping | `2` every 3,047 to 3,060 ms, answered with `3`, P1 |
| silence the server tolerates | `pingTimeout` 5000 | a socket that did not answer the first ping closed at 8.14 and 8.15 s with code 1005, P3 |
| namespace connect | Socket.IO | a socket that never sent `40` closed at 45.18 and 45.15 s with code 1005, which matches the Socket.IO default `connectTimeout` of 45 s, P3 |
| idle socket | | a socket that sent `40`, answered every ping and subscribed nothing stayed open 60 s until the probe closed it, in both runs, P3 |
| forced disconnect | Not publicly specified | none, other than the close after a malformed packet, section 4 |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, P4, and every frame was text |
| handshake | | 128 to 189 ms to open, and the `40` answer 48 to 69 ms later, P1, P2 and P6 |
| subscription limits | Not publicly specified | one live market per socket, section 4. Ten parallel sockets from one host all delivered, P6 |
| throughput | | a 245 market subscribe burst drew 15.98 to 16.00 MB in P2, 94 % of it `graph` frames. Side frames averaged 1.3 KB for bids and 1.5 KB for asks. `JSON.parse` took 12 to 18 µs per frame at the median |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Socket.IO packets are text with a numeric prefix before the JSON, so they are shown as text blocks.
Arrays marked `…` are cut.

Engine.IO open packet, prefix `0`, then JSON.

```text
0{"sid":"09cKFtOksw_fHOBfeUsu","upgrades":[],"pingInterval":3000,"pingTimeout":5000,"maxPayload":1000000}
```

Namespace connect sent by the client, and the server's answer.

```text
40
40{"sid":"NqPeoDtCvJtATOJZeUsv"}
```

Subscribe.

```text
42["subscribe market","NEAR-USDT"]
```

Snapshot sides for `NEAR-USDT`, whose `pricePrecision` is 3, first two levels per grouping kept.
Key `"3"` is the exact book.

```text
42["bid",{"0":[[11306.51319728,4],[30634.49,0]],"1":[[1423.58963954,4.3],[9882.92355774,4.2]],"2":[[431.47465376,4.32],[417.87752446,4.31]],"3":[[207.08490386,4.321],[224.3897499,4.32]]},"NEAR-USDT"]
42["ask",{"0":[[33805.49741286,5],[10,6]],"1":[[8893.82411381,4.5],[5668.29775913,4.6]],"2":[[62.86074549,4.41],[364.61524935,4.42]],"3":[[62.86074549,4.41],[210.67252693,4.411]]},"NEAR-USDT"]
```

Trades on subscribe, newest first, `[unixSeconds, size, price]`.

```text
42["trn",[[1790139364,0.00108098,87202.29],[1790139195,0.02282584,87201.4],[1790138777,0.00789489,87157.66],…],"BTC-USDC"]
```

Keepalive, server then client.

```text
2
3
```

Refused polling transport, plain JSON.

```json
{"code":0,"message":"Transport unknown"}
```

No error packet exists for an unknown market, so none can be shown.

## 7. Private channels

Named for a future execution stage, from S3, not probed.
The web app subscribes them on the same socket with `emit("subscribe <channel>", websocketToken)`, and listens for `balance`, `user-staking`, `ieo`, `packages-ieo` and `kantor-confirmation-request`.
Order entry goes through signed REST calls such as `POST /api/v2/market/order/create`, S1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Kanga has no perpetual, so none of this is needed for the engine as it stands.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket per market at `wss://ws.kanga.global/socket.io/?EIO=4&transport=websocket` | only the last subscription on a socket keeps updating, section 4 |
| markets per connection | 1 | same reason. 245 USD-family markets with volume would need 245 sockets, and only ten parallel sockets were tested |
| handshake | on the `0` packet send `40`, on the `40{...}` answer send `42["subscribe market","<rawMarketId>"]` | Socket.IO needs the namespace connect before any event |
| subscribe frames | none from `getSubscribeFrames`, the packets above are sent from `handleMessage` | `VenueFeed` sends every subscribe frame through `JSON.stringify`, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 143, 152 and 161, which would quote a raw Socket.IO packet |
| keepalive | answer every `2` with `3`, and send nothing on a timer | the server pings every 3 s and closes a socket that misses one pong by 5 s |
| `maxSilenceMs` | 10,000 | pings arrive every 3 s and count as traffic, while a live `BTC-USDT` went 25 s without a push in P5 and `KNG-USDC` sent only its snapshot in 30 s in P6 |
| routing | `JSON.parse(text.slice(2))`, event in element 0, market in element 2 | Socket.IO event packet |
| book | keep the last bid side and the last ask side per market, and on each side frame call `resetBook` with both | every frame is a whole side, and sides arrive separately |
| levels | read `data[String(pricePrecision)]` only, and ignore the coarser keys | only that key is exact, and coarse keys hold rounded and zero prices |
| resync | none on sequence, since there is none. Reconnect on close or silence | nothing to chain |
| unserved market | log a market with no snapshot 5 s after its subscribe | unknown ids are ignored silently |
| receive time | stamp on arrival | no frame carries a book time |
| staleness | treat every Kanga book as up to about 3 s old | the server pushes on a cycle of about 3 s |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |
| malformed packets | never send one | the server closes the socket on a packet it cannot parse, section 4 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Kanga Global API documentation, `api.json` | https://apidoc.kanga.global/assets/api.json | 2026-09-22 | Kanga Global | no socket documented, signed order calls, sections 1 and 7 |
| S2 | Public kanga.exchange API, `openapi.yaml` | https://public.kanga.exchange/openapi.yaml | 2026-09-22 | Kanga | no socket documented, section 1 |
| S3 | Kanga Global web app bundle | https://trade.kanga.global/main.300e4a41cf127ad1a85e.bundle.js | 2026-09-22 | Kanga Global | socket URL and transport, `subscribe market`, the event names, private subscriptions, sections 1 to 4 and 7 |
| S4 | Socket.IO client inside the web app vendor bundle, Engine.IO `protocol=4` | https://trade.kanga.global/vendors.fdca78d1eb6216224c2f.bundle.js | 2026-09-22 | Kanga Global | protocol version, section 1 |
| S5 | Kanga Futures web app bundle | https://trade.kanga.global/futures/assets/index-DYh-NeI9.js | 2026-09-22 | Kanga Global | the futures app polls REST every 5 s and opens no socket, section 1 |
| P1 | `ws-probe.mjs book`, runs at 04:57 and 05:17 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kanga/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 2 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 04:59, 05:01 and 05:18 UTC, the last two with event and empty-side counts | [`ws-probe.mjs`](../../../scripts/probes/venues/kanga/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, runs at 05:00 and 05:19 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kanga/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P4 | `ws-probe.mjs deflate`, runs at 05:01 and 05:20 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kanga/ws-probe.mjs) | 2026-09-22 | this host | sections 1 and 5 |
| P5 | `ws-probe.mjs rooms`, runs at 05:03 and 05:20 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kanga/ws-probe.mjs) | 2026-09-22 | this host | section 4 |
| P6 | `ws-probe.mjs fanout`, runs at 05:04 and 05:21 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kanga/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
