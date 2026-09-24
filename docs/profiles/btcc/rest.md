# BTCC REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, which was 2026-09-23 04:23 to 04:57 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=SEA`).

This profile covers the REST side of BTCC for its perpetual futures.
BTCC publishes no public REST market data API.
The November 2023 trade OpenAPI, S1, puts every call behind a login token and an md5 signature, including its product list, and its documented host timed out from this host.
What an anonymous client can read comes from the calls the public web page makes, which are undocumented, and every claim below about them was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/btcc/rest-probe.mjs).
Access results are from the Canadian VPN exit.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-23 UTC | answer from this host |
|---|---|---|---|
| `www.btcc.com` | web page and its JSON calls | CNAME `www.btcc.com.cdn.cloudflare.net`, 172.66.40.149 and 172.66.43.107 | 200. The VIP table call took 479 to 528 ms cold and 197 to 1,177 ms warm over five runs |
| `wkd2.btloginc.com` | web quote socket, see [`websocket.md`](./websocket.md) | CNAME `wkd2.btloginc.com.eo.dnse4.com`, 43.169.26.82 | upgrade 101 |
| `api1.btloginc.com` | OpenAPI trade REST, documented as `https://api1.btloginc.com:9081` | CNAME `btcc-web-oversea-2048716815.ap-east-1.elb.amazonaws.com`, three addresses | port 9081 timed out after 8 s in five runs, and port 443 answered 503 with an empty body in 720 to 759 ms |
| `kapi1.btloginc.com` | OpenAPI quote socket, documented as `wss://kapi1.btloginc.com:9082` | CNAME `aa31409fc72802984.awsglobalaccelerator.com`, 35.71.144.59 and 52.223.63.129 | certificate for `*.btcc.com`, see [`websocket.md`](./websocket.md) section 1 |
| `api.btcc.com` | none documented | 52.220.179.36 | not requested by the probe |
| `btccexchange.zendesk.com` | help centre | | the API guide article that the API key page links, id 53597049859737 for English and 53596974363545, 53597011699481 and 53597057451417 for Chinese, Japanese and Korean, returned 404 `RecordNotFound` to the anonymous Zendesk API, as did 24451281100697, the guide CCXT issue 22623 names. A help centre search for "API" found only two unrelated articles |

The API key page says, in the Chinese source string of its bundle, that an API key serves "行情查询，自动交易等服务", market data queries and automated trading, S3.
The guide it links is not public, so the current API cannot be read without an account.
A user of CCXT issue 22623 wrote on 2025-12-02 that support told them futures API keys are read only, S4.

## 2. Catalog

### The instruments call

There is no public instruments call.

| call | answer |
|---|---|
| OpenAPI `GET /v1/config/symbollist`, which takes `token` and `sign`, S1 | port 9081 timed out, and port 443 answered 503 |
| the web page's product list | only on the quote socket after its login: the `Dict` frame of 384 contracts, see [`websocket.md`](./websocket.md) section 2 |
| a web call that needs a login, `POST /v2/common/getCommonConfig` | 200 with `{"code":"10005","msg":"登入已過期，請重新登入",…,"ok":false}`, which reads "login expired, please log in again" |

The `Dict` frame on 2026-09-23 UTC held 346 USDT, 11 USDC, 6 coin-M and 21 USDX contracts, every one with `TimeType` 1, in four runs of [`ws-probe.mjs`](../../../scripts/probes/venues/btcc/ws-probe.mjs) `web`.
It carries no status field, and a contract's trading hours come in the separate `All Products` frame.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no BTCC class, and neither does CCXT master at commit `1d8b674434fde39ef282988b066812adf8d19b9e`, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.

| name | where | example |
|---|---|---|
| `SecID` | quote socket, book frames route on it | `3289142` |
| `ShortName` | quote socket dictionary | `BTC/USDT.100x`, where the suffix is the maximum leverage |
| funding symbol | web funding calls | `BTCUSDT`, and `BTC/USDT.100x` or `3289142` return `data: null` |
| OpenAPI product `name` | S1 example | `GWFX/USDT/GTS/MM/MIN/0/A/BTCUSDT5x` |

A catalog would have to map `SecID` to the funding symbol by dropping the slash and the leverage suffix of `ShortName`.
That mapping is an inference that held for `BTCUSDT`, `ETHUSDT`, `CHZUSDT`, `BTCUSD` and `BTCUSDC`.

### Size unit, pairs listed twice, and price scale

The S1 product carries `contract_size`, `volumes_min` 0.01 and `volumes_step` 0.01, and the example has `contract_size` 1.
The current values are behind the login, so the size unit is Not verified, see [`websocket.md`](./websocket.md) section 4.

