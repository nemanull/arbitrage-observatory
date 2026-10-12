# SuperEx WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 02:53 to 03:11 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the public market socket as the SuperEx USDT-margined perpetuals use it, with the book topic in detail.
SuperEx documents this socket only for its Free Market spot zone, whose topics start with `freeSpot/`, S2.
The perpetual topics, `swap/depth:<symbol>` and its siblings, are not in any published document.
They were found in the web app bundle at `www.superex.live`, S11, and every claim about them was captured by [`ws-probe.py`](../../../scripts/probes/venues/superex/ws-probe.py).
The "documented" column therefore quotes the Free Market page where the same socket behaviour applies, and otherwise reads Not publicly specified.
Total socket time over the session was about nine minutes.

## 1. Endpoints

| item | value | label | evidence |
|---|---|---|---|
| public URL | `wss://api.superexchang.com/socket/ws` | Published for the Free Market, Probed for perpetuals | S1, S2, probe mode `session` |
| families on one socket | one socket carries perpetual books, mark, index, funding, tickers and the Free Market topics, keyed by topic prefix | Probed | probe modes `session` and `bulk` |
| host | an Akamai edge, 23.213.230.74 and 23.213.230.75 from this exit | Probed | [`rest.md`](./rest.md) section 1 |
| Origin header | the probe sends `https://www.superex.live`. A run without it was not tried. | Probed | probe source |

## 2. Channel matrix for public market data

| topic | content | cadence on btc_usdt | label |
|---|---|---|---|
| `swap/depth:<symbol>` | full book, `action` always `partial` | one frame about every 540 ms | Probed |
| `swap/ticker:<symbol>` | last price, 24 h change, high, low, previous close `hqzrsp`, volume `sumNumber` | 390 to 810 ms median over two runs, eth_usdt faster than btc_usdt | Probed |
| `swap/trade:<symbol>` | trades | not measured | bundle only, S11 |
| `swap/new_price:<symbol>` | last trade price and side | not measured | bundle only, S11 |
| `swap/mark_price:<symbol>` | mark price as one number | about 1.9 s median | Probed |
| `swap/index_ticker:<symbol>` | index price as one number | about 3.0 s median | Probed |
| `swap/funding_rate:<symbol>` | `{date, fundingRate}`, the next settlement in ms and the current period rate | 2 frames in 40 s, 11 to 30 s apart | Probed |
| `swap/price:swap` | last price of every contract in one frame | not measured | bundle only, S11 |
| `swap/config:swap` | the contract list, by its name the same rows as the REST catalog | not measured | bundle only, S11 |
| `swap/candle<period>:<symbol>` | candles, with an `op` `req` history call | not measured | bundle only, S11 |
| best bid and ask only | none | | not found in the bundle |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for the Free Market, S2 | one URL for everything, section 1 |
| subscribe frame shape | `{"op": "sub", "args": ["freeSpot/depth:68"]}`, several topics per frame, S2 | `{"op": "sub", "args": ["swap/depth:btc_usdt", ...]}` with 308 topics in one 7,337-byte frame, all acked |
| unknown symbol expectation | error code `invalid-parameter` with "invalid symbol", S2 | `swap/depth:nope_usdt` is acked like a real one and then sends one empty book, `{"asks": [], "bids": []}`. `swap/mark_price:nope_usdt` sends one frame with no `data` key. |
| chunk unit and budget | Not publicly specified | A 27,817-byte subscribe frame drew close code 1009, "The decoded text message was too big for the output buffer". A 7,337-byte frame and seven frames of up to 4,597 bytes were accepted. |
| keepalive mechanism | "Websocket server sends ping message every 30 seconds", and the client must answer pong, S2 | No server ping arrived in three idle runs. The web app sends the text `ping` every 5 s, S11, and the server answers the text `pong` in about 170 ms. |
| connection lifetime and maintenance notice | Not publicly specified | A socket that never pings is closed with code 1000 and no reason after 34.6 s, 51.0 s and 57.1 s in three runs, while data still flows. No maintenance frame was seen. |
| handshake and operation rate limits | Not publicly specified | No refusal at 308 book topics or at 924 anchor topics on one socket. One socket was open at a time. |
| public market data authentication | none, S2 | none |
| message parse and routing | `{action, currencyId, data, table, timeStamp}` for the Free Market, S2 | `{action, data, symbol, table, timeStamp}`, routed on `table` and `symbol` |
| subscribe acknowledgement shape | Not publicly specified | `{"channel": "swap/depth:btc_usdt", "event": "sub"}` per topic. An unknown `op` answers `{"channel": "", "error": 0, "event": "sub"}`. |
| symbol identifier format | numeric currency id for the Free Market, S2 | lower case `btc_usdt`, identical to the REST catalog `symbol` |
| number representation | numbers, S2 | Book prices and amounts are JSON numbers, and amounts are integers. Mark and index arrive as a string in the first frame and as a number later. `fundingRate` does the same. |
| timestamp representation | `timeStamp` in ms, S2 | `timeStamp` integer ms on every data frame. Local receive minus `timeStamp` was 74 to 144 ms over the runs. |
| size unit | Not publicly specified | contracts of `contractSize` USDT face value, section 4 |
| sequence semantics | none documented, `partial` means "full replacement", S2 | no sequence field on any frame |
| idle repeat behaviour | Not publicly specified | A full book is pushed about every 540 ms even when it did not change. 4 of 75 eth_usdt frames equalled the previous one. |

