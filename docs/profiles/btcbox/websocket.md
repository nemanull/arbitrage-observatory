# BTCBOX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:00 UTC), from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

BTCBOX (CCXT id `btcbox`) publishes no WebSocket, public or private.
Its API documentation names only an HTTP API, "At BTCBOX, we have HTTP Private API that need confirmation by an API Key, and HTTP Public API that does not need any confirmation.", S1, and the Japanese edition says the same, S2.
CCXT 4.5.68 declares `'ws': false` at `server/node_modules/ccxt/js/src/btcbox.js` line 118 and `'pro': false` at line 27, and ships no `server/node_modules/ccxt/js/src/pro/btcbox.js`, P7.
BTCBOX's own trading page polls over HTTP instead of opening a socket.
Its script re-arms `AJAX.trades`, `AJAX.alltrade`, `AJAX.allorder` and `AJAX.allcoin` with `setTimeout(..., 3000)`, and it holds no `ws://` or `wss://` URL and no `WebSocket`, S3.
[`ws-probe.mjs`](../../../scripts/probes/venues/btcbox/ws-probe.mjs) tried every plausible socket URL, and none completed a handshake.
BTCBOX has no perpetuals, so this profile follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and records, axis by axis, what exists for its spot book instead, which is the REST `depth` call of [`rest.md`](./rest.md) section 5.

## 1. Endpoints

| family | documented URL | probed on 2026-09-23 UTC |
|---|---|---|
| spot order book, JPY | none, S1, S2 | no socket, see below |

| URL tried by P7 | outcome |
|---|---|
| `wss://www.btcbox.co.jp/` | HTTP 200 with the HTML home page, no upgrade |
| `wss://www.btcbox.co.jp/ws` | HTTP 500, empty body |
| `wss://www.btcbox.co.jp/websocket` | HTTP 500, empty body |
| `wss://www.btcbox.co.jp/api/v1/ws` | HTTP 500, empty body |
| `wss://www.btcbox.co.jp/socket.io/?EIO=4&transport=websocket` | HTTP 500, empty body |
| `wss://www.btcbox.co.jp/socket.io/?EIO=3&transport=websocket` | HTTP 500, empty body |

Every refusal came from Cloudflare (`server: cloudflare`) in 430 to 535 ms over two runs, through the edges `SEA` and `YVR`.
An unknown REST path also answers HTTP 500 with an empty body, see [`rest.md`](./rest.md) section 6, so the 500 is the site's answer to any unknown path and not a socket that failed.
`ws.btcbox.co.jp`, `stream.btcbox.co.jp`, `api.btcbox.co.jp`, `socket.btcbox.co.jp` and `wss.btcbox.co.jp` do not resolve, `ENOTFOUND`, P7.
`www.btcbox.co.jp` and `btcbox.co.jp` resolve to the Cloudflare addresses `104.18.20.149` and `104.18.21.149`, P7.

## 2. Channel matrix for public market data

No channel exists.
The HTTP calls below are the only public market data, S1, and they are covered in [`rest.md`](./rest.md).

| data | WebSocket channel | HTTP call |
|---|---|---|
| order book | none | `GET /api/v1/depth?coin=<id>` |
| best bid and ask | none | `buy` and `sell` in `GET /api/v1/ticker` or `GET /api/v1/tickers` |
| trades | none | `GET /api/v1/orders?coin=<id>`, the latest 100 trades |
| ticker | none | `GET /api/v1/ticker`, `GET /api/v1/tickers` |
| mark, index, funding | none | none, BTCBOX lists no derivative |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty because no WebSocket is documented, and the probed column says what the REST book offers on the same axis, marked REST.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | no WebSocket, S1 | no socket URL completes a handshake, section 1 |
| subscribe frame shape | no WebSocket | REST: one GET per coin, `coin` is the lower case base |
| unknown symbol expectation | no WebSocket. REST error 102 "The coin does not exist", S1 | REST: HTTP 200 with `{"result":false,"code":"102"}` for `coin=nope`, `coin=ETH` and `coin=eth_jpy`, P5 |
| chunk unit and budget | no WebSocket | REST: one coin per call, and `tickers` carries the touch of all 7 markets in one call, P1 |
| keepalive mechanism | no WebSocket | not applicable |
| connection lifetime and maintenance notice | no WebSocket | not applicable. Terms Article 21 lets BTCBOX suspend the service, see [`fees.md`](./fees.md) section 7 |
| handshake and operation rate limits | no WebSocket. Public HTTP calls have no stated limit, S1 | REST: ten back to back `tickers` calls all answered 200, in both runs, P5 |
| public market data authentication | none | none |
| message parse and routing | no WebSocket | REST: the reply carries no symbol, so the caller routes by the `coin` it asked for |
| subscribe acknowledgement shape | no WebSocket | not applicable |
| symbol identifier format | no WebSocket | REST: `coin` takes `btc`, CCXT `market.id` is `btc`, and the `tickers` key is `BTC_JPY`, P1 |
| number representation | no WebSocket | REST: prices and sizes are JSON numbers, prices are integers on the four order book markets, P3 |
| timestamp representation | no WebSocket | REST: the `depth` and `ticker` replies carry no timestamp, P3 |
| size unit | no WebSocket | REST: base coin, CCXT `contractSize` is undefined on these spot markets, P1 |
| sequence semantics | no WebSocket | REST: no sequence or update id in any reply, P3 |
| idle repeat behaviour | no WebSocket | REST: the BTC touch did not change in 60 one second polls in either of two runs, and the whole BTC `depth` body changed on 10 of 59 intervals in the first run and on none in the rerun, P4 |

