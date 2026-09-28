# BiKing WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The survey is dated 2026-09-22, and the host clock read 2026-09-24 when these pages were read and probed.

BiKing documents no public WebSocket.
No API documentation exists in its help center, and CCXT has no class for it, see [`fees.md`](./fees.md) section 8.
This profile records what was checked and what failed, and every axis a feed would need is Not verified.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | none published | `wss://www.bikingex.com/websocket` and `wss://www.bikingex.com/ws` both answered the upgrade with HTTP 200 and the website HTML in 543 to 546 ms, so no socket lives there, P1 |
| simulated futures | `wss://simulate.m3f2id8.shop/websocket`, the `moni_swap` key of the site config, S1 | not probed, it is a paper trading venue |

The futures web app builds its socket URL at run time.
Its bundle sets `wsUrl:""` and a base of `window.location.origin`, S2, and it calls `contract/api/v2/public/url-info` for the URLs it uses.
That reply is encrypted, see [`rest.md`](./rest.md) section 2, so the live socket URL could not be read without decrypting it.
This research did not decrypt it, because a deliberately encrypted payload is not a public API.

## 2. Channel matrix for public market data

Not verified.
The spot chart code in the futures bundle names a stream `spot/candle-1m:btc-usdt`, S2, which suggests channel names of the form `<market>/<type>:<symbol>`.
No book, best bid and ask, trade, ticker, mark, index or funding channel is documented.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | Not verified, no socket found |
| subscribe frame shape | Not publicly specified | Not verified |
| unknown symbol expectation | Not publicly specified | Not verified |
| chunk unit and budget | Not publicly specified | Not verified |
| keepalive mechanism | Not publicly specified | the web client records `pingT` and `pongT` on the socket, S2, so it runs a ping and pong of some shape. Not verified on the wire |
| connection lifetime and maintenance notice | Not publicly specified | Not verified |
| handshake and operation rate limits | Not publicly specified | Not verified |
| public market data authentication | Not publicly specified | Not verified |
| message parse and routing | Not publicly specified | Not verified |
| subscribe acknowledgement shape | Not publicly specified | Not verified |
| symbol identifier format | Not publicly specified | the help center writes `BTCUSDT`, S3, and the chart stream writes `btc-usdt`, S2. Not verified on the wire |
| number representation | Not publicly specified | Not verified |
| timestamp representation | Not publicly specified | Not verified |
| size unit | the BTCUSDT example sizes one contract at 0.001 BTC, S3 | Not verified |
| sequence semantics | Not publicly specified | Not verified |
| idle repeat behaviour | Not publicly specified | Not verified |

## 4. The book channel in detail

Not verified.
No book channel is documented, and no socket was reached.

## 5. Session

Not verified.
Permessage deflate could not be tested, because no upgrade succeeded.

## 6. Captured frames from the probe

No frame was captured.
The probe printed these lines on 2026-09-24, P1.

```json
{"tag":"refused","url":"wss://www.bikingex.com/websocket","status":200,"ms":543}
```

```json
{"tag":"refused","url":"wss://www.bikingex.com/ws","status":200,"ms":545}
```

Each was followed by a close with code 1006 and 0 frames.

## 7. Private channels

None documented.

## 8. Recommended feed shape

None.
No feed can be written against an undocumented socket whose URL is only handed out in an encrypted reply.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Site config `https://biking-pod.oss-accelerate.aliyuncs.com/biking/domain.json` | 2026-09-24 |
| S2 | Futures web bundle `https://biking-index.oss-accelerate.aliyuncs.com/biking-index/swaps/assets/js/app.2d502930.js` | 2026-09-24 |
| S3 | "Perpetual Futures Product Details", `https://biking.bkexchange.news/hc/en-us/articles/11063882487825`, read through the Zendesk API at `https://biking.zendesk.com/api/v2/help_center/en-us/articles/11063882487825.json` | 2026-09-24 |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/biking/ws-probe.mjs), run 2026-09-24 | 2026-09-24 |
