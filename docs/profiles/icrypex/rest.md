# Icrypex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:59 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of ICRYPEX at `https://api.icrypex.com`, which has no CCXT class, for its one perpetual family, the 53 USDT pairs spelled `<BASE>USDT/P`.
The documented endpoints are S1, which describes spot only.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/icrypex/rest-probe.mjs) unless a source is named.
All access results come from the Canadian VPN exit named above.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `api.icrypex.com`, behind Cloudflare | S1, P1 |
| resolved addresses | 104.26.8.49, 104.26.9.49, 172.67.74.162, and three IPv6 addresses in `2606:4700:20::/48` | P1 |
| Cloudflare edge | `cf-ray` ended in `SEA` on the first curl and in `YVR` on both node probe runs | P0, P1, P3 |
| cold request | `GET /v1/exchange/info` 1,147 ms and `GET /v1/tickers` 885 ms by curl, new TLS each | P0 |
| warm request | `GET /v1/tickers`, 35 KB: 370 ms first, then 317 to 322 ms, and 748 ms then 330 to 333 ms in the second pass | P1, P3 |
| one hertz poll | `GET /v1/tickers` 60 times: min 330, median 334, p90 338, max 399 ms, and 329, 333, 337 and 485 ms in the second pass, none over 1 s, 120 of 120 answered 200 | P2, P3 |
| refusals | none. Every public path answered 200, 401, 404 or 500 as listed below | P1 |

## 2. Catalog

### The instruments call

`GET /v1/exchange/info` returns `version`, `assets` and `pairs` in one 152,507 byte reply, S1.

| field | on the wire | meaning |
|---|---|---|
| `symbol` | `BTCUSDT/P` for a perpetual, `BTCUSDT` for spot | the pair id everywhere |
| `base`, `quote` | `BTC`, `USDT` | assets |
| `marketTypes` | `["PERPETUAL"]` on 53 pairs, `["SPOT"]` on 157 | not in the documented enum, which only names `SPOT`, S1 |
| `status` | `Running` or `CancelOnly` | not documented, S1 documents an `isEnabled` boolean that the reply does not carry |
| `quantityPrecision`, `pricePrecision` | 8 and 1 on `BTCUSDT/P` | decimals |
| `minExchangeValue` | `"1"` on every perpetual | minimum order value in USDT |
| `orderTypes` | `MARKET` and `LIMIT` on every perpetual, spot adds `STOP_MARKET` and `STOP_LIMIT` | |
| `priceLimitFactor` | `"1.3"` on 52 perpetuals and `"5"` on `SPCXUSDT/P`, `"3"` on spot `BTCUSDT` | Not publicly specified |
| `tickSize` | `"0"` on every perpetual | documented as a UI step only |

| count | value |
|---|---|
| pairs | 210 |
| perpetual, all `Running`, all quoted in USDT | 53 |
| perpetual on crypto bases | 23 |
| perpetual on synthetic bases: `FX / INDEX` 12, `EQUITIES` 12, `COMMODITIES` 2, `RWA` 2, `STABLECOIN` 2 (XAGX, OILX) | 30 |
| spot, 144 `Running` and 13 `CancelOnly` | 157 |

The perpetual symbols on 2026-09-23 were SOL, AVAX, ETH, BTC, XMR, ARB, RENDER, USTECHX, XAGX, OILX, TRUMP, DXX, XRP, U1X, G4X, SUI, PEPE, HYPE, DOGE, S, ADA, ALGO, XAUT, LTC, ENA, LINK, APT, ETHFI, COPX, PPLX, COFX, XOMX, TSMX, NVDX, CHVX, UK1X, WHTX, CNHX, TESX, NZDX, METX, GGLX, GBPX, EURX, CHFX, AMZX, ASMX, AUDX, CADX, APLX, AMDX, SPCX and LDO, each followed by `USDT/P`.
Every perpetual base except XMR also has a spot pair, and no base has two perpetuals.
The synthetic bases are venue specific tokens named after equities, indices, currencies and commodities, such as `NVDX` "Nvidia Corporation" and `EURX` "Euro vs US Dollar", and their tickers would not match another venue's token of the same letters.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no Icrypex class, and CCXT master at commit `1d8b674434fde39ef282988b066812adf8d19b9e` has none either, see [`fees.md`](./fees.md) section 8.
So the engine's catalog path, `loadMarkets` filtered to `type === 'swap'` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 68 and 199 to 200, cannot load this venue.
Were a class written, the natural mapping is `market.id` equal to `symbol`, which the socket's `ps` and the REST book's `pairSymbol` spell identically, and `contractSize` 1, because every size on the wire is a base asset quantity, see [`websocket.md`](./websocket.md) section 4.
Nothing in the catalog marks the perpetual as linear or inverse, and every size and price is in base and USDT, so it would be linear.

