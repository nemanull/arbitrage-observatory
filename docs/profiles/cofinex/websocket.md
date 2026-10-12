# Cofinex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
Cofinex documents no WebSocket API, S1.
The only socket found is the one the cofinex.io web app opens, read from its Next.js bundle, S2.
It serves spot books only, and every perpetual product type tried returned nothing, see section 4.
Its book frames are Bitget's spot book relayed without a symbol, so it is no usable perpetual feed.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/cofinex/ws-probe.py), in two full runs, cited as run 1 and run 2 with sections A to G.

## 1. Endpoints

| URL | role | evidence |
|---|---|---|
| `wss://wss1.cofinex.io/api/v1/ws/1` | the web app's market data socket, the fallback value of `NEXT_PUBLIC_WS_URL` | S2, chunk `40jcj_2q29__k.js` |

The handshake answered 101 in 260 to 299 ms, from `server: uvicorn`, with `permessage-deflate` offered, section A.
The first frame is `{"type": "connection_established", "message": "WebSocket connection opened for user: 1", "user_id": "1", "timestamp": "..."}` with no login.
No perpetual socket was found in the bundle, and the API docs name no socket, S1.

## 2. Channel matrix

The bundle subscribes four channels, each with `productType` `SPOT`, S2.

| channel | what it carries, section E | perpetual variant |
|---|---|---|
| `Books` | 15 levels per side, full snapshot every frame | none found |
| `Trade` | one object per trade: `t`, `p`, `s`, `d`, `i` | none found |
| `Ticker` | Bitget style ticker: `i` `BTCUSDT`, last, open, high, low, bid, ask, sizes, 24 h volumes | none found |
| `Summary` | `symbol`, `price`, `changePercent`, `quoteVolume`, `timestamp` | none found |
| mark, index, funding | absent | absent |

The `Ticker` frame's 24 h quote volume read 177 to 181 million USDT on BTCUSDT, while the venue's own REST summary reported 1.67 million, see [`rest.md`](./rest.md) section 2.
So the ticker is Bitget's market, not trade on Cofinex.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is documented, so every documented value is Not publicly specified, and the probed column is the spot `Books` channel.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one URL for every spot channel, no perpetual endpoint found |
| subscribe frame shape | Not publicly specified | `{"type":"subscribe","channel":"Books","productType":"SPOT","symbol":"BTC","base":"USDT"}`, S2 |
| unknown symbol expectation | Not publicly specified | silence, no error, section D |
| chunk unit and budget | Not publicly specified | not reached, two symbols on one socket worked, section B |
| keepalive mechanism | Not publicly specified | the web client sends none, S2, the server answers a protocol ping in 79 ms, section D |
| connection lifetime and maintenance notice | Not publicly specified | an idle socket with no subscription and no ping stayed open 90 s, section F |
| handshake and operation rate limits | Not publicly specified | Not verified |
| public market data authentication | Not publicly specified | none, the server labels the session user 1 |
| message parse and routing | Not publicly specified | book frames carry no channel and no symbol, section B |
| subscribe acknowledgement shape | Not publicly specified | none, the first book frame is the answer |
| symbol identifier format | Not publicly specified | base and quote as separate fields, `BTC` and `USDT` |
| number representation | Not publicly specified | prices and sizes as strings |
| timestamp representation | Not publicly specified | `ts` as a string of milliseconds |
| size unit | Not publicly specified | base asset on spot, perpetual Not verified |
| sequence semantics | Not publicly specified | `seq` an integer that rises by 89 to 34,789 between frames, `pseq` always 0 |
| idle repeat behaviour | Not publicly specified | 27 of 481 and 38 of 315 frames repeated the previous book with a new `seq` |

## 4. The book channel in detail

Perpetual books: none.
A `Books` subscription for BTC and USDT with `productType` `FUTURE`, `USDT-FUTURES` or `UMCBL` returned no frame and no error in 15 s each, section C.
`FUTURE` is the documented REST `tradeType`, `USDT-FUTURES` is Bitget's current USDT-M product type and `UMCBL` is the code in CoinMarketCap's market URLs.

