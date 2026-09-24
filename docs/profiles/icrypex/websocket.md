# Icrypex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:42 to 05:04 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public WebSocket of ICRYPEX (www.icrypex.com), which has no CCXT class, for its one perpetual family, the 53 USDT pairs spelled `<BASE>USDT/P`.
The documented protocol is S1, which describes spot only, and the web app bundles S2 and S3 show the same channels used for the `/P` pairs.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/icrypex/ws-probe.mjs), and where the documentation and the wire disagree, both are written.
All access results come from the Canadian VPN exit named above.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every market, spot and perpetual | `wss://istream.icrypex.com`, S1 | 101 upgrade through Cloudflare, open in 506 to 538 ms in the first pass and 492 to 546 ms in the second |
| same, path the web app uses | `wss://istream.icrypex.com/7` when the app's `global` flag is set, else `/1`, S2 | both paths opened, in 521 and 543 ms, then 492 and 546 ms, and served the same `BTCUSDT/P` and `BTCUSDT` books |

One socket carries spot and perpetual pairs together, and a perpetual is addressed by its catalog symbol with the `/P` suffix, lower case, as in `orderbook@btcusdt/p`.
`istream.icrypex.com` resolved to the three Cloudflare addresses 104.26.8.49, 104.26.9.49 and 172.67.74.162 on 2026-09-23.

## 2. Channel matrix for public market data

| channel | subscribe `c` | depth and speed | probed |
|---|---|---|---|
| `orderbook@<pair>` | `orderbook@btcusdt/p` | a snapshot of up to 50 levels per side on subscribe, then `obd` differences, "If there are multiple changes in 100 milliseconds, only one difference message is sent", S1 | snapshot then differences on 53 of 53 perpetuals, recommended |
| `orderbook-short@<pair>` | `orderbook-short@ethusdt/p` | best 5 rows, sent whole on each change in the top 5, as message type `orderbook`, S1 | 5 by 5 snapshots, 5 and 9 frames in 15 s on `ETHUSDT/P` in the two runs |
| `ticker@<pair>` | `ticker@btcusdt/p` | one pair's ticker "each second", S1 | a frame every 1,001 and 1,000 ms median in the two runs |
| `tickers` | `tickers` | every pair's ticker "every second", S1 | a frame every 500 ms median in both runs, 156 to 661 ms apart, 210 rows including the 53 `/P` rows |
| `trade@<pair>` | `trade@btcusdt/p` | the last trades once as `trades`, then each trade as `trade`, S1 | 1 `trades` and 11 `trade` frames in 70 s on `BTCUSDT/P`, in both runs |
| `tradingview@<pair>_<res>` | `tradingview@btcusdt_5` | the current candle on each trade, S1 | not probed |
| `market` | `market` | used by the web app, not documented, S2 | an array `a` of rows per asset with fields `s`, `mc`, `mcr`, `gp`, `gv` and `c`, a market cap feed, no mark or funding |
| `commodity-tickers` | `commodity-tickers` | used by the web app, not documented, S2 | an array `ct` of rows with fields `a`, `ba`, `qa`, `bp` and `ap`, a bid and ask per synthetic asset such as `OILXUSDT` |

