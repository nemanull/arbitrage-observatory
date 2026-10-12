# Coinmetro WebSocket Profile

**Status:** Done.
Coinmetro lists no perpetuals and trading has been disabled since 2026-06-22, so this profile records the spot socket, which opens and then sends nothing.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:16 to 03:28 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public socket of Coinmetro.
The documented protocol is a query string subscription that pushes book deltas with a CRC32 checksum and trades, S5.
On the wire the socket accepts every handshake, answers a protocol ping, and sends no frame at all, for a listed pair, an unknown pair or no pair, P3.
That matches the frozen market of [`rest.md`](./rest.md) section 2, where the last BTCEUR trade is from 2026-06-22.
Source ids S1 to S11 and P1 to P2 are those of [`fees.md`](./fees.md).

## 1. Endpoints

| environment | URL | source | probed |
|---|---|---|---|
| live | `wss://api.coinmetro.com/ws` | S5 | 101 on every handshake, in 556 to 1,561 ms, P3 |
| demo | `wss://api.coinmetro.com/open/ws` | S5 | 101 in 1,578 and 584 ms in two runs, no frame in 45 s, P3 |

One socket carries every pair named in its `pairs` query parameter, S5.
There are no perpetual families, so there is no family split.

## 2. Channel matrix for public market data

| channel | how to get it | documented | probed |
|---|---|---|---|
| book deltas | `?pairs=BTCEUR,ETHEUR` on the URL | `bookUpdate`, deltas only, with `seqNumber` and `checksum`, S5 | no frame in 60 s, P3 |
| trades with best bid and ask | always on, for every pair | `tick` with `ask` and `bid`, "received for all pairs, always", S5 | no frame in 60 s on any socket, P3 |
| book snapshot | none on the socket | not documented, the REST full book is the snapshot, S4 | none |
| ticker, mark, index, funding | none | none in S5 | none |
| depth or speed variants | none | one delta stream per pair, S5 | none |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one live URL and one demo URL, S5 | one URL for all pairs |
| subscribe frame shape | no frame, the `pairs` query parameter, S5 | the handshake with `pairs` returned 101, P3 |
| unknown symbol expectation | Not publicly specified | `pairs=NOPEEUR` returned 101 and then nothing for 15 s, the same as a listed pair, P3 |
| chunk unit and budget | Not publicly specified | not testable while nothing is pushed |
| keepalive mechanism | Not publicly specified | a protocol ping got a pong in 135 to 145 ms, P3 |
| connection lifetime and maintenance notice | Not publicly specified | every socket stayed open for its whole 15 to 60 s window, P3 |
| handshake and operation rate limits | 500 calls per 10 s per IP at Cloudflare for REST, S5, nothing for the socket | ten handshakes over the session, no refusal |
| public market data authentication | none, the `token` parameter is optional, S5 | none |
| message parse and routing | the single top level key names the message, `bookUpdate`, `tick`, `orderStatus`, `walletUpdate`, `newReferral`, S5 | no message to parse |
| subscribe acknowledgement shape | none documented | none |
| symbol identifier format | the pair as in `/markets`, such as `BTCEUR`, S5 | the same spelling as REST `/markets` and `/exchange/book/{pair}`, P2 |
| number representation | prices as object keys with fixed decimals, quantities as JSON numbers, S5 | the REST book and updates use the same shape, P2 |
| timestamp representation | ms since the epoch on `tick`, none on `bookUpdate`, S5 | not observed on the socket |
| size unit | the base currency, "quantity deltas in the base currency", S5 | base currency in the REST book, P2 |
| sequence semantics | `seqNumber` on every update, no gap rule stated, S5 | one counter across pairs, since 68 of 199 ETHEUR update numbers fall inside the BTCEUR range and none is shared, P2 |
| idle repeat behaviour | Not publicly specified | total silence while trading is disabled |

## 4. The book channel in detail

