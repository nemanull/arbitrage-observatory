# Reku REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:42 to 02:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada, in AS212238 Datacamp Limited.

Reku's REST surface could not be read from this host.
Every Reku host, the site, the API host, the documentation host and the stream hosts, returned HTTP 403 with Cloudflare error 1005, an ASN ban, section 1.
What follows is the evidence for that, and what third parties publish about Reku's catalog and reference prices.
CCXT has no Reku class, see [`fees.md`](./fees.md) section 8.

## 1. Host and latency from this machine

### Exit

[`access-probe.py`](../../../scripts/probes/venues/reku/access-probe.py) mode `exit` read `https://ipinfo.io/json`: IP 149.22.81.161, Vancouver, British Columbia, CA, `AS212238 Datacamp Limited`, P1.

### Host names

The certificate transparency logs hold 2,192 certificates for `%.reku.id` with 57 distinct names, S14, P1.
The production names among them are `reku.id`, `www.reku.id`, `api-docs.reku.id`, `chart.reku.id`, `referral.reku.id` and `transparency.reku.id`, beside many staging, test and internal names such as `stag-api.reku.id`, `stream-dev.reku.id`, `stag-pstream.reku.id`, `proxy-okx.reku.id` and `proxy-gateio.reku.id`.
`api.reku.id` is not in the logs by name, and is served by the `*.reku.id` wildcard certificate.
CoinMarketCap's market links still point at `https://www.rekeningku.com/trade/<BASE>-IDR`, P2.

### What each host returned

Every row is one GET with a browser user agent, P1.

| URL | IPv4 | status | body |
|---|---|---|---|
| `https://reku.id/` | 104.20.28.118, 172.66.145.225 | 403 | Cloudflare page, Error 1005 |
| `https://www.reku.id/` | same | 403 | Error 1005 |
| `https://reku.id/en/fees` | same | 403 | Error 1005 |
| `https://reku.id/en/fees/futures` | same | 403 | Error 1005 |
| `https://api.reku.id/` | same | 403 | Error 1005 |
| `https://api.reku.id/v2/price` | same | 403 | Error 1005 |
| `https://api-docs.reku.id/` | same | 403 | Error 1005 |
| `https://stream.reku.id/` | same | 403 | Error 1005 |
| `https://pstream.reku.id/` | same | 403 | Error 1005 |
| `https://chart.reku.id/` | same | 403 | Error 1005 |
| `https://rekeningku.com/` | 76.76.21.21 | 301 | `server: Vercel`, `location: https://reku.id/` |
| `https://www.rekeningku.com/` | 104.21.68.82, 172.67.192.59 | 403 | Error 1005 |
| `https://api.rekeningku.com/` | same as above | 403 | Error 1005 |

Every 403 carried `server: cloudflare` and a `cf-ray` ending in `-YVR`, the Vancouver edge, P1.
The old apex `rekeningku.com` is not behind Cloudflare and only redirects to `reku.id`.
The browser page reads, as the probe reduced it:

```text
Error 1005: The owner of this website (reku.id) has banned the autonomous system number (ASN) your IP address is in (212238) from accessing this website.
```

A client without a browser user agent gets the 17 byte plain text body `error code: 1005` instead, P1.
The 403 replies took 31 to 86 ms in the second pass, which is the edge answering, not Reku's origin.
Error 1005 is the code Cloudflare gives when a site owner blocks an ASN, S18.
AS212238 is the hosting network behind this VPN exit, so the ban is on that network and not on Canada as such, and an exit in another network could get a different answer.
The survey routes nothing around a refusal, so no other exit was tried.

### Other sources checked

| source | result |
|---|---|
| Wayback Machine availability API | answers, and names captures of `reku.id/fees` from 2024-10-05, `reku.id/en/fees/futures` from 2025-11-11 and `api.reku.id` from 2025-09-30, P1 |
| Wayback Machine captures | 429 `Too Many Requests` on every capture from this exit, so no archived copy was read, P1 |
| CoinMarketCap data API | answers, section 2 |
| CoinGecko public API | `/exchanges/reku` returns 404 `{"error":"exchange not found"}`, and neither the exchange list of 1,503 nor the derivatives list of 216 names Reku, P2 |
| CFX, Indonesia's crypto asset exchange, `www.cfx.co.id` | answers, sections 2 and 3 |
| search engine excerpts of Reku pages | the fee figures and the terms quoted in [`fees.md`](./fees.md), labelled there |

## 2. Catalog

No Reku instruments call could be read.
The catalog evidence is third-party.

