# AIA Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers AIA Exchange, CoinMarketCap exchange id 10992 and rank 146, which trades as "AI Analysis" at `aianalysisexchange.com` and has no CCXT class.
The domain `aiaexchange.com` belongs to someone else and is parked for sale, see [`rest.md`](./rest.md) section 1.
The live site's own catalog lists 23 online USDT-margined perpetuals, so the researched product is its perpetuals, per design decision 3.
AIA publishes no fee page and no fee schedule that this research could find.
Every fee number below is a field of the venue's public catalog reply, and no document says what each field means.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/aia/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/aia/rest-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | "AI Analysis", the name in the site's meta description and in its bundle's tenant config | Probed | P2 section 3 |
| platform | a white-label exchange bundle whose strings carry the prefix `hyp_tiny_saas_`, a bundle that also holds app download links for BiKing, SunX, Sunbit, Fetex, Miracle and OSLBW, see [`../biking/fees.md`](../biking/fees.md) | Probed | P2 section 3 |
| legal entities | Not publicly specified. CoinMarketCap lists the country as `VC`, Saint Vincent and the Grenadines. | Not publicly specified | S1 |
| launch | CoinMarketCap gives 2024-01-14 | Published | S1 |
| who may trade the perpetuals | Not publicly specified. The site is a single page app, and no terms or restricted region list was found in its public calls. | Not publicly specified | P2 section 3 |
| website from this host | HTTP 200 for the page and the public REST calls, with no challenge | Probed | [`rest.md`](./rest.md) section 1 |
| market data socket from this host | HTTP 403 from the CDN's access control on every handshake | Probed | [`websocket.md`](./websocket.md) section 1 |

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-margined perpetuals, all 23 online | 0.04 %, 400 ppm | 0.04 %, 400 ppm | Probed, the catalog fields `makerFee` and `takerFee` | P1 section 1 |

The same catalog rows carry two more cost fields that may be what a trade is actually charged.

| field | values on the 23 online perpetuals | meaning |
|---|---|---|
| `commissionRate` | 0.00075, 750 ppm, on 17 symbols, and 0.0008, 800 ppm, on the six 4 hour symbols | Not publicly specified |
| `openSpread` and `closeSpread` | 0.0003, 300 ppm, on 10 symbols, and 0.0005, 500 ppm, on 13 | the bundle widens the shown entry price by `openSpread` for its CFD order type, and not for its perpetual contract type, S4 |

The bundle never reads `takerFee`, `makerFee` or `commissionRate`, P2 section 3, so the page does not show which of them a fill pays.
CoinMarketCap's exchange detail gives `makerFee` 0 and `takerFee` 0, which reads as unset rather than as a zero fee, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes, 73 catalog rows, 23 `online` and 50 `offline` | P1 section 1, [`rest.md`](./rest.md) section 2 |
| coin-margined perpetuals | absent, every row has quote `usdt` and margin currency USDT | P2 section 4 |
| commodity perpetuals | `xauusdt` and `xagusdt`, Gold and Silver, both `offline` | P2 section 4 |
| dated futures | absent from the public catalog. The `/v1/asset/public/biz-currencies` reply has a `delivery` group, but the bundle names no public delivery instrument call. | P2 section 7 |
| options | absent, `/v1/cfd/public/option/instruments` returns an empty list | P2 section 7 |
| spot | yes, 20 USDT pairs from `/v1/cfd/public/spot_instruments`, the same 20 that CoinMarketCap lists | P1 section 2, S2 |

CoinMarketCap lists no AIA perpetual or futures pair, S2.
It marks all 20 AIA spot pairs `priceExcluded` and `volumeExcluded`, so it uses neither their prices nor their volumes, S2 and P1 section 3.
So the perpetual market is visible only on the venue's own site.

## 4. Perpetual tiers

No tier table is published.
CoinMarketCap's description says fees follow "a tiered maker-taker model", with no numbers, S1.
The per symbol catalog values are the only schedule found:

| symbols | `takerFee` | `makerFee` | `commissionRate` | `openSpread` | funding hours |
|---|---|---|---|---|---|
| btcusdt, ethusdt, arbusdt, pepeusdt | 400 ppm | 400 ppm | 750 ppm | 300 ppm | 8 |
| ltcusdt, bchusdt, trxusdt, filusdt, linkusdt, xrpusdt, dogeusdt, shibusdt, adausdt, solusdt, bnbusdt, avaxusdt, uniusdt | 400 ppm | 400 ppm | 750 ppm | 500 ppm | 8 |
| xaiusdt, hypeusdt, wlfiusdt, pumpusdt, lineausdt, asterusdt | 400 ppm | 400 ppm | 800 ppm | 300 ppm | 4 |

Spot, for the coverage matrix only: 1,000 ppm maker and taker on 18 pairs, and 1,500 ppm on `aiatusdt` and `cco2usdt`, P1 section 2.

## 5. Discounts that change the perpetual taker

Not publicly specified.
The bundle has a "Fee Refund" label, P2 section 3, but no public call returns a discount or a promotion.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| interval | 8 hours on 17 symbols, 4 hours on 6, the catalog field `fundingIntervalHours` | Probed | P2 section 4 |
| rate | every online row carries `settlementRate` 0.0002, which the bundle's English strings label "Overnight Rate" | Probed, meaning Not publicly specified | P2 sections 3 and 4 |
| next settlement | the catalog's `settledAt` said 04:00 UTC and the countdown call said 08:00 UTC at the same moment | Probed | [`rest.md`](./rest.md) section 3 |
| formula, cap and floor | Not publicly specified | | |
| who pays whom | Not publicly specified | | |

The settlement instant itself was not captured, because the survey does not wait for clock events.

## 7. Liquidation, settlement and delisting

Not publicly specified.
The catalog carries `defaultStopLossRate` 0.9 and a margin table per leverage, P2 section 4, but no liquidation fee.

## 8. CCXT

CCXT 4.5.68 has no class for this venue.
The installed source folder `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 files, and none is named after AIA, AI Analysis or `aianalysis`, and no file mentions either name.
CCXT's current `master`, commit `f0aca06e` of 2026-10-08, lists 103 ids in `exchanges.json` and no `ts/src` file for this venue, S3.
So `market.taker` cannot be read, and `ccxtTakerPpm` has no source line.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 400, provisional | the catalog's `takerFee` on every online perpetual, but `commissionRate` at 750 or 800 ppm may be the real charge |
| `ccxtTakerPpm` | none | no CCXT class |

The venue cannot join the engine as it stands, see [`websocket.md`](./websocket.md) section 8, so these values are context only.
An account and one fill would settle which field is charged.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=aia-exchange`, and the page `https://coinmarketcap.com/exchanges/aia-exchange/` | 2026-10-09 |
| S2 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=aia-exchange&category=<spot, perpetual, futures>` | 2026-10-09 |
| S3 | CCXT `master` at `https://github.com/ccxt/ccxt`, `exchanges.json` and the `ts/src` folder listing at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` | 2026-10-09 |
| S4 | The live web bundle `https://aianalysisexchange.com/app.87b0b8bc.js`, the order price function that reads `openSpread` and checks the order type against `PERPETUALCONTRACT` | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/aia/fees-probe.py), run twice | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/aia/rest-probe.py), run twice | 2026-10-09 |
