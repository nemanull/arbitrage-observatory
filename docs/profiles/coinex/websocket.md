# CoinEx WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:22 to 03:36 UTC, each probe mode run twice, from the development host near Seattle.

This profile covers the public WebSocket v2 of CoinEx (CCXT id `coinex`).
CoinEx futures ceased on 2026-09-22, see [`fees.md`](./fees.md) section 1, so the futures socket was probed only to record what it serves now.
It still accepts subscriptions, and every one of the 221 futures books it serves is empty.
Every probed value below comes from [`ws-probe.mjs`](../../../scripts/probes/venues/coinex/ws-probe.mjs).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every futures family, USDT, USDC and coin-margined | `wss://socket.coinex.com/v2/futures`, S1 | opened in 327 to 404 ms on eight sockets over two runs, all 221 contracts acknowledged on one socket |
| spot | `wss://socket.coinex.com/v2/spot`, S1 | opened in 346 and 351 ms, `BTCUSDT` delivered 50 levels per side |

One futures socket carries all three families, since `BTCUSDT`, `BTCUSDC` and `BTCUSD` were accepted in one frame.
`socket.coinex.com` is a CloudFront name, `dzx8sn04pw9vd.cloudfront.net`, which resolved to four addresses in 52.85.129.0/24.

## 2. Channel matrix for public market data

| method | payload | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `depth.subscribe` | `market_list` of `[market, limit, interval, if_full]` | limit 5, 10, 20 or 50, a push every 200 ms when the book changed, a full push every minute, S2 | acknowledged, one full push per contract, every book empty, in both runs |
| `bbo.subscribe` | `market_list` of markets | best bid and ask, S1 | acknowledged, no push in 28 s |
| `state.subscribe` | `market_list` of markets | market status with mark, index and funding, S1 | one push, the frozen values of [`rest.md`](./rest.md) section 3 |
| `index.subscribe` | `market_list` of markets | index price, S1 | acknowledged, no push in 28 s |
| `deals.subscribe` | `market_list` | trades, S1 | not probed |
| premium index subscription | | named in the documentation menu, S1 | not probed |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Each probed value describes a product that no longer trades.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for spot and one for futures, S1 | linear USDT, linear USDC and inverse contracts share the futures URL |
| subscribe frame shape | `{"method": "depth.subscribe", "params": {"market_list": [["BTCUSDT", 10, "0", true]]}, "id": 1}`, S2 | one frame of 5,517 bytes carrying all 221 contracts was acknowledged with code 0, in both runs |
| unknown symbol expectation | Not publicly specified | `NOPEUSDT` answered `{"code":0,"message":"OK"}` and then sent nothing, in both runs |
| chunk unit and budget | Not publicly specified | 221 contracts in one frame, no refusal |
| keepalive mechanism | Not publicly specified in the pages read | `server.ping` answered `{"data":{"result":"pong"}}` in 101 to 104 ms over four pings. No server protocol ping in 60 s, twice |
| connection lifetime and maintenance notice | `GET /v2/maintain/info` over REST, S3 | it returned an empty list, and no socket reached a lifetime cap |
| handshake and operation rate limits | Not publicly specified | no refusal at seven requests sent in one burst |
| public market data authentication | none | none |
| message parse and routing | `{"method", "data", "id"}`, S2 | `depth.update` routes on `data.market` |
| subscribe acknowledgement shape | `{"id", "code", "message"}`, S4 | `{"id":2,"code":0,"message":"OK"}` in 102 to 123 ms over two runs |
| symbol identifier format | `BTCUSDT` | identical to CCXT `market.id` and the REST `market` on 221 of 221 contracts |
| number representation | price and size as strings, S2 | strings, in the spot frames |
| timestamp representation | `updated_at` in ms, S2 | integer ms, and on empty futures books it moved while nothing traded |
| size unit | base currency, S2 example | Not verified on futures, since every book is empty |
| sequence semantics | none. A signed CRC32 `checksum` of the full book instead, S2 | every empty futures book carried `checksum` 0 |
| idle repeat behaviour | a full push every minute, S2 | not measured, see section 4 |

## 4. The book channel in detail

The futures book channel cannot be judged, because every futures book was empty.
Its documented shape is recorded from S2, and the probed facts are listed beside it.

### Snapshot on subscribe

The first push after `depth.subscribe` carries `"is_full": true`, S2.
On 2026-09-23 at 03:23 and 03:31 UTC each of `BTCUSDT`, `ETHUSDT`, `SOLUSDT` and `BTCUSDC` got exactly that, with `"asks":[]`, `"bids":[]` and `"checksum":0`, and nothing followed in 28 s.
All 221 futures contracts subscribed in one frame each got one full push, and 0 of 221 held a single level, in both runs of `ws-probe.mjs all`.

### Delta semantics

With `if_full` false the server pushes only the levels that changed since the last push, and a size of `"0"` deletes a level, S2.
With `if_full` true every push is a whole book, S2, and the spot `BTCUSDT` subscription got 12 and then 3 full pushes and 0 deltas in two 15 s runs.

### Sequence and gap rule

None exists.
The frame has no update id, so a feed cannot see a lost delta, and the documented recovery is the checksum plus the full push every minute, S2.

### Checksum

The checksum is a signed 32-bit CRC32 of `bid1_price:bid1_amount:bid2_price:bid2_amount:…:ask1_price:ask1_amount:…`, S2.
It was not verified against a live book, since the futures books were empty and spot is out of scope.

### Level order on the wire

On the spot `BTCUSDT` book, asks ascended and bids descended in 15 of 15 full pushes over two runs.
The futures order could not be observed.

