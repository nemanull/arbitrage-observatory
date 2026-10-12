# ChangeNOW Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 04:10 to 04:20 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada (`ipinfo.io` reports AS212238 Datacamp Limited).

ChangeNOW lists no perpetuals, so this profile covers its spot conversion service, as change 1 of the survey plan's template asks.
ChangeNOW is an instant swap service, not an order book exchange.
A user sends one coin and receives another at a quoted rate, and ChangeNOW routes the trade through its liquidity providers.
It publishes no maker or taker rate, because its terms fold its remuneration into the quoted rate, S1.
So the spot VIP 0 taker is unknown as a published number.
The all-in cost the keyless quote implies was measured instead, in section 2.
Every probed fact below comes from [`fees-probe.py`](../../../scripts/probes/venues/changenow/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/changenow/rest-probe.py).

## 1. Scope and freshness

- The site footer names CHN Group LLC, Company No. 3010 LLC 2023, with a registered address at Euro House, Richmond Hill Road, Kingstown, Saint Vincent and the Grenadines, S1.
- The terms of service, last updated 2026-09-18, say in clause 11.1 that a user may not be located in, or be a citizen or resident of, the United Kingdom, the United States or India, may not be located in or resident of Russia, and may not be in a country under United Nations sanctions, S1.
- The same clause lets a person in the United States use the service after creating an account under the ChangeNOW Pro terms, S1.
- Clause 3.2 makes KYC mandatory before use for residents of the European Union, the United States, Japan, South Korea, Singapore, Hong Kong, the United Arab Emirates, Australia and Canada, S1.
- Clause 11.6 lets ChangeNOW deny access to an IP address allocated in a prohibited jurisdiction, S1.
  Canada is not prohibited, and no call from the Canadian exit was refused, see [`rest.md`](./rest.md) section 1.
- CoinMarketCap lists ChangeNOW as exchange id 9108, slug `changenow`, status `active`, launch date 2015-12-31, with empty `countries` and `fiats` fields, S2.
- CoinGecko's exchange list has an entry with id `changenow`, S3.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| perpetuals | Not offered | Not offered | section 3 |
| spot conversion, no account | Not offered, there is no order book to make on | Not publicly specified, folded into the quoted rate | terms clause 5.4 and the fee FAQ, S1 |

Terms clause 5.4 reads "The ChangeNOW's interest (the ChangeNOW's remuneration for the using of its services and the Website) is included in the final rate of the User's change transactions", S1.
The fee FAQ that CoinMarketCap links lists the deposit network fee, the network fee to the liquidity provider, "trading fees that our liquidity providers charge" and the payout network fee, and says ChangeNOW calculates them "and include them in the estimate", S1.
The trade page says "All fees are already included in the rate you see", S1.
CoinMarketCap's record carries `makerFee` 0.0 and `takerFee` 0.0, S2.
That is CoinMarketCap's field, not a statement by the venue, so it is not written as the venue's fee.

### Probed all-in cost of the keyless quote

The probe read `GET /v1/exchange-amount/<amount>/<from>_<to>` for BTC and ETH against USDT on Tron, `usdttrc20`, in both directions, and the best bid and ask of Coinbase Exchange and Kraken in the same second, S4.
The cost is `1 - (USDT out / coin in) / best bid` for a sale and `(USDT in / coin out) / best ask - 1` for a purchase.
It includes ChangeNOW's margin, the liquidity providers' fees and both network fees, so it is a cost to a user, not a taker rate.

| size | sell cost against Coinbase, ppm | buy cost against Coinbase, ppm |
|---|---|---|
| 0.01 BTC, about 830 USDT | 14,696 to 15,288 | 14,080 to 14,342 |
| 0.1 BTC | 12,209 to 12,588 | 11,940 to 12,271 |
| 1 BTC | 11,555 to 11,953 | 11,270 to 11,628 |
| 0.3 ETH, about 750 USDT | 16,335 to 16,783 | 15,854 to 16,221 |
| 3 ETH | 13,688 to 14,135 | 13,186 to 13,552 |
| 30 ETH | 13,124 to 13,635 | 12,728 to 13,024 |

The ranges span two runs of three rounds each, about 15 s apart, at 04:12:37 to 04:13:12 and 04:17:08 to 04:17:44 UTC, S4.
Against Kraken the same quotes cost within 273 ppm of the Coinbase figures, S4.
The cost falls with size, which fits a fixed network fee inside a percentage margin, and it levels off near 1.15 % for BTC and 1.3 % for ETH.
In the first run the sale quotes for 0.1 and 1 BTC and for every ETH size were identical in all three rounds, while the Coinbase bid moved by up to 130 ppm, S4.
In the second run the same sale quotes held for two rounds and changed in the third, S4.
So the quoted rate moves in steps tens of seconds apart, not with every trade on the reference books.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | Not offered | CoinMarketCap's market pairs call returns `numMarketPairs` 0 for category `perpetual`, and its quote reports `perpetualVolume24h` 0, S2 |
| coin-margined perpetuals | Not offered | same |
| dated futures | Not offered | `numMarketPairs` 0 for category `futures`, `futuresVolume24h` 0, S2 |
| options | Not offered | no source names them |
| spot | present as an instant conversion service, with no order book | 1,271 active currencies and 854,929 convertible pairs in the API, see [`rest.md`](./rest.md) section 2 |

