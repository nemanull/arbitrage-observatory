# Hyperliquid WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-23.

**Probed:** 2026-09-23 in the local evening, which is 2026-09-24 from 06:31 to 06:57 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the public WebSocket API of Hyperliquid (CCXT id `hyperliquid`), the first decentralised venue researched for the engine, with the book channel in detail.
Its perpetual families are the first dex, USDC-margined and run by the validators, and the builder-deployed HIP-3 dexes, and one socket carries both.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC, and the probe runs are listed as P1 to P8 in section 9.
Fees and access are in [`fees.md`](./fees.md), the info API and the anchor in [`rest.md`](./rest.md), and HyperCore blocks, the node and the HIP-3 oracles in [`2026-09-23-hyperliquid-dex.md`](../../research/2026-09-23-hyperliquid-dex.md).
The work follows [`2026-09-23-hyperliquid-research-plan.md`](../../plans/2026-09-23-hyperliquid-research-plan.md).
The engine code cited is the TypeScript server, which moved during this session and sits at [`old_ts_server/`](../../../old_ts_server/) at the time of writing.
CCXT 4.5.68 is cited from the root pnpm store, because `server/node_modules` was removed during the same session.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every family, mainnet | `wss://api.hyperliquid.xyz/ws`, S2 | open in 189 to 220 ms, P1 to P3 and P5 to P8 |
| testnet | `wss://api.hyperliquid-testnet.xyz/ws`, S2 | not probed |

One socket carries every family.
In P1 to P3 one socket delivered `l2Book` for the first-dex perps `BTC`, `ETH`, `MON`, `NOT` and `kPEPE` and for the HIP-3 perp `xyz:SP500`, together with `activeAssetCtx` on `xyz:SP500` and `allMids` for dex `xyz`.
In P4 the same kind of socket also acknowledged and served the spot books `PURR/USDC` and `@107`.
`api.hyperliquid.xyz` resolved to 3.175.64.60, 3.175.64.74, 3.175.64.84 and 3.175.64.89, and the upgrade reply carried `server: nginx/1.22.1`, `via: … (CloudFront)`, `x-cache: Miss from cloudfront` and `x-amz-cf-pop: YVR52-P3`, P1 to P3.
So the socket terminates at a CloudFront edge in Vancouver from this exit, and the origin behind it was not identified.

## 2. Channel matrix for public market data

Cadences are over about 60 s per run, and "one push clock" means every subscribed coin arrived with the same `time` value.

| channel | subscription | payload | documented cadence, S1 | probed |
|---|---|---|---|---|
| `l2Book` | `{"type":"l2Book","coin":"BTC"}` | whole book, 20 levels per side | "Snapshot feed, pushed on each block that is at least 0.5 since last push" | one push clock for every coin, push interval p50 5,359 to 5,408 ms and max 5,592 ms, 1,490 to 1,734 bytes, P1 to P3 and P5 |
| `l2Book` fast | `{"type":"l2Book","coin":"BTC","fast":true}` | whole book, 5 levels per side | "5 levels if fast, 20 levels if slow" | one push clock, interval p50 537 to 538 ms, min 469 and max 664 ms, 460 to 472 bytes, P2, P3 and P6 |
| `l2Book` aggregated | adds `nSigFigs` 2 to 5, and `mantissa` 1, 2 or 5 with `nSigFigs` 5 | 20 levels per side in price buckets | S6 | 20 levels at bucket steps of 1, 2, 5, 10, 100 and 1,000 USDC on `BTC` near 84,143, on the same 5 s clock, P2 and P3 |
| `bbo` | `{"type":"bbo","coin":"BTC"}` | best bid and ask, each `{px, sz, n}` or null | "sent only if the bbo changes on a block" | 5.2 to 7.9 frames a second on `BTC`, gaps from 7 ms, and 6 to 13 frames a minute on `NOT`, 142 to 151 bytes, P1 to P3 and P6 |
| `trades` | `{"type":"trades","coin":"BTC"}` | array of trades with both user addresses | "An array of trade updates." | 1.3 to 4.3 frames a second on `BTC`, P1 to P3, and the first frame held trades from about 20 s before the subscription, P3 |
| `allMids` | `{"type":"allMids"}` or with `"dex":"xyz"` | mid per coin | "All mid prices." Spot mids only with the first dex | 12 frames a minute and a mean gap of 5,049 ms in P3, 1,103 keys and 19,355 to 19,374 bytes on the first dex, 2,584 to 2,589 bytes for `xyz`, P1 to P3 |
| `activeAssetCtx` | `{"type":"activeAssetCtx","coin":"BTC"}` | `funding`, `openInterest`, `prevDayPx`, `dayNtlVlm`, `premium`, `oraclePx`, `markPx`, `midPx`, `impactPxs`, `dayBaseVlm` | not stated | 0.99 frames a second on `BTC`, `NOT` and `xyz:SP500`, P1 to P3, a mean gap of 1,008 to 1,009 ms in P3, 299 to 316 bytes |
| `allDexsAssetCtxs` | `{"type":"allDexsAssetCtxs"}` | the same context for every asset of every dex | "Asset contexts across all dexs" | 5 frames a minute, P1 to P3, a mean gap of 13,614 ms in P3, 116,571 to 116,731 bytes each |
| `fastAssetCtxs` | `{"type":"fastAssetCtxs"}` | `markPx` and `midPx` per coin, compressed | "base64 encoded and compressed" | 0.99 frames a second, P1 to P3, a mean gap of 1,005 ms in P3, a base64 string of raw deflate, section 5 |
| `candle` | `{"type":"candle","coin":"BTC","interval":"1m"}` | OHLCV of the open candle | intervals `1m` to `1M` | 0.9 to 1.8 frames a second on `BTC`, P1 to P3 |
| `outcomeMetaUpdates` | `{"type":"outcomeMetaUpdates"}` | "Changes to the outcome meta" | | not probed |
| `explorerBlock` | `{"type":"explorerBlock"}` | | not in S1's list | not probed here. The P3 run of [`2026-09-23-hyperliquid-dex.md`](../../research/2026-09-23-hyperliquid-dex.md) section 1 saw it acknowledged, then one frame `[]` and nothing more in 60 s |

