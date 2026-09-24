# Blockchain.com REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:23 to 04:39 UTC, and the second pass at 04:44 to 04:52 UTC, from the development host near Seattle through the Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of Blockchain.com Exchange (CCXT id `blockchaincom`) at `https://api.blockchain.com/v3/exchange`, which lists spot only, as template change 1 of the survey plan asks.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/blockchaincom/rest-probe.mjs) unless a source row is named.
The Exchange was documented as suspended for trading from 19 October 2025, see [`fees.md`](./fees.md) section 1, and the REST books below are what is left of it.

## 1. Host and latency from this machine

| item | value |
|---|---|
| `api.blockchain.com` | 104.17.172.30 and 104.17.173.30, Cloudflare, edge SEA in `cf-ray`. `exchange.blockchain.com` resolves to the same two addresses |
| `ws.blockchain.info` | 104.16.117.55 and 104.16.118.55, see [`websocket.md`](./websocket.md) |
| gateway | response header `x-blockchain-cp-b: mercury-rest-gateway` |
| `GET /symbols`, 75,925 bytes | cold 535 ms, then five warm requests 175 to 187 ms. In the rerun, cold 541 ms and warm 182 to 195 ms |
| `GET /tickers`, 15,330 bytes | 175 ms in the `catalog` run, 177 to 568 ms, median 185 ms, over 60 polls, and 165 to 521 ms, median 167 ms, over 60 polls in the rerun |
| access | HTTP 200 on every public call from the Canadian VPN exit, with no refusal |

## 2. Catalog

### The instruments call

`GET /symbols` returns one object keyed by symbol, S1.

| item | value |
|---|---|
| rows | 194 |
| `status` | `open` 60, `close` 134 |
| open quotes | USD 12, EUR 12, GBP 12, USDC 12, USDT 12 |
| open bases | ADA, ALGO, BCH, BNB, BTC, ETH, LTC, SHIB, SOL, STX, TRX, XRP |
| perpetual or future names | none: no key matches `PERP`, `SWAP` or `FUT` |
| key against fields | every key equals `base_currency` and `counter_currency` joined by `-` |
| auction fields | `auction_price` 0, `auction_size` 0, `auction_time` empty on every open symbol |

`GET /tickers` returns 194 rows of `symbol`, `price_24h`, `volume_24h` and `last_trade_price`.
8 had volume in the `catalog` run: BTC-USD 0.12205461, BTC-GBP 0.15244587, BTC-USDT 0.00645262, LTC-USD 0.98804536, XRP-USD 65, XRP-EUR 51.44702, XRP-USDC 195.998336 and XRP-USDT 341.166969, in base units.
The BTC-USD `last_trade_price` read 86,000 at 04:23 UTC and 86,300 at 04:28 UTC, and its `volume_24h` read 0.13035325 at 04:31 UTC, so trades still print on this side.
Every `close` symbol's ticker reads 0 for all three numbers.

### How CCXT 4.5.68 maps it

| item | value | evidence |
|---|---|---|
| markets | 194, `active` true on the 60 `open` ones, 0 swaps, `loadMarkets` in 517 ms and 296 ms in the rerun | P1, `server/node_modules/ccxt/js/src/blockchaincom.js` lines 340 to 347 map `open` to active |
| `market.id` | the `symbols` key, `BTC-USD`, identical to the socket `symbol` on every open symbol | P1, line 375 |
| `type` | `spot`, with `linear`, `inverse` and `contractSize` undefined | lines 384 to 394 |
| precision | price `min_price_increment` times 10 to the minus `min_price_increment_scale`, 0.01 on BTC-USD, and amount `lot_size` scaled the same way, 1e-8 | lines 348 to 357, P1 |
| minimum amount | `min_order_size` scaled, 0.00005 BTC on BTC-USD | lines 358 to 363, P1 |
| `market.taker` | undefined on every market, see [`fees.md`](./fees.md) section 8 | P1 |

The engine's catalog keeps only active swaps, at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 79, so this venue would contribute no market.

### Pairs listed twice, and price scale

Each open base trades against up to five quotes.
USD, USDC and USDT are one settlement family, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), so BTC-USD, BTC-USDC and BTC-USDT would be three listings of one pair, while EUR and GBP are other families.
No symbol is quoted per 10 or per 1,000 units, so no price scale applies.

## 3. Anchor

The venue publishes no index price, no mark price for a perpetual, and no funding rate, because it lists no perpetual.
The only price fields the REST API carries are the `/tickers` fields `price_24h`, `volume_24h` and `last_trade_price`.
`price_24h` read 85,222.81 on BTC-USD at 04:23 and at 04:31 UTC while the last trade moved, and its meaning is Not publicly specified.

Two socket fields look like anchors and are not.

| field | where | behaviour |
|---|---|---|
| `mark_price` | socket `ticker` channel | 106,523.7 on BTC-USD, repeated identically every second, about 22 % above the Kraken mid, see [`websocket.md`](./websocket.md) section 4 |
| candle close | socket `prices` channel | equal to the mid of the one level REST quote, with volume 0 |

No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since no index, mark or funding is published.
The socket `symbols` snapshot names margin with `leverage_ratio` 2 to 5 on BTC-USD, and no index or mark formula for margin was found in the pages read, S1 and S2.

## 5. REST book snapshot

