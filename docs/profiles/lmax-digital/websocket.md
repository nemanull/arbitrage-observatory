# LMAX Digital WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers the public market data and funding rate sockets of LMAX Group's perpetual futures, the researched product of [`fees.md`](./fees.md).
LMAX Digital's own spot market data needs a token, see [`rest.md`](./rest.md) section 2, so it is not profiled here.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/lmax-digital/ws-probe.py), section by section, and the documented value is S1, the perpetual futures OpenAPI spec 1.0.14.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| socket | documented URL | probed |
|---|---|---|
| market data, production | `wss://market-data.london-perpetual.lmax.com/v1/marketdata/web-socket` | opened in 426 to 467 ms over two runs with no token, served by Cloudflare through Vancouver (`CF-RAY ...-YVR`) |
| funding rate, production | `wss://market-data.london-perpetual.lmax.com/v1/funding-rate/web-socket` | opened with no token and pushed rates at once |
| market data, demo | `wss://market-data.perpetual-demo.lmax.com/v1/marketdata/web-socket` | opened with no token, 28 instruments, section 4 |
| trading, production | `wss://trading.london-perpetual.lmax.com/` | not probed, it needs an OAuth token |

There is one perpetual family, USD-quoted linear, so one market data URL carries every symbol.

## 2. Channel matrix for public market data

| channel | how | probed |
|---|---|---|
| order book, snapshots | `SUBSCRIBE` with `updateType` `SNAPSHOT`, the default, at depth `1`, `50` or `0` for the full book | a whole book about every 50 ms |
| order book, incremental | `SUBSCRIBE` with `updateType` `INCREMENTAL` and `updateInterval` `1`, `10` or `100` ms | one snapshot, then sequenced deltas |
| instrument definitions | `GET_INSTRUMENT_DEFINITIONS` with an empty `symbols` list for all, and an `instrumentUpdate` push when a definition changes | 22 production instruments, the push was not seen |
| funding rate | its own socket, no subscribe frame | 22 rows every 5 s |
| best bid and ask | depth `1` snapshots | one level per side |
| trades, ticker, mark, index | none on any public socket | the spec documents trades only on the authenticated trading socket |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market data URL and one funding URL per environment, S1 | all 22 symbols on one socket, section 4 |
| subscribe frame shape | `{"type": "SUBSCRIBE", "symbols": [...], "depth": "50", "updateType": "INCREMENTAL", "updateInterval": "100"}`, S1 | all 22 symbols in one frame got one ack and 22 snapshots within 136 to 276 ms |
| unknown symbol expectation | `"result": "FAILURE"` with `"reason": "Invalid symbol(s): BTC/USD"`, S1 | the same frame for `BTC/USD`. A lowercase `btcusdperp` is accepted and acked as `BTCUSDPERP` |
| chunk unit and budget | Not publicly specified | 22 symbols in one frame, the whole production catalog |
| keepalive mechanism | a `heartbeat` message is documented for the trading socket only | no heartbeat on the market data socket. A socket that sends nothing closed at 60.0 s with no close frame in both runs, a client protocol ping every 20 s kept one open, and a protocol ping was answered in 131 to 141 ms |
| connection lifetime and maintenance notice | a `maintenance` message on the trading socket. Maintenance every two weeks on Saturday 03:30 to 04:00 EST or EDT, S2 | no lifetime cap reached, the longest socket open 70 s, and no notice seen |
| handshake and operation rate limits | Not publicly specified | no refusal on the probe's 14 sockets per run |
| public market data authentication | none on the market data and funding sockets, S1 | none |
| message parse and routing | route on `type`: `subscription`, `metadata`, `instrumentUpdate`, `snapshot`, `delta` | as documented. Funding frames have no `type` and route on the socket |
| subscribe acknowledgement shape | `{"type": "subscription", "result": "SUCCESS", "subscriptionType": "SUBSCRIBE", "symbols": [...]}`, S1 | as documented, with `"reason": null` on success |
| symbol identifier format | `BTCUSDPERP` since spec 1.0.1, `WBTC/USD` and `BTC/USD` in older examples | `BTCUSDPERP`, the same spelling in the catalog, the book, the funding socket and the published instrument list |
| number representation | strings | prices, quantities and `sequenceNumber` are strings |
| timestamp representation | `timestampMicros` as an object `{"timestamp": int64}` on snapshots, S1 | an integer in µs on snapshots, deltas and funding frames |
| size unit | "Quantity", with `contractSize` `1` | base coin, since every production `contractSize` is `1.0`, section 4 |
| sequence semantics | `sequenceNumber` on deltas, with no gap rule written | starts at `1` on each symbol after each subscribe and rises by 1, 0 gaps and 0 repeats in 900 and 766 deltas over two runs, and the snapshot carries none |
| idle repeat behaviour | not documented | `SNAPSHOT` mode resends the whole book about every 50 ms even when nothing changed. `INCREMENTAL` sends nothing for a quiet book, up to 29.8 s between deltas on `BNBUSDPERP`, and 3 of 22 symbols sent no delta in 25 s of the second pass |

