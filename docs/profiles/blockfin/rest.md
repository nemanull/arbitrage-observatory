# BlockFin REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 04:11 to 04:40 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada, where BlockFin's Cloudflare edge refused most calls with its restricted region page and let some through.

This profile covers the public REST API of BlockFin (`blockfin.com`) for its perpetual families, with the anchor calls in detail.
BlockFin has no CCXT class, see [`fees.md`](./fees.md) section 8.
BlockFin publishes no API reference that this host could read, because its docs page answers with the restricted region page.
The API answers on `openapi.blockfin.com` in the shape of BloFin's public v1 API, path for path, which [`../blofin/rest.md`](../blofin/rest.md) records from BloFin's own reference.
The evidence that BlockFin runs on BloFin's platform is in section 1.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/blockfin/rest-probe.py), named by mode as P1 to P4, unless a source is named.
No proxy, VPN or other route around the refusal was used.
The replies quoted below are the ones BlockFin's edge chose to serve to this exit.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST root | `https://openapi.blockfin.com`, found by trying BloFin's paths, P1 |
| resolved addresses | `104.18.32.191` and `172.64.155.65`, Cloudflare, shared by the apex, `www`, `openapi`, `api` and `docs`, P1 |
| exit as seen | `149.22.81.161`, Vancouver, Canada, AS212238 Datacamp Limited, P1, and Cloudflare's own trace says `colo=YVR` and `loc=CA`, P2c |
| answer to most calls | HTTP 403, `text/html`, 9,831 bytes, the restricted region page, in 21 to 164 ms over 132 refusals in four runs, P1, P2 and P2c |
| answer when a call is let through | HTTP 200 JSON from the origin, in 122 to 362 ms over 27 replies, P1, P2 and P2c |
| docs | `https://docs.blockfin.com/` answers 301 to `https://blockfin.com/en/docs`, which answers the restricted region page, P1 |

The refusal page reads "We noticed that your IP address is from one of BlockFin's restricted countries or regions. Unfortunately, BlockFin is not able to provide service to users in these regions under our Terms and Conditions.", P1.
That is BloFin's restricted region page with the name changed, see [`../blofin/rest.md`](../blofin/rest.md) section 1.

### The refusal lets some calls through

The same URL, asked again a second later from the same exit, sometimes answers normally.
Mode `repeat` asks five paths 6 to 15 times each, one request a second, and counts the replies that are not the refusal page.

| path on `openapi.blockfin.com` | let through, first run | let through, second run | let through, second pass |
|---|---|---|---|
| `/api/v1/market/tickers` | 8 of 15 | 6 of 15 | 0 of 15 |
| `/api/v1/no-such-path` | 4 of 15 | 2 of 15 | 1 of 15 |
| `/api/v1/market/instruments?instType=SWAP` | not asked | 2 of 6 | 0 of 6 |
| `/api/v1/market/mark-price` | not asked | 0 of 6 | 0 of 6 |
| `/api/v1/market/funding-rate` | not asked | 1 of 6 | 0 of 6 |

So the share let through ran from 12 of 30 to 1 of 48 between runs a quarter of an hour apart.
Mode `access` let `tickers` and the unknown path through in its first run and `tickers` alone in its second, P1 and P2c.
The first run of mode `access` also got one normal reply from the web host: `https://blockfin.com/api/v1/no-such-path` answered HTTP 404 with the 86,844 byte web app page, P1.
Cloudflare's trace said `colo=YVR` and `loc=CA` on every read, on both hosts, so the gaps are not the exit's location changing, P2c.
Why the rule lets some requests through is Not publicly specified.
A feed or poller cannot rely on it, and the venue says it does not serve this region.

### Why this profile treats BlockFin as a BloFin platform

