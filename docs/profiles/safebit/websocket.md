# SAFEbit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:26 and 03:36 UTC), from the development host near Seattle, upgrade attempts only.

SAFEbit publishes no WebSocket API.
Its public API is a REST feed for aggregators, see [`rest.md`](./rest.md), and it lists no perpetual, so this profile covers what exists for the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
The web app does run a socket, and its client code is described below as read from the page scripts, S3.
That socket is not documented for outside use, its URL and channel prefix come from an internal call that refused this host, and the user agreement forbids automated access through interfaces SAFEbit does not provide, see [`fees.md`](./fees.md) section 1.
So [`ws-probe.mjs`](../../../scripts/probes/venues/safebit/ws-probe.mjs) only tried the upgrade on four URLs and sent no frame.

## 1. Endpoints

| URL | documented | probed on 2026-09-23 at 03:26 and 03:36 UTC |
|---|---|---|
| any public market data socket | none. The Swagger of the public API lists 20 GET calls and no socket, S1 | |
| `wss://ws.safebit.com.tr/connection/websocket` | not documented. The path is the default of the Centrifugo protocol the web client speaks, an inference, section 2 | 101 Switching Protocols, open in 699 ms in the rerun, and about 654 ms in the first run, which is the 5,654 ms total less the 5,000 ms hold. No extension header, no frame from the server in 5 s, then closed by the probe |
| `wss://ws.safebit.com.tr/` | not documented | 403 from Cloudflare, HTML titled "Attention Required! \| Cloudflare" with the heading "Sorry, you have been blocked", in 54 and 72 ms. A plain `curl` GET of `https://ws.safebit.com.tr/` got the same page |
| `wss://api.safebit.com.tr/` | not documented | 404, empty body, in 855 and 812 ms |
| `wss://www.safebit.com.tr/` | not documented | 502, body `error code: 502`, in 788 and 965 ms |

`ws.safebit.com.tr` resolved to 104.18.15.151 and 104.18.14.151, Cloudflare addresses shared with `api` and `www`, P1.

How the web app finds its socket, from the page scripts, S3:

- The socket URL is `SocketUrl` and the channel prefix is `AppId`, both from `GET https://www.safebit.com.tr/api/WebSocket/GetProvider?languageCode=en&channel=web`.
- Each market's channel stem is `MarketQueueName`, from the internal market list `/api/Order/GetMarketCurrencyCoinMatches`.
- Every internal call carries a fixed `ApiToken` header that the script bundle holds, plus a reCAPTCHA token and a bearer token when the visitor has them.

An anonymous request to `GetProvider`, `GetMarketCurrencyCoinMatches` and `/api/Ticker/GetCoinRates` from this host answered 403 with an empty body and `server: cloudflare`, on 2026-09-23 at 03:17 and 03:27 UTC.
The empty body, unlike the Cloudflare block page above, suggests the application refused the request for lack of the `ApiToken` header, which is an inference.
This survey did not send that header, because it is the web app's own credential and using it would route around the refusal.
Without `AppId` and `MarketQueueName`, no channel name can be formed, so the socket that accepted the upgrade cannot be subscribed from outside.

## 2. Channel matrix for public market data

Nothing is documented.
The web client builds these channels, read from the page scripts, S3, and none was probed.

| channel as the web client names it | event in the push | payload the client reads | purpose in the web app |
|---|---|---|---|
| `<AppId>_<MarketQueueName>_tickerv3` | `order-ticker` | `b` and `s`, each a string `"price,size\|price,size\|…"` | the order book of one market, bids in `b`, asks in `s` |
| `<AppId>_<MarketQueueName>_tradev3` | `trade-ticker` | one string of `\|` separated trades, each `time,price,size,?,id,takerType` | recent trades of one market |
| `<AppId>_coin_rate` | `rate-ticker` | `BaseAssetCode`, `QuoteAssetCode`, `Price`, `Change24H`, `Volume24H`, `MarketCap` | the price list |
| mark, index, funding | none | | no derivatives exist |
| best bid and ask only | none | | |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
No axis is documented, so the middle column is what the web client does, S3, and the right column is what the probe saw.

