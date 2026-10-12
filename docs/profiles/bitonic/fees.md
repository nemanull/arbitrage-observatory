# Bitonic Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:40 to 04:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers Bitonic, the Dutch bitcoin broker at `bitonic.nl`, which CCXT does not implement.
Bitonic lists no perpetuals and no order book, so it is profiled on its spot product, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Its spot product is one pair, BTC against EUR, sold and bought by Bitonic itself at a quoted price.
Its order book exchange BL3P closed on 2024-12-20, S3.
The probes are [`fees-probe.py`](../../../scripts/probes/venues/bitonic/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/bitonic/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/bitonic/ws-probe.py).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-10-09 | |
| entity | Bitonic B.V., "Registered at the Dutch Chamber of Commerce: 58276149", in the footer of every page | S1, S2 |
| licence | a MiCAR licence from the Dutch AFM, announced on 2025-11-21, for exchange, custody, transfer and OTC order execution "in all EU member states" | S4 |
| who may trade | account holders who pass Bitonic's verification, under the MiCAR licence for the EU. The Instant flow on the website buys to and sells from a personal wallet | S2, S4 |
| excluded regions | no page read lists any. The licence covers EU member states only, and payment rails are iDEAL, Wero, Bancontact and SEPA | S2, S4 |
| product | BTC against EUR only, bought from and sold to Bitonic. Bitonic calls itself "bitcoin-only" | S1, S4 |
| BL3P | the order book exchange Bitonic ran from 2014 closed on 2024-12-20, and its site went offline on 2026-05-04. `bl3p.eu` now answers 302 to `bitonic.nl/bl3p`, which answers 302 to that news item | S3, P1 |
| CoinMarketCap standing | rank 220 in the survey list. The CoinMarketCap API on 2026-10-10 gives status `active`, one pair `BTC/EUR` with `priceExcluded` 1 and `volumeExcluded` 1, a stale description of BL3P with "a fixed fee of 0,25% for both limit and market orders", and a fee link to `bitonic.nl/en/bl3p` | S5, S6, P2 |

CoinMarketCap's `volumeBase` for the pair, 4.97061987 in both runs, is the `volume` field of Bitonic's `/api/price` to the last digit, P1 and P2.
Its `quote`, 73,249.97 in the first run and 73,244.55 in the second, sat within a few euros of that call's `price` in the same minutes.
So the listing reads `/api/price`, and it does not describe an exchange book.
The access results in every file of this profile are what the Canadian VPN exit received.
Nothing was refused from that exit, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| perpetuals | absent | absent | section 3 |
| spot, account trading, base tier | Not offered, there is no book to rest an order on | 1.0 % buy and 1.0 % sell, 10,000 ppm | S2, P2 |
| spot, Instant flow from the website | Not offered | service charge 0.99 % on a buy and 1.24 % on a sell, plus fixed payment and network charges, all inside the quoted price | S2, P2 |

Every trade is against Bitonic at its own quote, so every trade pays the taker side of the schedule.
The pricing page says "Depending on the trading volume, Bitonic may reduce the fees for specific accounts", S2.
So 10,000 ppm is the base account fee, and lower rates are negotiated, not published.

The probe measured the Instant markup by reading `/api/prices/v1/last-price` and then `/api/buy` and `/api/sell` for 1 BTC, 7 s apart, P2.
The first run gave a buy markup of 0.969 % and a sell markdown of 1.200 % against the last price, and the second pass gave 0.964 % and 1.201 %.
Both sit close to the published 0.99 % and 1.24 %.
Part of each figure is price movement in the 7 s between calls.
A round trip at the Instant quotes for 1 BTC cost 2.479 % in the first run and 2.474 % in the second, buy price over sell price.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | the API page names three price calls and no derivative, and the words futures, perpetual, funding and leverage do not appear on it, P1 |
| USDC-M perpetuals | absent | same |
| coin-M perpetuals | absent | same |
| dated futures | absent | same, and the products in the site menu are Buy and Sell, Auto Invest, OTC and Business, S1 |
| options | absent | same |
| spot | present, as a broker | BTC against EUR at Bitonic's buy and sell quotes, with no order book, S1 and P1 |

The CoinMarketCap API shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 for Bitonic, P2.
The web app's "target orders" calls, `/api/target-orders/v1/add` and friends in the trade bundle, are account side price triggers against Bitonic's quote, not orders on a public book, S8.

## 4. Spot tiers

| tier | rule | buy | sell | source |
|---|---|---|---|---|
| account trading, base | any verified account | 1.0 % | 1.0 % | S2 |
| account trading, reduced | "Depending on the trading volume, Bitonic may reduce the fees for specific accounts" | Negotiated | Negotiated | S2 |
| Instant, website to own wallet | any buyer or seller on the website | 0.99 % service charge, plus EUR 0.51 for iDEAL or Wero or EUR 0.61 plus 0.23 % for Bancontact, plus a dynamic network fee | 1.24 % service charge, plus EUR 0.25 SEPA costs and a dynamic network fee | S2 |
| Auto Invest | recurring purchases | 0 % up to EUR 250 a month, 0.89 % above it, plus EUR 0.15 SEPA costs | not offered | S2 |
| OTC desk, from EUR 200,000 | per trade amount | 0.9 % | 0.9 % | S2 |
| OTC, from EUR 350,000 | | 0.8 % | 0.8 % | S2 |
| OTC, from EUR 500,000 | | 0.7 % | 0.7 % | S2 |
| OTC, from EUR 750,000 | | 0.6 % | 0.6 % | S2 |
| OTC, from EUR 1,000,000 | | 0.5 % | 0.5 % | S2 |
| OTC, from EUR 2,500,000 | | 0.4 % | 0.4 % | S2 |
| OTC, from EUR 5,000,000 | | 0.3 % | 0.3 % | S2 |

