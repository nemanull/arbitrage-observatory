# ChainEX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:48 to 04:59 UTC, and the second pass 05:06 to 05:08 UTC, from the development host near Seattle.

This profile covers the public REST API of ChainEX, a spot only venue with no CCXT class, see [`fees.md`](./fees.md) section 3.
It records the spot catalog and book, and it recommends no anchor poller, because ChainEX publishes no index, mark or funding.
Every protocol claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/chainex/rest-probe.mjs).
Every result is from this host's Surfshark WireGuard exit, which geolocates to Canada, see [`fees.md`](./fees.md) section 1.
The API page at `https://chainex.io/api` renders in the browser only, so its text was read from the site's JavaScript bundle, S1.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api.chainex.io`, `API_URL` in the web bundle, S2 |
| resolved addresses | `104.26.4.232`, `172.67.69.51`, `104.26.5.232` and three IPv6 addresses, all Cloudflare, P1 |
| server headers | `server: cloudflare`, `x-powered-by: Luracast Restler v4`, `cf-cache-status: DYNAMIC`, `cache-control: no-cache, must-revalidate`, P1 |
| Cloudflare edge | `cf-ray` ending `YVR` in the first pass and `SEA` in the second, so the tunnel's exit reaches either edge |
| cold request | 706 ms for `GET /timestamp`, and 815 ms in the rerun, P1 |
| warm request | `GET /timestamp` 172 to 189 ms, median 175 ms, over five requests, and 203 to 230 ms, median 223 ms, in the rerun, P1 |
| public calls | answered with HTTP 200 and no refusal, P1 to P4 |

The web site's own backend is a second host, `https://app.chainex.io/action/<name>`, on the same Cloudflare addresses.
The fees page and the socket's market ids come from it, see sections 2 and 5.

## 2. Catalog

### The instruments call

| call | reply | time |
|---|---|---|
| `GET /market/summary/` | `{"status": "success", "count": 26, "data": [...]}`, 10,193 bytes, 26 rows, and 10,190 bytes in the rerun | 189 and 230 ms |
| `GET /market/summary/USDT` | 5 rows | 182 and 218 ms |
| `GET /market/summary/ZAR` | 21 rows | 183 and 220 ms |
| `GET /market/summary/BTC` | `{"status":"success","count":0,"data":[]}` | 182 and 200 ms |

The API page describes `/market/summary/{EXCHANGE}` as "Provides an overview of only BTC or LTC markets. Data refreshes every minute.", S1.
No BTC or LTC quoted market exists on 2026-09-23, and the call takes any quote asset.

Each row carries `market`, `code`, `name`, `exchange`, `coin_decimals`, `exchange_decimals`, `yesterday_price`, `last_price`, `volume_amount`, `last_trade_time`, `change`, `top_bid`, `top_ask`, `spread_price`, `24hhigh`, `24hlow` and `24hvol`, P1.
Every value is a string except `spread_price`, a JSON number equal to the mid of `top_bid` and `top_ask`.
In the rerun, BTC/ZAR had traded 0.1 h before, had moved from fifth row to first, and had no `spread_price` field at all, P1.
So row order and the presence of `spread_price` change with activity, and a reader keys rows by `market`.
No row carries a status, an active flag, a size step or a minimum order.

| quote | markets on 2026-09-23 |
|---|---|
| ZAR | ADA, AVAX, BNB, BTC, DOGE, DOT, ETH, LINK, LTC, POL, RVN, SAF, SHIB, SOL, SUSHI, UNI, USDC, USDT, XAUT, XRP, ZARP |
| USDT | BTC, ETH, LTC, TITANX, XRP |

The catalog is live but mostly idle.
Hours since each market's last trade ranged from 0.4 on BTC/ZAR to 1,363 on BTC/USDT, and 11 of 26 markets had not traded for more than a day, in both passes, P1.
BTC/USDT still quoted 85,975.30 bid and 125,000 ask while its last price was 63,242.30, P1.
The summary's `24hvol` is quote volume, and it was 2,393 USDT on XRP/USDT, 283 USDT on LTC/USDT, 117 USDT on ETH/USDT, 8,423 ZAR on UNI/ZAR and 1,799 ZAR on BTC/ZAR, P1.
CoinGecko's XRP/USDT volume of 2,392.71 USD on the same day matches the first, see [`fees.md`](./fees.md) section 3.

### How CCXT maps it

It does not.
CCXT 4.5.68 has no ChainEX class, and neither does the current CCXT master, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare, and the engine's catalog path at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 68 has nothing to load.

### Symbol spellings