No dedicated mark, index or funding channel exists apart from the asset context channels.
`activeAssetCtx` is keyed by coin, but it takes one subscription per coin.
`allDexsAssetCtxs` covers every asset at once, but its context objects carry no coin name and must be joined by position to each dex's `meta` universe, see section 6.
The June 2026 change that slowed these feeds is described by a secondary source, S9: `l2Book` moved to "20 levels every 2 seconds" with a later move to 5 seconds, mids to "Every 5 seconds", and asset contexts to "Every 15 seconds".
S9 also says `fastAssetCtxs` keeps "the original 5-second interval".
The wire matches the 5 s stage for `l2Book` and `allMids`, shows `allDexsAssetCtxs` at about 13.6 s, and pushed `fastAssetCtxs` every second.
The official subscriptions page, S1, still describes `l2Book` as pushed every 0.5 s, which is now true only of `fast`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one mainnet URL, S2 | one socket carried first-dex perps, a HIP-3 perp and spot books, section 1 |
| subscribe frame shape | `{"method":"subscribe","subscription":{"type":"trades","coin":"SOL"}}`, one `subscription` object per frame, S2 | a `coin` array answered a parse error, P4. 356 frames sent in 1.7 s were each acknowledged, P6 |
| unknown symbol expectation | Not publicly specified | the socket is closed with code 1006, no close frame and no error message, within 90 to 155 ms where timed, which ends every other subscription on it. The same happens for a lowercase coin, an uppercase dex prefix, a HIP-3 name without its prefix, `nSigFigs` 6, and `mantissa` without `nSigFigs` 5, in all three runs of P4 |
| chunk unit and budget | 1,000 subscriptions per IP, and 2,000 messages sent per minute across all sockets of an IP, S5 | 356 subscriptions on one socket with no refusal, P6. The caps were not approached |
| keepalive mechanism | client sends `{"method":"ping"}`, server answers `{"channel":"pong"}`, S3 | pong in 89 and 93 ms, P2 and P3. No server protocol ping on any socket, P1 to P8 |
| connection lifetime and maintenance notice | "all automated users should handle disconnects from the server side and gracefully reconnect", S2. No notice channel is documented | no forced close in 75 s, P7, and no notice seen |
| handshake and operation rate limits | 10 connections and 30 new connections a minute per IP, S5 | 8 sockets opened one after another within about 40 s, with no refusal, in each run of P4. Opens took 189 to 220 ms, P1 to P3 and P5 to P8 |
| public market data authentication | none | none. The user channels take an address and no signature, section 7 |
| message parse and routing | `{channel, data}`, S1 | route on `channel`, then `data.coin` for `l2Book`, `bbo` and `activeAssetCtx`, `data[i].coin` for `trades`, `data.s` for `candle`, and `data.dex` for `allMids` of a builder dex |
| subscribe acknowledgement shape | `channel` set to `subscriptionResponse`, S1 | `{"channel":"subscriptionResponse","data":{"method":"subscribe","subscription":{…}}}` echoing the subscription with defaults filled, as `"nSigFigs":null,"mantissa":null,"fast":false`. The acknowledgement came before the first snapshot. An unsubscribe is acknowledged the same way with `"method":"unsubscribe"` |
| symbol identifier format | the `name` from `meta` for a perp, `dex:COIN` for HIP-3, `PURR/USDC` or `@{index}` for spot, S6 | `BTC`, `kPEPE`, `xyz:SP500`, spelled on data frames exactly as subscribed. CCXT's `market.id` is the numeric asset index, not this name, section 4 |
| number representation | `WsLevel` has `px` and `sz` as strings and `n` as a number. `PerpsAssetCtx` and `Candle` fields are typed as numbers, S1 | levels match the documentation. The asset context fields and the candle `o`, `c`, `h`, `l` and `v` arrive as strings, while `t`, `T` and `n` are numbers |
| timestamp representation | `time` in ms, S1 | integer ms. Every coin in one `l2Book` push carries the same `time`, section 4 |
| size unit | base asset units, see [`rest.md`](./rest.md) section 2 | coins of the named asset, which matches CCXT `contractSize` 1. A `k` prefix means thousands, section 4 |
| sequence semantics | none documented | no sequence number and no checksum. Every book frame is whole. `time` never went backwards in two runs of 2,314 default frames and in 21,503 fast frames, P5 and P6 |
| idle repeat behaviour | not documented | `l2Book` resends an unchanged book with a new `time` on every push. `bbo` sends only on a change, and never repeated itself, P6 |

