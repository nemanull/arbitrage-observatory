# Dex-Trade REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:29 to 03:48 UTC in three runs, from the development host near Seattle.

This profile covers the public REST API of Dex-Trade for its spot market, because Dex-Trade lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): the spot catalog stands where the perpetual catalog would, and no anchor poller is recommended.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) unless a ledger row says otherwise.
The documented API has four public calls under `/v1/public/`, S1.
The website uses a second, undocumented API under `https://api.dex-trade.com/api/`, and this profile names its calls where they answer a question the documented four cannot.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api.dex-trade.com`, behind Cloudflare, with `cf-ray` ending `YVR` in runs P1 and P6 and `SEA` in P5, the Vancouver and Seattle edges |
| resolved | `172.67.72.12`, `104.26.2.60`, `104.26.3.60`, and three IPv6 addresses, the same set as `socket.dex-trade.com` and `docs.dex-trade.com` |
| cold request | 566, 600 and 564 ms in the three runs, `GET /v1/public/symbols` |
| warm requests | 177 to 198 ms over 5 calls per run, median 180, 182 and 182 ms |
| geoblock | none: every public call answered 200 or its documented error, and the socket upgraded, see [`websocket.md`](./websocket.md) section 1 |

## 2. Catalog

### The instruments call

`GET /v1/public/symbols` returned 200 with 46 rows of `id`, `pair`, `base`, `quote`, `rate_decimal`, `base_decimal` and `quote_decimal`, 5,145 bytes.

| quote | pairs |
|---|---:|
| USDT | 38 |
| USDC | 2 |
| ETH | 2 |
| BTC | 1 |
| SOL | 1 |
| BNB | 1 |
| AUSDT | 1 |

The call carries no status field.
The site's bulk ticker `GET /api/default/ticker` lists 48 rows, 46 with `status` 0 and 2, `GTCUSDT` and `US7USDT`, with `status` 3 and absent from `symbols`, so `symbols` is the tradable list.
No row names BTC, ETH, SOL, XRP, BNB or DOGE as its base, and `BTCUSDT` answers 400 `Incorrect pair`.
Only `AXYC` is listed more than once, against USDT, SOL and BNB.
Three pair names mix case: `RtimeUSDT`, `HortaCCUSDT` and `USDiUSDT`.
The book call accepts `elgusdt` for `ELGUSDT`, so the pair lookup ignores case, section 6.

The scale of each integer on the socket comes from these three fields, and they differ by pair:

| `rate_decimal` / `base_decimal` / `quote_decimal` | pairs |
|---|---|
| 8 / 8 / 8 | 38 |
| 12 / 0 / 8 | `FRTCUSDT`, `RtimeUSDT` |
| 12 / 1 / 8 | `SUSDTUSDT` |
| 10 / 8 / 8 | `AAAUSDT` |
| 9 / 4 / 8 | `APEPEUSDT` |
| 8 / 5 / 8 | `LUSDUSDT` |
| 8 / 6 / 8 | `BLOTIXUSDT` |
| 8 / 7 / 7 | `ALLAUSDT` |

### How CCXT 4.5.68 maps it

It does not.
CCXT has no Dex-Trade class in 4.5.68 or in the current master, see [`fees.md`](./fees.md) section 8.
The engine's catalog is CCXT `loadMarkets` filtered to active swaps, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68, 79 and 196 to 202, so Dex-Trade would need a catalog loader of its own even for spot.
For such a loader, `pair` is the name the REST calls take, the socket room is `book_<id>`, and the size unit is base currency, see [`websocket.md`](./websocket.md) section 4.

### Overlap with perpetual venues

Of the 44 bases, only `VRT` also names a Bybit linear perpetual among the 845 trading on 2026-09-23.
Whether the two are one token is Not verified.

## 3. Anchor

Dex-Trade publishes no index, no mark and no funding rate, because it lists no perpetual.

| call | what it carries | reply | time |
|---|---|---|---|
| `GET /v1/public/ticker?pair=<pair>`, documented | `last`, `open`, `close`, `high`, `low`, `volume_24H`, `min_trade`, and a key spelled `percent_сhange` whose ninth character is the Cyrillic `с`, U+0441 | one pair per call | 184 to 198 ms |
| `GET /api/default/ticker`, undocumented | every pair with `rate`, `high`, `low`, `volume` as scaled integers, per pair fees, and each currency's `rate_usd`, `rate_usdt` and `rate_btc` | 48 rows, 50,940 to 50,998 bytes | 497 to 512 ms |

The `rate_usd` of each currency is the site's own conversion price, not an index built from other venues.
The documentation spells the ticker key `percent_change`, S1, and the wire spells it with the Cyrillic letter on both pairs read in all three runs, so a parser that looks up the Latin name finds nothing.

## 4. Anchor semantics

Nothing to describe, since there is no index, mark or funding, section 3.
For the book itself, 30 polls one second apart moved the REST `sequenceId` 3 times on `AVDOUSDT`, 0 times on `ELGUSDT` and 6 times on `BIMUSDT` in P1, and the best bid or ask changed 2, 0 and 0 times.
In P5 the same polls moved the `sequenceId` 14, 0 and 3 times, and the best bid or ask 12, 0 and 1 times.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /v1/public/book?pair=<pair>`, S1 |
| reply | `{"status":true,"data":{"buy":[{"volume","rate","count"}…],"sell":[…],"sequenceId"}}`, with `volume` and `rate` as JSON numbers already divided by the scale |
| depth | every level by default: 528 bids on `ALLAUSDT`, and 109 or 110 bids on `AVDOUSDT` |
| depth parameter | undocumented `limit` caps a side: `limit=100` returned 100 bids and 48 to 52 asks on `AVDOUSDT` in the three runs. `depth=100` is ignored and returned 109 or 110 bids |
| level order | `buy` descending and `sell` ascending, best first, on 46 of 46 pairs in P5 and P6, and on the 4 watched pairs in all three runs |
| `sequenceId` | the same counter as the socket's `sequenceId` for that pair, see [`websocket.md`](./websocket.md) section 4 |
| caching | `cf-cache-status: DYNAMIC`, so Cloudflare does not cache it |
| time | 178 to 200 ms on the 4 watched pairs over the three runs, and a median of 179 to 191 ms per pair over each 30 poll run |