| surface | BTC/ZAR spelled as |
|---|---|
| REST summary `market` | `"BTC\/ZAR"`, a JSON escaped slash, and `code` `BTC` with `exchange` `ZAR` |
| REST book and trades path | `/market/orders/BTC/ZAR/...`, and lowercase `btc/zar` is accepted, P4 |
| web backend `getMarkets` | `market` `BTC/ZAR`, `market_id` `"57"`, `coinCode` `BTC`, `exchangeCode` `ZAR` |
| push socket topic | `marketUpdates-57`, see [`websocket.md`](./websocket.md) section 3 |

The public API never publishes `market_id`, so a socket feed needs the web backend's `https://app.chainex.io/action/getMarkets`, which answered 200 without a session and listed the same 26 markets, P1.

### Size unit, pairs listed twice, and price scale

Sizes are in the base asset, and `total` is in the quote asset, section 5.
Four bases trade against both ZAR and USDT: BTC, ETH, LTC and XRP, and USDT itself is a ZAR market.
No price scale applies.

## 3. Anchor

ChainEX publishes no index price, no mark price and no funding rate, because it lists no perpetual, see [`fees.md`](./fees.md) section 3.
The only reference prices it publishes are per market fields of the summary.

| field | meaning | source |
|---|---|---|
| `last_price` | the last trade | P1 |
| `spread_price` | the mid of `top_bid` and `top_ask`, equal on every row checked | P1 |
| `yesterday_price` | "Yesterday price refers to what the price was midnight UTC." | S1 |

None of them can fill an `AnchorRow`, at [`types.ts`](../../../server/src/feeds/anchor/types.ts) line 4, whose `index`, `mark` and funding fields stand for a perpetual's reference prices and settlement, at [`types.ts`](../../../server/src/engine/cluster/types.ts) lines 42 to 49.

## 4. Anchor semantics

Not applicable, as section 3 says.
For the record, the summary's touch is not a minute old in practice.
Over 60 one second polls of `/market/summary/` and of the BTC/ZAR book at 04:49 UTC, the summary's BTC/ZAR `top_bid` and `top_ask` equalled the book's touch on 60 of 60 polls, and on 60 of 60 in the rerun at 05:07 UTC, P3.
The BTC/ZAR touch did not change in either minute, the top 20 levels of its book changed twice and then six times, and the touch of all 26 summary rows together changed once in each minute, P3.
Reply times were a median of 205 and 200 ms for the book and 202 and 201 ms for the summary, with a slowest poll of 802 ms.

## 5. REST book snapshot

| call | reply |
|---|---|
| `GET /market/orders/{COIN}/{EXCHANGE}/ALL` | "Fetches the 50 best priced buy and sell orders together", S1. `{"status":"success","data":[{"type":"buy","count":N,"orders":[...]},{"type":"sell","count":N,"orders":[...]}]}` |
| `GET /market/orders/{COIN}/{EXCHANGE}/ALL/{LIMIT}` | the same with "maximum limit is 200 for each type", S1 |
| `GET /market/orders/{COIN}/{EXCHANGE}/BUY` or `/SELL`, with an optional `/{LIMIT}` | `{"status":"success","count":N,"data":[...]}`, one side |

Each level is `{"price": "1400164.60000000", "amount": "0.00020572", "total": "288.04000000"}`, three decimal strings with 8 decimals, P2.
`amount` is in the base asset, and `total` equals `price` times `amount` in the quote asset, within rounding, on every level of seven books, P2.
`count` equals the number of levels returned.

| property | probed on seven books at 04:49 and 05:06 UTC |
|---|---|
| level order | bids descending and asks ascending on every book with more than one level |
| duplicate prices | none, so the reply reads as one row per price |
| touch against the summary | equal on all seven |
| caching | `cache-control: no-cache, must-revalidate` and `cf-cache-status: DYNAMIC` |
| reply time | 192 to 230 ms |
| limit above 200 | `/ALL/500` answered like `/ALL/200` on BTC/ZAR, which held only 35 bids and 13 to 15 asks, so the cap is untested |

### Depth of every book

`GET /market/orders/{COIN}/{EXCHANGE}/ALL/200` on all 26 markets at 04:58 UTC, and again at 05:06 UTC, P2.

| measure | value |
|---|---|
| books with 20 or more levels on both sides | 1, ETH/ZAR with 30 bids and 35 asks, then 27 and 30 |
| books with more than 50 levels on a side | 0 |
| books with 5 or fewer levels on at least one side | 14, then 13 |
| books with at most 2 levels per side | 3, BTC/USDT, TITANX/USDT and ZARP/ZAR |
| spread, median over 26 books | 160 bps, then 211 bps |
| spread, tightest | 2 bps on ETH/ZAR in both scans, then 6 bps on XRP/USDT in both |
| spread, widest | 16,364 bps on SAF/ZAR and ZARP/ZAR |

