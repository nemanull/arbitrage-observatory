# BTCC WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, which was 2026-09-23 04:23 to 04:57 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=SEA`).

This profile covers the market data sockets of BTCC for its perpetual futures.
BTCC has no public market data API.
Its only market data documentation is an OpenAPI quote socket document dated November 2023, S1, which reached the public as a PDF attached to CCXT issue 22623, and whose login needs an account number and a key registered on the platform.
The help centre article that the API key page links as the current guide returned 404 to an anonymous reader, see [`rest.md`](./rest.md) section 1.
The public web page streams the same quote protocol from another host after an anonymous login with a constant key in its bundle, S3.
Everything under "probed" below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/btcc/ws-probe.mjs) on that web socket, which is undocumented and is described here only to record what exists.

## 1. Endpoints

| use | URL | documented | probed |
|---|---|---|---|
| OpenAPI quote socket | `wss://kapi1.btloginc.com:9082` | yes, S1 | the TLS certificate is for `*.btcc.com` and `btcc.com`, so a client that checks the host name refuses it with `ERR_TLS_CERT_ALTNAME_INVALID`. With checks off, the documented root path answers the upgrade with 404 |
| OpenAPI host at the web path | `wss://kapi1.btloginc.com:9082/quot/reqloginNew` | no | with certificate checks off it upgrades with 101 from nginx in 591 to 625 ms, and sends nothing in 12 s without a login |
| web page quote socket | `wss://wkd2.btloginc.com/quot/reqloginNew` | no, S3 | upgrades with 101 in 299 to 410 ms, valid certificate |
| web page trade socket | `wss://waccess2.btloginc.com/v1/ws/login`, or `dwaccess2` for the demo account | no, S3 | not probed, it logs in with a user token |
| web page spot price socket | `wss://spotprice2.btcccdn.com` | no, S3 | not probed |

One quote socket carries every family.
The dictionary it sends lists USDT, USDC, coin-M and TradFi contracts together, and a subscription names contracts by numeric id regardless of family.
`wkd2.btloginc.com` resolved to one address behind a CDN on 2026-09-23 UTC, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

The quote protocol has request actions rather than channels, S1.

| request | reply action | content | probed |
|---|---|---|---|
| login `{name, clienttype, key}` | `Login`, then `Dict`, then `All Products` | login result, the product dictionary, and trading hours | `Login` 196 to 238 ms after the login frame, `Dict` of 384 contracts in 115,675 bytes, `All Products` of 682 to 749 schedule rows for 113 to 120 names in 59,808 to 65,725 bytes |
| `ReqRealPanel` with a list of zones | one `Panel` per zone | last, bid, ask, open, high, low and change per contract | five panels, 11 + 345 + 6 + 21 + 1 contracts |
| `ReqSubcri` with `symbols` | `tickinfo` | best ask, best bid, last price, last volume, second resolution time, per listed contract | 286 to 312 frames in 45 s for three contracts |
| `ReqSubcri` with `deep` | `tickinfo_deep` | 7 levels per side for the one contract named in `deep` | 163 or 164 frames in 45 s in each of four runs |
| `ReqSubcri` | `dealticksnap` | the last 20 trades of the `deep` contract, once | one frame per subscribe |
| `ReqKline` | `Kline` | candles, intervals of 1 m to 1 month | not probed |
| `KeepLive` | `keeplive` | heartbeat | 200 to 252 ms round trip |

