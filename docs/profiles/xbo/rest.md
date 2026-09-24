# XBO.com REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:23 to 04:38 UTC, second pass 04:41 to 04:45 UTC), from the development host near Seattle, through its Canadian VPN exit.

This profile covers the REST side of XBO.com's USDT-margined perpetuals.
XBO documents one futures REST call, the catalog, and it needs an API key.
It documents no futures book, index, mark, funding or server time call.
The only REST data XBO serves without a key is spot, through the Public API, S2, and two Client API reference calls.
The spot calls are recorded briefly in sections 1, 2, 5 and 6, because they are the only public surface and they show what this host could reach.
Every number below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/xbo/rest-probe.mjs) unless a source id says otherwise.

## 1. Host and latency from this machine

`api.xbo.com` resolved to `104.18.26.152`, `104.18.27.152`, `2606:4700::6812:1a98` and `2606:4700::6812:1b98`, all Cloudflare, in both runs, P1 and P2 `host`.
Replies came through Cloudflare edges in Seattle (`cf-ray` ending `-SEA`) and Vancouver (`-YVR`), with `cf-cache-status: DYNAMIC`.
Every result here is from a laptop whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

| call | status | reply | cold, P1 and P2 | warm, 10 requests, P1 and P2 |
|---|---|---|---|---|
| `GET /trading-pairs` | 200 | 64 KB | 694 and 1,083 ms | median 253 and 311 ms, range 210 to 552 ms |
| `GET /orderbook/BTC%2FUSDT?depth=20` | 200 | 720 B | 186 and 207 ms | median 199 and 208 ms, range 178 to 253 ms |
| `GET /trading-pairs/stats` | 200 | 99 KB | 355 and 260 ms | median 286 and 268 ms, range 207 to 542 ms |
| `GET /v1/futures/trading-pairs` | 401, empty body | 0 B | | P3 |
| `wss://api.xbo.com/ws/v1/futures` upgrade | 401, empty body | 0 B | 321 to 521 ms | see [`websocket.md`](./websocket.md) section 1 |

No reply carried a regional refusal, a challenge page or a `Retry-After`.

## 2. Catalog

### The instruments call

`GET https://api.xbo.com/v1/futures/trading-pairs` is the documented futures catalog, S1.
It "accepts no parameters and always returns the complete list", S1.
Without a key it answered HTTP 401 with an empty body on every attempt, P3.
The Client API Postman collection lists 35 requests and none under `/v1/futures/`, S12.
The documented `401` means "Missing or invalid HMAC authentication headers", and a documented `403 Forbidden customer type` means the account "does not support the functionality", S1.

The documented row, S1, is quoted so that a keyed probe can check it.

```json
{"instrumentId": "BTC-USDT-PERP", "symbol": "BTC/USDT", "description": "Bitcoin perpetual futures", "baseCurrency": "BTC", "quoteCurrency": "USDT", "maxLeverage": 50, "minVolumeTrade": 0.001, "maxVolumeTrade": 100, "precision": 2, "volumeStep": 0.001}
```

| field | meaning, S1 |
|---|---|
| `instrumentId` | `BTC-USDT-PERP` for a perpetual, `BTC-USDT-260626` for a dated future, and the socket's `instrumentId` |
| `symbol` | display symbol `BTC/USDT`, the same spelling as a spot pair |
| `minVolumeTrade`, `maxVolumeTrade`, `volumeStep` | "in base currency" |
| `precision` | price decimals |
| status or active flag | none. "Pairs that are disabled or hidden are never returned." |

So the active perpetual count is unknown.
The futures landing page claims "Over 100 assets", see [`fees.md`](./fees.md) section 3.
Whether any contract is settled in USDC or a coin is Not publicly specified.

### How CCXT 4.5.68 maps it

No CCXT class exists for XBO.com in 4.5.68 or on the master branch, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.
A catalog for the engine would have to be written outside CCXT from `instrumentId`, and the documented `symbol` spells a perpetual exactly like the spot pair, so `symbol` cannot key it.

### The public spot catalog, for context

| call | reply on 2026-09-23 | source |
|---|---|---|
| `GET /trading-pairs` | 294 rows in both runs, all `isEnabled` true, keys `symbol`, `description`, `baseCurrency`, `quoteCurrency`, `lastPrice`, `isEnabled`, `last24HTradeVolume`, `last24HTradeVolumeUsd` | P1 `catalog`, S2 |
| quotes | USDT 206, USDC 25, USD 22, EUR 19, BTC 7, AUD 3, CHF 3, GBP 3, SEK 3, CAD 2, MXN 1 | P1 `catalog` |
| `GET /trading-pairs/stats` | 294 rows, every row with a bid and an ask, none crossed | P1 `catalog` |
| `GET /currencies` | 234 rows, 215 crypto and 19 fiat | P1 `catalog` |
| `GET /v1/spot-trading/symbols?page=1&count=100` | a Client API call that answers without a key, `total` 294, the same 294 symbols as `/trading-pairs`, and `count=1000` returns all 294 in one page | P1 `catalog` |