## 3. Anchor

No public call returns an index, a mark, a funding rate, an interval or a next settlement time.

| call | answer | what it carries |
|---|---|---|
| `GET /v1/tickers` | 200, 35 KB, 210 rows | `symbol`, `last`, `ask`, `bid`, `high`, `low`, `avg`, `change`, `qty`, `volume`, and nothing else |
| `GET /v1/future/info` | 200, `{"isFutureEnable":true}` | a flag |
| `GET /v1/future/get-future-settings?pairSymbol=BTCUSDT/P&positionSide=LONG` | 401, `www-authenticate: Bearer`, empty body | the web app reads `fundingRate` here, S2 |
| `GET /v1/future/funding-rates`, `/v1/future/mark-price`, `/v1/future/pairs`, `/v1/premium-index`, `/v1/funding-rate`, `/v1/mark-price`, `/v1/index-price` | 404, empty body | guesses, none exists |

The only per pair prices in public are the ticker's `last`, `bid` and `ask`, and the book.
So an `AnchorRow` could only be filled with `mark` equal to the last trade, no index, and no funding fields, and the engine's reader refuses a route whose mark is 0 with `anchor_no_mark` at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 38.

## 4. Anchor semantics

### Index

None is published in any reply, channel or bundle string that was found.
The web app has an "Index" label string, S3, and no screen found renders it.

### Mark

The positions screen prints the pair's ticker `price` under the "Mark Price" label, S4, and liquidation happens "When the pair's mark price reaches" the liquidation price, S3.
So the mark appears to be the last trade of the `/P` pair itself, with no clamp and no external reference.
That is an inference from the web app code, not a documented formula.

### Funding

"Interest payment on borrowed funds while the position is open, made three times daily.", S3.
The rate "is announced by ICRYPEX and applies to all open positions at the specified date and time. The rate applied can be positive or negative.", S3.
Its formula, cap and floor, and whether the rate shown is the upcoming or the last one are Not publicly specified.
The settlement instant was not captured, and no public funding history exists.

### How the perpetual tracks spot

Each `/P` pair is its own order book, not a view of spot.
At 04:43 UTC `BTCUSDT/P` stood at bid 87,104.5 and ask 87,159.2 while `BTCUSDT` stood at 87,132 and 87,198.

| measure over 52 perpetuals with a spot twin, from one `/v1/tickers` reply | 04:43 UTC | 04:57 UTC |
|---|---|---|
| median absolute gap between perpetual mid and spot mid | 287 ppm | 193 ppm |
| widest below spot, `SPCXUSDT/P` | −26,485 ppm | −25,159 ppm |
| widest above spot, `TRUMPUSDT/P` | +41,570 ppm | +36,866 ppm |
| `BTCUSDT/P`, `ETHUSDT/P`, `SOLUSDT/P` | −380, −341 and −627 ppm | −426, −503 and −627 ppm |
| perpetual touch spread, min, median, max | 360, 3,444 and 62,450 ppm | 395, 3,188 and 62,034 ppm |

With no index the gap to spot is not a premium in the engine's sense, and it cannot be read as one.

### How often each number changed

Over 60 one second polls of `/v1/tickers` at 04:44 UTC and again at 04:58 UTC, out of 59 chances each:

| pair | `last` changed | `bid` changed | `ask` changed |
|---|---|---|---|
| `BTCUSDT/P` | 5, then 8 | 6, then 3 | 2, then 2 |
| `ETHUSDT/P` | 5, then 7 | 3, then 2 | 1, then 1 |
| `XRPUSDT/P` | 3, then 5 | 2, then 4 | 5, then 8 |
| `LDOUSDT/P` | 3, then 6 | 3, then 0 | 6, then 9 |

