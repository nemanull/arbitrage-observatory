# TruBit Pro WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 local time, 2026-09-24 06:47 to 06:59 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocated to Canada (Cloudflare trace `loc=CA`, colo `YVR`).

This profile covers the public contract market WebSocket of TruBit Pro, which carries the one perpetual family, USDT-M.
Every probed value was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/trubit-pro/ws-probe.mjs), and the mode is named beside it.
The documentation, S1, is thin: it names four public channels with one example each, and says nothing about keepalive, limits, sequence or snapshots.
Access results are from the Canadian VPN exit named above.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://api-futures.trubit.com/ws/market`, S2 | open in 616, 429 and 398 to 2,001 ms first frame, `book`, `batch` |
| private | `wss://api-futures.trubit.com/ws/trade`, S2 | not probed |
| spot | `wss://ws.trubit.com`, S2 | not probed, out of scope |

One URL carries every perpetual.
The socket sends `{"state":true,"message":"On connect","tag":0,"key":null}` on open, 430 ms after the socket was created in `book`.

## 2. Channel matrix for public market data

| channel | frame | depth and speed | probed on 2026-09-24 |
|---|---|---|---|
| `depthUpdate` | `{"op":"subscribe","key":"BTCUSDT","channel":"depthUpdate"}` | up to 20 levels per side, pushed every 200 to 800 ms | changed levels by price with deletes, plus the trades since the last frame, section 4 |
| `tradeStatistics` | same shape | 24 h ticker, `lastPrice`, `maxPrice`, `minPrice`, `volume`, `turnover` | about 1 frame a second on BTC, 21 in 45 s |
| `openInterest` | same shape | every 15 s | `{"key":"BTCUSDT","event":"openInterest","value":435.07980339,"date":"Sep 24, 2026 06:50:25 AM","qty":36599396}` |
| `kLine` | adds `"type":"1M"` | candles | not probed |
| `markPrice`, `indexPrice`, `fundingRate` | guessed names | | each answered `{"errMsg":"failed to deSerialize"}`, so no such channel exists under those names |

Trades have no channel of their own and ride inside `depthUpdate`.
No mark, index or funding channel is documented or found, so the anchor comes from REST, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market URL for all contracts, S2 | all 40 contracts deliver on one socket, `batch` |
| subscribe frame shape | `{"op":"subscribe","key":"BTCUSDT","channel":"depthUpdate"}`, one symbol per frame, S1 | as documented, one frame per symbol |
| unknown symbol expectation | Not publicly specified | `NOPEUSDT` is acked `{"success":true,"subKey":"NOPEUSDT",...,"clazz":"DepthUpdateEvent"}` and then silent, `book` |
| chunk unit and budget | Not publicly specified | 40 subscribe frames in one burst, all 40 acked, all 40 delivered, `batch` |
| keepalive mechanism | Not publicly specified | text `ping` answered with text `pong`. `{"op":"ping"}` and `{"ping":<ms>}` answered `{"errMsg":"failed to deSerialize"}`. A protocol ping got a protocol pong in 242 ms. No server ping in 70 s, `book`, `silence` |
| connection lifetime and maintenance notice | Not publicly specified | a socket that never subscribed closed with 1006 at 30.0 s. A subscribed socket that never sent again stayed open for the whole 70 s test, `silence` |
| handshake and operation rate limits | Not publicly specified | no refusal at 40 subscribes in one burst |
| public market data authentication | none | none |
| message parse and routing | top level `key` names the contract | `depthUpdate` frames route on `key`, `tradeStatistics` on `key` and `tradeStatistics.symbol`, `openInterest` on `key` with `event` |
| subscribe acknowledgement shape | Not publicly specified | `{"success":true,"subKey":"BTCUSDT","user":null,"agent":null,"key":null,"clazz":"DepthUpdateEvent"}`, 241 ms after the socket opened |
| symbol identifier format | `BTCUSDT` | identical to the REST `refData` `symbol` on 40 of 40, `batch` |
| number representation | doubles | JSON numbers for price, `qty`, `count` and `iceCount`. Trade `tms` is a string of ms |
| timestamp representation | trades carry `timestamp` text and `tms` ms | book frames carry no timestamp at all |
| size unit | "Positive integer, 1Qty=1USDT", S1 | integer USDT notional, section 4 |
| sequence semantics | Not publicly specified | none, no frame carries an id |
| idle repeat behaviour | Not publicly specified | 0 book frames identical to the previous one for their symbol in `book`. A quiet contract went up to 2.8 s with no frame, `batch` |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
The first `depthUpdate` frame is a set of changed levels like every later one.
In `book` the first frames held 22 bids with 3 deletes and 6 asks with 2 deletes on ETH, 40 bids with 20 deletes on BTC, and 5 bids and 1 ask on MASK.
A feed seeds the book from `GET /depth/list?symbol=<s>&level=20`, see [`rest.md`](./rest.md) section 5, and then applies frames by price.

