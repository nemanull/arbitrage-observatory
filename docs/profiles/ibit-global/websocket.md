# IBIT Global WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 07:08 UTC by the host clock, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

IBIT Global publishes no WebSocket documentation.
The socket hosts below were read from the JavaScript bundle of `https://www.ibitglobal.ai/zh-CN`, fetched on 2026-09-24.
The web app opens every one of them with a `ts` and a `sign` query parameter that it computes in the browser.
[`ws-probe.mjs`](../../../scripts/probes/venues/ibit-global/ws-probe.mjs) connected to each host without a sign, once with no query and once with only `ts`, and every socket was refused.
The probe never computed the sign, because that would reproduce a private client scheme and is not a public API.

## 1. Endpoints

| role in the web app | URL | what the app subscribes | probed, unsigned |
|---|---|---|---|
| futures market data | `wss://prod-ibit-market-server-p-co-p-group.aka-line-a.com/ws/quotation` | `gzip_market_all_mark_price`, `gzip_market_all_index_price`, `gzip_market_all_latest_price`, `gzip_market_all_24h_ticker`, `gzip_market_all_position_fee_rate`, `gzip_market_abnormal` | upgrade in 480 to 570 ms, then `{"data":{"connect":"failed"},"path":"quotation","topic":"connect"}` and close 1006 |
| spot market data | `wss://prod-ibit-spot-market-server-p-co-p-group.aka-line-a.com/ws/quotation` | `market_all_24h_ticker`, `market_all_latest_price` | upgrade in 243 to 375 ms, then the same `connect` `failed` frame and close 1006 |
| futures account | `wss://prod-ibit-futures-ws-p-group.aka-line-a.com/ws/futures` | `account`, `currentPositions`, `openOrders` and others, with a login token | code `0002`, "Cannot parse null string", then with `ts` only "`sign` is null", and close 1006 |
| spot account | `wss://prod-ibit-spot-ws-p-group.aka-line-a.com/ws/spot` | account channels | code `0003`, "ts or sign is empty", close 1006 |
| message hub | `wss://prod-ibit-msghub-p-wsserver-pc.aka-line-a.com/ws` | notifications | HTTP 401 on the upgrade, body ``{"err":"authorize error: `ibit-platform` is required"}`` |

All five hosts resolve through Akamai, `aka-line-a.com.edgesuite.net`, to `207.194.175.128` and `207.194.175.131` on 2026-09-24.
One socket carries one product family in the web app, futures and spot on separate hosts.
The web app sets `binaryType` to `arraybuffer` and passes binary frames through an `inflate(data, {to: "string"})` call before parsing them, so market frames are compressed inside the frame.
That is read from the bundle, not probed, since no unsigned socket delivered market data.

## 2. Channel matrix for public market data

No public channel exists.
The channels the web app names on the futures market socket are all-market mark, index, last price, 24 h ticker and funding fee rate streams, listed in section 1.
A per symbol book channel is used by the futures trading page, but its name and depth were not traced in the bundle and are Not verified.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
There is no documentation, so the documented column is Not publicly specified on every row.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | the bundle uses one host for futures market data and another for spot |
| subscribe frame shape | Not publicly specified | the bundle sends `{"event":"sub","params":{"channels":[...]}}`. No unsigned socket accepted one |
| unknown symbol expectation | Not publicly specified | Not verified |
| chunk unit and budget | Not publicly specified | Not verified |
| keepalive mechanism | Not publicly specified | the bundle sends `{"event":"ping"}` every 30 s. Not verified on the wire |
| connection lifetime and maintenance notice | Not publicly specified | Not verified |
| handshake and operation rate limits | Not publicly specified | ten unsigned opens in about 4 s drew no rate refusal |
| public market data authentication | Not publicly specified | a `ts` and `sign` query is required even on the market data hosts, section 1 |
| message parse and routing | Not publicly specified | refusals carry `path`, `topic` and `data` keys |
| subscribe acknowledgement shape | Not publicly specified | Not verified |
| symbol identifier format | Not publicly specified | the web app's futures URLs spell `ETHUSDT` and `BTCUSDT`, from CoinMarketCap's `marketUrl`, see [`rest.md`](./rest.md) section 2 |
| number representation | Not publicly specified | Not verified |
| timestamp representation | Not publicly specified | the `ts` query is Unix ms in the bundle |
| size unit | Not publicly specified | Not verified |
| sequence semantics | Not publicly specified | Not verified |
| idle repeat behaviour | Not publicly specified | Not verified |

## 4. The book channel in detail

Not verified.
No socket delivered a book to an unsigned client, so snapshot, delta, sequence, checksum, level order, size unit and idle behaviour are all unknown.

## 5. Session

- Keepalive: the web app pings with `{"event":"ping"}` every 30 s, from the bundle.
- Silence tolerance, forced disconnects and maintenance notices: Not verified.
- Compression: the upgrade negotiated no extension with `perMessageDeflate` false, `extensions` was empty on every opened socket.
  The web app's market channels are named `gzip_*` and are inflated in the browser, section 1.
- Handshake: the refusal comes as a text frame after the upgrade on four hosts, and as HTTP 401 on the message hub.

## 6. Captured frames

Futures market host, no query and `ts` only, identical.

```json
{"data":{"connect":"failed"},"path":"quotation","topic":"connect"}
```

Futures account host, no query.

```json
{"path":"futures","topic":"connect","data":{"reason":"Unknown Exception：Cannot parse null string","code":"0002","connect":"failed"}}
```

Futures account host, `ts` only.

```json
{"path":"futures","topic":"connect","data":{"reason":"Unknown Exception：Cannot invoke \"String.equalsIgnoreCase(String)\" because \"sign\" is null","code":"0002","connect":"failed"}}
```

Spot account host.

```json
{"path":"spot","topic":"connect","data":{"reason":"ts or sign is empty","code":"0003","connect":"failed"}}
```

Each refusal on the account hosts was followed by `{"reason":"...","event":"disconnect"}` and a close with code 1006.

## 7. Private channels

The futures account socket subscribes `account`, `currentPositions`, `followPositions`, `leadPositions`, `openOrders`, `planCloseOrders`, `planOpenOrders` and `unsettleProfit` with a login token, from the bundle.
The API key page offers only "Allow reading" and "Allow Spot Trading", so a futures execution stage has no documented API path, see [`fees.md`](./fees.md) section 1.

## 8. Recommended feed shape

None.
No public socket exists, and the market hosts refuse any client that does not carry the web app's signature.
A feed would need a published API first.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | IBIT Global web app JavaScript bundle | `https://www.ibitglobal.ai/_next/static/chunks/` | 2026-09-24 | IBIT Limited | socket hosts, subscribe frame, ping, `ts` and `sign` query, inflate call, sections 1, 3, 5 and 7 |
| S2 | CoinMarketCap data API, market pairs for `ibit-global` | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=ibit-global&category=perpetual&start=1&limit=200 | 2026-09-24 | third party | futures page symbol spelling, section 3 |
| P1 | `ws-probe.mjs` at 07:08 UTC, modes plain and ts | [`ws-probe.mjs`](../../../scripts/probes/venues/ibit-global/ws-probe.mjs) | 2026-09-24 | this host, Canadian VPN exit | every probed value, sections 1 to 6 |