## 4. The book channel in detail

### Snapshot semantics

Every `l2Book` frame is the whole book, whether default or `fast`, and there is no delta, no update id and no checksum.
All 2,314 default frames on the 178 listed first-dex perps held 20 bids and 20 asks in each run of P5, and all 21,503 `fast` frames held 5 and 5, P6.
A REST `l2Book` read whose `time` equalled a socket frame's `time` matched it on 40 of 40 levels, including `n`, P2.
So a feed resets the book on every frame, and a missed frame costs nothing but freshness.

The first snapshot arrives 101 to 287 ms after the subscribe burst begins, with its own `time`, and then the coin joins the shared push clock, P1 to P3.

### Push cadence and the block

Pushes are driven by one clock for the whole socket.
In P5 the 178 coins arrived in bursts of 178 frames sharing one `time`, with 17 distinct `time` values in about 65 s in each run, and the seconds that held frames held 8 to 178 of them with a median of 178 and 170.
The default interval between pushes was p10 5,003 and 5,059 ms, p50 5,359 and 5,366 ms, and max 5,574 and 5,584 ms, in the two runs of P5.
With `fast` on every coin the interval was p10 521 ms, p50 538 ms and max 664 ms, again with 178 coins per `time`, P6.

`bbo` is pushed per block rather than per clock.
Over 178 coins the distinct `bbo` times were spaced min 45 ms, p50 68 ms and max 156 ms, P6, which is the block spacing as far as the socket shows it.
Block production itself is covered in [`2026-09-23-hyperliquid-dex.md`](../../research/2026-09-23-hyperliquid-dex.md).
On `BTC` the `l2Book` top equalled the latest `bbo` received in 11 of 11 comparisons in each of P1 to P3, and 1, 6 and 6 of 12 book `time` values were also `bbo` times.

### Age at arrival

`time` is the venue's instant of the snapshot, and arrival minus `time` is the age a feed receives.
The host clock was 5.7 ms from its NTP source by `systemd-timesyncd` at about 06:41 UTC.

| stream | age at arrival | runs |
|---|---|---|
| default `l2Book`, 7 coins | min 262, p50 341 to 397, max 789 ms | P1 to P3 |
| default `l2Book`, 178 coins | min 240 and 273, p50 601 and 584, p90 700 and 753, max 811 and 937 ms | P5, two runs |
| `fast`, 178 coins | min 255, p50 295, p90 380, max 873 ms | P6 |
| `bbo`, `BTC` | min 195 to 213, p50 260 to 276 ms | P1 to P3 |
| `bbo`, 178 coins | min 200, p50 254, p90 347, max 549 ms | P6 |

A 178-coin default push is about 279,000 bytes, and its arrivals spread over the 274 and 344 ms between the p10 and p90 ages.
Held until the next push, a default book reaches about 6.5 s of age at worst, 5,592 ms plus 937 ms, and a `fast` book about 1.5 s, 664 ms plus 873 ms.

### Aggregation

`nSigFigs` and `mantissa` bucket prices and keep 20 levels per side.
On `BTC` near 84,143 USDC the step between bid levels was 1 at `nSigFigs` null or 5, 2 with `mantissa` 2, 5 with `mantissa` 5, 10 at 4, 100 at 3 and 1,000 at 2, P2 and P3.
Aggregated books ride the same 5 s clock.
`nSigFigs` 6, or `mantissa` 2 with `nSigFigs` 4, closes the socket, P4.
The engine wants raw prices, so aggregation is context only.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| default and `fast` snapshots | best first, descending, with 0 exceptions in 26,131 frames, P5 and P6 | best first, ascending, with 0 exceptions |
| crossed book | 0 frames with the best bid at or above the best ask, P5 and P6 | |

### Size unit against CCXT `contractSize`

