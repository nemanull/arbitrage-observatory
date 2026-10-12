# GudangKripto WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:52 to 04:10 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

GudangKripto lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book channel.
GudangKripto publishes no socket documentation.
The URL comes from the web app's runtime config, and the frame shapes and channel names from the app's socket client and trade page, R1 of [`rest.md`](./rest.md) section 9.
So the "documented" column of section 3 means what the app's own client code does.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/gudangkripto/ws-probe.py), in a first run and a second pass rerun about seven minutes apart.
The first run held the book part 150 s and the idle socket 120 s, and the committed script holds them 90 s and 60 s.
Sockets were open about ten and a half minutes in total across both runs.

## 1. Endpoints

| market | URL | probed |
|---|---|---|
| spot, every IDR pair | `wss://be.gudangkripto.id/ws` | HTTP 101 through Cloudflare, edge `YVR`, `Server-Timing` `cfEdge;dur=13,cfOrigin;dur=528` |
| perpetuals | none | Not offered |

One socket carries every pair and every public channel.
The upgrade echoes `Access-Control-Allow-Origin: https://gudangkripto.id`, and the probe sent that origin, as the web app does.

## 2. Channel matrix for public market data

| channel | payload | probed cadence |
|---|---|---|
| `orderbook:<COIN>_IDR` | whole book, up to 40 levels a side | a snapshot on subscribe, then one whole snapshot every 30 s on BTC and ETH and every 10 s on USDT and the thinner pairs |
| `ticker:<COIN>_IDR` | last price, open, high, low, volume, changes | a frame every 1.2 to 1.7 s median on BTC and ETH, every 5 s on USDT |
| `trades:<COIN>_IDR` | trades | type `trades` with one new trade per frame on BTC and ETH, type `trade` with the same recent history list every 10 s on USDT |
| `market:IDR` | a ticker row for each of the 36 coins | every 5 s |
| `depth:BTC_IDR` | acknowledged as subscribed | 0 frames in 90 s and in 150 s |
| best bid and ask, mark, index, funding | none | Not offered |

## 3. The sixteen axes

| axis | documented by the app's client | probed |
|---|---|---|
| endpoint split axis | one URL, `wsUrl` | one URL carries all 36 pairs and every channel |
| subscribe frame shape | `{"action":"subscribe","channels":[...]}` | 11 channels in one frame got one acknowledgement, and 36 orderbook channels in one frame got one acknowledgement listing all 36 |
| unknown symbol expectation | not handled | `{"type":"error","code":"invalid_channel","message":"Unknown or inactive market channel: orderbook:NOPE_IDR"}`, then `{"type":"subscribed",...,"data":{"channels":[]}}`. A quote other than IDR, such as `orderbook:BTC_USDT`, gets the same error |
| chunk unit and budget | Not publicly specified | 36 channels in one frame, all delivered within 40 s |
| keepalive mechanism | the app sends `{"action":"ping"}` every 30 s | answer `{"type":"pong","code":"success","message":"OK","data":{"ts":<ms>}}`. An idle socket stayed open without app pings, and whether the server sends protocol pings was not checked |
| connection lifetime and maintenance notice | the app reconnects 3 s after any close | no close and no notice in 150 s with traffic, or in 120 s and 60 s with no subscription and no ping |
| handshake and operation rate limits | Not publicly specified | no refusal over the 12 connections the probe opened across both runs |
| public market data authentication | none. An `auth` action with a login token is for private data | none |
| message parse and routing | `type` and `channel` | every frame is JSON with `type`, `code`, `message` and `data`, and channel frames add `channel` |
| subscribe acknowledgement shape | not read by the app | `{"type":"subscribed","code":"success","message":"OK","data":{"channels":[...]}}`, sometimes after the first snapshot |
| symbol identifier format | `<COIN>_<QUOTE>` in upper case | `BTC_IDR`, and `pair` inside the data repeats it |
| number representation | parsed with `parseFloat` | decimal strings, such as `"1470694621"` and `"0.997129"`, with long fractional parts in ticker prices |
| timestamp representation | not read | `ts` in milliseconds in book, trade, pong and `market:IDR` frames. `last_transaction_time` is in seconds on BTC and in milliseconds on USDT |
| size unit | base coin | `amount` in the base coin, such as BTC |
| sequence semantics | none | no sequence field, and every book frame is a whole snapshot |
| idle repeat behaviour | not read | the USDT book frame repeated unchanged, including its `ts`, every 10 s |

## 4. The book channel in detail

| question | probed answer |
|---|---|
| snapshot on subscribe | yes, the first book frame arrived 0.18 to 0.64 s after the subscribe frame, sometimes before the acknowledgement |
| delta semantics | none, every frame is the whole book and replaces the last one |
| per symbol sequence and gap rule | none, so there is no gap to detect |
| checksum | none |
| level order on the wire | bids descending and asks ascending in every frame of both runs |
| depth | 40 levels a side at most. USDT showed 26 a side, and thin pairs showed between 2 and 33 levels on a side |
| size unit | base coin, with no contract size |
| crossed frames | none |
| one-sided and empty books | `orderbook:KITE_IDR` delivered `"bids": []` and `"asks": []` every 10 s, and several thin pairs had far fewer bids than asks |
| idle repeats | USDT repeated an identical frame every 10 s for 150 s. BTC and ETH frames all differed from the one before |
| unknown or closed symbol | an `invalid_channel` error and an empty acknowledgement, and nothing after it in 20 s |
| cadence | BTC and ETH every 30.00 s and USDT every 10.00 s in the book part. In 40 s on all 36 pairs, ANOA, ATOM, CJL, CST, DRX, IDRT, JAM, KITE, NXA, RAI and USDT sent 5 frames each, which fits the subscribe snapshot plus a 10 s cadence, GOIDR sent 5 and then 18 in the two runs, and the other 24 pairs sent 2 or 3 |

