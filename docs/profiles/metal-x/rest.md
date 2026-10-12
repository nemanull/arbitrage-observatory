# Metal X REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:49 to 05:11 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Metal X lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/metal-x/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S12 are those of [`fees.md`](./fees.md) section 10.
Run 1 is the first run and run 2 is the second pass, which halves the poll window.

## 1. Host and latency from this machine

### Where the API lives

The public REST API is `https://dex.api.mainnet.metalx.com/dex/v1/`, with a testnet at `https://dex.api.testnet.metalx.com/`, S6.
The API reference is a ReadMe site with one OpenAPI page per operation, and it lists 21 operations, S6.
Public calls are `GET` with query parameters and need no key.
Orders are not sent with a key but as signed XPR Network transactions, and the API offers `orders/serialize` and `orders/submit` to help build and relay them, S6.
The replies come from nginx with `x-powered-by: Express`, so the API is a Node service with no CDN in front.

### Access, from the Canadian VPN exit

`ipinfo.io` placed the exit in Vancouver, British Columbia, CA, on AS212238 Datacamp Limited, `rest-probe.py host` and S14.
Every public call answered HTTP 200 with no challenge, geoblock or refusal, and so did the docs, the app and the socket.

### Resolution

`dex.api.mainnet.metalx.com` resolved to one IPv4 address and no IPv6 address, and the address changed between runs.

| run | address | ipinfo.io location | network |
|---|---|---|---|
| 1, 04:52 UTC | `172.104.157.84` | Frankfurt am Main, DE | AS63949 Akamai Connected Cloud, a Linode host |
| 2, 05:05 UTC | `2.29.46.222` | Helsinki, FI | AS24940 Hetzner Online GmbH |

The socket handshake also reported two nginx builds, `nginx/1.28.3` and once `nginx/1.24.0`, see [`websocket.md`](./websocket.md) section 5.
So the name points at more than one backend, and a client should not pin an address.

### Latency

| run | TCP connect | TLS 1.3 handshake | four cold `status/sync` calls |
|---|---|---|---|
| 1 | 3.3 and 6.9 ms | 297.7 and 311.4 ms | 464.4, 461.7, 460.0 and 460.9 ms |
| 2 | 2.8 and 3.3 ms | 344.5 and 347.9 ms | 525.0, 596.2, 625.3 and 524.9 ms |

A TCP connect of 3 to 7 ms to a host in Europe is shorter than any round trip there, so something on the tunnel path completes the handshake and the TLS time is the honest measure.
The probe opens a new TLS connection per call, so a kept-alive client would save about 300 ms a call.
A socket protocol ping took 74.3 to 173.0 ms, see [`websocket.md`](./websocket.md) section 5.

## 2. Catalog

### The instruments call

`GET /dex/v1/markets/all` returns `{"sync":<block>,"data":[...]}` with 18 markets in 5,111 bytes, in 463.7 ms in run 1 and 532.3 ms in run 2.
Each row:

```json
{"market_id":1,"symbol":"XPR_XMD","status_code":1,"type":"spot","maker_fee":0.1,"taker_fee":0.1,"order_min":1,"bid_token":{"code":"XPR","precision":4,"contract":"eosio.token","multiplier":10000},"ask_token":{"code":"XMD","precision":6,"contract":"xmd.token","multiplier":1000000}}
```

| field | values on 18 rows |
|---|---|
| `type` | `spot` on all 18 |
| `status_code` | 1, which is ACTIVE, on all 18 |
| `ask_token.code`, the quote | XMD 14, XUSDC 3, XUSDT 1 |
| `taker_fee` and `maker_fee` | 0.1 on 17, 0 on XBTC_XMD |

