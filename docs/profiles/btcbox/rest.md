# BTCBOX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:00 UTC), from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

BTCBOX (CCXT id `btcbox`) publishes a small public HTTP API on `https://www.btcbox.co.jp/api/v1`, S1, S2.
It lists no perpetual, so this profile covers the spot catalog and book as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks, and section 3 records that no index, mark or funding exists.
Every probe number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs), run as section 9 lists.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `www.btcbox.co.jp`, the API and the web site share it | S1 |
| resolved addresses | `104.18.20.149`, `104.18.21.149`, `2606:4700::6812:1495`, `2606:4700::6812:1595`, all Cloudflare | P2 |
| Cloudflare edge | `colo=SEA` in both P2 runs, and `cf-ray` suffixes `SEA` and `YVR` across the runs | P2, P7 |
| geolocation seen by Cloudflare | `loc=CA`, the Surfshark exit | P2 |
| origin | behind Cloudflare, `cf-cache-status: DYNAMIC`, so every call reaches the origin | P2 |
| cold request | a fresh TCP and TLS connection plus one request, the six WebSocket upgrade attempts per run, took 430 to 535 ms | P7 |
| first `tickers` call | 427 and 154 ms in the two runs, on a connection the `cdn-cgi/trace` call had already opened | P2 |
| warm `tickers`, 643 to 647 bytes | 20 calls per run: min 115 and 120, median 125 and 151, p90 153 and 168, max 156 and 208 ms | P2 |
| warm `depth`, 164 and 165 bytes | 20 calls per run: min 113 and 112, median 125 and 122, p90 129 and 131, max 140 and 132 ms | P2 |
| warm `coinInfo`, 1,842 bytes | 20 calls per run: min 114 and 113, median 122 and 118, p90 127 and 127, max 129 and 128 ms | P2 |
| one second polls | 60 per run: `tickers` median 125 and 118, max 276 and 497 ms, `depth` median 127 and 130, max 518 and 182 ms | P4 |
| content type | `text/html; charset=UTF-8` on every JSON reply | P2, P5 |

Access, as fact: every public API call answered HTTP 200 with data through the Canadian VPN exit, and no geoblock, challenge or refusal was seen on `/api/v1/*` or `/ajax/coin/*`.
The English support site `support.btcbox.co.jp`, a Zendesk host, answered HTTP 403 to curl and to the documentation fetch, see [`fees.md`](./fees.md) section 1.
Who may trade is in [`fees.md`](./fees.md) section 1: residents of the United States are barred by the terms of service.

## 2. Catalog

### The instruments call

No instruments call exists.
The public calls are `tickers`, `ticker`, `depth` and `orders`, S1.

| call | reply | use |
|---|---|---|
| `GET /api/v1/tickers` | an object keyed `BTC_JPY`, `BCH_JPY`, `LTC_JPY`, `ETH_JPY`, `DOGE_JPY`, `DOT_JPY`, `TRX_JPY`, each with `high`, `low`, `buy`, `sell`, `last`, `vol` | the list of markets, P1 |
| `GET /ajax/coin/coinInfo` | a web client call, `{"status":1,"msg":"","data":{"btc":{…,"trade":{"mintrust":0.001,"pricedecimal":0,"nummindecimal":5,"numdecimal":5,"enable":1},…}}}` | per coin order book switch `trade.enable`, price decimals and minimums, P1 |

| market | `tickers` key | `trade.enable` | dealer desk `vend.enable` | CCXT `active` |
|---|---|---:|---:|---|
| BTC/JPY | `BTC_JPY` | 1 | 1 | true |
| BCH/JPY | `BCH_JPY` | 1 | 0 | true |
| LTC/JPY | `LTC_JPY` | 1 | 0 | true |
| ETH/JPY | `ETH_JPY` | 1 | 1 | true |
| DOGE/JPY | `DOGE_JPY` | 0 | 1 | false |
| DOT/JPY | `DOT_JPY` | 0 | 1 | false |
| TRX/JPY | `TRX_JPY` | 0 | 1 | false |

7 markets are listed and 4 are tradable on the order book, all quoted in JPY, P1.
The active perpetual count is 0 for every settlement asset.
The fee page lists order book fees for BTC, BCH, ETH and LTC only, which agrees with `trade.enable`, see [`fees.md`](./fees.md) section 4.

### How CCXT 4.5.68 maps it

`fetchMarkets` at `server/node_modules/ccxt/js/src/btcbox.js` lines 243 to 317 calls `tickers` and the web call `ajax/coin/coinInfo` together, lines 244 and 245, and builds one spot market per `tickers` key.

