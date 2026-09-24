# SecondBTC REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific evening (04:24 to 04:58 UTC on 2026-09-23), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

SecondBTC lists no perpetual, see [`fees.md`](./fees.md) section 3, so this profile covers the public REST API of its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
The API documentation is a page of the web app, `https://secondbtc.com/en/api`, rendered by JavaScript.
Its section titles, which are in the web app bundle, describe a Binance style API: test connectivity, server time, exchange information, order book, recent trades, 24 hour ticker and symbol price, plus CoinMarketCap style summary, assets, ticker, order book and trades calls, with keys passed in `X-MBX-APIKEY`, S1.
The paths were not in the bundle, so every path below was found by trying the Binance and CoinMarketCap spellings on `api.secondbtc.com`, and each was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/secondbtc/rest-probe.mjs).
Access results are from the Canadian VPN exit named above.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| REST host | `https://api.secondbtc.com`, the `$apiURL` constant of the web app | S1 |
| resolved address | `104.21.25.111`, `172.67.134.17`, `2606:4700:3030::6815:196f` and `2606:4700:3036::ac43:8611`, Cloudflare, the same four for `api`, `socket` and the bare domain | P1, both runs |
| edge | Cloudflare `SEA` and `YVR` by `cf-ray` suffix. One catalog run went through `YVR` and the other through `SEA` | P1 |
| origin | Express, by its 404 body `Cannot GET /…` | P1, P4 |
| cold request | 526 and 559 ms for `/api/v1/time` | P1 |
| warm request | 162 to 176 ms for `/api/v1/time` | P1 |
| bulk calls | `exchangeInfo` 352 and 384 ms for 16,569 bytes, `ticker` 171 and 190 ms for about 14.1 KB, `summary` 316 and 355 ms for about 13.9 KB | P1 |
| access | every call below answered 200, with no geoblock or challenge page | P1 to P4 |

## 2. Catalog

### The instruments call

`GET /api/v1/exchangeInfo` returns `{"timezone":"UTC","serverTime":…,"symbols":[…]}` with 65 symbols in both runs of P1.
Each symbol carries `symbol`, `baseAsset`, `quoteAsset`, `status`, `tickSize`, `tradeMinTotal`, `tradeFeeMaker`, `tradeFeeTaker`, `marketMaker`, `createdAt` and `orderTypes`.

```json
{"symbol":"BTCUSDT","baseAsset":"BTC","quoteAsset":"USDT","status":true,"tickSize":0.01,"tradeMinTotal":10,"tradeFeeMaker":0.2,"tradeFeeTaker":0.2,"marketMaker":true,"createdAt":"2023-09-29T16:44:58.471Z","orderTypes":["LIMIT","MARKET","STOP LIMIT"]}
```

| item | value, both runs of P1 |
|---|---|
| `status` true | 56 |
| `status` false | 9: `MBASEUSDT`, `DOGSUSDT`, `NGNUSDT`, `WBTCUSDT`, `CATSUSDT`, `MARSUSDT`, `HANAUSDT`, `CROWUSDT`, `JAMUSDT` |
| enabled by quote | USDT 47, USDC 6, FDUSD 3 |
| `marketMaker` true | 43 of 65 |
| perpetual, contract, funding, mark or index fields | none |

### Other catalog calls

| call | reply | notes |
|---|---|---|
| `GET /api/v1/ticker` | array of 50 rows with `symbol` `BTCUSDT`, `pairs` `BTC_USDT`, `lastPrice`, `percentChange`, `baseVolume`, `quoteVolume`, `high24hr`, `low24hr`, `lowestAsk`, `highestBid`, `lastUpdateTimestamp`, `status` | 6 enabled symbols are missing from it: `CEEKUSDT`, `TONUSDT`, `VOLTUSDT`, `MAWUSDT`, `MELOUSDT`, `PESTOUSDT` |
| `GET /api/v1/ticker/price` | array of 50 `{symbol, lastPrice}` | |
| `GET /api/v1/summary` | `{"code":"200","msg":"success","data":{"BTC_USDT":{…},…}}`, 50 rows keyed `BTC_USDT` | fields `base_id`, `quote_id`, `last_price`, `quote_volume`, `base_volume`, `price_change_percent_24h`, `highest_price_24h`, `lowest_price_24h`, `lowest_ask`, `highest_bid`, `isFrozen` |
| `GET /api/v1/assets` | `{"code":"200","msg":"success","data":{"BTC":{…},…}}`, 43 assets | `name`, `unified_cryptoasset_id`, `can_withdraw`, `can_deposit`, `min_withdraw`, `max_withdraw`, `maker_fee`, `taker_fee` |
| `GET /api/v1/ping` | `{}` | |