The cadence is the deciding fact.
A whole book every 30 s on BTC and ETH is far too slow for the engine's book, which expects updates within its `maxSilenceMs` and a fresh top of book between them.
BTC and ETH also behave like an automated quote rather than a traded market.
Their best bid and ask sat 3,501 ppm and 3,504 ppm apart in the first frame of both runs, the ticker reports `volume` "0", and BTC trades carry an empty `trade_id`.
USDT_IDR behaves like a separate matching engine, with a 56 ppm spread, numbered trade ids, and a last trade about ten hours before the probe.
CoinMarketCap tags the venue "Auto Order Book Exchange", S5 of [`fees.md`](./fees.md) section 10.

## 5. Session

| item | probed |
|---|---|
| keepalive | `{"action":"ping"}` answered by `pong` with a millisecond `ts` |
| silence the server tolerates | at least 120 s with no frame from the client and no subscription |
| forced disconnects | none seen |
| maintenance notices | none seen. The app's runtime config has `forceMaintenance` false |
| compression | the client offered permessage-deflate, and the server did not accept it |
| handshake | 101 on every attempt, and the rerun's `Server-Timing` read a 13 ms edge time and a 528 ms origin time |
| clock | `market:IDR` frames arrived a median 76 to 80 ms after their `ts`. BTC and ETH book frames arrived 492 to 809 ms after their `ts`, so their `ts` is stamped well before the push |
| malformed input | a non-JSON frame and a bare string `channels` both get `{"type":"error","code":"invalid_json","message":"Invalid JSON format"}`, and an unknown action gets `unknown_action`. The socket stays open |
| unsubscribe | `{"action":"unsubscribe","channels":[...]}` answered by `{"type":"unsubscribed",...}` |

## 6. Captured frames

Subscribe acknowledgement:

```json
{"type":"subscribed","code":"success","message":"OK","data":{"channels":["market:IDR","depth:BTC_IDR","orderbook:BTC_IDR","ticker:BTC_IDR","trades:BTC_IDR","orderbook:USDT_IDR","ticker:USDT_IDR","trades:USDT_IDR","orderbook:ETH_IDR","ticker:ETH_IDR","trades:ETH_IDR"]}}
```

Book snapshot, trimmed to two levels a side from forty:

```json
{"type":"orderbook","code":"success","message":"OK","data":{"pair":"BTC_IDR","ts":1791604644394,"bids":[{"price":"1470694621","amount":"0.997129"},{"price":"1470691059","amount":"0.060276"}],"asks":[{"price":"1475852862","amount":"0.072834"},{"price":"1475877878","amount":"0.000176"}]},"channel":"orderbook:BTC_IDR"}
```

Trade:

```json
{"type":"trades","code":"success","message":"OK","data":[{"pair":"BTC_IDR","price":"1477394802","quantity":"0.048766","side":"Sell","ts":1791605072104,"trade_id":""}],"channel":"trades:BTC_IDR"}
```

Ticker, with the long fractional prices as sent:

```json
{"type":"ticker","code":"success","message":"OK","data":{"coin":"BTC","fiat":"IDR","last_price":"1477468062.698920333336094350005","open":"1473685113.0138138731234715829564758656196205125","high":"1492372146.7266151666694555353275","low":"1469105622.553900333336078722705","volume":"0","quote_volume":"0","change_24h":"3782949.6851064602126227670485241343803794875","percent_change_24h":"0.26","percent_change_7d":"-4.38","percent_change_30d":"5.52","percent_change_60d":"0","percent_change_90d":"0","last_transaction_time":1791605072},"channel":"ticker:BTC_IDR"}
```

Keepalive answer:

```json
{"type":"pong","code":"success","message":"OK","data":{"ts":1791605160367}}
```

Errors:

```json
{"type":"error","code":"invalid_channel","message":"Unknown or inactive market channel: orderbook:NOPE_IDR"}
```

```json
{"type":"error","code":"unknown_action","message":"Unknown action: hello"}
```

## 7. Private channels

The app sends `{"action":"auth","token":<login token>}` on the same socket, and the server answers with a frame of type `authenticated` that carries a `user_id`, R1 of [`rest.md`](./rest.md) section 9.
The app then subscribes channels such as `trade.order.status_<id>`.
None was probed.

## 8. Recommended feed shape

None for the engine.
GudangKripto has no perpetual, and its spot book arrives as a whole snapshot every 30 s on its main pairs, which no `maxSilenceMs` built for live books can accept.
If a later design added an IDR spot leg for the thinner cadence anyway, the shape would be one socket to `wss://be.gudangkripto.id/ws` for all 36 pairs, one subscribe frame listing every `orderbook:<COIN>_IDR` channel, an app ping every 30 s, a book replaced whole on every frame, and a `maxSilenceMs` above 30 s.
There is no resync rule to write, because there are no deltas and no sequence.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| W1 | the web app's socket client in `https://gudangkripto.id/_nuxt/BySqCzkc.js` and the trade page chunk that builds `market:IDR`, `ticker:`, `orderbook:` and `trades:` channel names | the URL, the subscribe, unsubscribe, ping and auth frames, the 30 s ping and the 3 s reconnect |
| W2 | [`ws-probe.py`](../../../scripts/probes/venues/gudangkripto/ws-probe.py), first run at 03:56 to 04:03 UTC and rerun at 04:04 to 04:09 UTC on 2026-10-10, frames in `.claude/survey-work/gudangkripto/` | every probed value above |
| S5 | CoinMarketCap's exchange record, see [`fees.md`](./fees.md) section 10 | the "Auto Order Book Exchange" tag |
