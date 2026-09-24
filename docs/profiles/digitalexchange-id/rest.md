# Digitalexchange.id REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:25 UTC), from the development host near Seattle, through its Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

Digitalexchange.id publishes no REST API documentation, and no developer page exists: `/docs`, `/api-docs` and `/developer` answer 404, P6.
Three public JSON routes do exist, `/api/<pair>/ticker`, `/api/<pair>/depth` and `/api/<pair>/trades`, and this profile describes them from [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs).
They were found by trying the path shape of Indodax, another Indonesian venue, S4, after `/api/v1/ticker` answered `{"status":"error","message":"undefined parameter"}`, P6.
The venue lists no perpetual, so this profile covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `digitalexchange.id` | |
| A records | `104.20.46.71`, `172.66.146.252` | P1 |
| AAAA records | `2606:4700:10::ac42:92fc`, `2606:4700:10::6814:2e47` | P1 |
| socket hosts | `socket.digitalexchange.id` and `socket-market.digitalexchange.id`, named in the home page's script, resolve to the same four addresses | S1, P1 |
| front | Cloudflare, `server: cloudflare`, `cf-ray` edges SEA and YVR | P1 |
| exit location | `/cdn-cgi/trace` answered `loc=CA`, `colo=YVR` and `colo=SEA`, the Canadian VPN exit | P6 |
| cold request, `/api/btcidr/ticker`, new TLS connection | 5 requests: median 313 and 392 ms, max 708 and 722 ms, in two runs | P1 |
| warm request, kept alive | 20 requests: min 261 and 256, median 268 and 261, p90 291 and 285, max 731 and 773 ms, in two runs | P1 |
| access | every public page and route answered 200 with content, and nothing was refused | P1 to P6 |

## 2. Catalog

### The instruments call

There is none.
The catalog is the `/market` page, a 592 KB HTML page whose rows link to `/basic-trading/<PAIR>`, S2.

| item | value | source |
|---|---|---|
| listed pairs | 91, all quoted in IDR | P2 |
| perpetuals | 0 | P2 |
| pairs with a bid and an ask on `/api/<pair>/ticker` | 91 of 91 | P2 |
| locked tickers, bid equal to ask | 18 and 21 of 91 in two reads, DOGEIDR, HBARIDR, USDTIDR and USDCIDR in both | P2 |
| ticker spread | median 500 and 400 ppm, p90 2,045 and 2,260 ppm, over the 73 and 70 pairs that were not locked | P2 |
| widest ticker spreads | DCTIDR 1,999,826 ppm and VEXIDR 1,931,034 ppm, so the ticker bid of the two pairs outside `integrasi` sits near zero | P2 |
| pairs with zero 24 h `volume` on the ticker | 61 of 91, in both reads | P2 |
| the page's `integrasi` list | 126 pairs, of which 89 are listed, while 37 are not on `/market` | P2 |
| listed pairs outside `integrasi` | DCTIDR and VEXIDR | P2 |
| status | the `asset_data` object on the trading page carries `trading_status` `"active"` on 81 pages, and 10 pages omit the field | P3 |

The ticker of every one of the 91 pairs answered, and the reply time was median 288 and 286 ms, p90 311 and 301 ms, in two runs, P2.
An unknown pair is not an error on the ticker route, which answers `success` with every field 0, see section 6.

### How CCXT 4.5.68 maps it

It does not, because CCXT 4.5.68 has no class for this venue, and the current CCXT master has none either, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.
The venue's own identifier is the pair in capitals with base and quote run together, `BTCIDR`, in the socket event names and page URLs, and the REST routes accept it in lower or upper case, `btcidr` or `BTCIDR`, P6.
`btc_idr` is refused with `undefined parameter`, P6.

### Size unit, pairs listed twice, and price scale

Sizes are base asset units on REST and on the socket.
No pair is listed twice, since there is one IDR market per base.
Prices are IDR per base unit, so BTC trades near 1,551,000,000 and PEPE near 0.0897, and the engine would need no price scale because no other venue it tracks quotes IDR.

## 3. Anchor

The venue publishes no index, no mark and no funding rate, because it lists no perpetual.
No bulk call exists, and no poller is recommended.

It does publish one reference price, and only inside its trading pages.
Each pair's `asset_data` object carries a price filter sourced from Binance, P3 and S3:

```json
{"price_filter_source":"binance","price_filter_synced_at":"2026-09-11 19:10:02","bid_multiplier_up":"1.20000000","bid_multiplier_down":"0.50000000","ask_multiplier_up":"2.00000000","ask_multiplier_down":"0.80000000"}
```

