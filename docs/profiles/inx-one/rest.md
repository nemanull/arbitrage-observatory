# INX One REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:41 to 05:05 UTC, from the development host near Seattle through its Canadian VPN exit.

This profile covers the REST API of INX One, now served under Republic's name, which has no CCXT class and lists no perpetuals, see [`fees.md`](./fees.md) section 3.
INX documents one REST gateway, and every call on it needs an approved API key and a signature, S1.
So no catalog, price or book could be read from this host, and each section below says what was documented, what was called without credentials, and what came back.
Every probe claim comes from [`rest-probe.mjs`](../../../scripts/probes/venues/inx-one/rest-probe.mjs).
All results are from the Canadian VPN exit that this laptop's traffic leaves through, which Cloudflare placed at `loc=CA` with the `YVR` and `SEA` edges.

## 1. Host and latency from this machine

### Documented API hosts

| host | role | source |
|---|---|---|
| `https://gw-client-api-rest.trading.republic.com` | REST gateway, every `/api/...` call | S1, whose `servers` entry is spelled `https://https://gw-client-api-rest.trading.republic.com` |
| `wss://gw-client-api-ws.trading.republic.com` | streaming, see [`websocket.md`](./websocket.md) | S1 |
| FIX API | named in S1 with its logon and market data messages, host Not publicly specified | S1 |

### Hosts that answered

| host | resolved to | answer | probe |
|---|---|---|---|
| `www.inx.co`, `inx.co`, `apidoc.inx.co`, `one.inx.co`, `crypto-support.inx.co` | `172.66.40.159`, `172.66.43.97`, Cloudflare | marketing site 200, API doc 200, `one.inx.co` 301 to `trading.republic.com`, help center 403 with Cloudflare error 1034 | P1 |
| `trading.republic.com` | `104.18.24.137`, `104.18.25.137`, Cloudflare | 403 "Sorry, you have been blocked" on the web app and on its `/exchange/market/getAllMarkets`, 200 on `robots.txt` | P1 |
| `gw-client-api-rest.trading.republic.com` | `104.18.24.137`, `104.18.25.137` | the origin answers JSON when the request carries a User-Agent, and Cloudflare answers 403 "Attention Required!" when it carries none | P2 |
| `api.inx.co` | no address | | P1 |

The User-Agent rule matters for the engine, because the `ws` package sends no User-Agent and neither does [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) at line 81.
A request with no User-Agent got the Cloudflare block on both gateways in the two runs of P2 that tried it.

### Request time

| call | first request, new connection | warm, same connection |
|---|---|---|
| `GET /api/ping`, which answers 401 | 152, 132 and 139 ms in three runs | 27 to 40 ms over 18 calls in three runs of 6 |

`serverprocesstime` read 0 or 1 ms on every gateway reply that carried it, P2.

## 2. Catalog

### The instruments call

| item | documented | probed |
|---|---|---|
| call | `POST /api/market/getMarkets`, header parameters `nonce`, `timestamp`, `apiKeyId` and `signedContext`, S1 | 401 without them, body below |
| reply | an array of `{id, lastPrice, marketName, minOrderQuantity, maxOrderQuantity, priceIncrement, assetClass, isActive}`, with `marketName` spelled `BTC-USD` and `assetClass` `CRYPTOCURRENCIES`, S1 | not reachable |
| `GET` on the same path | | 404 `{"status":404,"error":"Not Found","message":"Cannot GET /api/market/getMarkets"}` |

```json
{"status":401,"error":"Unauthorized","message":"Request headers are invalid. Please make sure that on the request headers you have the following fields: apiKeyId, nonce, timestamp. Raw error message: \"\\\"nonce\\\" is required. \\\"timestamp\\\" is required. \\\"apikeyid\\\" is required. \\\"signedcontext\\\" is required\""}
```

A key comes from an API application submitted under the user settings of `trading.republic.com`, and it is usable only once INX approves it, S1.
The signature is `crypto.sign('sha256', ...)` over the JSON of `{nonce, timestamp, apiKeyId}` with the account's private key, an RSA key in the example, and a timestamp more than 20 s from the server clock is refused with 401, S1.

The web app used its own unauthenticated catalog, `GET https://one.inx.co/exchange/market/getAllMarkets`, which a Wayback capture of 2024-07-02 shows returning 21 markets, 16 `CRYPTOCURRENCIES` and 5 `DIGITAL_SECURITIES`, with `marketName`, `asset1`, `asset2`, `lastPrice`, order limits and `isActive`, S3.
Today that path answers 301 to `https://trading.republic.com/exchange/market/getAllMarkets`, which answers this host with the Cloudflare 403, P1.
It is not in the API documentation, so it is not a public API even where it answers.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no INX or Republic class among its 104 ids, and CCXT master at commit `1d8b674` has none among the 105 files of `ts/src`, see [`fees.md`](./fees.md) section 8.
The engine's catalog path through `loadMarkets` therefore has nothing to load.

