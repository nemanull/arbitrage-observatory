# Ripio WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 03:04 to 03:21 UTC, from the development host near Seattle, through the user's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada, so every access result below is from that Canadian exit.

This profile covers the public WebSocket stream of Ripio Trade.
Ripio Trade lists no perpetual, so the profile follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and records the spot book channel, see [`fees.md`](./fees.md) section 3.
All socket numbers come from [`ws-probe.py`](../../../scripts/probes/venues/ripio/ws-probe.py), here P1, and the documentation is the v4 Redoc page at https://apidocs.ripiotrade.co/, here S1.
The probe held sockets for about 9 minutes in total across both passes.

## 1. Endpoints

| use | URL | source |
|---|---|---|
| public market data stream | `wss://ws.ripiotrade.co` | S1, P1 |
| private stream topics | the same URL, with a `ticket` from `POST https://api.ripiotrade.co/v4/ticket` in the subscribe frame | S1 |
| order entry over WebSocket | `wss://ws-api.ripio.com`, signed requests only | S1 |

One socket carries every pair and every public topic.
The handshake answered 101 behind Cloudflare, with `Server: cloudflare`, P1.

## 2. Channel matrix for public market data

| topic | content | probed |
|---|---|---|
| `orderbook/level_2_delta@BASE_QUOTE` | a level 2 snapshot first, then changed price levels with absolute amounts | yes, section 4 |
| `orderbook/level_2@BASE_QUOTE` | the whole level 2 book on every change, up to 100 levels a side, and a republish every 30 s | yes |
| `orderbook/level_3@BASE_QUOTE` | up to 100 orders a side with order ids, on every change and every 30 s | no |
| `orderbook/level_2_with_users@BASE_QUOTE` | level 2 with the user ids at each level | no |
| `ticker@BASE_QUOTE` | 24 h statistics with best bid and ask, on every change and every 30 s | yes |
| `trade@BASE_QUOTE` | each trade | no |
| best bid and ask only | not offered as a topic. `ticker` carries `bid` and `ask` | S1 |
| mark, index, funding | not offered | S1 |

The topic list is the `TopicEnum` of S1: `trade`, `orderbook/level_3`, `orderbook/level_2`, `orderbook/level_2_with_users`, `orderbook/level_2_delta`, `ticker`, `order_status`, `balance`, `user_trades`, `deposit` and `withdrawal`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one socket carried 20 `level_2_delta` topics, and 2 pairs with three topics each |
| subscribe frame shape | `{"method": "subscribe", "topics": ["topic@BASE_QUOTE"]}`, S1 | as documented. One frame with 20 topics, 758 bytes, was accepted whole |
| unknown symbol expectation | Not publicly specified | `orderbook/level_2_delta@NOPE_USDC` got `{"error":"Invalid payload","message":"Invalid topic, you need to provide a valid currency pair code","success":false}`, and the socket stayed open |
| chunk unit and budget | Not publicly specified | 20 topics in one frame, every listed pair, all acknowledged and all snapshotted within 0.21 s |
| keepalive mechanism | method `ping` exists, S1. The separate order entry socket sends protocol pings and drops a client after 60 s without a pong, S1 | the server sent protocol pings 44 s apart. `{"method": "ping"}` got `{"message":"Subscription revalidated","success":true}`. A client protocol ping got a pong in 72 ms |
| connection lifetime and maintenance notice | Not publicly specified | a client that sent nothing after subscribing was still connected at 120 s. No notice frame was seen |
| handshake and operation rate limits | Not publicly specified for the stream | 7 socket opens between 03:04 and 03:21 UTC, none refused |
| public market data authentication | none for market topics, a ticket for private topics, S1 | none |
| message parse and routing | `{id, topic, timestamp, body}`, S1 | as documented. Route on `topic`, whose suffix and `body.pair` are both the REST `symbol` |
| subscribe acknowledgement shape | not documented | one `{"method":"subscribe","success":true,"topic":"..."}` per topic, before the snapshot |
| symbol identifier format | `BASE_QUOTE`, as `ETH_BRL`, S1 | as documented, the same spelling as `GET /v4/public/pairs` |
| number representation | numbers, S1 | `price` and `amount` are JSON numbers, `hash` is a decimal string |
| timestamp representation | milliseconds, S1 | `timestamp` in Unix milliseconds |
| size unit | `amount`, base currency by the REST examples, S1 | base currency, the same values as the REST level 2 book |
| sequence semantics | "Each topic has its own unique sequence", and the sequence "may be reset between connections", S1 | the event `id` counts per pair, shared by `level_2` and `level_2_delta`. It chained +1 on every `level_2_delta` frame within each connection, but it restarted at 1 on an open socket once, section 4 |
| idle repeat behaviour | `level_2`, `level_3` and `ticker` repeat "every 30 seconds, even if a transaction has not taken place", S1 | `level_2` repeats the whole book twice about 2 s apart every 30 s, with ids from a separate counter. `level_2_delta` never repeats, so a quiet pair is silent after its snapshot |