| field | CCXT value | against the wire | source |
|---|---|---|---|
| `market.id` | `btc`, the lower case base, line 257 | equals the `coin` parameter of `depth`, `ticker` and `orders`, and differs from the `tickers` key `BTC_JPY` | P1, P3 |
| `symbol` | `BTC/JPY` | | P1 |
| `type`, `spot`, `swap` | `spot`, true, false | no derivative exists | P1 |
| `active` | `trade.enable === '1'`, line 311 | true on the 4 order book markets, false on DOGE, DOT and TRX | P1 |
| `contractSize` | undefined, line 284 | sizes are base coin, see section 5, and the engine turns a missing size into 1 | P1 |
| `linear` | undefined, line 282 | not a contract | P1 |
| `precision.price` | 1 JPY, and 0.01 JPY on DOGE and TRX, from `pricedecimal` | prices on the wire are integers on the four order book markets | P1, P3 |
| `taker`, `maker` | 0.001 on every market, line 260 | the published BTC/JPY rate is 0.0005, see [`fees.md`](./fees.md) section 8 | P1 |

No pair is listed twice, and no price scale applies.
`fetchOrderBook` sends `coin` only when more than one symbol is loaded, lines 424 to 427, and with 7 markets loaded it always does, so `fetchOrderBook('ETH/JPY')` returned the ETH book, 18 bids and 21 asks, P3.
The connector would still drop every market, because it keeps only `type === 'swap'` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 199 to 201.

## 3. Anchor

BTCBOX publishes no index, no mark and no funding rate, S1, S2, and no call returns any of them.
It publishes no reference price either.
The only prices are the `ticker` fields `buy`, `sell` and `last`, and the dealer desk quote that `depth` returns for a disabled coin, section 5.
No anchor poller is recommended.

| `AnchorRow` column | field |
|---|---|
| key | none |
| `index` | none |
| `mark` | none |
| `fundingRate` | none |
| `fundingIntervalHours` | none |
| `nextFundingAt` | none |

## 4. Anchor semantics

Not applicable, since section 3 found no anchor.

How often the spot numbers changed over 60 one second polls of `tickers` and the BTC `depth`, in two runs at 04:46 and 04:53 UTC, P4:

| number | changes in 59 intervals, first run | rerun |
|---|---:|---:|
| BTC/JPY `buy`, `sell`, `last` | 0 | 0 |
| BTC/JPY best bid and ask in `depth` | 0 | 0 |
| the whole BTC `depth` body | 10 | 0 |
| ETH/JPY and BCH/JPY `buy`, `sell`, `last` | 0 | 0 |
| LTC/JPY `buy`, `sell` | 1, 0 | 1, 2 |
| DOGE/JPY `buy`, `sell`, `last` | 1, 2, 1 | 1, 1, 1 |
| TRX/JPY `buy`, `sell`, `last` | 2, 3, 2 | 12, 2, 2 |

The BTC, ETH and BCH touch held for both whole minutes.

## 5. REST book snapshot

The call is `GET /api/v1/depth?coin=<id>`, and without `coin` it returns BTC, S1.
No depth or limit parameter is documented, S1.

Two runs of P3, at 04:44 and 04:52 UTC, gave the following, with the rerun's value second where it differed.

| coin | bids | asks | spread | farthest ask above the touch | farthest bid below the touch |
|---|---:|---:|---:|---:|---:|
| btc | 4 | 4 | 9 and 66 ppm | 5 % | 5 and 4.96 % |
| bch | 15 | 15 | 280 ppm | 30.03 % | 10 % |
| ltc | 15 | 15 | 893 and 496 ppm | 20 % | 20 % |
| eth | 18 | 21 | 2 ppm | 44.33 and 44.27 % | 6.76 and 6.8 % |
| doge, dot, trx | 1 | 1 | 0, locked, the dealer desk quote | | |

- Level order: asks descending, worst first and best last, and bids descending, best first, on all four order book markets, P3.
- The documentation says asks run high to low and bids low to high, S1, S2, so it is wrong about bids.
- CCXT sorts both sides itself, at `server/node_modules/ccxt/js/src/base/Exchange.js` lines 5092 and 5093, so its book is right either way.
- Levels are `[price, size]` pairs of JSON numbers, prices are integer JPY on the four order book markets, and sizes are base coin, P3.
- The best bid and ask equalled the `tickers` `buy` and `sell` on all 7 coins, P3.
- The reply carries no timestamp and no update id, P3.
- The web client's own depth call, `GET /ajax/coin/depth/type/btc`, returned the same 4 bid prices and 3 of the 4 ask prices, and the ask it left out was the farthest, 14,397,306 JPY, P3.
- So the API shows at least what the web client shows, and the thin BTC book is the real book.
- The BTC touch held 0.0019 and 0.00246 BTC on the ask and 0.00155 and 0.00226 BTC on the bid in the two runs, about 21,000 to 34,000 JPY, P3.
- Caching: `cf-cache-status: DYNAMIC` on every reply, and the BTC body changed on 10 of 59 one second polls in the first run, P2, P4.

