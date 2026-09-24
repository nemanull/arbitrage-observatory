# AstralX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, which is 2026-09-23 06:41 to 07:02 UTC, from the development host near Seattle through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures WebSocket of AstralX for its USDT-margined perpetuals, with the book topic in detail.
AstralX publishes no WebSocket documentation, see [`rest.md`](./rest.md) section 2.
The URL, the frame shapes and the topic names below were read out of the `www.astralx.com` web front's JavaScript on 2026-09-23 UTC, S14, and every claim was then captured by [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs).
So the "documented" column of the axes table says what the web front's code does, since no other documentation exists.
Every socket was opened through the Canadian VPN exit, and Cloudflare answered from its `SEA` and `YVR` edges.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-margined perpetuals | `wss://fws.astralx.com/future/websocket`, the web front appends `?lang=<locale>&timeZone=GMT<offset>` | open in 235 to 332 ms over the nine probe sockets whose open time was logged, no query string needed |
| private futures stream | `wss://ufws.astralx.com/future/ws/user` | not probed |
| spot | `wss://sws.astralx.com/spot/websocket` | not probed |
| TradFi and standard contracts | `wss://stws.astralx.com/tradfi/websocket` | not probed |

The hosts come from the web front's config object, which builds `fws`, `sws`, `stws`, `usws`, `ufws`, `ustws`, `stock` and `ustock` by replacing `www` in the page host, S14.
One socket carried every USDT perpetual asked for, and there is only one perpetual family.
`fws.astralx.com` resolves to Cloudflare, 104.18.6.45 and 104.18.7.45, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| topic | subscribe frame | push | probed on 2026-09-23 UTC |
|---|---|---|---|
| `depth_full` | `{"id": "<any>", "topic": "depth_full", "event": "sub", "symbol": "BTCUSDT_PERP", "params": {"binary": false}}` | the whole book, up to 400 levels per side, about every 200 ms | recommended, section 4 |
| `depth` | same shape | none | acknowledged as success, then no frame in 4 s on `ETHUSDT_PERP`, two runs |
| `diffDepth` | same shape | none | `{"code":550007,"msg":"Invalid topic"}` |
| `mark_price` | `params` `{type: 0, binary, realtimeInterval}` in the web front, `{"type": 0, "binary": false}` in the probe | one frame per second per symbol, field `price` | 59 frames in 60 s, median gap 1,000 ms, two runs |
| `index_price` | `params` `{"binary": false, "org": <id>}` in the web front, `org` not needed | one frame per second per symbol, field `p` | 59 frames in 60 s, median gap 1,000 ms, two runs |
| `feeRate` | same shape | funding rate, next and last settlement, every 10 s | 6 frames in 60 s, gaps 9,998 to 10,023 ms, two runs |
| `tickers` | `params` `{org, realtimeInterval, binary}` in the web front, no `symbol` | not probed | |
| `trade`, `kline`, `mark_kline`, `index_kline` | named in the web front | not probed | |