Every data and acknowledgement frame is a text frame holding Base64 of a gzip document, as S2 says for the Free Market.
All 370 decoded payloads in the second pass began with the gzip magic bytes `1f8b`.
Only `pong` arrives as plain text.
The socket does not negotiate permessage-deflate, `Sec-WebSocket-Extensions` was absent.

## 4. The book channel in detail

### Snapshot on subscribe

Yes.
The first frame after the acknowledgement is a full book with `action` `partial`, within about 0.5 s of the subscribe frame.
Over all 308 contracts, the first book of each arrived within 0.85 s in the second pass.

### Delta semantics

There are no deltas.
Every frame is `action` `partial` and carries the whole visible book, 74 of 74 btc_usdt frames and 75 of 75 eth_usdt frames in 40 s.
S2 defines `partial` as "Data correction request, allowing clients to perform full replacement".
A feed replaces both sides on every frame.

### Sequence and gap rule

No frame has a sequence or update id, so no gap can be detected and none needs to be.
A missed frame is healed by the next one about 540 ms later.

### Checksum

None.

### Level order on the wire

`asks` ascending by price and `bids` descending, checked on the first frame of each symbol.
Each level is an object, `{"amount": 643, "price": 82560.3}`.

### Level window

btc_usdt carried 54 to 56 levels per side and eth_usdt 47 to 52 per side.
There is no depth parameter, so the window is whatever the venue sends, which exceeds the engine's 20 levels on the two majors.

### Size unit

`amount` is a whole number of contracts.
The catalog's `contractSize` is the contract face value in USDT, 100 for btc_usdt and 10 for the other 307 contracts.
S6 gives P&L as "(Closing Price - Opening Price) / Opening Price * Contract Quantity * Face Value", and S4 gives the example "The contract face value per unit is 100 USDT".
So a level of `amount` contracts at `price` holds `amount × contractSize / price` coins.
The top btc_usdt ask above, 643 contracts at 82,560.3, is 64,300 USDT, about 0.78 BTC.
The engine multiplies book sizes by a fixed `contract_size`, so it cannot express a size that depends on the price.
A feed would convert each level to coins itself and report a contract size of 1.

### One-sided and empty books

Empty books are common, and they flicker.
In one 15 s window over all 308 contracts, 39 contracts sent an empty book in every frame and 101 more alternated between empty and full frames.
The first run of the same mode found 15 and 125.
The always empty ones are mostly equities and ETFs on a Saturday, such as msft_usdt, uber_usdt and iwm_usdt, plus usdbrl_usdt.
The flickering ones include crypto contracts such as 1inch_usdt, which was empty in 8 of 28 frames.
btc_usdt and eth_usdt were never empty.
No one-sided book was seen.

### Idle repeats

The venue repeats the full book about every 540 ms whether or not it changed.

### Unknown and closed symbols

An unknown symbol is acked and sends one empty book, then nothing, as section 3 shows.
A feed cannot tell it apart from a real contract with an empty book.
No closed contract was listed to test, since all 308 have `state` 1.

## 5. Session

| item | value | label | evidence |
|---|---|---|---|
| keepalive | send the text `ping`, receive the text `pong` | Probed | probe mode `session` |
| silence tolerated | a socket that never pings is closed after 34.6 to 57.1 s | Probed | probe mode `silence`, three runs |
| server pings | documented every 30 s, none seen | Published, Probed | S2, probe mode `silence` |
| forced disconnects | none seen inside 40 s sessions that pinged | Probed | |
| compression | Base64 gzip inside every text frame, no permessage-deflate | Published, Probed | S2, section 3 |
| subscribe frame size | 27,817 bytes refused with code 1009, 7,337 bytes accepted | Probed | probe mode `bulk` |
| topics per socket | 308 book topics, or 924 mark, index and funding topics, on one socket with no refusal | Probed | probe mode `bulk` |

