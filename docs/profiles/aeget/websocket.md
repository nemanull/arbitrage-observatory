# AEGET WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:56 to 03:10 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures market socket of AEGET's web app.
AEGET publishes no WebSocket documentation, so every "documented" value below comes from the web bundle `https://aeget.io/static/js/main.2cc29413.chunk.js`, S10 of [`fees.md`](./fees.md).
Every probed value was captured by [`ws-probe.py`](../../../scripts/probes/venues/aeget/ws-probe.py).
The socket is the same software, with the same frames, as BASEKX's, whose profile is [`../basekx/websocket.md`](../basekx/websocket.md).

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://aeget.io/ws/market` | opened in 706 to 1,717 ms on all 12 opens over two runs, no refusal |
| futures private | `wss://aeget.io/ws/user`, from the bundle | not probed |
| spot | `wss://aeget.io/ws/socket`, from the bundle | not probed |

The bundle builds the URL as `${protocol}//${document.domain}/ws` plus `/market`, so the socket lives on whatever host serves the web app.
CoinMarketCap's listed site `www.aeget.com` closes the TLS handshake from this exit, see [`rest.md`](./rest.md) section 1, so no socket on that host could be opened.
`aeget.io` is the reachable host that serves the AEGET web app, behind Cloudflare.
There is no coin-M family, see [`rest.md`](./rest.md) section 2.

## 2. Channel matrix for public market data

| request | pushes | depth and speed | probed |
|---|---|---|---|
| `{"req":"sub_symbol","symbol":"btc_usdt"}` | `push.deep.full`, `push.deep`, `push.deal`, `push.ticker`, `push.index.price`, `push.mark.price`, for that one symbol | full book of 100 levels a side about every 1.2 s, plus one level changes | 38 to 40 `push.deep.full` and 233 to 604 `push.deep` per symbol in 40 s on `btc_usdt` and `eth_usdt`, over two runs |
| `{"req":"sub_tickers"}` | `push.tickers`, every contract in one frame | about every 2 s | 7 frames of 242 rows in 15 s, in both runs |
| `{"req":"sub_mark_prices"}` | `push.mark.prices`, every contract in one frame | about every 2 s | 7 frames in 15 s, 13 of 244 rows and 1 of 241 rows over two runs |

There is no book channel apart from what `sub_symbol` delivers, and no depth or speed choice.
There is no funding channel.
`push.index.price` arrived 40 times in 40 s per symbol in both runs, once a second.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all USDT-M perpetuals | one URL |
| subscribe frame shape | `{"req":"sub_symbol","symbol":...}`, from the bundle's `emitAboutSymbol` | as documented |
| unknown symbol expectation | none | `nope_usdt` answers `succeed` and then sends nothing |
| chunk unit and budget | the web app keeps one symbol per socket | one symbol per socket. Five `sub_symbol` frames on one socket got five `succeed` replies, and only the last symbol, `doge_usdt`, delivered in 20 s |
| keepalive mechanism | the bundle sends the text `ping` every 10 s | text `ping` answered by text `pong` in 170 to 284 ms, 12 of 12 over two runs |
| connection lifetime and maintenance notice | none | no notice and no close in the 70 s silence run |
| handshake and operation rate limits | none | 2 sockets at once and 5 subscribe frames in one burst, no refusal |
| public market data authentication | none | none |
| message parse and routing | the bundle routes on `channel`, or on `type` after inflating a binary frame with pako | every frame was JSON text routed on `channel`, then `data.s` |
| subscribe acknowledgement shape | none | the bare text `succeed`, with no symbol and no id |
| symbol identifier format | lowercase `btc_usdt` | identical to the REST `symbol` |
| number representation | none | strings, and sizes switch to scientific notation such as `"1.58E+4"` and `"5.7E+2"`: 693 to 1,123 such values per symbol in 40 s |
| timestamp representation | none | `push.deep` carries `t` in ms, and `push.deep.full` carries none |
| size unit | none | whole contracts, the same integers as the REST book, see section 4 |
| sequence semantics | none | `id` is an 18 digit decimal string that never went backwards, 0 reversals in 1,618 deltas over two runs, but it skips by 2 most often, so it cannot detect a gap |
| idle repeat behaviour | none | the full book comes again about every 1.2 s whether it changed or not |

## 4. The book channel in detail

### Snapshot on subscribe

`push.deep.full` is a whole book, `{"s","id","a","b"}`, with 100 asks and 100 bids on all 156 frames over two runs.
It is not sent first, since the first frame on every socket was a `push.deal` in the first run and a `push.index.price` in the second.
It repeats every 564 to 1,253 ms, with a median of 1,192 to 1,198 ms per symbol.

### Delta semantics