No mark, index or funding channel exists in S1, in the message type list of the web app, S2, or on the wire.
The ticker fields are `ps`, `bs`, `qs`, `p`, `a`, `b`, `h`, `l`, `g`, `cp`, `cq` and `v`, and none of them is a mark or a rate.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL for spot and perpetual, and the app's `/1` and `/7` paths serve the same books |
| subscribe frame shape | text `subscribe|{"c":"orderbook@btcusdt","s":true}`, one channel per frame, S1 | as documented. The pair part is case insensitive: `orderbook@BTCUSDT/P` delivered the same book |
| unknown symbol expectation | Not publicly specified | `orderbook@nopeusdt/p` and `orderbook@btcusdt%2fp` were acknowledged with `"s":true` and sent nothing, and an empty channel `""` was acknowledged too |
| chunk unit and budget | Not publicly specified | 53 subscribe frames sent in one burst on one socket were all acknowledged and all 53 snapshots arrived 167 to 632 ms after the first frame, and 163 to 609 ms in the second pass |
| keepalive mechanism | none documented | the server sent no protocol ping on any socket. A socket with no subscription and no client traffic closed with 1006 at 60.5 s in both passes. Client protocol pings got pongs in 161 to 175 ms, and kept a socket with no subscription open for 115 s |
| connection lifetime and maintenance notice | Not publicly specified. The app's message list has `system` and `logout-cmd` types, S2 | no forced close in 115 s on any socket that carried traffic, and no `system` frame seen |
| handshake and operation rate limits | Not publicly specified | five sockets at once opened without refusal |
| public market data authentication | "Authentication is not mandatory. Guest connections can receive public data.", S1 | none needed |
| message parse and routing | `type|json` text frames, S1 | as documented. Book frames route on `ps`, the upper case pair symbol with its `/P` |
| subscribe acknowledgement shape | `subscribe-response|{"c":"tickers","s":true}`, S1 | as documented. A repeated subscribe of a live channel came back with `"s":false` and the stream went on undisturbed |
| symbol identifier format | upper case pair, channel parameter lower case, S1 | `BTCUSDT/P`, identical to `symbol` in `/v1/exchange/info`, `/v1/tickers` and `/v1/orderbook` |
| number representation | price `p` and quantity `q` strings, S1 | strings for `p` and `q`, integers for `cs` and `t` |
| timestamp representation | none in book frames, S1 | none in `orderbook` or `obd`. Trades carry `d` in Unix seconds |
| size unit | base asset quantity, S1 | base asset, the socket and the REST book agree to the last digit, section 4 |
| sequence semantics | `cs` "is always incremental and increases one by one", a missing number means resubscribe, S1 | 1 gap in 2,569 differences on 53 perpetuals in the first batch run, 0 in 2,529 in the second, and 0 in the 529 and 474 differences of the two book runs, section 4 |
| idle repeat behaviour | not documented | no empty and no repeated difference. The quietest pair went 14.1 s without a frame, and 13.8 s in the second pass |

## 4. The book channel in detail

`orderbook@<pair>` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each pair is type `orderbook` with `ps`, `cs`, `a` and `b`.
S1 says it "is sent only one time right after client subscription".
The first snapshot arrived 157 to 309 ms after the subscribe frames in the first book run, and 163 to 318 ms in the second.
A client can ask for a new snapshot on a live socket with `channel-data-request|{"c":"orderbook@ethusdt/p"}`, which is what the web app sends on a gap, S2.
On the wire that request produced a second `ETHUSDT/P` snapshot in both book runs, and the chain continued from the new `cs`.

### Difference semantics

An `obd` frame carries `ps`, `cs` and changed rows in `a` and `b`, each row with `p`, `q` and a type `t`, S1.

| `t` | meaning, S1 | rows on five perpetuals, first and second book run | mismatches against the local book |
|---|---|---|---|
| 1 | inserted, no row at that price before | 375 and 330 | 0 inserts at an existing price |
| 2 | updated, new quantity at an existing price | 48 and 48 | 0 updates at a missing price |
| 3 | removed | 367 and 314 | 0 removes at a missing price in either book run, 1 in the first batch run and 0 in the second |

A removal row carries either `"0"` or the row's last quantity, as in `{"q":"72.86179671","p":"2791.3","t":3}`.
In the second book run 103 of the 314 perpetual removals carried `"0"` and 211 repeated the last quantity, and in the second batch run 298 of 1,585 carried `"0"` and 1,287 the last quantity.
No insert or update row carried a zero quantity.
A feed must therefore switch on `t` and never on the quantity.

### Sequence and gap rule

```text
orderbook frame           replace the book, last = cs
obd, cs = last + 1        apply rows by t, last = cs
obd, cs ≠ last + 1        gap: send channel-data-request for the channel, or resubscribe, or terminate the socket (the engine's resync)
```

The first difference after each snapshot had `cs` equal to the snapshot's `cs` plus one on every pair.
The two book runs saw 0 gaps and 0 repeats in 529 and 474 differences on six pairs over 70 s each.
The first batch run saw 1 gap and 1 removal at a missing price in 2,569 differences on 53 pairs over 60 s, and that run did not yet record which pair.
The second batch run, which records it, saw 0 gaps in 2,529 differences.
The documented delay between differences is 100 ms, yet the shortest gap between two differences of one pair was 0 ms on two pairs in each book run and 9 to 53 ms on the others, which is network batching or a looser server rule.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 6 of 6 pairs in both book runs and 53 of 53 in both batch runs | best first, ascending, same counts |
| difference, several rows on one side | descending in every frame seen | ascending in every frame seen |
| REST `/v1/orderbook` | descending, on 5 of 5 pairs | ascending |