| axis | documented | web client, S3 | probed |
|---|---|---|---|
| endpoint split axis | Not publicly specified | one `SocketUrl` for everything, shared by every subscription through one socket per page | not probed |
| subscribe frame shape | Not publicly specified | `{"params": {"channel": "<channel>"}, "method": 1, "id": <n>}`, one channel per frame, after a first frame `{"params": {"name": "js"}, "id": 1}` | not sent |
| unknown symbol expectation | Not publicly specified | not handled | not probed |
| chunk unit and budget | Not publicly specified | one channel per frame | not probed |
| keepalive mechanism | Not publicly specified | the socket module has no timer, no ping and no reconnect | no frame from the server in 5 s on an unsubscribed socket |
| connection lifetime and maintenance notice | Not publicly specified | the close handler does nothing, and a new socket opens only when a component next asks for one | not probed |
| handshake and operation rate limits | Not publicly specified | | one upgrade per URL, no refusal on the Centrifugo path, a Cloudflare block on the root path |
| public market data authentication | Not publicly specified | the channel prefix comes from an internal call that needs the web app's `ApiToken` header | the upgrade needs no token, a channel name does |
| message parse and routing | Not publicly specified | a frame may hold several JSON objects back to back, split by brace depth. The client reads `result.data.data` and switches on its `event` | not probed |
| subscribe acknowledgement shape | Not publicly specified | the client ignores any reply that has no `result.data.data` object | not probed |
| symbol identifier format | Not publicly specified | `MarketQueueName` from the internal market list, not the public `ticker_id` | not probed |
| number representation | Not publicly specified | book and trade levels are decimal text inside one delimited string, parsed with `Number()`. The rate ticker carries JSON fields | not probed |
| timestamp representation | Not publicly specified | the trade string's first field is passed to a `tradeDateToIso` helper | not probed |
| size unit | Not publicly specified | the book size is stored as `CoinValue`, the base asset amount | not probed |
| sequence semantics | Not publicly specified | none. Each `order-ticker` push replaces the whole list of bids and asks | not probed |
| idle repeat behaviour | Not publicly specified | | not probed |

The first frame, the numeric `method` of 1 to subscribe and 2 to unsubscribe, and the `result.data.data` wrapper match the JSON client protocol of Centrifugo version 2.
That match is an inference from the code, and SAFEbit does not name its socket server.

## 4. The book channel in detail

What follows is read from the web client, S3, and none of it was observed on the wire.

- Snapshot semantics: every `order-ticker` push is parsed in full and replaces the whole book the page holds, bids from `b` and asks from `s`.
- Deltas: none are handled, so the channel is either a full book on every push or the web app tolerates a partial one.
  Which it is was not observed.
- Sequence and gap rule: the client reads no sequence field, so none is known to exist.
- Checksum: none is read.
- Level order: the client does not sort, so the order on the wire is whatever the server sends.
  Not verified.
- Depth: not visible in the client.
- Size unit: base asset, named `CoinValue`, and the client computes a total as price times size.
- One-sided and empty books: an empty `b` or `s` becomes an empty side.
  The public REST book shows `USDC_TRY` with asks only and `USDT_TRY` empty, see [`rest.md`](./rest.md) section 5.
- Unknown or closed symbols: not visible.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | no server frame in the 5 s the probe held the upgraded socket |
| silence the server tolerates | Not publicly specified | not probed |
| forced disconnect | Not publicly specified | not probed |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | the probe offered no permessage-deflate, as the engine does, and the 101 carried no `sec-websocket-extensions` header |
| handshake | | 101, open in about 654 ms and 699 ms on `wss://ws.safebit.com.tr/connection/websocket` |
| subscription limits | Not publicly specified | not probed |

## 6. Captured frames

No frame was captured, because the probe subscribed to nothing and the server sent nothing in 5 s.
The probe's own lines for the four upgrades, trimmed, P1:

```json
{"tag":"upgrade","url":"wss://ws.safebit.com.tr/","ms":54,"status":403,"server":"cloudflare","cfRay":"a3f672900c7b9264-YVR","type":"text/html; charset=UTF-8","bytes":4549,"title":"Attention Required! | Cloudflare","h1":"Sorry, you have been blocked"}
```

