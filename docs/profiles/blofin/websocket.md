# BloFin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, three runs between 03:24 and 03:38 UTC on 2026-09-23, from the development host near Seattle, where every upgrade request was refused with HTTP 403 before it reached BloFin's origin.

This profile covers the public WebSocket of BloFin (CCXT id `blofin`) for its perpetual families, with the book channel in detail.
No frame could be captured, because Cloudflare refuses the handshake from this host with BloFin's restricted region page, see section 1.
So every protocol claim below is documented only, from an Internet Archive copy of the API reference dated 2025-10-31 (S1) and from CCXT Pro 4.5.68 (S2), and the probed column records the refusal.
No proxy, VPN or other route to the socket was used.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| all public market data | `wss://openapi.blofin.com/ws/public`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/blofin.js` line 37 | HTTP 403 `text/html`, 5,313 bytes, restricted region page, in 45 to 108 ms over nine handshakes in three runs, colo `SEA` or `YVR`, P1 and P2 |
| demo trading | `wss://demo-trading-openapi.blofin.com/ws/public`, S1, and CCXT Pro line 45 | HTTP 403, the same page, in 49 to 160 ms over three runs, P1 |
| private | `wss://openapi.blofin.com/ws/private`, and `wss://openapi.blofin.com/ws/copytrading/private` for copy trading, S1 | not probed |

The documentation names one public URL for every instrument, and its channels take an `instId` such as `BTC-USDT`, so one socket would carry USDT-M, USDC-M and coin-M streams alike, S1.
That is Not verified on the wire.
Each refusal carried `server-timing: cfEdge;dur=2` to `cfEdge;dur=64` and `cfOrigin;dur=0`, so the Cloudflare edge answered without asking the origin, P1 and P2.
The refusal body reads "We noticed that your IP address is from one of BloFin's restricted countries or regions. Unfortunately, BloFin is not able to provide service to users in these regions under our Terms and Conditions.", see [`fees.md`](./fees.md) section 1.

## 2. Channel matrix for public market data

All from S1, none probed.

| channel | args | depth and speed | carries |
|---|---|---|---|
| `books` | `{"channel": "books", "instId": "BTC-USDT"}` | 200 levels in the first snapshot, then increments every 100 ms | snapshot then deltas with `prevSeqId` and `seqId` |
| `books5` | same, `books5` | 5 levels, a whole snapshot every 100 ms when the top 5 change | snapshots only |
| `tickers` | same, `tickers` | "the fastest interval 1 second" | last, best bid and ask with sizes, 24 h stats, no mark, index or funding |
| `funding-rate` | same, `funding-rate` | "the fastest interval 30 second" | `fundingRate`, `fundingTime` |
| `trades` | same, `trades` | on every trade, one trade per update | |
| `candle<bar>`, `index-candle<bar>`, `mark-price-candle<bar>` | same, for example `candle1D` | "the fastest interval 1 second" for `candle<bar>` | candles of the last, index and mark prices |

No dedicated mark or index channel exists apart from the candle channels, so the anchor has to come from REST, see [`rest.md`](./rest.md) section 3.
CCXT Pro reads only `books` and refuses any other book channel, at `server/node_modules/ccxt/js/src/pro/blofin.js` lines 189 and 190.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The probed column is the same for every row, because no socket opened.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for every family, S1 | refused, HTTP 403 |
| subscribe frame shape | `{"op": "subscribe", "args": [{"channel": "books", "instId": "BTC-USDT"}]}`, several args per frame, and "the total length of multiple channels cannot exceed 4,096 bytes", S1 | refused |
| unknown symbol expectation | `{"event": "error", "code": "60012", "msg": "Invalid request: …"}` is the documented failure, and what an unknown `instId` gets is Not publicly specified, S1 | refused |
| chunk unit and budget | one arg per `instId` and channel, 4,096 bytes of args per frame, no per connection cap published, S1 | refused |
| keepalive mechanism | client sends the string `ping` when nothing arrived for N seconds, N below 30, and expects `pong`, S1, and CCXT Pro sends `'ping'` at `pro/blofin.js` lines 70 and 71 | refused |
| connection lifetime and maintenance notice | "The connection will break automatically if the subscription is not established or data has not been pushed for more than 30 seconds.", no maintenance notice channel, S1 | refused |
| handshake and operation rate limits | "New Connections: 1 per second per IP", S1 | refused, all twelve handshakes of three runs got 403, paced 1.5 s apart within a run |
| public market data authentication | none, "This channel uses public WebSocket and authentication is not required.", S1 | refused before any subscription, HTTP 403 at the upgrade |
| message parse and routing | `{"arg": {"channel", "instId"}, "action": "snapshot" or "update", "data": {…}}`, route on `arg.instId`, S1 | refused |
| subscribe acknowledgement shape | `{"event": "subscribe", "arg": {"channel": "books", "instId": "BTC-USDT"}}`, S1 | refused |
| symbol identifier format | `BTC-USDT`, the REST `instId`, which CCXT uses as `market.id` at `blofin.js` line 511 | refused |
| number representation | the text says levels are `["411.8", "10"]` strings, while the push example shows JSON numbers, `[1639.75, 392]`, S1, and CCXT Pro's comment also shows numbers | refused, so which one the wire sends is Not verified |
| timestamp representation | `data.ts` as a string of Unix ms, S1 | refused |
| size unit | "the quantity at the price (number of contracts)", S1, and one contract is `contractValue` base units, which CCXT reads as `contractSize` | refused |
| sequence semantics | per `instId`, `prevSeqId` of a message equals `seqId` of the previous one, and a snapshot has `prevSeqId` 0, S1 | refused |
| idle repeat behaviour | Not publicly specified | refused |