Each dictionary name appears once, 384 names for 384 contracts.
22 bases are listed in more than one settlement family, among them BTC, ETH, XRP and SOL in USDT, USDC and USD.
The engine treats USD, USDC and USDT as one family, so each of those bases would need a `marketFilter` choice, see [`types.ts`](../../../server/src/ccxt/types.ts) line 23.
The leverage suffixes were 20x on 76 contracts, 50x on 270, 100x on 6, 150x on 24, 250x on 3 and 500x on 5.
One contract carries a scale prefix, `1000BONK/USDT.20x`, which would need a price scale.

## 3. Anchor

### The bulk calls

None exist.

| `AnchorRow` column | source | status |
|---|---|---|
| `index` | none. The funding article names a "price index" and a "benchmark price" without a basket or a call, S5 | absent |
| `mark` | none. "forced-liquidation and PnL determination follow the platform’s two-way quotes", and "Futures do not use the MMR (maintenance margin rate) concept and do not use “Average Price” as the basis for forced-liquidation or PnL determination", S6 | absent, which the engine reads as 0 and refuses at open |
| `fundingRate` | `POST https://www.btcc.com/v2/symbol/getFundrate` with `{"symbol": "BTCUSDT"}`, one symbol per call, no login | `{"fundrate":463,"fundratetm":"0,8,16"}` |
| `fundingIntervalHours` | `fundratetm`, the settlement hours in UTC | `"0,8,16"` on every symbol read, so 8 |
| `nextFundingAt` | derived from `fundratetm` and the clock | no field carries it |

Single reads of the funding call took 197 to 3,776 ms, and four sets of 30 polls took 208 to 2,614 ms, medians 441 to 601 ms.
A poller would need one call per contract.
`GET` without a body answered `{"code":"FAIL","msg":"失败",…}`, and `POST {}` answered `{"code":"OK",…,"data":null}`.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | none | | the funding symbol, mapped from `ShortName` |
| `index` | none | | |
| `mark` | none | | 0 |
| `fundingRate` | `fundrate` | integer | divide by 1,000,000, an inference: `CHZUSDT` read 100 while its newest settled rate was `+0.0100%`, and `BTCUSDT` read 463 against settled rates of −0.0419 % to +0.0426 % |
| `fundingIntervalHours` | `fundratetm` | comma separated UTC hours | 24 divided by the count |
| `nextFundingAt` | `fundratetm` | | the next listed hour after now |

## 4. Anchor semantics

### Index

BTCC publishes no index value, no index formula and no basket, S5.
The funding article's premium index uses a "price index" and a "benchmark price" without defining either.

### Mark

BTCC has no mark price for its perpetuals.
The liquidation rules monitor a long against the best bid and a short against the best ask of "the platform's two-way quotes", S6.
So the fresh gate's mark and index checks have nothing to read on a BTCC leg.

### Funding

The formula is `average premium index (P) + Clamp[interest rate (I) − average premium index (P), a, b]` with I = 0.01 %, a premium index every minute, and impact prices at 200 USDT of margin over the minimum maintenance margin rate, S5.
The clamp bounds a and b are not published, see [`fees.md`](./fees.md) section 6.

### Upcoming or last settled

`getFundrate` returns something other than the last settled rate.
`BTCUSDT` read 463 at 04:38, 04:44, 04:48 and 04:53 UTC, while its 00:00 UTC settlement was `+0.0357%`.
It is presumably the running estimate for the 08:00 UTC settlement, which is an inference.
The settlement instant itself was not captured.

`POST /v2/symbol/getFundrateLog` with `{"pageNo":1,"pageSize":30,"startTime":"YYYY-MM-DD","endTime":"YYYY-MM-DD","symbolName":"BTCUSDT"}` returns settled rates as percent strings, and a `symbolName` of `null` returns 0 rows.

| symbol | rows from 2026-09-16 to 2026-09-23 UTC | newest | oldest | range | distinct values |
|---|---:|---|---|---|---:|
| `BTCUSDT` | 23 | 2026-09-23 00:00, `+0.0357%` | 2026-09-16 00:00, `-0.0256%` | −0.0419 % to +0.0426 % | 22 |
| `CHZUSDT` | 23 | `+0.0100%` | `+0.0100%` | −0.0100 % to +0.0100 % | 4 |
| `BTCUSD` | 23 | `+0.0050%` | `+0.0135%` | +0.0038 % to +0.0150 % | 10 |

Every row sat at 00:00, 08:00 or 16:00 UTC, three rows were stamped 16:01, and 2026-09-16 16:00 and 16:01 both appear with the same rate on each of the three symbols, so one settlement is listed twice.