## 4. The book channel in detail

The recommended channel is `orderbook/level_2_delta`.

### Snapshot on subscribe

S1 says "the first message sent upon connection will be a snapshot of the level 2 order book".
On the wire the acknowledgement comes first, then a frame with `id` -1 that holds the whole book, P1.
S1 calls a frame with `id` -1 a "welcome message".
The snapshot carried 92 bids and 96 asks on `BTC_USDC` and 42 bids and 50 asks on `ETH_USDC` in the first session run, and 89 and 96, then 42 and 50, in the second, P1.
Its `hash` equals the hash of the `level_2` snapshot sent at the same moment, P1.

### Delta semantics

S1 says that in each delta "the `amount` is the absolute quantity for a price level, and if the `amount` is 0, you should remove the price level".
The probe applied that rule to every `level_2_delta` frame after the snapshot, and at the end of the session the top 20 levels of each side equalled the last `level_2` frame exactly, on both pairs, P1.
A delta carries the changed levels only, usually one or two, as `{"asks":[{"amount":0.08893,"price":82961.55},{"amount":0,"price":82961.6}],"bids":[]}`.

### Sequence and gap rule

The `id` of an event frame counts per pair, not per topic.
`level_2` and `level_2_delta` frames for the same event carry the same `id`, the same `hash` and timestamps 1 to 2 ms apart, and both topics ended the session at the same last id, P1.
After the snapshot's -1, the first delta carries the pair's current count, as 182, so the snapshot cannot be placed in the sequence.
From there every `level_2_delta` frame stepped by exactly 1, with no gap in the two later session runs and none in either bulk run of 20 pairs, P1.
The count does not carry across connections.
`BTC_USDC` stood at 617 at the end of the session run at 03:07 UTC and at 8198 at the start of the next one at 03:18 UTC, a rise of about 11 a second, while a connection saw about 4 to 6 `BTC_USDC` delta frames a second, P1.

In the first session run, between 03:04:40 and 03:05:20 UTC, the counters of `BTC_USDC` and `ETH_USDC` both restarted at 1 on the open socket, from 13051 and 5477, with no control frame before or after, P1.
That fits S1's warning that the sequence "may be reset", except that it happened inside a connection.
A feed must treat any step other than +1, including a drop to 1, as a gap and resync.

The repeats on `level_2` use a different counter, which advanced by 141 between repeats, as 22477, 22618, 22759, and which every pair shares, so a `level_2` feed cannot use one gap rule for both kinds of frame, P1.

### Checksum

Each body carries `hash`, which S1 describes as "Hash of asks and bids".
On the socket it is below 2^32, as `"77247617"`, and on the REST book it is a 64 bit number, as `"15557197114601299738"`, so the two are different functions, P1.
The algorithm is Not publicly specified.
CRC-32, Adler-32, FNV-1a, djb2, the Java string hash, MurmurHash3 and the first four bytes of MD5, over several JSON and colon separated encodings of the snapshot, did not reproduce it, so the probe does not verify it, P1 capture checked offline.

### Level order on the wire

Snapshots and `level_2` frames list bids by descending price and asks by ascending price, and no snapshot was crossed, P1.
A delta with two levels on one side may list them out of price order, so a feed sorts by price rather than by position.

### Level window

S1 says each side holds up to 100 price levels.
The busiest pair, `BTC_USDC`, held 89 to 92 bids and 94 to 96 asks, and the REST call with `limit=max` returned the same depth, so the socket appears to carry the whole book on these pairs, P1 and [`rest.md`](./rest.md) section 5.
A level that falls beyond the 100 level window, if the window ever binds, is Not publicly specified.

### Size unit

`amount` is in base currency, as 0.38077631 BTC at 82477.52 USDC, the same values as the REST level 2 book.
There is no contract size.

### One-sided and empty books

No empty or one-sided book was seen.
`EURC_USDC` had a bid of 0.1528 against an ask of 1.17 and no trade in 24 h, a book far apart but not empty, see [`rest.md`](./rest.md).

### Idle repeats

`level_2_delta` sends nothing between changes.
In the second bulk run, 10 of the 20 pairs sent only their snapshot in 40 s, and the busiest `level_2_delta` topic, `ETH_USDC`, went 14.69 s without a frame in the second session run, P1.
`level_2` repeats the unchanged book twice every 30 s, at 14.5 s and 16.4 s, then 44.4 s and 46.4 s, then 74.4 s and 76.4 s after subscribing in the first silence run, and on the same rhythm in the second, P1.
The repeat body lists `pair` before `hash`, the reverse of event frames, which suggests a separate code path.

### Unknown, closed and malformed symbols

