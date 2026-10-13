# Derive WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:23 to 22:38 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public WebSocket API of Derive (CCXT id `derive`), with the perpetual book channel in detail.
Derive's v3 API went live on 2026-10-06, and the v2 socket that CCXT Pro 4.5.68 opens now refuses the handshake, section 1.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/derive/ws-probe.py), run with `uv run` from the repository root, and the capture is quoted beside the documented value.
The probe used aiohttp with no compression offered and answered every server ping by hand, so it saw each control frame.
P1 is the first run of each mode, from 22:23 to 22:28 UTC, and P2 is the rerun, from 22:33 to 22:38 UTC.
Mode `books` held one socket for 170 s on all 15 perpetuals, `group` 30 s on two, `edge` 25 s, and `legacy` only tried the v2 handshake.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Fees and access are in [`fees.md`](./fees.md), and the catalog, the anchor and the decentralised layer in [`rest.md`](./rest.md).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every instrument, v3 mainnet | `wss://api.derive.xyz/v3/ws`, S1 and S2 | 101 in 328 to 371 ms, P1 and P2, through Cloudflare, `server: cloudflare`, `CF-RAY` ending `SEA` or `YVR` |
| v3 testnet | `wss://testnet.api.derive.xyz/v3/ws`, S1 | not probed |
| v2 mainnet, CCXT Pro's URL | `wss://api.lyra.finance/ws`, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/derive.js` line 31 | HTTP 503 with an nginx page titled "503 Service Temporarily Unavailable", P1 and P2 |

One URL carries options, perpetuals and spot, S2.
The probe subscribed only perpetuals, plus `spot_feed.BTC`.
The v3 hosts are listed in S1 and in the AsyncAPI files, S3.
S5 says that for "users with dedicated connections, there is no change in hostnames (the 'v3' path prefix can also be ignored)", which does not cover a public reader.

## 2. Channel matrix for public market data

| channel | subscription | payload | documented cadence | probed |
|---|---|---|---|---|
| `orderbook.{instrument_name}.{group}.{depth}` | group `1`, `10` or `100`, depth `1`, `10`, `20` or `100`, S2 | the whole book to that depth, `[price, amount]` string pairs, with `timestamp`, `instrument_name` and `publish_id`, S4 | "periodically publishes", S4 | every 100 ms while the book changes and every 1 s while it does not. Across 15 perpetuals the gap between two frames of one book was p10 100 ms, p50 203 and 300 ms, p90 1,011 and 1,012 ms, and max 1,112 and 1,111 ms, P1 and P2 |
| `ticker_slim.{instrument_name}.{interval}` | interval `100` or `1000` ms, S2 | `t`, `a`, `A`, `b`, `B`, `M`, `I`, `f`, `minp`, `maxp`, `stats`, `option_pricing` inside `instrument_ticker`, S2 | the interval | at `1000`, every 1,011 ms at p50 on all 15 perpetuals, 168 frames each in 170 s, P1 and P2 |
| `ticker.{instrument_name}.{interval}` | deprecated, S2 | | "subscribing to it is rejected", S2 | refused for the whole request with `-32602`, section 6 |
| `spot_feed.{currency}` | `spot_feed.BTC` | the oracle spot `price`, `confidence`, and the previous day's price, S2 | not stated | every 2,999 and 3,000 ms at p50, min 2,881 and max 3,117 ms, P1 and P2 |
| `trades.{instrument_name}` | | each trade with both wallets, fees and PnL, S2 | at match time | not probed |
| `trades.{instrument_type}.{currency}` | `trades.perp.BTC` | the same per category | at match time | not probed |
| `auctions.watch`, `margin.watch` | | liquidation auctions, and a margin firehose for every account | | not probed |

