# XXKK REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:38 to 04:06 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public REST surface behind XXKK's perpetual futures, USDT-M and USDC-M.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/xxkk/rest-probe.py) unless a source row is named.

## 1. Host and latency from this machine

### What was looked for

XXKK publishes no API.
Its developer page, S1, says "Public API access is not available yet", lists REST, WebSocket and market data APIs as "Coming Soon", and shows a placeholder response `{"error":["EAPI:Public API is not currently available"],"result":null}` for a host `api.xxkk.com`.
The calls below are the ones the website makes without a login, found in its scripts, S2.
They are undocumented and can change without notice.
The site's `robots.txt`, S4, says `Disallow: /api/` and `Disallow: /swap/`, and declares `Content-Signal: ai-train=no, search=yes, ai-input=no`.
No terms of use were reachable, see [`fees.md`](./fees.md) section 1, so whether XXKK permits programmatic reading is unknown.

### Hosts

| host | role | resolved address |
|---|---|---|
| `www.xxkk.com` | website, and its `/api/` calls: catalog, anchor, funding history | `104.21.42.9`, `172.67.198.25`, Cloudflare |
| `q.xkqts.com` | first perpetual quote host: REST book `/mkpai/depth-v2`, market list `/market`, socket `/wsquote` | `104.21.78.104`, `172.67.220.57` and two IPv6 addresses, Cloudflare |
| `q.bmyakh.com` | second perpetual quote host, same paths | `104.21.34.50`, Cloudflare |

The quote hosts come from `swap_quote_domain` in `GET /api/public/symbol/list`, see [`websocket.md`](./websocket.md) section 1.
Every response carried a `CF-RAY` ending in `YVR`, the Vancouver edge.
No call was refused from the Canadian exit.
The website's own location call placed the exit in the United Kingdom, `"iso":"GB"`.

### Latency

| host and call | cold, new TLS connection | warm, kept alive |
|---|---|---|
| `www.xxkk.com` `/api/public/setting/global` | 175 to 228 ms | 156 to 177 ms, median 159 to 168 ms |
| `q.xkqts.com` `/mkpai/depth-v2?…&size=1` | 242 to 459 ms | 218 to 245 ms, median 225 to 230 ms |

The ranges cover the two probe runs and the second pass.

## 2. Catalog

### The instruments call

`GET https://www.xxkk.com/api/swap/public/common/exchangeInfo` returns every perpetual in one reply of about 160 KB in about 180 ms, with `cache-control: no-cache, no-store`.
It held 140 rows on 2026-10-10.

| field | values |
|---|---|
| `settleCoin` | `USDT` on 114, `USDC` on 26 |
| `status` | `"0"` on all 140. No other value was seen, so its meaning is not known |
| `contractType` | `2` on all 140, perpetual |
| `reverse` | `false` on all 140, so there is no inverse family |
| `delistTime` | null on all 140 |
| `contractFactor` | coins per contract, for example 0.001 for `btc-usdt` and 0.01 for `eth-usdt`, `sol-usdc` and `nvda-usdt` |
| `tradeType` | `0` on 75, `1` on 48, null on 17, meaning not known |

`GET https://www.xxkk.com/api/public/symbol/list` names the same 140 ids in `swap_symbols`, and groups them into zones.
The `Tradfi` zone holds 36 USDT-M contracts on stocks, ETFs and commodities, such as `nvda-usdt`, `spy-usdt` and `copper-usdt`.
18 bases are listed against both USDT and USDC, so 8 USDC-M contracts have no USDT twin.
The same call lists 139 spot pairs and 91 `lite` symbols, which are not detailed.

### How CCXT 4.5.68 maps it

CCXT has no XXKK class, see [`fees.md`](./fees.md) section 8.
The Rust server reads each venue's catalog over its own REST, as [`markets.rs`](../../../server/src/venues/gate/markets.rs) line 36 does for Gate, so a custom read of `exchangeInfo` would fit that shape.

### Ids, size unit, and price scale

The catalog id is lower case, `btc-usdt`.
The quote socket, the REST book and the stream socket want upper case, `BTC-USDT`, and lower case gets an empty book with `v` 0.
The funding history call takes the lower case id.
The book's size unit is not established, see [`websocket.md`](./websocket.md) section 4.
`pricePrecision`, `minChangePrice` and `volumePrecision` give the tick and size steps, for example 1, 0.1 and 3 on `btc-usdt`.

## 3. Anchor

### The bulk calls

| call | reply | fields |
|---|---|---|
| `GET https://www.xxkk.com/api/swap/public/common/exchangeInfo` | about 160 KB, median 190 to 191 ms and max 245 ms over three runs of 30 polls | `indexPrice`, `flagPrice` (the mark), `fundRate`, `lastFundRate`, `nextFundRateTime` in ms as a string, `fundRateInterval` in hours, on all 140 rows |
| `GET https://www.xxkk.com/api/swap/public/future/fundingRate/real` | 17,471 bytes, 161 to 166 ms, 140 rows | `symbol`, `price`, `fundRate`, `feeTime` (the next settlement in ms), `fundRateInterval`, `created` |
| stream socket `flagprice_list` | 140 rows every 2.0 to 2.5 s | `s` symbol, `c` mark, `p` index, `r` funding rate, see [`websocket.md`](./websocket.md) section 2 |

`exchangeInfo` alone carries all five `AnchorRow` fields for every perpetual, with no row missing an index or a mark.
`GET https://q.xkqts.com/market?preHour=24`, which the web client calls in place of socket `cmid` 3001, returns a 59,574-byte semicolon list of comma rows for spot, perpetual and `lite` symbols.
Its column meanings are not documented, and it was not used.

