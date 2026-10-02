# BitxEX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-24.

**Probed:** 2026-09-24, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

BitxEX publishes no REST API documentation that this research could find.
The calls below are the ones the futures web app makes, read from its bundle `https://bitxex.io/static/js/main.afe60ef9.chunk.js`, B1, and probed with [`rest-probe.mjs`](../../../scripts/probes/venues/bitxex/rest-probe.mjs).
They are undocumented, unversioned for outside use, and could change without notice.

## 1. Host and latency from this machine

| item | finding |
|---|---|
| resolved address | `bitxex.io` to 104.21.70.173 and 172.67.138.8, Cloudflare |
| edge | `cf-ray` suffix `YVR`, Vancouver, `server: cloudflare` |
| TCP and TLS | connect 6 ms, TLS done at 19 ms |
| homepage | 18.2 s for 7,603 bytes on the first request |
| futures JSON | 251 ms to 36.3 s for a reply in the first runs, and three requests timed out at 25 to 30 s, P1 and P2. In the second pass `agg-tickers` took 22.0 s, the book 50.0 s, and four per symbol calls timed out at 60 s, P3 |
| wrong prefix | `https://bitxex.io/fapi/…` without `/futures` returns the 7,603 byte web page with HTTP 200 after 1.3 to 35 s |

The TCP connect is to Cloudflare, so the delay is between Cloudflare and the origin.
`xex.vip`, the older domain, resolves to 8.222.88.231 and timed out after 25 s.

## 2. Catalog

### The instruments call

`GET https://bitxex.io/futures/fapi/market/v1/public/symbol/list` returns `{"code": 0, "msg": "success", "data": [...]}`, 273,760 bytes, P1.
The prefix is `"/futures" + baseURL`, and the path is `"/market" + "/v1/public/symbol/list"`, both in B1.
The coin-M twin, `/futures/dapi/market/v1/public/symbol/list`, returned `data` with 0 rows, P1.

| `contractType` | `underlyingType` | `quoteCoin` | `state` | `tradeSwitch` | count |
|---|---|---|---|---|---:|
| `PERPETUAL` | `U_BASED` | `usdt` | 0 | true | 252 |
| `EVENT` | `U_BASED` | `usdt` | 0 | true | 2 |

Each row carries `symbol`, `contractSize`, `pricePrecision`, `quantityPrecision`, `makerFee`, `takerFee`, `liquidationFee`, `minQty`, `minNotional` and more.
`btc_usdt` has `contractSize` `"0.00001"`, `pricePrecision` 2 and `quantityPrecision` 0.

### How CCXT 4.5.68 maps it

It does not, because CCXT has no BitxEX class, see [`fees.md`](./fees.md) section 8.
The layout matches XT.com's futures API (`/future/market/v1/public/symbol/list` on `fapi.xt.com`), compare [`../xt/rest.md`](../xt/rest.md), so a CCXT `xt` instance with overridden URLs is the nearest route to a catalog.
That override was not tried.

### Size unit, pairs listed twice, and price scale

Sizes are whole contracts of `contractSize` base units, section 5.
Each base appears once in the USDT-M family, and the coin-M family is empty.
No per 1000 contract was seen, but this was not checked symbol by symbol.

## 3. Anchor

### The bulk calls

| call | reply on 2026-09-24 | P1 time |
|---|---|---|
| `/futures/fapi/market/v1/public/q/agg-tickers` | 253 rows, keys `t,s,c,h,l,a,v,o,r,i,m,bp,ap`, 47,153 bytes | 303 ms |
| `/futures/fapi/market/v1/public/q/index-price?symbol=btc_usdt` | `[{"s":"btc_usdt","p":"84066.9","t":1790232723444}]` | 5.1 s |
| `/futures/fapi/market/v1/public/q/mark-price?symbol=btc_usdt` | `[{"s":"btc_usdt","p":"84082.9","t":1790232730089}]` | 11.7 s |
| `/futures/fapi/market/v1/public/q/funding-rate?symbol=btc_usdt` | `{"symbol":"btc_usdt","fundingRate":null,"collectionInterval":null,"nextCollectionTime":null}` | 28.2 s |
| `/futures/fapi/market/v1/public/q/funding-rate-record?symbol=btc_usdt&limit=5` | `data` an empty list | 251 ms |

