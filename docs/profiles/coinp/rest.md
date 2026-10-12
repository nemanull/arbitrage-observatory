# CoinP REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 02:19 to 02:25 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocated to Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

CoinP publishes no REST documentation that this host could find, and no CCXT class covers it, see [`fees.md`](./fees.md) section 8.
Every CoinP host and path tried returned Cloudflare 521, "Web server is down", so no catalog, anchor, book, limit or clock could be read.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/coinp/rest-probe.py) unless a row names another source.

## 1. Host and latency from this machine

### DNS

| name | addresses on 2026-10-10 UTC |
|---|---|
| `coinp.com`, `www.coinp.com`, `api.coinp.com`, `openapi.coinp.com` | 104.18.8.221 and 104.18.9.221 |
| `no-such-label-7f3a.coinp.com`, a made-up label | 104.18.8.221 and 104.18.9.221, so the zone has a wildcard record |
| `www.coinp1000.com`, the register domain CoinMarketCap names | 104.18.24.62, 104.18.25.62, 2606:4700::6812:183e and 2606:4700::6812:193e |
| `coinp1000.com` | no address |
| `coinp.io`, `www.coinp.io` | 104.18.10.99, 104.18.11.99, 2606:4700::6812:a63 and 2606:4700::6812:b63 |

The name servers of `coinp.com` are `elisabeth.ns.cloudflare.com` and `piotr.ns.cloudflare.com`, read with `dig` on 2026-10-10 UTC.
Every address above belongs to Cloudflare.

### What each host returned

| request | status | body |
|---|---|---|
| `GET https://www.coinp.com/` | 521 | Cloudflare page titled `coinp.com \| 521: Web server is down`, 6,978 bytes |
| `GET https://www.coinp.com/en/fee`, the fee page CoinMarketCap names | 521 | the same page |
| `GET https://www.coinp.com/robots.txt` | 521 | the same page |
| `GET https://www.coinp.com/api/v1/common/symbols`, guessed | 521 | the same page |
| `GET https://api.coinp.com/`, `/api/v1/time` and `/fapi/v1/exchangeInfo`, guessed | 521 | the same page |
| `GET https://openapi.coinp.com/sapi/v1/symbols`, guessed | 521 | the same page, 6,998 bytes |
| `GET https://www.coinp1000.com/` | 521 | the same page for that domain, 7,002 bytes |
| `GET https://www.coinp.io/` | 521 | the same page for that domain, 6,972 bytes |
| `GET https://coinp.com/` and `https://coinp.io/`, read with curl | 301 | redirect to the `www` name, which then returns 521 |

A request without a browser User-Agent gets the same 521 as `text/plain`, 16 bytes, `error code: 521`, S3, and the socket handshakes got the same body, see [`websocket.md`](./websocket.md) section 5.
Every reply carried `server: cloudflare` and a `cf-ray` ending in `YVR`, Cloudflare's Vancouver site.
The Cloudflare trace at `https://www.coinp.com/cdn-cgi/trace` answered with `loc=CA` and `colo=YVR`, which shows the edge itself is reachable and only the origin behind it is not.

A 521 means Cloudflare could not open a TCP connection to the origin.
It is not a geoblock, since a geoblock would come from the edge as a 403 or from the origin as its own page.
The 521 replies took 137 to 293 ms over three runs, which is the time to the Vancouver edge and back, not to the origin.

### Other sources checked

| source | result |
|---|---|
| CoinMarketCap exchange page, id 12030 | 200, status `active`, the URLs named in [`fees.md`](./fees.md) section 1 |
| CoinMarketCap market pairs call, `category=spot`, `perpetual` and `futures` | 200, `numMarketPairs` 0 and an empty `marketPairs` list each time, beside 3,951,074,592 USD spot and 2,272,234,195 USD derivative volume |
| CoinGecko `GET /api/v3/exchanges/coinp` | 404 `{"error":"exchange not found"}` |
| CoinGecko `GET /api/v3/derivatives/exchanges/coinp` | 404 `{"error":"market not found"}` |
| Telegram `https://t.me/coinp_en` | 200, channel title "Coinp Global", 326 members in all three runs, with 7 to 12 shown online |
| Medium feed `https://medium.com/feed/@CoinP_` | 200, 0 posts |
| GitHub repository search for `"coinp.com"` | 8 results, none a CoinP repository |
| Wayback Machine capture index for `coinp.com/*` | 429 `Too Many Requests` on every attempt from this exit, so no archived copy of the site was read |

CoinGecko answered 429 in the first run, before the probe had a retry.
The probe now retries once after 30 s on a 429, and the later two runs got the 404 on the first try.

## 2. Catalog

No catalog could be read.
No instruments call is documented, and every guessed path returned 521.
CoinMarketCap's market pairs call lists 0 pairs in every category, so not even a third-party symbol list exists.
The active perpetual count is unknown, and there is no CCXT mapping to describe, since there is no class.

## 3. Anchor

No anchor call could be read.
Whether CoinP publishes index, mark, funding rate, interval or next settlement is unknown, and no `AnchorRow` column can be filled.

## 4. Anchor semantics

Unknown.
No index formula, basket, mark formula, clamp or funding formula could be read.

## 5. REST book snapshot

No book call could be read.

## 6. Rate limits and error shapes

No published limits could be read.
The only error shape seen is Cloudflare's 521 page, described in section 1.
No `Retry-After` header was seen on any 521.

## 7. Server time

No server time call could be read.
The Cloudflare trace returns `ts=` with the edge's clock, which is not the venue's clock.

## 8. Recommended poller shape

No poller is recommended.
There is no reachable catalog for the engine's catalog stage, no anchor for the anchor poller and no book for the feed.
A later run should check whether `https://www.coinp.com/` serves its site again before any other work, since every other surface depends on it.

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | [`rest-probe.py`](../../../scripts/probes/venues/coinp/rest-probe.py), three runs | 2026-10-10 UTC | DNS, every HTTP status, CoinMarketCap, CoinGecko, Telegram, Medium, GitHub and Wayback results |
| S2 | `dig +short NS coinp.com` | 2026-10-10 UTC | Cloudflare name servers |
| S3 | `curl` to `https://coinp.com/` and `https://coinp.io/` without a browser User-Agent | 2026-10-10 UTC | the 301 to `www` and the plain text 521 |
