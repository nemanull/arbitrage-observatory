# BtcTurk WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:18 to 03:37 UTC, from the development host near Seattle.

This profile covers the public spot WebSocket of BtcTurk | Kripto (CCXT id `btcturk`), since the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/btcturk/ws-probe.mjs), and the capture is quoted beside the documented value.
Run 1 is `book` at 03:24, `batch` at 03:25, `silence` at 03:26 and `deflate` at 03:28 UTC, and run 2 repeats each at 03:32, 03:33, 03:34 and 03:36 UTC.
The quiet pairs are chosen by the probe as the lowest 24 h notional per quote: `ORCAUSDT` in both runs, `FLRTRY` in run 1 and `ORCATRY` in run 2.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, TRY and USDT pairs | `wss://ws-feed-pro.btcturk.com`, S2 | open in 397 to 495 ms over eight sockets, HTTP 101 through Cloudflare, `cf-ray` suffix `SEA` or `YVR` |
| sandbox | `wss://ws-feed-sandbox.btctrader.com`, in the C# example of S1 only | not probed |

One URL carries every pair and every public channel.
The documentation says the servers are in Azure West Europe behind Cloudflare, S4, and the hostname resolved to the Cloudflare addresses `104.18.37.73` and `172.64.150.183`, see [`rest.md`](./rest.md) section 1.
CCXT 4.5.68 has no Pro class for BtcTurk, see [`fees.md`](./fees.md) section 8, so there is no second reading of the protocol.

## 2. Channel matrix for public market data

| channel | subscribe `event` | model | depth and speed | probed |
|---|---|---|---|---|
| `obdiff` | pair, `BTCUSDT` | 431 snapshot, then 432 deltas | 100 levels per side, one frame per pair about every 764 ms | snapshot on subscribe, then a ChangeSet chain with 0 gaps, recommended |
| `orderbook` | pair | 431 whole book every push | 100 levels per side, about every 761 to 769 ms when the book changed | a whole book each time, never an unchanged repeat |
| `ticker` | pair | 402 `TickerPair` with best bid, ask and their amounts | 79 frames in 60 s on `BTCUSDT` in both runs | 53 and 57 of 79 were byte identical to the previous frame |
| `ticker` | `all` | 401 `TickerAll`, 379 items | 78 and 79 frames in 60 s | every frame held all 379 pairs |
| `trade` | pair | 421 batch of the last 50 trades on subscribe, then 422 single trades | on trade | the 421 batch came, and no 422 arrived in 60 s on `BTCUSDT` |
| `tradeview` | `BTCTRY_60` style | 428 current candle | resolutions 1 to 240 minutes, `1D`, `1W`, `1M` | not probed |

