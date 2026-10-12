# NexDAX Fee Profile

**Status:** Done, with the fee schedule unread because every page of the venue's site is geoblocked from this host.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:53 to 04:12 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

NexDAX lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template asks.
NexDAX has no CCXT class, see section 8.
Every number carries a source id from section 10 or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/nexdax/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/nexdax/rest-probe.py).
The REST and socket details are in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

- CoinMarketCap lists NexDAX as exchange id 1531 with launch date 2019-09-10, no country and no fiat, S1.
  Its description says the "NEXt-Generation Digital Asset eXchange" launched on 2021-10-04 and names NT as the venue's own coin, S1.
- No legal entity was found.
  The terms of use are the page that would name it, and that page is geoblocked from this host, see below.
- Every path on `nexdax.com` answers `302` with `location: https://nexdax.com/forbidden.html` from this exit, in `fees-probe.py`.
  That covers `/`, `/trading-rule.html`, `/terms-of-use.html` and `/exchange-advanced.html`.
- `forbidden.html` itself answers `200` with the heading "Jurisdictional Limitations", S6.
  It says the services "are not available to individuals or entities who are nationals, residents, or permanent residents of certain restricted jurisdictions, regardless of their current location", and it points to the geoblocked terms of use for the list.
  It also says that circumventing the restriction "through misrepresentation, use of VPNs, or false declarations" leads to suspension.
- So Canada is treated as a restricted jurisdiction by the site, as seen from this exit.
  The full list of excluded regions could not be read.
- `www.nexdax.com` answers Cloudflare `526`, an invalid origin certificate, in `fees-probe.py`.
- The API host `api.nexdax.com` and the socket host `socket.nexdax.com` are not geoblocked, see [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot | Not publicly specified from this exit | Not publicly specified from this exit | the fee page S2 is geoblocked, its archived copy S3 could not be fetched, and the API has no public fee call |

CoinMarketCap's record reads `makerFee 0.0` and `takerFee 0.0`, and it names `https://nexdax.com/trading-rule.html` as the fee page, S1.
No NexDAX page readable from this host confirms a zero fee, so the zero is not used.
The API paths `/api/v1/tradeFee`, `/api/v1/fees` and `/sapi/v1/asset/tradeFee` all answer `404` with the body `"404 Not found"`, in `fees-probe.py`.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals | no | CoinMarketCap shows 0 perpetual and 0 futures pairs and 0 perpetual volume, S4, and `/fapi/v1/ping`, `/fapi/v1/exchangeInfo`, `/fapi/v1/premiumIndex`, `/api/v1/premiumIndex` and `/dapi/v1/ping` all answer `404`, in `rest-probe.py` |
| dated futures | no | the same CoinMarketCap and API checks |
| options | no | nothing on CoinMarketCap and no API path found |
| spot | yes, 283 pairs all `TRADING`, of which 123 had a two-sided book | `exchangeInfo` and `ticker/bookTicker` in `rest-probe.py`, see [`rest.md`](./rest.md) section 2 |

CoinMarketCap tracks 105 of the 283 pairs, S4.
No futures host was found among the subdomains `futures`, `fapi`, `dapi`, `contract`, `swap` and `perp`, none of which resolves.
That subdomain check was done by hand with `getent hosts` on 2026-10-10 and is not in a probe.

## 4. Spot tiers

No tier table could be read.
The fee page S2 is the only fee source CoinMarketCap names, and it is geoblocked.
Not publicly specified from this exit.

## 5. Discounts that change the spot taker

The CoinMarketCap description names NT as the venue's coin, S1.
Whether holding NT lowers the fee is not stated anywhere readable from this host.
No referral or market maker programme was found.

## 6. Funding as a cost

Not offered.
The venue lists no perpetuals, so there is no funding.

## 7. Liquidation, settlement and delisting

Not offered for spot.
No margin product was found, so there is no liquidation charge.
No delisting fee was found.

## 8. CCXT

- CCXT 4.5.68 has no NexDAX class.
  There is no `nexdax.js` among the 104 files under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no file there contains the string `nexdax`, in `fees-probe.py`.
- The current CCXT source has no class either.
  The listing of `ts/src` at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08 holds 110 entries, 103 of them `.ts` files, and the only names containing `nex` or `dax` are `bitfinex.ts`, `digifinex.ts`, `indodax.ts` and `ndax.ts`, S5.
  `exchanges.json` on master does not list `nexdax`, in `fees-probe.py`.
- So there is no `market.taker` to read.
  The API is a copy of the Binance spot API shape, see [`rest.md`](./rest.md) section 2, but that alone does not make the CCXT `binance` class usable against it.

## 9. Recommended registry values

- `takerPpm`: unknown.
  No fee source is readable from this exit.
- `ccxtTakerPpm`: none, because there is no CCXT class.
- The venue lists no perpetuals, so it has no place in the perpetual registry as the engine stands.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | CoinMarketCap exchange record, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=nexdax` | 2026-10-10 UTC, in `fees-probe.py` |
| S2 | NexDAX trading rule page, `https://nexdax.com/trading-rule.html` | 2026-10-10 UTC, `302` to `forbidden.html` from this exit, in `fees-probe.py` |
| S3 | Wayback copy of S2, `https://web.archive.org/web/20250504124357/https://nexdax.com/trading-rule.html` | 2026-10-10 UTC, listed with status 200 by the Wayback availability API in a hand check at 03:57 UTC, but every fetch of the copy answered `429 Too Many Requests`, and in `fees-probe.py` the availability call answered `429` in the first run and an empty snapshot list in the second |
| S4 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=nexdax` with `category` spot, perpetual and futures | 2026-10-10 UTC, in `rest-probe.py` |
| S5 | [CCXT `ts/src` at `f0aca06`](https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src) | 2026-10-10 UTC, in `fees-probe.py` |
| S6 | NexDAX forbidden page, `https://nexdax.com/forbidden.html` | 2026-10-10 UTC, in `fees-probe.py` |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/nexdax/fees-probe.py) | 2026-10-10 UTC |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/nexdax/rest-probe.py) | 2026-10-10 UTC |