Across all 46 pairs the book sizes ran from empty to 528 levels on one side.
`GGLDUSDT` and `HTNUSDT` were empty, and `ETNUSDT` (43 or 42 bids, 0 asks), `AXYCSOL` and `AXYCBNB` (1 bid, 0 asks each) were one-sided, in all three runs.
`GET /v1/public/trades?pair=<pair>` lists recent trades with `timestamp` in Unix seconds, S1.

## 6. Rate limits and errors

No rate limit is published in the API documentation, S1.
No reply carried a rate limit header, and the probe never drew a 429 at up to 2 requests per second.
The only headers of note were `cf-cache-status`, `cf-ray` and `server: cloudflare`.

| request | status | body |
|---|---|---|
| `ticker?pair=NOPEUSDT` or `BTCUSDT` | 400 | `{"status":false,"error":"Incorrect pair"}` |
| `ticker` with no `pair` | 400 | `{"name":"Bad Request","message":"Missing required parameters: pair","code":0,"status":400}` |
| `book?pair=NOPEUSDT` or `ELG/USDT` | 400 | `{"status":false,"error":"Incorrect pair"}` |
| `book?pair=elgusdt` | 200 | the `ELGUSDT` book |
| `trades?pair=NOPEUSDT` | 400 | `{"status":false,"error":"Incorrect pair"}` |
| `/v1/public/nope` | 404 | an HTML page, `Not Found (#404)` |

## 7. Server time and clock offset

The documented API has no time call, and `GET /v1/public/time` answers 404.
The site's `GET /api/info/time` returns `{"status":true,"data":1790134244074,"is_login":false}`, Unix ms.
Five reads per run with round trips of 175 to 182 ms put the server clock 0 to 5 ms ahead of this host, with medians of 0, 4 and 1 ms.

## 8. Recommended poller shape

None.
Dex-Trade has no index, mark or funding to poll, so no anchor poller is recommended.
If a spot stage ever reads it, the only REST call a feed needs is the book snapshot of section 5, once per pair after the socket acknowledges the room and again after a sequence gap, see [`websocket.md`](./websocket.md) section 8.
With no published limit, one snapshot request at a time, as the probe did, is the safe pace.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Dex-Trade API, apidoc 1.1.7, Public API group: Ticker List, Ticker Info, Order Book, Trade History | https://docs.dex-trade.com/ | 2026-09-22 | Dex-Trade, global | the four public calls and their fields, sections 2 to 6 |
| P1 | `rest-probe.mjs all`, 03:29 to 03:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P5 | `rest-probe.mjs all`, second pass, 03:41 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7, the second readings and the level order sweep |
| P6 | `rest-probe.mjs main`, 03:46 to 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7, the third readings |
