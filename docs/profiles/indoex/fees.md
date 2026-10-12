# IndoEx Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:13 to 03:30 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

This profile covers IndoEx, which lists no perpetuals, so its spot market is the researched product, as change 1 of the survey plan's template says.
IndoEx has no CCXT class, see section 8.
Every number carries a source ledger row or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/indoex/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/indoex/ws-probe.py).
Source ids are shared with [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | The Legalities page names "HOLDINGS BY G LTD, a private limited company registered in the United Kingdom under company number 15605886". | Published | S4, P1 |
| offices | CoinMarketCap's description names an office in Tallinn, Estonia, and one in London, and calls the venue "a decentralized exchange", although it runs a central order book. | Published | S1, P1 |
| restricted locations | Not publicly specified. The Legalities page only says "Users must not access or use our services where doing so would violate applicable laws or restrictions". The site bundle mentions neither Canada, the United States nor any list of restricted countries. | Not publicly specified | S4, P1 |
| who may trade spot | Any account holder whose local law allows it, by the Legalities page. | Published | S4 |
| website from this host | `www.indoex.io` answered 200 behind Cloudflare's Vancouver edge, with no challenge. | Probed | P2, see [`rest.md`](./rest.md) section 1 |
| public API from this host | `api.indoex.io` answered every documented public call with 200. | Probed | P2 to P7 |
| socket from this host | The documented host `websocket.indoex.io` answered 502 from Cloudflare, and the two hosts the site uses answered the handshake. | Probed | P8, see [`websocket.md`](./websocket.md) section 1 |

Nothing refused this host.
CoinMarketCap lists the venue as active, launched 2019-01-16, with about 475 to 478 million USD of spot volume and 0 USD of perpetual and futures volume over 24 hours in the probe reads, S1 and P1.
That spot volume is large next to what the probes saw: the newest BTC_USDT trade was 11 s old in one read and 7 minutes old in another, and the book's top moved about once a minute, see [`rest.md`](./rest.md) section 4.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | source |
|---|---|---|---|---|
| spot, per pair on `getMarketDetails` | `buyfee` 0.0015 on all 178 pairs | `sellfee` 0.0015 on all 178 pairs | Probed | P1, P3 |
| spot, per asset on `assets/all` | `maker_Fee` 0.0015 on 124 of 129 assets | `taker_Fee` 0.0015 on 124 of 129 assets | Probed | P1, P3 |
| the same for BTC, ETH and USDT | 0.15 %, 1,500 ppm | 0.15 %, 1,500 ppm | Probed | P1 |
| perpetuals | Not offered | Not offered | Not offered | section 3 |

The public API reports 0.15 % for both sides on every major asset and every pair.
The per pair fields are named `buyfee` and `sellfee`, not maker and taker, so the API does not split a maker rate from a taker rate per pair.
The API documentation's example, stamped 2020-10-01, shows `maker_Fee` 0.0015 and `taker_Fee` 0.001 for BTC, S2, and the live reply shows 0.0015 for both, P1.
Five assets carry other values on `assets/all`: XDC 0 and 0, SOLSA 0.0515 and 0.0515, COINA 0.0215 and 0.0315, MGBS 0.029 and 0.0115, BUBX 0.0215 and 0.0215, P1.
CoinMarketCap shows `makerFee` 0 and `takerFee` 0, which reads as an unfilled field, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT, USDC or coin margined perpetuals | absent | no derivative id among 231 pairs, CoinMarketCap perpetual volume 0, no IndoEx entry among 216 venues on CoinGecko's derivatives list, and the words "futures", "perpetual" and "funding rate" appear zero times in the 5.6 MB site bundle, P1, P3 |
| dated futures | absent | the same checks, CoinMarketCap futures volume 0, P1 |
| options | absent | no option id in the catalog, P3 |
| spot | present, 231 pairs listed, 178 with a 24 hour ticker | P3, see [`rest.md`](./rest.md) section 2 |
| leverage | a "leverage" balance tab, `liveragevendor` in the bundle, and a "LeverageBonus" promotion image exist, with no trading surface behind them that the public API shows | P1, P3 |
| staking, IEO, airdrops and voting | named in the site bundle's call list, such as `getstakingplans`, `getieolisting`, `getairdroplisting` and `getvotelist`, not detailed here | P1 |

## 4. Spot tiers

No tier table was found.
The fee page `https://www.indoex.io/fees` is an Angular page whose HTML holds only an empty `app-root`, S5 and P1.
Its table loads from `POST https://masternode.indoex.io/getVendorinfo/`, which the site sends with a `siteauthcode` header that its own script computes.
Without that header the call answers `{"status":0,"message":"Invalid link"}`, P1.
The probe does not compute the site's client signature, so the fee page's table was not read.
The public API's per asset and per pair fields in section 2 are the fee evidence.
Any rate below 0.15 % is Not publicly specified.

## 5. Discounts

| discount | effect on the spot taker | source |
|---|---|---|
| volume | Not publicly specified, no tier table found | section 4 |
| token holding | Not publicly specified | |
| referral | the site bundle names a referral bonus call, `applyforreferalbonus`, whose effect on the fee is Not publicly specified | P1 |
| market maker | the site bundle names a market maker service list call, `getmmlist`, whose terms are Not publicly specified | P1 |
| zero fee promotion | XDC shows 0 maker and 0 taker on `assets/all`, which may be a per asset promotion, and no end date is published | P1 |

## 6. Funding as a cost

Not applicable.
IndoEx lists no perpetuals, so there is no funding charge, see section 3.

## 7. Liquidation, settlement and delisting charges

| item | value | source |
|---|---|---|
| liquidation | Not applicable, no derivative or margin product shows in the public API | P3 |
| settlement | Not applicable, spot only | P3 |
| delisting | Not publicly specified. 53 of the 231 listed pairs have no row on `getMarketDetails`, which suggests idle or delisted pairs. | P3 |
| withdrawal | per asset `min_Withdrawal` and `max_Withdrawal` on `assets/all`, not detailed here | S2, P3 |

## 8. CCXT

CCXT 4.5.68 has no IndoEx class.
The installed source folder, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, holds 104 `.js` files, no file name contains "indoex", and no file contains the string "indoex", P1.
The only name starting with "indo" is `indodax.js`, which is Indodax, a different Indonesian exchange whose class declares `'id': 'indodax'` at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/indodax.js` line 21.
So there is no file and line to cite for IndoEx.
The current CCXT source on GitHub, `ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, lists 110 entries, and none contains "indoex", S6 and P1.
So CCXT reports no `market.taker` for this venue.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 1500, for a future spot leg only | `sellfee` and `buyfee` 0.0015 on all 178 pairs, and `taker_Fee` 0.0015 on BTC, ETH and USDT, P1 |
| `ccxtTakerPpm` | none | no CCXT class |

No registry entry is recommended for the perpetual engine, because IndoEx lists no perpetuals.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap exchange detail | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=indoex | 2026-10-09 | CoinMarketCap, id 587 | status, launch date, offices, volumes, fee fields |
| S2 | IndoEx public API documentation | https://api.indoex.io/ | 2026-10-09 | IndoEx | calls, example fee fields, error codes |
| S3 | IndoEx WebSocket API documentation | https://api.indoex.io/websocket.html | 2026-10-09 | IndoEx | the documented socket host and `join` frame |
| S4 | Legalities page, compiled into the site bundle `main.069d2e1cc5cdcb60663b.js` | https://www.indoex.io/legalities | 2026-10-09 | HOLDINGS BY G LTD | legal entity and the user's own legal responsibility |
| S5 | Fee page, client rendered | https://www.indoex.io/fees | 2026-10-09 | IndoEx | no static fee text, section 4 |
| S6 | CCXT `ts/src` listing | https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src | 2026-10-09 | CCXT | no IndoEx class |
| S7 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-10-09 | CoinGecko | no IndoEx entry |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/indoex/fees-probe.py) | `uv run scripts/probes/venues/indoex/fees-probe.py` | 2026-10-09 | this host, Canadian exit | CoinMarketCap, CoinGecko, fee fields, fee page call, bundle search, Legalities text, CCXT checks |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `host` | | 2026-10-09 | this host | access and latency |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `catalog` | | 2026-10-09 | this host | catalog counts and fee fields |
| P4 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `book` | | 2026-10-09 | this host | REST books |
| P5 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `poll` | | 2026-10-09 | this host | book change rate and the mid against Kraken |
| P6 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `limits` | | 2026-10-09 | this host | statuses and error shapes |
| P7 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `time` | | 2026-10-09 | this host | clock and data age |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/indoex/ws-probe.py) | `uv run scripts/probes/venues/indoex/ws-probe.py 45` | 2026-10-09 | this host | the three socket hosts |