That is BTCIDR's filter, and 81 of 91 pages carry `price_filter_source` `"binance"`, while the other 10 omit it.
Reading the multipliers as the band an order price must stay inside, relative to a Binance price, is an inference from the field names.
The TradingView feed at `/tradingview/history` is the only other price series, and it is built from the venue's own trades, P6.
For the last 10 minutes of BTCIDR at 1 minute resolution it first answered `{"s":"no_data__"}`, and about 35 minutes later it answered 872 bars from 2025-10-04 to 2026-09-23 04:58 UTC, whose last close, 1,551,465,088, is the last BTCIDR trade in section 5.
So it is neither an index nor a reference price.

## 4. Anchor semantics

No anchor exists, so this section records what the book is instead, because that is what an arbitrage reading would lean on.

### The `integrasi` books are Binance books in IDR

The `mirror` mode read the BTCIDR and ETHIDR books beside Binance's public BTCUSDT and ETHUSDT books, six rounds 3 s apart, in two runs at 05:04 and 05:13 UTC, P5.
For each side it found the ratio shared by the most pairs of venue and Binance prices within 2 ppm, and counted the venue levels that ratio explains.

| pair | ratio IDR per USDT, 12 rounds a side | within 0.1 of 17,800 | venue levels explained | crossed REST book |
|---|---|---|---|---|
| BTCIDR | 17,792.9 to 17,800.9 | 18 of 24 side rounds | 10 to 26 of 25 or 26 a side | 4 of 12 rounds, by 22 to 351 ppm |
| ETHIDR | 17,795.2 to 17,805.6 | 7 of 24 side rounds | 14 to 25 of 25 or 26 a side | 6 of 12 rounds, by 72 to 303 ppm, and locked on 5 more |

In the second run the BTCIDR touch was exactly Binance's touch times 17,800: 86,934.86 × 17,800 = 1,547,440,508 for the bid and 86,934.87 × 17,800 = 1,547,440,686 for the ask, P5.
So the price levels of these books are Binance levels multiplied by a rate of exactly 17,800 IDR per USDT during these runs, while the venue's own USDTIDR book traded at 17,817 to 17,819, W1.
The venue sizes do not equal Binance's, so the sizes are scaled or capped by a rule that is Not publicly specified.
The rounds where the ratio strays from 17,800 and the levels a round does not explain are consistent with Binance moving between the two reads, since the venue refreshes every 2 s, see [`websocket.md`](./websocket.md) section 4.
Every listed pair except DCTIDR and VEXIDR has `integrasi` 1 or 2 and a nonzero `lp_taker_fee`, see [`fees.md`](./fees.md) section 4, so the same shape very likely holds for all 89 of them, which was not tested pair by pair.

A crossed book here is not an arbitrage.
The socket's BTCIDR book was crossed in 25 of 34 and 32 of 36 frames in two of three runs, and the last crossed frame of the second run held a bid of 86,934.86 × 17,800 and an ask of 86,921.70 × 17,800, see [`websocket.md`](./websocket.md) section 4.
No Binance book has its bid above its ask, so those two prices come from different moments, and one side was stale.
Any engine reading of this venue would see Binance about 2 s late, converted at a set IDR rate, with crossed and locked touches that no trader can take.

### How often each number changed

Over 60 one second rounds of the BTCIDR ticker and depth, in two runs, P4:

| number | changes over 59 intervals |
|---|---|
| ticker `bid` | 1 and 1 |
| ticker `ask` | 1 and 1 |
| ticker `last` | 1 and 1 |
| depth best bid or best ask | 15 and 11 |
| depth reply body | 30 and 29 |

The depth body changes about every 2 s, in step with the socket.
The ticker's `bid` and `ask` equalled the depth touch on 0 of 60 rounds in each run, so the ticker lags the book.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET https://digitalexchange.id/api/<pair>/depth`, pair as `btcidr` or `BTCIDR` | P6 |
| shape | `{"status":"success","data":{"buy":[["<price>","<amount>"],…],"sell":[…]}}`, decimal strings with a `.` point | P4 |
| depth | 25 or 26 levels a side on BTCIDR, and `limit=5` is ignored, still 26 | P4, P6 |
| thin pair | DCTIDR held 10 bids and 25 asks, bid 20,000 and ask 23,000, in three reads | W1 |
| level order | `buy` descending, `sell` ascending | W1 |
| reply | about 1.3 KB on BTCIDR, median 254 and 251 ms over 60 warm requests in each of two runs | P4 |
| caching | `cf-cache-status: DYNAMIC`, `cache-control: no-cache` on 120 of 120 replies, and the body changed about every 2 s, so no cache sits in front | P4 |
| crossed | BTCIDR on 4 and ETHIDR on 6 of 12 rounds, by 22 to 351 ppm, section 4 | P5 |