No spot symbol contains `PERP`, `SWAP` or a six digit date, so the perpetuals are not in the spot catalog.
The spot symbol is always `BASE/QUOTE` with a slash, and no pair is listed twice.

## 3. Anchor

XBO publishes no index price, no funding rate, no funding interval and no next settlement time in either API, S1, S2.
The word "funding" appears in neither reference, and "index" appears in neither.
The one anchor number documented is `mark` on the `tickers` channel of the authenticated futures socket, see [`websocket.md`](./websocket.md) section 2.
No REST call returns a mark, so there is no bulk anchor call.

| `AnchorRow` column | XBO source |
|---|---|
| key | `instrumentId`, from the keyed catalog |
| `index` | none |
| `mark` | `mark` on the keyed `tickers` channel, a string or `null` |
| `fundingRate` | none |
| `fundingIntervalHours` | none |
| `nextFundingAt` | none |

The terms name a "Derivatives and perpetual futures index ("Derivatives Index")" that users may trade against, and they publish neither its formula nor a data call, S6 section 3.17.
The spot `GET /trading-pairs/stats` carries `lastPrice`, `highestBid` and `lowestAsk` for every spot pair, which is a spot reference and not an index.

## 4. Anchor semantics

| item | value | source |
|---|---|---|
| index formula and basket | Not publicly specified | S1, S2, S3 |
| basket call | none | S1, S2 |
| mark formula and clamps | Not publicly specified. The mark is used for unrealised profit | S3 |
| funding formula and cap | Not publicly specified beyond "determined by the difference between the perpetual contract price and the spot price" | S3 |
| published rate upcoming or settled | no rate is published | S1, S2 |
| funding interval | "typically settled at fixed intervals, often every 8 hours", a generic sentence | S3 |
| change over a minute of polls | not measurable, nothing is reachable without a key | P3 |

No settlement instant was captured, since no funding number is reachable.

## 5. REST book snapshot

XBO documents no futures REST book, S1.
The spot book is public and was probed for context.

| item | documented | probed |
|---|---|---|
| call | `GET /orderbook/{symbol}?depth={depth}`, symbol `BTC/USDT` with the slash encoded, S2 | `/orderbook/BTC%2FUSDT` answers 200, the raw slash answers 404, and `/orderbook/BTC-USDT` also answers 200 with a BTC book |
| depth | "Default depth is 50 Max depth is 250.", S2 | `depth=250` and `depth=1` answer 200. `251` and `1000` answer 400 `invalid-depth` "depth should be less then 250". `0` and `-1` answer 400 `invalid-depth` "invalid depth" |
| levels returned | up to the depth asked | BTC/USDT held 30 bids and 30 or 31 asks at the default and at 250. At 250, ETH/USDT held 24 or 26 bids and 23 asks, BTC/EUR 29 and 31, and ZEC/USDT 52 and 52, in both runs |
| level order | "arranged by best asks/bids", S2 | bids descending and asks ascending on all four pairs in both runs, 0 exceptions |
| numbers | `number($decimal)`, S2 | price and size are JSON numbers, not strings |
| timestamp | "States when the last updated time has occurred.", milliseconds, S2 | 73 to 185 ms older than arrival on BTC/USDT, and it changed on 59 of 59 consecutive polls at 1 s in both runs |
| caching | not documented | `cf-cache-status: DYNAMIC`, and two reads 300 ms apart carried different timestamps |
| width | | BTC/USDT spread 203 to 359 ppm and ETH/USDT 395 to 431 ppm. Twenty BTC samples put the XBO mid 83 to 239 ppm above the Binance spot mid, and ETH sat 56 ppm below to 128 ppm above. XBO's bid was at or below Binance's bid and XBO's ask at or above Binance's ask on 9 of 20 BTC and 20 of 20 ETH samples, P1 and P2 `compare` |
| Client API twin | `GET /v1/spot-trading/orderbook/{symbol}`, S1 | 401 with an empty body without a key, P3 |

