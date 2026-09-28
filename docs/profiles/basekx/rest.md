# BASEKX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:41 to 07:10 UTC by the host clock, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public futures REST API of BASEKX, which has no CCXT class and no published API documentation, see [`fees.md`](./fees.md) section 1.
The paths were read from the web client's bundle `https://www.basekx.com/static/js/main.92e0da7a.chunk.js`, where the futures client prefixes `/futures/fapi` and the market helper prefixes `/market`.
Every number below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/basekx/rest-probe.mjs) unless a curl call is named.
Access results are from that Canadian VPN exit.

## 1. Host and latency from this machine

- REST base: `https://www.basekx.com/futures/fapi/market/v1/public`.
- `www.basekx.com` is a CNAME to `ha11.shieldedges.com` and resolved to twelve addresses in `23.145.196.0/24` and `23.147.76.0/24`, by `dig` on 2026-09-24.
- `GET /v1/public/time` took 1,298 ms cold, then 626 and 259 ms warm, in `catalog`.
- `GET /v1/public/symbol/list` took 405 to 643 ms in the probe runs, and 7,367 ms on the very first curl call.
- 45 one second polls of `q/agg-tickers` took 384 ms minimum, 399 ms median and 1,109 ms maximum, in `poll`.
- No call was refused.
  Every public call returned HTTP 200, and unknown paths returned a Spring style JSON 404.
- The paths without the `/market` prefix, and the bare `/fapi/...` paths, return the web client's HTML with HTTP 200, so a probe must check the content type.

## 2. Catalog

### The instruments call

`GET /v1/public/symbol/list` returned 163 rows and 176,191 bytes.

| `contractType` | `underlyingType` | quote | `state` | `tradeSwitch` | rows |
|---|---|---|---|---|---:|
| `PERPETUAL` | `U_BASED` | `usdt` | 0 | true | 161 |
| `EVENT` | `U_BASED` | `usdt` | 0 | true | 2 |

The coin-M twin `GET /futures/dapi/market/v1/public/symbol/list` returned `{"code":0,"msg":"success","data":[]}`.
Each row carries `symbol`, `contractSize`, `pricePrecision`, `quantityPrecision`, `makerFee`, `takerFee`, `liquidationFee`, `onboardDate` and 40 other fields.
`btc_usdt` reads `"contractSize":"0.0001"`, `"quantityPrecision":0`, `"pricePrecision":1`, `"makerFee":"0.0004"`, `"takerFee":"0.0004"`.

`contractSize` spans 0.0001 to 100000: 6 rows at 0.0001, 29 at 0.001, 17 at 0.01, 22 at 0.1, 29 at 1, 37 at 10, 10 at 100, 4 at 1000, 2 at 100000, and 7 at other values.
S1 of [`fees.md`](./fees.md) calls the same number "face value".

### How CCXT would map it

There is no CCXT class, so there is no `market.id` to compare.
The symbol spelling is lowercase `btc_usdt`, and it is the same in `symbol/list`, in every bulk reply, in the depth call and in the WebSocket `s` field.
`btc` and `eth` are each listed twice, once as the perpetual and once as the `EVENT` contract `btcevent_usdt` or `ethevent_usdt`.

### Size unit and the XT book

`btc_usdt` book sizes are integers such as `7562`, which matches `quantityPrecision` 0 and a unit of contracts of `contractSize` coins.
That unit was not proven against a trade.
Not verified.

At about 06:43 UTC a curl depth call on BASEKX and one on `https://fapi.xt.com/future/market/v1/public/q/depth?symbol=btc_usdt&level=5` returned the same `u` `673312675677077587` and the same top two levels per side.
The `xt` mode repeated the compare three times at 06:50 UTC, and every XT call failed with `CERT_HAS_EXPIRED`, while a curl call at 06:44 UTC failed with "self-signed certificate in certificate chain".
A last curl retry at 06:54 UTC failed the same way twice.
The certificate failures were not worked around.
A second capture of the match is still wanted.

## 3. Anchor

### The bulk calls

