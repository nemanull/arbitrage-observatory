# CoinCola WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:33 to 04:47 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

CoinCola lists no perpetuals, so this profile covers the spot book channel, as change 1 of the survey plan's template says.
CoinCola documents no WebSocket, S4 of [`fees.md`](./fees.md).
The socket below is the one its spot trading page opens without a login, found in the page's `runtimeConfig` and `_app` bundle, S3 of [`fees.md`](./fees.md).
It is undocumented and can change without notice.
Every probed value comes from [`ws-probe.py`](../../../scripts/probes/venues/coincola/ws-probe.py), two runs of about 5.5 and 4.5 minutes of sockets, unless a source row is named.

## 1. Endpoints

| URL | carries | evidence |
|---|---|---|
| `wss://www.coincola.stream/ws` | public spot channels `market_depth`, `ticker`, `trade` and `kline` | `WEB_SOCKET_IP` `www.coincola.stream` and `WEB_SOCKET_PORT` 443 in the page's `runtimeConfig`, plus `/ws` from the bundle, S3 |
| `wss://www.coincola.stream/ws/margin?token=` | margin account and margin index channels, after `GET /ws/token` with a login | S3, not probed |

- One socket carries every spot pair, see section 4.
- The handshake answered 101 through Amazon CloudFront, edge `HIO52`, with `server: nginx`.
- The probe sends `Origin: https://www.coincola.com`, as a browser does.
  Whether the server checks it was not tested.
- No refusal was seen from the Canadian exit.

## 2. Channel matrix for public market data

| channel | subscribe frame | push | probed |
|---|---|---|---|
| book, top N | `{"channel":"market_depth","event":"subscribe","symbol":"BTC_USDT","levels":20,"price_precision":2}` | full top N snapshot, at most about once a second | yes, section 4 |
| best bid and ask | none. `levels` 5 is the smallest window that answered | | `levels` 5 gave 5 a side in run 1 |
| ticker, one pair | `{"channel":"ticker","event":"subscribe","symbol":"BTC_USDT"}` | `tickers` array of `[symbol, last, volume, change ratio, change, high, low]` | 40 frames in 40 s and 25 in 25 s |
| ticker, all pairs of a quote | `{"channel":"ticker","event":"subscribe","quote_currency":"USDT"}` | the same rows for every USDT pair | 40 frames in 40 s and 25 in 25 s |
| trades | `{"channel":"trade","event":"subscribe","symbol":"BTC_USDT"}` | `trades` of `[price, size, ms, "BUY" or "SELL"]` | 29 frames in 40 s and 22 in 25 s |
| kline | `{"channel":"kline","event":"subscribe","interval":"ONE_MINUTE","symbol":"BTC_USDT"}` | `candles` of `[ms, open, high, low, close, volume]` | 26 frames in 40 s and 22 in 25 s |
| mark, index, funding | none on the public socket | | Not offered |

The kline interval names come from the bundle's TradingView map, `ONE_MINUTE` to `ONE_MONTH`, S3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is documented, so the documented column holds the web client's behaviour from the bundle, S3, where there is one.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none, the client opens one public socket | one URL for every spot pair |
| subscribe frame shape | one JSON object per channel and symbol, `{"channel", "event": "subscribe", "symbol", ...}` | as documented. Five `market_depth` subscriptions on one socket all delivered |
| unknown symbol expectation | Not publicly specified | `NOPE_USDT` and lower case `btc_usdt` got no reply and no error for 4 to 6 s, in both runs |
| chunk unit and budget | Not publicly specified | not tested beyond five subscriptions |
| keepalive mechanism | the client answers each server `{"event":"pong"}` with `{"event":"ping"}`, an inverted naming | The server sent `{"event":"pong"}` at 0 s and then every 30 s. A client that never answered kept its socket for 150 s and 100 s, with data flowing |
| connection lifetime and maintenance notice | Not publicly specified | no forced close and no maintenance frame in about 10 minutes of sockets |
| handshake and operation rate limits | Not publicly specified | none hit, with one socket open at a time |
| public market data authentication | none | none |
| message parse and routing | the client routes on `channel` | `{"channel": ..., "data": {...}}`, and `data.symbol` names the pair |
| subscribe acknowledgement shape | none | no acknowledgement frame, the first data frame is the only answer |
| symbol identifier format | `BASE_QUOTE` upper case | `BTC_USDT`, the same as the REST catalog |
| number representation | strings | prices and sizes are JSON strings, trade and kline times are integer ms |
| timestamp representation | none on the book | `market_depth` frames carry no timestamp |
| size unit | base currency | base currency, rounded to six decimals, see section 4 |
| sequence semantics | none, the client replaces the book on every frame | no sequence field on any frame |
| idle repeat behaviour | Not publicly specified | `BTC_USDT` repeated an unchanged book on 45 of 47 and 29 of 34 consecutive pairs of frames, while quiet pairs sent nothing for up to 20 s |

