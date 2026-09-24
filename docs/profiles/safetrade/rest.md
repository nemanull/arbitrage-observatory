# SafeTrade REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:41 to 04:57 UTC), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that Cloudflare places in Canada.
Every SafeTrade API path answered HTTP 403 with SafeTrade's notice that it does not serve Canadians, so no SafeTrade reply was read.

SafeTrade publishes no REST documentation.
Its help center promised "New documentation will be provided for future API development" in 2023, and none of its 107 articles holds it, S2.
The paths below come from its example client, S1, from public integrations that call it, S7, and from the Openware stack it runs on, S4.
It lists no perpetual, so this profile covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
[`rest-probe.mjs`](../../../scripts/probes/venues/safetrade/rest-probe.mjs) recorded what this host got, and [`archive-probe.mjs`](../../../scripts/probes/venues/safetrade/archive-probe.mjs) decoded the catalog the web app embedded in pages the Internet Archive captured.
No route around the refusal was tried.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| API host | `safe.trade`, base `https://safe.trade/api/v2`, kept "for various technical purposes such as our API" after the move to `safetrade.com` in 2024 | S1, S3 |
| `safe.trade` | 104.26.12.76, 104.26.13.76 and 172.67.74.197, and three `2606:4700:20::` addresses, Cloudflare | P1 |
| `safetrade.com` | 104.26.14.17, 104.26.15.17 and 172.67.72.55, and three `2606:4700:20::` addresses, Cloudflare | P1 |
| `support.safetrade.com` | CNAME `safetradehelp.zendesk.com`, 216.198.53.6 and 216.198.54.6 | P1 |
| exit seen by Cloudflare | `loc=CA`, `colo=SEA` or `YVR`, from `/cdn-cgi/trace` on `www.cloudflare.com`, `safe.trade` and `safetrade.com` alike | P1 |
| API request time | every path refused at the Cloudflare edge in 27 to 129 ms on `safe.trade` and 19 to 58 ms on `safetrade.com` over two runs, one kept-alive connection per host | P1 |
| help center request | 200 in 331 ms and 252 ms | P1 |

### What each path returned

| path | `safe.trade` | `safetrade.com` |
|---|---|---|
| `/` | 403, `cf-mitigated: challenge`, 3,636 bytes | 403, 1,545 bytes |
| `/api/v2/trade/public/markets` | 403, `cf-mitigated: challenge` | 403 |
| `/api/v2/trade/public/tickers` | 403, `cf-mitigated: challenge` | 403 |
| `/api/v2/trade/public/markets/btcusdt/depth` | 403, `cf-mitigated: challenge` | 403 |
| `/api/v2/trade/public/markets/btcusdt/order-book` | 403, `cf-mitigated: challenge` | 403 |
| `/api/v2/trade/public/timestamp` | 403, `cf-mitigated: challenge` | 403 |
| `/api/v2/peatio/public/markets` | 403, `cf-mitigated: challenge` | 403 |
| `/api/v2/peatio/public/markets/tickers` | 403, `cf-mitigated: challenge` | 403 |

Every refusal is `text/html` with the same notice, P1.

```text
If you are seeing this page, you may be from Canada.
Safetrade does not currently allow trading or new signups for Canadians as of June 1, 2020.  Your wallets are still accessible.
If you are from Canada and would like to access your wallet, please sign in at https://safe.trade/login.
If you are Not from Canada and are receiving this message in error (such as a VPN), please complete the Captcha below for access to trading:
```

On `safe.trade` the page embeds a Cloudflare interactive challenge, `cType: 'interactive'`, and on `safetrade.com` it embeds a smaller script, P1.
A browser User-Agent got the same 403 on both hosts in the rerun, and no refusal carried a `Retry-After` header, P1.
The probe did not answer the challenge, because this host is refused for its Canadian exit and the survey does not route around a geoblock.
An off-host fetch of `https://safetrade.com/` through the WebFetch tool also got HTTP 403 on 2026-09-22.

## 2. Catalog

### The instruments call

| call | source | probed |
|---|---|---|
| `GET /api/v2/trade/public/markets` | public integrations, S7, and the Peatio name `GET /public/markets`, S4 | 403 |
| `GET /api/v2/trade/public/tickers` and `/tickers/{market}` | public integrations, S7 | 403 |
| `GET /api/v2/trade/public/currencies/{id}` | public integrations, S7 | not probed |
| `GET /api/v2/trade/public/markets/{market}/k-line` | the Internet Archive holds 200 `application/json` replies from 2024-05-20, S6 | not probed |

