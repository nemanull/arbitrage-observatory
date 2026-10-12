# Crypton Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09, for the venue survey of 2026-09-22, CoinMarketCap addition at rank 151, wave 45.

**Probed:** 2026-10-10 between 03:27 and 03:46 UTC, the evening of 2026-10-09 in local time, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the public REST surface of Crypton Exchange's spot market.
The venue lists no perpetuals, see [`fees.md`](./fees.md) section 3, so change 1 of the survey plan's template applies.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/crypton/rest-probe.py) unless a source row is named.
The API reference S1 puts every call under `https://crp.is:8182`, a non-standard port on the site's own host.

## 1. Host and latency from this machine

| host | role | resolved address | cold request | warm request |
|---|---|---|---|---|
| `crp.is:8182` | REST, public and private | `185.66.143.187`, one address, no CDN | 661 to 734 ms for `GET /market/ticker` on a new TLS connection, three per run over two runs | 202 to 205 ms minimum, 204 to 206 ms median, 215 to 240 ms maximum, ten requests per run |
| `crp.is:8181` | Socket.IO | the same address | see [`websocket.md`](./websocket.md) | |
| `crp.is:443` | web site, API reference | the same address | | |

Every reply carried `Server: nginx/1.30.2` and `Access-Control-Allow-Origin: *`.
No call was refused from the Canadian exit.
The only regional rule is the terms' exclusion of United States residents, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET /market/pairs` returns every pair in one reply of 1,136 to 1,137 bytes, with no authentication, although S1 shows it with a cookie.

| field | value on the wire |
|---|---|
| rows | 3 |
| `pair` | `crp_usdt`, `crp_uusd`, `uusd_usdt`, lower case `base_quote` |
| `pair_id` | 25, 27 and 28 |
| `visible`, `enable` | `true` on all three |
| `round_deal_amount`, `round_deal_price` | 3 and 4 on all three, the decimals of size and price |
| `min_amount` | 1 on all three, in the base asset |
| `min_price`, `max_price` | 0.1 and 25 for the two CRP pairs, 0.5 and 1.5 for `uusd_usdt` |
| `data_market` | `open`, `close`, `high`, `low`, `volume`, `value`, `volume_usd`, `rate`, `date_now` |

`GET /market/ticker` returns the same three pairs with `last_price`, `bid`, `ack` (the best ask), `base_volume`, `quote_volume` and `enable`.
Two pairs quote in USDT and one in UUSD, the Utopia stablecoin.
The table is the first run, at 03:28 UTC.

| pair | last | bid | ask | 24 h base volume | 24 h quote volume |
|---|---|---|---|---|---|
| `crp_usdt` | 0.1371 | 0.1366 | 0.1373 | 238,816.388 CRP | 32,770.23 USDT |
| `crp_uusd` | 0.1401 | 0.1401 | 0.1479 | 3,700.155 CRP | 518.39 UUSD |
| `uusd_usdt` | 0.9513 | 0.9513 | 0.9551 | 36,030.642 UUSD | 34,375.98 USDT |

`GET /market/curlist` lists six currencies, BTC, CRP, DAI, USDT, UUSD and XMR, with deposit and withdrawal fees, see [`fees.md`](./fees.md) section 7.
BTC and XMR have no pair, and DAI is disabled.
The API reference S1 still shows `btc_usdt`, `xmr_usdt` and `uusd_dai` in its ticker example, so those pairs existed once and are gone.
CoinMarketCap showed a 24 h spot volume of about 0.82 USD for the venue on both reads, S4 in [`fees.md`](./fees.md), far below the ticker's own figures above.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no Crypton class, see [`fees.md`](./fees.md) section 8.

### Size unit, pairs listed twice, and price scale

Sizes are in the base asset.
Every book level carries `value`, which equals `price` times `amount`, as in `0.1373 x 155.328 = 21.3265344` in the first ask of the probe.
No pair is listed twice.
CRP trades against both USDT and UUSD, which a spot leg would treat as two markets.

## 3. Anchor

