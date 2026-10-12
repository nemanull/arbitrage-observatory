# Feather Exchange Fee Profile

**Status:** Done.
Feather Exchange lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:34 to 04:53 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada (Vancouver, AS212238).

Feather Exchange trades at `ftrex.io` and is rank 217 on CoinMarketCap.
It has no CCXT class, so the folder is the slug `feather`.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/feather/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/feather/rest-probe.py).

The finding that governs every section: 8 of Feather's 10 spot markets are marked `"matchingMode":"EXTERNAL"` in its own catalog, and their books are Binance's spot books.
A BTC_USDT book fetched from Feather and Binance at the same moment matched on all 40 levels in price and size, see [`rest.md`](./rest.md) section 5.
Its public trades carry order ids such as `REF-BUY-1791607241398` and no member ids, see [`websocket.md`](./websocket.md) section 6.
The fee numbers below are what Feather publishes, and no fill can be observed without an account.

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-10-09 | this profile |
| legal entity | CoinMarketCap's description says the platform is "Based in Hong Kong and operated by FTR Capital". No page on `ftrex.io` that was read names a company or a registration. | S1, `fees-probe.py` section "CoinMarketCap exchange record" |
| CoinMarketCap record | id 34437, `dateLaunched` 2026-04-05, while the description says it launched on 2 April 2026, tag "[Internal] Auto Order Book Exchange" | S1 |
| what it sells | spot only, 10 USDT pairs in its catalog, 8 of them on CoinMarketCap | S1, S4, [`rest.md`](./rest.md) section 2 |
| who may trade | Not publicly specified. CoinMarketCap lists the countries HK, KR, VN, PE, CO, JP, ID and IN, and no fiat. | S1 |
| regions excluded | Not publicly specified. `/en/terms`, `/en/privacy`, `/en/legal` and `/en/user-agreement` all answer 404, and no restricted country list was found. | `fees-probe.py` section "candidate legal pages" |
| access from this host | every Feather host answered from the Canadian exit, with no geoblock. The AWS load balancer in front of `ftrex.io` refuses a bare `Mozilla/5.0` or a library User-Agent with 403, and a full browser User-Agent is answered. | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

There is no perpetual to price.
The spot fee is one rate with no maker and taker split.

| product | maker | taker | evidence |
|---|---|---|---|
| spot, every pair, VIP 0 | 0.1%, 1000 ppm | 0.1%, 1000 ppm | Published on the fee page, S2, and `"fee":0.0010` on every row of `GET /api/market/symbol`, S4 |
| spot, as CoinMarketCap records it | 0.05%, 500 ppm | 0.05%, 500 ppm | `makerFee 0.05`, `takerFee 0.05` in the CoinMarketCap record, S1 |

The two disagree.
Feather's own fee page and its own catalog both say 0.1%, so 1000 ppm is the number this profile uses.
The catalog also says `"feeInBaseSymbol":true`, which reads as the fee being taken in the base asset, but no fill was observed to confirm it.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT-margined perpetuals | Not offered | CoinMarketCap's perpetual pair list is empty, the web bundle names no swap or contract route, and `/api/swap/symbol-thumb`, `/api/contract/symbol-thumb`, `/api/swap/market/symbol` and `/api/futures/market/symbol` all answer 404, see [`rest.md`](./rest.md) section 2 |
| coin-margined perpetuals | Not offered | same evidence |
| dated futures | Not offered | CoinMarketCap's futures pair list is empty and the bundle names no futures route |
| options | Not offered | the bundle names no options route |
| spot | present, 10 USDT pairs | `GET /api/market/symbol`, S4 |

## 4. Spot tiers

None published.
The fee page lists one rate, 0.1%, for each of BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT, DOGE/USDT, ADA/USDT, TRX/USDT and FTR/USDT, and says "Each completed trade is charged at the rate shown above", S2.
FTU/USDT is in the catalog at the same `fee` of 0.001 but not on the fee page, S4.
No volume tier, VIP table or market maker schedule was found.

## 5. Discounts that change the taker

Not publicly specified.
CoinMarketCap's description ties the FTR token to "account-level eligibility" and Flow Levels inside a programme it calls MatrixFlow, and it names no fee discount, S1.
No referral rate, token discount or zero fee promotion was found on the fee page.

## 6. Funding as a cost

Not offered.
Feather lists no perpetual, so there is no funding rate, interval, cap or floor.

## 7. Liquidation, settlement and delisting charges

Not offered for a spot venue with no margin product found.
No delisting fee was found.

## 8. CCXT

CCXT 4.5.68 has no Feather class.
None of the 104 `.js` files in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` is named for Feather or FTR, and none mentions `ftrex` or `feather`, see `fees-probe.py` section "CCXT".
CCXT master on GitHub has no such class either, 103 `.ts` files in `ts/src` on 2026-10-10 and none matching, S5.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and Feather has no perpetual and no CCXT class.
It cannot enter the registry as a perpetual leg.
If a later design adds spot legs, `takerPpm` would be 1000 from the fee page, there is no `ccxtTakerPpm` to declare, and the 8 externally matched books duplicate Binance's, so they add no independent price.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=feather-exchange`, read by `fees-probe.py` | id, launch date, description, countries, the 0.05% maker and taker, the fee URL |
| S2 | `https://ftrex.io/en/trade/fee`, read by `fees-probe.py` | the 0.1% uniform spot fee for nine pairs |
| S3 | `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=feather-exchange&category=<spot,perpetual,futures>`, read by `fees-probe.py` | 8 spot pairs, 0 perpetual and 0 futures pairs |
| S4 | `GET https://ftrex.io/api/market/symbol`, read by `fees-probe.py` and `rest-probe.py` | `fee`, `feeInBaseSymbol` and `matchingMode` per pair |
| S5 | `https://api.github.com/repos/ccxt/ccxt/contents/ts/src`, read by `fees-probe.py` | no Feather class on CCXT master |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/feather/fees-probe.py) | every probed line above |
