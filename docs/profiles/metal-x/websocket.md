# Metal X WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:49 to 05:11 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Metal X lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot socket.
The socket is not documented anywhere in the docs or the API reference.
Its URL and frames come from the Metal X web app bundle, S12, and every behaviour below was probed.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/metal-x/ws-probe.py) unless a source id says otherwise.
Source ids S1 to S12 are those of [`fees.md`](./fees.md) section 10.
Run 1 is the first run and run 2 is the second pass, which halves the book and idle windows.

The socket carries order events and trades, not price levels.
A book has to be rebuilt from a REST snapshot plus every order event that touches the book, which is what the web app does, and the probe did the same and matched the REST book.

## 1. Endpoints

| network | URL | source |
|---|---|---|
| mainnet | `wss://dex.api.mainnet.metalx.com/dexws` | S12, `ws-probe.py bundle` |
| testnet | `wss://dex.api.testnet.metalx.com/dexws` | S12, `ws-probe.py bundle` |

The app's config names them as `METAL_DEX_WS_ENDPOINT`, beside `METAL_DEX_HTTP_ENDPOINT` for the REST API, in `frontend-Brn12Vhf.js`.
The socket client lives in the chunk `dex-0zEL4Yp6.js`, which wraps a reconnecting WebSocket with a 2 s to 10 s backoff, `ws-probe.py bundle`.
One socket carries every market, and the probe held XPR_XMD and XBTC_XMD on one socket.
The handshake answer carries `uwebsockets: 20`, so the server is uWebSockets behind nginx.

## 2. Channel matrix for public market data

| channel | topic | present |
|---|---|---|
| order events, the only book source | `ORDERS/<symbol>` | yes |
| trades | `TRADES/<symbol>` | yes |
| price level book at any depth | | no, `DEPTH/XPR_XMD` got no reply |
| best bid and ask | | no |
| ticker | | no, `trades/daily` over REST stands in |
| mark, index, funding | | no, there is no perpetual |

The app names only the two topics, `TRADES` and `ORDERS`, and handles only the events `data` and `fork`, `ws-probe.py bundle`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing about the socket is documented, so the documented column holds what the app bundle shows.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for mainnet, S12 | one URL for every market |
| subscribe frame shape | `{event:"subscribe",data:{topic:"<TOPIC>/<symbol>",startBlock:<block>,requestId:1}}`, S12 | as shown, and the server echoes `requestId` |
| unknown symbol expectation | Not publicly specified | silence, with no acknowledgement and no error, for `ORDERS/FOO_BAR`, `ORDERS/xpr_xmd` and `ORDERS` |
| chunk unit and budget | one topic per frame, S12 | four subscriptions on one socket were all served, and no cap was found |
| keepalive mechanism | none in the app, which relies on reconnecting, S12 | protocol ping, answered with a pong in 74.3 to 173.0 ms, and a JSON `{"event":"ping"}` got no reply |
| connection lifetime and maintenance notice | Not publicly specified | a socket with no traffic from the server was dropped at 60.0 s without a close frame, in both runs, and a socket that pinged every 20 s stayed open |
| handshake and operation rate limits | Not publicly specified | every handshake and subscribe was accepted |
| public market data authentication | none, S12 | none needed |
| message parse and routing | `event` of `subscribe`, `unsubscribe`, `data` or `fork`, S12 | data frames carry `data.topic`, `data.block_num` and `data.result` |
| subscribe acknowledgement shape | Not publicly specified | `{"event":"subscribe","data":{"success":true,"topic":"ORDERS/XPR_XMD","requestId":1}}` |
| symbol identifier format | `BASE_QUOTE` uppercase, as in `markets/all`, S12 | the topic takes the symbol, but live frames carry `topic` `ORDERS` or `TRADES` with no symbol and name the market by integer `market_id` |
| number representation | Not publicly specified | prices and quantities are JSON numbers, `block_num`, `seq`, `order_id` and `trade_id` are strings |
| timestamp representation | Not publicly specified | `block_time` in ISO 8601 UTC at the chain's half second slots, such as `2026-10-10T04:59:57.500Z` |
| size unit | Not publicly specified | the quote token for buy orders and the base token for sell orders, see section 4 |
| sequence semantics | Not publicly specified | `seq` rises on every order frame but skips, by up to 1548, because it counts chain actions across the whole contract |
| idle repeat behaviour | Not publicly specified | none, frames arrive only when an order changes |