The socket does not negotiate permessage-deflate, `Sec-WebSocket-Extensions` was absent, and every frame is plain text JSON.

## 4. The book channel in detail

### Snapshot on subscribe

There is no immediate snapshot.
The first `market_depth` frame on `BTC_USDT` came 1.99 s and 1.74 s after the subscribe in section A of the two runs, and 0.2 to 0.7 s in section F.
In section E of run 2, the first frame came after 0.4 s on `BTC_USDT`, 1.4 s on `ETH_BTC`, 8.4 s on `DOGE_USDT`, 9.4 s on `SOL_USDT` and 20.4 s on `ETH_USDT`.
In run 1, `ETH_BTC` sent nothing at all in 30 s.
So a frame appears to follow activity on the pair rather than the subscribe, and a quiet pair has no book until it moves.

### Delta semantics

There are no deltas.
Every frame carries the whole top N window for both sides, and the web client replaces its book with each frame, `setDepth(e.data)`, S3.

### Sequence and gap rule

There is no sequence, update id or timestamp on a book frame.
Since every frame is a full window, a lost frame costs nothing beyond staleness, and no gap rule is needed.

### Checksum

None.

### Level order on the wire

Asks ascending and bids descending on every frame of both runs.
Each level is `[price, size]` as strings, such as `["82584.79","0.109701"]`.
No zero size was seen.

### Level window

| `levels` | answered |
|---|---|
| 5 | 5 a side, run 1 |
| 10 | 10 a side, run 2 |
| 20 | 20 a side on every frame of sections A |
| 50 and 100 | no frame in 6 s in run 1 and 8 s in run 2 |
| 200 | the whole book, 91 to 92 asks and 82 bids, about 4.5 KB |
| 7 | no frame in 6 s |

`price_precision` groups levels by price decimals, and the frame echoes `levels` and `price_precision`.
Precision 0 and 1 on `BTC_USDT` gave prices like `82594` and `82594.5`.
The allowed precisions per pair are `depth_price_precision` in the trading page's symbol table, see [`rest.md`](./rest.md) section 2, and precision 9 got no frame.
A feed wants the pair's finest precision, the last value of that list, such as 2 for `BTC_USDT` and 6 for `ETH_BTC`.

### Size unit

Base currency.
The socket rounds sizes to six decimals, `0.109701`, where the REST book gave `0.1097011` and `0.10970110` for the same level.
Level prices 1 to 5 on the socket equalled the REST book's in both runs, and the best levels matched the REST reply fetched right after.
There is no contract size.

### One-sided and empty books

`EOS_BTC`, with no bid or ask on REST, was not subscribed.
`ETH_BTC`, which the ticker call marks `is_frozen` 1, sent book frames in section E of both runs.
An unknown symbol sends nothing, so a feed cannot tell an empty or unknown pair from a quiet one.

### Idle repeats

On `BTC_USDT` the frames came 0.98 to 4.00 s apart with a median of 1.00 s, 48 frames in 60 s and 35 in 45 s.
Most were identical to the previous frame, 45 of 47 and 29 of 34.
`ETH_USDT` sent 29 frames in 150 s in run 1, so the push cadence follows the pair's activity.

### Unknown and closed symbols