## 4. The book channel in detail

There is no book channel.
The only book is the REST `depth` reply, whose details are in [`rest.md`](./rest.md) section 5.
In the terms of this section it behaves as follows.

- Snapshot on subscribe: every reply is a whole snapshot, with no delta form, P3.
- Sequence and gap rule: none exists, since no reply carries an id, P3.
- Checksum: none, S1 and P3.
- Level order on the wire: asks descending, worst first and best last, and bids descending, best first, on BTC, BCH, LTC and ETH, P3.
- Level order in the documentation: asks high to low and bids low to high, S1, S2, so the wire agrees on asks and contradicts it on bids.
- Size unit: base coin, for example `[437604, 0.1194]` is 0.1194 ETH at 437,604 JPY, P3.
- One-sided and empty books: none seen on the four order book markets, P3.
- Disabled markets: `DOGE_JPY`, `DOT_JPY` and `TRX_JPY` return one bid and one ask at the same price, a locked book, because their order book is disabled and the reply is the dealer desk's quote, P3 and [`rest.md`](./rest.md) section 2.
- Idle repeats: a poll returns the same body when nothing changed, and the BTC touch held for 60 s in both runs, P4.
- Unknown, closed and wrong symbols: HTTP 200 with code 102, P5.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | no WebSocket | not applicable |
| silence the server tolerates | no WebSocket | not applicable |
| forced disconnect | no WebSocket | not applicable |
| maintenance notice | no WebSocket | not applicable |
| compression | no WebSocket | P7 offered no deflate, `perMessageDeflate` false, and no handshake completed |
| handshake | no WebSocket | six upgrade requests per run refused in 430 to 535 ms, section 1 |
| subscription limits | no WebSocket | not applicable |
| throughput | no WebSocket | not applicable |

## 6. Captured frames

No socket frame exists.
The handshake refusals from the first P7 run, trimmed.

```json
{"tag":"handshake","url":"wss://www.btcbox.co.jp/","ms":522,"outcome":"refused","status":200,"server":"cloudflare","body":"<!doctype html> <html lang=\"en\"> <head> <meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\"/> <meta http-"}
```

```json
{"tag":"handshake","url":"wss://www.btcbox.co.jp/ws","ms":444,"outcome":"refused","status":500,"server":"cloudflare","body":""}
```

```json
{"tag":"dns","host":"ws.btcbox.co.jp","error":"ENOTFOUND"}
```

The REST `depth` reply for BTC, which is the whole book, from the first P3 run at 04:44 UTC.

```json
{"asks":[[14392335,0.01],[13838231,0.00137],[13793578,0.00262],[13707046,0.0019]],"bids":[[13706925,0.00155],[13701270,0.00101],[13695615,0.00286],[13021636,0.01]]}
```

## 7. Private channels

None.
Private data and order entry are HTTP POST calls signed with an API key: `balance`, `wallet`, `trade_list`, `trade_view`, `trade_cancel` and `trade_add`, S1, and CCXT lists the same six at `server/node_modules/ccxt/js/src/btcbox.js` lines 138 to 147.
They were not called.

## 8. Recommended feed shape

No feed is recommended.
The engine's book feed is a WebSocket subclass of `VenueFeed`, which opens every socket at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81, and BTCBOX has no socket to open.
A REST book poller would be a new feed type, and its book would carry no sequence and be only as fresh as the last poll.
BTCBOX would not justify one, because it lists no perpetual and every market is quoted in JPY, outside the engine's USD, USDC and USDT quote family, see [`fees.md`](./fees.md) section 3.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTCBOX API Documentation, English, dated 2020.06.11 | https://blog.btcbox.jp/en/archives/8762 | 2026-09-22 | BtcBox Co., Ltd., Japan | HTTP only API, public calls, error codes, book order, private calls, sections 1 to 4 and 7 |
| S2 | BTCBOX API ドキュメント, Japanese, dated 2023.04.14 | https://blog.btcbox.jp/archives/8759 | 2026-09-22 | BtcBox Co., Ltd., Japan | the same, with no WebSocket either, sections 1 and 4 |
| S3 | BTCBOX web client script | https://www.btcbox.co.jp/js/script.js?v=24.5 | 2026-09-22 | BtcBox Co., Ltd. | the trading page polls every 3,000 ms and names no socket URL |
| S4 | CCXT 4.5.68 `btcbox.js` | `server/node_modules/ccxt/js/src/btcbox.js` | 2026-09-22 | CCXT | `'pro': false` line 27, `'ws': false` line 118, private calls lines 138 to 147 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | symbol spelling and `contractSize`, section 3 |
| P3 | `rest-probe.mjs book` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | book semantics, sections 3, 4 and 6 |
| P4 | `rest-probe.mjs poll` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | idle behaviour, sections 3 and 4 |
| P5 | `rest-probe.mjs errors` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | unknown symbols and the burst, sections 3 and 4 |
| P7 | `ws-probe.mjs` | [`ws-probe.mjs`](../../../scripts/probes/venues/btcbox/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | DNS, handshake refusals, CCXT Pro absence, sections 1, 5 and 6 |