## 6. Captured frames

All frames below are decoded from their Base64 gzip text, and long books are trimmed.

The first raw frame, the btc_usdt book acknowledgement, 88 characters:

```text
H4sIAAAAAAAA/6tWSs5IzMtLzVGyUiouTyzQT0ktKMmwSipJji8tTilR0lFKLUvNKwHJliYp1QIAjowzMC8AAAA=
```

Subscribe acknowledgement:

```json
{"channel": "swap/depth:btc_usdt", "event": "sub"}
```

Book, as the second pass printed its first btc_usdt frame, cut after five ask levels by the probe's trim:

```text
{"action": "partial", "data": {"asks": [{"amount": 643, "price": 82560.3}, {"amount": 402, "price": 82560.5}, {"amount": 747, "price": 82560.7}, {"amount": 240, "price": 82560.9}, {"amount": 814, "price": 82561.2}, ...
```

The same frame's best bid was `{"amount": 204, "price": 82559.7}`, and its keys were `action`, `data`, `symbol`, `table` and `timeStamp`.

Mark, index and funding:

```json
{"action": "partial", "data": "82560", "symbol": "btc_usdt", "table": "swap/mark_price", "timeStamp": 1791601713728}
```

```json
{"action": "partial", "data": "82598.7", "symbol": "btc_usdt", "table": "swap/index_ticker", "timeStamp": 1791601713729}
```

```json
{"action": "partial", "data": {"date": 1791619200000, "fundingRate": "0.0000212134778123"}, "symbol": "btc_usdt", "table": "swap/funding_rate", "timeStamp": 1791601713730}
```

Keepalive answer, plain text: `pong`.

An unknown symbol, then an unknown `op`:

```json
{"action": "partial", "data": {"asks": [], "bids": []}, "symbol": "nope_usdt", "table": "swap/depth", "timeStamp": 1791601733856}
```

```json
{"channel": "", "error": 0, "event": "sub"}
```

## 7. Private channels

Not publicly specified for perpetuals.
The Free Market documentation signs REST calls with `X-Access-Key`, `X-Signature` and `X-Timestamp`, S1, and names no private socket topic.

## 8. Recommended feed shape

This is the shape a feed would take if the undocumented perpetual topics were accepted.
The verdict in the survey does not accept them, see [`rest.md`](./rest.md) section 8.

- URL plan: one URL, `wss://api.superexchang.com/socket/ws`.
- Markets per connection: all 308 fit on one socket, sent in subscribe frames of about 4 KB, since a 28 KB frame is refused.
- Subscribe frames: `{"op": "sub", "args": ["swap/depth:<symbol>", ...]}`.
- Decode: Base64, then gunzip, then JSON.
- The server has a `gunzip` helper in `server/src/venues/wire.rs` but no Base64 decoder in `server/Cargo.toml`.
- Book handling: reset both sides on every frame and publish, since every frame is a full book.
- Size: convert each level to coins as `amount × contractSize / price`, and report a contract size of 1.
- Keepalive: text `ping` every 5 s, as the web app does.
- `maxSilenceMs`: about 5 s, ten book periods, which also covers a book that is empty in every frame because empty frames still arrive.
- Resync rule: none is needed for gaps, and a reconnect on silence is enough.
- Empty frames: decide whether an empty frame means an empty book or a glitch, since the wire gives no way to tell.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [Quick Start, Free Market API Docs](https://docs-api.superex.com/en/quickStart.html) | 2026-10-09 |
| S2 | [Websocket Free Market Quotes Data](https://docs-api.superex.com/en/websocket.html) | 2026-10-09 |
| S4 | [Introduction to Perpetual Funding Fee Rules](https://support.superex.com/hc/en-001/articles/44457052286361) | 2026-10-09 |
| S6 | [USDT-Margined Futures Account Equity and P&L Calculation](https://support.superex.com/hc/en-001/articles/44462213199129) | 2026-10-09 |
| S11 | The web app at [www.superex.live](https://www.superex.live/), its `window.__NUXT__.config` naming `socketUrl` `wss://api.superexchang.com/socket/ws`, and its `/_nuxt/` chunks holding the `swap/` topics and the 5 s `ping` | 2026-10-09 |
