# BASEKX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:45 to 07:10 UTC by the host clock, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public futures WebSocket of BASEKX, which has no CCXT class and no published API documentation, see [`fees.md`](./fees.md) section 1.
The URL and the subscribe frames were read from the web client's bundle `https://www.basekx.com/static/js/main.92e0da7a.chunk.js`, and every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/basekx/ws-probe.mjs).
There is no documented value for any axis, so the "documented" column quotes the web client where it says something.
Access results are from that Canadian VPN exit.
Sockets were open for about four and a half minutes of wall time, about eight and a half socket minutes in total.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://www.basekx.com/ws/market` | open in 624 to 1,708 ms on every open, no refusal |
| futures private | `wss://www.basekx.com/ws/user`, from the web client | not probed |
| spot | `wss://www.basekx.com/ws/socket`, from the web client | not probed |

The client builds the URL as `${proto}//${host}/ws` plus `/market`.
`wss://www.basekx.com/futures/ws/market` and `wss://www.basekx.com/fws/market` answered the upgrade with HTTP 200 and the site's HTML.
`wss://www.basekx.com/ws/market/` with a trailing slash opened and then closed with 1002 "Protocol error".
There is no coin-M family to carry, see [`rest.md`](./rest.md) section 2.

## 2. Channel matrix for public market data

| request | pushes | depth and speed | probed |
|---|---|---|---|
| `{"req":"sub_symbol","symbol":"btc_usdt"}` | `push.deep.full`, `push.deep`, `push.deal`, `push.ticker`, `push.index.price`, `push.mark.price` for that one symbol | full book of 100 levels per side about every 1.1 to 1.2 s, plus per level changes | 49 to 51 `push.deep.full` and 214 to 540 `push.deep` per symbol in 60 s, in `book` |
| `{"req":"sub_tickers"}` | `push.tickers`, every symbol in one frame | about every 2 s | 7 frames with 161 symbols in 15 s, in `market` |
| `{"req":"sub_mark_prices"}` | `push.mark.prices`, every symbol in one frame | about every 2 s | 7 frames with 164 symbols in 15 s, in `market` |

There is no book channel apart from the bundle that `sub_symbol` delivers, no depth choice and no speed choice.
There is no funding channel.
`push.index.price` and `push.mark.price` arrived once a second per symbol with the same `p` and the same `t`, 204 of each over four symbols in 60 s, in `book`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all USDT-M perpetuals | one URL, section 1 |
| subscribe frame shape | the web client sends `JSON.stringify({req: t, ...o})`, as in `{"req":"sub_symbol","symbol":"btc_usdt"}` | as documented, one symbol per frame |
| unknown symbol expectation | none | `sub_symbol` on `nope_usdt` answers `succeed` and then sends nothing, in `errors` |
| chunk unit and budget | the web client keeps one symbol per socket | one symbol per socket. `sub_symbol` for 20 symbols on one socket got 20 `succeed` replies, and only the last symbol, `pepe_usdt`, delivered, in `batch`. The first four symbol run showed the same, only `dot_usdt` delivered |
| keepalive mechanism | the web client sends the text `ping` every 10 s | text `ping` answered by text `pong`, 20 of 20 over four sockets in `book` |
| connection lifetime and maintenance notice | none | no notice and no forced close in 61 s, see section 5 |
| handshake and operation rate limits | none | 4 sockets opened at once and 20 subscribe frames in one burst, no refusal |
| public market data authentication | none | none |
| message parse and routing | `channel` field, from the client's `messageListener.emit(t.channel, e)` | route on `channel`, then `data.s` |
| subscribe acknowledgement shape | none | the bare text `succeed`, with no symbol, no id and no channel |
| symbol identifier format | lowercase `btc_usdt` | identical to the REST `symbol` |
| number representation | none | prices and sizes are strings, and sizes switch to scientific notation such as `"1.71E+3"` and `"6.1E+2"` in both `push.deep.full` and `push.deep`: 716 to 1,507 such values per symbol in 60 s |
| timestamp representation | none | `push.deep` carries `t` in ms. `push.deep.full` carries no timestamp |
| size unit | none | contracts, the same integers as the REST depth call, see [`rest.md`](./rest.md) section 2 |
| sequence semantics | none | `id` is a decimal string of 18 digits that never went backwards, 0 reversals in 1,527 deltas, but it is shared across symbols and skips values, so it cannot detect a gap |
| idle repeat behaviour | none | the full book is pushed again about every 1.2 s whether it changed or not |

## 4. The book channel in detail

### Snapshot on subscribe