The page writes the OTC thresholds as "≥ 200.000" and so on, with a dot as the thousands separator and no currency sign, S2.
The probe read every value in this table from the page, P2.
The fixed iDEAL charge shows in the quotes.
A buy of EUR 100 was quoted 0.598 % above a 1 BTC buy in the first run and 0.603 % in the second, which implies EUR 0.59 to 0.60 of fixed charges on that order, P2.
That is the EUR 0.51 iDEAL charge plus part of the network fee, which the Instant price also includes, S2.

## 5. Discounts that change the spot taker

| discount | effect | source |
|---|---|---|
| referral | the banner on every page says "Earn 15% of your referral’s trading fees ... and give them a 15% discount". If the discount applies to the 1.0 % account fee, a referred account pays 0.85 %, but the banner does not say what it applies to | S1, S2, P2 |
| volume | "Bitonic may reduce the fees for specific accounts", with no published schedule | S2 |
| token holding | Not offered, Bitonic lists no token | S1 |
| zero fee promotion | Auto Invest charges 0 % on the first EUR 250 a month, with no end date given | S2 |

## 6. Funding as a cost

Not offered.
Bitonic lists no perpetual, so there is no funding rate, interval or cap, see section 3.

## 7. Liquidation, settlement and delisting charges

Not offered for liquidation or settlement, since there is no leveraged product.
Bitonic charges nothing to hold EUR or BTC balances, and EUR withdrawals are free, S2.
A BTC withdrawal pays a dynamic network fee "aimed at confirmation in the third subsequent block", S2.
Urgent EUR payments on a sale cost 0.25 % extra, at least EUR 7.50, S2.
Delisting does not apply to a venue with one pair.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` | 104 class files, none named `bitonic` or `bl3p`, P2 |
| CCXT master `exchanges.json` on 2026-10-10 | 103 ids, none matching `bitonic` or `bl3p`, S7 and P2 |
| CCXT master `ts/src/bitonic.ts` and `ts/src/bl3p.ts` | both answer 404, S7 and P2 |

So there is no `market.taker` to read, and no CCXT source line exists.

## 9. Recommended registry values

None.
Bitonic has no perpetual to register, no CCXT class for a catalog, no public book and no WebSocket, see [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).
If a spot leg were ever wanted, `takerPpm` would be 10,000, the base account trading fee, and `ccxtTakerPpm` has nothing to declare.
Such a leg would also have to model a dealer quote with a spread of its own, not a book, see [`rest.md`](./rest.md) section 5.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public API page and site menu | https://bitonic.nl/en/api | 2026-10-09 | Bitonic B.V. | the three price calls, "please don't make more than 10 requests per minute", the referral banner, the footer entity, sections 1, 3 and 5 |
| S2 | Pricing | https://bitonic.nl/en/pricing | 2026-10-09 | Bitonic B.V. | account, Instant, Auto Invest and OTC fees, volume reductions, withdrawal fees, sections 2, 4, 5 and 7 |
| S3 | BL3P permanently offline, published 2026-04-28 | https://bitonic.nl/en/news/301/bl3p-permanently-offline | 2026-10-09 | Bitonic B.V. | BL3P trading closed on 2024-12-20, site offline from 2026-05-04, section 1 |
| S4 | Bitonic receives MiCAR license, published 2025-11-21 | https://bitonic.nl/en/news/298/bitonic-receives-micar-license-from-the-dutch-authority-for-the-financial-markets | 2026-10-09 | Bitonic B.V., EU | licence scope and services, "bitcoin-only", section 1 |
| S5 | CoinMarketCap data API, exchange detail | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bitonic | 2026-10-10 UTC | CoinMarketCap | status, stale BL3P description, fee link, zero perpetual volume, sections 1 and 3 |
| S6 | CoinMarketCap data API, market pairs | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bitonic&category=spot&start=1&limit=10 | 2026-10-10 UTC | CoinMarketCap | one pair, price and volume excluded, `volumeBase` equal to `/api/price`, section 1 |
| S7 | CCXT master id list and sources | https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json | 2026-10-10 UTC | CCXT | no Bitonic or BL3P class, section 8 |
| S8 | Home page script and web app trade bundle | https://bitonic.nl/public/js/app-cedbe3b1.js and https://bitonic.nl/webapp/assets/trade-LS81wHXz.js | 2026-10-09 | Bitonic B.V. | the internal price and target order calls, section 3 |
| P1 | `rest-probe.py`, 04:40 to 04:44 UTC on 2026-10-10, rerun 04:51 to 04:55 UTC | [`rest-probe.py`](../../../scripts/probes/venues/bitonic/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | API page words, `/api/price`, BL3P redirects, sections 1 and 3 |
| P2 | `fees-probe.py`, 04:45 to 04:49 UTC on 2026-10-10, rerun 04:55 to 04:56 UTC | [`fees-probe.py`](../../../scripts/probes/venues/bitonic/fees-probe.py) | 2026-10-09 | this host, Canadian VPN exit | pricing page values, markups, the fixed iDEAL charge, CoinMarketCap fields, CCXT checks, sections 1 to 5 and 8 |
