# Ndax REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:29 to 04:44 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Ndax lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/ndax/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S5 are those of [`fees.md`](./fees.md) section 10.
Ndax runs the AlphaPoint exchange platform, so every call is named after an AlphaPoint function, such as `GetInstruments`, and the same functions are served over HTTP and over the socket.

## 1. Host and latency from this machine

### Where the API lives

The public REST API is `https://api.ndax.io:8443/AP/<Function>`, S3 lines 158 and 159.
Public calls are `GET` with query parameters and need no key.
Private calls need a session from `AuthenticateUser`, which the API document says works only over the socket, S2.

### Access, from the Canadian VPN exit

`ipinfo.io` placed the exit in Vancouver, British Columbia, CA, on AS212238 Datacamp Limited, `rest-probe.py host`.
Every public call answered through Cloudflare, with `server: cloudflare` and `cf-ray` ending `-YVR`, the Vancouver edge.
No challenge, geoblock or refusal was seen on the API, the fee page or the socket.
Ndax serves Canadian residents only, see [`fees.md`](./fees.md) section 1, so this exit is inside its market, and a host elsewhere was not tested.

### Resolution

`api.ndax.io` resolved to Cloudflare addresses `104.18.12.4` and `104.18.13.4`, plus two IPv6 addresses.
TCP to `104.18.12.4` port 8443 took 28.6 ms and the TLS 1.3 handshake 38.2 ms in the first run, and 29.4 ms and 38.7 ms in the second.

### Latency

`GET /AP/Ping` over a fresh connection each time returned `{"msg":"PONG"}` in 154.5, 97.9, 86.0 and 102.9 ms in the first run, and in 239.3, 88.1, 96.1 and 86.3 ms in the second.
The probe opens a new TLS connection per call, so a kept-alive client would be faster.

## 2. Catalog

### The instruments call

`GET /AP/GetInstruments?OMSId=1` returns a bare JSON array of 90 instruments in about 118.5 KB.
Each row has 40 fields, trimmed here:

```json
{"OMSId":1,"InstrumentId":1,"Symbol":"BTCCAD","Product1":1,"Product1Symbol":"BTC","Product2":7,"Product2Symbol":"CAD","InstrumentType":"Standard","SessionStatus":"Running","QuantityIncrement":1e-08,"PriceIncrement":0.01,"MinimumQuantity":1e-05,"MinimumPrice":25000.0,"VenueSymbol":"BTCCAD","IsDisable":false,"PriceCollarPercent":3.0,"PriceCollarEnabled":true}
```

| field | values on 90 rows |
|---|---|
| `InstrumentType` | `Standard` on all 90 |
| `SessionStatus` | `Running` on all 90 |
| `IsDisable` | false on all 90 |
| `Product2Symbol`, the quote | CAD 80, USD 8, USDC 1, USDT 1 |

The ten instruments not quoted in CAD are `BTCUSD`, `LTCUSD`, `BTCUSDT`, `BTCUSDC`, `USDTUSD`, `USDCUSD`, `XRPUSD`, `ETHUSD`, `SOLUSD` and `PEPEUSD`.
`BTCUSD`, instrument 74, had an empty book on the socket and in REST, see [`websocket.md`](./websocket.md) section 4.
`GetProducts?OMSId=1` returns 89 products, 84 `CryptoCurrency`, 4 `NationalCurrency` and 1 `Unknown`, with `MarginEnabled` false and `IsDisabled` false on every one.
CoinMarketCap lists 69 spot pairs for Ndax, fewer than the 90 instruments, S4.

### Pairs listed twice

Three pairs have two running instruments each, with an old ticker and a new one on the same product:

| pair | instruments |
|---|---|
| AAVE/CAD | 87 `ERRCAD` and 88 `AAVECAD` |
| POL/CAD | 89 `MATICCAD` and 131 `POLCAD` |
| RENDER/CAD | 121 `RNDRCAD` and 130 `RENDERCAD` |

All six are `Running` and not disabled.
CCXT maps each pair's symbol to the later instrument, 88, 131 and 130, and keeps the earlier one only under its id, `fees-probe.py ccxt`.
A feed that keys by symbol would follow CCXT, and the old instrument should be filtered out by id.

### How CCXT maps it

CCXT's `parseMarket` sets `id` to the numeric `InstrumentId` as a string, such as `"1"` for `BTCCAD`, with `type` `spot`, S3 lines 618 to 647.
That id is what the REST book and the socket take as `InstrumentId`, and the socket reports it back in field 7 of every level, so it is the right `rawMarketId`.
The text `Symbol`, such as `BTCCAD`, is not accepted by `GetL2Snapshot` over HTTP, see section 5, although the socket accepts it, see [`websocket.md`](./websocket.md) section 4.
`active` is `SessionStatus` equal to `Running` with `IsDisable` false, line 643, and all 87 CCXT symbols were active.
`contractSize` and `linear` are undefined, because there are no contracts.

### Size unit and price scale