## 4. The book channel in detail

### Snapshot on subscribe

There is no snapshot on the socket.
The app takes `GET /dex/v1/orders/depth`, keeps its `sync` block, and subscribes to `ORDERS/<symbol>` with `startBlock` set to that block, S12.
After the acknowledgement the server sometimes replays recent frames, and that replay varied between runs.

| case | run 1 | run 2 |
|---|---|---|
| `startBlock` equal to the REST `sync` | one frame from 105 blocks before `startBlock` | one frame from 57 blocks before `startBlock`, on XBTC_XMD |
| `startBlock` 600 blocks back | 18 data frames, from 209 blocks to 34 blocks before the REST `sync` | none |
| `startBlock` 0 | the same 18 frames | none |
| no `startBlock` | one frame, the latest | none |

The replay reached back 209 blocks at most, about 105 s, not 600, and it can deliver a frame older than `startBlock`.
So a feed must drop every frame with `block_num` at or below the snapshot's `sync`, as the probe did.
`startBlock` cannot recover a gap of more than a few seconds.

### Delta semantics

Each `ORDERS` frame is one change to one order:

| field | meaning |
|---|---|
| `status` | `create`, the order entered the queue, `transfer`, it was promoted to the book, `update`, a partial fill, `cancel`, the rest was cancelled, `delete`, it filled, S4 |
| `order_type` | 0 an order resting on the book, 1 limit, 2 stop loss, 3 take profit, S4 |
| `order_side` | 1 buy, 2 sell, S4 |
| `price` | the order price, and 9223372036854.775 for a market buy, S4 |
| `quantity_curr` | the remaining quantity |
| `quantity_change` | the quantity this change added or removed |

The app applies only frames with `order_type` 0, S12, and the probe followed the same rule.
`transfer` adds `quantity_curr` at the price, and `update`, `cancel` and `delete` subtract `quantity_change`.
In run 1's 120 s the order frames split into `create` 7, all type 1, `transfer` 2, `update` 13, of which 5 type 0, `cancel` 3, all type 0, and `delete` 14, of which 8 type 0.
So 18 of the 39 order frames changed the book.
`TRADES` frames carry one fill each, with both accounts, both order ids, and totals, amounts and fees per side.

### Rebuilding the book and checking it

The probe took a REST snapshot at step 1000000 and limit 250 for both markets, applied every type 0 frame above the snapshot `sync`, and compared the top ten levels a side with a fresh REST snapshot at the end.

| run | market | bids, price and size matched | asks, price and size matched |
|---|---|---|---|
| 1 | XBTC_XMD | 10 and 10 of 10 | 10 and 10 of 10 |
| 1 | XPR_XMD | 10 and 9 of 10 | 10 and 10 of 10 |
| 2 | XBTC_XMD | 10 and 10 of 10 | 10 and 10 of 10 |
| 2 | XPR_XMD | 10 and 10 of 10 | 10 and 10 of 10 |

The one mismatch was the XPR_XMD best bid, a buy order of 0.000001 XMD at 0.002295, which the rebuild held as 0.0004357 XPR and REST showed as 0.0004.
REST rounds base sizes down to the token's 4 decimals, so a rebuilt book should round the same way to compare.
Run 2 applied one type 0 frame in 60 s, so run 1 is the real test, with 18 book frames over two markets.

### Sequence and gap rule

`seq` rose on every one of 39 order frames in run 1, but only 14 steps were 1 and the largest was 1548.
It is a counter of actions across the whole contract, not per market, so a missing frame cannot be detected from it.
`block_num` never went backwards.
The only gap rule available is to resnapshot over REST and resubscribe after any reconnect, any `fork` event, and any doubt.
The app does exactly that on `fork`, by switching to the same market again, S12.
No `fork` event was seen in the probe.

### Checksum