A disabled coin returns one bid and one ask at one price, for example `{"asks":[[16.34,2.0779]],"bids":[[16.34,3.3569]]}` for DOGE, P3.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| documented private limits | `trade_add` and `balance` 2 per second, `trade_list` and `trade_view` 1 per second, `order_history` 4 per second | S1, S2 |
| documented public limit | none, "There are no other API request upper limits", with the reservation that BTCBOX may limit a client it judges to be loading the system | S1 |
| limit error | code 402, "Request is too frequent" | S1 |
| CCXT | `rateLimit` 1,000 ms at `btcbox.js` line 25, and code `'402'` maps to `DDoSProtection` at line 232 | S4 |
| probed burst | 10 back to back `tickers` calls in 1,477 ms and 1,315 ms in the rerun, all HTTP 200, no `Retry-After` | P5 |

| request | HTTP | body | P5 |
|---|---:|---|---|
| `depth?coin=nope` | 200 | `{"result":false,"code":"102"}` | |
| `ticker?coin=nope` | 200 | `{"result":false,"code":"102"}` | |
| `orders?coin=nope` | 200 | `{"result":false,"code":"102"}` | |
| `depth?coin=ETH`, upper case | 200 | `{"result":false,"code":"102"}` | |
| `depth?coin=eth_jpy` | 200 | `{"result":false,"code":"102"}` | |
| `depth?coin=doge`, disabled | 200 | a one level locked book | |
| `/api/v1/nope`, unknown path | 500 | empty | |
| `/api/v2/tickers` | 500 | empty | |

Code 102 is "The coin does not exist", S1.
An error arrives as HTTP 200, so a client must read `result` before it reads `asks` and `bids`.
CCXT does that in `handleErrors`, lines 829 to 845.
CCXT's `request` also strips whitespace before the JSON with the comment "sometimes the exchange returns whitespace prepended to json", lines 846 to 857, and no probed reply was padded, P2.

## 7. Server time and clock offset

No server time call is documented, S1.
The web client's `/ajax/trade/servertime` answered `{"status":0,"msg":"LT","data":""}` to both GET and POST without a session, P6, so it gives no time to a public caller.
The HTTP `Date` header has one second resolution, and ten calls sent at ten phases of the second bound the offset of that clock, server minus local, to between -15 and +198 ms, and to between -33 and +200 ms in the rerun, P6.
That clock is whatever writes the `Date` header on the Cloudflare path, and it is not proven to be the matching engine's clock.

## 8. Recommended poller shape

No anchor poller is recommended, because BTCBOX publishes no index, mark or funding, section 3.
A spot stage that wanted the touch could read all 7 markets in one `tickers` call, median 118 to 151 ms over the runs, but its `buy` and `sell` carry no sizes, and the four order book markets need one `depth` call each for sizes, section 5.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTCBOX API Documentation, English, dated 2020.06.11 | https://blog.btcbox.jp/en/archives/8762 | 2026-09-22 | BtcBox Co., Ltd., Japan | endpoints, parameters, book order, limits, error codes, sections 2, 3, 5, 6 and 7 |
| S2 | BTCBOX API ドキュメント, Japanese, dated 2023.04.14 | https://blog.btcbox.jp/archives/8759 | 2026-09-22 | BtcBox Co., Ltd., Japan | the same limits, and the same book order text, bids low to high, sections 3, 5 and 6 |
| S3 | BTCBOX web client script | https://www.btcbox.co.jp/js/script.js?v=24.5 | 2026-09-22 | BtcBox Co., Ltd. | the web calls `ajax/coin/coinInfo`, `ajax/trade/servertime`, section 7 |
| S4 | CCXT 4.5.68 `btcbox.js` | `server/node_modules/ccxt/js/src/btcbox.js` | 2026-09-22 | CCXT | `fetchMarkets`, `fetchOrderBook`, `rateLimit`, exceptions, `handleErrors`, `request`, sections 2 and 6 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | section 2 |
| P2 | `rest-probe.mjs latency` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | section 1, padding in section 6 |
| P3 | `rest-probe.mjs book` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 2 and 5 |
| P4 | `rest-probe.mjs poll`, 60 s | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 4 and 5 |
| P5 | `rest-probe.mjs errors` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | section 6 |
| P6 | `rest-probe.mjs time` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | section 7 |
| P7 | `ws-probe.mjs` | [`ws-probe.mjs`](../../../scripts/probes/venues/btcbox/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | edges seen on the handshakes, section 1 |
