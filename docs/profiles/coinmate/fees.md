# Coinmate Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:37 to 03:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Coinmate lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 15 pairs quoted in EUR, CZK and BTC, see [`rest.md`](./rest.md) section 2.
The VIP 0 spot taker is 0.60 %, which is 6,000 ppm, read from the JSON the fee page renders.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/coinmate/fees-probe.py) and [`ccxt-probe.py`](../../../scripts/probes/venues/coinmate/ccxt-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | COINMATE a.s., Pernerova 697/35, Praha 8, Czech Republic, company no. 14071711 | Published | `fees-probe.py page`, S2 |
| regulator | the site says the Czech National Bank supervises it under MiCA, and its company history says it applied for a MiCA licence | Published | `fees-probe.py page`, S2 |
| who may trade spot | a verified Coinmate account holder, with an API key generated in the account for API orders | Account-gated | S2, S3 |
| restricted locations | Not publicly specified in any page read. The web app's `/frontend/countries` list holds 231 countries and lacks GB, RU, BY, KP, IR, AF and MM, while US, CA, CZ, SK, DE, CN and UA are on it. Which form uses that list was not traced, so it is a hint only. | Not publicly specified | `fees-probe.py countries` |
| fee page from this host | `https://coinmate.io/fees` answered HTTP 200 with an Angular shell of 3,948 bytes, and its tier table comes from `GET /frontend/fees/fee-zones` | Probed | `fees-probe.py page`, `fees-probe.py zones` |
| public API from this host | every public call answered HTTP 200 through Cloudflare's Vancouver edge | Probed | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, all 15 pairs | 0.40 %, 4,000 ppm | 0.60 %, 6,000 ppm | Published | `fees-probe.py zones`, tier 0 |

The tier applies to every pair alike, since no zone names a pair.
CCXT 4.5.68 reports the same 0.006 taker for every Coinmate market, see section 8.
Two other numbers disagree and are stale.
The English FAQ string says "Trading fees range from 0.07% to 0.35%, depending on the type and volume of the transaction", which matches no row of the live table, `fees-probe.py page`.
The Apiary example reply for `POST /traderFees` shows maker 0.12 and taker 0.25, an example from 2018 and not a schedule, S3.
CoinMarketCap's record carries `makerFee` 0.0 and `takerFee` 0.0, its placeholder for an unknown fee, `fees-probe.py coverage`.
A Coinmate spot taker at 6,000 ppm costs twelve times Gate's 500 ppm perpetual taker, see [`../gate/fees.md`](../gate/fees.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | no futures, perpetual, margin or funding path in the Apiary document, S3, and `/api/futures/tradingPairs` and `/api/perpetual/tradingPairs` answer 404, [`rest.md`](./rest.md) section 3 |
| coin-margined perpetuals | no | same |
| dated futures | no | same, and CCXT sets `swap`, `future` and `margin` false, S4 line 27 to 31 |
| options | no | same, S4 line 31 |
| spot order book | yes, 15 pairs, all `TRADING` | [`rest.md`](./rest.md) section 2 |
| quick trade | yes, settled without a fee but at a quoted rate that includes a spread, not detailed | `fees-probe.py page` FAQ string |
| earn | yes, a monthly yield in EUR, not detailed | S2 |
| deposits and withdrawals | yes, per method fees on `GET /frontend/fees`, not detailed | S1 |

Three outside checks agree that Coinmate has no perpetuals.
CoinMarketCap's exchange record shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 against a spot volume of about 1.55 million USD, and its pair lists hold 15 spot pairs, 0 perpetual pairs and 0 futures pairs, S5.
CoinGecko's derivatives venue list holds 216 venues and none named Coinmate, S6.

## 4. Spot tiers

The tier table is `GET https://coinmate.io/frontend/fees/fee-zones`, eight rows of `makerFeeValue`, `takerFeeValue` in percent, and `tradingVolume`, S1.
The web app picks the first zone whose `tradingVolume` is greater than the user's volume, so `tradingVolume` is the exclusive upper bound of each band, S1 and the `findUserFeeZoneIndex` function of the app bundle.
The volume is "cumulative trading volume over 30 days", "updated once an hour", "calculated from trades made in the last 30 days across all trading pairs", with each trade converted to EUR at the time of the trade, S2.

| tier | 30 day volume, EUR | maker | taker | maker ppm | taker ppm |
|---|---|---|---|---|---|
| 0 | below 10,000 | 0.40 % | 0.60 % | 4,000 | 6,000 |
| 1 | 10,000 to below 100,000 | 0.20 % | 0.30 % | 2,000 | 3,000 |
| 2 | 100,000 to below 250,000 | 0.12 % | 0.23 % | 1,200 | 2,300 |
| 3 | 250,000 to below 500,000 | 0.09 % | 0.21 % | 900 | 2,100 |
| 4 | 500,000 to below 1,000,000 | 0.05 % | 0.18 % | 500 | 1,800 |
| 5 | 1,000,000 to below 3,000,000 | 0.03 % | 0.15 % | 300 | 1,500 |
| 6 | 3,000,000 to below 15,000,000 | 0.02 % | 0.12 % | 200 | 1,200 |
| 7 | 15,000,000 and above | -0.04 % | 0.10 % | -400 | 1,000 |

Tier 7's maker is a rebate.
Every row has `applyMakerReferral` and `applyTakerReferral` true.
The page's strings include "No referral commission is paid out on this fee", which reads as the label for a row where a flag is false, so the flags likely decide whether a referrer earns a share and not what the trader pays, S2.
An account's own rate comes from the signed `POST /traderFees`, which answered `{"error":true,"errorMessage":"Invalid request","data":null}` with HTTP 200 to an unsigned call, `fees-probe.py private`.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | section 4 | Published | S1 |
| maker rebates | -0.04 % at tier 7 only | Published | S1 |
| token holding | none seen in the fee table or the API document | Not publicly specified | S1, S3 |
| referral | a fixed reward for inviting a friend. The strings also hold a notice that the campaign "has been temporarily suspended", and whether that notice shows today was not checked. It does not lower the taker. | Published | S2 |
| zero fee promotions | none seen | Not publicly specified | |
| quick trade | no fee, but a quoted rate with a spread, so not comparable to the book taker | Published | S2 |

## 6. Funding as a cost

Not offered.
Coinmate lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged product, so there is no liquidation or settlement charge.
The site names MiCA delistings, for example io.net, and a manual withdrawal of a currency whose automatic transfers are off costs 20 EUR, S2.
No delisting charge on open orders is published.

## 8. CCXT

CCXT 4.5.68 has a `coinmate` class at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/coinmate.js`, S4.

- `has` sets `spot` true and `margin`, `swap`, `future` and `option` false, lines 27 to 31.
- `fees.trading` sets `tierBased` true, `percentage` true, `taker` 0.006 and `maker` 0.004, lines 206 to 211.
- The `tiers` arrays hold the same eight bands as section 4, keyed by their lower bound, lines 212 to 233.
- `fetchMarkets` builds every market with `type` `spot` and leaves `active`, `linear` and `contractSize` undefined, lines 360 to 442.
- `setMarkets` in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/base/Exchange.js` line 3735 copies `fees.trading` into every market.
- There is no `js/src/pro/coinmate.js`, so CCXT Pro has no Coinmate socket class.

So `market.taker` is 0.006 for every market without credentials.
`ccxt-probe.py` loaded the 15 markets through the Python class of the same release and read `taker` 0.006 and `maker` 0.004 on each.
The constant matches the live tier 0 taker.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and Coinmate has no perpetual.
It cannot enter the registry as a perpetual leg.
If a later design adds spot legs, `takerPpm` would be 6,000 and `ccxtTakerPpm` would be 6,000, citing line 210 of the CCXT class.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://coinmate.io/frontend/fees/fee-zones` and `https://coinmate.io/frontend/fees`, the JSON behind `https://coinmate.io/fees` | the eight tiers, the referral flags, per method deposit and withdrawal fees |
| S2 | `https://coinmate.io/assets/i18n/en.json`, the English strings of the web app | the 30 day EUR volume rule, the hourly update, the FAQ fee range, the operator and address, the CNB and MiCA lines, the referral suspension, the 20 EUR manual withdrawal |
| S3 | `https://coinmate.docs.apiary.io/`, read as JSON from `https://jsapi.apiary.io/apis/coinmate/blueprint`, last updated 2026-03-09 | public and private paths, the `traderFees` example, the 100 requests per minute rule, the WebSocket section |
| S4 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/coinmate.js` | the CCXT class, lines cited in section 8 |
| S5 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinmate` and `.../exchange/market-pairs/latest?slug=coinmate` with `category` `spot`, `perpetual` and `futures` | id 80, fee fields 0.0, spot volume, 15 spot pairs, 0 perpetual and 0 futures pairs |
| S6 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` | 216 derivatives venues, no Coinmate |
