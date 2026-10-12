# CoinLion REST Profile

**Status:** Done.
CoinLion's undocumented market data host serves a public 132 instrument spot catalog and a full depth call per instrument, it publishes no index, mark or funding, and no anchor poller is recommended.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:36 to 04:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada, which geolocated to Vancouver.

CoinLion lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book, per change 1 of the survey plan's template.
CoinLion publishes no API documentation.
Every path below was read from the web app bundle, S1, or found next to one, and every probed value comes from [`rest-probe.py`](../../../scripts/probes/venues/coinlion/rest-probe.py), whose sections are numbered like this file.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| host | `ursa.coinlion.com`, the `COINLION_API_URL` of the web app's `config.js` | S1 |
| front | Amazon CloudFront, POP `HIO52-P5`, in front of a Kestrel origin | section 1 |
| resolved addresses | four IPv4 addresses in `143.204.1.0/24` and eight IPv6 addresses in `2600:9000::/32` | section 1 |
| cold request | 293 ms and 296 ms for `GET /marketdata/instruments`, in two runs | section 1 |
| warm request | median 124 ms and 128 ms over five more, in two runs | section 1 |
| host root | `GET /` answers 404 `404 page not found` | section 1 |

Two API prefixes share the host.
`/marketdata/` is public.
`/frontoffice-v2/api/v2/` is the account API, and it answers 401 `{"Message":"Unauthorized.","StatusCode":401}` without a login token, except for a few sign-up lookups such as `countries`, section 2.
Nothing refused this host on geography.

## 2. Catalog

The public catalog is `GET https://ursa.coinlion.com/marketdata/instruments`, section 2.

- It returns a bare JSON array of 132 ids, all distinct, every one a lowercase `base_quote` pair such as `btc_usd`.
- By quote asset: USD 23, BTC 23, ETH 22, LION 21, USDT 18, USDC 18 and TUSD 7.
- It carries no status, tick size, lot size or fee field.
- The richer catalog the web app uses is `GET /frontoffice-v2/api/v2/markets/basic`, which holds a `fee` and a `takerFee` per pair, S1.
  It answers 401 without a login token, so it is Account-gated, section 2.
- The id is the same string the socket's `Book` stream takes and returns in `instrument`, see [`websocket.md`](./websocket.md) section 3.
- There is no CCXT class, so there is no `market.id`, `contractSize`, `linear` or `active` mapping to compare.
- CoinMarketCap lists 45 CoinLion spot pairs, against the 132 in this catalog, [`fees.md`](./fees.md) section 3.
- Paths tried next to the catalog that do not exist: `instruments/btc_usd`, `instruments/btc_usd/ticker`, `instruments/btc_usd/trades`, `instruments/btc_usd/orderbook` and `markets` answer 404 with an empty body, section 2.

### Perpetuals

None.
The catalog holds only spot pairs, and the evidence is in [`fees.md`](./fees.md) section 3.

## 3. Anchor

CoinLion publishes no index price, no mark price and no funding rate, because it lists no perpetuals.
It publishes no reference price either.
The nearest things are the last trade on the `Trades` stream and the 24 hour close on the `MiniTicker` stream, see [`websocket.md`](./websocket.md) section 2.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

The one time series call is `GET /marketdata/instruments/{id}/history?startDate=...&endDate=...&type=1d&count=3`, S1, section 4.
`startDate` and `endDate` must have the form `yyyy-MM-ddTHH:mm:ss`, and the web app sends `type` values such as `1d`, S1.
A call without them answers 400 with `{"errors":[{"code":"","message":"Date '' has wrong format. Expected format is 'yyyy-MM-ddTHH:mm:ss'.",...}]}`, section 4.
Over the last seven days it returned daily bars for `lion_usdc`, such as low, high, open and close all 0.195 on 2026-10-07, but an empty `data` array for `sol_usd` and `btc_usd`, although both traded in the last 24 hours, section 4 and [`websocket.md`](./websocket.md) section 4.

Over 20 polls in 30 s, one a second per instrument, the `version` of the `lion_usdc` book stayed 69217595 and that of `sol_usd` stayed 130, section 4b.