### Delta semantics

A frame carries `buyDepth` and `sellDepth` arrays of `{price, qty, count, iceCount}` and a `trades` array.
A `qty` of 0 with `count` 0 deletes the level, and any other `qty` replaces the level.
In `rebuild` the probe subscribed three contracts, seeded each from the REST depth 1.5 s later, dropped the 3, 3 and 10 frames that came before the seed, and 3, 2 and 7 in the rerun at 06:58 UTC, and applied every later frame by price.
Every 6 s for 60 s it compared the rebuilt top 20 with a fresh REST depth, and all 40 levels, price and size, matched on 30 of 30 checks across BTC, ETH and MASK in each of the two runs.
The rebuilt book never held more than 20 levels per side, so the server sends a delete for each level that leaves the 20 level window.

### Sequence and gap rule

No frame carries a sequence number, an update id or a timestamp.
A lost frame therefore cannot be detected on the wire.
The only resync signal a feed has is a reconnect, or a periodic comparison against the REST depth.

```text
socket open          subscribe, then GET /depth/list level 20 for each contract, reset the book from it
frame                apply each level by price, qty 0 deletes
gap                  not detectable, resync on every reconnect and optionally on a timer
```

### Checksum

None documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `depthUpdate` | descending in 51 to 54 of 63 to 69 BTC frames, the rest mix changes and deletes out of order | ascending in 54 to 55 of 63 to 69 |
| REST `depth/list` | descending, 20 levels | ascending, 20 levels |

A feed applies frames by price and never by position.

### Size unit

`qty` is USDT notional, "Positive integer, 1Qty=1USDT", S1.
The BTC top bid read `qty` 13893 at 84,134.3, which is 0.165 BTC, `rest-probe.mjs basic`.
The REST open interest reply agrees: `qty` 36,599,396 USDT beside `value` 435.08 BTC at a price near 84,100.
The engine multiplies book sizes by `contractSize` to get base units, so a TruBit loader has to divide each `qty` by its level price instead, since no constant multiplier converts a notional size.
The socket and REST sizes were identical at the same price, 6 of 6 bid levels in `book`.

### One-sided and empty books

A frame with no bid change sends an empty `buyDepth`, so 0 levels in a frame is normal and says nothing about the book.
No crossed book was rebuilt, 0 crossed frames in `book` and `batch`, and no one-sided REST book was seen on the 40 contracts.

### Frame rate

| contract | frames in 45 s | median gap | max gap |
|---|---|---|---|
| BTCUSDT | 63 and 69 | 600 and 798 ms | 806 and 1,003 ms |
| ETHUSDT | 60 and 66 | 628 and 798 ms | 1,007 and 1,198 ms |
| MASKUSDT | 107 and 118 | 200 ms | 1,991 and 2,002 ms |

All 40 contracts on one socket gave 1,813 frames in 30 s at 38 KB per second, 27 to 116 frames per contract, and the longest gap was 2.8 s, `batch`.
The gaps fall on multiples of about 200 ms, so the server batches changes on a 200 ms clock.

## 5. Session

- Keepalive: text `ping`, answer text `pong`.
  The server sent no ping of its own in 70 s.
- Silence: a socket that never subscribed was closed with 1006 after 30.0 s, and a subscribed socket that sent nothing lived 70 s, the length of the test.
  Whether a subscribed socket is closed later without a client ping is Not verified.
