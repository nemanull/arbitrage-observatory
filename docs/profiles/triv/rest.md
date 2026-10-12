# TRIV REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:25 to 03:41 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

TRIV publishes no REST API documentation.
The calls below are the ones TRIV's logged-out futures and spot pages make to their own Rails backend, read by [`rest-probe.py`](../../../scripts/probes/venues/triv/rest-probe.py).
They are undocumented, carry no index, mark or funding, and could change without notice.

## 1. Host and latency from this machine

| host | address and edge | result from this exit |
|---|---|---|
| `triv.co.id` | 107.154.148.197 and 107.154.150.197 in two runs, Imperva in front of nginx 1.14.0 | 200 |
| `www.triv.co.id` | 45.60.96.197, Imperva | redirects to `triv.co.id/id`, 200 |
| `triv.id` | Cloudflare | 200, a second domain for the same site |
| `help.triv.id` | does not resolve in DNS | |
| `api.triv.co.id` | does not resolve in DNS | |
| `api-exchange.cfx.co.id` | Cloudflare | 403, `{"error":"Blocked by CFX Security Rules", "clientIp": "149.22.81.161", ..., "location": "CA"}` |
| `api.cfx.co.id` | AWS load balancer | 403, a bare nginx "403 Forbidden" page |
| `ws-exchange.cfx.co.id` | Cloudflare | 400 "Bad Request" to plain HTTPS, the socket of [`websocket.md`](./websocket.md) |

The first request to `triv.co.id` took 2.30 s and 2.35 s in two runs, with redirect and page.
Four requests per run to the small `/api/v1/perpetuals/udf_market/time` call took 547 to 1113 ms over the same two runs.
The CFX refusal names Canada, so a reader in another region may see a different answer.
It was recorded and not routed around.

## 2. Catalog

### The instruments call

There is no instruments call.
The catalog is the `gon.active_market_futures` object embedded in the HTML of any futures page, such as `GET https://triv.co.id/en/futures/BTCUSDT-PERP`, about 860 KB.

| field | example for BTCUSDT-PERP | meaning |
|---|---|---|
| `symbol` | `BTCUSDT-PERP` | the socket channel suffix and the URL path segment |
| `pair` | `USDT` | settlement and quote asset |
| `asset` | `BTC` | base asset |
| `basePrecision` | 4 | size decimals |
| `quotePrecision` | 6 | price decimals for display, 6 on every row |
| `price`, `change` | 82589.2, 0.432 | a cached last price and 24 h change |

The object held 49 symbols in every run, all with `pair` USDT.
`basePrecision` takes the values 0 to 4.
There is no status field, no contract size, no tick size and no minimum order, so every listed symbol is taken as active.
The UDF call `/api/v1/perpetuals/udf_market/symbols?symbol=BTCUSDT-PERP` adds `pricescale` 1000000 and `minmov` 10, a chart tick of 0.00001 that is not a trading tick.

### Mapping without CCXT

No CCXT class exists, as [`fees.md`](./fees.md) section 8 records.
A native loader would parse the HTML page for `gon.active_market_futures`, use `symbol` as the socket and URL id, and build `<asset>/USDT:USDT` itself.
No pair is listed twice.
Book sizes appear to be base coin, from the page's formatting, so `contractSize` would be 1, unconfirmed on the wire.

### Spot catalog, named only

The spot side quotes crypto against IDR and USDT.
CoinMarketCap's data API lists 936 spot pairs for TRIV and 0 perpetual pairs.
The spot page for BTC_IDR calls `/markets/BTC_IDR/settings`, which points its book at `wss://stream-cloud.binanceru.net/ws/btcusdt@depth`, an upstream Binance stream, and gives an IDR price.
The page carries `gon.rate_adjustments` `{"ask":17954.0,"bid":17846.0}`, IDR per USDT to buy and to sell.
TRIV's spot book is thus a converted upstream book, not a TRIV order book.

## 3. Anchor

No public call returns index, mark or funding for one perpetual or for all of them.

| AnchorRow column | source on the site | public |
|---|---|---|
| index | none. The page labels `last_price` from the socket as "index-price". | no |
| mark | `mark_price` on CFX channel `ticker.<symbol>` | no, refused without auth |
| funding rate | `funding_rate` on the same channel | no, refused without auth |
| interval | 8 hours, from the page's countdown to 07:00, 15:00 and 23:00 local time | code only |
| next settlement | computed by the browser from its own clock | code only |

## 4. Anchor semantics

The index basket, the mark formula, the funding formula and its cap are Not publicly specified.
Whether `funding_rate` is the upcoming or the last settled rate is unknown, since no frame was received.
The one public price series is the TradingView UDF call, `GET /api/v1/perpetuals/udf_market/history?symbol=BTCUSDT-PERP&resolution=1&from=...&to=...`, which returned ten 1 minute bars of last trade prices for the last 10 minutes, such as closes of 82560 and 82524.1.
Resolutions offered are 1D, 60, 5 and 1 minutes, per `/config`.
That series is a trade price, not an index or a mark, so it cannot fill an `AnchorRow`.

## 5. REST book snapshot

`GET https://triv.co.id/futures/<symbol>/settings` is what the page loads before it opens the socket.
It returned `{"orderbooks": {"symbol": ..., "bids": [], "asks": []}, "trades": [...]}` for BTC, ETH and SOL in every run.
The book was empty each time.
The 20 trades were in ascending time, and the newest was 23.2 to 23.9 h old across runs, so the call serves stale trades and no book.
Trade rows carry strings: `{"side":"SELL","price":"82128.4","size":"0.0001","timestamp":1791516837735,"symbol":"BTCUSDT-PERP","match_id":"..."}`.

No usable REST book exists.

## 6. Rate limits and errors

No rate limit is published, and none was met at about 30 requests per run.
Errors seen:

| call | answer |
|---|---|
| `/futures/NOPEUSDT-PERP/settings` | 302 to `https://triv.co.id/en/futures/BTCUSDT-PERP`, body "You are being redirected" |
| paths such as `/id/fee` | 302 to the home page |
| `api-exchange.cfx.co.id` | 403 JSON, section 1 |

## 7. Server time and clock offset

`GET /api/v1/perpetuals/udf_market/time` returns Unix seconds as a bare number, such as `1791603381`.
Server minus local was -1 s, 0 s and 0 s in three runs, at that second resolution.

## 8. Recommended poller shape

No REST anchor poller is recommended, because no public call carries index, mark or funding.

The survey verdict for TRIV is no public API.
TRIV lists 49 USDT-margined perpetuals, executed on the CFX crypto bourse, and offers them to Indonesian investors.
It publishes no API, its catalog exists only inside a web page, its REST book is empty, and its perpetual feed is CFX's socket, which refuses every public channel without a session signed by a CFX member.
CFX's own REST host refused this Canadian exit outright.
A future adapter would need a CFX member credential or a published TRIV API, and neither exists for an outside client today.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [TRIV futures page for BTCUSDT-PERP](https://triv.co.id/en/futures/BTCUSDT-PERP), its `gon` variables and scripts | 2026-10-09 |
| S2 | [TRIV spot page for BTC_IDR](https://triv.co.id/id/markets/BTC_IDR) and its script `markets/market_show` | 2026-10-09 |
| S3 | [TradingView UDF protocol, as used by the page's datafeed](https://triv.co.id/api/v1/perpetuals/udf_market/config) | 2026-10-09 |
| S4 | [CoinMarketCap data API, TRIV market pairs](https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=triv&category=spot&start=1&limit=10) | 2026-10-09 |