No mark, index or funding action exists in S1, and none appeared on the wire.
The `Panel` rows carry `BuyPrice` and `SellPrice`, and `BuyPrice` was the higher of the two in both logged samples, so it is the ask.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Documented" is S1, the November 2023 OpenAPI document, and "probed" is the web socket.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every product | one socket carried USDT, USDC, coin-M and TradFi contracts |
| subscribe frame shape | `{"action": "ReqSubcri", "symbols": ["3223607", …], "deep": "3223607"}` | as documented. The web page also sends `symbolsfrequency` and `interval`, S3 |
| unknown symbol expectation | Not publicly specified | `deep: "999"` got one empty text frame and `dealticksnap` with `"Y":999,"ItemCount":0,"Items":null`, and no error |
| chunk unit and budget | Not publicly specified | three contracts in `symbols` and one in `deep`. A new `ReqSubcri` replaces the previous `deep` |
| keepalive mechanism | "Heartbeat API calls, sent once every 20 seconds, are required", `{"action": "KeepLive"}` answered by `{"action": "keeplive"}` | the server sends a protocol ping every 10.0 s. A socket that answers those pings but sends no `KeepLive` closes at 30.5 to 30.9 s with 1006, subscribed or not. The web page sends `KeepLive` every 10 s, S3 |
| connection lifetime and maintenance notice | Not publicly specified | none seen in 74 s with `KeepLive` every 15 s, in each of four runs |
| handshake and operation rate limits | Not publicly specified | none met |
| public market data authentication | a login with "The account number field returned after successful login to the trading server" and a "Key registered on the platform" | the web page logs in with a random `name` and a constant key from its bundle, and the server accepts it. Before a login the socket sent 0 frames in 8 s |
| message parse and routing | top level `action`, then `data` | as documented. Book frames route on `data[i].Y`, the numeric contract id as a string |
| subscribe acknowledgement shape | Not publicly specified | the first `ReqSubcri` got no acknowledgement, only data. A later `ReqSubcri` got one empty text frame |
| symbol identifier format | `SecID`, a number, with `ShortName` such as `BCH/USDTW` | `SecID` 3289142 for `BTC/USDT.100x`. The funding call spells it `BTCUSDT`, see [`rest.md`](./rest.md) section 3 |
| number representation | strings in book arrays | prices and sizes are decimal strings, trades in `dealticksnap` are JSON numbers |
| timestamp representation | `T` "lastTime" | `T` in whole Unix seconds. It was 0.1 to 1.1 s behind the arrival clock in the second to fourth runs |
| size unit | `U` "volumeAsk" and `M` "volumeBid" | BTC/USDT touch sizes such as `6.59` and `2.48`, CHZ/USDT sizes such as `402000.00`, which read as coins. Not verified against a contract size, see section 4 |
| sequence semantics | none documented | no sequence field. Every `tickinfo_deep` is a whole 7 level book |
| idle repeat behaviour | not documented | 23 to 29 of 163 or 164 book frames per run were identical to the frame before |

## 4. The book channel in detail

`tickinfo_deep` is the only depth source, and every row below is about it.

### Snapshot on subscribe

The first `tickinfo_deep` arrived 178 to 190 ms after the `ReqSubcri` frame in four runs.
Every frame is a whole book of 7 bids and 7 asks, on every frame of four runs of 163 or 164 frames, so there are no deltas to apply.

### Delta semantics

None.
A feed would replace the book on every frame.

### Sequence and gap rule

There is no sequence number, so a gap cannot be detected.
Frames came 150 to 377 ms apart in the second to fourth runs, medians 273 to 274 ms, and 4 to 1,007 ms apart in the first run, median 278 ms.

### Checksum

None documented and none on the wire.

### Level order on the wire

| side | order | frames |
|---|---|---|
| bids `B`, sizes `M`, running totals `I` | best first, strictly descending | every frame of four runs |
| asks `A`, sizes `U`, running totals `L` | best first, strictly ascending | every frame of four runs |

`R` and `E` are documented as "volAskTotalPer" and "volBidTotalPer", and their meaning beyond the name is Not publicly specified.
No frame was crossed.

### Level window

7 levels per side, fewer than the engine's 20, at [`../../../server/src/engine/Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61.
The document's example also has 7.

### Size unit against CCXT `contractSize`

CCXT has no BTCC class, so there is no `contractSize` to compare.
The November 2023 trade document gives each product a `contract_size` and a minimum of 0.01 lots, S2, and the help centre prices funding on "a position quantity of 1 BTC", so one lot of a crypto perpetual reads as one coin.
That is an inference, because the product list that carries `contract_size` needs a login token.

### One-sided and empty books

None seen on BTC/USDT or CHZ/USDT.

### Idle repeats

A whole book repeated unchanged in 23 to 29 frames per run over four runs.
Each frame carries the same `T` second as its neighbours, so a repeat is indistinguishable from a fresh frame except by content.

### Unknown and closed symbols