## 4. The book channel in detail

`books` is the channel this profile would recommend, and everything here is documented only.

### Snapshot on subscribe

"After subscribing to the incremental load push (such as books 200 levels) of Order Book Channel, users first receive the initial full load of market depth.", S1.
The snapshot is `"action": "snapshot"` with up to 200 levels per side and `"prevSeqId": "0"`, S1.
Whether a later snapshot can arrive on a live stream is Not publicly specified, so a feed resets on every snapshot.

### Delta semantics

An update is `"action": "update"` with `asks` and `bids` arrays of changed levels.
"If there is the same price, compare the size. If the size is 0, delete this depth data. If the size changes, replace the original data.", S1.
A new price is inserted in order, bids descending and asks ascending, S1.
CCXT Pro applies the same rule with `handleDeltasWithKeys` at `pro/blofin.js` lines 230 to 234, and it never checks the sequence.

### Sequence and gap rule

```text
action = snapshot                        replace the book, last = seqId
action = update, prevSeqId = last        apply, last = seqId
action = update, prevSeqId != last       gap: resync
```

"Each instId has an unique set of sequence ID.", "The prevSeqId in the new message matches with seqId of the previous message.", and "In snapshot messages the prevSeqId is always 0.", S1.
The set is the same for every connection to the same channel, S1.
The documentation shows `seqId` 107600747 then 107600806, so ids skip, and only the `prevSeqId` link is the rule, S1.
Whether an idle book sends updates that only move the id is Not publicly specified.

### Checksum

None is documented, and the word does not occur in the reference, S1.

### Level order on the wire

The snapshot example lists asks ascending and bids descending, and the merge rule sorts the local book the same way, S1.
The order of levels inside an update is Not publicly specified, so a feed applies deltas by price.

### Level window

The snapshot has 200 levels and nothing documents whether a level falling out of the 200 is sent as a deletion.
The engine keeps 20 levels per side, at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61, so a 200 level window is enough for it either way.

### Size unit against CCXT `contractSize`

Book sizes are contracts, S1, and CCXT sets `contractSize` from `contractValue` at `server/node_modules/ccxt/js/src/blofin.js` line 560.
In the archived catalog of 2026-09-16 `contractValue` is `0.001` on `BTC-USDT`, `0.0001` on `BTC-USDC` and `1000` on `1000BONK-USDT`, see [`rest.md`](./rest.md) section 2.
So the engine's `sizeMul` would convert linear sizes correctly, but that is Not verified against a socket and a REST book at the same instant.
The 14 coin-M rows are the exception, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books, idle repeats, unknown and closed symbols

All Not verified, since no socket opened.
The documented `instId` error is `60012` "Invalid request" in the examples, S1.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | send the string `ping` after N seconds without a message, N below 30, expect `pong`, S1, and the connection management section asks for a ping "every 20-30 seconds" | refused |
| silence the server tolerates | 30 s without a subscription or without pushed data, S1 | refused |
| forced disconnect | Not publicly specified | refused |
| maintenance notice | Not publicly specified | refused |
| compression | Not publicly specified | a handshake that offered permessage-deflate got the same 403, P1 |
| handshake | 1 new connection per second per IP, S1 | 403 in 45 to 160 ms over twelve handshakes in three runs, P1 and P2 |
| subscription limits | 4,096 bytes of args per subscribe frame, S1 | refused |
| throughput | | not measured |

A subscribe arg such as `{"channel":"books","instId":"BTC-USDT"}` is 39 bytes, so a frame holds roughly 90 to 100 args.

## 6. Captured frames

No WebSocket frame was captured.
The only answer this host received is the HTTP upgrade refusal, printed by [`ws-probe.mjs`](../../../scripts/probes/venues/blofin/ws-probe.mjs) `access`.

```json
{"tag":"handshake","url":"wss://openapi.blofin.com/ws/public","offeredDeflate":false,"status":403,"type":"text/html","colo":"SEA","serverTiming":"cfEdge;dur=25,cfOrigin;dur=0","bytes":5313,"restricted":true,"ms":100}
```