## 4. The book channel in detail

### Snapshot on subscribe

In `INCREMENTAL` mode the first frame for every symbol is a `snapshot`, and deltas follow, section 4 of the probe.
In `SNAPSHOT` mode every frame is a whole book, 197 and 198 in 10 s on `BTCUSDPERP` in two runs with 34 to 70 ms between arrivals, section 3.

### Delta semantics

A `delta` carries `deltaUpdates`, each with `updateAction` `NEW`, `CHANGE` or `DELETE`, `price`, `quantity`, `side` `BID` or `ASK`, and `positionNumber`, where 1 is the top of the book, S1.
A book keyed by price, where `NEW` and `CHANGE` set the level and `DELETE` removes it, stayed uncrossed through every delta.
Its top five levels equalled the next `SNAPSHOT` frame stamped within 40 ms on 245 of 248 deltas in the second pass, and the misses fit the two sockets sampling different instants.
`positionNumber` matched the level's rank in that book on only 1,148 of 1,404 `NEW` and `CHANGE` updates in the second pass, so a feed should key on price and ignore the position.
A delta held 1 to 31 updates.

### Sequence and gap rule

`sequenceNumber` restarts at `1` per symbol on each subscribe and rises by exactly 1 per delta.
The probe saw no gap, so the rule a feed would apply is that a number other than the last plus one means resubscribe that symbol and start from its new snapshot.

### Checksum

None.

### Level order on the wire

Bids descending and asks ascending in every snapshot of every symbol.

### Level window

The depth enum is `0`, `1`, `50` and `500`.
`500` and `20` are refused with `"Invalid depth: 500"` and `"Invalid depth: 20"`.
The books are thin.
`BTCUSDPERP` and `ETHUSDPERP` held 9 to 16 levels a side at depth `50` and at depth `0` over two runs, and the other 20 symbols held 2 to 6.
So no symbol reaches the engine's 20 levels a side.

### Size unit against `contractSize`

Every production instrument has `contractSize` `1.0`, and a `BTCUSDPERP` top bid of `0.172` at 82,520.4 is a size in BTC, about $14,000.
The demo catalog has `contractSize` `2.0` on `AAVEUSDPERP` and `222223.0` on a test symbol, so a feed must read the field and not assume 1.

### One-sided and empty books

None of the 22 snapshots was one-sided or empty.
A snapshot carries `marketStatus`, `OPEN` or `SUSPENDED`.

### Idle repeats

See the last axis above.

### Unknown, closed and wrong-level symbols

| request | answer |
|---|---|
| `BTC/USD` | `{"type": "subscription", "result": "FAILURE", "subscriptionType": "SUBSCRIBE", "symbols": ["BTC/USD"], "reason": "Invalid symbol(s): BTC/USD"}` |
| `btcusdperp` | success, acked as `BTCUSDPERP`, and books follow |
| depth `20` | `"result": "FAILURE"`, `"reason": "Invalid depth: 20"` |
| `{"type": "PING"}` | `"subscriptionType": "UNKNOWN"`, `"reason": "Subscription request type invalid: PING. Allowed values: [SUBSCRIBE, UNSUBSCRIBE, GET_INSTRUMENT_DEFINITIONS]"` |
| malformed JSON | `"subscriptionType": "UNKNOWN"`, `"reason": "Failed to parse instruments message"` |
| `UNSUBSCRIBE` of a symbol never subscribed | success |

No error closed the socket.

### The catalog on the socket

`GET_INSTRUMENT_DEFINITIONS` with an empty list returned one `metadata` frame of 5,592 bytes with 22 instruments, all `OPEN`, all quoted in USD, all with `contractSize` `1.0`, `tradingBandwidth` `8` and `fundingRatePremiumPercentage` `0.003`.
`pythId` is empty on every row, as spec 1.0.13 announced, and `pythProId` names the index feed, see [`rest.md`](./rest.md) section 4.
The demo socket returned 28 instruments, 7 of them `SUSPENDED`, including test symbols such as `INST_5001`, `PERP.BTC/USD` and `BTCUSDPERPSSF`.

### Funding socket

The funding socket needs no subscribe frame.
It sent 22 rows, one per symbol, every 5.0 s, each batch sharing one `timestampMicros`, 4 batches in 22 s in each of two runs.
Each row has `symbol`, `creditFundingRatePercentage`, `debitFundingRatePercentage`, an undocumented `ratePercentage`, `message` and `timestampMicros`.
Every rate was `"0"` in every row of both runs.
No row carries an interval, a next settlement time, an index or a mark.

## 5. Session