Crypton Exchange publishes no index, mark or funding, because it lists no perpetuals.
`GET /market/index`, `/market/mark`, `/market/funding`, `/futures/pairs` and `/contract/pairs` each answer HTTP 404 with the plain text body `404 page not found`.
The only reference price is the ticker's `last_price` and the pair list's `close`.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, for the reason in section 3.

## 5. REST book snapshot

The documented call is `POST /market/panel` with the form body `pair=crp_usdt`, S1.
The web client sends `GET /market/panel?c=crp_usdt` instead, S2, and both return the same shape, 7,670 to 7,746 bytes for `crp_usdt`.
Neither needs authentication.

| item | value |
|---|---|
| result keys | `book_sell`, `book_buy`, `volumes`, `time`, `cur`, `ecur`, `pair` |
| level shape | `{"price":0.1373,"amount":155.328,"value":21.3265344}`, numbers, not strings |
| ask order | ascending, best first |
| bid order | descending, best first |
| depth parameter | none documented |
| `crp_usdt` levels | 100 asks, and 49 bids in the first run and 48 in the second |
| `crp_uusd` levels | 58 asks and 15 bids |
| `uusd_usdt` levels | 18 asks and 17 bids |
| `volumes` | the total of each side of the whole book, `{"sell":136792.308,"buy":2524.20718}` in the second run. `buy` equals the sum of the bids' `value`, in quote units. `sell` is in base units and far exceeds the 34,201.122 summed over the 100 asks returned |
| `time` | server time in milliseconds |
| caching | no `Cache-Control` and no `ETag` on the reply, and `time` was different on all 50 polls of the one minute loop below, in both runs |

The ask side of `crp_usdt` stopped at exactly 100 levels in both runs, while `volumes.sell` counts about four times the base amount of those 100 levels.
So the reply is capped at 100 levels per side and the rest of the side is cut off.
S1 does not state the cap.

Over one minute of one second polls of `crp_usdt`, 50 replies per run, the best bid or ask level changed 5 times in the first run and not at all in the second.

## 6. Rate limits and errors

S1 publishes no rate limit, and no reply carried a rate limit header.
The probe sent about 110 requests at one per second or slower and none was refused.

| case | status | body |
|---|---|---|
| unknown pair `pair=nope_usdt` | 400 | `{"success":false,"code":"77","text":"pair incorrect","result":null}` |
| empty pair or no body | 400 | the same code 77 body |
| private call without a token, `GET /user/balance` | 400 | `{"success":false,"code":"3","text":"auth_token empty","result":null}` |
| session check without a token | 200 | `{"success":true,"result":false}` |
| unknown path | 404 | `404 page not found`, `text/plain` |

Every JSON reply wraps its payload as `{"success":bool,"result":...}`, and an error adds a string `code` and a `text`.

## 7. Server time and clock offset

There is no dedicated time call.
The `time` field of `/market/panel` is server time in milliseconds, and `data_market.date_now` of `/market/pairs` is too.
Against the midpoint of each request, the panel `time` was 14 to 28 ms ahead of the local clock over five requests per run, two runs.
The `Date` header has one second resolution and agreed within one second.

## 8. Recommended poller shape

No anchor poller, since there is no index, mark or funding.

If a spot leg is ever built, the REST role is the book snapshot.
`GET https://crp.is:8182/market/panel?c=<pair>` once per pair after each socket join and after each reconnect gives the snapshot that the socket never sends, see [`websocket.md`](./websocket.md) section 4.
`GET /market/pairs` once an hour is enough for the catalog of three pairs.
Skip `crp_uusd` and `uusd_usdt` for any USDT comparison, since UUSD is the venue's own stablecoin.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | API reference, `https://crp.is/api-doc/`, read 2026-10-09 | hosts, calls, the POST form of `/market/panel`, old pairs in examples |
| S2 | web bundle `https://crp.is/static/js/main.98f09429.chunk.js`, read 2026-10-09 | the GET form of `/market/panel`, the REST base `window.location.hostname+":8182"` |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/crypton/rest-probe.py) | every probed number in sections 1 to 7 |
| P2 | [`fees-probe.py`](../../../scripts/probes/venues/crypton/fees-probe.py) | the currency list and CoinMarketCap fields |