- Forced disconnect and maintenance: help center notices announce maintenance windows, as in "Notice of System Maintenance and Upgrade 07-Sep-2026", S3, and no in band notice is documented.
- Compression: with `perMessageDeflate` false the server sent plain text frames and the `extensions` header was empty.
  When the client offered it, the server accepted `permessage-deflate`, `deflate` mode, so compression is optional.
- Handshake and subscription limits: Not publicly specified, and none were hit.

## 6. Captured frames

On open, `book`:

```json
{"state":true,"message":"On connect","tag":0,"key":null}
```

Subscribe acknowledgement, `book`:

```json
{"success":true,"subKey":"BTCUSDT","user":null,"agent":null,"key":null,"clazz":"DepthUpdateEvent"}
```

A `depthUpdate` frame on MASK, the third after subscribe, trades trimmed to their count by the probe:

```json
{"buyDepth":[{"price":0.4608,"qty":882,"count":2,"iceCount":0},{"price":0.4597,"qty":159237,"count":11,"iceCount":0}],"sellDepth":[{"price":0.4623,"qty":1131844,"count":31,"iceCount":0}],"trades":2,"key":"MASKUSDT"}
```

A delete, from the first BTC frame of the first `book` run:

```json
{"price":84065.9,"qty":0.0,"count":0,"iceCount":0}
```

Keepalive answer to the text `ping`, a bare text frame:

```text
pong
```

Error, sent for `markPrice`, `{"op":"ping"}` and a non JSON frame:

```json
{"errMsg": "failed to deSerialize"}
```

`openInterest` subscription, acknowledged with an unexpected class name:

```json
{"success":true,"subKey":"BTCUSDT","user":null,"agent":null,"key":null,"clazz":"org.cyanspring.exapp.event.ApiPositionTotalUpdateEvent"}
```

## 7. Private channels

`wss://api-futures.trubit.com/ws/trade`, with `{"op":"login","txId","apiKey","expires","signature"}` and then the channels `accountUpdate`, `positionUpdate` and `orderUpdate`, S1.
Not probed.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `wss://api-futures.trubit.com/ws/market` | one URL for all 40 contracts |
| markets per connection | all 40 on one socket | 40 streams delivered at 38 KB per second |
| subscribe | one `{"op":"subscribe","key":"<symbol>","channel":"depthUpdate"}` per contract | one symbol per frame is the only documented form |
| seed | `GET /depth/list?symbol=<s>&level=20` after the subscribe, then apply frames by price | no snapshot on the socket, and the rebuild matched REST on 60 of 60 checks over two runs |
| size | divide `qty` by level price for base units | `qty` is USDT notional |
| keepalive | text `ping` every 15 s | the server answers `pong`, and a quiet socket was closed at 30 s when it held no subscription |
| `maxSilenceMs` | 10,000 | the longest gap seen on any contract was 2.8 s, and the keepalive `pong` also counts as traffic |
| resync | reconnect and reseed from REST, and reseed each contract from REST every minute or so | no sequence, so a lost frame is invisible otherwise |
| trades | drop the `trades` array | the engine keeps books only |

The missing sequence is the main weakness.
A dropped frame leaves a wrong level in place until the level changes again or the next reseed, and nothing on the wire says it happened.

## 9. Source ledger

| id | source | read |
|---|---|---|
| S1 | https://docs-api.trubit.com/trubit-pro/contract/contract-api.md, section "Public Websocket Endpoints" and "Private Websocket Endpoints" | curl, 2026-09-24 |
| S2 | https://docs-api.trubit.com/trubit-pro/readme.md, the endpoint tables | curl, 2026-09-24 |
| S3 | help center search for `restricted`, result "Notice of System Maintenance and Upgrade 07-Sep-2026", article 52356059322260 | Zendesk API, 2026-09-24 |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/trubit-pro/ws-probe.mjs) modes `book` twice, `rebuild` twice, `batch`, `silence`, `deflate` | run 2026-09-24 06:47 to 06:59 UTC |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/trubit-pro/rest-probe.mjs) mode `basic` | run 2026-09-24 |