### How CCXT would map it

There is no CCXT class, see [`fees.md`](./fees.md) section 8, so no `market.id` exists.
The venue spells one market two ways.

| place | spelling |
|---|---|
| `exchangeInfo` `symbol`, `ticker` `symbol`, `depth` query, socket trade and market info `symbol` | `BTCUSDT` |
| `ticker` `pairs`, `summary` key, socket room, web page route | `BTC_USDT` |

The `depth` call answers `BTC_USDT` with `{"status":false,"msg":"The order is empty!"}`, and the socket answers the room `BTCUSDT` with silence, P2 and [`websocket.md`](./websocket.md) section 4.
Sizes are base currency on every call, since there is no contract.
No pair is listed twice under one quote.
`BTC`, `ETH` and `BNB` each trade against USDT, USDC and FDUSD, so a consumer that keeps one market per base would have to pick one of them.

## 3. Anchor

SecondBTC publishes no index, no mark and no funding rate, because it lists no perpetual.
No call in section 2 carries one, and no socket event does either, see [`websocket.md`](./websocket.md) section 2.

The closest thing to a reference price is the venue's own statement of where its book comes from.
The socket's market info event carries the venue's market maker settings with `priceSource` `"binance"`, and it also carries `usdtPrice`, which equalled `lastPrice` on `BTC_USDT`, [`websocket.md`](./websocket.md) section 6.
Neither is an index a poller could anchor to.
No anchor poller is recommended.

## 4. How the book relates to its source

Section 4 of the template asks for the anchor formula.
With no anchor to describe, this section records how the SecondBTC book tracks Binance, since the venue names Binance as its price source.
The `mirror` mode sends one Binance `bookTicker` read and three SecondBTC `depth` reads at the same instant, 30 times at 2 s spacing.

| pair | run | mid against Binance, median, p90, max ppm | SecondBTC spread against Binance spread | distinct SecondBTC touches against Binance touches | samples crossed through the Binance touch, deepest |
|---|---|---|---|---|---|
| `BTCUSDT` | 04:36 UTC | 0, 137, 294 | equal, one 0.01 tick | not counted | 8 of 30, 294 ppm |
| `BTCUSDT` | 04:48 UTC | 0, 0, 139 | equal | 3 against 3 | 1 of 30, 139 ppm |
| `ETHUSDT` | 04:36 UTC | 75, 316, 453 | equal, 4 ppm | not counted | 22 of 30, 449 ppm |
| `ETHUSDT` | 04:48 UTC | 0, 68, 90 | equal | 7 against 12 | 9 of 30, 86 ppm |
| `SOLUSDT` | 04:36 UTC | 376, 627, 627 | SecondBTC median -167 ppm, its own book crossed in at least half the samples | not counted | 30 of 30, 669 ppm |
| `SOLUSDT` | 04:48 UTC | 334, 752, 1,087 | equal, 84 ppm | 2 against 12 | 28 of 30, 1,004 ppm |

The spreads are Binance's own spreads, and the touch often sits exactly on Binance's, which fits a copy.
The copy lags: on `ETHUSDT` it moved 7 times while Binance moved 12, and on `SOLUSDT` it moved twice while Binance moved 12.
On `SOLUSDT` every sample of the 04:48 run listed each price twice, and three manual reads 3 s apart at about 04:37 UTC showed the same four levels, `119.58` and `119.57` bid and `119.59` and `119.6` ask, each twice with identical sizes, while Binance moved from `119.51` to `119.49` bid.
So a SecondBTC price that crosses Binance is, on this evidence, a stale copy rather than a counterparty.

The bulk calls lag more.
`ticker` rows were 33.7 to 140 s old by their own `lastUpdateTimestamp` across all 50 rows in the two runs of P1, with medians of 47.2 and 43.6 s, and 26.9 to 36.1 s old on `ETHUSDT` in P2.
Over five reads 2 s apart on `ETHUSDT`, `depth`, `summary` and `ticker` each gave a different touch, `2783.64/2783.65`, `2783.67/2783.68` and `2783.65/2783.66`, and none of them moved, P2 at 04:57 UTC.

## 5. REST book snapshot

`GET /api/v1/depth?symbol=BTCUSDT&limit=N` returns `{"status":true,"serverTime":…,"bids":[[price,size],…],"asks":[…]}`, P2.

