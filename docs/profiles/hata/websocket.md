# Hata WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:24 to 05:00 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=SEA`).

This profile covers the public WebSocket of Hata's two spot platforms, since Hata lists no perpetual, see [`fees.md`](./fees.md) section 3.
The server is Centrifugo, which names itself `"version":"6.0.1 OSS"` in the connect reply, so the frame grammar, the ping and the error codes are Centrifugo's.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs), and the capture is quoted beside the documented value S1.
Every mode ran twice, and where two numbers are given they are the two runs.
All access results were seen from the Canadian VPN exit.

## 1. Endpoints

| platform | documented URL, S1 | probed |
|---|---|---|
| Hata Global | `wss://websocket.hata.io/sapi/connection/websocket` | 17 of 18 opens upgraded with 101, and one was refused by Cloudflare with `Unexpected server response: 525` |
| Malaysia | `wss://websocket-my.hata.io/sapi/connection/websocket` | 10 of 10 opens upgraded with 101 |
| public token, Global | `POST https://api.hata.io/auth/api/v2/ww/user-stream-key`, no body, no key | 200 with `{"data":{"token":"…","expiry":1790224007},"status":"success"}` |
| public token, Malaysia | `POST https://api.hata.io/auth/api/v2/my/user-stream-key` | 200, same shape |

A socket must send a `connect` command with a token before anything else, even for public data, S1.
The token is a JWT whose claims were `{"channels":[],"exp":"1790224007","info":{"user_ip":"216.246.31.78"},"sub":"public"}`, valid for 86,400 s, and the IP is this host's VPN exit.
One socket serves one platform: a Malaysia token on the Global URL was closed with code 3500 `invalid token`, and `public:BTCMYR@depth` on a Global socket was acknowledged without an `offset` and never delivered.
Both hostnames resolve to Cloudflare's `104.18.28.103` and `104.18.29.103`, see [`rest.md`](./rest.md) section 1.

The handshake is slow from this host.
`curl` got the 101 after 5.4 to 6.0 s over four tries, with the TLS session up at 0.23 to 0.24 s, P8.
`ws` reported the Malaysia socket open after 4,649 and 6,228 ms, and the Global socket after 5,003 ms.

## 2. Channel matrix for public market data