No dedicated index, mark or funding channel exists.
`ticker_slim` carries the index `I`, the mark `M` and the hourly funding rate `f` of one instrument, so 15 subscriptions cover every perpetual.
CCXT Pro still subscribes `ticker.{id}.100`, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/derive.js` line 155, which v3 refuses.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every instrument type, S1 and S2 | one socket carried 15 books, 15 tickers and `spot_feed.BTC`, P1 and P2 |
| subscribe frame shape | JSON-RPC `{"id":1,"method":"subscribe","params":{"channels":[…]}}`, S2 | one frame with 31 channels was answered once, P1 and P2. A frame with no `id` was answered with a server-made UUID `id`, section 6 |
| unknown symbol expectation | not stated | `orderbook.NOPE-PERP.1.20` and the lowercase `orderbook.btc-perp.1.20` are acknowledged `ok` and then send nothing: 0 frames in 24 s while `ETH-PERP` sent 100 and 84, P1 and P2 |
| chunk unit and budget | at most 10,000 channels per connection and per request, else `-32602` and nothing subscribed, S2 | 31 channels, no refusal. The cap was not approached |
| keepalive mechanism | the server sends a protocol Ping each heartbeat, any inbound frame counts as liveness, and an optional text `ping` gets `pong`, S6 | a protocol Ping with an empty payload every 30 s: at 30,001, 60,000, 90,000, 120,000 and 150,002 ms after open in P1, and at 29,999, 59,999, 90,001, 120,000 and 149,999 ms in P2. Text `ping` got text `pong` in 99 to 101 ms, and a client protocol Ping got a Pong in 99 to 100 ms, P1 and P2 |
| connection lifetime and maintenance notice | the heartbeat window is "currently ~180 seconds", and a client that shows no activity in it is dropped, S6. No lifetime cap or notice channel is documented | no forced close in 170 s, P1 and P2. `public/get_live_incidents` listed no incident, [`rest.md`](./rest.md) section 6 |
| handshake and operation rate limits | 4 concurrent sockets per IP, past which the server sends `connectionLimitExceeded: <detail>` and closes with `-32100`, S6 and S7. Public requests share a per-IP budget of 5 a second, S7 | one socket at a time from this host, and no refusal. The REST budget the server reported was far larger, [`rest.md`](./rest.md) section 6 |
| public market data authentication | none, S2 | none |
| message parse and routing | a notification is `{"method":"subscription","params":{"channel":…,"data":…}}` with no `id`, and a reply carries the request's `id`, S2 | route replies on `id`, and notifications on `params.channel`, whose second dot field is the instrument. Book data also carries `instrument_name` |
| subscribe acknowledgement shape | `{"id":…,"result":{"status":{channel: status},"current_subscriptions":[…]}}`, each status `"ok"`, `"already subscribed"` or an error string, S2 | as documented, section 6. The reply came 99 to 107 ms after the request, before the first book, P1 and P2 |
| symbol identifier format | `<CURRENCY>-PERP`, uppercase and case-sensitive, with an optional `-<risk universe id>` suffix, S8 | `BTC-PERP`, spelled on data frames as subscribed, and equal to CCXT's `market.id`, [`rest.md`](./rest.md) section 2. No perpetual carried a suffix on 2026-10-12 |
| number representation | strings for prices and amounts, S4 | prices, amounts, `I`, `M` and `f` are decimal strings. `timestamp`, `t` and `publish_id` are integers |
| timestamp representation | `timestamp` in ms, S4 | integer ms. A book's `timestamp` was 52 to 269 ms older than its arrival, p50 54 or 55 ms, over 6,194 frames in P1 and 5,586 in P2 |
| size unit | "Amount of contracts / tokens", for the slim ticker's `A` and `B`, S3 | coins of the base currency, as `BTC-PERP` amounts such as `0.0363` show, which matches CCXT's `contractSize` 1, section 4 |
| sequence semantics | `publish_id`, a uint64, S4. Its rule is not stated | `publish_id` rose by exactly 1 between two frames of one book on 15 of 15 books, over 6,194 frames in P1 and 5,586 in P2. Each book counts on its own: `CC-PERP` was near 4,791 while `BTC-PERP` was near 111,692 in P1 |
| idle repeat behaviour | not stated | an unchanged book is sent again about every 1 s with a new `publish_id`. On `CC-PERP` 146 of 213 frames equalled the frame before in P1, and 141 of 216 in P2 |

## 4. The book channel in detail

### Snapshot semantics

Every `orderbook` frame is the whole book to the subscribed depth, so there is no delta, no checksum and no sequence rule to keep.
CCXT Pro reads it the same way and resets its book on every frame, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/derive.js` line 138.
A feed replaces the book on every frame, and a missed frame costs only freshness.
`publish_id` still lets a feed see a missed frame, because it rose by exactly 1 per frame of each book in P1 and P2.
The first book arrived 112 to 1,079 ms after the subscribe frame, p50 778 ms, over 15 perpetuals in P1, and 150 to 718 ms, p50 451 ms, in P2.

### Push cadence

