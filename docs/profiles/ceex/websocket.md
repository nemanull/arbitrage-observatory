# CEEX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
CEEX publishes no socket documentation, so every documented value below is what the site's own bundle does, and every probed value comes from [`ws-probe.py`](../../../scripts/probes/venues/ceex/ws-probe.py), cited as W with a section number.
The bundle is `https://www.ceex.com/static/js/main.590e5384.chunk.js` with its lazy chunks, read on 2026-10-09, cited as B.
The full probe ran twice, at 04:49 and 04:53 UTC, and the numbers below are from the second run unless a range is given.
The second pass reran the short mode `--quick` at 05:02 UTC, which repeats sections 1, 2, 5 and 6 with shorter windows.
Sockets were held for about eleven minutes in total: a 12 second first look, two full runs of about five minutes each and the 50 second second pass.
That is slightly over the survey's ten minute guide, because the first full run stalled in its last section and was rerun.

## 1. Endpoints

| URL | carries | result from this host |
|---|---|---|
| `wss://www.ceex.com/new_w_quote/stream` | the live perpetuals: book, ticker with mark and funding, trades, klines | 101 in 767 to 805 ms over three runs, W1 |
| `wss://www.ceexcloud.com/new_w_quote/stream`, `wss://www.ceexs.com/new_w_quote/stream` | the same stream for the two mirror domains, chosen by the page's hostname in B | not probed |
| `wss://www.ceex.com/ws/quote/v1`, `wss://www.ceex.com/openapi/quote/ws/v1`, `wss://wsapi.ceex.com/openapi/quote/ws/v1` | the BlueHelix quote socket: spot and the legacy `*-SWAP-USDT` books | open, and each answered a `depth` subscription for `BTCUSDT` and `BTC-SWAP-USDT`, W8 |
| `wss://www.ceex.com/api/ws-vb/linear-swap-ws` | a path the bundle names | HTTP 404, W8 |

One socket carries every perpetual, because all eleven contracts settle in USDT.
All eleven book channels on one socket delivered 50 frames each in 10 s, 550 frames and 3.2 MB in all, W4.
No per connection cap is published, and none was reached.

## 2. Channel matrix

Every channel is subscribed with `{"id":"<channel>","event":"addChannel","channel":"<channel>","params":{"binary":false}}`, B.

| channel | content | probed |
|---|---|---|
| `TRIGGER_CONTRACT_ORDERBOOK_<symbol>_100` | full book, 100 levels per side | every 200 ms median, W2 |
| `TRIGGER_CONTRACT_ORDERBOOK_<symbol>_<letter>` | aggregated book, 20 levels per side, letters A to Z pick the price step in B | `_A` and `_B` gave 20 levels, W3 |
| `TRIGGER_CONTRACT_ORDERBOOK_<symbol>_20` | also answers with 20 levels per side | W3 |
| `TRIGGER_CONTRACT_TICKER_ALL` | every contract's last, 24 h stats, `markPrice`, `fundingRate`, `nextFundingTime` | every 200 ms, 11 symbols, W5 |
| `TRIGGER_CONTRACT_TICKER_<symbol>` | one contract's ticker | named in B, not probed |
| `TRIGGER_CONTRACT_TRADE_<symbol>` | recent trades, `price`, `side` B or S, `timestamp`, `volume` | 40 frames in 8 s, W6 |
| `TRIGGER_CONTRACT_KLINE_<symbol>_<interval>` | klines | named in B, not probed |
| best bid and ask only | none | |
| index | none on this socket | |