| call | rows | bytes | time | fields |
|---|---:|---:|---|---|
| `GET /v1/public/q/mark-price` | 164 | 8,143 | 658 ms | `s`, `p`, `t` |
| `GET /v1/public/q/index-price` | 164 | 8,143 | 254 ms | `s`, `p`, `t` |
| `GET /v1/public/q/agg-tickers` | 162 | 31,616 | 496 ms | `t`, `s`, `c`, `h`, `l`, `a`, `v`, `o`, `r`, `i` index, `m` mark, `bp`, `ap` |
| `GET /v1/public/q/tickers` | 161 | 22,373 | 1,030 ms | as above without `i`, `m`, `bp`, `ap` |
| `GET /v1/public/q/funding-rate?symbol=<s>` | 1 | | | `fundingRate`, `collectionInterval`, `nextCollectionTime`, all `null` |

`q/funding-rate` without a symbol returned `{"code":-1,"msg":"invalid symbol","data":null}`, so funding has no bulk call.
`q/funding-rate-record` returned an empty `items` list on all 10 perps asked.

### Row mapping

| `AnchorRow` column | field | value on 2026-09-24 |
|---|---|---|
| `index` | `agg-tickers` `i` | equals `m` on every row |
| `mark` | `agg-tickers` `m` | equals `c` on 140 of 162 rows |
| `fundingRate` | `q/funding-rate` `fundingRate` | `null` on 10 of 10 |
| `fundingIntervalHours` | `collectionInterval` | `null` |
| `nextFundingAt` | `nextCollectionTime` | `null` |

## 4. Anchor semantics

No index, mark or funding formula is published, see [`fees.md`](./fees.md) section 1.
The wire says this.

- Index equals mark on 162 of 162 `agg-tickers` rows, and the two bulk calls returned the same price for 164 of 164 symbols.
- Mark equals the last trade `c` on 140 of 162 rows.
- The WebSocket pushes `push.index.price` and `push.mark.price` with the same `p` and the same `t` once a second, see [`websocket.md`](./websocket.md) section 2.
- Over 44 one second intervals, the mark and the index changed on exactly the same polls: 14 times on `btc_usdt`, 13 on `eth_usdt`, 7 on `dot_usdt`, 11 on `tao_usdt` and 3 on `aixbt_usdt`, while the last trade changed 14, 13, 7, 14 and 3 times, in `poll`.
- Funding is null everywhere and has no history.

So the index is the perp's own price, not a spot basket.
That is the self-index shape that already produced false rows, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
A fresh gate that reads this anchor would see no premium on every route, whatever the book does.
No basket call exists.

## 5. REST book snapshot

`GET /v1/public/q/depth?symbol=btc_usdt&level=<n>` returned exactly `n` levels per side for 5, 20, 50 and 100, and 332 bids and 403 asks for both 500 and 1000.
Bids are descending and asks ascending on every call.
Levels are `[price, size]` string pairs with no scientific notation in these replies.
`u` is a JSON number of 18 digits, such as `673314394465108037` in a raw curl reply, which is above 2^53, so a plain `JSON.parse` rounds it.
An unknown symbol returned HTTP 200 with `{"code":-1,"msg":"invalid symbol","data":null}`.
No caching header was seen, and the `x-cache` header read `BYPASS`.

## 6. Rate limits and errors

No limit is published.
Each reply carries Spring Cloud Gateway limiter headers: `x-ratelimit-burst-capacity: 10000`, `x-ratelimit-replenish-rate: 10000`, `x-ratelimit-remaining: 9999`, `x-ratelimit-requested-tokens: 1`, on `symbol/list` in `catalog`.
No 429 was provoked, and no `Retry-After` was seen.
Application errors come as HTTP 200 with `code` -1 and a `msg`.

## 7. Server time and clock offset

`GET /v1/public/time` returns `{"code":0,"msg":"success","data":<ms>}`.
The server read 5 ms ahead of the local midpoint over a 227 ms round trip, in `catalog`.

## 8. Recommended poller shape

None.
A poller could read `q/agg-tickers` once a second in about 400 ms, one call for every symbol, with `i` as index and `m` as mark.
It would carry no information, because the index and mark are the perp's own last price and funding is null.
A route through BASEKX could not be judged by the fresh gate, and its book appears to be XT's book, see section 2.
The venue should not get a poller.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | `https://www.basekx.com/static/js/main.92e0da7a.chunk.js` | paths, `/futures/fapi` and `/market` prefixes |
| S2 | [`fees.md`](./fees.md) S1 to S3 | fee article, user agreement, `open_api_document` null |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/basekx/rest-probe.mjs) `catalog`, `anchor`, `poll`, `book`, `xt` | every number above unless a curl call is named |
| P2 | curl calls from this host at 06:42 to 06:45 UTC | first symbol list time, XT compare, raw `u` |