| sent | reply |
|---|---|
| `orderbook/level_2_delta@NOPE_USDC` | `{"error":"Invalid payload","message":"Invalid topic, you need to provide a valid currency pair code","success":false}` |
| `orderbook/level_7@BTC_USDC` | `{"error":"Invalid topic","success":false}` |
| method `hello` | `{"error":"Invalid method","success":false}` |
| the text `not json` | `{"error":"Invalid body","success":false}` |
| unsubscribe `ticker@ETH_USDC` | `{"method":"unsubscribe","topic":"ticker@ETH_USDC"}` |

None of them closed the socket, P1.
All 20 listed pairs are `enabled`, so a disabled pair was not available to test.

## 5. Session

| item | value | source |
|---|---|---|
| compression | `Sec-WebSocket-Extensions` absent when the client offers none, and every frame is plain JSON text | P1 |
| server keepalive | protocol PING control frames about 44 s apart, at 40.7 s and 84.8 s in the first silence run and at 43.4 s and 87.4 s in the second | P1 |
| client keepalive | a client protocol ping got a pong in 72 ms. `{"method":"ping"}` got `{"message":"Subscription revalidated","success":true}` in 70 ms | P1 |
| silence tolerated | a client that sent nothing was still connected at 120 s in both silence runs, while its library answered the server's pings | P1 |
| forced disconnects | none in the probe's sockets | P1 |
| maintenance notice | none seen, and none documented for the stream | S1, P1 |
| subscription limits | Not publicly specified. 20 topics in one frame were accepted | S1, P1 |

The engine counts a protocol ping or pong as traffic for its silence timer, at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) lines 621 and 622, so the server's pings alone keep a quiet `level_2_delta` socket alive.

## 6. Captured frames

Subscribe acknowledgement:

```json
{"method":"subscribe","success":true,"topic":"orderbook/level_2_delta@BTC_USDC"}
```

Snapshot, trimmed to two levels a side:

```json
{"body":{"asks":[{"amount":0.098,"price":82961.57},{"amount":0.00133477,"price":82961.58}],"bids":[{"amount":0.38088,"price":82474.29},{"amount":0.002699,"price":82474.27}],"hash":"77247617","pair":"BTC_USDC"},"id":-1,"timestamp":1791601553854,"topic":"orderbook/level_2_delta@BTC_USDC"}
```

First delta after it, one level changed and one removed:

```json
{"body":{"asks":[{"amount":0.08893,"price":82961.55},{"amount":0,"price":82961.6}],"bids":[],"hash":"1688292049","pair":"BTC_USDC"},"id":182,"timestamp":1791601553997,"topic":"orderbook/level_2_delta@BTC_USDC"}
```

Answer to the application ping:

```json
{"message":"Subscription revalidated","success":true}
```

Error for an unknown pair:

```json
{"error":"Invalid payload","message":"Invalid topic, you need to provide a valid currency pair code","success":false}
```

## 7. Private channels

`order_status`, `balance`, `user_trades`, `deposit` and `withdrawal` need a ticket from `POST /v4/ticket`, passed as `"ticket"` in the subscribe frame, S1.
Order entry, cancel and update go over `wss://ws-api.ripio.com` with methods `order.create`, `order.cancel` and `order.update`, each signed with HMAC SHA-256 over the timestamp and the JSON body, S1.
None of these were probed.

## 8. Recommended feed shape

This shape is for a future spot leg only, since the engine's legs are perpetual.

| item | value |
|---|---|
| URL | `wss://ws.ripiotrade.co`, one socket for every pair |
| subscribe | one frame `{"method":"subscribe","topics":["orderbook/level_2_delta@BTC_USDC", ...]}` |
| book | reset on the `id` -1 frame, then set each level to `amount` and remove it at 0 |
| gap rule | after the first event frame, any `id` other than the last plus 1 resyncs, a restart at 1 included |
| keepalive | answer server pings, and send a protocol ping every 30 s |
| `maxSilenceMs` | 60,000, counting protocol pings and pongs as traffic, since a quiet pair sends no data |
| ignore | the acknowledgement frames and `hash`, whose algorithm is unknown |

The feed would also need a catalog loader written against `GET /v4/public/pairs`, since CCXT has no class, see [`rest.md`](./rest.md) section 2.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| S1 | Ripio Trade API Documentation v4.0, sections "WebSocket Stream" and "WebSocket API", and the topic definitions in its embedded OpenAPI document | https://apidocs.ripiotrade.co/ | 2026-10-10 03:00 UTC | endpoints, topics, delta rule, id semantics, 30 s repeats, private topics |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/ripio/ws-probe.py), mode `session` three times, as the probe grew, and modes `bulk` and `silence` twice each, between 03:04 and 03:21 UTC | | 2026-10-10 UTC | every probed value above |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/ripio/rest-probe.py) | | 2026-10-10 UTC | REST depth and hash width, see [`rest.md`](./rest.md) |
