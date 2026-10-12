# IBIT Global WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22, rechecked 2026-10-09.

**Probed:** 2026-10-09 by the Seattle calendar, 2026-10-10 02:20 to 02:45 UTC by the host clock, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada.

IBIT Global publishes no WebSocket documentation.
The socket hosts and channel names below were read from the JavaScript chunks of `https://www.ibitglobal.ai/zh-CN` and `https://www.ibitglobal.ai/en-US/futures/BTCUSDT`, fetched on 2026-10-10, S1.
The web app opens its market sockets as `<host>?ts=<ms>&sign=<hash>&env=local`, where the sign is a hash the browser computes from the timestamp and fixed text.
[`ws-probe.py`](../../../scripts/probes/venues/ibit-global/ws-probe.py) never computes that sign.

The 2026-09-24 draft of this profile found every socket refused.
Its probe sent no query or only `ts`, and both forms are still refused.
On 2026-10-10 the two market data hosts accepted any client that sends `env=local`, with or without `ts`, and with no sign or an empty one, P1.
Without `env=local` they still refuse, as they did in September.
So the market data is reachable without credentials, but only through the web client's own undocumented socket, and nothing published promises it will stay that way.
The September probe, [`ws-probe.mjs`](../../../scripts/probes/venues/ibit-global/ws-probe.mjs), stays as frozen evidence.

## 1. Endpoints

| role in the web app | URL | probed |
|---|---|---|
| futures market data | `wss://prod-ibit-market-server-p-co-p-group.aka-line-a.com/ws/quotation` | with `env=local`: upgrade in 186 to 522 ms over two runs, then `{"data":{"connect":"success"},...}` and data. Without it: the `failed` frame and a drop |
| spot market data | `wss://prod-ibit-spot-market-server-p-co-p-group.aka-line-a.com/ws/quotation` | same behaviour, upgrade in 329 to 374 ms |
| futures account | `wss://prod-ibit-futures-ws-p-group.aka-line-a.com/ws/futures` | code `0002` with no query or `ts` only, code `0013` "Verification failed" with an empty sign, then a drop |
| spot account | `wss://prod-ibit-spot-ws-p-group.aka-line-a.com/ws/spot` | code `0003` "ts or sign is empty" with no query or an empty sign, then a drop. With `ts` only, the same frame in one run and a bare drop in the other |
| message hub | `wss://prod-ibit-msghub-p-wsserver-pc.aka-line-a.com/ws` | HTTP 401 on the upgrade, body ``{"err":"authorize error: `ibit-platform` is required"}`` |

The futures market host resolved through `a795.dscr.akamai.net` to `23.213.230.200` and `23.213.230.202` in one run and to `23.213.230.75` and `23.213.230.86` in a later run, P2.
In September the same hosts resolved to `207.194.175.128` and `207.194.175.131`, so the Akamai edge address is not fixed.
One socket carries one product family, futures and spot on separate hosts, S1.
There is one perpetual family, USDT-M, so one futures host covers it.
Every drop above ended without a close frame, which a client sees as code 1006.

## 2. Channel matrix for public market data

The subscribe frame is `{"event":"sub","params":{"channels":[...]}}`, S1, and an unsubscribe uses `"event":"unsub"` with the same shape.
A futures subscription names `gzip_market_...`, and the reply's `channel` drops the `gzip_` prefix and lowercases the symbol, P1.

| channel subscribed on the futures host | reply channel | content | rate over 60 s, P1 |
|---|---|---|---|
| `gzip_market_<SYMBOL>_depth_step0` | `market_<symbol>_depth_step0` | 30 bids and 30 asks, the whole window every push | 117 to 133 frames for BTCUSDT and 113 to 122 for ETHUSDT over two runs |
| `gzip_market_depth_one_price_<symbol>` | `market_depth_one_price_<symbol>` | best bid and ask prices, no sizes | 269 to 271 frames |
| `gzip_market_<symbol>_trade_ticker` | `market_<symbol>_trade_ticker` | trades with `price`, `side`, `vol`, `amount` and `ts` | 121 frames |
| `gzip_market_<symbol>_ticker` | `market_<symbol>_ticker` | 24 h open, high, low, close, `rose`, `vol`, `amount` | 117 frames |
| `gzip_market_all_mark_price` | `market_all_mark_price` | mark for every contract, keyed by lowercase symbol | 60 to 61 frames, one per second |
| `gzip_market_all_index_price` | `market_all_index_price` | index for every contract | 60 to 61 frames, one per second |
| `gzip_market_all_position_fee_rate` | `market_all_position_fee_rate` | `positionFeeRate`, `symbol`, `updateTime` for every contract | 2 frames |
| `gzip_market_position_fee_rate_<symbol>` | `market_position_fee_rate_<symbol>` | the same for one contract | 2 frames |
| `gzip_market_all_latest_price`, `gzip_market_all_24h_ticker`, `gzip_market_abnormal` | as named | from S1 | not probed |