### Size unit against CCXT `contractSize`

CCXT sets `contractSize` 1 on every swap at `server/node_modules/ccxt/js/src/coinex.js` line 973.
The documentation example quotes sizes such as `"0.31763545"` BTC, which reads as base currency, S2.
It could not be checked on the wire.

### One-sided and empty books

An empty book is a full push with two empty arrays and `checksum` 0, as captured in section 6.

### Idle repeats

Not measured.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `depth.subscribe` `NOPEUSDT` | `{"id":6,"code":0,"message":"OK"}` | nothing in 28 s, in both runs |
| `depth.subscribe` `BTCUSDT` at limit 30, outside the documented set | `{"id":7,"code":0,"message":"OK"}` in both runs | `BTCUSDT` received a second full push in the first run and none in the rerun |
| unknown method `nope.subscribe` | `{"id":8,"code":30002,"message":"unknown method"}` | the socket stays open |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified in the pages read | `{"method":"server.ping","params":{},"id":1}` answered in 101 to 104 ms |
| silence the server tolerates | Not publicly specified | a socket that subscribed nothing and sent nothing was closed at 60.000 s and 59.999 s in two runs, with 1006 and no close frame |
| forced disconnect | Not publicly specified | none in 30 s, twice |
| maintenance notice | REST `maintain/info` | empty list |
| compression | "The response from the WS server is compressed using zip and must be decompressed first", S4 | every frame was binary gzip, 15 and 14 on futures and 13 and 4 on spot over two runs. A client offering permessage-deflate got no extension back, twice |
| handshake | | 327 to 404 ms |
| subscription limits | Not publicly specified | 221 contracts in one frame accepted |
| close | | a client close ended with 1006 in both runs, the server sent no close frame |

The gzip inside every frame is the one protocol fact that would have mattered to the engine.
[`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) refuses permessage-deflate, and a CoinEx subclass would have to gunzip each binary frame in `handleMessage` before parsing.

## 6. Captured frames

Trimmed, from `ws-probe.mjs book` at 03:23 UTC on 2026-09-23, after gunzip.

Subscribe.

```json
{"method":"depth.subscribe","params":{"market_list":[["BTCUSDT",50,"0",true],["ETHUSDT",50,"0",true],["SOLUSDT",50,"0",true],["BTCUSDC",50,"0",true]]},"id":2}
```

Acknowledgement.

```json
{"id":2,"code":0,"message":"OK"}
```

Full push of an empty futures book.

```json
{"method":"depth.update","data":{"market":"ETHUSDT","is_full":true,"depth":{"asks":[],"bids":[],"last":"2716.61","updated_at":1790132349768,"checksum":0}},"id":null}
```

State push, still carrying the values frozen on 2026-09-22.

```json
{"method": "state.update", "id": null, "data": {"state_list": [{"market": "BTCUSDT", "last": "85618", "volume": "0", "mark_price": "83154", "index_price": "85618.24", "open_interest_size": "552.7250", "latest_funding_rate": "-0.00375", "next_funding_rate": "-0.00375", "latest_funding_time": 1790064000000, "next_funding_time": 1790092800000, "period": 86400}]}}
```

Full push of the live spot book, three levels per side kept.

```json
{"method":"depth.update","data":{"market":"BTCUSDT","is_full":true,"depth":{"asks":[["86760","0.58242844"],["86768","1.49824820"],["86788","1.15223302"]],"bids":[["86690","0.61130406"],["86682","1.49973466"],["86669","1.15381508"]],"last":"86690","updated_at":1790133816976,"checksum":833975860}},"id":null}
```

Keepalive.

```json
{"id":1,"code":0,"data":{"result":"pong"},"message":"OK"}
```

Error.

```json
{"id":8,"code":30002,"message":"unknown method"}
```

## 7. Private channels

These are named for completeness, not probed, and closed with the exchange.
CCXT Pro builds `server.sign`, `balance.subscribe` and `user_deals.subscribe` at `server/node_modules/ccxt/js/src/pro/coinex.js` lines 1437, 278 and 446.
The documentation menu also names order, execution and position subscriptions, S1.

## 8. Recommended feed shape

None.
CoinEx futures ceased on 2026-09-22 and the exchange stops trading on 2026-09-29, so no feed should be written.
Had it stayed open, the feed would have needed a gunzip step per frame, `server.ping` inside the 60 s idle window, and a checksum check in place of a sequence rule.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinEx API v2, API Introduction and menu | https://docs.coinex.com/api/v2/ | 2026-09-22 | CoinEx, global | URLs, channel names, sections 1, 2 and 7 |
| S2 | Market Depth Subscription, futures | https://docs.coinex.com/api/v2/futures/market/ws/market-depth | 2026-09-22 | CoinEx, global | depth payload, limits, 200 ms push, one minute full push, checksum, sections 2 to 4 |
| S3 | Get Maintenance Information | https://docs.coinex.com/api/v2/common/http/maintain | 2026-09-22 | CoinEx, global | maintenance call, section 3 |
| S4 | Integration Guide | https://docs.coinex.com/api/v2/guide | 2026-09-22 | CoinEx, global | zip compression, reply shape, sections 3 and 5 |
| S5 | CCXT Pro 4.5.68 `coinex.js` | `server/node_modules/ccxt/js/src/pro/coinex.js` | 2026-09-22 | CCXT | URLs at lines 34 and 35, the `gunzip` option at line 41, private methods, sections 1 and 7 |
| P1 | `ws-probe.mjs book`, `idle`, `deflate` and `all`, each run twice | [`ws-probe.mjs`](../../../scripts/probes/venues/coinex/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