None.

### Level order on the wire

Not applicable, because frames are orders and not levels.
The REST snapshot orders bids best first, descending, then asks best first, ascending, see [`rest.md`](./rest.md) section 5.

### Size unit

A buy order's `quantity_curr` and `quantity_change` are in the quote token, such as XMD, and a sell order's are in the base token, S12.
Run 1 showed a market buy created with `quantity_curr` 260 at the market buy price on XPR_XMD, and run 2 a resting buy of 400 at 82790 on XBTC_XMD, both in XMD.
The app divides a buy quantity by the price to get base units, and the probe did the same.
The REST book and a feed both need base units.

### One-sided and empty books

XMD_XUSDT had 3 bids and no asks over REST in both runs, see [`rest.md`](./rest.md) section 5.
A book with no activity sends nothing at all on the socket.

### Event cadence

Run 1 saw 57 frames in 120 s on two markets, which is 0.47 a second, with 53 data frames in 7 distinct blocks.
Run 2 saw 7 frames in 60 s, 4 of them acknowledgements.
Live frames went only to the subscribed markets, `market_id` 1 and 2.

### Unknown, repeated and malformed frames

| frame | reply |
|---|---|
| subscribe `ORDERS/FOO_BAR` | nothing within 3 s |
| subscribe `ORDERS/xpr_xmd` | nothing |
| subscribe `ORDERS` with no symbol | nothing |
| subscribe `DEPTH/XPR_XMD` | nothing |
| repeat subscribe to the same topic | a second `success` acknowledgement, and the replayed trade again in run 2 |
| `{"event":"hello",...}` | nothing |
| `{"event":"ping"}` | nothing |
| unsubscribe | `{"event":"unsubscribe","data":{"success":true,"topic":"TRADES/XBTC_XMD","requestId":18}}` |
| the text `this is not json`, run 1 only | the socket dropped with no close frame, code 1006, and the REST API answered HTTP 502 for several seconds |

An unknown symbol is silent, so a feed must check every topic against the catalog itself.
The non JSON frame was sent once, and right after it the probe's next REST call drew HTTP 502 Bad Gateway, see [`rest.md`](./rest.md) section 6.
That looks like a server that crashes on a frame it cannot parse, but it was not retested, and the probe no longer sends any frame that is not JSON.
A feed must never send one.

## 5. Session

| item | probed |
|---|---|
| handshake | 248.6 to 523.8 ms over the five timed opens |
| server header | `nginx/1.24.0 (Ubuntu)` on run 1's book socket and `nginx/1.28.3 (Ubuntu)` on run 2's book and errors sockets |
| compression | permessage-deflate was offered in run 2 and the answer had no `sec-websocket-extensions`, so it was not accepted |
| server pings | one protocol ping, about 100 s into run 1's book socket of about 125 s, none on run 2's 60 s book socket, and none on the idle sockets |
| idle drop | a socket with no subscription and no client traffic was dropped at 60.0 s with no close frame, in run 1 and run 2 |
| client pings | a socket with no subscription that sent a protocol ping every 20 s stayed open for 80.4 s in run 1 and 80.7 s in run 2, with pongs of 74.3 to 77.6 ms and of 164.5 to 167.8 ms |
| maintenance notices | none seen |

The 60 s drop with no close frame fits nginx's default 60 s proxy read timeout, which counts only traffic from the server.
A pong is traffic from the server, so a client ping every 20 to 30 s keeps the socket open on a quiet market.

## 6. Captured frames

Subscribe, as sent:

```json
{"event":"subscribe","data":{"topic":"ORDERS/XPR_XMD","startBlock":407836091,"requestId":1}}
```

Acknowledgement:

```json
{"event":"subscribe","data":{"success":true,"topic":"ORDERS/XPR_XMD","requestId":1}}
```

A replayed frame, which still carries the full topic, trimmed of `trx_id`:

```json
{"event":"data","data":{"topic":"ORDERS/XPR_XMD","block_num":"407835986","result":{"block_time":"2026-10-10T04:58:26.500Z","block_num":"407835986","seq":"4497906579","order_id":"31574906","market_id":1,"account_name":"heronpebble","status":"delete","order_side":1,"order_type":1,"fill_type":1,"price":0.002295,"trigger_price":0,"quantity_curr":0,"quantity_change":100,"quantity_init":0,"ordinal_order_id":""}}}
```

A live frame, whose topic has lost the symbol, a cancel of a resting buy of 400 XMD on XBTC_XMD:

```json
{"event":"data","data":{"topic":"ORDERS","block_num":"407836782","result":{"block_time":"2026-10-10T05:05:04.500Z","block_num":"407836782","seq":"4497913671","order_id":"31573235","market_id":2,"account_name":"reece","status":"cancel","order_side":1,"order_type":0,"fill_type":0,"price":82790,"trigger_price":0,"quantity_curr":0,"quantity_change":400,"quantity_init":0,"ordinal_order_id":""}}}
```

A trade, trimmed of `trx_id`, the ordinal ids and the referrer fields:

```json
{"event":"data","data":{"topic":"TRADES","block_num":"407836168","result":{"block_num":"407836168","block_time":"2026-10-10T04:59:57.500Z","trade_id":"17431422","market_id":1,"price":0.002295,"bid_user":"metallicus","bid_user_order_id":"31574827","bid_total":618.8642,"bid_amount":618.8642,"bid_fee":0,"ask_user":"metallicus","ask_user_order_id":"31574919","ask_total":1.420293,"ask_amount":1.420293,"ask_fee":0,"order_side":1}}}
```

Unsubscribe acknowledgement:

```json
{"event":"unsubscribe","data":{"success":true,"topic":"TRADES/XBTC_XMD","requestId":18}}
```

No error frame exists, because unknown topics and events get no reply.

## 7. Private channels

There are none.
Every `ORDERS` frame carries `account_name`, and the app picks out the user's own orders from the public stream by comparing it with the signed in account, S12.
Balances and order history come from REST calls such as `account/balances`, `orders/open` and `orders/history`, S6.
Orders are placed by signing an XPR Network transaction, see [`rest.md`](./rest.md) section 1.

## 8. Recommended feed shape

Metal X cannot join the engine as a perpetual leg, because it lists no perpetual and has no anchor.
If a later design adds spot legs, the feed would look like this.

- URL plan: one socket to `wss://dex.api.mainnet.metalx.com/dexws` for all markets, since only 18 exist.
- Snapshot: for each market, `orders/depth?symbol=<symbol>&step=1000000&limit=250`, keeping `sync`.
- Subscribe frames: `{"event":"subscribe","data":{"topic":"ORDERS/<symbol>","startBlock":<sync>,"requestId":<n>}}`, and wait for the `success` acknowledgement, treating its absence within a few seconds as an unknown symbol.
- Book updates: route by `market_id`, drop frames with `block_num` at or below the snapshot `sync`, apply only `order_type` 0, add on `transfer`, subtract on `update`, `cancel` and `delete`, convert buy quantities to base by dividing by the price, and key levels by exact price.
- Keepalive: a protocol ping every 20 s, since the server drops a quiet socket at 60 s.
- `maxSilenceMs`: about 60000, with liveness from pongs rather than data, because a quiet market can send nothing for minutes.
- Resync: on reconnect, on any `fork` event, and on any subtract that finds no level, take a new REST snapshot and resubscribe.
- Never send a frame that is not JSON.

The feed has to keep per order arithmetic on top of a level book, and no adapter under [`../../../server/src/venues/`](../../../server/src/venues/) mentions an order id, so it would be a new kind of component and not a copy of an existing adapter.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 to S12 | the source ledger of [`fees.md`](./fees.md) section 10 | the docs, the API reference, the contract mappings and the app bundle |
| S12 in detail | `https://app.metalx.com/`, its entry script `/assets/index-CDBn1yBW.js`, the config chunk `/assets/frontend-Brn12Vhf.js` and the socket client chunk `/assets/dex-0zEL4Yp6.js` | the socket URL, the topics, the subscribe and unsubscribe frames, the `data` and `fork` handlers, the order type 0 rule, the quote unit for buys, the reconnect backoff |