The live catalog could not be read.
The web app's server side state in the Internet Archive capture of `https://safetrade.com/` on 2026-09-07 holds the market list the app fetched, P4.

| item | value on 2026-09-07 |
|---|---|
| markets | 264 |
| `state` | 101 `enabled`, 163 `disabled` |
| enabled by quote | 54 USDT, 26 BTC, 3 ETH, 3 SAFE, 3 DAI, 2 USDC, 2 LTC, 2 PLS, and 1 each in DOGE, SOL, KMD, QUBIC, RVN and XMR |
| market fields | `id`, `symbol`, `name`, `base_unit`, `quote_unit`, `amount_precision`, `price_precision`, `total_precision`, `min_price`, `max_price`, `min_amount`, `position`, `state`, `created_at`, `updated_at`, plus nested `base_currency` and `quote_currency` |
| derivative markets | 0, and the market object has no type field |
| perpetual count | 0 in every settlement asset |

The `btcusdt` market as captured, nested currencies left out, P4.

```json
{"id":"btcusdt","symbol":"btcusdt","name":"BTC/USDT","base_unit":"btc","quote_unit":"usdt","amount_precision":8,"price_precision":1,"total_precision":4,"min_price":"1","max_price":"500000","min_amount":"0.00001","position":41,"state":"enabled","created_at":"2023-01-15T18:27:57Z","updated_at":"2023-03-19T13:48:30Z"}
```

Among the 55 bases with an enabled USDT, USDC or DAI market, three are listed more than once in that family, `vrsc` as `vrscusdc`, `vrscusdt` and `vrscdai`, `pls` as `plsdai` and `plsusdt`, and `plsx` as `plsxdai` and `plsxusdt`, P4.
The fees page capture of 2025-08-10 held 236 markets, 89 enabled, P4.

### The stack

The web app's runtime config names its server side API as `"apiUrl":"http://envoy:8099/api/v2/"`, P4.
Openware's OpenDAX runs an Envoy gateway on port 8099 for its `/api/v2/peatio`, `/api/v2/barong` and `/api/v2/ranger` routes, S5.
The private headers `X-Auth-Apikey`, `X-Auth-Nonce` and `X-Auth-Signature` are Barong's, see [`websocket.md`](./websocket.md) section 7, and the fee row shape is Peatio's `TradingFee`, see [`fees.md`](./fees.md) section 4.
So SafeTrade 3.0, launched in November 2023, S2, runs an OpenDAX derivative whose public routes moved from `/api/v2/peatio` to `/api/v2/trade`, which is an inference from these matches.
The help center called the new API "95% backwards compatible", S2.

### Liquidity on the day

CoinGecko listed 61 SafeTrade tickers on 2026-09-22, 34 quoted in USDT, 18 in BTC, 4 in USDC, 2 in LTC and one each in XMR, SAFE and RVN, for 88.29 BTC of 24 h volume at 04:51 UTC, P5.
Its API gave trust score 2 and trust score rank 168, where the survey input named rank 159.
The table is the 04:51 UTC read, and at 04:57 UTC the volume was 90.66 BTC and PRL/USDT read 7,068,724 USD at a 1.2 % spread.

| pair | 24 h volume, USD | spread, % |
|---|---:|---:|
| PRL/USDT | 6,882,098 | 0.61 |
| USDC/USDT | 352,513 | 0.41 |
| NOCK/USDT | 119,864 | 6.25 |
| PRL/USDC | 91,726 | 13.37 |
| QUANTUS/USDT | 62,409 | 1.98 |
| QUBIC/USDT | 47,977 | 1.74 |
| BTC/USDT | 35,966 | 0.84 |
| LTC/USDT | 29,132 | 0.81 |

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 and CCXT master have no SafeTrade class, see [`fees.md`](./fees.md) section 8, so there is no `market.id`, `contractSize`, `linear` or `active` to compare with the socket.
The captured market `id`, such as `btcusdt`, is spelled the same as the stream prefix in the example client, `qubicusdt.depth`, S1.

## 3. Anchor

