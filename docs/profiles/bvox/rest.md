# BVOX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:16 to 03:45 UTC, from the development host near Seattle, which Cloudflare places in Canada (`loc=CA`, colo `YVR`).
No BVOX host served this machine anything but a region refusal page, a 404 or a 503.

This profile covers the public REST surface of BVOX, formerly BitVenus, for its perpetuals.
BVOX runs on the BHEX broker platform, see [`fees.md`](./fees.md) section 1, and has no CCXT class.
Every live claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/bvox/rest-probe.mjs).
The catalog facts come from BVOX's own web app replies as the Internet Archive stored them before the refusal page went up, and each is marked as archived.
The BHEX open API paths were tried because the BHEX documentation names them, and BVOX never published them as its own on any page this host could read.

## 1. Host and latency from this machine

| host | resolved | what it served |
|---|---|---|
| `www.bvox.com`, `bvox.com`, `futures.bvox.com` | 104.18.18.185, 104.18.19.185, Cloudflare | `/` is 200, 33,223 bytes, the region refusal page with `Last-Modified: Mon, 24 Aug 2026 13:13:45 GMT`. Every API and documentation path tried is 404, a 335 byte page titled `Error response` that reads `Message: File not found.` |
| `www.bvox.io` | 104.18.4.124, 104.18.5.124, Cloudflare | the same refusal page at `/` |
| `www.bitvenus.me` | 104.18.14.208, 104.18.15.208, Cloudflare | the same refusal page at `/`, and the 335 byte 404 on `/docs/v1/intro`, the API documentation link CoinGecko publishes |
| `www.bitvenus.com` | 104.18.0.156, 104.18.1.156, Cloudflare | 307 to `https://www.bvox.com/` |
| `api.bvox.com`, `api.bitvenus.me` | Cloudflare | 404, a 146 byte nginx page, on every path tried |
| `api.bvox.io`, `ws.bvox.com` | Cloudflare | the same 146 byte nginx 404 at `/` |
| `wsapi.bvox.com`, `wsapi.bitvenus.me` | Cloudflare | 503 `Service Temporarily Unavailable`, a 190 byte nginx page, on `/openapi/quote/ws/v1` and `/openapi/ws/`, and the 146 byte 404 elsewhere |
| `www.bitvenus.live` | a CNAME into Tencent EdgeOne, `eo.dnse4.com`, with no address | `ENOTFOUND` |
| `static.bvox.io` | CloudFront | 403 at `/` |

Every `bvox.com` subdomain tried resolved to the same Cloudflare pair, including `docs`, `apidoc`, `openapi`, `support`, `help`, `fapi` and `m`, and each answered the 146 byte nginx 404 at `/`.
So the zone has a wildcard record, and resolving is not evidence that a host serves anything.

Under a "Notice" heading the refusal page reads "Services are temporarily unavailable in your region. Current IP: Not Support Region. Please contact customer support.", and every link on it has `href="#"`.
A click on any link only shows a toast that reads "Not Support Region".
The same page came back through a fetch that does not originate here, and the Internet Archive stored it on 2026-09-02 and 2026-09-11, see [`fees.md`](./fees.md) section 1.

Timing of `GET https://www.bvox.com/` in P1: 294, 316 and 350 ms on a new connection in three runs, and 111 to 116 ms warm over the six timing requests of each run.
The API hosts answered their 404 in 110 to 168 ms warm.

## 2. Catalog

### The instruments call

No catalog call answers this host.

| call | origin | reply to this host |
|---|---|---|
| `GET /openapi/v1/contracts` | BHEX open API template, S2 | 404 on `api.bvox.com`, `www.bvox.com` and `api.bitvenus.me` |
| `GET /openapi/v1/brokerInfo?type=future` | BHEX open API template, S2 | 404 on the same three hosts |
| `GET /openapi/quote/v1/contracts` | named in the archived web app bundle as `openInterest`, S5 | 404 on `www.bvox.com` |
| `GET /api/contract/symbol-newest/list?categories=FUTURES,COIN` | called by the web app, archived 2026-08-19, S4 | 404 on `www.bvox.com` |
| `GET /s_api/basic/config_v2_js?tab=exchange&type=all&platform=1` | called by the web app, archived 2026-08-02, S6 | 404 on `www.bvox.com` |