| channel | payload | cadence | probed |
|---|---|---|---|
| `public:<pair>@depth` | `{"asks": [{"price","qty"}…], "bids": […]}`, always a full snapshot, S1 | on book change | 30 levels a side at most, section 4 |
| `public:<pair>@trade` | `price`, `amount`, `quantity`, `time`, `trade_id`, `is_buyer_maker` | on trade | no push in 60 s on `XRPMYR` and `SOLMYR` in either run, or on `BTCUSDT` and `XRPUSDT` |
| `public:<pair>@candles_1`, `_5`, `_15`, `_30`, `_60`, `_240`, `_1D` | `t`, `o`, `h`, `l`, `c`, `v` | on change | acknowledged, not measured |
| `public:<pair>@ticker` | `symbol`, `high`, `low`, `close`, `volume` | every 5 s | not in S1, acknowledged with an `offset`, and 14 pushes 5 s apart on each of Global `BTCUSDT` and `XRPUSDT` |
| best bid and ask, mark, index, funding | none | | none exists, and `@depth20` is acknowledged with no `offset` and silent |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per platform, S1 | a token of the other platform is refused, and a pair of the other platform is silent, section 1 |
| subscribe frame shape | `{"id": 2, "subscribe": {"channel": "public:CHANNEL_NAME"}}`, one channel per command, and several commands may share a frame joined by `\n`, S1 | 27 commands in one frame got 27 acknowledgements on Malaysia, and 10 got 10 on Global |
| unknown symbol expectation | Not publicly specified | `public:NOPEUSDT@depth`, `public:btcusdt@depth` and `public:BTC_USDT@depth` are acknowledged as success without an `offset` and deliver nothing |
| chunk unit and budget | Not publicly specified | 27 channels on one socket, all acknowledged, no refusal |
| keepalive mechanism | the server sends `{}` every 50 s and the client answers `{}` within 8 s, S1 | the server `{}` came 50.4 to 55.1 s after the socket was created, and a socket that did not answer was closed 8.5 and 6.6 s later with 3012 `no pong` |
| connection lifetime and maintenance notice | the connect reply carries `"expires": true` and `"ttl"`, S1 | `ttl` 86,385 to 86,395 s, no notice seen |
| handshake and operation rate limits | Not publicly specified | 101 after 5.4 to 6.0 s, `connect` answered in 1,148 to 1,789 ms, a single `subscribe` in 776 to 1,878 ms |
| public market data authentication | a token from the public token call, S1 | required: no token closes with 3501 `bad request`, a bad token with 3500 `invalid token` |
| message parse and routing | `{"push": {"channel", "pub": {"data": {"event_name", "data", "ts"}, "offset"}}}`, S1 | route on `push.channel`, which is `public:<pair>@depth` |
| subscribe acknowledgement shape | `{"id", "subscribe": {"recoverable": true, "epoch", "offset", "positioned": true}}`, S1 | as documented, and `offset` is absent on a channel that has never published |
| symbol identifier format | `USDTUSD`, `ETHMYR` | identical to the REST `txpair` on every pair |
| number representation | strings | price and quantity strings on `@depth`, `@trade` and `@ticker` |
| timestamp representation | `ts` Unix timestamp, S1 | `ts` in whole seconds, `1790137752` |
| size unit | `qty`, "Order Quantity", S1 | base asset units, the same as the REST book |
| sequence semantics | Centrifugo stream `offset`, one per publication, within an `epoch` | 0 gaps over every channel of every run, apart from the gap an unsubscribe leaves |
| idle repeat behaviour | not documented | a quiet pair sends nothing: 4 and 6 of 23 Malaysia pairs sent no frame in 60 s. An unchanged book can be sent again: 8 of 24 and 2 of 80 `BTCMYR` pushes equalled the one before |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
S1 says "The current design always broadcasts snapshots", so each push is a whole book, but nothing is pushed on subscribe.
The first push came when the book next changed, 1.8 to 47.5 s and 1.9 to 35.5 s after the subscribe on the Malaysia pairs that pushed at all, and 1.7 to 16.4 s on Global, P1.
Centrifugo history would supply the last snapshot, but the `history` command answers `{"code":103,"message":"permission denied"}`, P2.
So a feed starts each book with one REST read, or waits for the first push.

### Delta semantics

None.
Every push replaces the book, so a level missing from a push is gone.

### Sequence and gap rule

```text
push.pub.offset = last + 1   the next snapshot, replace the book
push.pub.offset > last + 1   a publication was missed, but the next snapshot is still whole, so replace the book and log the gap
```

The acknowledgement carries the channel's current `offset` and `epoch`, and the first push carried that `offset` plus one on all 24 channels that pushed in the second run, P1.
Centrifugo's positioning closes a client with 3010 `insufficient state` when it finds the client can no longer be in a valid position, S2, which was not observed.
Recovery does not return missed books.
A resubscribe with `recover: true`, the right epoch and an offset 22 publications back returned no `publications` and no `recovered` flag, and a wrong epoch returned `"was_recovering": true` and no `recovered` flag, P2.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

Bids descending and asks ascending on every push of every channel in both runs, P1, and on every REST read, see [`rest.md`](./rest.md) section 5.

### Level window

The socket sends at most 30 levels a side, while the REST book sends up to 100, P1.
Every busy Malaysia book held exactly 30 and 30, and thinner ones held fewer, such as `NEARMYR` with 20 to 28 asks.
A Global book with fewer than 30 levels a side arrives whole: `BTCUSDT` held 21 to 27 bids and 7 to 16 asks, P1 and P5.
`BIDUSDT`, whose REST book held 79 asks, sent no push in the one book run that reached Global, so its socket window was not seen.

### Size unit