In the ticker, `fundingRate` was exactly `0.00010` or `-0.00010` on every contract and never changed within a run.
Its sign differed between runs on XRPUSDT (negative, positive, negative), AVAXUSDT and DOGEUSDT (negative, negative, positive), W5.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented (site bundle) | probed |
|---|---|---|
| 1. URL per family | one stream per domain | one URL carries all eleven contracts, W4 |
| 2. subscribe frame | `addChannel` with `id`, `channel`, `params.binary` | accepted as written, W2 |
| 3. acknowledgement | none in B | the book sends no acknowledgement and starts with data. `TICKER_ALL` sends `{"T":…,"channel":"TRIGGER_CONTRACT_TICKER_ALL","code":200}` first, W2, W5 |
| 4. snapshot on subscribe | every frame replaces the whole book in B | the first frame is a full 100 level book, W2 |
| 5. deltas | none | every frame is a full book, 68 of 74 differed from the one before in the second run, W2 |
| 6. sequence | none | no sequence or update id field, only `T` in ms, W2 |
| 7. checksum | none | none, W2 |
| 8. level order | the bundle reverses asks for display | asks and bids both arrive in descending price, so the best ask is the last ask and the best bid the first bid, W2 |
| 9. size unit | base asset, the catalog's `minStepQuantity` is in BTC for BTCUSDT | `v` values such as 0.476 BTC per level, W2 |
| 10. keepalive | `{"event":"ping"}` every 180 s, answered `{"event":"pong"}`, and the server may send `{"event":"ping"}` for a `pong` | `{"event":"ping"}` answered `{"event":"pong"}`, a plain text `ping` got no answer, W6 |
| 11. silence the server tolerates | not stated | a socket with no subscription and no ping closed at 59.9 s with code 1006 and no close frame, a socket pinging every 20 s stayed open 70 s, and a subscribed socket with no ping stayed open 75 s, W5, W7 |
| 12. compression | `binary:true` frames are zlib deflate, inflated with pako in B | `binary:false` gives text JSON. `permessage-deflate` was offered and not negotiated, W1, W3 |
| 13. unknown symbol | none | `{"T":…,"channel":"TRIGGER_CONTRACT_ORDERBOOK_NOPEUSDT_100","code":404}`, W6 |
| 14. unsubscribe | `{"event":"removeChannel","channel":"<channel>"}` | two frames already in flight arrived within 0.23 s, then none for the rest of 4 s, in the second run and the second pass, W6 |
| 15. error shape | `code` other than 200 | `code` 404 for an unknown channel name too, W6 |
| 16. limits | none published | none hit with 11 book channels on one socket, W4 |

## 4. The book channel in detail

- Snapshot on subscribe: yes, the first frame is the full book, and so is every later frame.
- Delta semantics: none, each frame replaces the book.
- Sequence and gap rule: none, so a missed frame costs nothing and there is no gap to detect.
  A frame carries `T`, the server time in ms.
- Checksum: none.
- Level order: asks descending from the 100th level down to the best ask, bids descending from the best bid.
  In W2 the asks ran from 82,809.65 down to 82,664.89 and the bids from 82,664.40 down to 82,530.26.
- Level shape: objects `{"p":"82809.65","v":"0.476"}`, both strings.
- Size unit: base asset, BTC on BTCUSDT.
  There is no CCXT `contractSize` to compare, and the catalog's quantity fields are in the same base unit, see [`rest.md`](./rest.md) section 2.
- Rate: a frame every 200 ms median in all three runs, 60 to 342 ms apart across them, about 5.87 KB each for 100 levels, W2.
- Idle repeats: 6 of 74 frames repeated the previous book exactly in the second run, and 4 of 48 in the second pass, W2.
- Crossed books: none in 100 frames in the first run, 75 in the second or 49 in the second pass, W2.
- One-sided or empty books: none seen on any of the eleven contracts, W4.
- Unknown or closed symbol: a single frame with `code` 404 and no data, W6.
- The book next to OKX: in the second run CEEX showed BTCUSDT bid 82,669.09 and ask 82,669.64 while OKX `BTC-USDT-SWAP` showed 82,674.9 and 82,675.0, W9.
  The first run and the second pass showed the same sign, CEEX about 6 to 8 USD below OKX.
  The levels sit about 1 to 2 USD apart with sizes such as 0.317, 0.547 and 1.74 BTC, which reads like a book quoted by one market maker.

## 5. Session

