# Bitcoiva WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:29 to 03:51 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers Bitcoiva's spot market sockets, because Bitcoiva lists no exchange perpetual, see [`fees.md`](./fees.md) section 3.
Bitcoiva publishes no WebSocket API.
Its "Bitcoiva Open API v3.0 Documentation" documents two public REST calls and no socket, and the word "WebSocket" does not appear in it, S1.
What follows is what the web app opens, read from its bundle and probed with [`ws-probe.py`](../../../scripts/probes/venues/bitcoiva/ws-probe.py).
The source ids S1 to S3 are listed in section 9, and the ids S2 to S8 of [`fees.md`](./fees.md) are cited as `fees.md S<n>`.

The finding that decides this file: Bitcoiva's own sockets carry no order book.
The trade page draws its book from Binance's public stream `wss://stream.binance.com/stream`, channel `<symbol>@depth20`, and from LBank for the two CNT pairs, S2.

## 1. Endpoints

| endpoint | protocol | what it carries | source |
|---|---|---|---|
| `wss://rtrxastzeqsaoqd.bitcoiva.com/socket.io/?EIO=4&transport=websocket` | Socket.IO v4 | `bitcoiva_allPairInfo`, a ticker for every pair about once a second | S2, probed |
| `wss://pigqueoialzban.bitcoiva.com/socket.io/?EIO=4&transport=websocket` | Socket.IO v4 | one `bitcoiva_test` event after the connect, nothing else in 45 s | S2, probed |
| `wss://oseynrzisxcadaqs.bitcoiva.com/socket.io/?EIO=4&transport=websocket` | Socket.IO v4 | nothing in 45 s | S2, probed |
| `wss://apistack.bitcoiva.com/socket.io/?EIO=4&transport=websocket` | Socket.IO v4 | one `bitcoiva_api_test` event after the connect, nothing else in 45 s | S2, probed |
| `wss://stream.binance.com/stream` | Binance combined stream | the trade page's book, ticker and trades for every pair but CNT | S2, probed |
| `wss://fstream.binance.com/stream` | Binance USD-M futures stream | the same page's book when the active key contains "future" | S2 |
| `wss://www.lbkex.net/ws/V2/` | LBank v2 | book, ticker and trades for `CNT_USDT` and `CNT_INR` | S2 |

- All four Bitcoiva hosts resolve to the same AWS load balancer in `ap-south-1`, [`rest.md`](./rest.md) section 1.
- The trade page joins a room with `42["bitcoiva_room","bitcoiva_<PAIR>"]` on the `pigqueoialzban`, `oseynrzisxcadaqs` and `apistack` sockets, S2.
  Which of the first two a pair uses is set by the pair's `liquidity` flag, S2.
  The events those rooms carry are handled outside the page chunks read here, and the probe saw none for `BTC_USDT` or `BTC_INR` in 45 s per host.

## 2. Channel matrix for public market data

| channel | on a Bitcoiva socket | where the web app gets it |
|---|---|---|
| order book, any depth | no | Binance `<symbol>@depth20`, LBank `depth` 20 for CNT |
| best bid and ask | no | Binance `@depth20` top |
| trades | no | Binance `<symbol>@aggTrade`, LBank `trade` for CNT |
| ticker | `bitcoiva_allPairInfo`, all pairs in one event | Bitcoiva socket, and Binance `<symbol>@ticker` on the trade page |
| mark, index, funding | no | not offered, no perpetual |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Documented" is empty throughout, because Bitcoiva documents no socket, S1.
The probed column describes the `rtrxastzeqsaoqd` ticker socket, the only Bitcoiva socket that carried market data.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none | one ticker socket for every pair and quote |
| subscribe frame shape | none | none is needed, the ticker event arrives after the Socket.IO connect `40` with no room join |
| unknown symbol expectation | none | a join of `bitcoiva_NOPE_USDT` got no reply and no error, and the ticker events kept coming |
| chunk unit and budget | none | one event carries every pair, 241 in the first event |
| keepalive mechanism | none | the Engine.IO open frame sets `pingInterval` 200000000 ms and `pingTimeout` 500000000 ms, so the server never pinged within the 45 s hold |
| connection lifetime and maintenance notice | none | no socket closed on its own within 45 s, and no maintenance event was seen |
| handshake and operation rate limits | none | not provoked |
| public market data authentication | none | none |
| message parse and routing | none | Socket.IO text frames `42["bitcoiva_allPairInfo",{"pairinfo":{<PAIR>:{...}}}]` |
| subscribe acknowledgement shape | none | the namespace ack `40{"sid":"..."}` only, and a room join gets no ack |
| symbol identifier format | none | upper case `BASE_QUOTE`, such as `BTC_USDT`, the Open API spelling |
| number representation | none | JSON numbers, such as `"price":82589.17` |
| timestamp representation | none | none, the event carries no time |
| size unit | none | no sizes, only 24 h volumes |
| sequence semantics | none | none |
| idle repeat behaviour | none | a pair whose price did not move is sent again unchanged in every event |

