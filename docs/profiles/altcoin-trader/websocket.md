# Altcoin Trader WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:28 to 03:45 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Altcoin Trader lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book channel.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/altcoin-trader/ws-probe.py) unless a source id says otherwise.
Source ids S1 to S10 are those of [`fees.md`](./fees.md) section 10.
The short answer is that the `orderbook` channel pushes the whole top of book of one market, at a depth chosen on subscribe, about once a second.
It carries no sequence and no checksum, so each push replaces the last, and a missed push costs nothing but freshness.

## 1. Endpoints

| endpoint | public market data | probed |
|---|---|---|
| `wss://api.altcointrader.co.za/ws` | `ticker`, `orderbook` and `trades` per market, S1 | HTTP 101 in 1,157 to 1,235 ms, no `sec-websocket-extensions` in the reply |
| `wss://api.altcointrader.co.za/ws/private` | none, account channels only, S1 | not opened |

One socket carries every market, and one subscribe frame names one channel and one market.
The probe held five subscriptions on three markets over one socket.
The socket host is the REST host, which is not behind Cloudflare, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| data | channel | documented | probed over 120 s |
|---|---|---|---|
| book, depth 1 to 200 | `orderbook`, field `limit`, default 50 | polled every 500 ms, pushed on change, S1 | 122 to 152 full pushes per market at depth 10 |
| best bid and ask | none on a socket | | the socket `ticker` has no bid or ask, the REST ticker has `bidPrice` and `askPrice`, see [`rest.md`](./rest.md) section 5 |
| trades | `trades` | polled every 1 s, S1 | 1 push, the recent trade list, and none after, because BTCZAR did not trade |
| ticker | `ticker` | polled every 1 s, S1 | 1 push, and none after |
| mark, index, funding | Not offered | | no perpetuals, see [`fees.md`](./fees.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | one URL for every market |
| subscribe frame shape | `{"action":"subscribe","channel":"orderbook","market":"BTCZAR","limit":10}`, S1 | as documented |
| unknown symbol expectation | Not publicly specified | `NOPEZAR` got a `subscribed` ack and then an error frame, see section 4 |
| chunk unit and budget | Not publicly specified | one market per frame, and five subscriptions on one socket were all served |
| keepalive mechanism | the server sends a WebSocket ping every 45 s and closes a client that sends no pong within 60 s, S1 | server pings at 45.0 s and 90.0 s in both runs, and the library's pongs kept the socket open for 120 s |
| connection lifetime and maintenance notice | Not publicly specified | no close and no notice within 120 s |
| handshake and operation rate limits | "Limits may vary by endpoint", with no number, S1 | every open and every subscribe was accepted |
| public market data authentication | none, S1 | none needed |
| message parse and routing | `{"channel":...,"market":...,"data":...}`, S1 | as documented, route by `channel` and `market` |
| subscribe acknowledgement shape | `{"channel":"subscribed","market":"BTCZAR","subscription":"ticker"}`, S1 | as documented, one per accepted subscribe, and none for an unsubscribe |
| symbol identifier format | base and quote joined with no separator, upper case, S1 | `BTCZAR`, and `btczar` is accepted and acknowledged as `BTCZAR` |
| number representation | decimal strings, S1 | price and size as strings with 8 decimal places |
| timestamp representation | Unix seconds, S1 | `timestamp` in whole seconds, 0.14 to 1.21 s behind local time on receipt |
| size unit | Not publicly specified | units of the base asset, the same as the REST book, see section 4 |
| sequence semantics | none documented | none on the wire, every push is a whole snapshot |
| idle repeat behaviour | "Frames are only pushed when data changes", S1 | a push about every 1.0 s even when the levels did not change, see section 4 |

## 4. The book channel in detail

### Snapshot on subscribe

Yes.
The first `orderbook` frame after the `subscribed` ack is the whole book at the requested depth.

### Delta semantics

None.
Every push is a whole snapshot: `data` holds `asks`, `bids`, `symbol` and `timestamp`.
Three runs of 120 s carried 405, 419 and 406 book pushes on three markets, and every one held exactly 10 bids and 10 asks at `limit` 10.

### Sequence and gap rule

There is no sequence, update id or previous id on the wire, and neither document names one, S1 and S2.
Because every push is complete, there is no gap to detect.
A feed takes the newest push and ages it by `timestamp`.

### Checksum

None documented and none on the wire.

### Level order on the wire

Bids are sorted best first, descending by price, and asks best first, ascending.
No push in any run was crossed, and no level had size zero.
Each level is a two element array of strings, `[price, size]`.

### Level window

`limit` sets the depth, from 1 to 200, S1.
`limit` 0 and `limit` 201 were both acknowledged and both served 50 levels a side, the default, instead of an error.
A second subscribe to the same market at another depth got no ack and changed nothing: after `limit` 5 then `limit` 3 on `BTCZAR`, pushes stayed at 5 levels a side.

### Size unit

Sizes are in the base asset.
The `BTCZAR` book showed sizes such as `0.16443305` against prices near 1,368,000 ZAR, which is BTC.
Altcoin Trader has no contracts, so there is no `contractSize` to reconcile.

### One-sided and empty books

None was seen on the three markets probed.
Nothing documents how an empty side is sent.

### Idle repeats

The document says frames are pushed only on change, S1.
On the wire the book came about once a second, with intervals of 0.41 to 1.09 s and a median of 1.0 s on all three markets in all three runs.
The pushes whose levels matched the push before on the same market were 300 of 405, 297 of 419 and 307 of 406.
In the last two runs `timestamp` changed between 357 consecutive pushes each time.
The likely reading is that the server compares whole frames, and the `timestamp` it stamps each second makes every frame differ.
The `ticker` and `trades` channels did behave as documented: each sent one frame in 120 s and nothing more, because BTCZAR did not trade.

### Unknown, closed and wrong-level symbols

| sent | reply |
|---|---|
| `orderbook` on `NOPEZAR` | `{"channel":"subscribed","market":"NOPEZAR","subscription":"orderbook"}` and then `{"channel":"error","message":"orderbook fetch failed: rpc error: code = NotFound desc = market not found"}` |
| channel `depth` | `{"channel":"error","message":"unknown channel \u2014 use ticker, orderbook, trades, orders, fills, or balances"}` |
| `orderbook` without `market` | `{"channel":"error","message":"market is required"}` |
| `unsubscribe` of `orderbook` on `BTCZAR` | no ack, pushes stop, and five of six unsubscribes over two runs drew the error frame `orderbook fetch failed: rpc error: code = Canceled desc = context canceled` |
| the text `ping` | `{"channel":"error","message":"invalid JSON"}` |
| `{"op":"ping"}` | `{"channel":"error","message":"unknown action \u2014 use subscribe or unsubscribe"}` |

The server writes an em dash in the two messages above, shown here as the JSON escape `\u2014`.
The error frames name no market, so a feed cannot tell which subscription failed from the error alone.
The ack for an unknown market arrives before the error, so an ack is not proof that a market exists.

## 5. Session

| item | value |
|---|---|
| keepalive | the server pings every 45 s, and a WebSocket pong answers it, S1 and probed |
| silence the server tolerates | a pong within 60 s of a ping, S1, not tested by withholding a pong |
| client pings | none needed, the probe sent none |
| forced disconnects | none within 120 s |
| maintenance notices | none documented, none seen |
| compression | no `permessage-deflate` offered in the reply |
| handshake and subscription limits | Not publicly specified |

## 6. Captured frames

A subscribe acknowledgement:

```json
{"channel":"subscribed","market":"BTCZAR","subscription":"orderbook"}
```

A book push at `limit` 10 from the second pass, trimmed to two levels a side:

```json
{"channel":"orderbook","market":"BTCZAR","data":{
  "asks":[["1375852.00000000","0.00229311"],["1375921.00000000","0.02446237"]],
  "bids":[["1369200.00000000","0.00699533"],["1368116.48809474","0.01798007"]],
  "symbol":"BTCZAR","timestamp":1791603704}}
```

A ticker push, which has no bid or ask:

```json
{"channel":"ticker","market":"BTCZAR","data":{"change":"5601.99999995","change_pct":"0.40","high":"1472931.77036211","last":"1373874.99999995","low":"1365604.00000000","open":"1368273.00000000","symbol":"BTCZAR","timestamp":1791601871,"volume":"3.22069643"}}
```

A trades push, trimmed to one trade, whose `trade_id` carries a per pair sequence:

```json
{"channel":"trades","market":"BTCZAR","data":[{"price":"1373874.99999995","quantity":"0.00347150","side":"buy","timestamp":1791601871,"trade_id":"pair:3:seq:37967996"}]}
```

An error:

```json
{"channel":"error","message":"orderbook fetch failed: rpc error: code = NotFound desc = market not found"}
```

The keepalive is a WebSocket ping control frame with no payload, which the client library answers.

## 7. Private channels

`wss://api.altcointrader.co.za/ws/private` takes `X-API-KEY`, `X-TIMESTAMP` and `X-SIGNATURE` on the upgrade request, S1.
Its channels are `orders` and `balances`, account wide, without a `market` field, S1.
The unknown channel error also names `fills`.

## 8. Recommended feed shape

None for the engine as it stands.
Altcoin Trader has no perpetual and no CCXT class, so it has no place in the perpetual engine.

If a later design adds ZAR spot legs, the shape would be:

- one socket to `wss://api.altcointrader.co.za/ws` for all 33 markets, one `{"action":"subscribe","channel":"orderbook","market":"<SYMBOL>","limit":10}` per market.
- answer server pings with pongs, which any WebSocket library does, and set `maxSilenceMs` near 5,000, because a healthy subscription pushes about once a second.
- replace the book on every push, since each is a full snapshot, and drop it when `timestamp` is more than a few seconds old.
- treat an error frame as a failure of every subscription not yet confirmed by a book push, since error frames name no market.
- resubscribe after any reconnect, and do not resubscribe a live market at a new depth, because the server ignores it.

## 9. Source ledger

The sources are S1 to S10 of [`fees.md`](./fees.md) section 10.
S1, the OpenAPI document of `docs.altcointrader.co.za`, holds the WebSocket section this profile quotes.
S2, the older document on the API host, holds the same section with the same poll intervals and keepalive text.