| perpetual | frames in 170 s, P1 and P2 | gap p50 | gap p90 | frames equal to the one before |
|---|---|---|---|---|
| `PUMP-PERP` | 945 and 329 | 102 and 408 ms | 403 and 1,012 ms | 6 and 81 |
| `ETH-PERP` | 531 and 480 | 197 and 201 ms | 1,006 and 1,010 ms | 53 and 62 |
| `BTC-PERP` | 517 and 711 | 104 and 102 ms | 1,010 and 706 ms | 57 and 42 |
| `ZEC-PERP` | 509 and 577 | 107 and 103 ms | 1,009 and 909 ms | 56 and 49 |
| `CC-PERP` | 213 and 216 | 1,009 and 1,010 ms | 1,014 and 1,013 ms | 146 and 141 |

All 15 books had a p10 gap of 99 to 102 ms and a max gap of 1,015 to 1,112 ms, P1 and P2.
So a book is pushed on a 100 ms clock when it changes, and once a second when it does not.
A few gaps were 1 to 12 ms, on `BTC-PERP`, `DOGE-PERP`, `ETH-PERP`, `HYPE-PERP`, `LINK-PERP`, `LIT-PERP`, `PUMP-PERP`, `XAUT-PERP` and `ZEC-PERP`, P1 and P2.

### Age at arrival

The book `timestamp` was p10 53 ms, p50 55 ms, p90 58 ms and at most 269 ms older than the frame's arrival, over 6,194 frames in P1, and p50 54 ms, p90 57 ms and at most 174 ms over 5,586 frames in P2.
The server clock was within 50 ms of this host's, [`rest.md`](./rest.md) section 7, so about 55 ms is the path from the matching engine to this host.
`ticker_slim` `t` was 52 to 175 ms old at arrival, p50 55 ms, over 2,520 frames in each of P1 and P2.

### Aggregation

`group` counts ticks, P1 and P2.
On `BTC-PERP`, whose tick is 0.1, group `1` gave levels 0.1 apart, group `10` levels 1 apart and group `100` levels 10 apart.
On `ETH-PERP`, whose tick is 0.01, group `1` gave steps of 0.01 and group `10` steps of 0.1.
Group `10` rounds bids down and asks up: in the first frames of both subscriptions, `82523.4` became `82523` and `82523.5` became `82524`, P1.
CCXT Pro subscribes group `10`, at line 89 of its class, so its books are aggregated, and the engine wants group `1`.
Depth `100` at group `1` held 33 to 40 bids and 15 to 25 asks on `BTC-PERP`, P1 and P2, so the whole book is shallower than 100 levels.
Depth `20` held 20 bids and 8 to 20 asks on `BTC-PERP`, and only 1 to 3 levels a side on `CC-PERP`, P1 and P2.

### Level order on the wire

Bids descend and asks ascend in every frame: none of 6,194 frames in P1 and 5,586 in P2 was out of order or crossed.

### Size unit against CCXT `contractSize`

