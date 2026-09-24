# INEX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:38 to 05:06 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

INEX lists no perpetual, so this profile covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The documented Open API socket refuses the handshake without a JWT, although its documentation calls the book channel public.
The website's own market socket opens without a login, and every probed claim below is about that undocumented socket unless a row says otherwise.
Every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/inex/ws-probe.mjs).
Access results are from the Canadian VPN exit of this laptop, whose Cloudflare trace read `loc=CA`, `colo=YVR`.

## 1. Endpoints

| socket | URL | probed |
|---|---|---|
| Open API, documented | `wss://api.inexcoin.com/open-api/ws`, S1 and S2 | HTTP 400 on the upgrade in 680 and 708 ms, `application/json`, `{"error":{"name":"empty_token","message":"토큰 정보가 없습니다.\n토큰 정보를 확인해주세요."}}` |
| website market socket, undocumented | `wss://socket.inexcoin.com/kline-api/ws` | 101 in 496 to 547 ms over 12 sockets. A plain HTTPS GET on the path answers 400 `not a WebSocket handshake request: missing upgrade` |

The website socket's host was found by resolving `socket.inexcoin.com`, and its path and protocol follow a pattern common to white-label exchange engines.
The website's JavaScript that opens it was not located, so the path is confirmed by the socket answering and not by the website's code.
One website socket carries every pair, since there is only one market, `USDT`.
Both hosts sit in AWS `ap-northeast-2`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | socket | payload | probed on 2026-09-23 |
|---|---|---|---|
| `orderbook_{symbol}` | Open API | `{"type": "subscribe", "channel": "orderbook_BTC-KRW"}`, reply `{market, tick: {buys, asks}}` called an order book snapshot, S1 | handshake refused, section 1 |
| `trade_{symbol}` | Open API | `{"type": "subscribe", "channel": "trade_BTC-KRW"}`, reply `{market, trades: [{price, volume, trend_side, time}]}`, S2 | handshake refused |
| `market_<pair>_depth_step0` | website | `{"event": "sub", "params": {"channel": "market_btcusdt_depth_step0", "cb_id": "btcusdt"}}` | a whole book on subscribe, on every change and every 60 s, 8 to 20 levels per side seen, section 4 |
| `market_<pair>_depth_step1`, `step2` | website | the same | acked `ok`, then one frame labelled `depth_step0`, then nothing in 15 s |
| `market_<pair>_ticker` | website | the same | acked `ok` with `"lower_frame":"0"`, no frame in 15 s |
| `market_<pair>_trade_ticker` | website | the same | refused, `"err_msg":"subscription rejected: malformed"` |
| best bid and ask, mark, index, funding | either | | none, spot only |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is the Open API, S1 to S3, and the probed column is the website socket, since the Open API socket did not open.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S3 | one website URL for all 11 pairs |
| subscribe frame shape | `{"type": "subscribe", "channel": "orderbook_{symbol}"}`, one channel per frame, S1 | `{"event": "sub", "params": {"channel": "market_<pair>_depth_step0", "cb_id": "<pair>"}}`, one channel per frame |
| unknown symbol expectation | Not publicly specified | `market_nopeusdt_depth_step0` is acked `"status":"ok"` and then silent. `market_BTCUSDT_depth_step0` is refused `malformed` |
| chunk unit and budget | Not publicly specified | 11 subscribe frames in one burst, all acked within 173 ms, and in the rerun six within 178 ms and five at 340 to 342 ms |
| keepalive mechanism | none documented | the server sends a protocol ping every 15.0 to 15.2 s. No application ping frame arrived |
| connection lifetime and maintenance notice | "reconnect with exponential backoff and resend the subscription, since subscription state is set per connection", S1 | no forced close in 90 s, no notice frame |
| handshake and operation rate limits | 30 calls per second per Access Key for the API, S4 | no refusal at 11 subscribes in a burst |
| public market data authentication | "a public channel usable without authentication", S1 and S2 | the Open API upgrade needs a token, 400 `empty_token`. The website socket needs none |
| message parse and routing | JSON, `market` names the pair, S1 | binary frames, each a zlib stream (first bytes `78 9c`) that inflates to JSON. Route on `channel`, `market_<pair>_depth_step0` |
| subscribe acknowledgement shape | Not publicly specified | `{"asks":"","channel":…,"bids":"","cb_id":…,"event_rep":"subed","ts":…,"status":"ok"}`, or `"status":"error"` with `err_msg` |
| symbol identifier format | `BTC-KRW` with a hyphen, S1 | lower case with no separator, `btcusdt`, as in the website catalog |
| number representation | strings, `["158000000", "0.42"]`, S1 | price and size as strings with 8 decimals, `["87136.67000000","0.00006000"]` |
| timestamp representation | none in the book reply, S1 | `ts` in Unix ms on every frame |
| size unit | Not publicly specified for the book. Ticker and trade volumes are in the base currency, S1 and S2 | base coins, 0.00023 BTC is about 20 USDT at the touch |
| sequence semantics | none documented | none. No sequence or update id exists, and every frame is a whole book |
| idle repeat behaviour | not documented | every book is sent again on a per pair cycle of about 60 s, changed or not |

