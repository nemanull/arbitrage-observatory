# Bitonic REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:40 to 04:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Bitonic lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers its spot product, one pair quoted by Bitonic itself.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/bitonic/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S8 and P2 are those of [`fees.md`](./fees.md) section 10, and P1 is the REST probe of section 9 below.

## 1. Host and latency from this machine

### Where the API lives

The API page, S1, names three calls on the web host, `https://bitonic.nl/api/buy`, `https://bitonic.nl/api/sell` and `https://bitonic.nl/api/price`.
There is no separate API host, and `api.bitonic.nl` does not resolve, P1.
The page asks "please don't make more than 10 requests per minute", S1.

### Access, from the Canadian VPN exit

| call | status | body or note |
|---|---|---|
| `GET https://bitonic.nl/en/api` | 200 | the API page, 24,849 bytes |
| `GET https://bitonic.nl/api/price` | 200 | `{"price":73245.90421,"volume":4.97061987}` in the first run |
| `GET https://bitonic.nl/api/buy` | 200 | `{"success":true,"btc":1,"eur":74603.95,"price":74603.95,"method":"ideal"}` |
| `GET https://bitonic.nl/api/sell` | 200 | `{"success":true,"btc":1,"eur":72801.41,"price":72801.41}` |
| `GET https://bl3p.eu/` | 302 | to `https://bitonic.nl/bl3p`, which answers 302 to `/news/301`, the closure notice |
| `GET https://api.bl3p.eu/1/BTCEUR/ticker` | 404 | nginx 404 page, as are `/orderbook` and `/trades` |

Nothing was refused or geoblocked from this exit.
The server header is `nginx`, with no CDN header in front.

### Resolution and latency

`bitonic.nl` resolved to ten addresses, `116.203.206.145`, `141.227.131.75`, `167.235.62.247`, `185.53.129.156`, `185.83.219.12`, `212.114.120.35`, `217.23.10.94`, `31.220.43.95`, `83.138.53.16` and `95.211.247.147`, P1.
`bl3p.eu` and `api.bl3p.eu` resolved to subsets of the same addresses, P1.
Three calls to `/api/price`, 7 s apart, took 595 ms cold, then 615 ms and 660 ms, P1.
The second pass gave 625 ms, 635 ms and 618 ms.
Every later call took between about 600 and 850 ms, since the probe opens a fresh TLS connection for each call.

## 2. Catalog

There is no instruments call.
The catalog is one implicit pair, BTC against EUR, and no call takes a symbol, S1.
CoinMarketCap lists the same single pair, `BTC/EUR`, P2.

| item | value |
|---|---|
| instruments call | Not offered |
| status values | Not offered |
| active perpetual count | 0 |
| spot pairs | 1, BTC against EUR, implicit in every call |
| CCXT mapping | none, CCXT 4.5.68 and CCXT master have no class, see [`fees.md`](./fees.md) section 8 |
| size unit | BTC in the `btc` field, EUR in the `eur` field |
| pairs listed twice | not applicable |

## 3. Anchor

Not offered.
Bitonic publishes no index, mark price or funding rate, because it lists no perpetual.
It publishes three reference prices, none of them an index in the engine's sense.

| call | what it returns | source |
|---|---|---|
| `GET /api/price` | `price`, "an average between buy and sell prices", and `volume`, a 24 h BTC volume | S1, P1 |
| `GET /api/prices/v1/last-price` | undocumented, used by the web app. `buy_price` and `sell_price` as strings with five decimals, `deviation` as an integer, and `date_time` in ISO 8601 | S8, P1 |
| `GET /api/hourly-price` | undocumented, used by the home page chart. 169 rows of `{"time":<unix seconds>,"value":<EUR integer>}`, one per hour over seven days | S8, P1 |

No anchor poller is recommended.

## 4. Anchor semantics

Not offered as an anchor.
What was observed about the reference prices follows.

The three prices disagree with one another.
In the first run, 04:41 to 04:43 UTC, `/api/price` gave 73,245.90, the `include_fee=0` variant the home page polls gave 73,854.53, and `/api/prices/v1/last-price` gave a buy of 73,881.49 and a sell of 73,676.75, P1.
The hourly series ended at 73,779, within a euro of that last price mid, 73,779.12.
So `/api/price` sat about 0.7 % below the last price mid, and it is not the mid of `/api/buy` and `/api/sell` either, which was 73,702.68.
The second pass at 04:52 to 04:53 UTC showed the same gap, with `/api/price` at 73,248.13 against a last price mid of 73,779.16.
The documentation does not say which buy and sell prices it averages, S1.