`push.deep` carries one level, `{"id","s","ba","p","q","t"}`, where `ba` 1 is a bid and `ba` 2 an ask, and `q` `"0"` deletes the level.
A book built from the previous `push.deep.full` plus every `push.deep` matched the top five bids of the next `push.deep.full` on 152 of 152 comparisons over two runs and two symbols.

### Sequence and gap rule

There is none.
The most common step between consecutive delta ids was 2, on 119 to 273 steps per symbol and run, followed by 4 and 6 in the first run and by 1 and 4 in the second.
A lost delta would be invisible until the next `push.deep.full`, at most about 1.2 s later.
The only safe rule is to replace the book on every `push.deep.full`.

### Checksum

None.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `push.deep.full` | descending on 156 of 156 | ascending on 156 of 156 |
| `push.deep` | one level per frame | one level per frame |
| REST depth | descending | ascending |

### Size unit against `contractSize`

Sizes are whole contracts, such as `"4667"` on `btc_usdt`, whose catalog `contractSize` is `0.0001` and `quantityPrecision` 0.
That reading comes from the catalog and was not proven against a trade.
Not verified.
There is no CCXT `contractSize` to compare.

### One-sided, empty and unknown books

An unknown symbol is acknowledged with `succeed` and stays silent.
One-sided and empty books were not observed.
Not verified.

## 5. Session

- Keepalive: the text `ping` gets the text `pong` in 170 to 284 ms.
- Compression: the probe offered no permessage-deflate, and the server sent no `Sec-WebSocket-Extensions` header.
  Every frame was plain JSON text, so the bundle's binary pako path did not occur.
- A malformed frame, the text `not json`, is answered with the text `Invalid parameter`, and the server then closes with 1005 and no reason.
- An unknown `req` such as `sub_nothing` and a JSON ping `{"ping":1}` get no reply.
- A socket subscribed to `btc_usdt` that never sent a ping stayed open for the whole 70 s silence run, in both runs.
  The longer limit was not measured.
- No maintenance notice was seen.

## 6. Captured frames

Subscribe acknowledgement, the whole frame:

```text
succeed
```

Snapshot, trimmed to three levels per side:

```json
{"channel":"push.deep.full","data":{"s":"eth_usdt","id":"679055818997385359","a":[["2491.44","5755"],["2491.45","7033"],["2491.46","756"]],"b":[["2491.42","7877"],["2491.41","2"],["2491.4","946"]]}}
```

The first run's snapshot carried a size written as `"1.58E+4"` on its second ask.

Delta:

```json
{"channel":"push.deep","data":{"id":"679053578819618881","s":"btc_usdt","ba":1,"p":"82590.6","q":"4667","t":1791600989396}}
```

Index and mark, on the same second:

```json
{"channel":"push.index.price","data":{"s":"btc_usdt","p":"82590.7","t":1791600990164}}
```

```json
{"channel":"push.mark.price","data":{"s":"btc_usdt","p":"82590.7","t":1791600990164}}
```

Trade:

```json
{"channel":"push.deal","data":{"s":"btc_usdt","p":"82590.7","a":"5","m":"BID","t":1791600989396}}
```

Keepalive answer and error, whole frames:

```text
pong
Invalid parameter
```

## 7. Private channels

The bundle opens `wss://aeget.io/ws/user` and sends `{"req":"sub_user","listenKey":...}` with a key from the private REST call `/v1/user/listen-key`.
Not probed.

## 8. Recommended feed shape

No feed is recommended, because the venue has no usable anchor, see [`rest.md`](./rest.md) section 8.
If one were built, it would take this shape.

- URL: `wss://aeget.io/ws/market`, on the host that serves the web app, which is not the host CoinMarketCap lists.
- Markets per connection: one, because a second `sub_symbol` replaces the first.
  All 240 trading contracts would need 240 sockets.
- Subscribe frame: `{"req":"sub_symbol","symbol":"btc_usdt"}`.
- Keepalive: the text `ping` every 10 s, as the web app does.
- `maxSilenceMs`: about 5,000, since `push.deep.full` arrives about every 1.2 s.
- Resync: replace the book on every `push.deep.full`, apply `push.deep` levels between them, and parse sizes with a float parser that accepts `E+` notation.

The engine's XT adapter, `server/src/venues/xt.rs`, speaks XT's own public socket and does not fit this one.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S10 | AEGET web bundle `https://aeget.io/static/js/main.2cc29413.chunk.js`, the `ws` and `spotWs` URL builder, `emitAboutSymbol`, `heartbeat` and the message listener | 2026-10-09 |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/aeget/ws-probe.py), modes `book`, `batch`, `market` and `errors` | 2026-10-10 UTC |
| R1 | [`../basekx/websocket.md`](../basekx/websocket.md), the same socket on another venue | 2026-09-24 |