| request | reply | then |
|---|---|---|
| `deep: "999"` | one empty text frame, and `dealticksnap` for `Y` 999 with 0 items | nothing more, the socket stays open |
| `deep: "20"`, as if it were a level count | one empty text frame, and `dealticksnap` for `Y` 20 with 0 items | `tickinfo` for the listed contract continues, no depth |
| text that is not JSON | nothing | the socket stays open |
| `{"action": "NoSuchAction"}` | nothing beyond the reply to the probe's periodic `KeepLive` | the socket stays open |

A closed contract was not available to probe.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `KeepLive` every 20 s, S1 | server protocol ping every 10.0 s, which `ws` answers. `keeplive` reply in 200 to 252 ms |
| silence the server tolerates | Not publicly specified | without `KeepLive` a socket closes at 30.5 to 30.9 s with 1006 and no close frame, in two runs, whether idle or receiving about five frames a second |
| forced disconnect | Not publicly specified | none in 74 s, four runs |
| maintenance notice | Not publicly specified | none seen. `All Products` carries trading hours for 113 to 120 names, 56 to 62 of them in the dictionary |
| compression | Not publicly specified | text JSON frames. An offer of permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 299 to 410 ms to open |
| subscription limits | one `deep` contract per request, S1 | a new `ReqSubcri` replaced the previous `deep`. So one socket carries the depth of one contract |
| throughput | | three contracts in `symbols` and one in `deep`: 147,869 to 152,306 bytes in 45 s |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Login, as the web page sends it, where `name` and `seq` are a random number chosen per socket and this one is an example.

```json
{"name": "482913377015", "clienttype": 1, "company": 1, "seq": "482913377015", "key": "dc8ea0d3-7fce-489c-b6fb-7aa0da48ea65"}
```

Login reply.

```json
{"code":0,"action":"Login","msg":"","uid":"","time":0,"data":{"Result":0,"DataSourceState":0,"LoginResult":0,"Reserve":0,"token":"","Seq":0,"Year":2026,"Month":9,"Day":23,"Time":1790138529}}
```

One dictionary entry, as S1 documents it with its comments removed.
On the wire `BTC/USDC.500x` had `SecID` 65 and `BTC/USDT.100x` had 3289142.

```json
{"SecID": 3158070, "ShortName": "BCH/USDTW", "Big": "10;11;12;", "Gb": " ", "Digit": 2, "Pips": 0, "Zone": 6, "Type": 8, "TimeType": 1, "CompanyType": 1, "CallOrPutFlag": 0, "New64CompanyType": 1, "XlsStartEndTimeRange": {"StartTime": 0, "EndTime": 1440}, "DlsStartEndTimeRange": {"StartTime": 0, "EndTime": 1440}}
```

Subscribe.

```json
{"action": "ReqSubcri", "symbols": ["3289142", "3616822", "3158068"], "deep": "3289142"}
```

Book, BTC/USDT.

```json
{"action":"tickinfo_deep","data":[{"Y":"3289142","A":["87091.76","87092.33","87092.54","87092.66","87093.05","87093.28","87093.43"],"B":["87091.26","87090.60","87090.41","87090.15","87090.00","87089.81","87089.35"],"U":["6.59","0.01","0.01","0.02","0.05","0.09","0.07"],"M":["2.48","0.01","0.03","0.09","0.11","0.01","0.01"],"T":1790138531,"V":"0.80","C":"87091.51","L":["6.59","6.60","6.61","6.63","6.68","6.77","6.84"],"I":["2.48","2.49","2.52","2.61","2.72","2.73","2.74"],"R":["0.01","0.01","0.01","0.01","0.01","0.01","0.01"],"E":["0.00","0.00","0.00","0.00","0.00","0.00","0.00"]}]}
```

Best bid and ask, as S1 documents it.
On the wire the same frame also carries `U`, `M`, `L`, `I`, `R` and `E` as `null`.

```json
{"action": "tickinfo", "data": [{"Y": "3159350", "A": ["27421.52"], "B": ["27421.02"], "T": 1693383923, "V": "1.34", "C": "27421.27"}]}
```

Panel row.