The channel names, model numbers and fields are from S1 and S3.
No mark, index or funding channel exists, because nothing on the venue has one.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S2 | one URL carried TRY and USDT pairs and every public channel |
| subscribe frame shape | `[151,{"type":151,"channel":"CHANNEL_NAME","event":"PAIRSYMBOL","join":true}]`, one channel and one event per frame, S1 | as documented. A frame with an array `event`, a frame that is an object rather than an array, and a frame of type 999 got no reply and no data |
| unknown symbol expectation | Not publicly specified | `obdiff` `NOPETRY` is acknowledged `ok: true` and sends nothing. Lowercase `btcusdt`, `all`, and an unknown channel `nope` are also acknowledged `ok: true` and send nothing |
| chunk unit and budget | "Sending subscription requests to WebSocket channels is not counted in these limits.", S5 | 379 subscribe frames sent in 4 and 5 ms on one socket, all 379 acknowledged `ok: true`, all 379 snapshots within 1,322 and 1,260 ms |
| keepalive mechanism | Not publicly specified | the server sends a WebSocket protocol ping every 15.0 s, first at 15.4 s. No application ping exists in the documentation |
| connection lifetime and maintenance notice | Not publicly specified, the status page is `https://status.btcturk.com/`, S6 | no lifetime cap in 110 s, no notice frame seen |
| handshake and operation rate limits | "WebSocket connections are limited to a maximum of 15 connection requests per minute. If this limit is exceeded, new connection requests will be temporarily blocked for 60 seconds.", S5 | not tested, no minute of probing opened more than three sockets |
| public market data authentication | none, the HMAC login is for private models only, S2 | none |
| message parse and routing | a JSON array `[type, model]`, S1 | route on `model.PS` for 431 and 432, and on the first element for the model type |
| subscribe acknowledgement shape | model 100 `Result` with `ok` and `message`, S1 | `[100,{"type":100,"ok":true,"message":"join|obdiff:BTCUSDT"}]`, and `ok: false` for a duplicate. A model 991 frame `{"type":991,"current":"6.0.0","min":"2.3.0"}` arrived first on every socket whose frames the probe logged |
| symbol identifier format | upper case pair name, `BTCTRY`, S1 | `PS` equals the REST `name` and CCXT `market.id`, see [`rest.md`](./rest.md) section 2. The socket is case sensitive, the REST book is not |
| number representation | strings for price and amount, S1 | price `P` and amount `A` are decimal strings, `CS` and `CP` are JSON integers |
| timestamp representation | none on book models, S1 | 431 and 432 carry no timestamp, so a feed stamps on arrival |
| size unit | "A, amount" of the order, S1 | base asset, equal to the REST book amount at the same price, section 4 |
| sequence semantics | "ChangeSet. Change number. It comes in the form of sequential values. There is no control at this time.", S1 | `CS` rose by exactly 1 per 432 frame on every pair, 0 gaps among 12,453 and 11,768 frames on 379 pairs. The counter is per subscription, section 4 |
| idle repeat behaviour | not documented | `obdiff` and `orderbook` send nothing for an unchanged book. The pair ticker repeats the same frame |

## 4. The book channel in detail

`obdiff` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame after the acknowledgement is a model 431 with the channel `obdiff` and the pair's whole window, up to 100 bids and 100 asks, and its `CS`.
The documentation says of model 432 "This data is sent automatically from the server when the event is subscribed.", S1, and the wire adds the 431 snapshot before it.
The snapshot arrived 191 to 383 ms after the subscribe frames were sent in both runs, and no second 431 came in 60 s on any of the five pairs, or on any of 379 pairs in the batch runs.
A join of `BTCUSDT` on the separate error socket also started with a 431, in both runs.

### Delta semantics

A 432 carries `AO` for asks and `BO` for bids, each a list of `{"CP", "P", "A"}`, S1.

| `CP` | documented | probed |
|---|---|---|
| 0 | "Updated" | `A` is the new amount at that price, a replace and not an increment |
| 1 | "New added" | a price not in the book |
| 3 | "Deleted" | a price in the book. `A` still carries an amount, and whether it is the last amount held was not checked |

The probe kept a book from the snapshot and every delta, and flagged a `CP` 1 at a price already held, a `CP` 0 or `CP` 3 at a price not held, and an amount of 0.
None of the four occurred in either run.
The replace reading of `CP` 0 is confirmed two ways.
The REST book read 30 s into each run equalled the obdiff book on 20 of 20 bid and 20 of 20 ask sizes, for `BTCUSDT` and `BTCTRY`, in both runs.
The `orderbook` channel's whole book equalled the obdiff top 20 on arrival in 36 to 43 of 69 to 74 frames on the three busy pairs in run 1, and 14 to 47 of 52 to 63 in run 2.
A whole book that did not equal the current obdiff book had equalled an earlier one, or equalled a later one, in all but 0 to 3 frames per pair per minute.
Those few are books one channel shows and the other skips, which follows from both channels batching changes on their own clocks, section "Conflation".

### Sequence and gap rule

```text
431 snapshot           replace the book, last = CS
432, CS = last + 1     apply, last = CS
432, CS != last + 1    gap: the engine's resync, which terminates the socket and resubscribes
432 before any 431     resync
```

The documented rule is only "sequential values" with "no control at this time", S1.
On the wire the rule held on every frame: 0 gaps in 69, 71 and 70 deltas on `BTCTRY`, `BTCUSDT` and `ETHUSDT` in run 1 and 64, 60 and 52 in run 2, and 0 among 12,453 and 11,768 frames on 379 pairs.
The first delta after a snapshot had `CS` equal to the snapshot's `CS` plus one on every pair.