The difference rows arrived sorted in every run, but S1 does not promise it, so a feed applies them by price.

### Level window

The server keeps 50 rows per side.
No snapshot held more than 50 rows on a side, and a book maintained from the snapshot and every difference never exceeded 50 on any of the 53 perpetuals.
So a row that leaves the window arrives as a removal with `t` 3, and a row that enters it arrives as an insert with `t` 1.
The `BTCUSDT/P` difference that removed a bid at 86,762.1 and inserted one at 57,670.8 in the same frame looks like such a refill from below the window, which is an inference from the prices.
Thin pairs simply hold fewer rows: `XRPUSDT/P` held 36 bids and 27 asks at subscribe, then 38 and 30, and `LDOUSDT/P` 32 and 22, then 34 and 25.

### Size unit

`q` is a base asset quantity, the same unit as spot and as the REST book.
After 70 s of differences the maintained top 20 on both sides equalled the REST `/v1/orderbook` top 20 in price and quantity on 6 of 6 pairs, 240 of 240 rows, in both book runs.
The touch of `BTCUSDT/P`, for example, read bid 87,130.1 for 1.50030605 BTC on both.
There is no CCXT `contractSize` to compare, since no CCXT class exists, and a class written for this venue would set it to 1.

### One-sided and empty books

No perpetual had an empty side at the end of either batch run, and none held fewer than 20 rows on a side.
An unknown pair is acknowledged and silent, so a feed cannot tell a typo from a quiet market by the reply.

### Idle repeats

The server sent no empty and no repeated difference.
Across 53 perpetuals the median pair sent 37 differences in 60 s, `BTCUSDT/P` sent 151, and `AMDXUSDT/P` sent 10 with a longest silence of 14.1 s.
In the second batch run the median was 40, `BTCUSDT/P` sent 110, and `SUSDT/P` had the longest silence, 13.8 s.
In the second book run `BTCUSDT/P` itself went 8.6 s without a frame.

### Unknown and malformed input

| sent | answer |
|---|---|
| `subscribe|{"c":"orderbook@nopeusdt/p","s":true}` | `subscribe-response` with `"s":true`, then nothing |
| `subscribe|{"c":"","s":true}` | `subscribe-response` with `"c":""`, then nothing |
| `hello` | nothing, socket stays open |
| `subscribe|notjson` | nothing, socket stays open |

## 5. Session

| item | documented | probed |
|---|---|---|
| server ping | none | none on any socket, protocol or application |
| client ping | none | a protocol ping frame every 20 s got a pong in 161 to 175 ms |
| idle close | Not publicly specified | a socket that subscribed nothing and sent nothing closed with 1006, no close frame, at 60.5 s in both passes |
| sockets that carry data | Not publicly specified | a `tickers` socket and a quiet book socket that never sent a byte after subscribing stayed open for 115 s, in both passes |
| client pings only | Not publicly specified | a socket with no subscription that sent a protocol ping every 20 s stayed open for 115 s |
| forced disconnects | Not publicly specified | none seen in 115 s |
| maintenance notice | Not publicly specified | the web app handles a `system` type and a `logout-cmd` type, S2, and neither was seen |
| compression | not documented | a client offering permessage-deflate got no `sec-websocket-extensions` header back, so frames are plain text |
| reconnect advice | "clear your application orderbook rows when disconnected or reconnected", S1 | the web app clears its book on every connect, S2 |

So the 60 s close falls on a socket with no traffic in either direction, and a client ping or a server data frame each keeps a socket alive.

## 6. Captured frames

Subscribe acknowledgement, and the answer to a repeated subscribe of a live channel.

```text
subscribe-response|{"c":"orderbook@btcusdt/p","s":true}
subscribe-response|{"c":"orderbook@btcusdt/p","s":false}
```

Snapshot, trimmed to two rows a side.

```text
orderbook|{"ps":"BTCUSDT/P","cs":957741,"a":[{"q":"1.81882158","p":"87107"},{"q":"0.68289062","p":"87130.4"}],"b":[{"q":"0.55150499","p":"87097"},{"q":"0.66709271","p":"87075.3"}]}
```

Differences: a window refill, and an update.

```text
obd|{"ps":"BTCUSDT/P","cs":957742,"a":[],"b":[{"q":"0.70955501","p":"86762.1","t":3},{"q":"0.0017712","p":"57670.8","t":1}]}
obd|{"ps":"BTCUSDT/P","cs":957746,"a":[{"q":"1.79023467","p":"87107","t":2}],"b":[]}
```