The site menu lists "Perpetuals" with a "soon" badge under "Advanced tools", and the item links to `/registration`, S1.
So perpetuals are announced but not live on 2026-10-10.
The menu also lists "Prediction Markets" and a "Trade" page for ChangeNOW Pro, which offers market, limit and fixed orders against the user's own balance after login, S1.
Neither shows a public order book.

ChangeNOW is absent from CoinMarketCap's derivatives ranking, read with `exType=2`, which has 104 rows, S2.
It sits at position 172 of the 232 rows of the default ranking, read with `exType=1`, S2.
CoinMarketCap lists 504 spot pairs for it, and every row on the first page of 100 links to `https://changenow.io/currencies/` with a referral id, S2.
Those are swap routes, not order book markets.

## 4. Spot tiers

There is no maker and taker tier table.
The nearest thing is the ChangeNOW Pro loyalty program, S1.

| level | price | cashback on each exchange | monthly cashback cap |
|---|---|---|---|
| VIP | 0 USD a month | 0.1 % | 1,000 NOW |
| Emerald | 15 USD a month | 0.1 % | 30,000 NOW |
| Brilliant | 100 USD a month | 0.2 % | 50,000 NOW |

Cashback is paid in the NOW token, and passing KYC raises the VIP cap to 5,000 NOW, S1.

## 5. Discounts that change the spot taker

- Pro cashback of 0.1 % to 0.2 %, as tabled in section 4, S1.
- API partners earn a commission that the API page says starts "from 0.4% or higher" and can be customised per asset or pair, S1.
  That is a share of the margin paid to the partner, which suggests the margin inside each quote is at least that large.

No source ties a discount to holding the NOW token beyond the cashback program.

## 6. Funding as a cost

Not offered, since the venue lists no perpetuals.

## 7. Liquidation, settlement and delisting charges

Not offered for derivatives.
Network fees for deposits and payouts are folded into the quote, as section 2 says.
Terms clause 5.6 warns that a deposit sent more than 30 minutes after the exchange was created, or of a different amount, can change the network fee, S1.

## 8. CCXT

CCXT 4.5.68 has no ChangeNOW class.
The installed `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` imports `cex` and then `coinbase` at lines 80 and 81, and its `exchanges` map holds `'cex'` and `'coinbase'` at lines 269 and 270, with no class between them where `changenow` would sort, S5.
The folder `js/src/` holds 104 class files, and none of them contains the string `changenow`, S5.
That file's `version` constant at line 42 reads `4.5.67`, while the package's `package.json` reads `4.5.68`, S5.
The current CCXT source on GitHub has no class either: `ts/src` at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` has 110 entries, and the only one containing `change` or `now` is `coinbaseexchange.ts`, S6.
So there is no `market.taker` to report.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | none | the venue publishes no taker, and the 11,270 to 16,783 ppm measured in section 2 is an all-in conversion cost, not a fee on a book |
| `ccxtTakerPpm` | none | no CCXT class exists |

The venue should not be added to the registry.
It has no perpetuals and no order book, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | `https://changenow.io/faq/what-fees-are-there-during-an-exchange`, `/pro`, `/api`, `/crypto-trading` and `/terms-of-use/changenow-terms`, read by [`fees-probe.py`](../../../scripts/probes/venues/changenow/fees-probe.py) | 2026-10-10 UTC | entity, prohibited jurisdictions, KYC rule, fee statements, menu, Pro levels, partner commission |
| S2 | CoinMarketCap data API, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=changenow`, `/exchange/listing?exType=1` and `exType=2`, and `/exchange/market-pairs/latest?slug=changenow&category=<spot, perpetual, futures>`, read by [`rest-probe.py`](../../../scripts/probes/venues/changenow/rest-probe.py) | 2026-10-10 UTC | listing, fee fields, volumes, pair counts, rankings |
| S3 | `https://api.coingecko.com/api/v3/exchanges/list`, read by [`rest-probe.py`](../../../scripts/probes/venues/changenow/rest-probe.py) | 2026-10-10 UTC | CoinGecko entry |
| S4 | `https://api.changenow.io/v1/exchange-amount/...`, `https://api.exchange.coinbase.com/products/<BTC-USDT, ETH-USDT>/book?level=1` and `https://api.kraken.com/0/public/Ticker?pair=<XBTUSDT, ETHUSDT>`, read by [`fees-probe.py`](../../../scripts/probes/venues/changenow/fees-probe.py) | 2026-10-10 UTC | all-in cost of the quote |
| S5 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js`, `js/src/` and `package.json`, CCXT 4.5.68 | 2026-10-09 | no class |
| S6 | `https://api.github.com/repos/ccxt/ccxt/commits/master`, then the trees of `ts` and `ts/src`, read by [`rest-probe.py`](../../../scripts/probes/venues/changenow/rest-probe.py) | 2026-10-10 UTC | no class on master |