An amount is in coins of the base currency.
`BTC-PERP` levels read amounts such as `0.02` and `0.0363`, against a `minimum_amount` of `0.01` and an `amount_step` of `0.0001` in the instrument row, [`rest.md`](./rest.md) section 2.
CCXT sets `contractSize` to the literal 1 for every perpetual, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/derive.js` line 678, which matches.

### Market id against the socket instrument

The channel and the data carry `instrument_name`, such as `SOL-PERP`, which is CCXT's `market.id`, line 636 of the class, and the v3 catalog's name.
A name is uppercase and case-sensitive, S8, and a lowercase subscription is acknowledged and then silent, section 3.

### One-sided and empty books

No frame was one-sided or empty, over 6,194 frames in P1 and 5,586 in P2, although `CC-PERP` held as few as 1 level a side.
Whether a market with no orders sends empty arrays was not seen.

### Idle repeats

An unchanged book is resent about once a second with a new `publish_id` and a new `timestamp`, section 3.
So silence on a subscribed book for more than a few seconds means the socket is stale.

### Unknown, closed and malformed subscriptions

| subscription | reply | then |
|---|---|---|
| `orderbook.NOPE-PERP.1.20` | status `ok` | no frame in 24 s, P1 and P2 |
| `orderbook.btc-perp.1.20` | status `ok` | no frame in 24 s, P1 and P2 |
| `orderbook.BTC-PERP.2.20` | status ``Invalid value `2` for `group` `` | the other channels of the request were subscribed |
| `orderbook.BTC-PERP.1.50` | status ``Invalid value `50` for `depth` `` | the same |
| `ticker.BTC-PERP.1000` | error `-32602` for the whole request | nothing subscribed |
| a channel already held | status `already subscribed` | |

A closed perpetual was not available to test, since all 15 were active.

### REST snapshots against the socket

v3 has no public REST order book, [`rest.md`](./rest.md) section 5, and CCXT declares `fetchOrderBook` false at line 96 of its class.
None is needed, because every socket frame is whole.

## 5. Session

- Keepalive: the server sent a protocol Ping every 30 s, P1 and P2, while S6 calls the heartbeat "currently ~180 seconds".
  A client that answers the server's Ping, or sends any frame, stays alive, S6.
  A text `ping` is answered with the text `pong`, which is not JSON.
- Silence: every subscribed book and ticker sends at least once a second, section 4, so a silent socket is dead within a few seconds.
- Forced disconnects: none in 170 s, P1 and P2, and none documented apart from the heartbeat and the per-IP cap, S6.
- Maintenance: no notice channel is documented, S2.
  `public/get_live_incidents` is the REST place for incidents, and it listed none, [`rest.md`](./rest.md) section 6.
- Compression: with no offer the handshake carried no `Sec-WebSocket-Extensions`, P1 and P2.
  When the probe offered permessage-deflate, the server accepted it as `permessage-deflate; client_max_window_bits=9`, P1 and P2.
  So the engine, which offers none, gets plain text frames.
- Handshake: 328 to 371 ms through Cloudflare, P1 and P2.
- Limits: 4 sockets per IP, S6, and 10,000 channels per socket and per request, S2.
  On reconnect nothing is kept, so every channel is subscribed again, S6.

## 6. Captured frames

Subscribe acknowledgement, P1, trimmed to 3 of 31 statuses and 3 of 31 subscriptions:

```json
{"id":1,"result":{"status":{"orderbook.BTC-PERP.1.20":"ok","ticker_slim.BTC-PERP.1000":"ok","spot_feed.BTC":"ok"},"current_subscriptions":["orderbook.BTC-PERP.1.20","ticker_slim.BTC-PERP.1000","spot_feed.BTC"]}}
```

Book frame, `SOL-PERP`, P1, trimmed to 3 of 11 bids and 3 of 10 asks:

```json
{"method":"subscription","params":{"channel":"orderbook.SOL-PERP.1.20","data":{"timestamp":1791843867763,"instrument_name":"SOL-PERP","publish_id":88668,"bids":[["106.93","9.354"],["106.926","46.78"],["106.925","477.058"]],"asks":[["106.931","774.238"],["106.936","28.068"],["106.941","9.354"]]}}}
```

Slim ticker frame of the same instant, P1:

```json
{"method":"subscription","params":{"channel":"ticker_slim.SOL-PERP.1000","data":{"timestamp":1791843867763,"instrument_ticker":{"t":1791843867763,"A":"774.238","a":"106.931","B":"9.354","b":"106.93","f":"0.000012500","option_pricing":null,"I":"106.905","M":"106.956","stats":{"c":"4243.834","v":"466984.349","pr":"467091.916","n":379,"oi":"12989.635","h":"113.242","l":"106.459","p":"-0.035"},"minp":"103.842","maxp":"110.165"}}}}
```

Spot feed frame, P1:

```json
{"method":"subscription","params":{"channel":"spot_feed.BTC","data":{"timestamp":1791843868835,"feeds":{"BTC":{"price":"82519.02960553643","confidence":"1","price_prev_daily":"83867.79674806302","confidence_prev_daily":"1","timestamp_prev_daily":1791757468835}}}}}
```

A request with one bad channel among good ones, P1:

```json
{"id":2,"result":{"status":{"orderbook.BTC-PERP.2.20":"Invalid value `2` for `group`","orderbook.BTC-PERP.1.20":"ok","orderbook.btc-perp.1.20":"ok","orderbook.BTC-PERP.1.50":"Invalid value `50` for `depth`"},"current_subscriptions":["orderbook.BTC-PERP.1.20","orderbook.btc-perp.1.20","orderbook.NOPE-PERP.1.20"]}}
```

The deprecated ticker channel, P1 and P2:

```json
{"jsonrpc":"2.0","error":{"code":-32602,"message":"Invalid params","data":"`ticker` channel has been deprecated. Please use `ticker_slim`. Caught for wallet: "},"id":3}
```

A method that does not exist, and a frame that is not JSON, P1:

```json
{"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found","data":"Method not found"},"id":6}
```

```json
{"jsonrpc":"2.0","error":{"code":-32700,"message":"Error parsing message","data":"Error parsing message: {not json"},"id":"968daaf0-c1eb-4333-b5ae-ae9b4c67b8de"}
```

The keepalive answer to the text frame `ping` is the bare text `pong`, P1 and P2.

## 7. Private channels

Names only, for a future execution stage, S2:

| channel | content |
|---|---|
| `{subaccount_id}.balances` | balances and positions |
| `{subaccount_id}.orders` | order updates |
| `{subaccount_id}.trades` | own fills |
| `{subaccount_id}.quotes` | RFQ quotes |
| `{subaccount_id}.best.quotes` | best quotes |
| `{wallet}.rfqs` | RFQs of every subaccount |

They need `public/login` with an EIP-191 signature on the same URL, or a read-only JWT as `?token=`, S6.
Nothing here was called.

## 8. Recommended feed shape

- URL plan: one connection to `wss://api.derive.xyz/v3/ws` for all 15 perpetuals, id `derive#perp#0`.
  The 4 sockets per IP and 10,000 channels per socket leave room for 30 channels on one socket.
