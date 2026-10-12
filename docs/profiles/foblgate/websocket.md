# FOBLGATE WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:05 to 05:26 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers FOBLGATE's spot stream, because FOBLGATE lists no perpetual, see [`fees.md`](./fees.md) section 3.
FOBLGATE documents no stream, and its API documentation button shows "문서를 준비 중입니다.", "the document is being prepared", S2.
The stream and its frames come from the web app's bundle, S1, and every probed value from [`ws-probe.py`](../../../scripts/probes/venues/foblgate/ws-probe.py).

## 1. Endpoints

| item | value | source |
|---|---|---|
| public URL | `wss://api2.foblgate.com/rds` | S1 |
| families | spot only, one socket for every pair and both quotes | S1, probed |
| Origin | not required, a socket without an Origin header was accepted the same way | probed |

## 2. Channel matrix for public market data

The bundle names three public channels in `Sl=["orderBook","publicSign","chartCandle"]`, S1.

| channel | content | probed |
|---|---|---|
| `orderBook` | the full book, per the trade page handler that replaces both sides with `d.buy` and `d.sell` on each push, S1 | subscribed for 59 pairs over 180 s, no frame arrived |
| `publicSign` | recent trades, the trade page updates last price, high and low from it, S1 | subscribed for 59 pairs over 180 s, no frame arrived |
| `chartCandle` | one candle per request, sent by the app every 5 s beside its ping | one request for BTC/USDT daily got one reply in 0.2 s |
| best bid and ask, ticker, mark, index, funding | not offered | none in the bundle |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Documented" is empty throughout, because FOBLGATE documents no stream.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none | one URL for every pair |
| subscribe frame shape | none | `{"funcName":"orderBook","pairName":"BTC/USDT","delYn":"N"}`, from the bundle, accepted without an error |
| unknown symbol expectation | none | `FOO/USDT` got no reply and no error, and the socket stayed open |
| chunk unit and budget | none | 118 subscriptions on one socket were accepted, and no limit was hit |
| keepalive mechanism | none | the client sends `{"funcName":"PING"}` and gets the text `PONG`, in 161 to 162 ms, and the app sends it every 5 s |
| connection lifetime and maintenance notice | none | a socket that sent no PING was dropped after 60 s without a close frame, twice, and a pinged socket stayed open for 180 s |
| handshake and operation rate limits | none | not provoked |
| public market data authentication | none | none |
| message parse and routing | none | data frames are JSON arrays of records that each carry `funcName` and `pairName`, the welcome is the text `RDS WebSocket Connected`, and the pong is the text `PONG` |
| subscribe acknowledgement shape | none | no acknowledgement |
| symbol identifier format | none | upper case `BASE/QUOTE`, such as `BTC/USDT`, the same as the REST calls |
| number representation | none | JSON numbers in the candle record, such as `"close":82020.03`, and strings in its `msg` field |
| timestamp representation | none | `timestamp` in epoch ms and `reg_dt` as `yyyyMMddHHmmss` in Korean time, `1791558000000` beside `20261010000000` |
| size unit | none | not seen on the stream, and the REST book gives base units |
| sequence semantics | none | none seen |
| idle repeat behaviour | none | no repeats, nothing was pushed for an unchanged book |

## 4. The book channel in detail

The `orderBook` channel could not be characterised on the wire.
A subscribe gets no snapshot, and no push arrived in 180 s for any of the 59 pairs.
The REST book of BTC/USDT and ZEUS/USDT did not change once in 11 polls over 60 s, see [`rest.md`](./rest.md) section 5.
So the silence fits a stream that pushes only on a book change, on a venue whose books did not change.
The 180 s watch ran once, and the second pass reran the other modes but not this one, to keep the sockets near ten minutes in total.

From the bundle, S1:

- A push is a JSON array whose first record has `funcName` `orderBook`, with `pairName`, `buy` and `sell`.
- The trade page replaces its whole book with `buy` and `sell` on every push, so a push is read as a full book rather than a delta.
- No sequence, checksum or update id is read by the app.

Level order, size unit, one-sided books and the gap rule are unknown on the stream.
The REST book's bids are descending and its asks ascending, in base units, [`rest.md`](./rest.md) section 5.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | the client sends `{"funcName":"PING"}` every 5 s in the app, answered with `PONG` | S1, probed |
| silence tolerated | a socket with no PING was dropped at 59.9 and 60.0 s, with no close frame | probed |
| forced disconnect | none seen in 180 s on a pinged socket | probed |
| maintenance notice | none seen, and the bundle routes a text frame `CHANGE_COIN_LIST` to a callback the page sets, which reads as a catalog change signal | S1 |
| compression | the server offers `permessage-deflate` with `client_max_window_bits=15` | probed |
| unsubscribe | the same frame with `delYn` `Y`, and `{"funcName":"DeleteAllRDS"}` drops every subscription, both silent | S1, probed |
| bad frames | an unknown `funcName`, malformed JSON and plain text got no reply, and the socket stayed open and answered the next PING | probed |

## 6. Captured frames

Welcome on connect:

```text
RDS WebSocket Connected
```

Keepalive answer to `{"funcName":"PING"}`:

```text
PONG
```

Reply to `{"funcName":"chartCandle","pairName":"BTC/USDT","type":"d"}`, the only data frame the stream produced:

```json
[{"close":82020.03,"funcName":"chartCandle","high":82020.03,"low":82020.03,"message":"정상적으로 처리되었습니다.","msg":"20261010000000|82020.0300000000|82020.0300000000|82020.0300000000|82020.0300000000|0.0000000000","open":82020.03,"pairName":"BTC/USDT","reg_dt":"20261010000000","status":"0","timestamp":1791558000000,"type":"d","volume":0.0}]
```

No subscribe acknowledgement, book snapshot, book delta or error frame was seen.

## 7. Private channels

The bundle sends `{"funcName":"PrivateFunc","delYn":"N","mbId":...,"Authorization":...,"ua":"WEB"}` on the same socket for a logged in member, S1.
Its payloads were not read.

## 8. Recommended feed shape

No feed is recommended.
FOBLGATE lists no perpetual, and its spot books were static during the probe.
If a spot leg were ever built, one socket to `wss://api2.foblgate.com/rds` with a `PING` every 5 s, one `orderBook` subscribe per pair, and `maxSilenceMs` of about 30,000 for the PONG would fit what was seen.
The book would need a REST snapshot first, because a subscribe returns nothing, and every push would replace the book.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | web bundle `https://www.foblgate.com/assets/index-CLQxZdIW.js` and trade page chunk `https://www.foblgate.com/assets/TradePage-Bkv6Mtpc.js` | 2026-10-09 |
| S2 | API management chunk `https://www.foblgate.com/assets/ApiManagePage-UZMsgfcV.js` | 2026-10-09 |
| probed | [`ws-probe.py`](../../../scripts/probes/venues/foblgate/ws-probe.py), modes `connect`, `watch`, `chart`, `errors` and `idle` | 2026-10-09 |