Sizes are in the base asset, so `0.03529382` on `BTCCAD` is BTC.
`PriceIncrement` and `QuantityIncrement` give the tick and lot, 0.01 CAD and 0.00000001 BTC on `BTCCAD`.
No price scale applies.

## 3. Anchor

Ndax publishes no index price, no mark price and no funding rate, because it lists no perpetual.
`GetIndexPrice`, `GetMarkPrice`, `GetFundingRate`, `GetInstrumentsWithFunding` and `GetPerpetualInstruments` each answered HTTP 404 with the body `NOT FOUND`, `rest-probe.py anchor`.
The API document's function list holds no index, mark or funding call, S2.
The instrument rows carry `PriceCollarIndexDifference` and `PriceCollarPercent`, a 3 % collar on `BTCCAD`, which limits order prices and is not a published index.
The only reference prices are the venue's own last trade, best bid and ask, and session open, high and low, on `GetLevel1`, `summary` and `ticker`.
None of them can anchor a perpetual.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

## 5. REST book snapshot

### The call

`GET /AP/GetL2Snapshot?OMSId=1&InstrumentId=<id>&Depth=<n>`, S2, which CCXT calls with `Depth` 100 by default, S3 line 740.
All three parameters are required, and `Symbol` in place of `InstrumentId` draws the same error as no instrument at all, see the error table below.
The reply is a bare array of ten-number rows, one row per price level:

```json
[[460386219,1,1791606748409,0,117640.25,1,117558.41,1,0.03529382,0],
 [460386219,1,1791606748409,0,117640.25,1,117557.25,1,0.0748,0],
 [460386219,1,1791606748409,0,117640.25,1,118248.0,1,0.04,1]]
```

| index | API document name | CCXT name | seen on the wire |
|---|---|---|---|
| 0 | `MDUpdateId` | `MDUpdateId` | one value on every row of a reply, see below |
| 1 | `AccountId` | number of unique accounts | small integers from 0, so a count and not an account id |
| 2 | `ActionDateTime`, ms | same | the snapshot time on every row |
| 3 | `ActionType`, 0 new, 1 update, 2 delete | same | 0 on every snapshot row |
| 4 | `LastTradePrice` | same | the instrument's last trade, repeated |
| 5 | `OrderId` | number of orders | 1 up to 11 at `Depth` 100 and 55 at `Depth` 500, so a count and not an order id |
| 6 | `Price` | same | the level price |
| 7 | `ProductPairCode`, equal to `InstrumentId` | same | the instrument id |
| 8 | `Quantity` | same | the level size in the base asset |
| 9 | `Side`, 0 buy, 1 sell | same | 0 for bids, 1 for asks |

The API document names fields 1 and 5 as ids, and the wire carries counts, as CCXT's comments say, S3 lines 746 to 755.

### Depth

| `Depth` | rows | bids | asks | bytes | time |
|---|---|---|---|---|---|
| 5 | 10 | 5 | 5 | 655 | 89.6 ms |
| 20 | 40 | 20 | 20 | 2,645 | 192.5 ms |
| 100 | 200 | 100 | 100 | 12,825 | 99.4 ms |
| 500 | 921 | 500 | 421 | 56,685 | 206.0 ms |

The table is the first run, and the second pass gave the same row counts at every depth.
`Depth` is levels a side, and at 500 the ask side ended at 421 levels, its whole length.
The thin `CCCAD`, instrument 158, returned 37 bids and 27 asks at `Depth` 100 in the first run and 37 and 26 in the second, its whole book.

### Level order and values

Bids come first, sorted best first, descending, then asks, best first, ascending, in every reply.
No reply repeated a price within a side, no reply was crossed, and no row had size zero.
Prices and sizes are JSON numbers, some written with trailing zeros such as `0.00150000`.

### MDUpdateId over REST

Every row of one reply carries the same `MDUpdateId`, but consecutive replies do not share a counter.
One minute of polling saw 46 changes in 47 replies, and the second pass saw 22 in 23, with values from three ranges, such as 460396960, 286185872 and 182965059, mixed together, `rest-probe.py poll`.
The likely reading is that several gateway servers answer behind Cloudflare, each with its own counter.
So the REST `MDUpdateId` cannot be joined with the socket's sequence, which restarts at 1 on every subscription, see [`websocket.md`](./websocket.md) section 4.

### Other book and price calls

| call | reply |
|---|---|
| `GET /AP/orderbook?market_pair=BTC_CAD&depth=100` | `{"timestamp":...,"bids":[[size,price]],"asks":[[size,price]]}` with one level a side, which matches the document's level 1, "Only the best bid and ask" |
| the same with `&level=2` | 100 bids and 100 asks, although the document says `depth` 100 "means 50 for each bid/ask side", S2 |
| `GET /AP/summary` | 90 rows keyed `trading_pairs` such as `BTC_CAD`, with `last_price`, `lowest_ask`, `highest_bid`, 24 h volumes and change, 24,170 bytes |
| `GET /AP/ticker` | an object of 84 keys such as `BTC_CAD`, with `last_price` and 24 h volumes, 12,051 bytes |
| `GET /AP/GetLevel1?OMSId=1&InstrumentId=1` | `BestBid`, `BestOffer`, `BidQty`, `AskQty`, `LastTradedPx`, session and rolling 24 h figures, and `TimeStamp` in ms as a string |

