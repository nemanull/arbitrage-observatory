# Buda WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:49 to 05:14 UTC, from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada, so every access result below is from that Canadian exit.

This profile covers the public realtime socket of Buda, which is spot only, so the book channel is the spot book, see [`fees.md`](./fees.md) section 3.
The socket is an Nchan server behind Cloudflare, and the subscription is the URL itself, so there is no subscribe frame and no acknowledgement.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/buda/ws-probe.mjs), and the capture is quoted beside the documented value.
The documentation at https://api.buda.com/ answered this host with a Cloudflare challenge, so it was read from the Wayback snapshot of 2026-05-18, S1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, public and private | `wss://realtime.buda.com/sub?channel=<channel>[,<channel>…]`, S1 | 101 in 279 to 474 ms over every open of both runs, and a socket of 52 channels delivered every book channel |
| perpetuals | none | none listed, see [`fees.md`](./fees.md) section 3 |

`realtime.buda.com` resolved to Cloudflare, 104.16.121.50 and 104.16.122.50 plus two IPv6 addresses, the same as `www.buda.com`, see [`rest.md`](./rest.md) section 1.
Upgrades carried `cf-ray` suffixes `SEA` and `YVR`, so Cloudflare terminated the socket in Seattle or Vancouver.
The documentation names Nchan and links its subscriber documentation, S1 and S2.

## 2. Channel matrix for public market data

| channel | spelling | payload | probed |
|---|---|---|---|
| book | `book%40<market>`, market id lower case without the dash, as `book%40btcclp` | `book-changed` with one level change, and `book-sync` with the whole book | every one of 26 markets delivered, section 4, recommended |
| trades | `trades%40<market>` | `trade-created` with `[timestamp ms, amount, price, side, id]` | 4 trades in 322 s and 1 in 202 s over all 26 markets |
| best bid and ask, ticker, mark, index, funding | none | | no such channel is documented, S1 |

The documentation says "Recuerda utilizar %40 en vez de @", S1.
A raw `@`, as `book@btcclp`, opened and delivered nothing in 3 s and in 2.5 s, while `book%40btcclp` delivered 7 to 12 frames a second in the book runs, so the `%40` spelling is required and not only a convenience.
There is no ticker channel, so a best bid and ask comes only from the book.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | one socket carried all 26 book and 26 trades channels |
| subscribe frame shape | none: channels are the `channel` query argument, comma separated, S1 | as documented. The probe never sends a text frame, see section 5 |
| unknown symbol expectation | Not publicly specified | `book%40nopeclp`, `book%40btc-clp`, `book%40BTCCLP`, `nope%40btcclp`, `btcclp`, an empty `channel=` and no `channel` at all each got 101 and then silence. Only a wrong path, `/nope`, was refused, with 404 and an empty body |
| chunk unit and budget | channels per URL, Not publicly specified | 52 channels in an 833 character URL. All 26 book channels delivered, and the trades channels delivered the 4 and 1 trades that happened |
| keepalive mechanism | the example runs `ping_interval=10` on the client, S1 | the server sends a protocol ping every 10.0 s. A client that does not pong is closed at 20.3 s with code 1000 and reason `410 Gon`. A client protocol ping gets a pong in 88 to 101 ms |
| connection lifetime and maintenance notice | Not publicly specified | none in 322 s, no notice frame exists |
| handshake and operation rate limits | Not publicly specified for the socket. REST is 120 requests per minute per IP, S1 | 43 socket opens between 04:49 and 05:14 UTC, none refused except the wrong path |
| public market data authentication | none | none |
| message parse and routing | `{ev, ts, mk, …}`, S1 | as documented. Route on `mk`, which is the REST market `id`, as `BTC-CLP` |
| subscribe acknowledgement shape | none | none. The first frame is the first live event |
| symbol identifier format | channel: `btcclp`. Payload: `BTC-CLP` | as documented, the channel spelling differs from `mk` |
| number representation | strings, S1 | prices and sizes are decimal strings, including signed size changes such as `"-0.15806129"` |
| timestamp representation | `ts`, "Unix timestamp del evento (segundos.nanosegundos)", S1 | `ts` is a string of seconds with six decimals, as `"1790138984.311029"`. Trades also carry milliseconds in `trade[0]` |
| size unit | base currency, S1 | base currency, the same unit as the REST book, section 4 |
| sequence semantics | none documented | no sequence field. With the Nchan subprotocol `ws+meta.nchan` each frame carries an id that chains per channel, 0 breaks in 38,328 ids, section 4 |
| idle repeat behaviour | "Cada 5 minutos se envía un snapshot completo del libro", S1 | a `book-sync` for every market at once, every 177.9 to 179.0 s, never a repeated delta |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
The first frame after the upgrade is a live `book-changed`, 20 ms and 42 ms after the open event in the two book runs, and a quiet market sends nothing until the next `book-sync`.
In the 322 s run all 26 markets got a `book-sync` at 81 s and at 258 to 259 s after the socket opened, and in the 202 s run at 141 s.
Their `ts` values were 1790139637.548, 1790139815.419 and 1790140173.387, all 26 markets within 6 ms of each other each time.
The gaps are 177.87 s and 357.97 s, which is two periods of 178.98 s, so the period is about three minutes and not the five the documentation states.
Whether it drifts or is fixed was Not verified beyond these three.