| evidence | source |
|---|---|
| The restricted region page is BloFin's, word for word, with "BloFin" replaced by "BlockFin" | P1, and [`../blofin/websocket.md`](../blofin/websocket.md) section 1 |
| `openapi.blockfin.com` serves BloFin's paths, `/api/v1/market/instruments`, `/tickers` and `/funding-rate`, with BloFin's field names and envelope `{"code":"0","msg":"success","data":[...]}` | P2, against [`../blofin/rest.md`](../blofin/rest.md) section 3 |
| The catalog's `listTime` for `BTC-USDT` and `ETH-USDT` is `1673517600000`, 2023-01-12, fourteen months before BlockFin's launch date of 2024-03-06 on CoinMarketCap and one day after BloFin's of 2023-01-11 | P2, P3 and S2 |
| On CoinMarketCap, 309 of the 310 perpetual pairs both venues list carried the same funding rate to within one part in a billion, and 307 the same index price, when both venues' rows were stamped 2 s apart, 04:12:15 and 04:12:17 UTC. In the second pass the rows were stamped three minutes apart, 04:33:15 and 04:30:16 UTC, and 35 rates and 38 index prices matched, as live estimates would | P3 and S5 |
| The 24 h BTC/USDT volume differs, 4,659 BTC on BlockFin against 2,153 BTC on BloFin, so CoinMarketCap sees two books or two volume feeds | P3 |
| A search engine summary of a Koinly feedback post titled "Add Blockfin integration (same API structure as Blofin)" calls BlockFin a product of the BloFin team, but the post answered "This feedback does not exist" to this host | S7 |

Whether BlockFin's order books are its own or shared with BloFin is Not publicly specified.

## 2. Catalog

### The instruments call

`GET https://openapi.blockfin.com/api/v1/market/instruments?instType=SWAP`, 142,354 bytes, 210 and 224 ms on the two replies let through, P2.

| field | values in the reply, P2 |
|---|---|
| rows | 381, every `instId` unique |
| `instType` | `SWAP` on all 381 |
| `state` | `live` on all 381 |
| `contractType` | `linear` 367, `inverse` 14 |
| `settleCurrency` | `USDT` 357, `USDC` 10, and one row each for 14 base coins on the inverse contracts |
| `contractValue` | `1` on 158, `10` on 118, `0.1` on 39, `100` on 32, and smaller groups down to `0.0001` |
| other fields | `baseCurrency`, `quoteCurrency`, `contractValueMultiplier`, `expireTime`, `listTime`, `lotSize`, `maxLeverage`, `maxLimitSize`, `maxMarketSize`, `minSize`, `tickSize` |

| family | active count, P2 | ids |
|---|---|---|
| USDT-M linear | 357 | `BTC-USDT` and 356 more |
| USDC-M linear | 10 | `ADA-USDC`, `BNB-USDC`, `BTC-USDC`, `DOGE-USDC`, `ENA-USDC`, `ETH-USDC`, `LINK-USDC`, `SOL-USDC`, `SUI-USDC`, `XRP-USDC` |
| coin-M inverse, quoted in USD and settled in the base coin | 14 | `ADA-USD`, `BCH-USD`, `BTC-USD`, `DOGE-USD`, `DOT-USD`, `ETC-USD`, `ETH-USD`, `FIL-USD`, `LINK-USD`, `LTC-USD`, `SOL-USD`, `SUI-USD`, `UNI-USD`, `XRP-USD` |

The `BTC-USDT` row:

```json
{"instId":"BTC-USDT","baseCurrency":"BTC","quoteCurrency":"USDT","contractValue":"0.001","listTime":"1673517600000","expireTime":"4918462709025","maxLeverage":"150","minSize":"0.1","lotSize":"0.1","tickSize":"0.1","instType":"SWAP","contractType":"linear","maxLimitSize":"1000000","maxMarketSize":"100000","state":"live","contractValueMultiplier":"0.1","settleCurrency":"USDT"}
```

CoinMarketCap counts 319 USDT perpetual pairs for BlockFin, each with a `derivativeTickerId` such as `BTC-USDT` and a market URL `https://blockfin.com/futures/BTC-USDT`, P3 and S3.
318 of those 319 ids are in the live catalog, P2.
The exception is `RARE-USDT`, which CoinMarketCap still lists and the catalog no longer holds, and 39 USDT rows of the catalog are not on CoinMarketCap's list.
BloFin's catalog also has 10 USDC rows and 14 inverse rows, with `BTC-USDC` and `BTC-USD` among them, beside 461 USDT rows, see [`../blofin/fees.md`](../blofin/fees.md) section 3.