The `orderbook` call puts size before price, the reverse of most venues.
The `summary` and `ticker` keys use an underscore, and `ticker` holds 84 keys against 90 instruments, so it cannot stand in for the catalog.

### Unknown and odd requests

| request | reply |
|---|---|
| `GetL2Snapshot` with `InstrumentId` 999999 | HTTP 200, `[]` |
| `GetL2Snapshot` without `InstrumentId` | HTTP 200, `{"result":false,"errormsg":"Invalid Request","errorcode":100,"detail":"OMSId, InstrumentId and Depth are Required"}` |
| `GetL2Snapshot` with `Symbol=BTCCAD` | HTTP 200, the same error |
| `GetL2Snapshot` with `OMSId` 2 | HTTP 200, `[]` |
| `GetLevel1` with `InstrumentId` 999999 | HTTP 200, a full object with every number 0 |
| `orderbook` on `FOO_BAR` | HTTP 200, `{"result":false,"errormsg":"Invalid Request","errorcode":100,"detail":"Instrument FOOBAR was not found"}` |
| `GetOpenOrders`, `GetOrderFee`, `GetOmsFeeTiers` without a session | HTTP 404, `NOT FOUND` |
| an unknown path | HTTP 404, `NOT FOUND` |

An unknown instrument is a silent empty book on `GetL2Snapshot` and an all zero object on `GetLevel1`, not an error.
A client has to check the catalog itself, because the book call cannot tell an unknown instrument from an empty book.
CCXT maps `Invalid InstrumentId` to `BadSymbol` and `Resource Not Found` to `OrderNotFound`, S3 lines 381 to 385.

### Caching

Every reply carried `cf-cache-status: DYNAMIC` and no `cache-control`, so Cloudflare does not cache the book.
Polling the `BTCCAD` book at `Depth` 20 about every 1.2 s for 60 s gave 47 replies, with the top of book changing 13 times, `rest-probe.py poll`.
Replies took a median of 94.7 ms, at least 78.1 and at most 157.1 ms.
The second pass polled for 30 s and gave 23 replies, 4 top of book changes, a median of 95.4 ms and a slowest reply of 832.1 ms.

## 6. Rate limits and errors

The API document names no request limit, S2.
CCXT spaces public calls by its `rateLimit` of 1000 ms, S3 line 25.
No reply carried a rate limit or `Retry-After` header, and the poll at under one call a second was never refused, `rest-probe.py poll`.
The limit itself was not tested.

Errors take three shapes.
A known function with bad parameters answers HTTP 200 with `{"result":false,"errormsg":"...","errorcode":100,"detail":"..."}`.
An unknown function, or a private one over HTTP, answers HTTP 404 with the bare body `NOT FOUND` and `content-type: application/json`.
An unknown instrument answers HTTP 200 with an empty or zero reply.

## 7. Server time and clock offset

CCXT sets `fetchTime` false, S3 line 117, and the API document lists no time call, S2.
The closest is the HTTP `Date` header, which has one second resolution, and it read between 0.75 s behind and 0.11 s ahead of the midpoint of each request on this host over both runs, `rest-probe.py time`.
The snapshot's `ActionDateTime` is stamped when the snapshot is taken.
It fell within 10 ms of the request's midpoint on this host's NTP synchronised clock in the second pass, and up to 396 ms after it on a slow 880.8 ms reply in the first.
So the server clock agrees with this host to well within a second, and no finer offset could be read.

## 8. Recommended poller shape

None for the engine as it stands.
There is no anchor to poll, and Ndax has no perpetual for the engine to price.

If a later design adds CAD spot legs, REST is needed only for the catalog, because the socket sends a snapshot on subscribe, see [`websocket.md`](./websocket.md) section 4.

- Load the catalog from `GetInstruments?OMSId=1`, keep rows with `SessionStatus` `Running` and `IsDisable` false, and drop the three old tickers `ERRCAD`, `MATICCAD` and `RNDRCAD`.
- Use `InstrumentId` as `rawMarketId`, not `Symbol`.
- Use `GetL2Snapshot` only to check a socket book, at most one call a second.
- Read CAD as its own quote family, since it is not USD, and treat the USD, USDT and USDC instruments as thin or empty until a book check says otherwise.

## 9. Source ledger

The sources are S1 to S5 of [`fees.md`](./fees.md) section 10.
S2, the API document, holds the function list, the `GetL2Snapshot` fields, and the `orderbook`, `summary` and `ticker` calls this profile compares with the wire.
S3, the CCXT class, holds the mapping in section 2, the error handling in section 5 and the `rateLimit` in section 6.