`bid_token` is the base and `ask_token` the quote, so `XPR_XMD` is XPR priced in XMD.
XMD is Metal Dollar, which Metal X mints and redeems against a basket of stablecoins, per the trading interface page linked from S2.
The base tokens other than XPR, LOAN and METAL are wrapped tokens on the XPR chain, such as XBTC and XETH on the `xtokens` contract.
The market status codes are 0 INACTIVE, 1 ACTIVE, 2 NOT_IN_USE, 3 DISABLE_ORDERS, 4 DISABLE_FILLS, 5 DISABLE_ORDERS_FILLS and 6 DISABLE_STOPLOSS_TAKEPROFIT, S4.
An active filter is `status_code` equal to 1.

The 18 markets are XPR_XMD, XBTC_XMD, XETH_XMD, XMD_XUSDT, XPR_XUSDC, XBTC_XUSDC, XMT_XMD, XMT_XUSDC, LOAN_XMD, METAL_XMD, XDC_XMD, XDOGE_XMD, XHBAR_XMD, XLTC_XMD, XXRP_XMD, XSOL_XMD, XXLM_XMD and XADA_XMD, with `market_id` 1 to 18 in that order.
`trades/daily` showed no 24 hour volume on five of them, XMD_XUSDT, XPR_XUSDC, XBTC_XUSDC, XMT_XUSDC and XDC_XMD, in both runs.
XMD_XUSDT had 3 bids and no asks, see section 5.

### Pairs listed twice

No pair is listed twice.
XBTC, XMT and XPR each trade against XMD and against XUSDC, and USD, USDC and USDT are one settlement family in the engine, so a spot leg would have to pick one market per base, as `marketFilter` does for perpetuals.
XMD is not a plain dollar token, so the XMD markets would need their own quote family or a conversion.

### How CCXT maps it

CCXT has no Metal X class, see [`fees.md`](./fees.md) section 8.
A catalog would come from `markets/all` directly.
`symbol`, such as `XPR_XMD`, is what `orders/depth` takes and what the socket topic takes, see [`websocket.md`](./websocket.md) section 4.
Live socket frames name the market only by the integer `market_id`, so a feed needs the map from `markets/all`.

### Size unit and price scale

The REST book gives each level in both units, `bid` in the base token and `ask` in the quote token, see section 5.
Token precision is `precision` decimals, such as 4 for XPR and 8 for XBTC, and `multiplier` is 10 to that power.
No price scale applies, and no contract size exists.

### The `sync` field

Every reply carries `sync`, the XPR Network block the data reflects.
The depth `sync` was one block below the chain head from `rpc.api.mainnet.metalx.com`, S13, 407835410 against 407835411 in run 1 and 407836951 against 407836952 in run 2, `rest-probe.py time`.
It advanced 2.1 and 2.08 blocks a second, which is the chain's half second block time.
The chain's last irreversible block was 331 and 336 blocks behind the head, so the book reflects reversible blocks, and the socket's `fork` event exists for that, see [`websocket.md`](./websocket.md) section 4.
`markets/all` returned the same `sync` 3 s apart in both runs, so that reply is cached and its `sync` is stale.

## 3. Anchor

Metal X publishes no index price, no mark price and no funding rate, because it lists no perpetual.
None of the 21 operations in the API reference is an index, mark or funding call, S6.
`markets/perpetual`, `markets/futures`, `funding/rate`, `funding/history`, `index/price`, `mark/price`, `markets/index`, `markets/mark`, `prices/oracle` and `oracles` each answered HTTP 404 with a body such as `{"message":"Cannot GET /dex/v1/funding/rate","error":"Not Found","statusCode":404}`, `rest-probe.py anchor`.
The oracles page says the contract uses oracle token prices to value trading volume for fee tiers, and no API call publishes them, S7.
The only reference prices are the venue's own trades, and `trades/daily` with open, high, low, close and 24 hour volume per market.
None of them can anchor a perpetual.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

## 5. REST book snapshot

### The call

`GET /dex/v1/orders/depth?symbol=<symbol>&step=<n>&limit=<n>`, S6.
`step` is required and is one over the price precision, so a step of 1000 groups prices to 0.001, S6.
`limit` is levels a side, 100 by default, and from 0 to 250.
The reply:

```json
{"sync":407836868,"data":{"bids":[{"count":1,"level":83240,"bid":0.00157378,"ask":131.001448},{"count":1,"level":83210,"bid":0.00139073,"ask":115.722644}],
 "asks":[{"count":1,"level":83570,"bid":0.0017446,"ask":145.796222},{"count":1,"level":83600,"bid":0.00404,"ask":337.744}]}}
```

| field | meaning |
|---|---|
| `level` | the price, grouped by `step` |
| `bid` | the size in the base token, here XBTC |
| `ask` | the size in the quote token, here XMD |
| `count` | the number of orders at the level |

At a step finer than the tick, `ask` over `bid` equalled `level` on every sampled XBTC_XMD row and on every sampled XPR_XMD row but one dust order, which confirms the two units.
The names `bid` and `ask` follow the contract's naming of the base as the bid token and the quote as the ask token, and do not mean the book side.

### Depth and step

| market | step | limit 5 | limit 100 | limit 250 | limit 251 |
|---|---|---|---|---|---|
| XBTC_XMD | 1, 10, 100 or 1000 | 5 and 5 levels, 628 bytes | 100 and 100, 11,384 to 11,436 bytes, 662.5 to 692.4 ms | 250 and 250, 28,272 to 28,328 bytes, 666.3 to 756.4 ms | HTTP 400 |
| XPR_XMD | 1000000 | 5 and 5 | 100 and 100, 11,729 bytes | 250 and 250, 28,966 bytes | HTTP 400 |
| XPR_XMD | 10000 | 5 and 5 | 23 bids and 100 asks | 23 bids and 195 asks | HTTP 400 |
| XPR_XMD | 1000 | 3 bids and 5 asks | 3 and 100 | 3 and 119 | HTTP 400 |

The table is run 2, and run 1 gave the same level counts at limits 5 and 100.
Leaving `limit` out returned 100 levels a side.
On XBTC_XMD the top levels were whole numbers and the same at every step from 1 to 1000.
The reply at limit 100 grew from 11,384 bytes at step 1 to 11,436 at step 1000, which fits a few deeper prices with decimals, such as 83411.5 seen at step 100, being rounded at the coarser steps.
On XPR_XMD a coarse step grouped many orders, up to 720 at one level at step 1000, with bids rounded down and asks rounded up, such as 0.002 and 0.003 around a price of 0.002295.
A feed should ask for a step of 1000000, one over the quote precision of 6, which is finer than every tick.

### Level order and values

Bids come first, best first, descending, then asks, best first, ascending, in every reply.
No reply repeated a level within a side, no reply was crossed, and no row had a zero size.
Sizes are JSON numbers rounded to the token's precision.
The XPR_XMD best bid in run 2 was a dust order of 0.000001 XMD, shown as `bid` 0.0004 and `ask` 0.000001, so base sizes of buy orders are rounded down to 4 decimals, see [`websocket.md`](./websocket.md) section 4.

### One-sided books

XMD_XUSDT returned 3 bids and no asks at step 1000000, in both runs.

### Unknown and odd requests

| request | reply |
|---|---|
| `symbol=FOO_BAR` | HTTP 400, `{"message":"Market with symbol FOO_BAR not found","error":"Bad Request","statusCode":400}` |
| `symbol=xbtc_xmd`, lowercase | HTTP 400, `Market with symbol xbtc_xmd not found` |
| no `step` | HTTP 400, `{"message":["step: Expected number, received nan"],...}` |
| `step=0` | HTTP 400, `Invalid step value` |
| no `symbol` | HTTP 400, `{"message":["symbol: Required"],...}` |
| `limit=100000` or 251 | HTTP 400, `{"message":["limit: Limit must be between 0 and 250"],...}` |
| an unknown path | HTTP 404, `{"message":"Cannot GET /dex/v1/nope","error":"Not Found","statusCode":404}` |

Symbols are case sensitive, and an unknown symbol is an explicit error, unlike on the socket.

### Caching and refresh