The spot host takes the same names without `gzip_`, for example `market_<SYMBOL>_depth_step0` and `market_all_latest_price`, and sends text frames, P1.
No channel carries a next funding time or a funding interval.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
There is no documentation, so the documented column is Not publicly specified on every row, and the probed column is P1 unless it says otherwise.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | product, one host for futures market data and another for spot |
| subscribe frame shape | Not publicly specified | `{"event":"sub","params":{"channels":[...]}}` with many channels in one frame |
| unknown symbol expectation | Not publicly specified | `gzip_market_NOSUCHUSDT_depth_step0` drew no frame and no error |
| chunk unit and budget | Not publicly specified | ten channels in one subscribe frame worked. No cap was found or tested |
| keepalive mechanism | Not publicly specified | `{"event":"ping"}` draws `{"event":"pong"}`. The web app pings every 30 s, S1 |
| connection lifetime and maintenance notice | Not publicly specified | a socket held 60 s without any ping stayed open. Longer lifetime Not verified |
| handshake and operation rate limits | Not publicly specified | 19 handshakes in about 55 s drew no rate refusal |
| public market data authentication | Not publicly specified | none. The query `env=local` is required, and `ts` and `sign` are not checked on the market hosts |
| message parse and routing | Not publicly specified | JSON with `channel`, `tick` and `ts`. Futures data frames are gzip, first bytes `1f 8b`. Connect frames are text with `path`, `topic` and `data` |
| subscribe acknowledgement shape | Not publicly specified | none. The first data frame is the acknowledgement |
| symbol identifier format | Not publicly specified | upper or lower case `BTCUSDT` subscribes, and replies use lowercase `btcusdt` |
| number representation | Not publicly specified | JSON numbers, for example `[82594.0,4.308]` |
| timestamp representation | Not publicly specified | `ts` in Unix ms on every data frame |
| size unit | Not publicly specified | Not verified. Every one of 29,100 BTCUSDT and ETHUSDT sizes over two runs was a multiple of 0.012 |
| sequence semantics | Not publicly specified | none. A book frame has no sequence or update id |
| idle repeat behaviour | Not publicly specified | 2 to 11 BTCUSDT book frames per 60 s repeated the previous window exactly |

## 4. The book channel in detail

- Snapshot: every frame is the whole 30 level window, so there is no delta to apply and no gap to detect, P1.
  The web app sorts and keeps 20 a side and replaces its book on each frame, S1.
- Sequence and checksum: none, P1.
  A resync rule can only be a silence timeout.
- Level order on the wire: bids best first, descending.
  Asks are also descending, so the best ask is the last element, P1.
  The web app sorts asks before it uses them, S1.
- Cadence: BTCUSDT frames arrived with a median gap of 392.5 ms in one 60 s run and 441 ms in the other, a minimum of 0 ms and a maximum of 1,210 and 1,486 ms, P1.
  The web app throttles book updates to 500 ms, S1.
- Size unit: Not verified.
  No unsigned call returns a contract size, see [`rest.md`](./rest.md) section 2.
  The 24 h `vol` of BTCUSDT, 53,623.896, is also a multiple of 0.012.
  Its `amount` divided by the close is 61,376.1, about 1.14 times `vol`, so the ticker does not settle the unit either.
- Crossed books: none in 485 BTCUSDT and ETHUSDT frames over two runs, P1.
- Empty and one-sided books: none seen.
- Unknown or closed symbol: silence, P1.
- Independence: in six paired reads over two runs, 0 to 9 of IBIT's top 20 BTCUSDT bid prices also appeared in the public book of Binance, OKX or Bybit, P1 mode mirror.
  A copied ladder would share all 20, so the book is not a plain copy of one of them.