## 4. The book channel in detail

`market_<pair>_depth_step0` on the website socket is the only book that answered, and every row below is about it.

### Snapshot on subscribe

The ack arrives first, and one whole book follows in the same millisecond or the next.
Both came 169 to 178 ms after the subscribe frame was sent, except for five pairs in the rerun whose ack and book came together at 340 to 342 ms.
That first book is the server's last push, not a fresh read.
Its `ts` was 2.8 s to 35.1 s older than its arrival in the first run and 1.4 s to 14.6 s in the rerun.
Subscribing the same channel twice gets a second ack and a second copy of the book.

### Delta semantics

There are no deltas.
Each frame carries both sides in full, `tick.buys` and `tick.asks`, and a level missing from the next frame is gone.
No frame carried a size of zero, and no side was ever empty, over 27 books in the first run and 40 in the rerun.
A feed replaces its book on every frame, with `resetBook`, and never applies a level by price.

### Sequence and gap rule

None exists and none is needed, since every frame replaces the book.
A lost frame costs freshness only, up to the next push, which may be 60 s away on a quiet pair.
`ts` never went backwards on any pair.

### Checksum

None documented and none on the wire.

### Level order on the wire

Bids best first and descending, asks best first and ascending, on every frame of every pair in both runs.
The Open API documents the same order for its REST book, see [`rest.md`](./rest.md) section 5.

### Level window

8 to 20 bids and 8 to 17 asks per frame were seen over both runs.
Whether a deeper book is cut to a window is Not verified, since no public REST book exists to compare.
The books look like one market maker's ladder: several pairs quoted exactly 6,000 ppm wide with levels near 20 USDT each.

| pair | spread, run 1 | spread, rerun | touch bid and ask, rerun, USDT | whole bid and ask side, rerun, USDT |
|---|---:|---:|---|---|
| `btcusdt` | 3,149 ppm | 6,000 ppm | 19.94, 20.06 | 119, 121 |
| `ethusdt` | 6,000 ppm | 6,000 ppm | 6.10, 20.10 | 70, 70 |
| `solusdt` | 1,757 ppm | 3,768 ppm | 8.34, 2.39 | 94, 96 |
| `bnbusdt` | 2,663 ppm | 6,000 ppm | 19.77, 19.89 | 121, 120 |
| `trxusdt` | 2,987 ppm | 5,983 ppm | 19.91, 20.03 | 75, 74 |
| `avaxusdt` | 9,021 ppm | 9,021 ppm | 17.83, 6.75 | 96, and 477,855 from one ask of 0.6143 AVAX at 777,777 USDT |
| `aaveusdt` | 5,996 ppm | 5,996 ppm | 10.47, 19.57 | 160, 171 |
| `ldousdt` | 9,112 ppm | 2,296 ppm | 7.40, 3.92 | 242, 154 |
| `ondousdt` | 5,878 ppm | 1,582 ppm | 11.05, 0.89 | 220, 205 |
| `qiusdt` | 9,229 ppm | 9,229 ppm | 20.00, 11.06 | 130, and 1,200 from one ask of 57,364 QI at 0.019, twelve times the touch |
| `eseusdt` | 3,208 ppm | 3,208 ppm | 4.57, 20.00 | 163, 180 |