### Size unit, pairs listed twice, and price scale

Not applicable, since this is spot with no catalog reachable.
The documented book socket sends `amount` in the base asset, see [`websocket.md`](./websocket.md) section 4.

## 3. Anchor

INX One publishes no index price, no mark price and no funding rate, because it lists no perpetual, S1.
The only reference price documented is `lastPrice` in the keyed `getMarkets` reply, S1.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable.
There is no index basket, mark formula, clamp or funding formula to record.

## 5. REST book snapshot

None is documented.
The REST API has no order book call, S1.
Its groups are Markets, Trades, Orders, Funding, Ping and Websocket authentication.
The spec lists the signed headers on every call except `/api/ping`, `/api/funding/whitelistAddress` and three `/keys/...` calls, and `/api/ping` asked for them on the wire, section 7.
The only documented book is the socket's snapshot on subscribe, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| request limit | "The default request limits are set to 10 per second and 100 per minute.", per API key, S1 | not reached. P2 sent 15 requests spaced 300 to 400 ms apart |
| socket limit | "Websocket connections are limited to 5 subscriptions per key.", S1 | not reachable |
| limit headers | `ratelimitpersecondleft`, `ratelimitperminuteleft`, `serverprocesstime` and `requestid` on responses, S1 | `serverprocesstime` and `requestid` came back on 401 and 404 replies, with `requestid` reading `REQUEST_ID_NOT_FOUND_ON_ERROR` on `GET /`, and the two rate limit headers never came back |
| status of a limit | Not publicly specified | no 429 seen |
| `Retry-After` | Not publicly specified | none seen |

| request | status | body |
|---|---|---|
| `GET /api/ping`, `POST /api/market/getMarkets`, `POST /api/createToken`, no credentials | 401 | the JSON above |
| `POST /api/ping` | 404 | `{"status":404,"error":"Not Found","message":"Cannot POST /api/ping"}` |
| `POST /api/market/nope` | 404 | `{"status":404,"error":"Not Found","message":"Cannot POST /api/market/nope"}` |
| `GET /` | 404 | `{"status":404,"error":"Not Found","message":"Cannot GET /"}` |
| `GET /api/ping` on the REST gateway and `GET /` on the socket gateway, with no User-Agent | 403 | Cloudflare HTML, title "Attention Required! \| Cloudflare" |

The error body follows the documented shape `{"status", "error", "message"}`, S1.

## 7. Server time and clock offset

The documentation describes `/api/ping` as a request that "Returns a response with the server time", labels it `post`, and lists no header parameters, S1.
On the wire `POST /api/ping` answers 404 and `GET /api/ping` answers 401 asking for the signed headers, so the server time call is keyed like every other, P2.
The `Date` header of 18 unauthenticated pings over three runs sat 31 to 919 ms before the midpoint of each request.
Since the header truncates to the second, that bounds the server clock between 31 ms behind and 81 ms ahead of this host, P2.

## 8. Recommended poller shape

No poller is recommended.
INX One has no perpetual and publishes no index, mark or funding, and its only catalog and price calls need an approved API key, sections 2 and 3.
If a keyed spot leg were ever designed, `POST /api/market/getMarkets` is the catalog, and the socket's book is the only price source, since REST has no book call.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Digital Assets Trading Platform API, OpenAPI 3.0.3, version V1, `Last-Modified: Tue, 08 Sep 2026 18:09:36 GMT` | https://apidoc.inx.co/ | 2026-09-23 04:49 UTC | INX, global | hosts, authentication, endpoints, limits, error shape, sections 1 to 8 |
| S2 | INX Fee Schedules | https://www.inx.co/fee-schedules | 2026-09-23 04:41 UTC | INX Digital, Inc., United States | products, see [`fees.md`](./fees.md) |
| S3 | Wayback Machine capture of `one.inx.co/exchange/market/getAllMarkets`, 2024-07-02 20:35 UTC | https://web.archive.org/web/20240702203516/https://one.inx.co/exchange/market/getAllMarkets | 2026-09-23 | INX web app | the web app's old catalog, section 2 |
| P1 | `rest-probe.mjs access`, runs at 04:51 and 05:01 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/inx-one/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | DNS, status codes and refusals, section 1 |
| P2 | `rest-probe.mjs api`, runs at 04:52, 04:58 and 05:01 UTC, the User-Agent check in the last two | [`rest-probe.mjs`](../../../scripts/probes/venues/inx-one/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | gateway replies, timing, User-Agent rule, clock, sections 1, 2, 6 and 7 |