```json
{"tag":"upgrade","url":"wss://ws.safebit.com.tr/connection/websocket","ms":5654,"status":101,"openedAndHeldMs":5000,"unsolicitedFrames":0}
```

```json
{"tag":"upgrade","url":"wss://api.safebit.com.tr/","ms":855,"status":404,"server":"cloudflare","cfRay":"a3f672b3dfa4ec5c-SEA","bytes":0,"text":""}
```

```json
{"tag":"upgrade","url":"wss://www.safebit.com.tr/","ms":788,"status":502,"server":"cloudflare","cfRay":"a3f672b91dafc5d5-YVR","type":"text/plain; charset=UTF-8","bytes":16,"text":"error code: 502\n"}
```

The frames the web client sends, reconstructed from its code, S3, never sent by this survey.
`<AppId>` and `<MarketQueueName>` are placeholders, since neither value could be read.

```json
{"params": {"name": "js"}, "id": 1}
```

```json
{"params": {"channel": "<AppId>_<MarketQueueName>_tickerv3"}, "method": 1, "id": 4}
```

```json
{"params": {"channel": "<AppId>_coin_rate"}, "method": 1, "id": 2}
```

## 7. Private channels

Named for a future execution stage, from the web client, S3, not probed.

- `<AppId>_Private_<authcode>_order_ticker`, event `order-ticker`, where `authcode` comes from the logged in account.
- No private trading API is documented.
  The web app manages API keys with the internal calls `CreateSubApiKey` and `SetApiKeyPermission`, whose permission labels are "Enable Spot and Margin Trading" and "Enable Withdrawals", S3, but the interface those keys unlock is not published.

## 8. Recommended feed shape

None.
A book feed for SAFEbit cannot be built on a documented interface.

| item | finding | consequence |
|---|---|---|
| public socket | none documented | no `planEndpoints` URL to cite |
| the web app's socket | upgrades anonymously, but channel names need `AppId` and `MarketQueueName` from internal calls that answered 403 | subscribing would mean borrowing the web app's `ApiToken`, which routes around a refusal and breaks the user agreement's rule on automated access |
| sequence and resync | the web client reads no sequence and no checksum | even with access, `resync` could only rely on whole book pushes |
| product | spot only, TRY and USDT quotes | no perpetual leg for the engine in any case |

If a book were ever needed, the public REST snapshot of [`rest.md`](./rest.md) section 5 is the only sanctioned source.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | SAFEbit public API, Swagger `WebApplication2 v1` | https://api.safebit.com.tr/swagger/index.html and https://api.safebit.com.tr/swagger/v1/swagger.json | 2026-09-22 | Safebit | no socket in the public API, section 1 |
| S2 | User Agreement, last updated 14.10.2025 | https://www.safebit.com.tr/en/legals/user-agreement | 2026-09-22 | Safebit, Türkiye | the rule on automated access, sections 1 and 8 |
| S3 | SAFEbit web app scripts, from the home page and `https://www.safebit.com.tr/en/exchange/advanced/BTC_TRY` | chunks under https://www.safebit.com.tr/_next/static/chunks/, among them `2qu8l4im8seo1.js` (HTTP client and internal call paths), `3w1r8yr2dxk81.js` (socket client and frame builders), `2a8n9jnp38n4k.js` (`tickerv3` book handler) and `1fey6w5y-pt1g.js` (`tradev3` handler) | 2026-09-22 | Safebit | `GetProvider`, `SocketUrl`, `AppId`, `MarketQueueName`, channel names, frames, parse rules, private channel, sections 1 to 7. The chunk names change with each deploy |
| P1 | `ws-probe.mjs` at 03:26 UTC, rerun at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/safebit/ws-probe.mjs) | 2026-09-22 | this host | DNS, the four upgrade outcomes, sections 1, 5 and 6 |
| P2 | `curl` of the internal calls `GetProvider`, `GetMarketCurrencyCoinMatches` and `GetCoinRates`, and of `https://ws.safebit.com.tr/`, at 03:17 to 03:27 UTC | not scripted, the status lines are quoted in section 1 | 2026-09-22 | this host | the 403 refusals, section 1 |