Replies carry a weak `etag` and no `cache-control`.
Polling the XBTC_XMD book at step 100 and limit 20 every 1.2 s gave 50 replies in 60 s in run 1 and 25 in 30 s in run 2, all HTTP 200.
`sync` changed on 49 of 49 and 24 of 24 consecutive pairs and never went back, so the book is served fresh.
The top of book changed once in each run, which shows how thin this market is.
Replies took a median of 465.9 ms, from 460.4 to 497.1, in run 1, and a median of 526.8 ms, from 508.5 to 546.5, in run 2.

### Other market calls

| call | reply |
|---|---|
| `GET /dex/v1/trades/daily` | 18 rows of `market_id`, `symbol`, `volume_bid`, `volume_ask`, `open`, `close`, `high`, `low`, `change_percentage`, about 3,005 bytes |
| `GET /dex/v1/trades/recent?symbol=XBTC_XMD&offset=0&limit=3` | `{"sync":...,"data":[...]}` with `block_num`, `block_time`, `trade_id`, `price`, both accounts, both order ids, totals, amounts and fees per side, `order_side` and `trx_id` |
| `GET /dex/v1/status/sync` | `{"dbSecondsBehind":0,"chronicleSecondsBehind":0,"maxSecondsBehind":0}`, the indexer's lag behind the chain |

## 6. Rate limits and errors

The rate limits page says "All requests to API are rate limited to 10 requests / second", with 5 a second on `/history/actions` and 1 a second on `/tax/user`, S6.
Every reply carried `x-ratelimit-limit: 600`, `x-ratelimit-remaining` and `x-ratelimit-reset` counting down from 60, so the wire window is 600 calls a minute, which is the same average.
Remaining fell by one a call, from 572 to 549 in run 1's poll and from 560 to 541 in run 2's, so the window is shared across calls from one address.
No call was refused, and no `Retry-After` was seen, so the status code of an exceeded limit was not observed.
Errors are NestJS style JSON with `message`, `error` and `statusCode`, where `message` is a string or a list of validation messages.

The run 1 socket probe sent one text frame that was not JSON, and right after it the REST API answered HTTP 502 Bad Gateway for several seconds, see [`websocket.md`](./websocket.md) section 4.
The probe's next REST call drew that 502, and a manual check got 502 at 04:57:30 UTC and 200 from 04:57:36 UTC on.
The API address had changed by run 2, see section 1, and whether the two events are related is not known.

## 7. Server time and clock offset

No server time call exists among the 21 operations, S6.
The `Date` header against the local clock gave offsets of 0.034 to 0.080 s and of minus 0.469 to minus 0.393 s in run 1, and 0.138 to 0.171 s in run 2, `rest-probe.py time`.
The header has one second resolution and the round trip was about 0.5 s, so the clock offset is within about half a second, which is all this measure can say.
`block_time` on trades and socket frames is the chain's half second block time in ISO 8601 UTC, such as `2026-10-10T05:04:28.500Z`.

## 8. Recommended poller shape

No anchor poller, because Metal X publishes no index, mark or funding, see section 3.
Metal X cannot join the engine as a perpetual leg.
If a later design adds spot legs, the catalog is one `markets/all` call filtered on `status_code` 1, refreshed every few minutes, with `market_id` kept for the socket.
The book snapshot is `orders/depth?symbol=<symbol>&step=1000000&limit=250`, taken before each socket subscription, with its `sync` passed as `startBlock`, see [`websocket.md`](./websocket.md) section 8.
Calls must stay under 10 a second from one address.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 to S12 | the source ledger of [`fees.md`](./fees.md) section 10 | the fee page, docs index, terms, contract mappings, API reference, oracles page, CoinMarketCap and CoinGecko records, CCXT lists and the app bundle |
| S13 | `https://rpc.api.mainnet.metalx.com/v1/chain/get_info`, the XPR Network RPC named in the app bundle | the chain head and last irreversible block |
| S14 | `https://ipinfo.io/<address>/json` | the location and network of the exit and of each API address |