`CS` is not a book version that two readers share.
The `orderbook` channel's `CS` for the same pair sat a fixed distance from the obdiff `CS`, for example 1,129 to 1,132 on `BTCTRY` in run 1 and 73,273 to 73,275 in run 2, so each subscription counts its own frames from its own base.
The REST book has no sequence field at all, see [`rest.md`](./rest.md) section 5.
So a REST snapshot cannot be aligned with the socket, and the 431 on subscribe is the only way to start a book.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| obdiff 431 snapshot | best first, descending, on 5 of 5 pairs in both runs | best first, ascending, on 5 of 5 |
| obdiff 432 delta | every bid list of two or more levels was descending, in all deltas of both runs | every ask list was ascending |
| `orderbook` 431 | descending, on the first frame of 5 of 5 pairs in both runs | ascending, on the same frames |
| REST `orderbook` | descending, 25 and 100 levels | ascending |

The deltas arrived sorted, but nothing documents it, so a feed applies them by price and never by position.

### Level window

The window is 100 levels per side.
The snapshot of every busy pair held 100 and 100, the maintained book never exceeded 100 on any side in either run, and on the three busy pairs the `CP` 1 count equalled the `CP` 3 count exactly: 512 and 512, 419 and 419, 417 and 417 in run 1, and 264, 192 and 138 of each in run 2.
So a level entering the window pushes one out, and the one pushed out arrives as a `CP` 3 far from the touch, as in the delta of section 6.
A side thinner than 100 levels holds what exists: `FLRTRY` held 52 and 53 bids in run 1, and `ORCATRY` 30 bids and 72 to 76 asks in run 2.
The engine needs 20 levels, at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61, so 100 is ample.

### Conflation

Both book channels batch.
On `obdiff` the gap between frames of one pair had a median of 764, 764 and 766 ms on `BTCTRY`, `BTCUSDT` and `ETHUSDT` in run 2, with a minimum of 188 to 571 ms.
The `orderbook` channel's median was 761 to 769 ms over both runs.
On the three busy pairs a 432 carried about 7 to 16 level changes on average, which is the `CP` counts above divided by the deltas.
So the socket shows a book that can be about three quarters of a second old, and the documentation says nothing about this cadence.

### Size unit against CCXT `contractSize`

The amount `A` is in the base asset, as the REST book is: `BTCUSDT` touch `["86673", "0.00863945"]` on the socket and `["86673", "0.00863945"]` on REST, run 2.
CCXT reports `contractSize` undefined for these spot markets, see [`rest.md`](./rest.md) section 2, and the connector turns a missing contract size into 1 at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194, which is the right multiplier.

### One-sided and empty books

No pair had an empty side: a bulk ticker read at about 03:31 UTC showed a bid and an ask on 379 of 379 pairs.
What `obdiff` sends for an empty side is Not verified.

### Idle repeats

`obdiff` and `orderbook` send nothing while a book is unchanged: `ORCAUSDT` went 23.6 s and 29.8 s without a frame, and no `orderbook` frame ever repeated the previous body.
The pair ticker is the opposite: 53 and 57 of its 79 frames in 60 s were identical to the frame before.

### Unknown, closed and wrong-case symbols

| request | reply | then |
|---|---|---|
| `obdiff` `NOPETRY` | `{"type":100,"ok":true,"message":"join|obdiff:NOPETRY"}` | nothing for the rest of the 10 s check |
| `obdiff` `btcusdt` | `ok: true` | nothing, and joining `BTCUSDT` afterwards brought exactly one snapshot |
| `obdiff` `all` | `ok: true` | nothing for the rest of the check |
| channel `nope` | `ok: true`, `join|nope:BTCUSDT` | nothing for the rest of the check |
| `obdiff` `BTCUSDT` twice | the second answers `ok: false` | the first keeps delivering |
| `obdiff` `BTCUSDT` with `join: false` | `ok: true`, `leave|obdiff:BTCUSDT` | no `BTCUSDT` frame in the next 3.6 s |
| array `event`, object frame, type 999, text that is not JSON | no reply | the socket stays open |

