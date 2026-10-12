# CoinCola Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:33 to 04:47 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

CoinCola lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
CoinCola is mainly a P2P marketplace, and its spot market, which it calls the Exchange Market, is a small side product with 29 pairs.
CoinCola has no CCXT class, see section 8.
Every number carries a source id from section 10 or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/coincola/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/coincola/rest-probe.py).
The REST and socket details are in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | section 10 |
| legal entity | The terms name only "the operators of CoinCola", with no company, address or regulator. | Not publicly specified | S5 |
| restricted locations | "CoinCola doesn't provide cryptocurrency trading service to the USA and UK users", posted 2019-10-21. The terms add that some functions may be unavailable depending on the country of residence, with no list. | Region-specific | S6, S5 |
| who may trade spot | A registered account holder of at least 18 outside the USA and the UK. The fee rows below carry no account tier. | Region-specific | S5, S6 |
| automated access | The terms forbid "any robot, spider, crawler, scraper or other automated means or interface not provided by us". The documented market API on `api.coincola.com` is an interface CoinCola provides, S4, and the spot socket is not documented. | Published | S5, S4 |
| website and API from this exit | Every call in the three profiles answered without a refusal. The hosts sit behind Amazon CloudFront, and every reply came through the `HIO52` edge. | Probed | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, all 29 pairs | 0.1%, 1000 ppm | 0.1%, 1000 ppm | Published and Probed | S1 and S2 say "Exchange Market 0.1% trading fee". `GET /v1/market/assets` gave `maker_fee` 0.001 and `taker_fee` 0.001 on all 25 assets, and the trading page's order form shows "Fee: 0.1%", in `fees-probe.py` sections 1 to 3 |

The fee is charged "of the exchanged amount", S1, which reads as the amount received.
CoinMarketCap's record shows `makerFee` 0 and `takerFee` 0 for CoinCola, S8, which disagrees with every CoinCola source and is not used.
The help centre does not say so more precisely.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | no | `GET /v1/contract/market?product_type=PERPETUAL` returned `[]`, in `fees-probe.py` section 4 and `rest-probe.py` section 3 |
| USDC-M and coin-M perpetuals | no | the same empty reply, and the web app has no futures page, see below |
| dated futures | no | `product_type=FUTURES` returned `[]` |
| options | no | `product_type=OPTIONS` returned `[]` |
| margin | yes, on 6 USDT pairs at 3x | the trading page's symbol table gives `margin_support` true and `leverage` 3 on `A_USDT`, `BCH_USDT`, `BTC_USDT`, `ETH_USDT`, `LTC_USDT` and `XRP_USDT`, in `rest-probe.py` section 2. S9 names the margin trading fee as 0.1%, the same as spot. Not detailed |
| spot | yes, 29 pairs, 24 against USDT and 5 against BTC | `GET /v1/market`, in `rest-probe.py` section 2 |
| P2P and Express | yes, the main business | S1, not detailed |

The API documentation, S4, describes a derivatives section with contract summary, specification and order book calls.
All three calls answer, and all three return no contract.
The documentation says "If an empty array is returned, it means there is no contract at the moment".
The web app's page list, S3, has `/trading`, `/margin-trade`, `/express`, `/otc-ad-list` and the wallet pages, and no futures or perpetual page.
The web bundle has no "perpetual", "futures" or "funding" string.
CoinMarketCap's record for CoinCola, S8, lists 0 perpetual pairs and 0 futures pairs against 23 spot pairs, in `fees-probe.py` section 5.
The survey plan's tracker also shows no perpetuals on CoinGecko for CoinCola.

## 4. Spot tiers

There is no tier table.
S1 and S2 give one flat 0.1% for the Exchange Market, and the trading page calls it "0.1% Flat Rate".
S7, from 2019, announced a cut from 0.2% to 0.1% as a 50% off promotion with no end date, and said the fee would change "according to market".
The 0.1% has held in S1 since, and S2 was updated on 2026-10-09.
S9 offered "the lowest VIP rate discount" for 90 days to traders with at least 5 BTC of volume elsewhere, from 2021-12-14 to 2022-02-28, and named no rate.
No VIP rate table was found, and the web route `/acts/vip-scheme` now redirects to the home page.
Not publicly specified.

## 5. Discounts that change the spot taker