- Subscribe frames: one frame, `{"id":1,"method":"subscribe","params":{"channels":[…]}}`, holding `orderbook.{name}.1.20` for every market.
  It also holds `ticker_slim.{name}.1000` for every market when the anchor is read from the socket, as [`rest.md`](./rest.md) section 8 recommends.
- Book: group `1` and depth `20`, the smallest depth of at least 20 levels, as decision 22 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) asks.
  Every frame replaces the market's book.
- Routing: a frame whose `method` is `subscription` carries `params.channel` and `params.data`.
  An `orderbook` frame names its market in `data.instrument_name`, and a `ticker_slim` frame only in the channel's second dot field.
  Replies carry `id`, and the bare text `pong` is not JSON, so `handle` must skip it.
- Resync rule: none is needed, since every frame is whole.
  A `publish_id` that does not rise by 1 is a missed frame, which the next frame repairs, so it can be logged without ending the connection.
- Keepalive: `ping_every` can stay `None`, because the WebSocket library answers the server's protocol Ping every 30 s with a Pong, and S6 counts that as activity.
  If a client ping is wanted, the documented one is the text frame `ping`, whose `pong` reply `handle` must skip.
- `maxSilence`: 10 s is safe, because every book and ticker sends at least once a second.
- Unknown markets: a wrong name is acknowledged `ok` and stays silent, so the runtime's first book watch is what catches it.
- Compression: offer none, as the runtime already does.
- CCXT Pro is not a model here, because it opens the dead v2 URL, aggregates with group `10`, and subscribes the refused `ticker` channel.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | [Introduction](https://docs.derive.xyz/getting-started/introduction), retrieved 2026-10-12 | endpoints |
| S2 | [Subscriptions](https://docs.derive.xyz/subscriptions), retrieved 2026-10-12 | channels, frames, limits, private channels |
| S3 | `https://docs.derive.xyz/subscriptions.asyncapi.json` and `https://docs.derive.xyz/websocket.asyncapi.json`, retrieved 2026-10-12 | channel list and payload schemas |
| S4 | [Orderbook channel](https://docs.derive.xyz/api-reference/channels/orderbook), retrieved 2026-10-12 | book payload, `publish_id` |
| S5 | [Migration skill for your coding agent](https://docs.derive.xyz/migrating/breaking-changes), retrieved 2026-10-12 | v2 and v3 hosts |
| S6 | [Connecting over WebSocket](https://docs.derive.xyz/connecting), retrieved 2026-10-12 | heartbeat, connection cap, reconnect |
| S7 | [Rate Limits](https://docs.derive.xyz/rate-limits) and [Error Codes](https://docs.derive.xyz/error-codes), retrieved 2026-10-12 | per-IP limits, `-32100` |
| S8 | [Instrument Names](https://docs.derive.xyz/trading/instrument-names), retrieved 2026-10-12 | name format, universe suffix |
| P1, P2 | [`ws-probe.py`](../../../scripts/probes/venues/derive/ws-probe.py), modes `edge`, `books`, `group` and `legacy` | every probed value |
| CCXT | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/derive.js` lines 31, 89, 138 and 155, and `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/derive.js` lines 96, 636 and 678 | CCXT Pro's socket, CCXT's market fields |