Read at the last frame of each run.
The largest touch level in either run was 34.40 USDT, on the LDO ask in the first run.
The engine refuses to open a route whose profitable region holds under 1,000 quote units, `MIN_EDGE_NOTIONAL` at [`OpportunityManager.ts`](../../../server/src/engine/opportunity/OpportunityManager.ts) line 9, and no INEX side held that much near its touch.

### Size unit

Sizes are in base coins, for example `"0.00023000"` BTC.
No CCXT class exists, so there is no `contractSize` to compare, and a spot adapter would use 1.

### One-sided and empty books

None was seen: every frame of the 11 pairs had both sides.
What the socket sends for an empty side is Not verified.

### Idle repeats

Every book is pushed again on a per pair cycle of about 60 s, whether or not it changed.
BTC's book was stamped `04:53:02.952`, `04:54:03.025` and, in the rerun, `05:04:03.027` UTC, which are 60.07 s and 600.00 s apart, and QI's `04:54:01.685` and `05:04:01.706`.
TRX's book changed at `04:53:33.943` and was repeated at `04:54:04.212`, so a change does not reset the cycle.
One identical BTC book also came 1.0 s after a change, stamped `05:03:54.425` after `05:03:53.419`.

A subscribe acknowledgement arrived 88 to 91 ms after its own `ts` on six pairs of the rerun, which is the transport time plus any clock offset.
A pushed book arrived 592 to 603 ms after its `ts` on most frames of both runs.
The exceptions were 814 and 1,028 ms in the first run, and a bundle of five books at `05:04:06.97` in the rerun that carried frames 595 to 2,200 ms old.
So the venue appears to hold a book about half a second, and at times two, between stamping it and sending it, which is an inference from the two gaps and not a documented behaviour.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `market_nopeusdt_depth_step0` | ack with `"status":"ok"` | nothing in 15 s |
| `market_BTCUSDT_depth_step0` | `{"err_msg":"subscription rejected: malformed",…,"event_rep":"subed","status":"error"}` | |
| `market_btcusdt_depth_step1`, `step2`, `step9` | ack with `"status":"ok"` | one book labelled `market_btcusdt_depth_step0`, then nothing in 15 s |
| `market_btcusdt_trade_ticker` | `malformed` error | |
| event `nope`, and text that is not JSON | no reply | the socket stays open |

No closed pair exists to probe, since all 11 are open.
Because an unknown pair is acked as success, a feed has to notice a pair whose first book never came.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | none | a protocol ping from the server every 15.0 to 15.2 s, the first about 15 s after the upgrade. `ws` answers it by default |
| silence the server tolerates | Not publicly specified | a socket that never answers the ping is closed with code 1000 `Bye` at the third ping, 45.5 to 45.7 s over four sockets in two runs, subscribed or not. A socket that answers stays open unsubscribed for the full 90 s in both runs |
| forced disconnect | Not publicly specified | none in 90 s, or in 75 s on the book socket |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | every data frame is binary zlib. A client offering permessage-deflate got no `sec-websocket-extensions` header back, so the transport is not compressed and the payload always is |
| handshake | | 496 to 547 ms to open from this host over 12 sockets |
| subscription limits | Not publicly specified | none reached at 11 pairs |
| throughput | | 38 frames in 75 s for 11 pairs, 11 of them acks, 209 bytes on the wire and 532 bytes inflated per frame, 78 µs median to inflate and parse. The rerun had 51 frames, 234 and 658 bytes, and 90 µs |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23, each shown after inflating.

Subscribe.