- Token holding: no exchange token appears in the fee pages, the asset list or the web app.
  Not offered.
- Referral: the referrer receives 0.1% of the referee's completed trade volume for up to 180 days, from the web app's referral text, S3.
  That is a rebate to the referrer, not a lower taker for the trader.
- Coupons: the order form has coupon slots for limit and market orders, `limitBuyCoupon` and its siblings in the page state, S3.
  Their value needs a login.
  Not publicly specified.
- Market maker programme: none found in the help centre.
  Not publicly specified.
- Zero fee promotions: S1 and S2 say "The specific rate during the event is subject to the event details", and link no current event.

## 6. Funding as a cost

Not offered, because there are no perpetuals.
Margin borrowing, launched in 2019 per S7, is not a funding rate and is not detailed.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge.
Margin liquidation charges are not published in the pages read and are not detailed.
No delisting charge is published.
Withdrawal fees are fixed per asset in S1, such as 0.0001 BTC and 2 USDT on TRC20, and are not recorded further here.

## 8. CCXT

CoinCola has no class in CCXT 4.5.68.
The installed tree at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 files, and none has "cola" in its name or text.
The current CCXT source has no class either.
`ts/src/coincola.ts` answered 404 at `master`, the `ts/src` listing at commit `f0aca06` (2026-10-08) has no name with "cola", and the 103 ids of `exchanges.json` at `master` do not include it, S10.
So `market.taker` cannot be read for CoinCola.

## 9. Recommended registry values

- `takerPpm`: 1000, from S1, S2 and the 0.001 `taker_fee` on every asset of `GET /v1/market/assets`.
- `ccxtTakerPpm`: none, because there is no CCXT class.
  The engine's perpetual registry does not apply, since CoinCola lists no perpetuals.
  A future spot leg would take the fee from `GET /v1/market/assets`, which carries `maker_fee` and `taker_fee` per asset.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [CoinCola Fees](https://coincolahelp.zendesk.com/hc/en-us/articles/360009260513-CoinCola-Fees), updated 2026-02-04, the fee page CoinMarketCap links | 2026-10-09, through the public Zendesk API, in `fees-probe.py` section 3 |
| S2 | [CoinCola Fee](https://coincolahelp.zendesk.com/hc/en-us/articles/360009595734-CoinCola-Fee), updated 2026-10-09 | 2026-10-09, in `fees-probe.py` section 3 |
| S3 | CoinCola spot trading page `https://www.coincola.com/trading/btc/usdt`, its `__NEXT_DATA__` state, its build manifest and its `_app` bundle | 2026-10-09 |
| S4 | [CoinCola Exchange API Documentation](https://coincolahelp.zendesk.com/hc/en-us/articles/4404304682905-CoinCola-Exchange-API-Documentation), updated 2025-04-10 | 2026-10-09 |
| S5 | CoinCola Terms of Business, `https://www.coincola.com/static/policy.html`, "Updated and Effective as of September 20, 2018", the target of `/terms-of-service` | 2026-10-09 |
| S6 | [Announcement on trading service to USA and UK User](https://coincolahelp.zendesk.com/hc/en-us/articles/360037451033-Announcement-on-trading-service-to-USA-and-UK-User), 2019-10-21 | 2026-10-09 |
| S7 | [New Tiered Fee Structure Announcement](https://coincolahelp.zendesk.com/hc/en-us/articles/360024165734-New-Tiered-Fee-Structure-Announcement), 2019-06-26, and [CoinCola Launches Margin Trading Service](https://coincolahelp.zendesk.com/hc/en-us/articles/360038268854-CoinCola-Launches-Margin-Trading-Service), 2019-11-22 | 2026-10-09 |
| S8 | CoinMarketCap exchange record and market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coincola` | 2026-10-09, in `fees-probe.py` section 5 |
| S9 | [CoinCola Launches VIP Invitation Program](https://coincolahelp.zendesk.com/hc/en-us/articles/4411970882713), 2021-12-14 | 2026-10-09 |
| S10 | [CCXT `ts/src` at `f0aca06`](https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src) and [`exchanges.json`](https://github.com/ccxt/ccxt/blob/master/exchanges.json) | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/coincola/fees-probe.py) | 2026-10-10 UTC |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/coincola/rest-probe.py) | 2026-10-10 UTC |
