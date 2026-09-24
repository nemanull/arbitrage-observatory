# Biconomy.com WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:17 to 03:40 UTC), from the development host near Seattle.

This profile covers the public futures WebSocket of Biconomy.com for its one perpetual family, USDT-margined, with the book channel in detail.
Biconomy publishes no futures WebSocket documentation.
The official API documentation covers spot only and names one spot socket, `wss://bei.biconomy.com/ws`, see [`fees.md`](./fees.md) S12.
The futures socket, its channel names and its frames below were read from the futures web app's bundle, S1, and every claim was then captured by [`ws-probe.mjs`](../../../scripts/probes/venues/biconomy/ws-probe.mjs).
So the "documented" column below says what the web app's code does, since nothing else documents it.
The protocol is a renamed copy of the MEXC contract WebSocket: `sub.depth` became `subscribe.depth`, and the push, ping and pong shapes are MEXC's, compare CCXT Pro at `server/node_modules/ccxt/js/src/pro/mexc.js` lines 770 and 2139.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-margined perpetuals | `wss://openapi.biconomy.com/future/websocket`, from `futuresWs` in S1 | open in 243 to 282 ms over all runs, 101 through Cloudflare, 295 contracts served |
| backup host | `openapi.biconomy.world`, from `BACKUP_HOST` in S1 | not probed, it resolved to 158.51.123.205 |
| spot | `wss://bei.biconomy.com/ws`, S12 of [`fees.md`](./fees.md) | not probed, spot is out of scope |

One URL serves every perpetual, so there is nothing to split.
`openapi.biconomy.com` resolved to the Cloudflare addresses 104.26.14.129, 104.26.15.129 and 172.67.71.7, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

The subscribe frame is `{"method": "subscribe.<name>", "params": {...}}`, and the push arrives on channel `push.<name>`.

| method | params | push | probed on 2026-09-23 UTC |
|---|---|---|---|
| `subscribe.depth.full` | `{"symbol": "BTC_USDT", "limit": 20}` | `push.depth.full`, the whole top of book to `limit` levels, on a tick of about 365 ms when the book changed | limit 5, 10, 20, 50 and 100 served that many levels, 30 answered `"Not support limit"`, and no limit served 100. Recommended at 20 |
| `subscribe.depth` | `{"symbol": "BTC_USDT"}` | `push.depth`, one changed level per frame with a `version` | 192 and 54 frames a second on BTC over 45 s in the two book runs, 1,730 frames in 8 s in the third limits run, 1.9 a second on KNC, 0 gaps |
| `subscribe.depth.step` | `{"symbol": "ETH_USDT", "step": "0.01"}` | `push.depth.step`, 25 aggregated levels per side | 25 levels on ADA and ETH, not studied further |
| `subscribe.tickers` | `{"timezone": "24H"}` | `push.tickers`, an array of every changed contract with `indexPrice`, `fairPrice` and `fundingRate` | 20 and 21 frames in 20 s, 75 to 295 contracts per frame, the first frame 79 KB |
| `subscribe.ticker` | `{"symbol": "BTC_USDT"}` | `push.ticker`, one contract with `fairPrice`, `indexPrice`, `fundingRate`, `bid1`, `ask1` | 19 and 20 frames in 20 s |
| `subscribe.index.price` | `{"symbol": "BTC_USDT"}` | `push.index.price` | 4 and 5 frames in 20 s |
| `subscribe.fair.price` | `{"symbol": "BTC_USDT"}` | `push.fair.price`, the mark | 7 and 12 frames in 20 s |
| `subscribe.funding.rate` | `{"symbol": "BTC_USDT"}` | `push.funding.rate` with `fundingRate` and `nextSettleTs` | acknowledged, then 1 frame in 20 s, and it was for `ETC_USDT`, not the subscribed contract. 0 frames in the rerun |
| `subscribe.deal` | `{"symbol": ...}` | `push.deal`, trades | not probed |
| `subscribe.kline` and its index and mark variants | | `push.kline` | not probed |