### Archived catalog shape

BVOX's config reply archived on 2026-08-02 listed 97 perpetuals in `futuresSymbol`, S6.
All 97 are margined and quoted in USDT, none has `isReverse` true, all have `canTrade` true, and no symbol appears twice.
CoinGecko listed 389 perpetuals on 2026-09-23 and returned 388 ticker rows, which hold all 97 plus 290 more symbols, see [`fees.md`](./fees.md) section 3.

One row of the catalog reply archived on 2026-08-19, trimmed to the fields the engine would read.

```json
{"symbolId":"HYPE-SWAP-USDT","symbolName":"HYPEUSDT","exchangeId":301,"quoteTokenId":"USDT","basePrecision":"1","minPricePrecision":"0.001","canTrade":true,"isReverse":false,"category":4,"baseTokenFutures":{"contractMultiplier":"0.1","coinToken":"USDT","maxLeverage":"75","feeConfig":{"makerBuyFee":"0.0002","makerSellFee":"0.0002","takerBuyFee":"0.0006","takerSellFee":"0.0006"},"overPriceRange":["-0.05","0.05"],"marketPriceRange":["-0.15","0.15"],"indexToken":"HYPEUSDT","settlementDate":2145888000000}}
```

| engine need | what the archive shows |
|---|---|
| `market.id` | `symbolId`, as `BTC-SWAP-USDT`, is what the web app's kline call and CoinGecko's tickers use. `symbolName` drops `-SWAP-`, as `BTCUSDT`, on 97 of 97 rows |
| `contractSize` | `contractMultiplier`: 0.0001 on 1 contract, 0.001 on 2, 0.01 on 5, 0.1 on 15, 1 on 44, 10 on 22, 100 on 5, 1,000 on 2 and 100,000 on 1. `BTC-SWAP-USDT` is 0.0001 |
| size unit | `basePrecision` `"1"` and `minTradeQuantity` `"1"`, so orders are whole contracts. The unit a book would report is Not verified |
| `linear` | every contract settles in USDT, so linear |
| `active` | `canTrade` and `showStatus`, both true on 97 of 97 |
| price scale | `1000BONK`, `1000FLOKI`, `1000PEPE`, `1000SATS` and `1000SHIB` carry the prefix other venues use for a price per 1,000 tokens, and CoinGecko read `1000PEPE-SWAP-USDT` at a last price of 0.005 against an index of 0.00493993, so they would need the price scale of `clusterOverrides.ts` |
| CCXT mapping | none, since CCXT has no class, see [`fees.md`](./fees.md) section 8 |

## 3. Anchor

No anchor call answers this host.

| call | origin | reply to this host |
|---|---|---|
| `GET /openapi/quote/v1/contract/index` | BHEX open API template, S2 | 404 on three hosts |
| `GET /openapi/contract/v1/fundingRate` | BHEX open API template, S2 | 404 on three hosts |
| `GET /openapi/quote/v1/contract/ticker/24hr?symbol=BTC-SWAP-USDT` | BHEX open API template, S2 | 404 on three hosts |
| `GET /api/contract/funding_rates` | named in the archived web app bundle, S5 | 404 on `www.bvox.com` |

BVOX does compute an index and a funding rate per contract, because CoinGecko's ticker rows carry both, S3.
At about 03:30 UTC on 2026-09-23, `BTC-SWAP-USDT` read `last` 86,443.7, `index` 86,485.23 and `funding_rate` 0.
No mark price appears in any reply or archive read, so the `mark` column has no known source.
No `AnchorRow` column can be filled from this host.

## 4. Anchor semantics

Each archived contract names its index as `indexToken`, spelled `<BASE>USDT`, S4 and S6.
The index formula and basket are Not verified.
The web app's `s_api/basic/index_config` reply, archived 2026-06-16, is the home page configuration and holds no index basket, S8.
Each archived contract also carries an `overPriceRange` of plus or minus 0.02 to 0.05 and a `marketPriceRange` of plus or minus 0.005 to 0.2, and 40 of the 97 carry 0.05 and 0.15, S6.
Their meaning is not documented, and they read like order price bands, which is an inference.
No mark formula, clamp, funding formula, cap or interval could be read, see [`fees.md`](./fees.md) section 6.