| coin | CCXT `contractSize` | socket size at the touch | meaning |
|---|---:|---|---|
| `BTC` | 1 | `"10.25923"` at 84,143.0 | 10.25923 BTC |
| `kPEPE` | 1 | `"2058973.0"` at 0.004411 | 2,058,973 kPEPE, which is 2.06 billion PEPE at 0.000004411 each |
| `xyz:SP500` | 1 | `"8.066"` at 7,673.3 | 8.066 units of the index perp |

Sizes are units of the named asset, and CCXT sets `contractSize` 1 for every perp at `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hyperliquid.js` line 1044, so the engine's `sizeMul` is right as is.
The six `k` coins, `kPEPE`, `kSHIB`, `kBONK`, `kLUNC`, `kFLOKI` and `kNEIRO`, are priced and sized per 1,000 tokens, P1.
CCXT names the base `KPEPE`, so meeting another venue's `1000PEPE` or `PEPE` needs the price scale described in [`rest.md`](./rest.md) section 2.

### Market id against the socket coin

CCXT's `market.id` for a perp is the asset index as a string, `"0"` for `BTC` on the first dex, and 110,000 plus the coin's position for the first builder dex, at `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hyperliquid.js` lines 737, 633 and 1023.
The socket coin is CCXT's `market.baseName`, taken from the universe `name` at lines 992 and 1029.
The engine uses `market.id` as `rawMarketId` at [`connector.ts`](../../../old_ts_server/src/ccxt/connector.ts) line 170, and `rawMarketId` must be the symbol exactly as the socket spells it, at [`types.ts`](../../../old_ts_server/src/engine/cluster/types.ts) line 11.
So Hyperliquid needs `rawMarketId` taken from `market.baseName` or `market.info.name`, and subscribing `"0"` as a coin would close the socket.

### HIP-3 coin names

A builder-dex coin is the lowercase dex name, a colon and the asset, as in `xyz:SP500`.
`perpDexs` listed 10 dexes, `xyz`, `flx`, `vntl`, `hyna`, `km`, `abcd`, `cash`, `para`, `mkts` and `io`, and `xyz` had 109 listed perps, P1 to P3.
`XYZ:SP500` and the bare `SP500` each closed the socket, P4.
CCXT turns `xyz:SP500` into the base `XYZ-SP500` at line 994, so a HIP-3 base never clusters with another venue's ticker unless an override maps it.

### One-sided and empty books

The delisted `MATIC` sent `{"levels":[[],[]]}` on every push, 12 of 12 frames in each of P1 to P3, and `bbo` on `MATIC` was acknowledged and then silent for the 1.2 s the case waited, P4.
No listed first-dex perp had an empty side in P5 or P6.
The engine's `resetBook` at [`VenueFeed.ts`](../../../old_ts_server/src/feeds/book/VenueFeed.ts) line 263 accepts an empty side.

### Idle repeats

A quiet book is resent unchanged with a new `time`.
In P5, 37 and 39 of 2,314 default frames repeated the previous book, and `NOT` repeated 7 and 6 of its 13.
In P6, 5,426 of 21,503 `fast` frames repeated, `TRX` 117 of 122 and `NOT` 114 of 121.
8 `fast` frames carried the same `time` as the previous frame for their coin, P6.
`bbo` did not repeat in 22,989 frames, P6, and `NOT` went 34.6, 21.7 and 12.7 s without one in P1 to P3, while one coin in P6 went 45.8 s.

### Unknown, closed and malformed subscriptions

| request | reply | socket |
|---|---|---|
| `l2Book` or `bbo` on `NOPE` | none | closed in 102 to 110 ms, code 1006 |
| `l2Book` on `btc` | none | closed in 100 to 101 ms |
| `l2Book` on `XYZ:SP500` | none | closed in 101 to 114 ms |
| `l2Book` on `SP500` | none | closed in 103 to 155 ms |
| `l2Book` with `nSigFigs` 6, or `nSigFigs` 4 with `mantissa` 2 | none | closed in 90 to 94 ms |
| `l2Book` on the delisted `MATIC` | acknowledged | empty books every push |
| `l2Book` on `PURR/USDC` or `@107` | acknowledged | spot books delivered |
| `l2Book` on `SOL` twice | the second answers `Already subscribed: {"type":"l2Book","coin":"SOL","nSigFigs":null,"mantissa":null,"fast":false}` | stays open |
| unsubscribe of a stream never subscribed | `Already unsubscribed: {…}` | stays open |
| unknown `type`, unknown `method`, missing `subscription`, a `coin` array, text that is not JSON | `Error parsing JSON into valid websocket request: <the frame>` | stays open |
| `post` without `id` | the same parse error | stays open |
| `post` of `l2Book` on `NOPE` | `"payload":{"type":"l2Book","data":null}` | stays open |