`NOPE_USDT`, lower case `btc_usdt`, `levels` 7, `price_precision` 9 and an unknown channel `nope` each got no reply within 4 s in run 1 and 6 s in run 2.
A frame that is not JSON closes the socket at once with code 1003, reason "Unable to parse JSON message".

## 5. Session

- Keepalive: the server sends `{"event":"pong"}` on connect and every 30 s, at 0, 30, 60, 90 and 120 s.
  The web client answers each with `{"event":"ping"}`, S3.
  Not answering did not close the socket in 150 s and 100 s, and depth frames kept flowing, 78 in the 100 s window of run 2.
- Silence: a socket on active pairs gets the 30 s server frame at least, so a whole socket silent for more than about 35 s is dead.
  A single quiet pair can be silent for longer than that.
- Unsubscribe: `{"event":"unsubscribe", ...}` with the same fields works.
  No `BTC_USDT` frame arrived in the 12 s after it in either run, while the other pairs went on.
- Forced disconnects and maintenance notices: none seen.
- Compression: none.
- Handshake and subscription limits: not published and not hit.

## 6. Captured frames

Server keepalive, first frame on every socket and then every 30 s:

```json
{"event":"pong"}
```

A `market_depth` frame for `levels` 20, trimmed to two levels a side, which is also the only kind of answer to a subscribe:

```json
{"data":{"asks":[["82584.79","0.109701"],["82585.91","0.193463"]],"bids":[["82582.25","0.118738"],["82581.07","0.213351"]],"symbol":"BTC_USDT","price_precision":2,"levels":20},"channel":"market_depth"}
```

There is no delta frame and no acknowledgement frame.

Trade and kline frames:

```json
{"channel":"trade","data":{"trades":[["82593.87","0.000680",1791607100712,"BUY"]],"symbol":"BTC_USDT"}}
```

```json
{"channel":"kline","data":{"candles":[[1791607080000,"82593.87","82593.88","82593.87","82593.87","0.014935"]],"symbol":"BTC_USDT","interval":"ONE_MINUTE"}}
```

The only error is a close: code 1003, reason `Unable to parse JSON message`, after a frame that is not JSON.

## 7. Private channels

- `wss://www.coincola.stream/ws/margin?token=<token>`, with the token from `GET /ws/token` behind a login, S3.
- Channels `USER_MARGIN_ACCOUNT` and `MARGIN_INDEX_TICK`, subscribed with `{"channel": ..., "command": "SUBSCRIBE"}`, and a client `{"command":"PING"}` every 30 s, S3.
- CoinCola publishes no private trading API, and the API documentation, S4 of [`fees.md`](./fees.md), covers market data only.

## 8. Recommended feed shape

No perpetual feed is possible, since CoinCola lists no perpetuals.
This is the shape a future spot leg would take.

- URL plan: one socket, `wss://www.coincola.stream/ws`, with an `Origin` of `https://www.coincola.com`.
- Markets per connection: all 29 pairs should fit, five were tested.
- Subscribe frames: one `market_depth` frame per pair, `levels` 20 and the pair's finest `price_precision`.
- Book handling: replace both sides on every frame, since every frame is a full window.
- Snapshot: read the REST book, `GET /v1/market/orderbook?level=2&depth=40`, at subscribe, because a quiet pair sends nothing until it moves.
- Keepalive: answer each `{"event":"pong"}` with `{"event":"ping"}`, as the web client does.
- `maxSilenceMs`: about 35 s for the whole socket, keyed on the 30 s server frame, and none per pair, since a quiet pair can be silent for 20 s or more.
- Resync rule: none for gaps, a reconnect on socket silence, and a REST refresh of a pair that has been quiet for a long time.
- Size and price: base currency sizes rounded to six decimals, no contract size, no price scale.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S3, S4 | see [`fees.md`](./fees.md) section 10 | 2026-10-09 |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/coincola/ws-probe.py), sections A to F, run 1 at 04:34 to 04:40 UTC and run 2 at 04:40 to 04:45 UTC on 2026-10-10 | 2026-10-10 UTC |
| R1 | [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md) | 2026-10-09 |