### How often each number changed

| symbol | reads | values |
|---|---|---|
| `BTCUSDT` | four sets of 30 polls 2 s apart between 04:39 and 04:56 UTC, plus single reads | 463 on every read, 0 changes |
| `ETHUSDT` | single reads at 04:38, 04:44, 04:48 and 04:53 UTC | 275, 275, 286, 286 |
| `BTCUSD` | same | 104, 107, 108, 108 |
| `BTCUSDC` | same | 120, 120, 126, 126 |

So the estimate moves on a scale of minutes, not seconds.

## 5. REST book snapshot

There is no public REST book.
The web page's quote calls `/quot/reqMultiPrdPrice` and `/quot/getHisTick` carry an md5 `sign` over a key in the page bundle, S3.
Sent without it, both answered 200 with `{"code": -4, "action": "", "msg": "error:Encode CheckMD5Sign failed", …}`.
The OpenAPI document has no book call, and its quote socket sends 7 levels, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | value |
|---|---|
| published limits | none, S1 has no rate limit section |
| limits met | none over five runs of up to about 70 requests each |
| `Retry-After` | not seen |
| web error shape | `{"code": "FAIL" or "10005", "msg": …, "data": null, "ext": null, "errorArgs": [], "errorArgsMap": {}, "ok": false}` with HTTP 200 |
| web success shape | `{"code": "OK", "msg": "成功", "data": …, "ok": true}` |
| unknown funding symbol | `NOPEUSDT` answered `"code":"OK"` with `data: null` |
| quote REST error shape | `{"code": -4, "msg": "error:Encode CheckMD5Sign failed"}` |
| OpenAPI host | port 9081 timeout, port 443 HTTP 503 with an empty body |

## 7. Server time and clock offset

No public server time call exists.
The `Date` header of `www.btcc.com` read 6 to 894 ms behind the midpoint of each request over five runs, which at one second resolution means the clocks agree within a second.
The quote socket's `Login` frame carried a `Time` equal to or 1 s ahead of the local Unix second read just after it arrived, in four runs.

## 8. Recommended poller shape

No poller is recommended.
BTCC has no index and no mark, so every BTCC route would be refused at open by the anchor reader, see [`../../../server/src/engine/cluster/types.ts`](../../../server/src/engine/cluster/types.ts) line 34.
The one anchor field that exists, the funding estimate, comes from an undocumented web call, one contract per request.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTCC_EN - TradeOpenApi, November 2023, attached to CCXT issue 22623 | https://github.com/ccxt/ccxt/files/15447210/BTCC_EN.-.TradeOpenApi_Nov2023.pdf | 2026-09-22 | BTCC, global | trade host, signature, product fields, sections 1, 2 and 6 |
| S2 | BTCC_EN - OpenAPI_quote_websocket, November 2023, attached to CCXT issue 22623 | https://github.com/ccxt/ccxt/files/15447211/BTCC_EN.-.OpenAPI_quote_websocket.docx.pdf | 2026-09-22 | BTCC, global | quote host, section 1 |
| S3 | BTCC web page bundles, the application and the API key page | `https://www.btcc.com/_next/static/chunks/pages/_app-f6c41f79fa0544b0.js` and `https://www.btcc.com/_next/static/chunks/pages/user-center/setting/api-d3cbd7b04a7de86c.js` | 2026-09-22 | BTCC, global | web calls, guide links, sections 1, 3 and 5 |
| S4 | CCXT issue 22623, New Exchange Request: BTCC | https://github.com/ccxt/ccxt/issues/22623 | 2026-09-22 | CCXT | where S1 and S2 were found, section 1 |
| S5 | BTCC Funding Fees Explained and Calculation Method, updated 2026-08-25 | https://btccexchange.zendesk.com/hc/en-gb/articles/22348642432025-BTCC-Funding-Fees-Explained-and-Calculation-Method | 2026-09-22 | BTCC, global | sections 3 and 4 |
| S6 | BTCC Futures Forced Liquidation Rules, updated 2026-08-13 | https://btccexchange.zendesk.com/hc/en-gb/articles/50605528595225-BTCC-Futures-Forced-Liquidation-Rules | 2026-09-22 | BTCC, global | no mark price, sections 3 and 4 |
| P1 | `rest-probe.mjs`, runs at 04:30, 04:38, 04:44, 04:48 and 04:53 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/btcc/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | sections 1 to 7 |
| P2 | `ws-probe.mjs web` and `official`, runs from 04:34 to 04:57 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/btcc/ws-probe.mjs) | 2026-09-22 | this host, Canadian exit | dictionary, pairs, `Login` time, sections 2 and 7 |