## 4. The book channel in detail

No Bitcoiva socket carries a book, so a feed cannot be built on Bitcoiva's own sockets.

### What the trade page shows instead

- The trade page sends `{"method":"SUBSCRIBE","params":["<s>@ticker","<s>@aggTrade","<s>@depth20"],"id":1}` to `wss://stream.binance.com/stream`, where `<s>` is the Binance symbol mapped from the Bitcoiva pair, S2.
- It applies a price spread only to the four pairs `BCA_USDT`, `BCA_INR`, `CNT_INR` and `CNT_USDT`, S2.
- INR pairs carry Binance's USDT price times a fixed INR rate, 99.5 during the probe, by the `inrPrc` field below and by [`rest.md`](./rest.md) section 5.
- So the book a Bitcoiva user sees on `BTC_USDT` is Binance's `btcusdt@depth20`, a 20 level snapshot about once a second.
- The probe opened that stream for 20 s in each of two runs: 19 and 20 frames, 20 levels a side, and 4 of 4 and 5 of 5 comparisons with Bitcoiva's REST depth showed the same best bid and best ask, `binance` mode.
- Bitcoiva's REST `lastUpdateId` ran 16 to 116 ahead of the Binance frame it was compared with, which is Binance's own update counter read a moment later, `binance` mode.

The REST depth is the same pass-through, see [`rest.md`](./rest.md) section 5.

### Sequence, checksum, level order, size unit, empty books

Not applicable to a Bitcoiva socket.
On the Binance stream they are Binance's, profiled in [`../binance/websocket.md`](../binance/websocket.md).

## 5. Session

| item | probed |
|---|---|
| handshake | 753 to 854 ms to the Engine.IO open frame on each Bitcoiva host, over two runs |
| Engine.IO version | 4 only. `EIO=3` on the ticker host failed with `ConnectionClosedError: sent 1002 (protocol error) reserved bits must be 0` |
| upgrades | `[]`, the socket starts on WebSocket |
| `maxPayload` | 1000000 bytes |
| keepalive | none needed in practice, the server's ping interval is about 55 hours |
| compression | none seen, every frame was text |
| ticker cadence | 44 events in 45.8 s in both runs, with 2,497,818 and 2,489,401 bytes in total, so about 54 KB a second for one socket |
| no namespace connect | the `apistack` socket sent its open frame and nothing more in 5 s |

## 6. Captured frames

The Engine.IO open frame, the same on all four hosts but for the `sid`.

```text
0{"sid":"Sb2WVdN4ntM5AKL8A9O1","upgrades":[],"pingInterval":200000000,"pingTimeout":500000000,"maxPayload":1000000}
```

The namespace connect acknowledgement, after the probe sent `40`.

```text
40{"sid":"gQRJ1SqPgDnRLYVQA9O2"}
```

One `bitcoiva_allPairInfo` event from run 1, trimmed to one pair, 56,791 bytes in full.

```json
["bitcoiva_allPairInfo",{"pairinfo":{"BTC_USDT":{"from":"BTC","to":"USDT","pair":"BTC_USDT","change":0.43,"price":82589.17,"open":82234.04,"clr":"text-success","volume":960551308.7395074,"amtvol":11614.83363,"high":83528.98,"low":82209.2,"convprc":1,"inrPrc":1,"deci":2}}}]
```

`BTC_INR` in the same event carries `"price":8217622.415` and `"inrPrc":99.5`, the BTC_USDT price times 99.5.
Its `amtvol` 11614.83363 equals `BTC_USDT`'s, and the Open API ticker gives `amtVol` 5.43 for `BTC_USDT`, so the socket's volume is not Bitcoiva's own, [`rest.md`](./rest.md) section 2.

The test events on two of the room sockets.

```text
42["bitcoiva_test",{"data":"ok_data"}]
42["bitcoiva_api_test",{"data":"ok_data"}]
```

No error frame was ever sent.

## 7. Private channels

The bundle names no private socket channel beyond the room joins above.
The Open API's private calls are REST only, with an API key, S1.

## 8. Recommended feed shape

None.
Bitcoiva has no perpetual, and no Bitcoiva socket carries a book.
A spot feed for Bitcoiva would be a Binance spot feed under another name, which the engine already has.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `/bitcoiva-apidocs` page chunk `https://www.bitcoiva.com/static/js/3259.6a9380d5.chunk.js`, same as `fees.md S4` | 2026-10-09 |
| S2 | `/trade/:pair` page chunk `https://www.bitcoiva.com/static/js/8731.fe8effe6.chunk.js`, same as `fees.md S6`, and the web bundle `main.e52b4f29.js`, `fees.md S2` | 2026-10-09 |
| S3 | [`ws-probe.py`](../../../scripts/probes/venues/bitcoiva/ws-probe.py), modes `sio`, `binance` and `errors` | 2026-10-09 |