The engine holds 20 levels per side, at [`ClusterIndexBuilder.ts`](../../../server/src/engine/cluster/ClusterIndexBuilder.ts) line 17, and only one ChainEX book is that deep.

### The web backend's depth call

The chainex.io trading page reads its book from `https://app.chainex.io/action/getOrderDepth?perPage=50&pageNo=0&orderBy=price&market=57&decimals=2`, S2.
It answered 200 without a session in 245 and 218 ms, P2.
Its levels carry `price` as a JSON number nudged by 1e-8 toward the spread, `1400164.60000001` for the best bid of `1400164.60000000`, with `amount`, `orderTotal`, `sum` and `total`, and it returned 36 bids against the public API's 35.
The public API is the cleaner source.

## 6. Rate limits and errors

"Please be aware that calls to the API are rate limited to 10 requests per second, any requests exceeding this rate will be met with a HTTP 503 response.", S1.
The probes stayed at 4 requests per second or less and met no limit, so the 503 and whether it carries `Retry-After` are Not verified.
The anchor poller's pause at [`errors.ts`](../../../server/src/shared/errors.ts) line 1 covers 403, 418 and 429, not 503.

| request | status | body |
|---|---|---|
| `/market/orders/NOPE/ZAR/ALL` | 200 | `{"status":"error","message":"The market does not exist."}` |
| `/market/orders/BTC/USD/ALL` | 200 | the same |
| `/market/orders/BTC/ZAR/BOTH` | 200 | `{"status":"error","message":"Please enter either BUY, SELL or ALL for the order type."}` |
| `/market/orders/BTC/ZAR/ALL/0` | 500 | empty |
| `/market/orders/btc/zar/ALL/3` | 200 | a normal 3 level book |
| `/market/nope` | 404 | `{"error":{"code":404,"message":"Not Found"}}` |
| `/market/stats/NOPE/ZAR` | 200 | `{"status":"error","message":"The market does not exist."}` |

An application error is HTTP 200 with `status` `error`, so a client has to read the body.
The API page states the same envelope: a `status` field, and `data`, `count` or `message` depending on the outcome, S1.
Wallet and trading methods need a key pair, a Unix `time` within 5 s of the server, and an HMAC-SHA-256 `hash` of the full URL, S1, and none was called.

## 7. Server time and clock offset

`GET /timestamp` returns `{"status":"success","data":1790138936}`, integer Unix seconds, P1.
Three reads at 04:50 UTC gave server minus local midpoint of -834, -77 and -327 ms with round trips of 201 to 215 ms, and -917, -162 and -410 ms with round trips of 195 to 208 ms in the rerun, P4.
An integer second always reads up to one second behind, so the offsets fit a clock within about one second of this host's, and a finer offset cannot be read from this call.

## 8. Recommended poller shape

None.
ChainEX publishes no index, mark or funding, so there is nothing for an `AnchorPoller` to read, and the venue cannot be a perpetual leg.
A spot integration would read the book from `GET /market/orders/{COIN}/{EXCHANGE}/ALL/200`, one market per request under the 10 per second limit, which is 2.6 s for all 26 markets at that limit.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChainEX API page, text in the web bundle chunk `15.ea62880822effc364b7a.js` | https://chainex.io/api | 2026-09-22 | ChainEX, global | method list, refresh note, book limits, rate limit, response envelope, authentication, sections 2, 3, 5 and 6 |
| S2 | ChainEX web bundle `main.227bb1402baa35b3f0a0.js` and chunk `9.e7372661ee16c638a9a2.js` | https://chainex.io/main.227bb1402baa35b3f0a0.js | 2026-09-22 | ChainEX, global | `API_URL`, the `app.chainex.io/action` backend, `getOrderDepth`, sections 1 and 5 |
| P1 | `rest-probe.mjs catalog` at 04:48 and 05:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/chainex/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 3 and 7 |
| P2 | `rest-probe.mjs book` at 04:49, 04:58 and 05:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/chainex/rest-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P3 | `rest-probe.mjs poll` at 04:49 and 05:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/chainex/rest-probe.mjs) | 2026-09-23 UTC | this host | section 4 |
| P4 | `rest-probe.mjs errors` at 04:50 and 05:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/chainex/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 2, 6 and 7 |