No closed pair existed to probe, because all 379 were `TRADING`.
Because an unknown or wrong-case pair is acknowledged as success, the feed has to notice a pair with no snapshot on its own, which the engine's first book watch at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 169 already does.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | a protocol ping every 15.0 s on every socket, at 15.4, 30.4, 45.4 s and so on. The `ws` library answers it by default |
| silence the server tolerates | Not publicly specified | a socket that did not answer the ping was closed with code 1000 and no reason at 45.41 to 45.46 s, four sockets over two runs, whether or not it had a subscription. A socket that answered the ping and subscribed to nothing stayed open for the full 110 s |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | status page only, S6 | none |
| compression | Not publicly specified | text JSON only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, in both runs |
| handshake | 15 connection requests per minute per IP, then a 60 s block, S5 | 397 to 495 ms to open |
| subscription limits | not counted in the connection limit, S5 | 379 pairs on one socket, no refusal |
| throughput | | `obdiff` on all 379 pairs: 166 and 161 frames per second median, peaks of 351 and 344, 76.5 and 73.1 KB per second, 369 and 373 bytes per frame, 11.1 and 10.1 µs `JSON.parse` per frame |

The web app's own client config holds `"idle":{"checkInterval":1800,"maxDuration":30000}`, S7, which reads as the browser client's own idle watch rather than a server rule.

## 6. Captured frames

From the probe runs of 2026-09-23.
The snapshot keeps its first three levels per side, and every other frame is whole.

Welcome frame, first on every socket whose frames the probe logged.

```json
[991,{"type":991,"current":"6.0.0","min":"2.3.0"}]
```

Subscribe, and its acknowledgement.

```json
[151,{"type":151,"channel":"obdiff","event":"BTCUSDT","join":true}]
```

```json
[100,{"type":100,"ok":true,"message":"join|obdiff:BTCUSDT"}]
```

Snapshot, run 2, first three levels per side kept.

```json
[431,{"CS":3999242,"PS":"BTCUSDT","AO":[{"A":"0.00288357","P":"86699"},{"A":"0.06358459","P":"86718"},{"A":"0.0092056","P":"86719"}],"BO":[{"A":"0.00863785","P":"86689"},{"A":"0.02307124","P":"86688"},{"A":"0.0230723","P":"86684"}],"channel":"obdiff","event":"BTCUSDT","type":431}]
```

Delta, run 2: a new level near each touch and a level deleted at the far edge of each side, which keeps the window at 100.

```json
[432,{"CS":4097621,"PS":"ETHUSDT","AO":[{"CP":1,"P":"2770.7","A":"1.83710101"},{"CP":3,"P":"2900","A":"9.05374161"}],"BO":[{"CP":1,"P":"2765","A":"0.32885056"},{"CP":3,"P":"2550","A":"15.86046305"}],"channel":"obdiff","event":"ETHUSDT","type":432}]
```

A delta with an update in place, `CP` 0 at 2770.3, from the first `book` run at 03:21 UTC, before the probe gained its channel comparison.

```json
[432,{"CS":4008255,"PS":"ETHUSDT","AO":[{"CP":1,"P":"2769","A":"1.98627663"},{"CP":3,"P":"2769.6","A":"1.98584633"},{"CP":0,"P":"2770.3","A":"0.400488"}],"BO":[{"CP":3,"P":"2765.9","A":"2.86453815"},{"CP":1,"P":"2531.9","A":"0.00789131"}],"channel":"obdiff","event":"ETHUSDT","type":432}]
```

Keepalive: a WebSocket ping control frame every 15 s, answered by the client library's pong, so there is no JSON to show.

Duplicate subscription, the only refusal seen.

```json
[100,{"type":100,"ok":false,"message":"join|obdiff:BTCUSDT"}]
```

Pair ticker, the best bid and ask with amounts.

```json
[402,{"B":"86689","A":"86699","BA":"0.00863785","AA":"0.00288357","PS":"BTCUSDT","H":"86800","L":"85148","LA":"86766","O":"85459","V":"16.43392495","AV":"86078.604090120000","D":"1240","DP":"1.53","DS":"USDT","NS":"BTC","PId":19,"channel":"ticker","event":"BTCUSDT","type":402}]
```

## 7. Private channels