Base asset units as strings, for example `{"price":"86311.79","qty":"0.00202"}` on `BTCUSDT`.
The same levels appear on REST with the same strings: the ten best asks of Global `XRPUSDT` on the socket equalled the REST read at the end of the second run, P1.

### Crossed, one-sided and empty books

Global `XRPUSDT` was crossed on 42 of 96 pushes, with a bid near 1.62 above an ask at 1.4315, the same crossing the REST book shows, see [`rest.md`](./rest.md) section 2.
No other channel pushed a crossed book.
No one-sided or empty book was seen, so what a side with no orders sends is Not verified.

### Idle repeats

A book with no change sends nothing, so 4 and 6 of 23 Malaysia pairs sent no frame in 60 s, P1.
An unchanged book is sometimes sent again: 8 of 24 and 2 of 80 `BTCMYR` pushes, and 1 of 229 and 0 of 75 `XRPMYR` pushes, equalled the push before, while 0 of 150 Global `BTCUSDT` pushes did, P1.

### Delivery delay

This is the finding that matters most.
The socket delivers each book seconds to tens of seconds after it was true, and the delay grows with the number of subscribed channels.

| measurement | channels on the socket | run 1 | run 2 | evidence |
|---|---:|---|---|---|
| arrival minus `ts`, Global `BTCUSDT` | 1 | 1,268 to 4,029 ms, median 2,235 ms, 91 pushes | 1,541 to 5,668 ms, median 2,693 ms, 127 pushes | P5 |
| arrival minus `ts`, Global `BTCUSDT` | 10 | | 1,713 to 6,235 ms, median 2,680 ms, 150 pushes | P1 |
| arrival minus `ts`, Malaysia, every channel that pushed | 27 | 2.0 to 48.6 s, per channel medians 26.8 to 41.0 s | 2.3 to 55.0 s, per channel medians 22.6 to 44.8 s | P1 |
| arrival minus `ts`, `XRPMYR` | 1 | 1,625 to 14,979 ms, median 9,616 ms | 1,381 to 6,400 ms, median 2,855 ms | P3, phase `alone` |
| arrival minus `ts`, `XRPMYR` | 23 | 10.1 to 38.9 s, median 20.1 s | 2.2 to 32.1 s, median 10.8 s | P3, phase `all` |
| REST read to the first later push with the same top five levels, `XRPMYR` | 1 | 861 to 13,389 ms on 15 of 15 reads | 980 to 3,971 ms on 4 of 15 reads | P3, phase `alone` |
| the same | 23 | 10,063 to 24,859 ms on 5 of 15 reads | 1,352 to 15,578 ms on 4 of 15 reads | P3, phase `all` |
| arrival minus `ts`, two sockets together | 23 each | medians 16.5 and 12.5 s | medians 18.8 and 15.6 s | P4 |

`ts` has one second resolution, so arrival minus `ts` overstates the delay by up to 1 s.
The REST match does not depend on `ts`, and REST itself answered in about 200 ms at the time.
A REST read that found no later push either matched an earlier push, because the top five levels had not changed, or never appeared on the socket in the window, so only the later matches are counted.
The delay grew through each run: beside 22 other channels, the median arrival minus `ts` on `XRPMYR` per 10 s rose from 17.2 to 38.9 s in run 1 and from 6.6 to 26.5 s in run 2, P3.
Two sockets opened together received 9,022 and 5,815 bytes a second in run 1 and 18,123 and 9,760 in run 2, and one socket with the same 23 channels received 13,679 and 28,301 bytes a second in the same runs, P3 and P4.
So two sockets together get about what one gets alone, and the ceiling moved between the runs.
Two sockets with the same channels received 229 and 122 frames in the same 25 s, and no channel showed an `offset` gap, so books are queued per socket rather than dropped.
This host downloaded 5 MB from Cloudflare at 12.3 MB a second in the same hour, P8, so the host link is not the bottleneck.
Whether the ceiling is per client address, per server, or on Cloudflare's path to the origin is Not verified.

### Unknown, closed and wrong-form channels

