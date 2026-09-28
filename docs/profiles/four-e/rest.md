# 4E REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:40 to 06:50 UTC by the host clock, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=YVR`).

4E publishes no REST API documentation, and no host answered a market data call without the web client's signature.
This profile records what was checked, with every URL and reply, so a later survey can see where the search stopped.
Every number below is from [`rest-probe.mjs`](../../../scripts/probes/venues/four-e/rest-probe.mjs) unless it names another source.

## 1. Host and latency from this machine

All hosts sit behind Cloudflare and resolved to `104.20.44.95` and `172.66.157.55` on 2026-09-24.
Every reply carried a `cf-ray` ending in `YVR`.

| host | cold ms | warm ms | root reply |
|---|---|---|---|
| `www.eeee.com` | 374 | 170 | 200, the site's HTML |
| `api.eeee.com` | 381 | 158 | 200, `{"status":-122,"source":"API","msg":"FAIL","data":[],...}` |
| `app.eeee.com` | 336 | 160 | 200, `{"status":-122,"source":[20],"msg":"无访问权限",...}` ("no access permission") |
| `appuc.eeee.com` | 420 | 165 | 200, `{"status":-122,"source":[11],"msg":"无访问权限",...}` |
| `apiuni.eeee.com` | 319 | 155 | 200, `{"status":10001,"source":[50],"msg":"路由不存在",...}` ("route does not exist") |
| `contract.eeee.com` | 323 | 158 | 200, `{"status":10001,"msg":"路由不存在",...}` |
| `hcapi.eeee.com` | 191 | 166 | 200, an HTML page, the help centre CMS |
| `openapi.eeee.com`, `ws.eeee.com` | | | do not resolve |

A manual curl of `https://www.4e.com` and `https://4e.com` got 301 to `https://baidu.com/`, so they are not the venue's host.

Access through the Canadian exit: no refusal, no 403, no geoblock page.
The public bootstrap `POST https://www.eeee.com/Site/config` answered 200 with 16,113 bytes, `country_code2` `CA` and `is_specific_country_ip` false.
4E refuses registration from the United States and sixteen other regions, see [`fees.md`](./fees.md) section 1, and no endpoint here was refused, because none returns market data at all.

## 2. Catalog

### The instruments call

Not published.
The web client lists perpetuals with `POST https://app.eeee.com/MarketV2/contractFuturesList`, which the web bundle `https://www.eeee.com/js/app.78077933.js` signs with `app_id`, a six digit nonce and `_CDCODE`, an MD5 over the sorted parameters and an application key.
The key and id arrive in `app_info`, a two element array in the `/Site/config` reply, which the probe redacts and never uses.
Unsigned, the web calls answer HTTP 200 with an error envelope and empty data:

| call | reply |
|---|---|
| `POST app.eeee.com/MarketV2/contractFuturesList` | `{"status":-101,"msg":"app_id 参数错误","data":[]}` ("app_id parameter error") |
| `POST app.eeee.com/Publics/getWebInitInfo` | same |
| `POST app.eeee.com/Contract/getFundingRate` | same |
| `POST app.eeee.com/Web/Kline/orderbook` | `{"status":-122,"msg":"无访问权限","data":[]}` |

Six guessed public paths on `api.eeee.com` (`/v1/ticker`, `/api/v1/ticker`, `/api/v1/contracts`, `/Market/ticker`, `/openapi/v1/depth`, `/api/v1/depth?symbol=BTCUSDT`) answered 200 with `source` `API`, `msg` `FAIL` and `status` -122, -136 or -137, with no data.
The meaning of those codes is Not publicly specified.

### Perpetual count

The venue could not be asked.
CoinMarketCap's public data API listed 47 perpetual pairs, all quoted in USDT, at 2026-09-24 06:45 UTC: PUMP, ENA, ADA, DOGE, PEOPLE, POL, ARB, XRP, WIF, OP, FIL, WLD, NEAR, TIA, APT, SAGA, DOT, CRV, SEI, AVAX, ETHFI, LINK, ASTER, TRX, AVNT, PENDLE, ZRO, INJ, SOL, APE, UNI, LTC, ETC, ORDI, STX, CAKE, SUI, JTO, ETH, METIS, HYPE, AAVE, TRUMP, BCH, BNB, BTC and NOT.
It reported open interest 0 on all 47.
It listed 94 spot pairs and 0 dated futures.