| call | reply | evidence |
|---|---|---|
| `GET /l2/{symbol}` | `{"symbol", "bids": [{"px", "qty", "num"}], "asks": [...]}`, `num` is the order count | S1, P2 |
| `GET /l3/{symbol}` | the same shape, where `num` carries a 12 digit order id | P2 |
| `depth` query | accepted with HTTP 200 on both, and CCXT sends it as the limit, at `server/node_modules/ccxt/js/src/blockchaincom.js` lines 458 and 472 | P2 `errors`. Its effect cannot be seen on a one level book |
| caching | `cache-control: no-cache, no-store, max-age=0, must-revalidate`, `cf-cache-status: DYNAMIC` | response headers |

`GET /l2` on each of the 60 open symbols at two requests a second, in the `books` run at 04:28 UTC and its rerun at 04:44 UTC:

| result | 04:28 | 04:44 |
|---|---:|---:|
| HTTP 200, one bid and one ask | 28 | 26 |
| HTTP 200, `"bids": [], "asks": []` | 11 | 13 |
| HTTP 500, `text/plain` body `Internal server error` | 21 | 21 |

The 21 that fail were the same in both runs: all five BNB and all five SHIB symbols, four TRX, three ALGO, and the EUR and GBP books of ADA and STX.
The empty ones were TRX-USD, ALGO-USD, ALGO-USDT, ADA-USD, ADA-USDT, ADA-USDC, STX-USD, STX-USDC, STX-USDT, LTC-USDT and XRP-GBP at 04:28.
At 04:44 XRP-GBP had a quote, and XRP-USDC, BCH-USD and BCH-EUR had none, so the set of quoted symbols drifts between reads.
The two sided ones are drawn from the BTC, ETH, SOL, BCH, LTC and XRP symbols.
Every two sided book held exactly one order per side, `num` 1.
The spread was 20,004 to 21,220 ppm, median 20,423 ppm, over the 28 at 04:28, and 20,000 to 21,280 ppm, median 20,405 ppm, over the 26 at 04:44.
Each quote was worth 89 to 316 units of its quote currency on the bid side at 04:44.
On BTC-USD the level was 0.002 BTC per side, 173 USD, and the mid sat 116 ppm and then 191 ppm from the Kraken mid read in the same run.
So each two sided book is one small quote about 1 % either side of the market.

Over 60 one second polls in the `poll` run at 04:30 UTC, the BTC-USD book changed 6 times and showed 5 distinct states, and over 60 polls in the rerun at 04:45 UTC it did not change at all.
`/tickers` did not change in either minute.
The socket `l2` book for the same symbol is a different, static book, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

The REST reference names no rate limit for the public calls, S1.
The socket limit is 1,200 messages a minute, S2.
CCXT spaces requests by `rateLimit` 500 ms, at `server/node_modules/ccxt/js/src/blockchaincom.js` line 24.
No response carried a rate limit or `Retry-After` header, and no 429 appeared at two requests a second over 60 s.

| request | status | body |
|---|---|---|
| `GET /l2/NOPE-USD` | 500 | `Internal server error`, `text/plain` |
| `GET /symbols/NOPE-USD` | 500 | `Internal server error` |
| `GET /tickers/NOPE-USD` | 500 | `Internal server error` |
| `GET /l2/btc-usd` or `/l2/BTCUSD` | 400 | `Invalid input` |
| `GET /l2/TFUEL-USDC`, a `close` symbol | 200 | `{"symbol":"TFUEL-USDC","bids":[],"asks":[]}` |
| `GET /tickers/TFUEL-USDC` | 200 | all three numbers 0.0 |
| `GET /time` or `/nope` | 404 | `Page not found` |

An unknown symbol and 21 open symbols both answer 500 with the same body, so a 500 does not tell a caller which of the two it hit.
CCXT maps only 401 and 404 by status, at lines 289 to 292.

## 7. Server time and clock offset

No server time call exists, and `GET /time` answers 404.
The `Date` header of five `/tickers/BTC-USD` replies agreed with the local clock within its one second resolution, in the `poll` run.

## 8. Recommended poller shape

No anchor poller is recommended, because the venue publishes no index, mark or funding.
No book poller is recommended either, because 21 of 60 open symbols answer 500, 11 are empty, and the rest hold one 0.002 BTC sized quote about 1 % from the market.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Blockchain.com Exchange REST API reference | https://api.blockchain.com/v3/ | 2026-09-22 | Blockchain.com Exchange | public calls, `l2` fields, no rate limit named, sections 2, 5 and 6 |
| S2 | Blockchain.com Exchange API, Websocket API and fair usage | https://exchange.blockchain.com/api/ | 2026-09-22 | Blockchain.com Exchange | 1,200 messages a minute, `symbols` channel fields, sections 4 and 6 |
| S3 | CCXT 4.5.68 `blockchaincom.js` | `server/node_modules/ccxt/js/src/blockchaincom.js` | 2026-09-22 | CCXT | market mapping, `depth`, `rateLimit`, exceptions, sections 2, 5 and 6 |
| P1 | `rest-probe.mjs catalog`, 04:28 UTC, and the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/blockchaincom/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | DNS, latency, catalog, tickers, CCXT, sections 1 and 2 |
| P2 | `rest-probe.mjs books`, `poll` and `errors`, 04:28 to 04:31 UTC, and the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/blockchaincom/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | books, polls, errors, clock, sections 1 and 5 to 7 |
| P3 | `ws-probe.mjs book`, 04:33 UTC, and the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | socket `mark_price` and candles, section 3 |