Over 60 polls at 1 s, BTC/USDT answered in 166 to 477 ms with medians of 218 and 194 ms, and the touch changed on 48 and 22 of 59 steps, P1 and P2 `poll`.
ZEC/USDT answered in 167 to 600 ms and its touch changed on 56 and 57 of 59 steps.
`GET /trading-pairs/stats` polled every 5 s answered in 248 to 1,110 ms, and 125 to 208 of its 294 rows changed between polls.
`GET /trades?symbol=BTC%2FUSDT` returned 1,000 rows covering 14.5 and 14.6 h, with `timeStamp` in seconds although S2 says milliseconds, and `type` `BUY` or `SELL` although S2 shows `Buy` and `Sell`, P1 `book`.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| published rate limit | none in either reference | S1, S2 |
| burst probed | 40 book requests at about 4 per second all answered 200 in both runs, with no header named rate, limit or retry | P1 and P2 `burst` |
| `Retry-After` | never seen | P1 |
| 401 | empty body, "A 401 response has an empty body." | S1, P3 |
| 404 | empty body on an unknown path | P3 |
| 400, business error | `{"code": "invalid-depth", "message": "depth should be less then 250", "errors": {}}` | P1 `book` |
| 400, unknown symbol | `{"code":"unknown-exception","message":"CryptoExchangeException:Instrument 'NOPE/USDT' is not found"}`, and a lowercase `btc/usdt` gives `CryptoExchangeException:Symbol not exist` | P1 `book` |
| 400, validation | an RFC 9110 problem body, `{"errors": {"depth": ["The value 'abc' is not valid."]}, "type": …, "title": "One or more validation errors occurred.", "status": 400, "traceId": …}` | P1 `book`, matches S1 "a different body, which has no code field" |
| unknown symbol on trades | 200 with `[]` | P1 `book` |
| server fault | `500` with `{"code": "server-error", "message": "Server Error"}` | S1, not seen |
| User-Agent | "Requests without one may be blocked by the edge firewall." | S1 |

## 7. Server time and clock offset

No server time call is documented, S1, S2, and the guess `GET /v1/time` answered 404, P3.
The `Date` header, which has one second resolution, read 819 ms behind to 64 ms ahead of the local midpoint over 20 requests in two runs, with medians of 293 and 303 ms behind, P1 and P2 `host`.
That spread is what a whole second header produces, so the clocks agree to within a second.
The spot book `timestamp` arrived 73 to 100 ms old in the same requests, against a round trip of about 180 to 250 ms, which is consistent with an offset under about 100 ms, and that is an inference.
The futures socket needs a signed timestamp "within 60 seconds of server time", S1, which a clock this close meets.

## 8. Recommended poller shape

No anchor poller is recommended.
XBO publishes no index, no funding rate, no interval and no next settlement, and its only mark is on a socket that needs a key, section 3.
Without a poller, an XBO leg is never written, so the reader returns `anchor_missing` and refuses the route at open, at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) lines 25 to 27.
The fresh premium the gate uses needs only the mark, at line 84 of the same file, so a keyed `tickers` feed could in principle supply it.
The index gap and the carried premium at lines 58 and 59 need an index, which XBO does not publish.

| item | value | reason |
|---|---|---|
| URL | none | no REST anchor call exists |
| interval | none | |
| row mapping | section 3, only `mark` has a source | |
| skip | every XBO market | no public anchor |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | XBO Client API reference | https://docs.xbo.com/ | 2026-09-22 | XBO, global | futures catalog and its 401 and 403, spot Client API calls, error shapes, User-Agent rule, signed timestamp window, sections 2, 3, 5, 6 and 7 |
| S2 | XBO Exchange Public API reference | https://public-docs.xbo.com/ | 2026-09-22 | XBO, global | `/orderbook`, `/currencies`, `/trading-pairs`, `/trades`, `/trading-pairs/stats`, "No authentication is required.", sections 2, 3, 5 and 6 |
| S3 | Futures trading help centre | https://www.xbo.com/en/support-futures-trading | 2026-09-22 | XBO, global | funding text, mark in the profit formula, section 4 |
| S6 | XBO Terms of Use, PDF, last updated 2026-09-03 | https://www.xbo.com/files/Terms&Conditions.pdf | 2026-09-22 | CLICKJOINT B.V., Curaçao | "Derivatives Index", section 3 |
| S12 | XBO Client API Postman collection | https://docs.xbo.com/postman/collections/XBO_Client_API.postman_collection.json | 2026-09-22 | XBO | 35 requests, none under `/v1/futures/`, section 2 |
| P1 | `rest-probe.mjs` modes `host`, `catalog`, `book`, `poll`, `burst` and `compare`, 04:30 to 04:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xbo/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1, 2, 5, 6 and 7 |
| P2 | `rest-probe.mjs all`, second pass at 04:41 to 04:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xbo/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | the second readings |
| P3 | `rest-probe.mjs refused` at 04:34 UTC and 04:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xbo/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | 401 on the futures catalog and the Client API book and stats, 404 on the guesses, sections 1, 2, 3, 5, 6 and 7 |