Named for a future execution stage, from S1 and S2, not probed.
They use the same URL after an HMAC login, whose answer is model 114.

- 423 `UserTrade`, 441 `UserOrderMatch`, 451 `OrderInsert`, 452 `OrderDelete`, 453 `OrderUpdate`.
- The final result of a cancel arrives on 452, per the change of 1 April 2024 in S8.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It only matters if a spot leg is ever modelled, since the venue has no perpetual.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws-feed-pro.btcturk.com/`, for the 189 USDT pairs | TRY is outside the quote family, see [`rest.md`](./rest.md) section 2 |
| channel | `obdiff`, event `<rawMarketId>` | snapshot on subscribe, a strict `CS` chain, 100 levels |
| markets per connection | all 189 on one socket | 379 ran on one socket with 0 gaps at about 166 frames per second, and each open counts against 15 a minute |
| subscribe frames | one frame per pair, `[151,{"type":151,"channel":"obdiff","event":"BTCUSDT","join":true}]` | an array `event` is ignored silently |
| keepalive | none to send, and `startKeepalive` can be empty | the server pings every 15 s and `ws` answers, and a client that does not answer is closed at 45 s |
| `maxSilenceMs` | 45,000 | three pings, which [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 97 already counts as traffic. A quiet pair went 29.8 s without a book frame, so book frames alone cannot be the signal |
| routing | `[type, model]`, then `model.PS` | the pair is in every book frame |
| snapshot | type 431: `resetBook` with `BO` and `AO`, store `CS` | documented replace |
| delta | type 432 with `CS === last + 1`: `CP` 0 and 1 set the amount, `CP` 3 removes the price, store `CS` | probed semantics, section 4 |
| resync | `CS !== last + 1`, or a 432 before any 431: `resync` | the engine's existing path, and a fresh subscription starts with a 431 |
| unserved pair | the existing first book watch | unknown and wrong-case pairs are acknowledged as success |
| receive time | stamp on arrival | book frames carry no time |
| staleness | treat the book as up to about 0.8 s old | both book channels batch at about 764 ms |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WebSocket Feed, Models | https://docs.btcturk.com/docs/websocket-feed/models/ | 2026-09-23 | BtcTurk, global | frame shapes, model numbers, 431 and 432 fields, `CP` codes, `CS` note, private models, sections 2 to 7 |
| S2 | WebSocket Feed, WebSocket Authentication | https://docs.btcturk.com/docs/websocket-feed/authentication/ | 2026-09-23 | BtcTurk, global | endpoint, HMAC login for private models, sections 1, 3 and 7 |
| S3 | WebSocket Feed, Channel, Event and Model, and TradingView | https://docs.btcturk.com/docs/websocket-feed/channel-event-and-model/ | 2026-09-23 | BtcTurk, global | channel list, `all` event for the ticker, `tradeview`, section 2 |
| S4 | Data Center | https://docs.btcturk.com/docs/data-center/ | 2026-09-23 | BtcTurk, global | Azure West Europe behind Cloudflare, section 1 |
| S5 | Private Endpoints, Rate Limits, WebSocket part | https://docs.btcturk.com/docs/private-endpoints/rate-limits/ | 2026-09-23 | BtcTurk, global | 15 connection requests a minute, subscriptions not counted, sections 3 and 5 |
| S6 | General Information | https://docs.btcturk.com/docs/general-information/ | 2026-09-23 | BtcTurk, global | status page, section 5 |
| S7 | Web app `assets/environment.json` | `https://kripto.btcturk.com/assets/environment.json` | 2026-09-23 | BtcTurk, global | socket host and idle config, section 5 |
| S8 | Recent changes | https://docs.btcturk.com/docs/recent-changes/ | 2026-09-23 | BtcTurk, global | ticker amount fields, cancel result on 452, section 7 |
| P1 | `ws-probe.mjs book`, runs at 03:24 and 03:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcturk/ws-probe.mjs) | 2026-09-23 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 03:25 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcturk/ws-probe.mjs) | 2026-09-23 | this host | sections 3, 4 and 5 |
| P3 | `ws-probe.mjs silence` and `deflate`, runs at 03:26 and 03:28, and 03:34 and 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcturk/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