### How CCXT maps it

CCXT 4.5.68 has no 4E class, and the GitHub listing of CCXT master `ts/src` on 2026-09-24 had none, see [`fees.md`](./fees.md) section 8.
So `market.id`, `contractSize`, `linear` and `active` do not exist for this venue.

## 3. Anchor

No public call returns index, mark or funding.
The web client reads funding from `POST app.eeee.com/Contract/getFundingRate` and `/Futures/Trace/getFundingRate`, both signed, and the first answered `app_id 参数错误` unsigned.
CoinMarketCap's feed carries an index price and a funding rate per pair, for example BTC/USDT `indexPrice` 84121.66 against `price` 84116.996 at 06:45 UTC, but that is a third-party copy refreshed about once a minute, not an anchor.

## 4. Anchor semantics

From the help article "Mark Price and Index Price", updated 2024-04-15, S1.

- Index: a weighted average of spot prices on Binance, OKX and Huobi, `Index Price = Σ (exchange weight / total weight × exchange spot price)`, and "4e updates the components of the index price periodically".
  The weights and a basket call are Not publicly specified.
- Mark: `Median(Price 1, Price 2, Last Traded Price)`, where `Price 1 = Index × (1 + Funding Rate × time to next funding / funding interval)` and `Price 2 = Index + 5 min moving average of (mid − Index)`.
  No clamp is published.
- Funding: every 8 h at 00:00, 08:00 and 16:00 UTC, see [`fees.md`](./fees.md) section 6.
  The rate formula, its cap, and whether a published rate is the upcoming or the last settled one are Not publicly specified.
- CoinMarketCap showed 0.0004 on all 47 perpetuals, a constant, see [`fees.md`](./fees.md) section 6.
- How often each number changes could not be measured.

## 5. REST book snapshot

Not reachable.
The web client uses `POST app.eeee.com/Web/Kline/orderbook`, which answered `无访问权限` unsigned.

## 6. Rate limits and errors

Rate limits are Not publicly specified.
The probe sent 32 requests in about 12 s and drew no 429 or 403.
Every error seen came as HTTP 200 with a JSON envelope `{status, msg, data}`, where `status` was -101, -122, -136, -137 or 10001.

## 7. Server time and clock offset

No time call is published.
The `api.eeee.com` error envelope carries `seconds` and `microtime` in Unix seconds and ms, for example `"seconds":1790232473,"microtime":1790232473404`, and three curl reads at 06:50 UTC put it 96, -10 and 16 ms from the midpoint of round trips of 349, 292 and 187 ms, so the offset is inside the round trip.
The `apiuni` and `contract` envelopes carry `extend.date` as `2026-09-24 14:47:55`, which is UTC+8.

## 8. Recommended poller shape

None.
4E publishes no API, so there is nothing to poll.
The only route to its data is imitating the signed web client with its embedded key, and the survey does not recommend building on that.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Mark Price and Index Price, updated 2024-04-15 | https://hcapi.eeee.com/api/news/159?locale=en | 2026-09-24 | 4E, global | section 4 |
| S2 | 4E web client bundle `app.78077933.js`, read with grep for request signing and API paths | https://www.eeee.com/js/app.78077933.js | 2026-09-24 | 4E | sections 2, 3 and 5 |
| S3 | 4E site bootstrap `POST /Site/config` | https://www.eeee.com/Site/config | 2026-09-24 | 4E | hosts, country, `app_info` shape, sections 1 and 2 |
| S4 | CoinMarketCap data API, perpetual, futures and spot pairs for slug `4e` | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=4e&category=perpetual | 2026-09-24 | third party | sections 2 to 4 |
| S5 | 4E help centre English article list, 375 articles, none titled with API | https://hcapi.eeee.com/api/news?locale=en | 2026-09-24 | 4E, global | no API documentation |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/four-e/rest-probe.mjs), run at 06:47 UTC | | 2026-09-24 | this host, Canadian VPN exit | sections 1, 2, 6 and 7 |