The frames below are the documentation's own examples, S1, reformatted to one line and cut with `…` where marked, and not captures.

Subscribe and its acknowledgement.

```json
{"op": "subscribe", "args": [{"channel": "books", "instId": "BTC-USDT"}]}
```

```json
{"event": "subscribe", "arg": {"channel": "books", "instId": "BTC-USDT"}}
```

Snapshot, two levels per side kept.

```json
{"arg": {"channel": "books", "instId": "ETH-USDT"}, "action": "snapshot", "data": {"asks": [[1639.75, 392], [1639.95, 541]], "bids": [[1639.7, 6817], [1639.65, 4744]], "ts": "1696670727520", "prevSeqId": "0", "seqId": "107600747"}}
```

Update, which links to the snapshot by `prevSeqId`.

```json
{"arg": {"channel": "books", "instId": "ETH-USDT"}, "action": "update", "data": {"asks": [[1639.95, 2208], [1640, 4605]], "bids": [[1639.65, 7115], [1639.6, 4791]], "ts": "1696670728525", "prevSeqId": "107600747", "seqId": "107600806"}}
```

Error.

```json
{"event": "error", "code": "60012", "msg": "Invalid request: {\"op\": \"subscribe\", \"args\":[{ \"channel\" : \"books\", \"instId\" : \"BTC-USDT\"}]}"}
```

Funding rate push.

```json
{"arg": {"channel": "funding-rate", "instId": "BTC-USDT"}, "data": [{"instId": "BTC-USDT", "fundingRate": "0.0001875391284828", "fundingTime": "1700726400000"}]}
```

The keepalive is the bare text `ping`, answered by the bare text `pong`, which is not JSON, S1.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://openapi.blofin.com/ws/private` and a `login` operation.

- `positions`, `orders`, `orders-algo`, `account` and `inverse-account`.
- Copy trading uses `copytrading-positions`, `copytrading-sub-positions`, `copytrading-orders` and `copytrading-account` on `wss://openapi.blofin.com/ws/copytrading/private`.
- CCXT Pro builds the login at `server/node_modules/ccxt/js/src/pro/blofin.js` line 807.

## 8. Recommended feed shape

A recommendation for a host that BloFin serves, not a decision, and every row rests on documentation that was not checked on the wire.
From this host there is no feed to build, because the upgrade is refused.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://openapi.blofin.com/ws/public`, for the USDT-M markets the registry keeps | one public URL serves every instrument, S1 |
| channel | `books`, arg `{"channel": "books", "instId": <rawMarketId>}` | snapshot on subscribe and a per `instId` link, 200 levels covers the engine's 20 |
| markets per connection | 90 per subscribe frame, and a slice size found by a probe from a served host | the 4,096 byte cap on args, and no per connection cap is published |
| connections | open them at most one per second | "New Connections: 1 per second per IP", S1 |
| keepalive | the text `ping` every 20 s, and count `pong` as traffic | the server drops a socket after 30 s without pushed data |
| `maxSilenceMs` | 45,000 | two missed pongs, until a probe measures how long a quiet book stays silent |
| routing | `arg.instId` is the `rawMarketId` | the REST `instId` is CCXT's `market.id` |
| snapshot | `action === 'snapshot'`: `resetBook` and store `seqId` | documented replace semantics |
| delta | apply only when `prevSeqId === last`, then store `seqId` | documented link, S1 |
| resync | a broken link, or an update before any snapshot: `resync` | the engine's existing path |
| numbers | `Number()` of each level value | the documentation shows both strings and numbers |
| deflate | keep `perMessageDeflate: false` | compression is not documented |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BloFin API Documents, Internet Archive copy of 2025-10-31 | https://web.archive.org/web/20251031005137/https://docs.blofin.com/index.html | 2026-09-22, live page HTTP 403 to this host and to WebFetch | BloFin, global | URLs, channels, book rules, sequence, limits, keepalive, examples, sections 1 to 8 |
| S2 | CCXT Pro 4.5.68 `blofin.js` | `server/node_modules/ccxt/js/src/pro/blofin.js` | 2026-09-22 | CCXT | URLs, `books` only, ping, delta merge, login, sections 1 to 7 |
| S3 | CCXT 4.5.68 `blofin.js` | `server/node_modules/ccxt/js/src/blofin.js` | 2026-09-22 | CCXT | `market.id` and `contractSize`, sections 3 and 4 |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/blofin/ws-probe.mjs) `access`, live, demo and a deflate offer | | 2026-09-23 03:24, 03:33 and 03:37 UTC | this host | the 403 upgrade refusal, sections 1, 5 and 6 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/blofin/ws-probe.mjs) `book` | | 2026-09-23 03:25, 03:34 and 03:37 UTC | this host | stopped at the same 403 before any subscription, section 1 |