SafeTrade publishes no index, mark or funding, since it lists no perpetual.
The web app's state carries two reference prices, P4.
`global_price` converts USDT into fiat, `{"eur":0.860046,"gbp":0.738502,"inr":94.52,"usd":0.999906,"vnd":26019}` on 2026-09-07.
Each currency carries a `price` field, likely quoted in USDT, since the state's `currency_quote_price` is `"usdt"`, which is an inference.
Neither is an index basket.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable.
No index formula, basket, mark formula, clamp or funding rate exists.

## 5. REST book snapshot

SafeTrade documents no book call.
Openware's Peatio publishes two, S4.

| Peatio call | limits | order, as documented |
|---|---|---|
| `GET /public/markets/{market}/depth` | `limit`, default 300 | "Both asks and bids are sorted from highest price to lowest." |
| `GET /public/markets/{market}/order-book` | `asks_limit` and `bids_limit`, default 20 each | Not publicly specified |

Both calls under the `/api/v2/trade` prefix answered 403 for `btcusdt`, P1.
Whether SafeTrade serves them, and their caching, are Not verified.

## 6. Rate limits and errors

Rate limits are Not publicly specified.
The only status this host saw is 403 with the Canada notice, with no `Retry-After`, P1.
The JSON error shape is Not verified.

## 7. Server time and clock offset

Peatio's server time call is `GET /public/timestamp`, S4, and `GET /api/v2/trade/public/timestamp` answered 403, P1.
The clock offset could not be measured.

## 8. Recommended poller shape

None.
SafeTrade has no index, mark or funding to poll, CCXT has no class for it, and it refuses this host.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | SafeTrade example client, commit `e463039` of 2026-02-12 | https://github.com/safetrade-exchange/example-client | 2026-09-22 | SafeTrade | base URL, market id spelling, sections 1 and 2 |
| S2 | SafeTrade help center, 107 articles, among them "Server maintenance: Safetrade 3.0 is loading" | https://support.safetrade.com/hc/en-us/articles/21459723961741-Server-maintenance-Safetrade-3-0-is-loading | 2026-09-22 | SafeTrade | no API documentation, 3.0 launch, 95 % compatibility, section 2 |
| S3 | "Safetrade.com is now the offical home of Safetrade!", 2024-06-19 | https://support.safetrade.com/hc/en-us/articles/27715005079693-Safetrade-com-is-now-the-offical-home-of-Safetrade | 2026-09-22 | SafeTrade | `safe.trade` kept for the API, section 1 |
| S4 | Openware Peatio user API v2, branch 2-6-stable | https://github.com/openware/peatio/blob/2-6-stable/docs/api/peatio_user_api_v2.md | 2026-09-22 | Openware | public market, depth, order-book, timestamp and trading fee calls, sections 2, 5 and 7 |
| S5 | Openware OpenDAX Envoy template, `templates/config/gateway/envoy.yaml.erb` line 6 | https://github.com/openware/opendax/blob/2-6-stable/templates/config/gateway/envoy.yaml.erb | 2026-09-22 | Openware | Envoy on port 8099, section 2 |
| S6 | Internet Archive CDX index of `safe.trade/api/v2/` since 2024 | https://web.archive.org/cdx/search/cdx?url=safe.trade/api/v2/&matchType=prefix&from=2024 | 2026-09-22 | Internet Archive | 18 archived API replies, the `trade/public` k-line and `peatio/public` trades paths, section 2 |
| S7 | GitHub code search for `"safe.trade/api"`, 50 results | https://github.com/search?q=%22safe.trade%2Fapi%22&type=code | 2026-09-22 | public integrations | `trade/public/markets`, `tickers`, `currencies`, `websocket/public` in use, section 2 |
| P1 | `rest-probe.mjs access`, run at 04:49 UTC and rerun at 04:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/safetrade/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | DNS, trace, every 403, sections 1, 5, 6 and 7 |
| P4 | `archive-probe.mjs wayback` | [`archive-probe.mjs`](../../../scripts/probes/venues/safetrade/archive-probe.mjs) | 2026-09-22 | Internet Archive | market list, runtime config, reference prices, sections 2 and 3 |
| P5 | `archive-probe.mjs coingecko` | [`archive-probe.mjs`](../../../scripts/probes/venues/safetrade/archive-probe.mjs) | 2026-09-22 | CoinGecko | tickers, volume, trust rank, section 2 |