The close times are from the second and third runs of P4, and the first run saw the same closes within its 1.2 s wait.
Because one bad coin ends every stream on the socket, a feed has to subscribe only names read from the live `meta` universe of each dex.

### REST and post snapshots against the socket

The REST `l2Book` `time` was 490 and 530 ms old at arrival, P2 and P3, and in P1 and P3 it was 573 and 1,689 ms newer than the last default push.
A `post` of `l2Book` over the socket answered 20 and 20 levels whose `time` was 604 and 362 ms old at arrival, P2 and P3.
So both serve a snapshot refreshed far more often than the default push, and the matching 40 of 40 levels in P2 suggests one snapshot source for both.
That the source refreshes at the 0.5 s `fast` cadence is an inference, and [`rest.md`](./rest.md) section 5 saw two REST reads 458 and 538 ms apart.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"method":"ping"}` answered by `{"channel":"pong"}`, S3. The Python SDK pings every 50 s, S7, and CCXT Pro every 20 s, `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/pro/hyperliquid.js` lines 55 to 57 and 1598 to 1602 | pong in 89 and 93 ms, P2 and P3, and at 30 and 60 s on the pinging socket, P7 |
| silence the server tolerates | "The server will close any connection if it hasn't sent a message to it in the last 60 seconds.", S3 | a socket that subscribed to nothing and sent nothing closed at 60.2 s with code 1006 and no close frame, P7. A socket that sent only pings every 30 s stayed open for 75 s, P7. A subscribed socket that sent nothing after its subscribe burst stayed open for 66 s, P5. So the clock counts frames the server sends |
| forced disconnect | the server may disconnect, S2 | none in 75 s |
| maintenance notice | none documented | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, P8 twice. `fastAssetCtxs` compresses inside the frame, as base64 of raw deflate that Node's `zlib.inflateRawSync` reads, first frame 15,966 to 16,025 bytes of base64 to 71,519 to 71,869 bytes of JSON, P1 to P3, with 1,592 keys, and later frames p50 156 keys, P3, and 2,573 to 2,725 bytes a frame on average, P1 to P3 |
| handshake | | 189 to 220 ms to open from this host, P1 to P3 and P5 to P8 |
| subscription limits | 1,000 subscriptions, 10 connections, 30 new connections a minute, 2,000 messages sent a minute and 100 inflight posts per IP, S5 | not approached. 356 streams on one socket, P6 |
| post requests | `{"method":"post","id":<n>,"request":{"type":"info","payload":{…}}}`, answered on channel `post` with the same `id`, S4. Explorer requests are not supported | as documented, section 4 |
| throughput, default | | 178 `l2Book`: 32.6 frames a second on average in bursts of 178 every 5.4 s, 49.9 KiB a second, 1,567 bytes a frame, 26.1 and 23.1 µs of `JSON.parse` a frame, 2.3 and 2.2 ms of user CPU a second, P5 two runs |
| throughput, `fast` and `bbo` | | 178 `fast` plus 178 `bbo` on one socket: 672.3 frames a second, 194.6 KiB a second, 6.1 µs of `JSON.parse` a frame, 12.9 ms of user and 1.2 ms of system CPU a second, P6. `fast` alone was 326.3 frames and 146.7 KiB a second at 460 bytes a frame, and `bbo` 345.9 frames and 47.9 KiB a second at 142 bytes |

The main-dex universe held 234 perps on 2026-09-24, 178 listed and 56 delisted, P1 to P3.
`fast` plus `bbo` on every listed first-dex perp is 356 of the 1,000 subscriptions an IP may hold.
The 109 listed `xyz` perps at two streams each would bring that to 574, so the per-IP cap binds before the socket does once several builder dexes are included.
A reconnect that resubscribes 356 streams spends 356 of the 2,000 messages an IP may send in a minute.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-24.
Level arrays are cut to three per side, and the values are as received.
Blocks marked `text` are cut mid-frame and are not valid JSON.

Subscribe, the default book and the fast book.

```json
{"method":"subscribe","subscription":{"type":"l2Book","coin":"BTC"}}
```

```json
{"method":"subscribe","subscription":{"type":"l2Book","coin":"BTC","fast":true}}
```

Acknowledgements, P2.

```json
{"channel":"subscriptionResponse","data":{"method":"subscribe","subscription":{"type":"l2Book","coin":"BTC","nSigFigs":null,"mantissa":null,"fast":true}}}
```

```json
{"channel":"subscriptionResponse","data":{"method":"unsubscribe","subscription":{"type":"l2Book","coin":"BTC","nSigFigs":5,"mantissa":null,"fast":false}}}
```

Default snapshot, P3, whose 20 levels per side are cut to 3.

```json
{"channel":"l2Book","data":{"coin":"BTC","time":1790232236546,"levels":[[{"px":"84143.0","sz":"10.25923","n":36},{"px":"84142.0","sz":"1.65875","n":7},{"px":"84141.0","sz":"1.12923","n":2}],[{"px":"84144.0","sz":"50.66449","n":18},{"px":"84150.0","sz":"0.00711","n":2},{"px":"84151.0","sz":"0.01782","n":1}]]}}
```

A `k` coin and a HIP-3 coin, P3.

```json
{"channel":"l2Book","data":{"coin":"kPEPE","time":1790232236546,"levels":[[{"px":"0.004411","sz":"2058973.0","n":5},{"px":"0.00441","sz":"7447326.0","n":10},{"px":"0.004409","sz":"6589982.0","n":9}],[{"px":"0.004413","sz":"5803647.0","n":11},{"px":"0.004414","sz":"7003446.0","n":9},{"px":"0.004415","sz":"8257858.0","n":15}]]}}
```

```json
{"channel":"l2Book","data":{"coin":"xyz:SP500","time":1790232237073,"levels":[[{"px":"7673.3","sz":"8.066","n":2},{"px":"7673.1","sz":"6.824","n":1},{"px":"7673.0","sz":"0.1","n":3}],[{"px":"7673.4","sz":"5.324","n":6},{"px":"7673.6","sz":"0.13","n":1},{"px":"7673.7","sz":"3.692","n":3}]]}}
```

A delisted coin, P3.

```json
{"channel":"l2Book","data":{"coin":"MATIC","time":1790232237073,"levels":[[],[]]}}
```

Best bid and ask, P3.

```json
{"channel":"bbo","data":{"coin":"BTC","time":1790232237145,"bbo":[{"px":"84143.0","sz":"10.25923","n":36},{"px":"84144.0","sz":"50.66422","n":18}]}}
```

Asset context, P3, with every value a string.

```json
{"channel":"activeAssetCtx","data":{"coin":"BTC","ctx":{"funding":"0.0000018952","openInterest":"36585.31848","prevDayPx":"86627.0","dayNtlVlm":"4161029539.6949653625","premium":"-0.0006413454","oraclePx":"84198.0","markPx":"84148.0","midPx":"84143.5","impactPxs":["84143.0","84144.0"],"dayBaseVlm":"49116.08533"}}}
```

All dexes' contexts, P3, where the first entry is the first dex, named by the empty string, and its contexts follow the `meta` universe order with no coin field.

```text
{"channel":"allDexsAssetCtxs","data":{"ctxs":[["",[{"funding":"0.0000018952","openInterest":"36585.31848","prevDayPx":"86627.0","dayNtlVlm":"4161029539.6949653625","premi…
```

Fast asset contexts, P3, and the start of the first frame after base64 decoding and raw inflate.

```text
{"channel":"fastAssetCtxs","data":"lX3ZcmNJcuW/ZL/KMLEv+QSQRJKoxMIGQCYz32okG1Nb9TImacZaI9O/j8eNiAuGH8/i7XqjF4C8S4SH+/Hjx//r09pp/+nzf336y6//9tvz3z99/qRW8dM/ffrLn/6l/eU//fc…
```

```text
{"@415":{"markPx":"0.7","midPx":"0.5"},"io:EWY":{"markPx":"184.92","midPx":"184.97"},"#14740":{"markPx":"0.38926","midPx":"0.389265"},"#14880":{"markPx":"0.118925","midPx":"0.118925"},"#39831":{"markPx":"0.048805","midPx":"0.048805"},"NEO":{"markPx":"2.5533","midPx":"2.5526"},…
```

Mids, P3, where the first dex's map mixes perps, spot `@` keys and `#` keys this profile did not identify.

```text
{"channel":"allMids","data":{"mids":{"#12090":"0.44865","#12091":"0.55135","#12100":"0.01035",…
{"channel":"allMids","data":{"dex":"xyz","mids":{"xyz:AAOI":"99.8285","xyz:AAPL":"336.355","xyz:ALUMINIUM":"3080.0",…
```

Trade and candle, P3.

```json
{"channel":"trades","data":[{"coin":"BTC","side":"A","px":"84143.0","sz":"0.00036","time":1790232216193,"hash":"0x7ab608dad75f7ce37c2f044516391f02023a00c072529bb51e7eb42d965356ce","tid":1045359869404765,"users":["0x9aa589355bf745db9784c8ef3c646360f11b58af","0x8269c0a4f5f1a14582e0aa46856a234893c41970"]}]}
```

```json
{"channel":"candle","data":{"t":1790232180000,"T":1790232239999,"s":"BTC","i":"1m","o":"84143.0","c":"84143.0","h":"84144.0","l":"84143.0","v":"14.27847","n":114}}
```

Keepalive.

```json
{"method":"ping"}
```

```json
{"channel":"pong"}
```

Post request and its reply, P2.

```json
{"method":"post","id":1,"request":{"type":"info","payload":{"type":"l2Book","coin":"BTC"}}}
```

```text
{"channel":"post","data":{"id":1,"response":{"type":"info","payload":{"type":"l2Book","data":{"coin":"BTC","time":1790231719005,"levels":[[{"px":"84143.0","sz":"22.64478","n":71},{"px":"84142.0","sz":"0.94523","n":4},…
```

Errors, P4.

```json
{"channel":"error","data":"Already subscribed: {\"type\":\"l2Book\",\"coin\":\"SOL\",\"nSigFigs\":null,\"mantissa\":null,\"fast\":false}"}
```

```json
{"channel":"error","data":"Error parsing JSON into valid websocket request: {\"method\":\"subscribe\",\"subscription\":{\"type\":\"bbo\",\"coin\":[\"BTC\",\"ETH\"]}}"}
```

```json
{"channel":"post","data":{"id":7,"response":{"type":"info","payload":{"type":"l2Book","data":null}}}}
```

## 7. Private channels

Named for a future execution stage, from S1 and S7, not probed.

- The user channels are `orderUpdates`, `userFills`, `userFundings`, `userNonFundingLedgerUpdates`, `userEvents`, `notification`, `webData3`, `clearinghouseState`, `openOrders`, `spotState`, `activeAssetData`, `twapStates`, `userTwapSliceFills`, `userTwapHistory` and `allDexsClearinghouseState`.
- Each takes a `user` address and no signature, so any account can be watched, and an IP may watch at most 10 distinct users, S5.
- Order entry over the socket is a `post` with `"type":"action"` and a signed payload, as CCXT Pro builds it at `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/pro/hyperliquid.js` lines 1622 to 1625.
  The observatory never sends one.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.hyperliquid.xyz/ws`, for every family | one socket carries first-dex perps, HIP-3 perps and spot |
| book channel | `l2Book` with `"fast":true` for the book, and `bbo` for the touch | default `l2Book` is 20 levels but about 5.4 s apart, `fast` is 5 levels every 0.54 s, and `bbo` follows every block |
| merge | on a `fast` frame, `resetBook` with its 5 levels and `publish`. On a `bbo` frame newer than the last snapshot, drop the bids above the new best bid and the asks below the new best ask, set both touch levels, and `publish` | the touch then moves per block, and the deeper levels stay at most one `fast` push old |
| depth | accept 5 levels, or add a default `l2Book` on a second socket for a 20-level view every 5 s | `fast` and default frames carry the same channel and coin, so the two cannot share a socket |
| markets per connection | every listed first-dex perp on one socket, 178 today, as 356 streams | 672 frames a second and 195 KiB a second parsed at 6.1 µs a frame, P6 |
| subscribe frames | one frame per stream, `{"method":"subscribe","subscription":{"type":"l2Book","coin":"<name>","fast":true}}` and `{"method":"subscribe","subscription":{"type":"bbo","coin":"<name>"}}`, paced at 20 frames per 100 ms | a coin array is refused, and 356 paced frames were all acknowledged |
| catalog guard | subscribe only names read from the live `meta` universe of each dex, and skip `isDelisted` | one unknown name closes the socket with every stream on it |
| `rawMarketId` | `market.baseName` or `market.info.name`, a named change in the connector | CCXT's `market.id` is the asset index |
| keepalive | `{"method":"ping"}` every 30 s | the server closes after 60 s without sending, and the pong also counts as traffic for the silence watch |
| `maxSilenceMs` | 10,000 | `fast` pushes every coin every 0.54 s, even when unchanged |
| routing | `channel`, then `data.coin` | the coin is spelled as subscribed |
| sequence and resync | no gap rule, because every book frame is whole. Resync only on close or silence | no update id exists |
| close right after subscribing | log every coin sent in the second before a close | an unknown coin gives no error message |
| receive time | stamp on arrival, and keep `time` to judge the book's age | a `fast` snapshot is 0.26 to 0.87 s old on arrival and a default one up to 0.94 s, section 4 |
| deflate | keep `perMessageDeflate: false`, at [`VenueFeed.ts`](../../../old_ts_server/src/feeds/book/VenueFeed.ts) line 81 | the server does not negotiate it |
| anchor | keep the REST poll of [`rest.md`](./rest.md) section 8 rather than `allDexsAssetCtxs` | `allDexsAssetCtxs` pushes about every 13.6 s, older than the reader's 10 s limit, and its contexts carry no coin name. `activeAssetCtx` is keyed by coin at 1 s but costs one subscription per coin, and on `BTC` its `markPx` and `oraclePx` each changed on 6 of 59 pushes in P3, while [`rest.md`](./rest.md) section 4 counted 8 and 6 changes over 29 one-second REST polls |

The feed fits the engine's `VenueFeed` without a new base class.
`planEndpoints` returns one plan, `getSubscribeFrames` returns one frame per stream, `startKeepalive` sends the ping, and `handleMessage` calls `resetBook` and `publish`, at [`VenueFeed.ts`](../../../old_ts_server/src/feeds/book/VenueFeed.ts) lines 263, 280 and 387 to 390.
The `bbo` merge is new logic, and the engine's 20 levels at [`Engine.ts`](../../../old_ts_server/src/engine/Engine.ts) line 61 and [`ClusterIndexBuilder.ts`](../../../old_ts_server/src/engine/cluster/ClusterIndexBuilder.ts) line 17 would hold 5.
A book that updates every block at full depth needs a non-validator node and the official order book server, S10, whose `l2book` takes `n_levels` up to 100 and whose `l4book` sends a snapshot and then order diffs by block.
That route is weighed in [`2026-09-23-hyperliquid-dex.md`](../../research/2026-09-23-hyperliquid-dex.md).

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hyperliquid Docs, WebSocket, Subscriptions | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions | 2026-09-23 | Hyperliquid, docs | subscription shapes, data types, `l2Book` and `bbo` cadence sentences, `fast`, acknowledgement, private channel names, sections 2 to 4 and 7 |
| S2 | Hyperliquid Docs, WebSocket | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket | 2026-09-23 | Hyperliquid, docs | URLs, subscribe example, reconnect advice, sections 1, 3 and 5 |
| S3 | Hyperliquid Docs, WebSocket, Timeouts and heartbeats | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats | 2026-09-23 | Hyperliquid, docs | 60 s rule, ping and pong, sections 3 and 5 |
| S4 | Hyperliquid Docs, WebSocket, Post requests | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/post-requests | 2026-09-23 | Hyperliquid, docs | post frame and reply, section 5 |
| S5 | Hyperliquid Docs, Rate limits and user limits | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits | 2026-09-23 | Hyperliquid, docs | per-IP socket limits, sections 3, 5 and 7 |
| S6 | Hyperliquid Docs, Info endpoint | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint | 2026-09-23 | Hyperliquid, docs | coin naming, `nSigFigs` and `mantissa` values, sections 2 and 3 |
| S7 | hyperliquid-python-sdk `websocket_manager.py` | https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/websocket_manager.py | 2026-09-23 | Hyperliquid, official SDK | ping every 50 s, routing keys, section 5 |
| S8 | hyperliquid-python-sdk `utils/types.py` | https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/types.py | 2026-09-23 | Hyperliquid, official SDK | field names of `L2BookData`, `BboData`, `PerpAssetCtx`, section 3 |
| S9 | Quicknode, Hyperliquid Foundation WebSocket Changes, published 2026-06-12 | https://www.quicknode.com/blog/hyperliquid-foundation-websocket-changes | 2026-09-23 | third party, secondary | the June 2026 cadence change and `fastAssetCtxs`, section 2 |
| S10 | hyperliquid-dex `order_book_server` README | https://github.com/hyperliquid-dex/order_book_server | 2026-09-23 | Hyperliquid, official repository | node-side `l2book` with `n_levels` and `l4book`, section 8 |
| S11 | CCXT Pro 4.5.68 `hyperliquid.js` | `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/pro/hyperliquid.js` | 2026-09-23 | CCXT | URL, keepalive 20 s, ping frame, default `l2Book` in `watchOrderBook` at lines 226 to 244, post action, sections 5 and 7 |
| S12 | CCXT 4.5.68 `hyperliquid.js` | `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hyperliquid.js` | 2026-09-23 | CCXT | `id` as asset index, `baseName`, `contractSize` 1, HIP-3 base names, section 4 |
| P1 | `ws-probe.mjs book` at 06:31 UTC, whose second socket was closed by its first case, an unknown coin | [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs) | 2026-09-24 | this host | sections 1, 2 and 4 from the first socket |
| P2 | `ws-probe.mjs book` at 06:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs) | 2026-09-24 | this host | sections 1 to 6 |
| P3 | `ws-probe.mjs book`, the rerun at 06:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs) | 2026-09-24 | this host | sections 1 to 6 |
| P4 | `ws-probe.mjs errors` at 06:34, 06:42 and 06:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs) | 2026-09-24 | this host | sections 3 and 4 |
| P5 | `ws-probe.mjs batch` at 06:37 and 06:56 UTC, default `l2Book` on 178 perps, the second run loading `ws` 8.21.1 from the root pnpm store through `NODE_PATH` because `server/node_modules` had been removed by then | [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs) | 2026-09-24 | this host | sections 3 to 5 |
| P6 | `ws-probe.mjs batch fast,bbo` at 06:39 UTC on 178 perps | [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs) | 2026-09-24 | this host | sections 3 to 5 and 8 |
| P7 | `ws-probe.mjs silence` at 06:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs) | 2026-09-24 | this host | section 5 |
| P8 | `ws-probe.mjs deflate` at 06:31 and 06:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hyperliquid/ws-probe.mjs) | 2026-09-24 | this host | section 5 |