## 5. REST book snapshot

The call is `GET https://ursa.coinlion.com/marketdata/instruments/{id}/depth`, section 5.

- The reply carries `instrument`, `bids`, `asks`, `version`, `bidTotalAmount`, `askTotalAmount` and `snapshot: true`, with each level an object `{"amount":..., "price":...}` in JSON numbers, section 5.
  It is the same shape as the socket's `Book` item.
- Depth: the full book.
  `depth=5` and `limit=5` are ignored, and `lion_usdc` still returns 1,511 asks, section 5.
- Level order: both sides ascending by price, so the best bid is the last bid level, section 5.
- Reply size: median 115 bytes, largest 49,852 bytes for `lion_usdc`, section 5.
- Caching: no `Cache-Control`, `Age` or `ETag` header.
  CloudFront reports `Miss` on success and `Error` on a 4xx or 5xx reply, section 1 and section 5.
- Unknown instrument: 500 with `{"errors":[{"code":"unexpected","message":"Could not find market record metadata for marketId (Parameter 'marketId')"}]}`, section 5.

One pass over all 132 instruments found the following, section 5.

| book state | instruments |
|---|---|
| empty on both sides | 129 |
| bids only | 2, `btc_usd` with 4 bids from 7,733.77 to 25,833.77, and `doge_usdc` with 1 bid at 0.075 |
| two-sided | 1, `lion_usdc` with 1 bid at 0.001 and 1,511 asks from 0.15 up |
| crossed | 0 |

The books of `sol_usd`, `eth_usd` and `xrp_usd` were empty while their 24 hour volumes on the `MiniTicker` stream were 5,164.042 SOL, 10.4749 ETH and 1,001.7 XRP, [`websocket.md`](./websocket.md) section 4.
CoinMarketCap reported about 0.62 million USD of 24 hour CoinLion spot volume, S2 and [`fees.md`](./fees.md) section 3.
The `sol_usd` row alone, 5,164.042 SOL at a close of 109.55126, is about 0.57 million USD of it, computed from [`websocket.md`](./websocket.md) section 4.
So the public book does not show the liquidity that the venue's trades fill against.

## 6. Rate limits and errors

- Rate limit: Not publicly specified.
  No reply carried a rate limit or `Retry-After` header, section 6.
  About 210 requests at up to two a second met no limit, sections 1 to 7.
- Error shapes, all seen in section 2, section 5 and section 6:

| status | body |
|---|---|
| 400 | `{"errors":[{"code":"","message":"Date 'x' has wrong format. ...","value":"x","format":"yyyy-MM-ddTHH:mm:ss","key":"startDate"}, ...]}` |
| 401 | `{"Message":"Unauthorized.","StatusCode":401}` |
| 404 | an empty body on an unknown `marketdata` path, `404 page not found` on the host root |
| 500 | `{"errors":[{"code":"unexpected","message":"Could not find market record metadata for marketId (Parameter 'marketId')"}]}` |

## 7. Server time

No server time call was found.
The HTTP `Date` header, which has one second resolution, read between 0.7 and 1.7 s behind the host clock over two runs of five requests, section 7.
That is within what one second truncation and the host clock allow, so the clock offset is Not verified beyond about one second.

## 8. Recommended poller shape

No anchor poller is recommended, because CoinLion publishes no index, mark or funding.
No perpetual catalog exists to load.

For a future spot leg, the catalog would be `GET /marketdata/instruments` once at startup, and a REST book fallback would be `GET /marketdata/instruments/{id}/depth`, which needs no depth parameter because it returns the whole book.
With 129 of 132 books empty, neither would give the engine anything to compare today.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The web app at [`trade.coinlion.com`](https://trade.coinlion.com/), its `config.js` with `COINLION_API_URL`, and its bundle `/assets/index-B6TAsugn.js`, which holds `MARKETS_INFO:"markets/basic"`, the `instruments/${e}/history` path and the date format the app sends | 2026-10-09 |
| S2 | [CoinMarketCap market pairs](https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinlion&category=spot&start=1&limit=100) | 2026-10-09 |