Spot books, for the record, section A over 60 s on BTC/USDT:

| item | run 1 | run 2 |
|---|---|---|
| first book after subscribe | 286 ms | 153 ms |
| book frames | 315 | 481 |
| interval median, p90, max | 145, 417, 753 ms | 104, 190, 509 ms |
| levels per side | 15 on every frame | 15 on every frame |
| local receive minus `ts`, min and median | 112 and 115 ms | 110 and 114 ms |
| `seq` strictly rising | yes | yes |
| crossed books, zero size levels | 0, 0 | 0, 0 |

Every frame is a JSON array holding one object with `asks`, `bids`, `ts`, `seq` and `pseq`, asks ascending and bids descending.
Every frame is a full 15 level snapshot, so there are no deltas, no gap rule to apply and no checksum.
The book is Bitget's: in section G the socket's top of book equalled Bitget's own REST BTCUSDT top in all five checks 2 s apart.
The `seq` values, around 900 billion, are likely Bitget's own book sequence, carried through.
A frame names no symbol.
With BTC and ETH subscribed on one socket, 244 frames arrived and none carried a symbol field, so only the price level told them apart, section B.
A feed would need one socket per symbol.

## 5. Session

| item | probed |
|---|---|
| keepalive | the web client sends no ping, S2. A protocol ping is answered, section D |
| idle tolerance | 90 s open with no subscription and no ping, section F. Longer silence was not tested |
| malformed text | `{not json` and `ping` each return `{"type": "error", "message": "Invalid JSON format"}` and the socket stays open |
| JSON ping | `{"type": "ping"}` gets no reply, and `{"op": "ping"}` makes the server close with code 1000 |
| compression | `permessage-deflate` offered at the handshake |
| forced disconnects, maintenance notices | none seen |

## 6. Captured frames

Subscribe, section A, sent by the probe as the web client sends it, S2:

```json
{"type": "subscribe", "channel": "Books", "productType": "SPOT", "symbol": "BTC", "base": "USDT"}
```

Book snapshot, run 2 section A, trimmed to three levels per side:

```json
[{"asks": [["82666.63", "0.888396"], ["82668.69", "0.020156"], ["82668.7", "0.0485"]], "bids": [["82666.62", "0.092456"], ["82664.89", "0.017712"], ["82657.75", "0.001117"]], "ts": "1791600691350", "seq": 900400560283, "pseq": 0}]
```

Error, section D:

```json
{"type": "error", "message": "Invalid JSON format"}
```

Ticker, run 2 section E:

```json
[{"i": "BTCUSDT", "l": "82634.72", "o": "82881", "h": "83534.41", "lo": "82035.01", "c": "0.00372", "b": "82634.72", "a": "82634.73", "bs": "0.814722", "as": "1.108614", "bv": "2145.732695", "qv": "177454850.703876", "ou": "82621.31", "cu": "0.00016", "t": "1791600835392"}]
```

Every frame is also in `.claude/survey-work/cofinex/ws-capture.jsonl`, which is not committed.

## 7. Private channels

None found.
The bundle sends spot orders through an authenticated REST proxy, see [`rest.md`](./rest.md) section 2, and opens no private socket.

## 8. Recommended feed shape

None.
No socket serves perpetual books, and the spot books are Bitget's relayed without a symbol, so the engine should read Bitget directly, see [`../bitget/websocket.md`](../bitget/websocket.md).

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [Cofinex API docs](https://apidocs.cofinex.io/) and [`openapi.json`](https://apidocs.cofinex.io/openapi.json), REST only | 2026-10-09 |
| S2 | Cofinex web bundle chunks under `https://www.cofinex.io/_next/static/chunks/`: `40jcj_2q29__k.js` for the socket URL, `25lii85bvbi7b.js` for the socket client, `34-zt3eis44nz.js` for the `Books` and `Trade` subscriptions, and `07853l6kp2pdm.js` for the book panel | 2026-10-09 |
| S3 | [Bitget spot order book](https://api.bitget.com/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=1), used as the comparison in section 4 | 2026-10-09 |