A feed therefore seeds each book from REST `GET /markets/<id>/order_book`, see [`rest.md`](./rest.md) section 5, or waits up to three minutes for the next `book-sync`.

### Delta semantics

`change` is `[side, price, amount]`, where `amount` is a signed change in the size at that price, "cambio de monto", S1, and not the new size.
The wire confirms it: an `ETH-CLP` bid moving from 2,605,717.2 to 2,605,717.5 arrived as two frames with the same `ts`, `-2.0728224` at the old price and `2.07282216` at the new one.
A level is gone when its running sum reaches zero.
The engine's `OrderBook.setBid` and `setAsk` take an absolute size, at [`OrderBook.ts`](../../../server/src/feeds/book/OrderBook.ts) lines 32 to 38, and the class has no getter for one level's size, so a feed has to keep its own size per price to turn a change into a size.
Frames that share one `ts` came in groups of up to 4, and 6,370 of 14,175 groups in the first run held more than one frame, so one book event, like the move above, can arrive as several frames.

### Sequence and gap rule

No payload field carries a sequence.
`ts` never went backwards within a market in 37,988 book and trade frames over both runs, but it is a timestamp and cannot show a missing frame.

Nchan adds one when the socket asks for the `ws+meta.nchan` subprotocol, S2.
The server accepted it, answered with `sec-websocket-protocol: ws+meta.nchan`, and prefixed every frame with `id: <seconds>:<n>` and `content-type: application/json`.

```text
single channel:  next id is the same second with n + 1, or a later second with n = 0
multiplexed:     id is <seconds>:<n1>,<n2>,…, one slot per channel in URL order,
                 the delivering channel's slot in brackets, "-" for a channel with no message yet,
                 and the bracketed slot follows the single channel rule
gap:             any other id, which means the socket missed a message on that channel
```

The rule held on 21,762 and 16,226 ids over 26 book channels and the trade channels that traded, and on 150 and 190 single channel ids, with 0 breaks.
With no break, the sockets missed nothing, so what a real break looks like was not observed.

Nchan also replays from an id.
A second socket opened with `last_event_id=<id>` on one channel received all 46, all 74 and all 94 messages published after that id in three runs, arriving in the same millisecond as the open event.
On three multiplexed channels a resume from the multiplexed id `1790140344:[0],-,1` replayed 43 of the 47 messages after it.
That id names the second channel as `-`, which gives no position to resume it from, and whether the four missing frames were on that channel was Not verified.
The replay buffer held about 200 messages per channel: a resume from 300 s or 3,600 s back delivered 202 to 208 messages at once, which spanned 25 to 27 s of `BTC-CLP` in one run and 11 s in the other.
The Nchan defaults are a 10 message buffer and no ping, S2, so Buda has configured both.

### Checksum

None documented and none on the wire.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `book-changed` | one level per frame | one level per frame |
| `book-sync` | descending on all 78 snapshots | ascending on all 78 |
| REST `order_book` | descending on 4 of 4 markets in both runs | ascending |

### Level window

None.
The channel and `book-sync` carry the whole book: `BTC-CLP` held 417 to 418 bids and 255 to 256 asks in its `book-sync` frames, against 419 to 422 bids and 256 asks in REST.
The engine keeps 20 levels, so it publishes the top 20 of a full book that the feed maintains.

### Checks against the venue's own book

The probe seeded every book from REST, applied every later change as an increment, and compared with each `book-sync` and with a closing REST book.

| comparison | first run, 322 s, top 20 by position | second run, 202 s, top 20 by price and whole book |
|---|---|---|
| first `book-sync` against the REST seed plus changes | 24 of 26 markets matched both sides. `BTC-CLP` bids 7 of 20 and `USDT-COP` asks 8 of 20 | top 20 matched on 26 of 26. The whole book differed on 7 markets by 1 to 8 levels, and none of the up to three levels printed per market had a change at its price in the 3 s before the sync |
| second `book-sync` against the first plus 178 s of changes | 24 of 26 matched. `USDC-CLP` asks 9 of 20 with 153 levels against 150, `USDT-CLP` bids 6 of 20 with 126 against 124 | not reached |
| closing REST book | 20 of 26 matched both sides | top 20 matched on 23 of 26, and the other three missed 1 level each. 12 levels differed on 6 markets: at least 9 at a price that had a change within 700 ms, so in flight during the REST call, and 2 with no change in 3 s |
| a level driven below zero | 1 on `BTC-CLP` and 12 on `USDT-COP` | 11 over 4 markets, all before the `book-sync`, and 0 after it |