| item | probed |
|---|---|
| keepalive | no server heartbeat or server ping. The client must send a protocol ping, or traffic, more often than every 60 s |
| silence tolerated | a socket with no subscribe and no ping closed at 60.0 s with no close frame. A subscribed `INCREMENTAL` socket with no ping stayed open through a 29.8 s gap and 70 s in all |
| forced disconnects | none seen, the longest socket open 70 s |
| maintenance | documented every two weeks, see [`fees.md`](./fees.md) section 7 |
| compression | not forced. With no offer the reply has no extension, and an offered `permessage-deflate` is accepted, so a feed that refuses deflate gets plain frames |
| handshake | 426 to 467 ms |
| subscription limits | Not publicly specified, 22 symbols in one frame worked |

## 6. Captured frames

A subscribe acknowledgement, `INCREMENTAL` on all 22 symbols, trimmed to three symbols:

```json
{"type": "subscription", "result": "SUCCESS", "subscriptionType": "SUBSCRIBE", "symbols": ["UNIUSDPERP", "LINKUSDPERP", "BTCUSDPERP"], "reason": null}
```

A snapshot, trimmed to two levels a side:

```json
{"type": "snapshot", "symbol": "BTCUSDPERP", "marketStatus": "OPEN", "bids": [{"price": "82520.4", "quantity": "0.172"}, {"price": "82509.5", "quantity": "0.15"}], "asks": [{"price": "82520.5", "quantity": "1.4"}, {"price": "82525", "quantity": "1.2"}], "timestampMicros": 1791602681333806}
```

A delta, trimmed to three updates:

```json
{"type": "delta", "symbol": "BTCUSDPERP", "sequenceNumber": "1", "timestampMicros": 1791602691924680, "deltaUpdates": [{"updateAction": "DELETE", "price": "82521", "quantity": "0.2", "side": "BID", "positionNumber": "2"}, {"updateAction": "DELETE", "price": "82518", "quantity": "1.2", "side": "BID", "positionNumber": "2"}, {"updateAction": "CHANGE", "price": "82515", "quantity": "0.2", "side": "BID", "positionNumber": "2"}]}
```

An instrument definition, the first row of the `metadata` frame:

```json
{"pythId": "", "pythProId": "15", "symbol": "BNBUSDPERP", "baseCurrency": "BNB", "quoteCurrency": "USD", "contractSize": "1.0", "tickSize": "0.1", "orderQuantityIncrement": "0.01", "tradingBandwidth": "8", "fundingRatePremiumPercentage": "0.003", "marketStatus": "OPEN"}
```

A funding row:

```json
{"symbol": "BTCUSDPERP", "creditFundingRatePercentage": "0", "debitFundingRatePercentage": "0", "ratePercentage": "0", "message": "", "timestampMicros": 1791602806508447}
```

An error:

```json
{"type": "subscription", "result": "FAILURE", "subscriptionType": "SUBSCRIBE", "symbols": ["ETHUSDPERP"], "reason": "Invalid depth: 20"}
```

There is no keepalive answer to capture, because the socket has no application ping.

## 7. Private channels

The trading socket at `wss://trading.london-perpetual.lmax.com/` takes an OAuth bearer token from `https://auth.lmax.com/oauth/token`, in a header or an authentication message, S1.
It carries orders, trades, order status, instrument status and a heartbeat, and it cancels every order when the socket drops, S1.
A FIX API is also offered, S1.

## 8. Recommended feed shape

The book feed itself would be simple, but the venue is blocked by its anchor, see [`rest.md`](./rest.md) section 8.
If it is ever built, the shape is:

- One socket to `wss://market-data.london-perpetual.lmax.com/v1/marketdata/web-socket` for every tracked symbol.
- One frame, `{"type": "SUBSCRIBE", "symbols": [...], "depth": "50", "updateType": "INCREMENTAL", "updateInterval": "100"}`.
- Reset the symbol's book on each `snapshot`, apply deltas keyed by price, and resync the socket when a `sequenceNumber` is not the last plus one.
- A protocol ping every 20 s, since the server sends nothing on a quiet book and drops a silent socket at 60 s.
- `maxSilenceMs` of about 45 s, above the 29.8 s quiet gap seen, with the ping holding the socket open.
- Expect at most 16 levels a side on any symbol.
- Read the catalog from the same socket with `GET_INSTRUMENT_DEFINITIONS`, because the REST instruments call needs a token.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| S1 | Perps API, OpenAPI 1.0.14, with its change log | https://docs.lmax.com/perps-client-api/rest/1.0.14/openapi.yaml and https://docs.lmax.com/perps-client-api/change-log.json | 2026-10-09 | endpoints, frames, enums, private channels, every documented column |
| S2 | LMAX Global MU perpetual futures page | https://www.lmax.com/global/mu/perpetual-futures | 2026-10-09 | maintenance window, section 3 |
