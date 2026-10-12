# KlicklX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:14 to 04:44 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public market data socket behind KlicklX's USDT-margined perpetuals.
KlicklX publishes no futures WebSocket API.
Its API document, inherited from IDCM and last logged on 2018-05-10, describes only a spot socket at `wss://api.{siteName}.com/websocket` that needs a login, S1.
An HTTP/1.1 upgrade request to that path got `101 Switching Protocols`, and the probe sent nothing over it, since spot is not the researched product.
Everything below was taken from the futures web page's own script, S2, and checked on the wire by [`ws-probe.py`](../../../scripts/probes/venues/klicklx/ws-probe.py).

## 1. Endpoints

| family | URL | note |
|---|---|---|
| USDT-margined perpetual | `wss://ctws.klicklx.com/senders` | ASP.NET Core SignalR hub, the website's `futuresMarketHost`, S2 |
| spot, not detailed | `wss://api.klicklx.com/flexpusher/hub/exchanges` | the website's `tradeMarketHost`, S2, not probed |

The futures client builds the connection with `withUrl(url, {skipNegotiation: true, transport: WebSockets})` and `withHubProtocol(new MessagePackHubProtocol())`, S2.
A logged in user appends `?UserId=<id>`, and the public probe left it out.
There is one family, so one URL carries every perpetual.

## 2. Channel matrix for public market data

SignalR has no channels.
The client invokes hub methods, and the server invokes client methods by name.

| data | server method | scope | probed |
|---|---|---|---|
| order book, 100 levels per side | `ShowOrderBooksAsync(book)` | per contract, after `AddToGroup(contractId)` and `SetTickSize(contractId, tick)` | yes |
| order book change | `HandleOrderBooksChangedAsync(actionType, orderSide, orders)` | registered by the client | never seen in about 70 s of book pushes |
| ticker with mark, index and funding | `ShowRealTimeHandicapAsync(row)` | every contract, without joining any group | yes |
| trades | `ShowRecentTradesAsync(contractId, trades)` | per contract group | yes |
| candles | `ShowCandlesAsync(contractId, candles)` | per contract group, interval set by `SetKLineType` | yes |
| platform status | `PlatformStatusChangedAsync(status)` | every connection | not seen |
| best bid and ask only | none | | the ticker carries `FirstBid` and `FirstAsk` |

The hub methods the client invokes are `AddToGroup`, `RemoveFromGroup`, `SetTickSize` and `SetKLineType`, S2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
KlicklX documents none of them for futures, so the documented column says so once per row.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none published | one URL for the one family |
| subscribe frame shape | none published | SignalR invocations `AddToGroup("<contractId>")` then `SetTickSize("<contractId>", "<tick>")`, section 4 |
| unknown symbol expectation | none published | `AddToGroup("123")` and `AddToGroup("BTCUSDT")` both complete with `true` and deliver nothing |
| chunk unit and budget | none published | three groups on one socket each delivered their book, section 5. No cap found |
| keepalive mechanism | none published | SignalR ping message `[6]`. The server sends one about every 15 s |
| connection lifetime and maintenance notice | none published | a socket that never sent a client ping stayed open for 75 s in the first run and 60 s in the second and third. No maintenance frame seen |
| handshake and operation rate limits | none published | 15 handshakes over the three runs, none refused |
| public market data authentication | none published | none |
| message parse and routing | none published | split the binary frame into length-prefixed MessagePack messages, then route on the invocation target |
| subscribe acknowledgement shape | none published | a SignalR completion `[3, {}, "<invocationId>", 3, true]` within about 150 ms |
| symbol identifier format | none published | the numeric contract id as a string, such as `"1917057417200713728"` for `BTCUSDT`. The ticker also carries `Symbol` |
| number representation | none published | strings, such as `["82706.6", "0.433"]`, under MessagePack. JSON numbers under the JSON hub protocol |
| timestamp representation | none published | none on the book. The ticker has `Timestamp` in Unix ms and `CreateTime` as UTC+8 text |
| size unit | none published | base currency, section 4 |
| sequence semantics | none published | none. Every book push is a full 100-level snapshot |
| idle repeat behaviour | none published | 8 of 160 and 4 of 144 book pushes in 40 s repeated the previous book exactly |