```json
{"event": "sub", "params": {"channel": "market_btcusdt_depth_step0", "cb_id": "btcusdt"}}
```

Acknowledgement.

```json
{"asks":"","channel":"market_btcusdt_depth_step0","bids":"","cb_id":"btcusdt","event_rep":"subed","ts":1790139796094,"status":"ok"}
```

Book sent on subscribe in the rerun, three levels per side kept, whose `ts` is 1.3 s older than the ack above.

```json
{"data":"","channel":"market_btcusdt_depth_step0","cb_id":"btcusdt","tick":{"buys":[["86790.71000000","0.00023000"],["86739.01000000","0.00023000"],["86529.56000000","0.00021000"]],"asks":[["87261.01000000","0.00023000"],["87313.03000000","0.00023000"],["87522.01000000","0.00021000"]]},"event_rep":"","ts":1790139794821,"status":"ok"}
```

Error.

```json
{"err_msg":"subscription rejected: malformed","channel":"market_BTCUSDT_depth_step0","cb_id":"BTCUSDT","event_rep":"subed","ts":1790139183963,"status":"error"}
```

Ticker acknowledgement.

```json
{"lower_frame":"0","channel":"market_btcusdt_ticker","cb_id":"btcusdt","event_rep":"subed","ts":1790139184965,"status":"ok"}
```

Keepalive is a protocol ping frame with no payload the probe logged, so there is no JSON to show.

Open API refusal, the body of the HTTP 400 on the upgrade.

```json
{"error":{"name":"empty_token","message":"토큰 정보가 없습니다.\n토큰 정보를 확인해주세요."}}
```

## 7. Private channels

The Open API documents no private socket channel.
Orders, balances and trade history are REST calls signed with a JWT, S3 and S4.
The website's private flows go through `/api/service` and were not probed.

## 8. Recommended feed shape

None.
The documented socket refuses this host without a KYC-bound key, and INEX lists no perpetual.
The website socket works, but it is undocumented and its book is a thin ladder of about 20 USDT levels.
A feed on it would need the items below, and the first is something no current feed does.

| item | what a feed on the website socket would need | reason |
|---|---|---|
| decode | `inflateSync` on every binary frame before `JSON.parse` | every data frame is a zlib stream |
| book | `resetBook` on every frame | whole books, no deltas and no sequence |
| silence | `maxSilenceMs` of 45,000, counting protocol pings as traffic, as [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 97 already does | pings every 15 s, and a quiet pair can go 60 s without a book |
| unserved pair | log a pair with no book 10 s after its ack | unknown pairs are acked as success |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | INEX Developer, 호가 스트림 (order book stream) | https://docs.inex.im/docs/ws-orderbook | 2026-09-23 | Infinity Exchange Korea | URL, subscribe frame, reply shape, public channel, reconnect advice |
| S2 | INEX Developer, 체결 스트림 (trade stream) | https://docs.inex.im/docs/ws-trades | 2026-09-23 | Infinity Exchange Korea | trade channel and reply |
| S3 | INEX Developer, 시작하기 (quickstart) and 인증과 서명 (authentication) | https://docs.inex.im/docs/quickstart and https://docs.inex.im/docs/auth | 2026-09-23 | Infinity Exchange Korea | one WebSocket URL, JWT signing |
| S4 | INEX Developer, Rate Limit · 에러, and 변경 기록 | https://docs.inex.im/docs/limits and https://docs.inex.im/docs/changelog | 2026-09-23 | Infinity Exchange Korea | 30 per second per key, v1.3.0 "improved the precision of `tick.buys` and `tick.asks`" on 2026-05-12 |
| P1 | `ws-probe.mjs official`, `deflate` and `errors`, 04:53 UTC and the rerun at 05:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/inex/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs book`, 04:53 to 04:55 UTC and the rerun at 05:03 to 05:04 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/inex/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 6 |
| P3 | `ws-probe.mjs silence`, 04:55 to 04:57 UTC and the rerun at 05:04 to 05:06 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/inex/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
