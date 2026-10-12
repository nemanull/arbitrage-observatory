# AEGET REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:53 to 03:10 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures REST calls of AEGET's web app.
AEGET publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) sections 1 and 8.
The paths were read from the web bundle `https://aeget.io/static/js/main.2cc29413.chunk.js`, S10 of [`fees.md`](./fees.md), where the futures client prefixes `/futures/fapi` and the market helper prefixes `/market`.
The bundle carries XT.com test hosts such as `futures.xt-qa.com`, and a support link to `support.Tebbit.vip`.
Every number below was captured by [`rest-probe.py`](../../../scripts/probes/venues/aeget/rest-probe.py) unless a source id says otherwise.
The API is the same software as BASEKX's, profiled in [`../basekx/rest.md`](../basekx/rest.md).

## 1. Host and latency from this machine

### The listed site refuses this exit

- CoinMarketCap lists `https://www.aeget.com/` as the website, S8 of [`fees.md`](./fees.md).
- `www.aeget.com` is a CNAME to `ha11.shieldedges.com`, the same edge BASEKX used, by `getent` on 2026-10-09.
  It and `aeget.com` resolved to 12 addresses in `23.145.196.0/24` and `23.147.76.0/24`.
- The TLS handshake to both names fails: the server closes the connection after the client hello, which Python reports as `SSLEOFError: [SSL: UNEXPECTED_EOF_WHILE_READING]` and curl as "unexpected eof while reading".
- Plain HTTP on port 80 fails too, with `RemoteDisconnected: Remote end closed connection without response`.
- No status code or body is ever sent, so the refusal cannot be told apart between a geoblock, an IP filter and an outage.
  It is recorded as a refusal at the edge as seen from the Canadian exit, and it was not routed around.
- `cdn.aeget.com` resolves to an AWS load balancer in `ap-southeast-1` and presents a certificate for `*.tebbit.io`, which fails hostname verification.
  `openssl` showed that certificate expired on 2026-01-15.
- `api.aeget.com`, `openapi.aeget.com` and `futuresopenapi.aeget.com` have no DNS record.

### The reachable host

- `aeget.io` serves the AEGET web app, with the title "Aeget - Cryptocurrency Exchange", AEGET's Telegram and X links, and a link back to `https://www.aeget.com`.
  It sits behind Cloudflare, `CF-RAY` suffix `YVR`, and the TLS handshake succeeds with TLS 1.3.
- REST base: `https://aeget.io/futures/fapi/market/v1/public`.
- `GET /time` took 722 and 731 ms cold and 199 to 218 ms warm, over two runs.
- No public call was refused.
- The bare `/fapi/...` path without `/futures` returns the web app's HTML, 7,807 bytes, with HTTP 200, so a client must check the content type.

## 2. Catalog

### The instruments call

`GET /symbol/list` returned 243 rows and 262,646 bytes in 374 to 487 ms, in both runs.

| `contractType` | `underlyingType` | quote | `state` | `tradeSwitch` | rows |
|---|---|---|---|---|---:|
| `PERPETUAL` | `U_BASED` | `usdt` | 0 | true | 240 |
| `PERPETUAL` | `U_BASED` | `usdt` | 0 | false | 1, `jto_usdt` |
| `EVENT` | `U_BASED` | `usdt` | 0 | true | 2 |

- The coin-M twin `GET /futures/dapi/market/v1/public/symbol/list` returned 0 rows.
- CoinMarketCap shows 220 AEGET perpetual pairs, all USDT, S9 of [`fees.md`](./fees.md).
  It flags all 220 with `priceExcluded` 1 and `volumeExcluded` 1.
- `btc_usdt` reads `contractSize` `"0.0001"`, `pricePrecision` 1, `quantityPrecision` 0, `multiplierUp` and `multiplierDown` `"0.005"`, and `onboardDate` 1738740100000, which is 2025-02-05.
- `contractSize` on the 241 perpetuals: 71 at 1, 44 at 0.1, 38 at 0.01, 38 at 0.001, 32 at 10, 12 at 100, 3 at 0.0001 and 3 at 10000.

### How CCXT would map it

There is no CCXT class, so there is no `market.id` to compare.
The symbol is lowercase `btc_usdt` in `symbol/list`, in every bulk reply, in the depth call and in the socket's `s` field.
`btc` and `eth` are each listed twice, once as the perpetual and once as the `EVENT` contract `btcevent_usdt` or `ethevent_usdt`, so a catalog must keep `contractType` `PERPETUAL` only.
Book sizes are whole contracts of `contractSize` coins by the catalog, see [`websocket.md`](./websocket.md) section 4.

### Not XT's book

BASEKX's book matched XT's own on 2026-09-24, see [`../basekx/rest.md`](../basekx/rest.md) section 2.
AEGET's does not.
Four depth calls on `btc_usdt` over two runs, each beside a call to XT's own depth, returned an update id near 6.79 × 10^17 while XT's carried one near 1.6 × 10^12.
The best prices were 0 to 1.5 USDT apart, and the sizes differed on every side of every pair, so AEGET's book is its own and not a copy of XT's.

## 3. Anchor