### Row mapping

| `AnchorRow` column | field |
|---|---|
| index | `indexPrice` |
| mark | `flagPrice` |
| funding rate | `fundRate`, the running rate for the upcoming settlement, as a fraction per interval |
| interval | `fundRateInterval`, 8 on 110 contracts and 4 on 30 |
| next settlement | `nextFundRateTime`, 1791619200000 (08:00 UTC) on the 8-hour contracts and 1791604800000 (04:00 UTC) on the 4-hour ones at 03:58 UTC. At 04:03 UTC, in the second pass, all 140 showed 08:00 UTC |

## 4. Anchor semantics

### Index

The contract information page says that an index with no direct quote is built from a cross rate, for example LINK/BTC with BTC/USD for LINK/USD, and that XXKK updates its index references from time to time, S3.
No basket or weights are published, and no basket call was found.

### Mark

No mark formula is published.
On BTC-USDT, `flagPrice` 82556.1 at about 03:58:40 UTC equalled the ticker's last price on the quote socket at 03:57:59 and the stream socket's `c` at 03:59:53, while the index was 82597.4.
In the second pass the stream socket's `c` and `flagPrice` were both 82640.3 while the ticker's last price was 82641.9, so the mark is not simply the last trade.
Its formula remains unknown.

### Funding

The formula is funding rate = premium index + clamp(base rate - premium index, 0.05 %, -0.05 %), S3.
`fundRate` is the upcoming rate and moves between settlements.
It changed once in 29 polls on BTC-USDT.
`lastFundRate` equals the newest settled rate in the history call.
`GET /api/swap/public/future/fundingRate/days?symbol=btc-usdt&limit=5` returned 14 settlements in all, newest 5.342e-05 at 00:00 UTC on 2026-10-10 and 8 hours apart, and `lastFundRate` was 5.342e-05.
Without `limit` the call answers `{"code":600,"message":"Required int parameter 'limit' is not present"}`.
No published cap.
32 contracts sat at exactly 0.00375 in every run and the lowest rate was -0.00265234 in run 2, see [`fees.md`](./fees.md) section 6.
The settlement instant itself was not captured.

### How often each number changed

Thirty polls of `exchangeInfo` about 2 s apart, BTC-USDT, in the two runs and the second pass:

| field | changes in 29 intervals | distinct values |
|---|---|---|
| `indexPrice` | 8, 3 and 14 | 6, 3 and 13 |
| `flagPrice` | 10, 8 and 19 | 4, 3 and 16 |
| `fundRate` | 1, 1 and 0 | 2, 2 and 1 |

## 5. REST book snapshot

`GET https://q.xkqts.com/mkpai/depth-v2?businessType=BTC-USDT&dType=0&size=200` returns `{"code":0,"data":{"asks":[{"amount":…,"price":…}],"bids":[…],"v":1193317}}`.
`size` 1, 50 and 200 returned exactly that many levels per side.
`size` 500 and 1000 returned the whole book, 397 asks and 378 bids on BTC-USDT in run 2.
Asks are ascending and bids descending.
`v` is the same counter as the socket deltas, see [`websocket.md`](./websocket.md) section 4.
It rose by 2 or 3 over 5 polls about 1 s apart.
No `cache-control` header was sent.
An unknown symbol or a lower case id returns code 0 with empty sides and `v` 0.
`BTC_USDT` on the same host returns the spot book, with its own much larger `v`.

## 6. Rate limits and errors

No rate limit is published and no response carried a rate limit or `Retry-After` header.
No request was refused at 1 request per second.

| call | answer |
|---|---|
| unknown path on `www.xxkk.com/api/` | HTTP 404 `{"code":404,"message":"Requested path /swap/public/common/nope Not Found"}` |
| funding history for an unknown symbol | HTTP 200 `{"code":200,"message":"","data":{"pageData":[],"currentPage":1,"pageSize":0,"totalCount":0}}` |
| missing required parameter | HTTP 200 `{"code":600,"message":"Required int parameter 'limit' is not present"}` |
| unknown path on `q.xkqts.com` | HTTP 404 Spring-style `{"timestamp":"…","status":404,"error":"Not Found","message":"","path":"/nope"}` |

## 7. Server time and clock offset

No server time call was found.
The `Date` header, at 1 s resolution, put the host clock within 1 s of the server in both runs.
The stream socket's heartbeat reply carries a ms `time`, see [`websocket.md`](./websocket.md) section 5.

## 8. Recommended poller shape

None is recommended, because XXKK has no public API, see section 1.
On the wire, one poll of `GET https://www.xxkk.com/api/swap/public/common/exchangeInfo` every 2 to 5 s would fill every `AnchorRow` for all 140 contracts, mapped as in section 3.
The id would need upper-casing to join the book feed.
The mark should be checked against the last trade before it is trusted, see section 4.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://www.xxkk.com/en/developers` | 2026-10-09 |
| S2 | `https://www.xxkk.com/_next/static/chunks/pages/_app-adf470e5459135fc.js`, the site's main script, which names every `/api/` path above | 2026-10-09 |
| S3 | `https://www.xxkk.com/en/swap-info`, through its script chunk `/_next/static/chunks/pages/%5Blocale%5D/swap-info-fc3f05a7272dcec9.js` | 2026-10-09 |
| S4 | `https://www.xxkk.com/robots.txt` | 2026-10-09 |
| S5 | [`rest-probe.py`](../../../scripts/probes/venues/xxkk/rest-probe.py), runs at 03:47:40 and 03:58:05 UTC on 2026-10-10, and the second pass | 2026-10-09 |