| request | reply |
|---|---|
| `public:NOPEUSDT@depth` | `{"subscribe":{"recoverable":true,"epoch":"pxIq","positioned":true}}`, no `offset`, then nothing |
| `public:btcusdt@depth`, `public:BTC_USDT@depth`, `public:BTCUSDT@depth20` | the same, no `offset`, then nothing |
| `public:BTCMYR@depth` on the Global socket | the same, no `offset`, then nothing |
| `BTCUSDT@depth`, no `public:` prefix | `{"error":{"code":103,"message":"permission denied"}}` |
| `private:123456` | `{"error":{"code":103,"message":"permission denied"}}` |
| the same channel twice | `{"error":{"code":105,"message":"already subscribed"}}` |
| `history` and `presence_stats` on a public channel | `{"error":{"code":103,"message":"permission denied"}}` |
| `subscribe` before `connect` | the socket closes with 3501 `bad request` |
| text that is not JSON | the socket closes with 3501 `bad request` within 4 s |

A missing `offset` in the acknowledgement is the only sign that a channel name is wrong.

## 5. Session

| item | documented, S1 | probed |
|---|---|---|
| keepalive | server `{}` every 50 s, client `{}` within 8 s | the server `{}` came 51.96 and 55.11 s after the socket was created, and an unanswered one was followed by 3012 `no pong` at 60.45 and 61.68 s, P6. No protocol level ping. The Malaysia socket with 27 channels got no `{}` in about 70 s in either run, which fits a ping queued behind the delayed books, P1 |
| silence the server tolerates | Not publicly specified | a socket that opened and never sent `connect` was dropped with 1006 and no close frame at 66.2 and 65.3 s, P6 |
| forced disconnect | the token and the connection expire after `ttl`, 86,400 s | none in about 80 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | offering permessage-deflate gets `permessage-deflate; server_no_context_takeover; client_no_context_takeover` in both runs, and without the offer the server sends plain text frames, P7 |
| framing | several messages may share one frame, joined by `\n` | 18 of 1,014 and 17 of 680 frames on the Malaysia socket held more than one message, and 1 of 366 on Global, P1 |
| handshake | | 101 after 5.4 to 6.0 s, section 1 |
| throughput | | 1,014 frames and 2.0 MB, then 680 frames and 1.36 MB, in 60 s on the Malaysia socket with 27 channels, P1 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.

Connect and its reply.

```json
{"id": 2, "connect": {"token": "<public token>"}}
```

```json
{"id":2,"connect":{"client":"fb5b4d04-75a4-42fc-8068-94650626fe6e","version":"6.0.1 OSS","expires":true,"ttl":86387,"ping":50,"pong":true}}
```

Subscribe and its acknowledgement.

```json
{"id": 13, "subscribe": {"channel": "public:BTCUSDT@depth"}}
```

```json
{"id":13,"subscribe":{"recoverable":true,"epoch":"WWxb","offset":13945556,"positioned":true}}
```

Depth push, three levels a side kept.

```json
{"push":{"channel":"public:BTCUSDT@depth","pub":{"data":{"event_name":"BTCUSDT@depth","data":{"asks":[{"price":"87883.18","qty":"0.00605"},{"price":"88888","qty":"0.02192"},{"price":"100009","qty":"0.0005"}],"bids":[{"price":"86311.79","qty":"0.00202"},{"price":"84855","qty":"0.00406"},{"price":"80000","qty":"0.00823"}]},"ts":1790137753},"offset":13945557}}}
```

Ticker push, not in S1.

```json
{"push":{"channel":"public:BTCUSDT@ticker","pub":{"data":{"event_name":"BTCUSDT@ticker","data":{"symbol":"BTCUSDT","high":"85113","low":"84855","close":"85113","volume":"0.00353"},"ts":1790137752},"offset":2208636}}}
```

Keepalive, the same empty object each way.

```json
{}
```

Errors.

```json
{"id":4,"error":{"code":103,"message":"permission denied"}}
```

```json
{"id":14,"error":{"code":105,"message":"already subscribed"}}
```