The `volume` field read 4.97061987 in every call of both probe runs, P1.
CoinMarketCap's pair call returned the same 4.97061987 as `volumeBase` in both runs, P2.
Its exchange detail call gave a 24 h volume of 4.97084909 BTC updated at 04:44 UTC and 4.96787484 BTC updated at 04:54 UTC, so CoinMarketCap keeps a rolling figure of its own, P2.
So the field is refreshed rarely or carries a fixed window, and the documentation does not say which.

`/api/price` was polled every 7 s for 60 s, and its price changed 5 times across 8 samples, in both runs, P1.

## 5. REST book snapshot

Not offered.
Bitonic has no book, and `/api/orderbook` answers 404 `{"success":false,"data":{"errorCode":"404"}}`, P1.
The quote calls take a size, so they show how the price moves with the order, which is the nearest thing to depth, S1.

| call | price in the first run | note |
|---|---|---|
| `/api/buy`, 1 BTC by iDEAL | 74,603.95 | the default |
| `/api/buy?eur=100` | 75,046.21 | 0.59 % above the 1 BTC price, the fixed iDEAL and network charges on a small order |
| `/api/buy?method=bancontact&btc=0.01` | 74,836.98 | Bancontact carries EUR 0.61 plus 0.23 % |
| `/api/buy?btc=10` | 74,640.06 | 0.05 % above 1 BTC |
| `/api/sell`, 1 BTC | 72,801.41 | the default |
| `/api/sell?btc=0.01` | 72,753.42 | the EUR 0.25 SEPA cost weighs on a small order |
| `/api/sell?eur=1000` | 72,767.90 | |
| `/api/sell?btc=10` | 72,752.07 | 0.07 % below 1 BTC |

Each quote includes Bitonic's Instant service charge, see [`fees.md`](./fees.md) section 4.
The calls carry `Cache-Control: no-cache, private`, and successive calls returned fresh prices.

## 6. Rate limits and errors

The API page asks for at most 10 requests per minute, S1.
The server enforces a looser counter.
`/api/buy`, `/api/sell` and `/api/price` carry `X-RateLimit-Limit: 120`, and `/api/prices/v1/last-price` and `/api/hourly-price` carry `X-RateLimit-Limit: 180`, P1.
`X-RateLimit-Remaining` fell by one per call and refilled to 119 within about a minute, P1.
No probe went near either limit, so the 429 shape and any `Retry-After` were not observed.

| call | status | body |
|---|---|---|
| `/api/buy?btc=abc` | 400 | `{"success":false,"data":{"errorCode":"InvalidArgs","errorMessage":"The btc must be a number."}}` |
| `/api/buy?method=unknownmethod` | 400 | `{"success":false,"data":{"errorCode":"InvalidArgs","errorMessage":"geselecteerde method is ongeldig."}}`, a Dutch message |
| `/api/orderbook` | 404 | `{"success":false,"data":{"errorCode":"404"}}` |

## 7. Server time and clock offset

There is no server time call.
The HTTP `Date` header of `/api/price` read `Sat, 10 Oct 2026 04:44:23 GMT`, 0.7 s behind the local clock, at the header's one second resolution, P1.
The second pass read 0.3 s behind.
`/api/prices/v1/last-price` carries its own `date_time`, which read `2026-10-10T04:42:34+00:00` during the run's internal mode, P1.

## 8. Recommended poller shape

None.
There is no perpetual and no anchor, so the engine has nothing to poll here.
If a spot leg were ever wanted, the only usable inputs are `/api/buy` and `/api/sell` at the leg's order size, polled no faster than the 10 requests per minute the API page asks for.
That is one pair of quotes every 12 s at most, and each quote already includes Bitonic's own charge.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public API page | https://bitonic.nl/en/api | 2026-10-09 | Bitonic B.V. | the three calls, their parameters, the 10 per minute request, sections 1 to 6 |
| S8 | Home page script and web app trade bundle | https://bitonic.nl/public/js/app-cedbe3b1.js and https://bitonic.nl/webapp/assets/trade-LS81wHXz.js | 2026-10-09 | Bitonic B.V. | the undocumented last price and hourly price calls, section 3 |
| P1 | `rest-probe.py`, 04:40 to 04:44 UTC on 2026-10-10, rerun 04:51 to 04:55 UTC | [`rest-probe.py`](../../../scripts/probes/venues/bitonic/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | DNS, latency, quotes, reference prices, poll, rate limit headers, errors, Date header, sections 1 to 7 |
| P2 | `fees-probe.py listing`, 04:49 UTC on 2026-10-10, rerun 04:56 UTC | [`fees-probe.py`](../../../scripts/probes/venues/bitonic/fees-probe.py) | 2026-10-09 | this host, Canadian VPN exit | CoinMarketCap pair and volume, sections 2 and 4 |