The method names come from S1 except `subscribe.index.price` and `subscribe.ticker`, which were guessed from the MEXC names and were acknowledged and served.
No channel carries the funding interval, so `push.tickers` cannot replace the REST anchor poll alone, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one `futuresWs` URL, S1 | one URL served all 295 active contracts |
| subscribe frame shape | `{method, params}` with one symbol, S1 | one frame per stream. 295 frames sent in 2 to 4 ms were all acknowledged |
| unknown symbol expectation | Not publicly specified | `{"channel":"response.error","data":"Contract [NOPE_USDT] not exists"}`. A delisted `LRC_USDT` and a lowercase `btc_usdt` were acknowledged as `success` and sent nothing |
| chunk unit and budget | Not publicly specified | 295 streams on one socket, all acknowledged, 291 and 293 delivered within 45 s, no refusal |
| keepalive mechanism | the web app sends `{"method":"ping"}` every 10 s, S1 | the answer is `{"channel":"pong","data":<ms>,"ts":<ms>}`, and the first pong on a socket is followed by a `clientId` frame. No server protocol ping in 70 or 90 s |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 90 s, and no maintenance frame seen |
| handshake and operation rate limits | Not publicly specified | none met at 295 subscribe frames in one burst |
| public market data authentication | none, S1 subscribes public channels without `login` | none |
| message parse and routing | `channel`, then `s` for the symbol, S1 | book pushes route on `s`. `push.index.price` and `push.fair.price` also carry `symbol` at the top and inside `data` |
| subscribe acknowledgement shape | Not publicly specified | `{"channel":"response.subscribe.depth.full","data":"success","ts":<ms>}`, one per frame, with no symbol in it. An unsubscribe got no acknowledgement |
| symbol identifier format | `BTC_USDT` | identical to the REST catalog `symbol`, the ticker `symbol` and the funding `symbol` on 295 of 295 contracts, see [`rest.md`](./rest.md) section 2 |
| number representation | levels `[price, amount]`, S1 | JSON numbers throughout, levels `[price, contracts, orders]`. `push.depth.step` prices keep trailing zeros, such as `2763.30` |
| timestamp representation | `ts` in ms | integer ms, both on the envelope and inside ticker data |
| size unit | Not publicly specified | contracts of `cs` coins, section 4 |
| sequence semantics | `version` on each depth frame, S1 | `push.depth` steps `version` by exactly 1, 0 gaps in 8,660 and 2,441 BTC frames over 45 s. `push.depth.full` carries the same counter |
| idle repeat behaviour | not documented | no frame at all while a book is unchanged: `NATGAS_USDT` went 30.5 s without one. When only deeper levels change, `push.depth.full` resends an identical top 20 with a new version, 6 of 125 and 24 of 121 BTC frames in the two runs |

## 4. The book channel in detail

`push.depth.full` at limit 20 is the channel this profile recommends, and the incremental `push.depth` is described beside it because the two share one version counter.

### Snapshot on subscribe

There is none.
`push.depth.full` sends a frame only on a tick when the book changed, so a quiet contract stays silent after its acknowledgement.
In the rerun of `ws-probe.mjs batch` on 295 contracts, the first frame per contract came after a median of 540 ms, 221 within 1 s, 281 within 5 s, and one after 32.1 s, and 4 contracts sent nothing in 45 s.
The first run left `AUCTION_USDT` and `STRC_USDT` silent for 45 s, and a REST read right after showed them with 145 and 165 bids.
`push.depth` sends no snapshot either, and its partner is the REST book, which carries the same version counter.

### Delta semantics

`push.depth` carries one level per frame, in `bids` or `asks`, as `[price, contracts, orders]`.
The size is absolute, and a size of 0 with 0 orders deletes the level, as in `[86761.9,0,0]`.
3,447 of 8,660 BTC levels in the first run, 876 of 2,441 in the rerun, and 645 of 1,730 in the limits run were deletions.

`push.depth.full` is not a delta.
Each frame is the whole top 20 per side with the version it reflects.

### Sequence and gap rule

```text
seed from GET /future/api/v1/depth/{symbol}, which carries version V
push.depth with version <= V         drop
push.depth with version = last + 1   apply, last = version
push.depth with version != last + 1  gap: resync
```

On `BTC_USDT` and `KNC_USDT` in both runs, every delta buffered before the REST seed was at or below its version, the first delta after it was exactly `V + 1`, and no gap followed in 45 s.
The rule is inferred from the probe, and neither Biconomy nor the web app states it.

A `push.depth.full` frame's `version` is a value of the same counter.
A book kept from the REST seed and every delta equalled the next `push.depth.full` top 20 exactly at the same version, 122 of 122 times on BTC and 31 of 31 on KNC in the first run, and 118 of 118 and 31 of 31 in the rerun.
`push.depth.full` versions rose on every frame of both runs, with no repeat and no step back.

### Checksum

None is sent.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `push.depth.full` | best first, descending, on every frame of both runs | best first, ascending |
| `push.depth` | one level, so order does not arise | one level |
| REST `depth/{symbol}` | descending | ascending |

The web app re-sorts both sides anyway, S1.

### Level window

`push.depth.full` held exactly 20 bids and 20 asks on every frame of four contracts in both runs, and on all 291 to 293 delivering contracts in the batch.
The REST book is far deeper: 1,231 to 1,236 bids and 984 to 995 asks on BTC, and 147 to 149 bids on KNC, over four reads.