The book socket sent 151 and 110 `BTCUSDT/P` differences in 60 s in the same hour, see [`websocket.md`](./websocket.md) section 4, so most book changes sit below the touch.
A last price used as a mark would move a few times a minute on the busiest pair.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /v1/orderbook?symbol=BTCUSDT/P`, where `/` and `%2F` both work |
| reply | an object with `pairSymbol`, `asks` and `bids`, each row an object with string fields `p` and `q` |
| depth | "maximum 50 rows for each side", S1. `BTCUSDT/P` returned 49 asks and 50 bids, then 50 and 50, and `LDOUSDT/P` 23 and 29, then 29 and 32 |
| level order | asks ascending and bids descending on 5 of 5 pairs |
| time | 169 to 171 ms warm, and 174 to 339 ms in the second pass |
| caching | `cache-control: no-cache, no-store, max-age=0, must-revalidate` and `cf-cache-status: DYNAMIC`. Two reads 150 ms apart were identical, which a quiet book explains |
| unknown symbol | 200, `{"pairSymbol":"NOPEUSDT","asks":[],"bids":[]}` |
| missing `symbol` | 500, with `{"message":"Teknik bir hata meydana geldi."}` to curl and an empty body to the node probe |
| against the socket | the socket's maintained top 20 equalled this reply's top 20 on 6 of 6 pairs, see [`websocket.md`](./websocket.md) section 4 |

`GET /v1/trades/last?symbol=BTCUSDT/P` returns up to 50 trades, S1, and 35 to 49 came back.
Its `d` field read `1790138` while the Unix time was `1790138638`, so the REST trade time is truncated to thousands of seconds, while the socket's trade `d` is whole seconds.
`GET /v1/trades/kline` works on `/P` pairs and returns TradingView arrays `s`, `t`, `o`, `h`, `l`, `c` and `v`.

## 6. Rate limits and errors

The documented limits, S5, list paths under `/sapi/v1`, while the public paths documented and used are under `/v1`.
`GET /sapi/v1/tickers` also answered 200 with the same rows.

| action | limit per IP | rejection |
|---|---|---|
| order book | 240 per 60 s | 60 s |
| tickers | 300 per 60 s | 60 s |
| last trades by symbol | 240 per 60 s | 60 s |
| klines, kline history, OHLC | 120 per 60 s | 60 s |

The limit status is 429, S5.
No reply carried a rate limit header or `Retry-After`, and the probe never reached a limit.
A 400 or 422 carries a JSON body with `code` and `message`, as in `{"code":"market_disabled","message":"BTCUSDT market is in Cancel Only mode"}`, and "Other 4xx responses does not include JSON model in their bodies", S5.
Every 401 and 404 seen had an empty body.

## 7. Server time and clock offset

No time endpoint exists, `GET /v1/time` answered 404.
The `Date` header of five replies read 78 to 890 ms behind the local midpoint of each request, and 689 ms behind to 51 ms ahead in the second pass, which a header of one second resolution cannot tell from zero.
So the clock offset is below about 1 s and cannot be measured more finely here.

## 8. Recommended poller shape

No anchor poller is recommended, because no public call carries an index, a mark or a funding rate.
The venue cannot join the engine as a perpetual leg in its current shape, for three reasons.

1. No CCXT class exists, so the catalog cannot load.
2. No anchor exists: a poller could only write `mark` from `last`, which the web app itself uses as its mark, with no index and no funding fields, and the reader's other guards would have nothing to judge.
3. The product is a borrow product whose "funding" is interest set by the venue, not a premium-anchored rate, so the engine's premium and funding reasoning does not apply to it.

The book feed itself is sound, see [`websocket.md`](./websocket.md) section 8.
If the venue were ever wanted as an extra book source, `GET /v1/tickers` every second, about 35 KB and 333 to 334 ms median, is the only per pair price in public.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Icrypex API Documentation, Public Trading Endpoints | https://github.com/icrypex-glb/apidoc/blob/main/trading-public.md | 2026-09-22 | ICRYPEX, global | host, exchange info fields, tickers, order book depth, trades, klines, sections 1, 2 and 5 |
| S2 | web app pair ticker component | https://www.icrypex.com/6063.39d9d02dbe19b9b2.js | 2026-09-22 | www.icrypex.com | `fundingRate` from `get-future-settings`, section 3 |
| S3 | web app English strings | https://www.icrypex.com/521.56180672de06cc99.js | 2026-09-22 | www.icrypex.com | funding and liquidation text, "Index" label, section 4 |
| S4 | web app positions component | https://www.icrypex.com/2290.b8f265750f59c494.js | 2026-09-22 | www.icrypex.com | "Mark Price" shows `ticker.price`, section 4 |
| S5 | Icrypex API Documentation, API Architecture | https://github.com/icrypex-glb/apidoc/blob/main/architecture.md | 2026-09-22 | ICRYPEX, global | status codes, error model, rate limits, section 6 |
| P0 | curl of `/v1/exchange/info`, `/v1/tickers`, `/v1/orderbook` and `/v1/trades/last` at 04:23 to 04:43 UTC | `https://api.icrypex.com` | 2026-09-23 UTC | this host, Canadian VPN exit | cold times, the 500 body, sections 1 and 5 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/icrypex/rest-probe.mjs) `catalog` at 04:43 UTC | `https://api.icrypex.com` | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/icrypex/rest-probe.mjs) `poll` at 04:44 UTC | `https://api.icrypex.com` | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 and 4 |
| P3 | [`rest-probe.mjs`](../../../scripts/probes/venues/icrypex/rest-probe.mjs) `catalog` at 04:57 and `poll` at 04:58 UTC, second pass | `https://api.icrypex.com` | 2026-09-23 UTC | this host, Canadian VPN exit | second readings in sections 1 to 7 |