### How CCXT maps it

No CCXT class exists, see [`fees.md`](./fees.md) section 8.
CCXT's `blofin` class reads the same call at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/blofin.js` line 179, but its REST root is `https://openapi.blofin.com` at line 164.
A BlockFin adapter would either point that class at `openapi.blockfin.com` or parse the reply itself.
The BloFin profile records how the class maps `contractValue` to `contractSize` and mislabels the inverse rows, see [`../blofin/rest.md`](../blofin/rest.md) section 2.
The REST id is `instId`, the same string on the catalog, ticker and funding calls, P2.

### Size unit and pairs listed twice

Ticker sizes are in contracts: `BTC-USDT` showed `vol24h` `"4658668.2"` against `volCurrency24h` `"4658.6682"`, a ratio of 1,000, which is one over `contractValue` `0.001`, P2.
A feed therefore multiplies book sizes by `contractValue` to get coins, as the BloFin profile documents.
Ten bases also have a USDC-M contract and 14 bases an inverse contract beside their USDT-M one, P2.
A `marketFilter` on `settleCurrency` `USDT` keeps one row per base.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply and time from this host |
|---|---|---|---|---|---|---|
| `GET /api/v1/market/mark-price` | `indexPrice`, by BloFin's reference | `markPrice`, by BloFin's reference | absent | absent | absent | refused on all 12 tries, P2 and P2c |
| `GET /api/v1/market/funding-rate` | absent | absent | `fundingRate` | absent | `fundingTime`, Unix ms | 381 rows, 33,805 bytes, 150 ms when let through, P2 |
| `GET /api/v1/market/tickers` | absent | absent | absent | absent | absent | 381 rows, 95,353 to 95,470 bytes, 140 to 362 ms when let through, P1 and P2 |

The `funding-rate` reply carries three fields per row, `instId`, `fundingRate` and `fundingTime`, for all 381 instruments, P2.
380 rows named 2026-10-10 08:00 UTC as `fundingTime`, and `KAIA-USDT` named 05:00 UTC, so at least one contract runs on a shorter interval, P2.
Rates ran from `-0.0017924318944347586` on one contract to `0.000409911113778312`, and `BTC-USDT` showed `"0.0000738"`, P2.
The `tickers` reply has `askPrice`, `askSize`, `bidPrice`, `bidSize`, `high24h`, `instId`, `last`, `lastSize`, `low24h`, `open24h`, `ts`, `vol24h` and `volCurrency24h`, and no index, mark or funding, P2.
The `mark-price` call was never let through, so its fields on BlockFin are not seen, P2.
CoinMarketCap carries an `indexPrice`, an `indexBasis` and a `fundingRate` for all 319 pairs it lists, P3, but it is a third party that refreshes every few minutes and is not an anchor source.

### Row mapping

| `AnchorRow` column | field | note |
|---|---|---|
| key | `instId` | the catalog id |
| `index` | `mark-price` `indexPrice` | Not seen on BlockFin, by BloFin's reference only |
| `mark` | `mark-price` `markPrice` | Not seen on BlockFin, by BloFin's reference only |
| `funding_rate` | `funding-rate` `fundingRate` | decimal string, P2 |
| `funding_interval_hours` | none | no bulk field, as on BloFin |
| `next_funding_at` | `funding-rate` `fundingTime` | string of Unix ms, a future instant on all 381 rows, P2 |