| item | value | source |
|---|---|---|
| depth limit | `limit` 5, 20 and 100 honoured exactly. `limit` 1000 and no `limit` return 300 per side on `BTCUSDT`, and the thin `SBTCUSDT` returns 198 to 200 | P2, three runs |
| numbers | prices and sizes are JSON numbers | P2 |
| level order | bids descending, asks ascending, best first, on every read | P2 |
| duplicate prices | `CATUSDT` repeats 186 to 191 prices per side, because its price `6e-12` is at the precision limit, and its best bid equals its best ask. `SOLUSDT` listed every level twice in 30 of 30 samples at 04:48 UTC. `BTCUSDT` and `ETHUSDT` had a repeated price in 2 of 30 samples each, and one manual read of `BTCUSDT` at 04:26 UTC showed `87175.83` three times at the top of the bids | P2, P3, manual `curl` |
| disabled symbol | `MBASEUSDT`, `status` false, still returns a book of 32 bids and 56 asks | P2 |
| errors | an unknown or mis-spelled symbol returns HTTP 200 `{"status":false,"msg":"The order is empty!"}`. No symbol returns HTTP 200 `{"status":false,"msg":"Mandatory parameter 'symbol' was not sent, was empty/null, or malformed."}` | P2 |
| caching | `cf-cache-status` `DYNAMIC`, a new `serverTime` and a new `etag` on every read | P2 |
| update rate | on `BTCUSDT` the touch changed once in six reads 0.5 s apart in the first two runs, and not at all in the third. The socket pushes the same book every 5.3 s, see [`websocket.md`](./websocket.md) section 4 | P2 |
| recent trades | `GET /api/v1/trades?symbol=BTCUSDT` never answered, timing out at 8 s in three runs and at 10 s once by hand | P2 |

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| published limit | none found | S1 |
| headers | `x-ratelimit-limit` 300, `x-ratelimit-remaining`, `x-ratelimit-reset` in Unix seconds | P4 |
| window | 60 s: right after a reset, `x-ratelimit-reset` was 59 s ahead of the clock and counted down | P4 rerun |
| presence | on 9 of 20 replies in each run, and absent from the rest | P4 |
| shared bucket | `x-ratelimit-remaining` fell by 2 to 8 per call of ours, from 252 to 214 over the first run, so other clients draw on the same bucket | P4 |
| refusal | no 429 or 403 at 2 calls per second over 20 calls, so the status code and any `Retry-After` of a refusal are Not verified | P4 |
| unknown path | HTTP 404 with Express's HTML `Cannot GET /api/v1/nope` | P4 |
| bad parameter | HTTP 200 with `{"status":false,"msg":…}`, section 5 | P2 |

## 7. Server time

`GET /api/v1/time` returns `{"serverTime":1790137591098}` in ms.
The offset from this host's clock, taken at the midpoint of the request, was 0 to 4 ms on the eight warm reads of two runs.
The two cold reads showed 176 and 189 ms, which is the one-sided cost of connection setup rather than clock error, P1.

## 8. Recommended poller shape

No anchor poller is recommended, because SecondBTC publishes no index, mark or funding, section 3.

No book poller is recommended either, and the numbers say why.
A `depth` read per enabled market every 5 s would be 56 reads per 5 s, or 672 per minute, against a shared bucket of 300 per 60 s, section 6.
The bulk `ticker` call fits the bucket, but its rows were 27 to 140 s old, and the bulk `summary` call gave a touch that matched neither `depth` nor `ticker`, section 4.
And the book they would read is a delayed copy of Binance by the venue's own market maker, section 4.
If a spot reference were ever wanted anyway, `GET /api/v1/depth?symbol=<SYMBOL>&limit=20` on a handful of markets every 5 s, stamped on arrival, is the only source that equals the socket book.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | SecondBTC web app bundle `app.bcfdac16.js` | https://secondbtc.com/js/app.bcfdac16.js | 2026-09-22 | SecondBTC | `$apiURL`, API documentation section titles, `X-MBX-APIKEY`, sections 1 and 6 |
| S2 | SecondBTC API calls | https://api.secondbtc.com/api/v1/exchangeInfo, `/ticker`, `/ticker/price`, `/summary`, `/assets`, `/ping`, `/time`, `/depth` | 2026-09-22 | SecondBTC, global | sections 2 to 7 |
| S3 | Binance spot `bookTicker` | https://api.binance.com/api/v3/ticker/bookTicker | 2026-09-22 | Binance, global | the reference side of section 4 |
| P1 | `rest-probe.mjs catalog`, runs at 04:33 and 04:47 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/secondbtc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 4 and 7 |
| P2 | `rest-probe.mjs depth`, runs at 04:33, 04:47 and 04:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/secondbtc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 2, 4 and 5 |
| P3 | `rest-probe.mjs mirror`, runs at 04:36 and 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/secondbtc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 4 |
| P4 | `rest-probe.mjs limits`, runs at 04:34 and 04:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/secondbtc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 6 |