| source | what it shows | source id |
|---|---|---|
| CoinMarketCap spot pairs | 42 pairs, every one quoted in IDR, from `USDT/IDR` and `BTC/IDR` down to `YFI/IDR` | P2 |
| CoinMarketCap perpetual and futures pairs | 0 and 0 | P2 |
| CoinMarketCap derivatives ranking, `exType=2` | 104 venues, Reku not among them | P2 |
| CoinMarketCap spot ranking, `exType=1` | Reku 96th of 231 by that listing's order | P2 |
| CFX registered derivative crypto assets | 49 contracts, from `AAVEUSDT-PERP` to `ZRXUSDT-PERP`, the set every Indonesian venue lists from | S11, P2 |
| CFX perpetual trading summary | the same 49 contracts with open, high, low, close, size, volume and trade count, summed over all Indonesian venues | S12, P2 |
| Reku announcements | contracts named `<BASE>USDT-PERP`, 125 at 10x leverage in December 2025, 117 delisted in three batches from January to March 2026 | S5 to S8 |

CFX's list is national, not Reku's own.
It bounds Reku's catalog only if CFX registration is required, which this profile infers and did not read in a rule, see [`fees.md`](./fees.md) section 3.
The contract size, the settlement asset of the margin, the status values and any pair listed twice are unknown.
There is no CCXT mapping to compare.

## 3. Anchor

No Reku call for index, mark, funding rate, interval or next settlement could be read.

CFX publishes a page "Perpetual Index Price References" with one index price per registered contract, 49 rows, each with a "Last Update" stamp, S11, P2.
It is a rendered HTML page, ten rows per page over five pages, with no JSON call found behind it.
The rows of one page share one stamp, but pages differ.
In the second pass, read from 02:56:49 to 02:57:18 UTC, page 1 showed `10 Oct 2026 02:48` and page 5 showed `10 Oct 2026 02:56`, P2.
So each page is cached and re-rendered on its own, and the stamp, which names no time zone, tracks UTC.
The page publishes no mark price, no funding rate, no interval and no next settlement.
Whether Reku's own index is this CFX reference is Not publicly specified as far as this host could read.

## 4. Anchor semantics

Reku's perpetual terms, read through a search excerpt, define the mark price as a weighted average index of global crypto exchanges, used for profit and loss and for the funding rate, see [`fees.md`](./fees.md) section 6.
The basket, the weights, every clamp, the funding formula and cap, and whether a published rate is upcoming or settled are Not publicly specified as far as this host could read.
No number could be polled.

## 5. REST book snapshot

None could be read.
No book call is documented anywhere this host could read.

## 6. Rate limits and error shapes

Unknown.
The only error seen is the Cloudflare edge's 403 with error 1005, section 1, which no request rate causes or clears.

## 7. Server time

Unknown, since no Reku call answered.

## 8. Recommended poller shape

No poller is recommended.
No catalog, book or anchor call could be read from this host, and no documentation either.
The CFX index page is a national reference with no mark or funding, published as HTML with page stamps up to minutes apart, so it cannot fill an anchor row alone.
A later run from an exit outside AS212238 should read `https://api-docs.reku.id/` first, then decide whether Reku offers any public perpetual market data.

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| P1 | [`access-probe.py`](../../../scripts/probes/venues/reku/access-probe.py), modes `exit`, `hosts`, `archive` and `ct` | 2026-10-10 UTC | the exit, the 403 replies, the Wayback Machine 429, the host names |
| P2 | [`catalog-probe.py`](../../../scripts/probes/venues/reku/catalog-probe.py), modes `cmc`, `coingecko`, `ccxt` and `cfx` | 2026-10-10 UTC | CoinMarketCap, CoinGecko, CCXT and CFX reads |
| S5 to S8 | Reku leverage and delisting announcements, listed in [`fees.md`](./fees.md) section 10 | 2026-10-10 UTC | contract naming and counts |
| S11 | CFX registered derivative crypto assets `https://www.cfx.co.id/en/products-and-services/derivatives-crypto-asset` and index price references `https://www.cfx.co.id/en/market-data/index-price` | 2026-10-10 UTC | 49 contracts, index prices and stamps |
| S12 | CFX perpetual trading summary `https://www.cfx.co.id/en/market-data/perpetual-derivatives` | 2026-10-10 UTC | national daily summary |
| S14 | crt.sh `https://crt.sh/?q=%25.reku.id&output=json` | 2026-10-10 UTC | host names |
| S18 | Cloudflare, error 1005, `https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1005/` | 2026-10-10 UTC | meaning of the refusal |