| `AnchorRow` column | call | field | probed |
|---|---|---|---|
| index | `GET /q/agg-tickers` or `GET /q/index-price` | `i`, or `p` | bulk, 243 and 244 rows |
| mark | `GET /q/agg-tickers` or `GET /q/mark-price` | `m`, or `p` | bulk, 243 and 244 rows |
| funding rate | `GET /q/funding-rate?symbol=` | `fundingRate` | `null` on 5 of 5 |
| interval | the same call | `collectionInterval` | `null` on 5 of 5 |
| next settlement | the same call | `nextCollectionTime` | `null` on 5 of 5 |

- `GET /q/agg-tickers` returned 243 rows, 47,176 to 47,200 bytes, in 389 to 403 ms, and covered all 241 perpetuals.
  Each row carries `s`, last `c`, index `i`, mark `m`, best bid `bp` and best ask `ap`.
- `GET /q/mark-price` and `GET /q/index-price` without a symbol returned 244 rows each, 12,088 to 12,094 bytes, in 226 to 232 ms.
- `GET /q/funding-rate-record?symbol=` returned an empty `items` list on 5 of 5 contracts.
- So index and mark are available in one call, and funding is not available at all.

## 4. Anchor semantics

- Index: "Weighted price from multiple exchanges", S5 of [`fees.md`](./fees.md).
  No basket, weights or basket call are published.
- Mark: "Spot index price plus funding rate basis", S5, and a "fair price marking method", S4.
  No clamp is published.
- Funding: every 8 hours at 00:00, 08:00 and 16:00 UTC, with no published formula or cap, see [`fees.md`](./fees.md) section 6.
- On one `q/agg-tickers` reply per run, `i` equalled `m` on 209 and 186 of 243 rows, and `m` equalled the last price `c` on 227 and 229 of 243 rows.
- The bulk mark and index calls agreed on 187 and 224 of 244 rows.
- The index carries the contract's own price precision, such as 82592.7 on `btc_usdt`, while XT's index for the same contract carried seven decimals, 82624.3281556.
- On five contracts, the index sat 3.2 to 6.0 bp below XT's index over two runs, and no more than 0.6 bp outside AEGET's own best bid and ask.
  It was inside AEGET's spread on 3 of 5 contracts in the first run and 5 of 5 in the second.
  The index therefore looks like a smoothing of AEGET's own price rather than an external basket.
  Not verified.
- Over 30 one second polls of `q/agg-tickers` per run, `btc_usdt` changed its index 9 and 4 times, its mark 10 and 5 times and its last 10 and 5 times, and the index differed from the last on 21 and 11 of 29 polls.
  `eth_usdt` changed its index 6 and 10 times, its mark 2 and 6 times and its last 3 and 8 times, and the index differed from the last on 27 and 23 of 29 polls.
  The polls took 360 to 557 ms, with a median of 383 to 403 ms.
- The published funding rate cannot be read, so whether it is the upcoming or the last settled rate is unknown.

## 5. REST book snapshot

- Call: `GET /q/depth?symbol=btc_usdt&level=5`.
- `level` 5 and 50 return exactly that many levels a side.
  `level` 500 and 1000 both returned the whole book, 180 to 296 bids and 329 to 385 asks over two runs.
- Bids are descending and asks ascending on every reply.
- Each reply carries `t` in ms, `s` and an update id `u` near 6.79 × 10^17, which is above 2^53 and must be parsed as an integer, not a float.
- Sizes are whole contracts, as on the socket.
- The update id changed between calls a second apart, so the reply is not a cached copy.

## 6. Rate limits and errors

- Every reply carries `x-ratelimit-burst-capacity: 10000`, `x-ratelimit-replenish-rate: 10000` and `x-ratelimit-remaining: 9999`.
  The unit is not stated, and no limit is published.
- No 429 was seen, and no `Retry-After` header was sent.
- An unknown or missing symbol returns HTTP 200 with `{"code":-1,"msg":"invalid symbol","data":null}`.
- An unknown path returns HTTP 404 with a Spring style JSON body, `{"timestamp":...,"status":404,"error":"Not Found","path":"/v1/public/q/nothing"}`.

## 7. Server time

`GET /time` returns `{"code":0,"msg":"success","data":<ms>}`.
The server clock was 21 and 25 ms ahead of the local midpoint of the request, in two runs.

## 8. Recommended poller shape

No poller is recommended.
The venue cannot join the engine as a perpetual leg in its current shape, for four reasons.

1. Funding is `null` in the public API, so no funding rate, interval or next settlement can be written.
2. The index looks like the venue's own price rather than the multi exchange basket the help center describes.
3. The book socket carries one symbol per connection, so 240 contracts would need 240 sockets.
4. There is no published API, and the listed site refuses this exit, so the reachable host `aeget.io` is the web app's own and may change without notice.

If funding ever appears, the poller would read `q/agg-tickers` once a second for `i` and `m`, filtered on the catalog's `PERPETUAL` rows, and `q/funding-rate` per contract on a slower cycle.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S4, S5, S8, S9, S10 | see [`fees.md`](./fees.md) section 10 | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/aeget/rest-probe.py), modes `host`, `catalog`, `anchor`, `book` and `errors` | 2026-10-10 UTC |
| R2 | [`../basekx/rest.md`](../basekx/rest.md), the same API on another venue | 2026-09-24 |
| C1 | `getent hosts www.aeget.com` and `openssl s_client -connect cdn.aeget.com:443` from this host | 2026-10-09 |
