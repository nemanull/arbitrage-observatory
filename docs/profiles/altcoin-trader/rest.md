# Altcoin Trader REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:22 to 03:45 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Altcoin Trader lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/altcoin-trader/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S10 are those of [`fees.md`](./fees.md) section 10.

## 1. Host and latency from this machine

### Where the API lives

The current document, S1, gives one production base URL, `https://api.altcointrader.co.za`, for REST and for the sockets at `/ws` and `/ws/private`.
The paths sit at the root, such as `/markets`, with no version prefix.
The older document served by the API host itself, S2, names `https://api.actnewdev.co.za/` as its server, described as "Blind live Address".
That name resolves to the same three addresses, but its certificate is issued to `api.altcointrader.co.za`, so a TLS client refuses it with "Hostname mismatch".

### Access, from the Canadian VPN exit

| call | status | body or note |
|---|---|---|
| `GET https://api.altcointrader.co.za/markets` | 200 | the catalog, no Cloudflare in front |
| `GET https://api.altcointrader.co.za/` | 401 | `{"code":"UNAUTHORIZED","message":"missing X-API-KEY header"}` |
| `GET https://www.altcointrader.co.za/` | 403 | Cloudflare challenge, title "Just a moment...", `cf-mitigated: challenge`, edge `YVR` |
| `GET https://www.altcointrader.co.za/trading-fees` | 403 | the same challenge |
| `GET https://www.altcointrader.co.za/api/v3/live-stats` | 403 | the same challenge, so the old public stats path on the web host is unreachable from here |
| `GET https://docs.altcointrader.co.za/openapi/openapi.yaml` | 200 | the current document, S1 |

Any path the API does not know answers 401 "missing X-API-KEY header" instead of 404, so a wrong path looks like an auth failure.
The web site's challenge is the only refusal, and no route around it was tried.

### Resolution

`api.altcointrader.co.za` resolved to `13.244.230.200`, `13.245.145.255` and `13.247.241.191`, with no CDN in front.
`www.altcointrader.co.za` resolved to the Cloudflare addresses `104.26.14.180`, `104.26.15.180` and `172.67.69.174`.

### Latency

Three `GET /markets` in a row took 1,131, 1,159 and 1,142 ms in the first run and 1,139, 1,216 and 1,122 ms in the second, so a warm call costs as much as a cold one.
Every public call took between 1.1 and 1.2 s from this host, which is the round trip from the US west coast to South Africa plus the server's work.

## 2. Catalog

### The instruments call

`GET /markets` returns a bare array of 33 objects in 4,611 bytes, all with `status` `active` and `quote` `ZAR`:

```json
{"base":"BTC","min_order_value":"5.00000000","price_precision":8,"quantity_precision":8,"quote":"ZAR","status":"active","symbol":"BTCZAR"}
```

The 33 symbols are `USDTZAR`, `BTCZAR`, `XRPZAR`, `ETHZAR`, `PEPEZAR`, `SOLZAR`, `SHIBZAR`, `DOGEZAR`, `LTCZAR`, `TRXZAR`, `ADAZAR`, `BNBZAR`, `MATICZAR`, `XLMZAR`, `BCCZAR`, `DOTZAR`, `USDCZAR`, `ZECZAR`, `XAGZAR`, `XMRZAR`, `KASZAR`, `SUIZAR`, `TAOZAR`, `BTTZAR`, `HBARZAR`, `WLDZAR`, `AVAXZAR`, `LINKZAR`, `HYPEZAR`, `TONZAR`, `NMCZAR`, `XAUZAR` and `BTGZAR`.
CoinMarketCap lists the same count, 33 ZAR pairs, S5.
The documented status values are `active` and `inactive`, S1, and no `inactive` row was seen.
The documented `min_order_size`, `max_order_size`, `tick_size`, `maker_fee` and `taker_fee` fields are absent from the wire, see [`fees.md`](./fees.md) section 4.
`BCCZAR` is the old ticker for Bitcoin Cash, and `XAUZAR` and `XAGZAR` are gold and silver tokens.

`GET /currencies` returns 92 currencies, 31 of them with the `trade` capability, each with networks and per network withdrawal fees.

### How CCXT maps it

CCXT has no Altcoin Trader class, see [`fees.md`](./fees.md) section 8.
A hand-built catalog would use `symbol` as the market id on REST and on the socket, since both spell it `BTCZAR`.

### Size unit, pairs listed twice, and price scale

Sizes are in the base asset, and there are no contracts.
No pair is listed twice.
Every row reports 8 decimals of price and quantity, so the tick and lot sizes are not on the wire.

## 3. Anchor

Altcoin Trader publishes no index price, no mark price and no funding rate, because it lists no perpetual.
The only reference prices it publishes are its own last trade, open, high and low on `GET /ticker/{market}`, and the same fields on the socket `ticker`.
None of them is an index, and none can anchor a perpetual.
No anchor poller is recommended.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding to describe.
A 40 s poll of `GET /orderbook/BTCZAR?limit=5`, one call about every 3 s, made 15 calls, and 9 of them got HTTP 429, see section 6.
The top of book changed between 4 of the 5 pairs of consecutive successful replies.
The BTCZAR ticker showed a last trade 920 s old in the first run and 1,708 s old in the second, so the book moves more often than the tape.