Close codes seen: 3012 `no pong`, 3500 `invalid token`, 3501 `bad request`, and 1006 with no close frame.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
A private token comes from `POST /auth/sapi/v2/ww/user-stream-key` or `/auth/sapi/v2/my/user-stream-key` with a signed request, and the system assigns the channel `private:<user id>`.
Its events are `newOrder`, `cancelOrder` and `newTrade`.

## 8. Recommended feed shape

None is recommended.
Hata lists no perpetual, and the socket delivered books about 1 to 55 s late from this host, section 4, which no open gate in the engine can accept.
If a spot feed were ever wanted, it would take this shape.

| item | shape | reason |
|---|---|---|
| URL plan | one socket per platform, Global for USDT and USD pairs | a token and a pair belong to one platform |
| token | `POST /auth/api/v2/ww/user-stream-key` before each connect, renewed within 86,400 s | the token expires and carries the requester's IP |
| subscribe | one frame of `{"id": n, "subscribe": {"channel": "public:<txpair>@depth"}}` commands joined by `\n` | documented batching |
| keepalive | answer every `{}` with `{}` | 3012 `no pong` 6.6 to 8.5 s after an unanswered ping |
| `maxSilenceMs` | 75,000, counting the server's `{}` as traffic | pings come about every 50 s and a quiet pair sends nothing |
| snapshot | `resetBook` on every push | every push is a whole book |
| first book | one REST `orderbook` read per pair after the acknowledgement | nothing is pushed on subscribe and `history` is refused |
| gap | an `offset` jump needs no resync, only a log line | the next push is whole |
| unserved channel | treat an acknowledgement without `offset` as a wrong name | unknown names are acknowledged |
| receive time | stamp on arrival, and compare with `ts` to drop books older than a few seconds | the delivery delay |
| deflate | keep `perMessageDeflate: false` | plain frames come without it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hata API Documentation, WebSocket section of the OpenAPI 3.0 file, changelog last updated 2026-07-03 | https://developers.hata.io/openapi.generated.yaml | 2026-09-22 | both platforms | URLs, token calls, connect, ping and pong, subscribe, channel list, push shapes, private events, sections 1 to 7 |
| S2 | Centrifugo, History and recovery | https://centrifugal.dev/docs/server/history_and_recovery | 2026-09-23 | Centrifugo | positioning and 3010, recovery fields, section 4 |
| P1 | `ws-probe.mjs book`, 60 s, two runs, the first with the Global socket refused by 525 | [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs) | 2026-09-23 04:32 and 04:49 UTC | this host | channel statistics, delay, framing, sections 2 to 5 |
| P2 | `ws-probe.mjs errors`, two runs | [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs) | 2026-09-23 04:28 and 04:51 UTC | this host | channel forms, errors, history, recovery, connect variants, sections 1, 3 and 4 |
| P3 | `ws-probe.mjs lag`, two runs | [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs) | 2026-09-23 04:35 and 04:53 UTC | this host | REST to socket delay, section 4 |
| P4 | `ws-probe.mjs twin`, two runs | [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs) | 2026-09-23 04:37 and 04:54 UTC | this host | two sockets at once, section 4 |
| P5 | Global `BTCUSDT@depth` frames kept by `ws-probe.mjs silence` with `PROBE_OUT_DIR` set, two runs | [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs) | 2026-09-23 04:38 and 04:55 UTC | this host | Global book depth, repeats, delay, section 4 |
| P6 | `ws-probe.mjs silence`, two runs | [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs) | 2026-09-23 04:38 and 04:55 UTC | this host | ping, no pong, no connect, section 5 |
| P7 | `ws-probe.mjs deflate`, two runs | [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs) | 2026-09-23 04:28 and 04:51 UTC | this host | compression, section 5 |
| P8 | `curl` of `https://speed.cloudflare.com/__down?bytes=5000000`, and `curl` timing of the WebSocket upgrade on both hosts | `https://speed.cloudflare.com/__down?bytes=5000000` | 2026-09-23 04:32 and 04:38 UTC | this host | host bandwidth and handshake time, sections 1 and 4 |