Ticker of a perpetual.

```text
ticker|{"ps":"BTCUSDT/P","bs":"BTC","qs":"USDT","p":"87130.4","a":"87107","b":"87097","h":"87280.3","l":"85059.3","g":"86103.5","cp":"1.9","cq":"1626.6","v":"326.62215424"}
```

Trade.

```text
trade|{"ps":"BTCUSDT/P","d":1790138784,"q":"0.02858691","p":"87107","s":0,"m":0}
```

Keepalive: no application frame exists, and the protocol pong is an empty control frame.
Errors: no error frame exists, section 4.

The snapshot is trimmed from 50 rows a side, and the ticker's `a` and `b` equal that snapshot's touch, 87,107 and 87,097.

## 7. Private channels

Named for a future execution stage, from S1 and S2, not probed.

- Login with an API key is an `api-login` message with fields `pk`, `s`, `ts` and `n`, answered by `api-auth|{"v":true}`, S1.
- The web app logs in with a `login` message whose fields are `t`, the access token, and `b`, a browser id, S2.
- Private message types are `user-trade`, `order-trigger`, `wallet-update`, `WalletBalanceChange` and `position`, and the app subscribes `FuturePosition`, S2.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only useful if the anchor and catalog blockers in [`rest.md`](./rest.md) section 8 are ever solved.

| item | recommendation | reason |
|---|---|---|
| URL plan | one URL, `wss://istream.icrypex.com` | spot and perpetual share it |
| channel | `orderbook@<symbol lower case>`, as in `orderbook@btcusdt/p` | snapshot on subscribe, a strict `cs` chain, 50 rows per side covers the engine's 20 |
| markets per connection | all 53 on one socket | 53 subscriptions ran at 44 and 45 frames per second with every snapshot delivered, and no cap is published |
| subscribe frames | one text frame per pair, `subscribe|{"c":"orderbook@btcusdt/p","s":true}` | one channel per frame is the only documented shape |
| keepalive | a protocol ping every 20 s | the server never pings, a silent socket dies at 60 s, and client pings alone kept a socket open for 115 s |
| `maxSilenceMs` | 45,000 with the pong counted as traffic | the quietest pair went 14.1 s without a book frame, and the server closes a socket after 60 s without traffic |
| routing | `ps` is the `rawMarketId` | it equals the catalog `symbol` |
| snapshot | type `orderbook`: `resetBook`, store `cs` | documented replace semantics |
| difference | apply only when `cs === last + 1`, by `t`: 1 and 2 set the row, 3 deletes it | a removal row carries the old quantity, so the quantity cannot mark a delete |
| resync | `cs !== last + 1`, or a difference before any snapshot: the engine's `resync`, or the cheaper `channel-data-request|{"c":"orderbook@btcusdt/p"}` that the web app uses | both paths were seen to restore the chain |
| unserved pair | log a pair with no snapshot 5 s after its acknowledgement | unknown pairs are acknowledged and silent |
| receive time | stamp on arrival | no book frame carries a time |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Icrypex API Documentation, WebSockets | https://github.com/icrypex-glb/apidoc/blob/main/websockets.md | 2026-09-22 | ICRYPEX, global | URL, frame format, channels, change sets, row types, short book, trades, login, sections 1 to 7 |
| S2 | web app main bundle, socket client and message types | https://www.icrypex.com/main.345fafe890bea77b.js | 2026-09-22 | www.icrypex.com | `/1` and `/7` paths, `channel-data-request` on a gap, `market`, `commodity-tickers`, `system`, private types, sections 1, 2, 5 and 7 |
| S3 | web app trade page component | https://www.icrypex.com/7813.7909dbbb3a8d40f6.js | 2026-09-22 | www.icrypex.com | `orderbook@` and `trade@` subscriptions on the selected pair, section 2 |
| P1 | `ws-probe.mjs` exploration and `book` at 04:42 and 04:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/icrypex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `ws-probe.mjs batch` at 04:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/icrypex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 3 and 4 |
| P3 | `ws-probe.mjs silence` and `deflate` at 04:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/icrypex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 3 and 5 |
| P4 | `ws-probe.mjs book`, `batch`, `silence` and `deflate`, second pass at 04:59 to 05:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/icrypex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | second readings in sections 1 to 5, removal quantities, client ping only socket |