- Spot book: 30 a side, text frames, median gap 260 to 266 ms over 30 s, P1.
  Its 30 bids ran from 82,658 down to 73,207.71 and its 30 asks from 82,658.01 up to 92,111.43, so the spot book is thin past the top.

## 5. Session

- Keepalive: `{"event":"ping"}` answered by `{"event":"pong"}`, P1.
  The web app sends it every 30 s and treats 15 s without a frame as stale, S1.
- Silence tolerance: a socket that never pinged stayed open for 60 s, P1.
- Forced disconnects and maintenance notices: Not verified.
- Compression: no extension was negotiated on any upgrade, P1.
  Futures data frames are gzip inside the binary frame, which a feed must inflate itself.
  Spot data frames are plain text.
- Handshake: a refusal comes as a text frame after the upgrade on four hosts, then a drop without a close frame, and as HTTP 401 on the message hub.

## 6. Captured frames

Connect on a market host with `env=local`.

```json
{"data":{"connect":"success"},"path":"quotation","topic":"connect"}
```

Connect on a market host without it.

```json
{"data":{"connect":"failed"},"path":"quotation","topic":"connect"}
```

A futures book frame after gzip inflation, trimmed to two levels a side, with asks in wire order.

```json
{"channel":"market_btcusdt_depth_step0","tick":{"buys":[[82594.0,4.308],[82593.9,0.096]],"asks":[[82601.1,9.192],[82600.9,8.928]]},"ts":1791599275100}
```

Funding for one contract.

```json
{"channel":"market_position_fee_rate_btcusdt","tick":{"positionFeeRate":0.0002,"symbol":"btcusdt","updateTime":1791599100080},"ts":1791599275101}
```

Best bid and ask.

```json
{"channel":"market_depth_one_price_btcusdt","tick":{"askPrice":82594.1,"bidPrice":82594.0,"symbol":"btcusdt"},"ts":1791599275101}
```

Keepalive answer.

```json
{"event":"pong"}
```

Futures account host with an empty sign.

```json
{"path":"futures","topic":"connect","data":{"reason":"Verification failed","code":"0013","connect":"failed"}}
```

## 7. Private channels

The futures account socket subscribes `account`, `currentPositions`, `followPositions`, `leadPositions`, `openOrders`, `planCloseOrders`, `planOpenOrders` and `unsettleProfit` with a login token, S1.
The API key page offers only "Allow reading" and "Allow Spot Trading", so a futures execution stage has no API path, see [`rest.md`](./rest.md) section 1.

## 8. Recommended feed shape

None.
The only book source is the web client's own socket, opened with a query string copied from its bundle, and the venue documents none of it.
If the venue were ever taken on that basis anyway, the shape would be one connection to the futures host with `?env=local`, every `gzip_market_<SYMBOL>_depth_step0` in one subscribe frame, gzip inflation of each binary frame, a full book replace per frame with asks reversed, a ping every 15 s, and a resync after about 3 s of silence on a symbol.
`maxSilenceMs` would have to allow the 1,486 ms gaps seen, and the size unit would need a contract size that no public call gives.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | IBIT Global web app JavaScript chunks, landing page and futures page | `https://www.ibitglobal.ai/_next/static/chunks/` | 2026-10-10 | IBIT Limited | socket hosts, query string, channel names, subscribe and ping frames, timings, book handling, private channels, sections 1 to 7 |
| P1 | `ws-probe.py` modes handshake, book, spot and mirror | [`ws-probe.py`](../../../scripts/probes/venues/ibit-global/ws-probe.py) | 2026-10-10 | this host, Canadian VPN exit | every probed value, sections 1 to 6 |
| P2 | `rest-probe.py` | [`rest-probe.py`](../../../scripts/probes/venues/ibit-global/rest-probe.py) | 2026-10-10 | this host, Canadian VPN exit | DNS of the futures market host, section 1 |
| P0 | `ws-probe.mjs`, the September draft's probe | [`ws-probe.mjs`](../../../scripts/probes/venues/ibit-global/ws-probe.mjs) | 2026-09-24 | this host, Canadian VPN exit | the September refusals and addresses, superseded |