A comparison by position counts every level below one extra or missing level as a miss, so a first run score such as 7 of 20 may be a single level, and the rerun compared by price for that reason.
Differences in the seeded books are expected, since a REST reply has no id to align with the stream, and the probe dropped changes that arrived while the REST call was in flight.
The second row is the clean test, and it shows a few levels of drift over three minutes with no missed message.
Resetting on every `book-sync` bounds that drift to one period.

### Size unit

Sizes are base currency, BTC on `BTC-CLP` and USDC on `USDC-CLP`, the same unit as the REST book and `minimum_order_amount`, see [`rest.md`](./rest.md) section 2.
There is no contract size, and no CCXT class to report one.

### One-sided and empty books

No market had an empty side in any snapshot.
The thinnest side was `LTC-BTC` bids with 13 levels.

### Idle repeats

Nothing repeats.
Five markets, `BCH-BTC`, `BCH-COP`, `LTC-BTC`, `USDT-USDC` and `BCH-PEN`, sent only `book-sync` frames, 177.7 to 178.0 s apart, and each matched the book rebuilt from the previous one.
Among markets that did send changes, the longest wait for a frame was 30.1 s, on `ETH-BTC`.

### Unknown, closed and malformed symbols

Every malformed or unknown channel in section 3 is accepted and silent, so the feed has to notice a market with no book on its own.
No market was disabled on 2026-09-23, so a closed market was not available to probe.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client side `ping_interval=10` in the example, S1 | server protocol ping every 10.0 s, the first 10.3 s after the socket was created, on every socket. Automatic pong keeps the socket open |
| silence the server tolerates | Not publicly specified | a client that does not answer pings is closed at 20,305 and 20,321 ms with code 1000 and reason `410 Gon`, so one missed pong. The reason arrived as `410 Gon`, cut short on the wire. A subscribed socket that pongs stayed open for the full 35, 60 and 322 s |
| forced disconnect | Not publicly specified | none in 322 s |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | the server negotiates `permessage-deflate` when offered, in both runs. The engine refuses it and gets plain text frames |
| client text frames | Not publicly specified | not sent on purpose. The subscriber location should ignore them, but a location configured to publish would forward them to the public channel |
| handshake | | 279 to 474 ms, Cloudflare edges SEA and YVR |
| throughput, all 26 markets | | 67.5 and 80.2 frames per second on average, median 65 and 78, peak 147 and 156, 7.7 and 8.9 KB per second and 110 to 115 bytes per frame of JSON body, 12.3 and 14.2 µs `JSON.parse` per frame. The `ws+meta.nchan` header added 154 bytes to every frame on the 52 channel socket |
| arrival minus `ts` | | minimum 45 and 48 ms, median 53 and 55 ms, p99 296 and 299 ms, maximum 1,070 and 1,021 ms, which includes any clock offset |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

There is no subscribe frame.
The socket opens on the URL, here two book channels and one trades channel.

```text
wss://realtime.buda.com/sub?channel=book%40btcclp,book%40usdtclp,trades%40btcclp
```

Deltas, two frames sharing one `ts` as one bid moves, from the `book 200` run.

```json
{"mk":"ETH-CLP","ts":"1790140032.607596","ev":"book-changed","change":["bids","2605717.2","-2.0728224"]}
```

```json
{"mk":"ETH-CLP","ts":"1790140032.607596","ev":"book-changed","change":["bids","2605717.5","2.07282216"]}
```

A frame under the `ws+meta.nchan` subprotocol, on one channel.

```text
id: 1790139391:2
content-type: application/json

{"mk":"BTC-CLP","ts":"1790139391.338917","ev":"book-changed","change":["bids","81718874.41","-0.00012237"]}
```

Ids on a socket of `book%40btcclp`, `book%40usdtclp` and `book%40usdcclp`, from the `meta` rerun, id line and `mk` only.

```text
id: 1790140340:[2],-,-      BTC-CLP
id: 1790140340:2,-,[0]      USDC-CLP
id: 1790140340:[3],-,0      BTC-CLP
id: 1790140341:4,[0],-      USDT-CLP
```

Snapshot, cut to three levels per side, from the sync at `ts` 1790139637.548.