Trades come from `GET /api/<pair>/trades`, which returned the last 150 BTCIDR trades as `{"date": <Unix s>, "price": "<string>", "amount": "<string>", "type": "BUY" or "SELL"}`, P6.
Those 150 trades spanned 2026-07-08 07:16 UTC to 2026-09-23 04:58 UTC, about two BTCIDR trades a day.
The ticker is `GET /api/<pair>/ticker`, which returns `{"status":"success","data":[{"high","low","volume","last","last_24h","bid","ask"}]}` with JSON numbers, P2.

## 6. Rate limits and errors

No limit is published, and no reply carried a rate limit or `Retry-After` header, P1 and P6.
A burst of 20 ticker requests at 5 per second answered 200 on all 20, in both runs, P6.
No 403, 418 or 429 was seen in any run, and the probes never sent more than 5 requests a second.

| request | status | body |
|---|---|---|
| `/api/nopeidr/ticker` | 200 | `{"status":"success","data":[{"high":0,"low":0,"volume":0,"last":0,"last_24h":0,"bid":0,"ask":0}]}` |
| `/api/nopeidr/depth` | 500 | an HTML error page of 4,751 bytes |
| `/api/nopeidr/trades` | 500 | the same HTML error page |
| `/api/btc_idr/ticker` and `/api/v1/ticker` | 200 | `{"status":"error","message":"undefined parameter"}` |
| `/api/btcidr/nope` and `/api/btcidr` | 404 | the HTML 404 page |
| `/api` | 302 | `Location: http://digitalexchange.id/login` |

A client has to treat a ticker of zeros as an unknown pair, because the status says `success`.

## 7. Server time and clock offset

`GET /tradingview/time` answers whole Unix seconds as text, for example `1790139780`, P6.
Eight reads 1.13 s apart bound the server clock minus this host's clock to between -136 and +125 ms, and to between -222 and +41 ms in the rerun, with round trips of 213 to 223 ms, P6.
So the two clocks agree to within about 0.2 s, which is all a whole second reply can show.
The HTTP `date` header gives the same second.

## 8. Recommended poller shape

None.
The venue has no index, mark or funding to poll, it has no perpetual, and it has no CCXT class, so it cannot join the engine as a perpetual leg.

If a spot stage ever wanted this venue, the only bulk read is the socket's `tradedata-market` event, which carries every pair's bid and ask every 5 s, see [`websocket.md`](./websocket.md) section 2.
REST offers no bulk ticker, so a REST reader would need one request per pair.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Home page | https://digitalexchange.id/ | 2026-09-22 | PT Indonesia Digital Exchange | Cloudflare front, socket hosts, section 1 |
| S2 | Market page | https://digitalexchange.id/market | 2026-09-22 | same | the catalog, section 2 |
| S3 | BTCIDR trading page | https://digitalexchange.id/basic-trading/BTCIDR | 2026-09-22 | same | `asset_data`, price filter, `integrasi` list, sections 2 and 3 |
| S4 | Indodax public API, the path shape tried | https://indodax.com/api/btc_idr/ticker | 2026-09-22 | Indodax | how the routes were found, introduction |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `host` | | 2026-09-22 | this host | DNS, latency, headers, section 1 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `catalog` | | 2026-09-22 | this host | 91 pairs, tickers, `integrasi`, section 2 |
| P3 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `fees` | | 2026-09-22 | this host | `asset_data` fields on 91 pages, sections 2 and 3 |
| P4 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `poll` | | 2026-09-22 | this host | change counts, depth shape, caching, sections 4 and 5 |
| P5 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `mirror` | | 2026-09-22 | this host | the Binance ratio and crossed books, section 4 |
| P6 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `errors`, plus curl of candidate paths, `/cdn-cgi/trace` and `/tradingview/*` | | 2026-09-22 | this host | route discovery, errors, burst, trades, server time, sections 1 to 7 |
| W1 | [`ws-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/ws-probe.mjs) `book` | | 2026-09-22 | this host | REST against socket books, section 5 |