## 5. REST book snapshot

### The call

`GET /orderbook/{market}?limit=N` returns `asks`, `bids`, `symbol` and `timestamp`:

```json
{"asks":[["1374441.00000000","0.02446237"],["1374446.00000000","0.00329288"],["1377183.19718944","0.12000000"]],
 "bids":[["1369115.00000000","0.16433973"],["1369110.00000000","0.00848708"],["1368115.66722513","0.01852968"]],
 "symbol":"BTCZAR","timestamp":1791602788}
```

### Depth limits

`limit` runs from 1 to 200 with a default of 50, S1.
The default gave 50 levels a side in 3,461 bytes, and `limit=200` gave 200 a side in 13,546 and 13,547 bytes in the two runs.
`limit=0` and `limit=201` answered 400 `{"code":"INVALID_PARAMETER","message":"limit must be an integer between 1 and 200"}`.
The socket accepts the same two values and silently serves 50, see [`websocket.md`](./websocket.md) section 4.

### Level order and values

Bids descend and asks ascend, best first, as `[price, size]` string pairs.
No reply was crossed.
`timestamp` is Unix seconds.

### Ticker and trades

`GET /ticker/BTCZAR` returns `askPrice` and `bidPrice`, which S1 does not list, beside the documented `last`, `open`, `high`, `low`, `change`, `change_pct`, `volume`, `quote_volume` and `timestamp`.
`quote_volume` was `"0"` while `volume` was `"3.22069643"`.
In the second run the ticker's `bidPrice` was 1,368,116.35128310 while the book read a few seconds earlier had a best bid of 1,369,370, so the ticker's bid and ask are not a substitute for the book.
`GET /trades/BTCZAR?limit=5` returns trades newest first, with `trade_id` values such as `pair:3:seq:37967996`.

### Unknown and odd symbols

| call | status | body |
|---|---|---|
| `GET /orderbook/NOPEZAR` | 404 | `{"code":"NOT_FOUND","message":"market not found"}` |
| `GET /ticker/NOPEZAR` | 404 | the same |
| `GET /orderbook/btczar` | 200 | the BTCZAR book, so the symbol is case insensitive |

### Caching

No `cache-control` header came with a book reply, and consecutive replies differed, so the book is not served from a cache.

## 6. Rate limits and errors

S1 says only that limits "may vary by endpoint, account type, and API key permissions" and that an excess answers `429 TOO_MANY_REQUESTS`.
No number is published.

The wire sends three headers on every reply:

| header | `/markets` | other public paths |
|---|---|---|
| `x-ratelimit-limit` | 120 | 150 |
| `x-ratelimit-remaining` | counts down | counts down, and jumps |
| `x-ratelimit-reset` | Unix seconds, 43 to 60 s ahead | Unix seconds, 40 to 51 s ahead |

The 429 body is `{"code":"RATE_LIMIT_EXCEEDED","message":"Too many requests \u2014 back off and retry."}`, where the server writes an em dash shown here as its JSON escape.
The code differs from the documented `TOO_MANY_REQUESTS`, and there is no `Retry-After`.

The bucket of 120 on `/markets` is this caller's own, because it fell by at most one per call of this host and read 118 or 119 in the second pass.
The bucket of 150 on the other public paths is not this host's alone.
In the second pass `GET /ticker/BTCZAR` read 98, 75 and 49 remaining under one reset time over about 8 s, while this host made one call in between each.
In the first run the same bucket, read on `/orderbook/BTCZAR`, showed 0, then 91 two seconds later, then 137, then 0 again, after fewer than 20 calls from this host in the minute before.
So the limiter is either shared with other clients or counted per server instance behind the three addresses.
From this host, 9 of 15 book calls at one every 3 s met a 429, and waiting for the reset time always cleared it.

The error shape is `{"code":...,"message":...}` throughout, as S1 says.

## 7. Server time and clock offset

There is no public time path.
The HTTP `Date` header put the server 0.33 s and then 0.07 s ahead of the local clock, after half the round trip was allowed for.
The header has whole second resolution, so the offset is within a second of zero and no finer.

## 8. Recommended poller shape

None.
There is no anchor to poll, and Altcoin Trader cannot be a perpetual leg.

If a later design adds ZAR spot legs, the catalog is `GET /markets` read once an hour, and the socket is the book feed, see [`websocket.md`](./websocket.md) section 8.
A REST book fallback must stay far below one call a second across all markets, because the shared bucket answers 429 without warning, and each call costs more than a second from this host.

## 9. Source ledger

The sources are S1 to S10 of [`fees.md`](./fees.md) section 10.
S1 gives the paths, parameters, status values and rate limit prose used here.
S2 gives the older server URL and the `Market` fields that the wire no longer carries.