```json
{"mk":"USDT-USDC","ts":"1790139637.548172","ev":"book-sync","order_book":{"market_id":"USDT-USDC","bids":[["0.995115","9.592697"],["0.9842","2779.7492"],["0.984","0.01"]],"asks":[["1.0029","25.352297"],["1.0035","13.843817"],["1.0038","6.375772"]]}}
```

Trade.

```json
{"mk":"BTC-CLP","ts":"1790139724.989999","ev":"trade-created","trade":["1790139724989","0.04975","81977678.0","sell",9845216]}
```

Keepalive: a protocol ping every 10 s, and the close that follows one missed pong.

```text
close code 1000, reason "410 Gon", 20,305 ms after the socket was created
```

Error: there is no error frame.
A wrong path is refused at the upgrade.

```text
GET wss://realtime.buda.com/nope?channel=book%40btcclp  to  HTTP 404, empty body
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL, and the `pubsub_key` from the private `GET /me` call in the channel name is the only credential.

- `balances%40<pubsub_key>` with `balance-updated`.
- `orders%40<pubsub_key>` with `order-created` and `order-updated`.
- `deposits%40<pubsub_key>` with `deposit-confirmed`.

Orders are placed over REST only.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and moot while Buda lists no perpetual.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://realtime.buda.com/sub?channel=book%40<m1>,book%40<m2>,…` | 26 channels on one socket, 67.5 to 80.2 frames per second for the whole venue |
| subprotocol | `ws+meta.nchan` | the only per channel gap check, and it enables a resume |
| subscribe frames | none, so `getSubscribeFrames` returns an empty list | the URL subscribes |
| seed | REST `order_book` for each market after the socket opens, 26 calls spread over at least 13 s | no snapshot on subscribe, and the REST limit is 120 requests per minute per IP |
| deltas | keep a size per price, add `amount`, delete at zero, then `setBid` or `setAsk` with the sum | increments, not sizes |
| snapshot | every `book-sync`: `resetBook` from `order_book` | venue snapshot every 178 to 179 s, bounds drift |
| resync | an id chain break, or a level summed below zero: `resync`, then reseed from REST | the engine's existing terminate path, plus a reseed it does not have today |
| keepalive | nothing to send. `ws` answers the server ping by default | the server closes a socket that misses one pong |
| `maxSilenceMs` | 30,000 | three missed server pings, which refresh the silence watch at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 97, while a quiet book is silent for up to 178 s |
| unserved market | log a market with no book after the seed | unknown channels are accepted and silent |
| routing | `mk` is the `rawMarketId`, and the channel name is `mk` lower cased without the dash | |
| receive time | stamp on arrival | `ts` is an event time |
| deflate | keep `perMessageDeflate: false` | optional on this server |

The named changes against the current engine are a REST seed on open and a per price size lookup, since [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) has no seed hook and [`OrderBook.ts`](../../../server/src/feeds/book/OrderBook.ts) takes absolute sizes only.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Buda.com API documentation, "Websockets API", Wayback snapshot of 2026-05-18 | https://web.archive.org/web/20260518031808/https://api.buda.com/ | 2026-09-22 | Buda.com | URL form, channels, event shapes, five minute snapshot, private channels, sections 1 to 7 |
| S2 | Nchan documentation, subscriber endpoints and `ws+meta.nchan` | https://nchan.io/ | 2026-09-22 | Nchan | meta subprotocol, `last_event_id`, default buffer of 10 and no ping, section 4 |
| S3 | live https://api.buda.com/ | https://api.buda.com/ | 2026-09-23 04:41 UTC | this host | HTTP 403 Cloudflare challenge, 5,339 bytes |
| P1 | a 15 s peek at `book%40btcclp,book%40usdtclp,trades%40btcclp` before the probe was written, whose checks were folded into [`ws-probe.mjs`](../../../scripts/probes/venues/buda/ws-probe.mjs) | | 2026-09-23 04:49 UTC | this host, Canadian exit | the socket URL in section 6, and the first sight of signed changes and the 10 s ping, both confirmed by P2 |
| P2 | `ws-probe.mjs book 320` at 04:59 UTC, and `book 200` at 05:07 UTC as the rerun | [`ws-probe.mjs`](../../../scripts/probes/venues/buda/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 3 to 5 |
| P3 | `ws-probe.mjs errors` at 04:55 and 05:12 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/buda/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | unknown channels, client ping, section 3 |
| P4 | `ws-probe.mjs meta` at 04:56, 04:57 and 05:11 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/buda/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | ids, resume, buffer depth, section 4 |
| P5 | `ws-probe.mjs silence` for 60 s at 05:06 and 35 s at 05:13 UTC, and `deflate` at 04:56 and 05:13 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/buda/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | section 5 |