The row shape is the one in [`../../../server/src/feeds/anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 27.

## 4. Anchor semantics

Nothing here could be measured beyond one funding reply, and BlockFin's docs page answers the restricted region page.

| number | what can be said | not verified |
|---|---|---|
| index | CoinMarketCap's index for 307 of 310 shared pairs equalled BloFin's in rows stamped 2 s apart, so BlockFin likely uses BloFin's index, P3 | the basket and its weights |
| mark | Not publicly specified | the formula and any clamp |
| funding rate | CoinMarketCap's funding rate for 309 of 310 shared pairs equalled BloFin's in the same rows, P3 | the formula, the cap and the floor |
| interval | 380 contracts settle at 08:00 UTC and `KAIA-USDT` at 05:00 UTC, P2 | the interval per contract |
| upcoming or settled | every `fundingTime` was in the future, so the pair names the coming settlement, P2 | whether `fundingRate` is the estimate for it or the last settled rate |
| change rate | not measured | |

## 5. REST book snapshot

BloFin's reference names `GET /api/v1/market/books?instId=` with a `size` up to 100, see [`../blofin/rest.md`](../blofin/rest.md) section 5.
On BlockFin `/api/v1/market/books?instId=BTC-USDT&size=5` was refused on both hosts, P1.

## 6. Rate limits and errors

BlockFin publishes no rate limit that this host could read.
BloFin's are 500 requests a minute per IP on public REST, with a 5 minute ban on a breach, see [`../blofin/rest.md`](../blofin/rest.md) section 6.
The probes stayed at two requests a second or slower.
An unknown path on `openapi.blockfin.com`, when let through, answered HTTP 200 with `{"code":"401","msg":"Unauthorized"}`, so errors arrive under HTTP 200 as on BloFin, P2.
Rate limit headers were not recorded.

## 7. Server time and clock offset

BloFin documents no public server time call, see [`../blofin/rest.md`](../blofin/rest.md) section 7, and none was tried on BlockFin.
The `ts` field of the ticker rows is the only clock on the wire, P2.

## 8. Recommended poller shape

A recommendation for a host that BlockFin serves, not a decision.
From this host no poller can run, because most calls are refused and `mark-price` was refused on all 12 tries.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://openapi.blockfin.com/api/v1/market/mark-price` and `https://openapi.blockfin.com/api/v1/market/funding-rate`, both without `instId` | the BloFin pair that carries index, mark, rate and settlement time, and the second was seen working here |
| interval | 1,000 ms | under BloFin's 500 a minute |
| funding interval | per contract, from a history call or the gap between settlement times | no bulk field |
| `marketFilter` | `settleCurrency` `USDT` | drops the USDC and inverse duplicates |
| error body | treat `code` other than `"0"` as a failed round | errors arrive under HTTP 200 |
| verify first | the `mark-price` fields, the mark clamp, the funding cap, and whether the books are BloFin's | none could be read here |

Verdict for the engine: BlockFin is blocked from this exit.
Its catalog and funding calls work in BloFin's shape when the edge lets them through, but the edge refuses most calls and every socket, and the venue says Canada is a restricted region.
If BlockFin is a second front end on BloFin's books, it adds no new price to compare, which a later design would settle first.

## 9. Source ledger

| id | source | retrieved | covers |
|---|---|---|---|
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/blockfin/rest-probe.py) mode `access` | 2026-10-10 04:15 UTC | DNS, exit, every page and API path, the refusal page |
| P2 | `rest-probe.py` mode `repeat`, two runs | 2026-10-10 04:16 and 04:18 UTC | how often the refusal lets calls through, the catalog, funding and ticker replies |
| P2c | `rest-probe.py` mode `all`, second pass | 2026-10-10 04:35 UTC | every mode rerun, with the Cloudflare trace |
| P3 | `rest-probe.py` mode `cmc` | 2026-10-10 04:15, 04:19, 04:35, 04:36 and 04:38 UTC | CoinMarketCap counts, fees, index and funding, and the BloFin comparison |
| P4 | `rest-probe.py` mode `ccxt` | 2026-10-10 04:15 UTC | CCXT 4.5.68 here and CCXT master |
| S2 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=blockfin` | 2026-10-10 | launch date 2024-03-06, maker and taker, website |
| S3 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=blockfin&category=perpetual` | 2026-10-10 | 319 perpetual pairs with index and funding |
| S5 | CoinMarketCap market pairs for BloFin, the same call with `slug=blofin` | 2026-10-10 | 472 BloFin perpetual pairs for the comparison |
| S6 | [`../blofin/`](../blofin/), BloFin's API reference as recorded there, cited in place by file and section | 2026-09-22 | path shapes, fields, limits |
| S7 | Web search result for a Koinly feedback post, `https://feedback.koinly.io/integrations/p/add-blockfin-integration-same-api-structure-as-blofin` | 2026-10-10 | the claim of a shared API, which the post itself no longer shows |