## 4. The book channel in detail

### Snapshot on subscribe

The book arrives only after both `AddToGroup` and `SetTickSize` for the contract.
`SetTickSize` binds its second argument as a .NET decimal, which MessagePack must carry as a string.
A MessagePack float `10.0` failed with "InvalidDataException: Error binding arguments", and the string `"10"` succeeded.
In the first run, where every `SetTickSize` failed this way, a socket in three groups got books for only the last contract joined, and `ETHUSDT` got 1 push.
The tick must be one of the contract's `tickSize` list in the catalog, and its first entry is the unaggregated tick, such as `0.1` for `BTCUSDT`.

### Delta semantics

There are no deltas on the wire.
Every `ShowOrderBooksAsync` push is `{"ContractId": "...", "Bids": [[price, size], ...], "Asks": [[price, size], ...]}` with 100 levels on each side, and it replaces the book.
The client also registers `HandleOrderBooksChangedAsync`, but the probe never received it.
Pushes came at a median gap of 0.21 s, 0.23 s and 0.26 s in the three runs, with a maximum of 0.94 s.

### Sequence and gap rule

There is no sequence, no update id and no timestamp on the book.
Since each push is a full snapshot, a gap loses nothing but freshness.

### Checksum

None.

### Level order on the wire

Bids descend and asks ascend in all 160 pushes of the second run and all 144 of the third, and none was crossed.
With `SetTickSize("10")` the bids came as `82670`, `82660`, `82650` and so on, so the server aggregates to the chosen tick.
The REST book at tick 10 showed a best bid and best ask both at 82670 in one run and both at 82700 in the next, so an aggregated book can look crossed, see [`rest.md`](./rest.md) section 5.

### Size unit

Sizes are in the base currency, not in contracts.
`BTCUSDT` has `faceValue` 0.001 and its sizes look like `0.433`, which would be a fraction of one contract if the unit were contracts.
`DOGEUSDT` has `faceValue` 10 and its sizes look like `143639`, which is not a multiple of 10.
`Turnover24H` divided by `Volume24H` and by the mark price is between 0.97 and 1.01 on every contract, so the ticker volume is in base currency too, see [`rest.md`](./rest.md) section 3.
An adapter sets the contract size to 1.

### One-sided and empty books

No one-sided book was seen on `BTCUSDT`, `ETHUSDT` or `SOLUSDT`.
An unknown contract id gets no book at all.

### Idle repeats

The server repeats a book even when it has not changed, 8 times in 160 pushes and 4 times in 144.

### Unknown, closed and wrong-parameter symbols

`AddToGroup` with `"123"` or with `"BTCUSDT"` returns `true` and nothing follows.
An unknown hub method returns the error completion "HubException: Method does not exist."

## 5. Session

| item | probed |
|---|---|
| handshake | `{"protocol":"messagepack","version":1}` plus the record separator `0x1e`, sent as a text frame. The reply `{}` plus `0x1e` came in a binary frame |
| JSON hub protocol | `{"protocol":"json","version":1}` is accepted too. Its book has lower-case keys and JSON numbers |
| connect time | about 600 to 700 ms to open the socket, 150 ms for the handshake |
| keepalive | the server sends a ping `[6]` about every 15 s, 15.0 to 16.0 s apart in the first run |
| silence tolerated | a socket that never sent a ping was not closed in 75 s, and again in 60 s twice |
| forced disconnects | none in the three runs, about 9.5 minutes of sockets in all |
| compression | the server offered no `permessage-deflate` |
| groups per socket | three contracts on one socket each got 57 to 69 books in 15 s, about 4 a second, after `SetTickSize` succeeded |
| ticker volume | about 42 ticker pushes a second across 20 contracts, 1703 and 1699 in 40 s, on every socket, whether or not it joined a group |