| item | value | evidence |
|---|---|---|
| keepalive | send `{"event":"ping"}`, expect `{"event":"pong"}` | W6, W7 |
| idle timeout | 60 s without traffic in either direction on a socket with no subscription | W7 |
| subscribed socket | open after 75 s with no client ping, frames every 200 ms | W5 |
| forced disconnects | none seen in about ten minutes | |
| maintenance notices | none on the socket. The announcements list a server migration and a contract system upgrade on 2026-03-02. | [`fees.md`](./fees.md) S6 |
| compression | none on the wire with `binary:false`, and `permessage-deflate` not negotiated | W1 |
| handshake | plain upgrade, no token, no origin check seen, `Mozilla/5.0` user agent | W1 |

## 6. Captured frames

Book frame from the second pass, trimmed to asks 1, 2 and 100 and bids 1 and 2 of the 100 per side:

```json
{"T":1791608522284,"channel":"TRIGGER_CONTRACT_ORDERBOOK_BTCUSDT_100","code":200,"data":{"asks":[{"p":"82775.06","v":"0.317"},{"p":"82773.06","v":"0.547"},{"p":"82634.04","v":"1.74"}],"bids":[{"p":"82633.42","v":"1.064"},{"p":"82631.73","v":"0.254"}],"lastPrice":"82633.7"}}
```

The best ask is the last ask, 82,634.04, and the best bid is the first bid, 82,633.42.

Ticker acknowledgement and one ticker row:

```json
{"T":1791608074041,"channel":"TRIGGER_CONTRACT_TICKER_ALL","code":200}
```

```json
{"ap":"1.393","c":"1.4076","change":"1.08","fundingRate":"0.00010","h":"1.4095","l":"1.3736","markPrice":"1.4075","nextFundingTime":1791619200000,"o":"1.3926","refPrice":"0","refVolume":"0","symbol":"XRPUSDT","v":"168015860.8"}
```

Trade frame, trimmed to one trade:

```json
{"T":1791608150075,"channel":"TRIGGER_CONTRACT_TRADE_BTCUSDT","code":200,"data":{"sortType":"TIMESTAMP","trades":[{"price":"82670.95","side":"B","timestamp":1791608150033,"volume":"0.054"}]}}
```

Keepalive answer and the unknown symbol error:

```json
{"event":"pong"}
```

```json
{"T":1791608150075,"channel":"TRIGGER_CONTRACT_ORDERBOOK_NOPEUSDT_100","code":404}
```

## 7. Private channels

The bundle opens `wss://www.ceex.com/api/ws/user` for account events, and names `/socket-vb/notification`, `/socket-vb/swap-notification` and `/socket-vb/linear-swap-notification`.
None was opened.

## 8. Recommended feed shape

- URL: `wss://www.ceex.com/new_w_quote/stream`, one socket for all eleven contracts.
- Subscribe: one `addChannel` frame per contract for `TRIGGER_CONTRACT_ORDERBOOK_<symbol>_100` with `binary:false`, plus `TRIGGER_CONTRACT_TICKER_ALL` if the socket also feeds the anchor, see [`rest.md`](./rest.md) section 8.
- Handling: on each book frame, `resetBook`, set the first 20 bids in order, set the last 20 asks in reverse order, and `publish`.
  Drop frames whose `code` is not 200.
- Keepalive: `{"event":"ping"}` every 20 s, because a socket that falls silent closes at 60 s.
- `maxSilenceMs`: 5,000, which is 25 book periods.
- Resync: none is needed for gaps, because every frame is a full book.
  On close or silence, reconnect and resubscribe.
- Raw market id: the catalog's `symbol`, such as `BTCUSDT`, which is the string the channel names use.
- The spot pair `BTCUSDT` has the same name on the BlueHelix quote socket, so the adapter must not mix the two sockets.

## 9. Source ledger

| id | source | retrieved | what it gave |
|---|---|---|---|
| B | `https://www.ceex.com/static/js/main.590e5384.chunk.js` and the lazy chunks listed in `https://www.ceex.com/`, chunk 39 for the order book component | 2026-10-09 | the stream URLs, channel names, subscribe frame, ping interval and binary decoding |
| W | [`ws-probe.py`](../../../scripts/probes/venues/ceex/ws-probe.py) | 2026-10-09 | every probed value above |
