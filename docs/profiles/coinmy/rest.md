# CoinMy REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:36 to 05:00 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada (Cloudflare trace `loc=CA`, `colo=YVR`), so every access result below is what a Canadian address saw.

This profile covers the public REST surface of CoinMy, which has no CCXT class, for its USDT margined perpetuals.
No open API host for CoinMy could be found, so every working call here is a call the web app makes to its gateway without a login.
Every measured number comes from [`rest-probe.py`](../../../scripts/probes/venues/coinmy/rest-probe.py), named by mode below.
Source ids are shared with [`fees.md`](./fees.md) and [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| item | value |
|---|---|
| platform | ChainUp white label. The documentation CoinMarketCap links, S1, is ChainUp's generic open API page with `openapi.xxx.com` and `futuresopenapi.xxx.com` as placeholder hosts, and the web app's contract ids, `E-BTC-USDT`, and socket channels, `market_e_btcusdt`, are ChainUp's |
| web gateway | `https://api.cmgatewayapi.com`, the axios `baseURL` in the web bundle, S7. It resolved to Cloudflare, `104.21.92.206` and `172.67.198.83` |
| open API | not found. `openapi.coinmy.com`, `futuresopenapi.coinmy.com`, `openapi.cmgatewayapi.com` and `futuresopenapi.cmgatewayapi.com` have no DNS record. `/sapi/v1/time`, `/fapi/v1/contracts`, `/spot/open/sapi/v1/time`, `/futures/open/fapi/v1/time` and `/futures/open/fapi/v1/contracts` on `api.coinmy.com` and `api.cmgatewayapi.com` all answered 404, P1 `access` |
| configured open API page | the web config's `open_api_url` is `www.coinmy.com/exchange-open-api`, which renders the home page and names no host, P1 `catalog` |
| cold request | `POST /futures/api/common/public_info` 313 and 324 ms in the two runs |
| warm request | the same call ten times: median 301 and 308 ms, p90 348 and 365 ms |
| edge | `Server: cloudflare`, `cf-ray` ending in `YVR`, `cf-cache-status: DYNAMIC` |
| access | the root page `https://www.coinmy.com/en-us` answered 403 with Cloudflare's "Suspected Misleading Website" interstitial, a phishing warning on the domain, in both runs. `/en-us/my-rate`, `/en-us/futures/E-BTC-USDT` and `https://m.coinmy.com/` answered 200, and so did every gateway call below. No geoblock was seen |

The gateway is a web backend, not a published API.
Its public calls need no login, but each needs the header `exchange-language`, which the web app always sends, S7.
Without it the futures web list answers HTTP 200 with `{"code":"200002","msg":"系统异常"}` (system error) in 78 bytes, in both runs, P1 `access`.
Other bad requests also answer HTTP 200 with a code in the body, such as `"200008"` "不支持的请求方法" (unsupported method) for a GET, and `10002` "用户未登录" (not logged in) for a path it does not serve publicly, P1 `access`.

The gateway was not steady in manual calls, which the probe did not reproduce.
At about 04:45 UTC, after about forty calls in a few minutes from this host, the futures web list answered the same `200002` for a few minutes even with `exchange-language` set.
One earlier manual call answered HTTP 406 with an empty body.
Both cleared without any change on this side, so the cause is Not publicly specified, and a poller would have to treat `200002` as a retryable refusal.

## 2. Catalog

### The futures web list

`POST https://api.cmgatewayapi.com/futures/api/common/public_info` with body `{}` and the header `exchange-language: en_US` returned 50,747 bytes, P1 `catalog`.

| item | value |
|---|---|
| contracts | 53 |
| `contractType` | `E` on all 53, perpetual |
| `contractSide` | 1 on all 53, linear |
| `marginCoin` | USDT on all 53, and `marginCoinList` is `["USDT"]` |
| crypto and TradFi | 30 crypto and 23 TradFi: stocks, pre-IPO names, the `EWY` ETF, gold, silver, platinum, palladium and two oil contracts |
| status field | none. The list carries no status, so all 53 are listed as open |
| `subSymbol` | `e_` plus lower case base and quote on 53 of 53, the socket spelling |
| `contractName` | `E-<base>-<quote>` on 53 of 53, the catalog spelling |
| `multiplier` | the base amount of one contract, with `multiplierCoin` equal to the base on 53 of 53, such as 0.0001 BTC, 0.01 ETH, 100 ADA and 0.01 oz XAU |
| `depthList` | socket depth steps, finest first, and the first step equals `10^-symbolPricePrecision` on 53 of 53 |
| `capitalFrequency` | 8 on all 53, the funding interval in hours |
| `nextCapitalSettTime` | 2026-09-09 08:00 UTC on all 53, 31 days before the probe |
| `maxLever` | 20 to 150 |

There is no CCXT market to map, see [`fees.md`](./fees.md) section 8.
A catalog would come from this list, with `contractName` as the catalog id and `subSymbol` as the socket id, and `multiplier` as the contract size, since the ChainUp book sizes of the sibling venues are in contracts.

### The spot web list, for the coverage matrix

`POST https://api.cmgatewayapi.com/spot/api/common/public_info_v7` with body `{}` returned 126,057 and 126,100 bytes in 2,065 and 2,081 ms, with 29 USDT pairs, all `isShow` 1, P1 `catalog`.
The pairs are AAVE, ADA, APT, ATOM, AVAX, BCH, BERA, BTC, CM, CRV, DOGE, DOT, ENS, ETC, ETH, INJ, IO, JTO, JUP, LTC, ONDO, PYTH, SOL, TRUMP, TRX, UNI, VIRTUAL, WLD and XRP against USDT.
CoinMarketCap says "over 230 cryptocurrency trading pairs", S3, and the web list holds 29.

## 3. Anchor

No REST call returns index, mark or funding for every perpetual at once, because no open API was found.
The documented ChainUp call `GET /fapi/v1/index?contractName=`, S1, returns one contract per call and could not be reached on any CoinMy host.

The only source is the socket ticker `market_e_<sub>`, one contract per subscription, see [`websocket.md`](./websocket.md) section 2.

| `AnchorRow` column | field | observed |
|---|---|---|
| `index` | `index_price` in the ticker | moves, such as 82,677.8 at 04:46 UTC and 82,709.1 at 04:55 UTC on BTC, P2 `futures` |
| `mark` | `sign_price` in the ticker | far from the index on most contracts, a median of 105,511 and 104,245 ppm off across 31 contracts in the two runs |
| `fundingRate` | `funding_rate_next` in the ticker | equal to `funding_rate_last` on every contract seen |
| `fundingIntervalHours` | `capitalFrequency` in the futures web list | 8 |
| `nextFundingAt` | `nextCapitalSettTime` in the futures web list | stuck at 2026-09-09 08:00 UTC |

The ticker reached 31 of 53 contracts in 40 s in both runs, so a ticker anchor would leave 22 contracts with no reading.

## 4. Anchor semantics

| item | value | source |
|---|---|---|
| index formula and basket | Not publicly specified, and no basket call was found | S1, S4 |
| mark formula and clamps | Not publicly specified. The project gitbook promises "Reasonably designed mark price mechanisms" and nothing more | S4 |
| funding formula and cap | Not publicly specified | S1, S4 |
| upcoming or last settled | the ticker sends both fields and they were equal on every contract seen | P2 `futures` |
| change over about a minute | the BTC ticker arrived about once a second, and its index moved while `close` and both funding fields stayed fixed | P2 `futures` |

On 8 of the 31 contracts the mark equalled or nearly equalled the index, including every stock and metal contract seen, where the gap was 0 ppm.
On the other crypto contracts the mark sat between 21,514 and 378,480 ppm below the index in the first run, and between 21,527 and 378,313 ppm in the second, P2 `futures`.
With no trades since late August, see [`websocket.md`](./websocket.md) section 4, the mark looks anchored to stale book prices or to a stopped premium, and it would fail the reader's 1,000 ppm and freshness checks on most contracts.

## 5. REST book snapshot

None.
The documented `GET /fapi/v1/depth` and `GET /sapi/v1/depth`, S1, could not be reached on any CoinMy host, P1 `access`.
The web app takes its books from the socket only, S7.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| documented limits | HTTP 429 for a rate limit and 418 for an IP ban after repeated 429s, with per call limits such as "20times/2s" on private calls | S1 |
| gateway limits | Not publicly specified. The transient `200002` and 406 replies in section 1 are the only refusals seen | P1 |
| error shape | HTTP 200 with `{"code":"<code>","msg":"…","data":null,"succ":false}`, and the code is a string on the spot and futures web lists and a number for the not logged in reply | P1 `access` |
| `Retry-After` | never seen | P1 |

## 7. Server time

The futures web list carries `currentTimeMillis`, and the spot web list carries `sysTime`, P1 `catalog`.
The documented `GET /sapi/v1/time` could not be reached.
The clock offset was not measured.

## 8. Recommended poller shape

No poller is recommended.
The perpetual market has no book and no trades, see [`websocket.md`](./websocket.md) section 4, and no open REST API exists to poll.

If the perpetuals trade again, the engine's ChainUp family adapter already reads a socket ticker anchor for Aivora, `AnchorSource::AivoraTicker` at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 56, which reads `sign_price`, `index_price` and `last_fund_rate_third` from `market_<sub>`.
A CoinMy profile would take the same shape, with `Schedule::PublicInfo` pointed at the futures web list, but three things would need checking first.

- The schedule loader would have to send `exchange-language` on the web list call and retry on `200002`.
- `nextCapitalSettTime` would have to move again, since today it is a month stale.
- CoinMy's ticker had no `last_fund_rate_third` and no `admin_fund_rate_source` in any frame, so the funding field would be `funding_rate_next`, which `AivoraTicker` does not read.

## 9. Source ledger

| id | source | URL | retrieved | entity | used for |
|---|---|---|---|---|---|
| S1 | ChainUp white label open API documentation, English pages "Documentation description", "Futures Trading API" and "Spot Trading API" | https://exchangeopenapi.gitbook.io/pri-openapi/openapi-doc/documentation-description | 2026-10-09 | generic, linked from CoinMarketCap as CoinMy's API | sections 1, 3, 5, 6 and 7 |
| S3 | CoinMarketCap exchange page for CoinMy | https://coinmarketcap.com/exchanges/coinmy/ | 2026-10-09 | CoinMarketCap | section 2 |
| S4 | CoinMy project gitbook, pages "Perpetual Futures" and "Open Trading API" | https://coinmy.gitbook.io/coinmy/product-functions/perpetual-futures | 2026-10-09 | CoinMy | section 4 |
| S7 | CoinMy web bundle, chunk 9794 with the gateway `baseURL` and the request headers | https://www.coinmy.com/_next/static/chunks/9794-b9177d30deaaff7d.js | 2026-10-09 | CoinMy | sections 1, 5 and 8 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/coinmy/rest-probe.py) modes `access`, `catalog`, `fees` and `latency` | [`rest-probe.py`](../../../scripts/probes/venues/coinmy/rest-probe.py) | 2026-10-10 UTC | this host, Canadian exit | sections 1, 2, 6 and 7 |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/coinmy/ws-probe.py) mode `futures` | [`ws-probe.py`](../../../scripts/probes/venues/coinmy/ws-probe.py) | 2026-10-10 UTC | this host, Canadian exit | sections 3 and 4 |