In `agg-tickers`, `i` and `m` are named like index and mark, but on 253 of 253 rows both equal `c`, the last price, in P1 and again in P3.
For `btc_usdt` the row read `"c":"84078.80"`, `"i":"84078.80"`, `"m":"84078.80"`, while the dedicated calls a few seconds later read index 84066.9 and mark 84082.9.
So the bulk call carries no index and no mark, and the calls that do are per symbol and took 5 to 12 s.
The oldest row's `t` was about 238 days old, so at least one listed symbol has not traded since early 2026.

### Row mapping

| `AnchorRow` column | field | status |
|---|---|---|
| `index` | `index-price` `p`, per symbol | 252 calls per poll, 5.1 s each on the one probe |
| `mark` | `mark-price` `p`, per symbol | same |
| `fundingRate` | `funding-rate` `fundingRate` | `null` for `btc_usdt` |
| `fundingIntervalHours` | `funding-rate` `collectionInterval` | `null` |
| `nextFundingAt` | `funding-rate` `nextCollectionTime` | `null` |

## 4. Anchor semantics

| item | documented | probed |
|---|---|---|
| index | "来源于多个交易所的平均价格", an average of several exchanges' prices, [`fees.md`](./fees.md) S3. No basket or weights | no basket call found in B1 |
| mark | spot index plus a decaying funding basis, S3 | 84082.9 against index 84066.9, 190 ppm above, one reading |
| mark clamp | Not publicly specified | Not verified |
| funding | per minute premium averaged over 8 h, [`fees.md`](./fees.md) section 6 | not published on the wire |
| upcoming or last settled | S3 says the rate applied at 16:00 is the one computed from 08:00 to 16:00 | Not verified |
| change over a minute of 1 s polls | | not measured, because single replies took up to 28 s |

The settlement instant itself was not captured.

## 5. REST book snapshot

`/futures/fapi/market/v1/public/q/depth?symbol=btc_usdt&level=50` returned 50 bids and 50 asks in 11.4 s, P1.
Bids were descending and asks ascending.
The top read `["84082.79","20777"]` and `["84082.81","21159"]`, a 0.02 USDT spread, and 20,777 contracts of 0.00001 BTC is 0.208 BTC.
The reply's `t` was 16.9 s old when it arrived, and 28.1 s old in the second pass, P3.
Its `u` was `673314679220616907`, which is larger than 2^53, so `JSON.parse` rounds it to `673314679220617000`.
A feed that chains on `u` would have to read it as a string or a BigInt.

## 6. Rate limits and errors

Not publicly specified.
No 403, 418 or 429 was seen, and no `Retry-After` header.
The only failures were timeouts at 25 to 60 s and the web page returned for a wrong prefix with HTTP 200.

## 7. Server time and clock offset

No time call was found in B1.
The `Date` headers agreed with the host clock to the second.

## 8. Recommended poller shape

None.
The bulk ticker's `i` and `m` are the last price, the per symbol index and mark calls took 5 to 12 s each, the funding call returned nulls, and replies ranged up to 50 s or timed out at 60 s.
The engine refuses a reading older than 10 s and two legs read more than 5 s apart, see `server/src/engine/opportunity/anchorReading.ts` in the TypeScript server, now under [`../../../old_ts_server/`](https://github.com/nemanull/arbitrage-observatory/tree/588ff41a174ff565d0f3cefb68eeff414959a5f0/old_ts_server).
Every anchor row from this venue would be refused, and a route with no mark is refused at open.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| B1 | BitxEX futures web bundle `main.afe60ef9.chunk.js` | https://bitxex.io/static/js/main.afe60ef9.chunk.js | 2026-09-24 | BitxEX | the `/futures` prefix, `/fapi` and `/dapi`, every path in sections 2 to 5 |
| S1 | CoinMarketCap exchange detail, slug `xex` | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=xex | 2026-09-24 | CoinMarketCap | website domain, section 1 |
| P1 | `rest-probe.mjs anchor` at 06:51 UTC and `catalog` at 06:52 UTC, first runs | [`rest-probe.mjs`](../../../scripts/probes/venues/bitxex/rest-probe.mjs) | 2026-09-24 | this host | sections 2 to 6 |
| P2 | `curl` of the homepage, `xex.vip` and the paths without `/futures`, 06:42 to 06:50 UTC | not scripted | 2026-09-24 | this host | section 1 |
| P3 | `rest-probe.mjs anchor`, second pass at 07:05 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitxex/rest-probe.mjs) | 2026-09-24 | this host | latency and timeouts, `i` and `m` equal to `c` again, book age, sections 1, 3 and 5 |