The topic names come from the web front's subscribe calls, S14.
The mark and index topics are per symbol, so they cannot replace a bulk anchor call for 32 contracts without 64 subscriptions, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented (the web front's code, S14) | probed |
|---|---|---|
| endpoint split axis | one host per product: `fws` for perpetuals, `sws` spot, `stws` TradFi | one URL for all 51 perpetual ids |
| subscribe frame shape | `{id, topic, event: "sub", symbol, params: {binary}}`, one symbol per frame | one symbol per frame, 51 frames sent in 1 to 3 ms, all acknowledged |
| unknown symbol expectation | not handled | `NOPEUSDT_PERP`, the hidden `AUCTIONUSDT_PERP` and the spot spelling `BTCUSDT` are each acknowledged `"code":0,"msg":"Success"` and then silent for 4 s |
| chunk unit and budget | none | 51 subscriptions on one socket, 33 delivered at 93 frames per second median, section 5 |
| keepalive mechanism | the client sends the text `ping` every 3 s and drops a text `pong` | the server answers `ping` and `{"ping": 1}` with `{"pong":<server ms>}` in 100 or 101 ms. No server protocol ping on any socket |
| connection lifetime and maintenance notice | reconnect after 5 s, up to five times | no forced close in 120 s. No maintenance frame seen |
| handshake and operation rate limits | none | no refusal at 51 subscribe frames in one burst |
| public market data authentication | none | none |
| message parse and routing | route on `topic`, then `id` | every data frame repeats `topic`, `symbol` and the request `id`, and `data.s` names the contract |
| subscribe acknowledgement shape | `{code, event, f, id, msg, params, sendTime, symbol, topic}` | `{"code":0,"event":"sub","f":false,"id":…,"msg":"Success",…}`. The first book frame arrives before the acknowledgement with the same `sendTime` |
| symbol identifier format | `<BASE>USDT_PERP` | the REST ticker `s` and the funding `tokenId` spell the same 51 ids, the futures page `symbolId` spells the 32 listed ones the same way, and `data.s` of the 33 delivering books equalled the id subscribed |
| number representation | strings | book prices and sizes are strings. The first book frame writes some levels unpadded, `"86431.9"`, and later frames write `"86458.8000"` and sizes `"689.54000"`. `mark_price.price` and `index_price.p` are JSON numbers |
| timestamp representation | ms | `data.t`, `sendTime`, mark `time` in integer ms. The first mark and index frame can carry a `t` 46 s older than `sendTime` |
| size unit | contracts | contracts of `contractMultiplier` coins, section 4 |
| sequence semantics | none | no sequence field. Every frame is a whole book |
| idle repeat behaviour | none | 2 and 4 of about 250 BTC frames repeated the previous book exactly, 21 and 34 of about 155 GIGGLE frames |

## 4. The book topic in detail

### Snapshot on subscribe

Every `depth_full` frame is a whole book, so there is no separate snapshot and no delta.
The first frame arrives before the acknowledgement and differs from the rest in two ways.
Its bids are ascending, worst first, on 5 of 5 contracts in both `book` runs, while every later frame has descending bids.
Some of its numbers are unpadded, such as the asks `["86431.9","662.04"]` in the frame quoted in section 6, where every later frame pads prices to four and sizes to five decimals.
A feed that sorts each side by price, or applies levels by price, handles both.

### Levels and cadence

| contract | frames in 60 s | median gap | p90 gap | bid levels | ask levels |
|---|---:|---:|---:|---|---|
| `BTCUSDT_PERP` | 238 and 256 | 200 ms | 401 and 400 ms | 187 to 400 and 373 to 400 | 394 to 400 and 237 to 400 |
| `ETHUSDT_PERP` | 222 and 200 | 201 and 202 ms | 401 and 410 ms | 185 to 400 and 287 to 400 | 381 to 400 and 304 to 400 |
| `SOLUSDT_PERP` | 161 and 153 | 400 ms | 600 ms | 382 to 400 and 398 to 400 | 394 to 400 |
| `GIGGLEUSDT_PERP` | 160 and 154 | 398 and 399 ms | 600 and 608 ms | 395 to 400 and 383 to 400 | 398 to 400 and 392 to 400 |

The pairs are the two `book` runs at 06:48 and 06:57 UTC.
The median and p90 gaps are multiples of 200 ms, which suggests a 200 ms publish timer that sometimes skips a tick.
No frame in either run was crossed, one-sided or empty.
The frame's `data.t` was 51 ms before arrival at the minimum and 53 ms at the median, with a clock offset of 1 to 3 ms, see [`rest.md`](./rest.md) section 7.

### Sequence and gap rule

None exists and none is needed.
Each frame replaces the book, so a lost frame costs at most one 200 ms tick.

### Checksum

None.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| first frame after subscribe | ascending, worst first | ascending, best first |
| every later frame | descending, best first, 0 exceptions in both runs | ascending, best first, 0 exceptions |

### Size unit against the contract multiplier

The sizes are contracts, and one contract is `contractMultiplier` coins, 0.01 BTC for `BTCUSDT_PERP`, see [`rest.md`](./rest.md) section 2.
The ticker `v` of `BTCUSDT_PERP`, 593,329.19, times 0.01 times a price near 86,000 gives about the ticker `qv` of 511,602,052 USDT, which fits contracts of 0.01 BTC and not coins, `rest-probe.mjs catalog` at 06:55 UTC.
There is no CCXT `contractSize` to compare against, because there is no CCXT class.

### The book is the OKX book

`ws-probe.mjs mirror` read the AstralX book of five contracts and, at the same moment, the OKX REST book of the same OKX contract, `<BASE>-USDT-SWAP` at 400 levels.

| contract | top 20 AstralX prices found in the OKX book, bids and asks | touch equal to OKX | median AstralX size over OKX size at the same price |
|---|---|---|---|
| BTC | 20 of 20 and 20 of 20, in all 4 reads | 4 of 4 | 1.0, and 0.92 on one ask read |
| ETH | 20 of 20 and 20 of 20, in all 4 reads | 4 of 4 | 0.9 to 1.0 |
| SOL | 20 of 20 and 20 of 20, in all 4 reads | 4 of 4 | 0.9 |
| XRP | 20 of 20 and 20 of 20, in all 4 reads | 2 of 4, the bid one tick apart on the other two | 0.3 to 0.613 |
| DOGE | 20 of 20 and 20 of 20, in all 4 reads | 4 of 4 | 0.9 to 0.917 |

The four reads are two rounds in each of two runs, at 06:50 and 06:58 UTC, with the AstralX frame 68 to 334 ms older than the OKX reply in the second run.
The OKX sizes are OKX contracts, and the AstralX contract multipliers equal OKX's `ctVal` on these five contracts, so the ratio compares like with like.
Against Binance USDⓈ-M the same levels matched 0 to 20 of 20, and the Binance touch differed from AstralX's on BTC and ETH in all four reads, so Binance is not the source.
The AstralX contract multiplier equals the OKX `ctVal`, and the AstralX tick equals the OKX `tickSz`, on 32 of 32 listed contracts, `rest-probe.mjs catalog` at 07:07 UTC, see [`rest.md`](./rest.md) section 2.
So the AstralX perpetual book is the OKX book at the same prices, with sizes scaled to about 90 % of OKX's on most contracts.
Whether an AstralX order fills against OKX or against a market maker that quotes OKX's book cannot be known without an account.
For the engine it means an AstralX leg duplicates an OKX leg about 50 ms later, and a cross between AstralX and OKX would be that lag, not a price.
The mark and the index are OKX's as well, see [`rest.md`](./rest.md) section 4.

### One-sided and empty books

None seen on the five contracts of the two `book` runs, over 1,571 frames.
`PNUTUSDT_PERP`, one of the 19 ids the futures page hides, sent one book frame and then nothing in 45 s in the second `batch` run.

### Idle repeats

A frame can repeat the previous book exactly, 2 and 4 times in about 250 BTC frames and 21 and 34 times in about 155 GIGGLE frames.
Every frame's `data.t`, repeats included, was within 301 ms of its arrival, so a repeat is a fresh push of an unchanged book and not a stale cache.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `depth_full` `NOPEUSDT_PERP` | `"code":0,"msg":"Success"` | nothing in 4 s |
| `depth_full` `AUCTIONUSDT_PERP`, a hidden id | success | nothing in 4 s, and nothing in 45 s in `batch` |
| `depth_full` `BTCUSDT`, the spot spelling | success | nothing in 4 s |
| `depth_full` `BTCUSDT_PERP` twice on one socket | two acknowledgements and two first frames | 19 and 20 frames in 4 s, about one stream |
| topic `depth` | success | nothing in 4 s |
| topic `diffDepth` or `nope` | `{"code":550007,"msg":"Invalid topic"}` | the socket stays open |
| `params.binary` true | success | book frames in binary WebSocket frames whose payload is plain JSON text, not compressed, 14,741 to 19,711 bytes |
| text `hello` | `{"code":550001,"msg":"Server error"}` | close 1000 `Bye` at 103 and 105 ms |
| `event` `unSub` | stops the stream, 1 frame after | |
| `event` `cancel` | ignored, 151 and 140 more frames | |

Because an unknown or hidden id is acknowledged as success, a feed has to notice a stream with no frame on its own.
The web front passes a binary frame to an `inflate(…, {to: "string"})` call, which is the pako API, S14, but the server sent plain JSON even when asked for binary.

## 5. Session

| item | web front code | probed |
|---|---|---|
| keepalive | text `ping` every 3 s | `{"pong":<server ms>}` in 100 and 101 ms. No server protocol ping on any socket |
| silence the server tolerates | not handled | a socket with no subscription and no client frame closed with 1006 and no close frame at 60.24 s and 60.26 s. A subscribed socket that never pinged, and an unsubscribed socket that pinged every 10 s, each stayed open for the full 120 s and 70 s holds |
| forced disconnect | reconnect after 5 s | none in 120 s. Text that is not JSON closes the socket, section 4 |
| maintenance notice | none | none seen |
| compression | none requested, binary frames passed to `inflate` | a client that offered permessage-deflate got no `sec-websocket-extensions` header back in two runs |
| handshake | | 235 to 332 ms |
| subscription limits | | none reached at 51 on one socket |
| throughput | | 51 ids on one socket, 33 delivering: median 93 frames per second both runs, 1,775,794 and 1,765,626 bytes per second, 18,606 and 18,469 bytes per frame |
| parse cost | | `JSON.parse` median 378 and 354 µs, p90 826 and 901 µs, max 1,617 and 1,564 µs per book frame of about 17.6 KB |

A whole 400-level book up to five times a second costs about 1.8 MB per second and about 35 ms of `JSON.parse` per second for 33 contracts.
Gate's incremental channel carried 150 contracts in 103 KB per second at 233 bytes per frame, see [`../gate/websocket.md`](../gate/websocket.md) section 5, so AstralX sends about 80 times the bytes per frame.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays keep the first three levels.

Subscribe.

```json
{"id": "depth_full_BTCUSDT_PERP", "topic": "depth_full", "event": "sub", "symbol": "BTCUSDT_PERP", "params": {"binary": false}}
```

First book frame, which comes before the acknowledgement, with bids ascending and unpadded asks.

```json
{"code":0,"data":{"a":[["86431.9","662.04"],["86432","0.92"],["86432.1","0.01"]],"b":[["86369.3000","0.91000"],["86369.4000","0.03000"],["86369.5000","163.29000"]],"s":"BTCUSDT_PERP","t":1790146632038},"event":"sub","f":false,"id":"depth_full_BTCUSDT_PERP","msg":"Success","params":{"binary":false},"sendTime":1790146632038,"symbol":"BTCUSDT_PERP","topic":"depth_full"}
```

Acknowledgement.

```json
{"code":0,"event":"sub","f":false,"id":"depth_full_BTCUSDT_PERP","msg":"Success","params":{"binary":false},"sendTime":1790146632038,"symbol":"BTCUSDT_PERP","topic":"depth_full"}
```

A later book frame, bids descending.

```json
{"code":0,"data":{"a":[["86533.0000","1216.49000"],["86533.1000","18.04000"],["86533.2000","18.01000"]],"b":[["86532.9000","832.72000"],["86532.8000","30.08000"],["86532.7000","0.03000"]],"s":"BTCUSDT_PERP","t":1790145744017},"event":"sub","f":false,"id":"depth_full","msg":"Success","params":{"binary":false},"sendTime":1790145744017,"symbol":"BTCUSDT_PERP","topic":"depth_full"}
```

Mark and index of the same second, equal.

```json
{"code":0,"data":{"price":86534.4,"symbolId":"BTCUSDT_PERP","symbolName":"BTCUSDT_PERP","time":1790145744340},"event":"sub","f":false,"id":"mark","msg":"Success","params":{"binary":false},"sendTime":1790145744382,"symbol":"BTCUSDT_PERP","topic":"mark_price"}
```

```json
{"code":0,"data":{"p":86534.4,"s":"BTCUSDT_PERP","sn":"BTCUSDT_PERP","t":1790145744320},"event":"sub","f":false,"id":"idx","msg":"Success","params":{"binary":false},"sendTime":1790145744382,"symbol":"BTCUSDT_PERP","topic":"index_price"}
```

First index frame of a quiet contract, 46 s older than its `sendTime`.

```json
{"code":0,"data":{"p":42.19,"s":"GIGGLEUSDT_PERP","sn":"GIGGLEUSDT_PERP","t":1790146586435},"event":"sub","f":false,"id":"index_price_GIGGLEUSDT_PERP","msg":"Success","params":{"binary":false},"sendTime":1790146632382,"symbol":"GIGGLEUSDT_PERP","topic":"index_price"}
```

Funding.

```json
{"code":0,"data":{"curServerTime":"1790146633382","fundingRate":0.0000222625656446,"lastSettleTime":1790121600000,"nextSettleTime":1790150400000,"settleRate":0.0000222625656446,"tokenId":"BTCUSDT_PERP"},"event":"sub","f":false,"id":"feeRate_BTCUSDT_PERP","msg":"Success","params":{"binary":false},"sendTime":1790146633382,"symbol":"BTCUSDT_PERP","topic":"feeRate"}
```

Keepalive, the client sends the text `ping`.

```json
{"pong":1790146130688}
```

Errors.

```json
{"code":550007,"msg":"Invalid topic"}
```

```json
{"code":550001,"msg":"Server error"}
```

## 7. Private channels

Named for a future execution stage, from S14, not probed.
The web front opens `wss://ufws.astralx.com/future/ws/user` after login and reads `balance` frames from it.
The other account topics it names are `position`, `order` and `futures_tradeable`.
No API documentation names a private channel for an API key, see [`rest.md`](./rest.md) section 2.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and the venue is not recommended, see [`rest.md`](./rest.md) section 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://fws.astralx.com/future/websocket` | one family |
| topic | `depth_full`, one subscribe frame per contract | the only book topic that delivers |
| markets per connection | all 32 on one socket | 51 ran on one socket at 93 frames per second |
| subscribe frames | `{"id": "<rawMarketId>", "topic": "depth_full", "event": "sub", "symbol": "<rawMarketId>", "params": {"binary": false}}` | the web front's shape |
| keepalive | text `ping` every 15 s | the server answers `{"pong":…}`, which is traffic for the silence watch, and it never pings |
| `maxSilenceMs` | 10,000 | the longest gap between two book frames of one contract was 850 ms, a quiet contract still repeats frames, and a pong comes every 15 s |
| routing | `data.s` gives the `rawMarketId` | |
| every frame | `resetBook` with both sides sorted by price | each frame is the whole book, and the first frame's bids are ascending |
| resync | none on sequence. A stream with no frame 5 s after its acknowledgement is logged as unserved | unknown and hidden ids are acknowledged and silent |
| never send | text that is not JSON | the server closes the socket |
| receive time | stamp on arrival | `data.t` is about 50 ms before arrival and a first frame can be tens of seconds old |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

The ids are shared by the three AstralX files, so an id that one file does not use is missing from its table.

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S14 | `www.astralx.com` web front JavaScript: the config object in chunk `6353-8b2c4ccebb467228.js`, the socket client in chunks `3733-babba09a63f8958c.js` and `350-90308b781b10cdac.js`, the futures page in `app/[locale]/futures/[symbol]/page-b9bb3824b42f92c1.js` | https://www.astralx.com/_next/static/chunks/6353-8b2c4ccebb467228.js | 2026-09-23 | global | hosts, topics, frame shapes, ping, reconnect, private stream, sections 1 to 7. Chunk names change with each deploy |
| S18 | OKX public REST books, mark price and index tickers | https://www.okx.com/api/v5/market/books | 2026-09-23 | OKX | the mirror comparison, section 4 |
| S19 | Binance USDⓈ-M public REST depth | https://fapi.binance.com/fapi/v1/depth | 2026-09-23 | Binance | the control comparison, section 4 |
| P2 | `ws-probe.mjs book`, two runs at 06:48 and 06:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 2 to 6 |
| P3 | `ws-probe.mjs errors`, two runs at 06:50 and 06:59 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 3 and 4 |
| P4 | `ws-probe.mjs mirror`, two runs at 06:50 and 06:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | section 4 |
| P5 | `ws-probe.mjs batch` and `deflate`, two runs at 06:51 and 07:00 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 3 and 5 |
| P6 | `ws-probe.mjs silence`, a 120 s run at 06:52 UTC and a 70 s run at 07:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | section 5 |
| P7 | exploration sockets before the probe existed, 06:41 to 06:43 UTC, one of which supplied the later book frame and the mark and index pair quoted in section 6 | scratch script, not kept | 2026-09-23 | this host, Canadian exit | section 6 |