| item | value | source |
|---|---|---|
| snapshot on subscribe | none documented and none received | S5, P3 |
| delta semantics | each `bookUpdate` carries `ask` and `bid` objects whose values are quantity deltas at that price, negative to remove | S5, P2 |
| sequence and gap rule | `seqNumber` grows by 3 to 7 or more between consecutive BTCEUR updates, and ETHEUR numbers interleave with them, so it is one counter across pairs and cannot detect a gap within one pair | P2 |
| checksum | CRC32, signed 32 bit, over the sorted asks then the sorted bids, each `price` with the pair's fixed decimals followed by the quantity rounded and stripped of trailing zeros | S5 |
| checksum on the wire | the REST BTCEUR book's `checksum` 1112741473 matched the probe's recomputation by that rule | P2 |
| level order | object keys, so a client sorts, the REST book happens to list asks rising and bids falling | P2 |
| size unit | base currency, no contract size | S5 |
| one sided or empty book | Not publicly specified | |
| idle repeats | none, the socket was silent | P3 |
| unknown or closed symbol | the handshake succeeds and nothing arrives | P3 |

The checksum is the resync signal, because the sequence is not per pair.
A feed would load the REST full book, apply socket deltas whose `seqNumber` is above the book's, and resync whenever the checksum after an update disagrees.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | the server answered protocol pings, and sent no ping of its own that reached the application in 60 s | P3 |
| silence tolerated | at least 60 s with no client traffic after the first ping | P3 |
| forced disconnects | none seen | P3 |
| maintenance notices | none documented | S5 |
| compression | the probe offered none and the server sent no `Sec-WebSocket-Extensions` header | P3 |
| handshake limit | Not publicly specified | |

## 6. Captured frames

No frame was received on any of the four sockets, so there is nothing to show.
The documented shapes are these, S5.

```json
{"bookUpdate": {"pair": "BTCEUR", "seqNumber": 16980133271, "ask": {}, "bid": {"45500.00": -0.0718022}, "checksum": 1112741473}}
```

That body is the last entry of REST `/exchange/bookUpdates/BTCEUR/0`, wrapped in the documented `bookUpdate` key, P2.

```json
{"tick": {"pair": "BTCEUR", "price": 56616.12, "qty": 0.00043258, "timestamp": 1782144135788, "seqNum": 16979959789, "ask": 59774.97, "bid": 52000.0}}
```

That body is the last BTCEUR trade from REST `/exchange/ticks`, at 2026-06-22 16:02:15 UTC, with the current REST best ask and bid added in the documented shape, P2.

## 7. Private channels

The same URL with `token={jwt}` or `token={deviceId}:{token}` adds `orderStatus`, `walletUpdate` and `newReferral` messages, S5.

## 8. Recommended feed shape

None.
Coinmetro has no perpetuals, and its spot socket is silent because trading is disabled, S3 and P3.
If trading resumed, a spot feed would open `wss://api.coinmetro.com/ws?pairs=...` with the markets of one connection, fetch `/exchange/book/{pair}` per market as the snapshot through the engine's `snapshot_url` hook at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 96, apply deltas newer than the snapshot's `seqNumber`, verify the checksum after each update, and resync on a mismatch.
`maxSilenceMs` cannot be set from a silent socket and would need a fresh probe.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S3 | Announcement: Onboarding, trading, depositing and withdrawals paused | https://coinmetro.com/blog/announcement-onboarding-depositing-and-withdrawals | 2026-10-09 | Coinmetro OÜ | trading disabled |
| S4 | COINMETRO API (PUBLIC), Postman collection | https://documenter.getpostman.com/view/3653795/SVfWN6KS | 2026-10-09 | Coinmetro | REST book and book updates |
| S5 | CoinMetro API-DOCS README | https://github.com/CoinMetro/API-DOCS/blob/5edcc5caaaa4784d0ce5051072e8b1407ec087ef/README.md | 2026-10-09 | Coinmetro | socket URL, messages, checksum rule |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/coinmetro/rest-probe.py) modes `book` and `catalog` | `uv run scripts/probes/venues/coinmetro/rest-probe.py book catalog` | 2026-10-09 | this host, Canadian exit | book shape, checksum, sequence steps, last trade |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/coinmetro/ws-probe.py) | `uv run scripts/probes/venues/coinmetro/ws-probe.py` | 2026-10-09 | this host, Canadian exit | four sockets, handshakes, pongs, silence |