CoinGecko's `index_basis_percentage` across the 388 rows had a median absolute value of 0.237 % and a 90th percentile of 1.452 %, S3.
Whether a number changes once a second could not be measured.

## 5. REST book snapshot

`GET /openapi/quote/v1/contract/depth?symbol=BTC-SWAP-USDT&limit=20`, the BHEX template, returned 404 on `api.bvox.com`, `www.bvox.com` and `api.bitvenus.me`.
Depth limits, level order and caching are Not verified.

## 6. Rate limits and errors

About 50 GET requests per run, spaced 300 ms apart, drew no 403, 418 or 429 in any of the three runs.
No reply carried a `Retry-After` header, the 503s on `wsapi` included.
No error body in JSON came back, since no API route answered.

## 7. Server time and clock offset

`GET /api/quote/v1/time` and `GET /openapi/v1/time` return 404 to this host.
The Internet Archive stored the web app's reply to the first on 2026-08-01 as `{"serverTime":1785612399966}`, S7, so the shape is known and the offset is not.

## 8. Recommended poller shape

None.
BVOX cannot join the engine as a perpetual leg in its current shape, for three reasons.

1. It refuses this host: the site serves a region refusal page, and every API and socket path answers 404 or 503.
2. Its registration list of 2025-04-21 leaves out the United States and Canada, see [`fees.md`](./fees.md) section 1.
3. CCXT has no class for it, and its own API documentation link is dead, so neither the catalog nor the anchor has a documented public call.

A route around the refusal is out of scope, so nothing further was tried.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinGecko exchange page, BVOX | https://www.coingecko.com/en/exchanges/bvox | 2026-09-22 | CoinGecko | API documentation link `https://www.bitvenus.me/docs/v1/intro`, section 1 |
| S2 | BHEX OpenApi, `doc/Contract API EN.md` and `doc/endpoint.md` | https://github.com/bhexopen/BHEX-OpenApi/tree/master/doc | 2026-09-23 | BHEX platform, not BVOX | the template paths tried, sections 2, 3 and 5 |
| S3 | CoinGecko API, derivatives exchange `bitvenus` with tickers | https://api.coingecko.com/api/v3/derivatives/exchanges/bitvenus?include_tickers=unexpired | 2026-09-23 03:30 UTC | CoinGecko | ticker count, index and funding fields, basis, sections 2 to 4 |
| S4 | BVOX web app catalog reply, archived 2026-08-19 | https://web.archive.org/web/20260819011814id_/https://www.bvox.com/api/contract/symbol-newest/list?categories=FUTURES,COIN | 2026-09-23 | BVOX, via Internet Archive | row shape, `symbolId`, `contractMultiplier`, price ranges, sections 2 and 4 |
| S5 | BVOX web app bundle `main-be17c5a6.297cc435.chunk.js`, archived 2025-09-14 | https://web.archive.org/web/20250914055128id_/https://www.bitvenus.me/static/js/main-be17c5a6.297cc435.chunk.js | 2026-09-23 | BVOX, via Internet Archive | `/openapi/quote/v1/contracts`, `/contract/funding_rates`, socket paths, sections 2 and 3 |
| S6 | BVOX web app config reply `s_api/basic/config_v2_js`, archived 2026-08-02 | https://web.archive.org/web/20260802151113id_/https://www.bvox.com/s_api/basic/config_v2_js?custom_keys=loginReg,analytics&callback=window.__set_config&tab=exchange&type=all&platform=1&without_country=true | 2026-09-23 | BVOX, via Internet Archive | 97 perpetuals and their fields, section 2 |
| S7 | BVOX web app time reply, archived 2026-08-01 | https://web.archive.org/web/20260801192639id_/https://www.bvox.com/api/quote/v1/time | 2026-09-23 | BVOX, via Internet Archive | `serverTime` shape, section 7 |
| S8 | BVOX web app home configuration `s_api/basic/index_config`, archived 2026-06-16 | https://web.archive.org/web/20260616143125id_/https://www.bvox.com/s_api/basic/index_config?preview=false | 2026-09-23 | BVOX, via Internet Archive | no index basket, section 4 |
| P1 | `rest-probe.mjs`, runs at 03:25, 03:38 and 03:40 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bvox/rest-probe.mjs) | 2026-09-22 local | this host, Cloudflare `loc=CA` | sections 1 to 3 and 5 to 7 |