`push.deep.full` is a whole book, `{"s","id","a","b"}`, with 100 asks and 100 bids on every one of 200 frames in `book`.
It arrived first on `btc_usdt` and `dot_usdt`, and after a `push.deep` delta on `eth_usdt` and `sol_usdt`.
It repeats every 395 to 2,654 ms, with a median of 1,100 to 1,194 ms per symbol.

### Delta semantics

`push.deep` carries one level: `{"id","s","ba","p","q","t"}`, where `ba` 1 is a bid and `ba` 2 an ask, and `q` `"0"` deletes the level.
120 of 539 `btc_usdt` deltas were deletions.
A book built from the previous `push.deep.full` plus every `push.deep` matched the top five bids of the next `push.deep.full` on 196 of 196 comparisons over four symbols.

### Sequence and gap rule

There is none.
The `id` of consecutive deltas skips values, as in `673313943363518595`, `...597` and `...605` on `eth_usdt`, because it is the engine's update counter across symbols.
A lost delta would be invisible until the next `push.deep.full`, at most about 2.7 s later.
The only safe rule is to replace the book on every `push.deep.full`.

### Checksum

None.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `push.deep.full` | descending on 200 of 200 | ascending on 200 of 200 |
| `push.deep` | one level per frame | one level per frame |
| REST depth | descending | ascending |

### Size unit against `contractSize`

Sizes are contracts of `contractSize` coins by the REST catalog and the matching REST book, not proven against a trade, see [`rest.md`](./rest.md) section 2.
Not verified.

### One-sided, empty and unknown books

An unknown symbol is acknowledged with `succeed` and stays silent.
One-sided and empty books were not observed.
Not verified.

## 5. Session

- Keepalive: text `ping` gets text `pong` 201 ms later in `errors`.
- Compression: the probe refused permessage-deflate and the server accepted, `extensions` was empty on every open.
  Frames are plain JSON text.
- A malformed frame, the text `not json`, is answered with the text `Invalid parameter` and the server then closes the socket, 1005 with no reason, in `errors`.
- An unknown `req` such as `sub_nothing` gets no reply.
- No maintenance notice was seen.

Silence result, in `silence`: a socket subscribed to `btc_usdt` that never sent a ping, and an idle socket that neither subscribed nor pinged, both stayed open for the whole 70 s test.
The 1006 closes logged at 70.7 and 71.4 s are the probe's own `terminate`.
So the server tolerated at least 70 s without a client ping, and the longer limit was not measured.

A JSON ping `{"ping":<ms>}` got no reply, and `{"req":"unsub_symbol"}` got `succeed`, in the second `errors` run.

## 6. Captured frames

Subscribe acknowledgement, the whole frame:

```text
succeed
```

Snapshot, trimmed to three levels per side:

```json
{"channel":"push.deep.full","data":{"s":"btc_usdt","id":"673313942986031183","a":[["84103.2","4.33E+3"],["84103.3","3.12E+3"],["84103.4","904"]],"b":[["84103","8747"],["84102.9","16"],["84102.8","647"]]}}
```

Delta:

```json
{"channel":"push.deep","data":{"id":"673313943363518595","s":"eth_usdt","ba":1,"p":"2686.35","q":"908","t":1790232553666}}
```

Index and mark, one second apart on the grid:

```json
{"channel":"push.index.price","data":{"s":"dot_usdt","p":"1.1271","t":1790232441162}}
```

```json
{"channel":"push.mark.price","data":{"s":"dot_usdt","p":"1.1271","t":1790232441162}}
```

Keepalive answer and error, whole frames:

```text
pong
Invalid parameter
```

## 7. Private channels

`wss://www.basekx.com/ws/user`, subscribed in the web client with `{"req":"sub_user","listenKey":...}` after a listen key call.
Not probed.

## 8. Recommended feed shape

None.
A feed would need one socket per symbol, 161 sockets for the catalog, because `sub_symbol` replaces the previous symbol.
It would have no gap rule and would rely on the 100 level `push.deep.full` about every 1.2 s, and it would have to parse sizes in scientific notation.
The book it delivers appears to be XT's book, see [`rest.md`](./rest.md) section 2, and the anchor is the perp's own price, see [`rest.md`](./rest.md) section 4.
If it were built anyway: URL `wss://www.basekx.com/ws/market`, one `sub_symbol` per socket, a text `ping` every 10 s, `resetBook` on every `push.deep.full`, `setBid` or `setAsk` on every `push.deep`, and a `maxSilenceMs` of about 5 s, since the full book repeats at most 2.7 s apart.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | `https://www.basekx.com/static/js/main.92e0da7a.chunk.js` | URL, `req` frames, text `ping` every 10 s, `channel` routing |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/basekx/ws-probe.mjs) `book`, `batch`, `market`, `errors`, `silence` | every probed value |