### Size unit against the contract size

The socket size is contracts, and one contract is `cs` coins from the catalog, see [`rest.md`](./rest.md) section 2.
`push.depth.full` matched a book seeded from REST at every compared version, so socket and REST use one unit.
The catalog's `cs` recovered from 24 h turnover, `amount24 / (volume24 * curPrice)`, agreed within 15 % on 294 of 295 contracts.
On BTC, `57971` contracts of 0.0001 BTC is 5.8 BTC at the touch.
There is no CCXT `contractSize` to compare against, since no CCXT class exists.

### One-sided and empty books

No one-sided book was seen on the four contracts or in the batch.
A delisted contract returns empty sides and version 0 on REST, and its socket stream is acknowledged and silent.

### Idle repeats

Nothing is sent while a book is unchanged.
`push.depth.full` intervals were a 365 ms median on BTC and ETH, and 1,455 to 2,561 ms on NATGAS and KNC, with a longest gap of 30.5 s on NATGAS.
The server `ts` of a `push.depth.full` frame was 87 to 707 ms older than its arrival, median 180 to 341 ms, corrected for a clock offset of 5 to 6 ms.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `subscribe.depth.full` `NOPE_USDT` | `response.error` `"Contract [NOPE_USDT] not exists"` | |
| `subscribe.depth.full` `LRC_USDT`, delisted | `success` | nothing |
| `subscribe.depth.full` `btc_usdt` | `success` | nothing |
| `subscribe.depth.full` with limit 30 | `response.error` `"Not support limit"` | |
| `subscribe.depth.full` with no params | `response.error` `"Contract [null] not exists"` | |
| `sub.depth`, the MEXC name | no reply | |
| `subscribe.nope` | no reply | |
| text that is not JSON | no reply | the socket stays open |
| `subscribe.depth.full` `BTC_USDT` twice | `success` twice | one stream, 8 frames in about 3 s |
| `unsubscribe.depth.full` | no reply | the stream stops |

Since an error names the symbol only in its text and an acknowledgement names none, a feed matches neither to a request.
It has to notice a stream with no frame on its own, and a quiet book looks the same as a dead one.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | the web app sends `{"method":"ping"}` every 10 s, S1 | every ping got a pong, 3 in each 45 s `book` run, `{"channel":"pong","data":1790133892943,"ts":1790133892943}` |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed at 60.29 s both runs, code 1006 and no close frame. A socket subscribed to `KNC_USDT` and sending nothing stayed open 90 s and 70 s. A socket sending a ping every 15 s with no subscription stayed open 90 s and 70 s |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. The server negotiates permessage-deflate only when the client offers it, and without the offer it answers with no `sec-websocket-extensions` |
| handshake | | 243 to 282 ms to open over all runs |
| subscription limits | Not publicly specified | 295 streams on one socket |
| throughput | | 295 perpetuals at limit 20: 376 and 377 frames a second on average, medians 382 and 381, peaks 469 and 491, 266 to 268 KB a second, 726 and 727 bytes a frame, 9.3 to 10.6 µs `JSON.parse` a frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Subscribe and acknowledgement.

```json
{"method": "subscribe.depth.full", "params": {"symbol": "BTC_USDT", "limit": 20}}
```

```json
{"channel":"response.subscribe.depth.full","data":"success","ts":1790133877946}
```

A `push.depth.full` frame, three levels per side kept, whose `ts` is older than the acknowledgement above.

```json
{"data":{"asks":[[2772.16,7695,1],[2772.17,3697,1],[2772.18,4720,1]],"bids":[[2772.11,6718,1],[2772.1,7002,1],[2772.09,6622,1]],"version":11483244969},"channel":"push.depth.full","ts":1790133877770,"s":"ETH_USDT"}
```

Two `push.depth` deltas in sequence, and a deletion.

```json
{"data":{"asks":[[0.1526,156659,2]],"bids":[],"version":41846864},"channel":"push.depth","ts":1790133877816,"s":"KNC_USDT"}
```

```json
{"data":{"asks":[],"bids":[[0.1362,31503,1]],"version":41846865},"channel":"push.depth","ts":1790133877833,"s":"KNC_USDT"}
```

```json
{"data":{"asks":[[86761.9,0,0]],"bids":[],"version":10864461856},"channel":"push.depth","ts":1790134786754,"s":"BTC_USDT"}
```

Keepalive.

```json
{"method": "ping"}
```

```json
{"channel":"pong","data":1790133892943,"ts":1790133892943}
```

```json
{"channel":"clientId","data":"223006fffe11c3c3-00000001-00310f93-0ed98e11d0220f41-ea070295","ts":1790133892943}
```

