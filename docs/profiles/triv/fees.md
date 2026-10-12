# TRIV Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:25 to 03:41 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the USDT-margined perpetuals of TRIV, an Indonesian broker that has sold crypto since 2015.
TRIV runs its perpetuals, "TRIV Crypto Futures", on the CFX crypto bourse, and its futures page streams from the CFX socket, as [`websocket.md`](./websocket.md) shows.
TRIV publishes no API documentation and no futures fee schedule, so no perpetual fee here is a published number.
TRIV has no CCXT class.
Spot is named once in the coverage matrix.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | The about page names PT Tiga Inti Utama, and the home page says TRIV is registered with and supervised by Bappebti. | Published | S1, S2 |
| futures venue | TRIV Crypto Futures launched in January 2025 under Bappebti with the CFX crypto bourse and the JFX futures exchange, with up to 25x leverage. CFX lists TRIV among its members. | Published | S4, S5 |
| who may trade the perpetuals | The about page says TRIV serves Indonesian investors ("Melayani Investor Indonesia"). No foreign client terms were found. | Region-specific | S1 |
| restricted locations | No list was found. The help center host `help.triv.id`, linked from `triv.id`, does not resolve in DNS. | Not publicly specified | [`rest-probe.py`](../../../scripts/probes/venues/triv/rest-probe.py) section "Site access" |
| website from this exit | `triv.co.id` and `triv.id` answered 200 to this Canadian exit. The futures page rendered logged out, with `gon.current_user` null. | Probed | [`rest-probe.py`](../../../scripts/probes/venues/triv/rest-probe.py) sections "Site access" and "Futures page" |
| CFX from this exit | `api-exchange.cfx.co.id` answered 403 with `{"error":"Blocked by CFX Security Rules", ..., "location": "CA"}`. `api.cfx.co.id` answered a bare nginx 403. The CFX socket accepted the connection but refused every channel without auth. | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 3 |

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-margined perpetual | unknown | unknown | Not publicly specified | No fee page on `triv.co.id`, none in the futures page, and none in the launch coverage, S4. |

The futures page has a "Fee" column in its logged-in trade history table only.
Paths such as `/id/fee` and `/id/home/fee` redirect to the home page.
No spot fee schedule was found either.
The spot page carries `gon.rate_adjustments` of 17954 IDR per USDT to buy and 17846 to sell, a spread of about 0.6%, as [`rest.md`](./rest.md) section 2 records.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT-margined perpetuals | yes, 49 symbols | `gon.active_market_futures` on the futures page lists 49 symbols, all with `pair` USDT, [`rest-probe.py`](../../../scripts/probes/venues/triv/rest-probe.py) section "Futures page" |
| coin-margined perpetuals | none listed | No symbol settles in a coin. The page's "COIN-M" strings sit in a notification text copied from another venue. |
| USDC-margined perpetuals | none listed | same as above |
| dated futures | not found | No delivery or quarterly symbol, and the page never says "Delivery" or "Quarterly". |
| options | not found | no route or symbol |
| spot | yes, against IDR and USDT | CoinMarketCap lists 936 spot pairs for TRIV and 0 perpetual pairs, [`rest-probe.py`](../../../scripts/probes/venues/triv/rest-probe.py) section "CoinMarketCap listing" |

CoinMarketCap does not track TRIV's perpetuals, so its count of 0 is a gap in its data, not evidence of absence.

## 4. Perpetual tiers

Not publicly specified.
No tier table, VIP program or volume rule for futures was found on the site or in the launch coverage.

## 5. Discounts that change the perpetual taker

Not publicly specified.
No token, referral rebate or zero fee promotion for futures was found.
The home page links an affiliate program, which describes no futures rebate.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula, cap and floor | Not publicly specified | Not publicly specified | no page found |
| interval | 8 hours. The futures page counts down to 07:00, 15:00 and 23:00 local time. In Jakarta time, UTC+7, those are 00:00, 08:00 and 16:00 UTC. | Probed for the code, inferred for the time zone | `updateFCountdown` in the futures settings script, [`rest-probe.py`](../../../scripts/probes/venues/triv/rest-probe.py) section "Funding countdown in the web app" |
| live rate | carried as `funding_rate` on the CFX channel `ticker.<symbol>`, which refused this probe | Not publicly specified | [`websocket.md`](./websocket.md) section 2 |
| settlement instant | not captured | | design rule, no clock event was awaited |

The countdown uses the browser's own clock, so the UTC instants hold only for a viewer in Jakarta time.
The page also offers a notice "when expected funding rate charged rates" crosses 25%, which reads as a user alert setting rather than a cap.

## 7. Liquidation, settlement and delisting

Not publicly specified.
The futures page describes cross and isolated margin and a liquidation price calculator at `/futures/calculator/liquidation/price`, and names no liquidation fee.
No dated contract exists, so there is no settlement fee.

## 8. CCXT

CCXT 4.5.68 has no TRIV or CFX class.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` has "triv" or "cfx" in its name, and `ccxt.js` there never mentions TRIV.
The current CCXT source on GitHub has no `ts/src/triv.ts`, which answered 404, and no file under `ts/src` with either name, checked on 2026-10-09.
`ccxtTakerPpm` therefore has no value.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | none | No perpetual fee is published, and no public call returns one. |
| `ccxtTakerPpm` | none | no CCXT class |

No registry entry is recommended, because the venue fails the book feed and the anchor, as [`rest.md`](./rest.md) section 8 says.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [TRIV about page](https://triv.co.id/en/about) | 2026-10-09 |
| S2 | [TRIV home page](https://triv.co.id/id) | 2026-10-09 |
| S3 | [TRIV futures page for BTCUSDT-PERP](https://triv.co.id/en/futures/BTCUSDT-PERP) and its scripts under `/assets/markets/futures/` and `/assets/perpetuals/` | 2026-10-09 |
| S4 | [Liputan6, "TRIV Resmi Luncurkan Crypto Futures"](https://www.liputan6.com/crypto/read/5902918/triv-resmi-luncurkan-crypto-futures-apa-itu), published 2025-01-31 | 2026-10-09 |
| S5 | [CFX home page](https://www.cfx.co.id/id), which lists TRIV among its members | 2026-10-09 |
