# BTC Trade UA WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific evening (04:45 to 05:06 UTC on 2026-09-23), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

BTC Trade UA documents no WebSocket at all, and it has no public market data stream.
Its API documentation describes REST calls only, and neither "WebSocket" nor "wss" appears in it, S1.
The only socket the venue runs is `wss://btc-trade.com.ua/ws/time`, which the trading page's own script opens with an empty token, S2.
This profile records what that socket does, measured by [`ws-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/ws-probe.mjs), and why it cannot carry a book feed.
The venue lists spot only, see [`fees.md`](./fees.md) section 3, so every row below is about the spot venue.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| spot, session socket | `wss://btc-trade.com.ua/ws/time?token=<read_token>`, from `main.js` lines 8 to 10 and 5340, S2 | 101 on 10 of 10 opens, in 467 to 1,814 ms, P1 |
| spot, fallback host | `wss://btc-trade.app/ws/time`, named in a commented line of `main.js` lines 12 to 14, S2 | 101 on both opens, in 632 and 2,040 ms, and the same `time_object` answer, P1 |
| any other path | `wss://btc-trade.com.ua/ws/nope` | 404 with an HTML error page, P1 |
| perpetuals, futures, options | none listed | not applicable |

The page opens the socket with the token of a logged-in session, or with an empty string for a visitor, at `main.js` line 5340 and the calls `Main.start_time("")` in the home and trading pages, S2.
An empty token, no `token` parameter at all and the made-up token `0000` were all accepted and all got the same anonymous answer, P1.
On a close the page swaps `HOST` and `HOST2` and reconnects, at `main.js` lines 5509 to 5533, S2, and both are `btc-trade.com.ua` in the live script.

## 2. Channel matrix for public market data

There is no channel.
The socket accepts request frames, not subscriptions, and pushes nothing on its own: over 110 s of each silence run, the socket that sent pings got 0 frames it had not asked for, and the socket that sent nothing got 0 frames, P3.

| request | reply | probed |
|---|---|---|
| `{"ping": true}` | one `time_object` frame: server time, a `state` stamp, the anonymous fee `"deal_comission":"0.1"` and `"logged":false` | 148 to 163 ms after the ping over the 28 pings timed in P1 to P3, and all 18 pings of each silence run were answered |
| `{"get": "api/deals/btc_uah"}` | `{"status": true}`, then `{"result": {"/api/deals/btc_uah": []}}` | the list was empty in all 7 replies whose body was recorded, while REST `GET /api/deals/btc_uah` returned 16 deals minutes apart, P2, P3 and [`rest.md`](./rest.md) section 2 |
| `{"get": "api/japan_stat/high/btc_uah"}` | `{"status": true}`, then 113 KB of candles under `result` | 893 and 916 ms after the request, P2 |
| `{"get": "api/trades/buy/btc_uah"}` and `trades/sell` | `{"status": true}` and nothing else before the probe closed the socket about 5 s later | both runs, P2, and one earlier 8 s hold |
| `{"get": "api/market_prices"}` | `{"status": true}` and nothing else | both runs, P2 |
| `{"get": "api/ticker"}` | the server closes the socket with 1011 | about 150 ms after the request, both runs, P2 |
| `{"get": "/api/trades/buy/btc_uah"}` with a leading slash, `{"subscribe": "btc_uah"}`, text that is not JSON | close 1011 | both runs, P2 |
| `{"syncget": "api/trades/buy/btc_uah"}`, a form `main.js` line 5544 defines | the socket stops answering, even pings, and the client close ends as 1006 after the 30 s close timeout | closed at 35.5 and 35.9 s in the two runs, and 1011 at once in one exploratory try |

The page learns of a change from `state` alone.
When `time_object.state` differs from the last one seen, the page refetches the deals, the two order lists and the user's orders, at `main.js` lines 5383 to 5396 and 3013 to 3021, S2.
`state` moved 7 times over 20 minutes of probing, at gaps of 14 s to 420 s, while the REST sell list changed on almost every 2 s read, see [`rest.md`](./rest.md) section 5.
So `state` is not a book change signal a feed could key on, and what it counts is Not publicly specified.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing about this socket is documented, so the documented column says so, and the probed column describes `/ws/time`.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one URL for the whole venue, with no market in the URL, section 1 |
| subscribe frame shape | Not publicly specified | no subscribe exists. Requests are `{"ping": true}` and `{"get": "<path>"}`, as `main.js` lines 5537 to 5566 send them, S2 |
| unknown symbol expectation | Not publicly specified | `{"get": "api/deals/nope_uah"}` was not tried. An unknown request shape closes the socket with 1011, section 2 |
| chunk unit and budget | Not publicly specified | not applicable, no subscription |
| keepalive mechanism | the page sends `{"ping": true}` every 6 s, `main.js` line 5349, S2 | no server protocol ping in 110 s on either run. Each `{"ping": true}` is answered by a `time_object` in 148 to 163 ms |
| connection lifetime and maintenance notice | Not publicly specified | a socket that sends nothing is closed with 1006 and no close frame 60.0 s after it opened, in both runs. A socket pinging every 6 s stayed open for the full 110 s. No notice frame seen |
| handshake and operation rate limits | Not publicly specified | none met at 14 handshakes and 22 request sockets in about 20 minutes, P1 and P2 |
| public market data authentication | none | none. An empty, absent or made-up token gives the same anonymous session |
| message parse and routing | the page parses frames with `eval`, `main.js` line 5361, S2 | text JSON frames. Route on the top key: `time_object`, `status`, `result`, and for a logged-in session `deal_info` |
| subscribe acknowledgement shape | Not publicly specified | a `get` is acknowledged with the 16 byte frame `{"status": true}` whether or not a result follows |
| symbol identifier format | `btc_uah`, lowercase base and quote joined by `_`, S1 | the same inside a `get` path |
| number representation | Not publicly specified | `time` and `state` are JSON integers, the fee is a string |
| timestamp representation | Not publicly specified | `time_object.time` is Unix seconds shifted by the Kyiv summer offset: `time` minus 10,800 matched this host's UTC clock within 0 to 1 s, and the page itself subtracts 3 h before showing it, at `main.js` line 5400, S2 |
| size unit | not applicable | no book frame |
| sequence semantics | not applicable | no sequence, no book frame |
| idle repeat behaviour | not applicable | nothing is pushed, so nothing repeats |

## 4. The book channel in detail

There is none.
No frame on `/ws/time` carries a bid, an ask or a level, and the `get` requests for the two order lists the page uses, `api/trades/buy/<pair>` and `api/trades/sell/<pair>`, were acknowledged and never answered in either run, P2.

| item | value |
|---|---|
| snapshot on subscribe | none, no subscription exists |
| delta semantics | none |
| per symbol sequence and gap rule | none |
| checksum | none |
| level order on the wire | not applicable. The REST lists put bids descending and asks ascending, see [`rest.md`](./rest.md) section 5 |
| size unit against CCXT `contractSize` | not applicable. There is no CCXT class, and the REST lists give sizes in base currency, see [`rest.md`](./rest.md) section 5 |
| one-sided and empty books | not observable on the socket. On REST, `shib_btc` showed a best bid of 0 in the ticker, [`rest.md`](./rest.md) section 2 |
| idle repeats | none |
| unknown or closed symbol | not tried on the socket. REST answers 404 `{"status":"false"}`, see [`rest.md`](./rest.md) section 6 |

The only book source is a REST pair of full order lists, each read from a one second edge cache, so a feed for this venue would have to be a REST poller, see [`rest.md`](./rest.md) section 5.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | page pings every 6 s, S2 | `{"ping": true}` answered in 148 to 163 ms. No server protocol ping |
| silence the server tolerates | Not publicly specified | 60.0 s from open for a socket that never sends, closed 1006 without a close frame at 60,013 and 59,997 ms after open. That is the default 60 s read timeout of an nginx proxy, which is an inference from the `nginx/1.18.0 (Ubuntu)` server header |
| forced disconnect | Not publicly specified | none in 110 s on a pinging socket. An unknown request shape closes the socket with 1011 |
| maintenance notice | Not publicly specified | none seen. `time_object.ui_msg` is the page's banner text and was empty |
| compression | Not publicly specified | text frames only. A handshake that offered `permessage-deflate` got no `sec-websocket-extensions` header back, in both runs |
| handshake | | 101 in 467 to 2,040 ms over the 12 opens of P1 on both hosts, and in 459 to 2,301 ms over the 22 request sockets of P2 |
| subscription limits | not applicable | |
| Origin | Not publicly specified | an `Origin` header made no difference, since opens with and without it behaved the same |

## 6. Captured frames

Trimmed, from the probe runs on 2026-09-23 UTC.

Keepalive request and answer.

```json
{"ping": true}
```

```json
{"time_object":{"state":1790149849,"time":1790149884,"deal_comission":"0.1","use_f2a":false,"logged":false,"ui_msg":"","x-cache":true,"status":true}}
```

`time` 1790149884 minus 10,800 is 04:51:24 UTC, the moment of the answer.

A request that gets an answer.

```json
{"get": "api/deals/btc_uah"}
```

```json
{"status": true}
```

```json
{ "result":{"/api/deals/btc_uah":[]}}
```

A request that gets only the acknowledgement.

```json
{"get": "api/trades/buy/btc_uah"}
```

```json
{"status": true}
```

Error: `{"get": "api/ticker"}`, a leading slash, a `subscribe` key or text that is not JSON gets no frame at all, and the server closes with code 1011 and an empty reason.

Refused path: `wss://btc-trade.com.ua/ws/nope` answers the upgrade with HTTP 404, `text/html`, and the site's HTML error page.

## 7. Private channels

Named for a future execution stage, from S2, not probed.
The same `/ws/time` socket, opened with a logged-in session's `read_token`, pushes `deal_info` frames whose `type` is `canceled_order`, `processed`, `sell`, `buy`, `newbalance` or `my_orders`, at `main.js` lines 5433 to 5486.
Order entry is REST only, `POST /api/sell/<pair>`, `/api/buy/<pair>`, `/api/remove/order/<id>` and `/api/move/order/<id>/<price>`, signed with `public_key` and `api_sign` headers or a 7,200 s `token` from `/api/auth`, S1.

## 8. Recommended feed shape

No WebSocket feed is recommended, and none is possible.

| item | recommendation | reason |
|---|---|---|
| socket feed | none | `/ws/time` carries no market data, and its book requests go unanswered, sections 2 and 4 |
| book source if the venue were ever wanted | REST `GET /api/trades/buy/<pair>` and `/api/trades/sell/<pair>` per pair, no faster than once a second | each list is served from a one second edge cache, see [`rest.md`](./rest.md) section 5 |
| deflate | keep `perMessageDeflate: false`, as [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81 does | the server does not negotiate it anyway |
| `maxSilenceMs` | not applicable | a socket kept only for `state` would need a ping at least every 60 s |

The venue is spot only and has no CCXT class, so it cannot join the engine as a perpetual leg in any shape.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Документация API биржи, API documentation | https://btc-trade.com.ua/page/api_documentation | 2026-09-22 | BTC Trade UA, Ukraine | REST only, no socket named, pair spelling, private calls and auth, sections 1, 3 and 7 |
| S2 | Trading page script `main.js` | https://btc-trade.com.ua/static/js/main.js?do=1myjsversio13.5 | 2026-09-22 | BTC Trade UA, Ukraine | socket URL and fallback host, token, ping every 6 s, `get` and `syncget`, `state` handling, `deal_info` pushes, sections 1 to 3, 5 and 7 |
| P1 | `ws-probe.mjs handshake`, runs at 04:51 and 05:00 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/ws-probe.mjs) | 2026-09-23 UTC | this host | opens, tokens, fallback host, unknown path, deflate, ping answer, sections 1, 3, 5 and 6 |
| P2 | `ws-probe.mjs rpc`, runs at 04:52 and 05:02 UTC, and three exploratory sockets at 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/ws-probe.mjs) | 2026-09-23 UTC | this host | request shapes, answers and 1011 closes, sections 2 to 4 and 6 |
| P3 | `ws-probe.mjs silence`, runs at 04:54 and 05:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/ws-probe.mjs) | 2026-09-23 UTC | this host | no pushes, no server ping, 60 s silence close, `state`, clock, sections 2, 3 and 5 |