Errors.

```json
{"channel":"response.error","data":"Contract [NOPE_USDT] not exists","ts":1790133849773}
```

```json
{"channel":"response.error","data":"Not support limit","ts":1790134786160}
```

Ticker frames, which carry the anchor fields.

```json
{"data":{"symbol":"BTC_USDT","riseFallRate":0.0031,"fairPrice":86647.1,"indexPrice":86687.9,"fundingRate":0.00007089,"volume24":557904490,"amount24":4797816777.00053,"bid1":86643.6,"ask1":86644,"timestamp":1790134018137,"holdVol":22030280,"curPrice":86643.8},"channel":"push.ticker","ts":1790134018137,"s":"BTC_USDT"}
```

```json
{"channel":"push.index.price","data":{"price":86687.9,"symbol":"BTC_USDT"},"symbol":"BTC_USDT","ts":1790134014059}
```

```json
{"data":{"symbol":"ETC_USDT","fundingRate":0.0001045,"nextSettleTs":1790150400000},"channel":"push.funding.rate","ts":1790134020901,"s":"ETC_USDT"}
```


## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL after a `login` request.

- `login` authenticates the socket, and `user` subscribes the account stream.
- The web app places and cancels orders over REST under `/future/api/v1/private/`, such as `private/order/submit` and `private/order/cancel`, not over the socket, S1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://openapi.biconomy.com/future/websocket` | one URL serves all 295 perpetuals |
| channel | `subscribe.depth.full` with `limit` 20 | a whole top 20 on every push, so no sequence state is needed, and 20 is the engine's depth |
| markets per connection | 150 | 295 on one socket worked at 377 frames a second, and half that leaves room since no cap is published |
| subscribe frames | one frame per market, `{"method":"subscribe.depth.full","params":{"symbol":"<rawMarketId>","limit":20}}` | the protocol takes one symbol per frame |
| keepalive | `{"method":"ping"}` every 15 s | an idle socket dies at 60 s, and a quiet book can send nothing for 30 s or more |
| `maxSilenceMs` | 45,000 | three missed pongs, and the pong has to count as traffic |
| routing | `s` on `push.depth.full` is the `rawMarketId` | identical spelling everywhere |
| each frame | `resetBook` with both sides, then `publish` | every frame is a whole window |
| order check | drop a frame whose `version` is not above the last applied one | versions only rise, and this guards a reordered frame |
| seed | read `GET /future/api/v1/depth/{symbol}?limit=20` once per market after subscribing, spaced under the 20 requests a second the spot documentation publishes, and `resetBook` from it unless a push with a higher version has arrived | there is no snapshot on subscribe, and a quiet book can stay silent for over 30 s |
| unserved stream | log a market with no frame and no REST seed 10 s after subscribing | a delisted or misspelled symbol is acknowledged and silent |
| receive time | stamp on arrival, never from `ts` | the frame `ts` is up to 707 ms old on arrival |
| deflate | keep `perMessageDeflate: false` | the server only negotiates it when asked |
| alternative | `subscribe.depth` deltas seeded by REST or by the first `push.depth.full`, with the gap rule of section 4 | real time at up to about 200 frames a second on BTC, instead of the 365 ms tick, at the cost of sequence state |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | biconomy.com futures web app bundle `index-54684f1e.js`, classes `Socket$2` and `FuturesSocket` | https://static.biconomy.com/site1/futures/static/js/index-54684f1e.js | 2026-09-22 | Biconomy.com | URL, method and channel names, ping every 10 s, limit 100 in the app, re-sorting, private names, sections 1 to 7 |
| S2 | CCXT Pro 4.5.68 `mexc.js` | `server/node_modules/ccxt/js/src/pro/mexc.js` | 2026-09-22 | CCXT | the MEXC contract names the protocol copies, lines 770 and 2139 |
| P1 | `ws-probe.mjs limits`, `errors`, `deflate`, `book`, `batch`, `tickers` and `silence`, first runs at 03:24 to 03:28 UTC on 2026-09-23, silence at 90 s, which `SILENCE_MS=90000` reproduces | [`ws-probe.mjs`](../../../scripts/probes/venues/biconomy/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | the same modes rerun at 03:32 to 03:36 UTC, silence at 70 s | [`ws-probe.mjs`](../../../scripts/probes/venues/biconomy/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6, the second readings |
| P3 | `ws-probe.mjs limits`, third run at 03:39 UTC, with `depth` on BTC added | [`ws-probe.mjs`](../../../scripts/probes/venues/biconomy/ws-probe.mjs) | 2026-09-22 | this host | the deletion and limit error frames in section 6 |