## 6. Captured frames

The MessagePack frames are shown decoded.

A completion for `AddToGroup`, and the same for `SetTickSize` and `RemoveFromGroup`:

```json
[3, {}, "1", 3, true]
```

A book push, trimmed to two levels a side:

```json
{"ContractId": "1917057417200713728", "Bids": [["82678.2", "0.359"], ["82677.4", "0.434"]], "Asks": [["82679.8", "0.491"], ["82680.4", "0.094"]]}
```

A ticker push, which arrives for every contract without a group:

```json
{"ContractId": "1922125033871163392", "Symbol": "ADAUSDT", "CreateTime": "2026-10-10 12:30:19", "Timestamp": 1791606619489, "FirstBid": "0.2498", "FirstAsk": "0.2502", "MarketPrice": "0.25", "MarkPrice": "0.25000000", "IndexPrice": "0.25025000", "DistanceSettlementTime": "03:29:37", "CurrentFundRate": "0", "ForecastFundRate": "0.00010000", "IntervalHour": 8}
```

A trade push:

```json
["1917057417200713728", [{"Price": "82679.7", "Qty": "0.014", "TriggerType": 2, "TimeStamp": 1791606623065}]]
```

The error completion for a MessagePack float tick size:

```json
[3, {}, "5", 1, "Failed to invoke 'SetTickSize' due to an error on the server. InvalidDataException: Error binding arguments. Make sure that the types of the provided values match the types of the hub method being invoked."]
```

## 7. Private channels

The same hub serves private methods to a socket opened with `?UserId=`: `SelfOrderFilledAsync`, `SelfOrderStatusChangedAsync`, `SelfPositionChangedAsync`, `SelfIntegratedAssetsChangedAsync`, `SelfPlanOrderStatusChangedAsync` and `SelfFillOrKillOrderStatusChangedAsync`, S2.
How a private socket authenticates was not examined.

## 8. Recommended feed shape

- URL plan: one URL, `wss://ctws.klicklx.com/senders`, with no negotiation step.
- Protocol: the JSON hub protocol is the simpler choice for a text frame feed.
  Send `{"protocol":"json","version":1}` plus `0x1e`, then split every frame on `0x1e`.
- Markets per connection: three groups on one socket worked, and no cap was found.
  Twenty contracts fit on one or a few sockets.
- Subscribe frames: per contract, invoke `AddToGroup` with the contract id, then `SetTickSize` with the id and the first entry of the catalog's `tickSize`, as a string under MessagePack or a number under JSON.
- Book handling: replace the whole book on every push.
  Keep the top 20 of the 100 levels.
- Keepalive: send `{"type":6}` plus `0x1e` every 15 s, as the SignalR client does.
- `maxSilenceMs`: 10000, since books come several times a second and server pings every 15 s.
- Resync: reconnect and invoke both methods again.
  No sequence check is possible or needed.
- The ticker push carries mark, index and funding for every contract on the same socket, which could feed the anchor instead of REST, see [`rest.md`](./rest.md) section 8.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `GET https://api.klicklx.com/api/idcm/foundation/app/ApiDocument/GetApiDocument?id=14` and `id=15`, the website's API document for the WebSocket API, with the title list from `GetApiDocumentTitleList` | 2026-10-09 |
| S2 | The futures app `https://futures.klicklx.com/assets/index.7f891b75.js` and its chunk `index.554fb3b4.js`, which holds the SignalR client, and `https://www.klicklx.com/client/static/js/Page.c725b912.chunk.js`, which holds the host config | 2026-10-09 |
| S3 | `wss://ctws.klicklx.com/senders`, probed by [`ws-probe.py`](../../../scripts/probes/venues/klicklx/ws-probe.py) | 2026-10-09 |