```json
{"CodeId":75,"YesterdayPrice":1407.35,"CurPrice":1372.8,"BuyPrice":1372.93,"SellPrice":1372.66,"OpenPrice":1408.47,"HighPrice":1408.97,"LowPrice":1362.1,"Change":-34.549927,"BidHighPrice":92439.67,"BidLowPrice":0,"AskHighPrice":0,"FlagBid":0,"FlagAsk":1,"FlagCur":1,"Flag":1,"Time":1790138529,"IsOpen":1}
```

Keepalive.

```json
{"action": "KeepLive"}
```

```json
{"action":"keeplive"}
```

Unknown contract.

```json
{"action":"dealticksnap","volumedigits":2,"data":[{"Y":999,"ItemCount":0,"Items":null}]}
```

## 7. Private channels

Named for a future execution stage, not probed.

- The November 2023 trade document is REST at `https://api1.btloginc.com:9081`, with `POST /v1/user/login`, `GET /v1/user/keepalive`, positions, orders and reports, every call carrying `token` and an md5 `sign` over the parameters and the secret key, S2.
  That port timed out from this host, see [`rest.md`](./rest.md) section 6.
- The web page's trade socket is `wss://waccess2.btloginc.com/v1/ws/login`, opened with `{"action": "ws_login_req", "token": …}` and kept with `{"action": "ws_heart_beat_req", "token": …}`, which expects `ws_heart_beat_rsp` within 10 s, S3.
- A user of CCXT issue 22623 wrote on 2025-12-02 that BTCC support told them futures API keys are read only, S4.

## 8. Recommended feed shape

No feed is recommended.
BTCC publishes no public market data socket, and the documented OpenAPI quote host fails a certificate check and answers its documented path with 404.
The socket that works is the web page's, reached with a key copied from the page, and nothing binds BTCC to keep it stable.

If BTCC later documents that socket for public use, these are the facts a feed would have to fit.

| item | fact | consequence |
|---|---|---|
| URL plan | one URL for every family | one plan |
| markets per connection | one contract per socket for depth, since each `ReqSubcri` names one `deep` | 346 sockets for the USDT perpetuals alone |
| depth | 7 levels per side, whole book per frame | below the engine's 20 levels |
| keepalive | `{"action": "KeepLive"}` every 10 s | a socket without it closes at about 30.5 s |
| `maxSilenceMs` | the book pushed at most 1,007 ms apart on BTC/USDT | the `keeplive` reply counts as traffic |
| resync | none possible | no sequence number, and every frame replaces the book |
| receive time | stamp on arrival | `T` has one second resolution |
| routing | `data[i].Y` to a `SecID`, mapped to a name through the `Dict` frame | the id is not the name the funding call takes |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTCC_EN - OpenAPI_quote_websocket, November 2023, attached to CCXT issue 22623 | https://github.com/ccxt/ccxt/files/15447211/BTCC_EN.-.OpenAPI_quote_websocket.docx.pdf | 2026-09-22 | BTCC, global | URL, login, actions, `tickinfo_deep` fields, keepalive, sections 1 to 5 |
| S2 | BTCC_EN - TradeOpenApi, November 2023, attached to CCXT issue 22623 | https://github.com/ccxt/ccxt/files/15447210/BTCC_EN.-.TradeOpenApi_Nov2023.pdf | 2026-09-22 | BTCC, global | trade host, signature, `contract_size`, sections 4 and 7 |
| S3 | BTCC web application bundle | `https://www.btcc.com/_next/static/chunks/pages/_app-f6c41f79fa0544b0.js` | 2026-09-22 | BTCC, global | web socket hosts, login frame, `KeepLive` every 10 s, `ReqSubcri` fields, trade socket frames, sections 1, 3 and 7 |
| S4 | CCXT issue 22623, New Exchange Request: BTCC | https://github.com/ccxt/ccxt/issues/22623 | 2026-09-22 | CCXT | where S1 and S2 were found, the 2025-12-02 read only report, section 7 |
| P1 | `ws-probe.mjs official`, runs at 04:34 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | section 1 |
| P2 | `ws-probe.mjs web`, runs at 04:34, 04:42, 04:50 and 04:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | sections 1 to 6 |
| P3 | `ws-probe.mjs silence`, runs at 04:36 and 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | sections 3 and 5 |
| P4 | `ws-probe.mjs deflate`, runs at 04:36 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | section 5 |
