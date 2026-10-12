# Bittylicious Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:40 to 04:56 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Bittylicious lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That spot market is a broker marketplace and not an order book.
A customer buys or sells a coin for GBP or EUR at a total price that one of the brokers operating on Bittylicious quotes, and that price "includes all fees", S1, S2.
No fee percentage is published, and the help wiki that held the fee article is broken, see section 1.
Its public API has a quote call, a cached ticker and no book or socket, see [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/bittylicious/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | Bittylicious (Isle of Man) Limited, company 134003C, The Chapel, Nursery Avenue, Onchan, IM3 4HG, Isle of Man. It is registered with the Isle of Man Financial Services Authority as a Designated Business. | Published | S1, S2 |
| launched | 2013-05-22 according to CoinMarketCap | Published | S4 |
| business model | "a fiat-for-cryptocurrency and cryptocurrency-for-fiat service", where trades are made with "brokers who operate on Bittylicious" | Published | S2 |
| who may trade | a registered account holder who passes the payment method's checks. The UK bank transfer needs "an IP address in The United Kingdom" and a UK bank account with Faster Payments. The EU page asks for "an IP address in The European Union". Card payments in GBP, EUR and USD sit under a "Global" flag and need ID and proof of address. | Region-specific | S1, S2, `fees-probe.py pages` |
| excluded | residents of any jurisdiction where the service would be prohibited, "including the United States of America" | Region-specific | S2 |
| Canada | not named in the terms. From the Canadian exit every payment method on the GB, EU and Global pages carried `enabled : 0`, and the UK and EU pages showed the IP address requirement. | Probed | `fees-probe.py pages` |
| fee article | CoinMarketCap's fee link `https://help.bittylicious.com/index.php/Are_any_fees_taken_when_buying_virtual_currency%3F` answered HTTP 500, a MediaWiki "Error 1146: Table 'bittylic_wikihel.page' doesn't exist". The wiki's front page and its search API answered the same. | Probed | `fees-probe.py pages` |
| archive | the Wayback Machine's availability call returned no snapshot for the API page or the fee article | Probed | `fees-probe.py pages` |
| public API from this host | the quote call and the ticker answered HTTP 200 behind Cloudflare | Probed | [`rest.md`](./rest.md) section 1 |

No refusal or geoblock was met on any public page or API call from the Canadian exit.
The IP address requirement applies to making a purchase, and it was not tested, because that needs an account.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot buy and sell of BTC, ETH, LTC and DOGE against GBP or EUR | no maker side exists | Not publicly specified, folded into an all-in broker price | Not publicly specified | S1, S3 |

The buy page says "The price shown under Total cost includes all fees", S1.
Each payment method block carries `fixedFee : 0.00000000`, and each quote reply carries `"fixedPortion":"0.00"`, so no separate fixed fee is charged on top, S1, [`rest.md`](./rest.md) section 5.
The cost of a trade is therefore the distance between the broker's price and the market.
`fees-probe.py markup` set the quotes beside Kraken's public XBTGBP and ETHGBP books, S7, once at 04:48 UTC and once at 04:53 UTC.

| quote | Bittylicious unit price, run 1 and run 2 | against the Kraken mid, run 1 and run 2 |
|---|---|---|
| buy 1 BTC by UK bank transfer | 64,857.18 and 64,852.47 GBP | +39,061 and +38,756 ppm |
| buy 0.01 BTC by UK bank transfer | 65,009.78 and 65,005.06 GBP | +41,505 and +41,200 ppm |
| sell 1 BTC by UK bank transfer | 59,698.13 and 59,693.79 GBP | -43,591 and -43,872 ppm |
| sell 0.01 BTC by UK bank transfer | 58,626.04 and 58,621.79 GBP | -60,767 and -61,043 ppm |
| buy 1 ETH by UK bank transfer | 1,963.24 and 1,962.88 GBP | +42,375 and +41,971 ppm |
| sell ETH by UK bank transfer | "Sorry, we cannot match your coin request with a broker." in both runs | |

The Kraken mid was 62,419.05 and 62,432.85 GBP for BTC, and 1,883.43 and 1,883.82 GBP for ETH, in the two runs.
A 1 BTC buy then sell costs about 82,650 and 82,630 ppm of the mid, which is the round trip a customer pays.
The buy leg alone is about 78 times Gate's 500 ppm perpetual taker, see [`../gate/fees.md`](../gate/fees.md) section 2.
Smaller orders pay more per unit, as the 0.01 BTC rows show.
CoinMarketCap's exchange record carries `makerFee` 0.0 and `takerFee` 0.0, which is its placeholder for an unknown fee and not a zero fee, S4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | the terms limit the service to fiat for crypto and crypto for fiat, S2 |
| coin-margined perpetuals | no | same |
| dated futures | no | same |
| options | no | same |
| spot order book | no, each trade is matched to one broker's all-in price | S2, [`rest.md`](./rest.md) section 5 |
| spot broker buy | yes, BTC, ETH, LTC and DOGE against GBP by UK bank transfer, and BTC against GBP and EUR by card, with a USD card price on the Global page | S1, [`rest.md`](./rest.md) section 5 |
| spot broker sell | yes for BTC against GBP. ETH sell found no broker during the probe. | [`rest.md`](./rest.md) section 5 |
| deposits and withdrawals | not detailed. The home page promises "Bitcoins sent to you as soon as we see the payment", and no deposit or withdrawal schedule was seen. | S1 |

Five more checks agree that Bittylicious has no perpetuals.
The terms contain no "futures", "leverage", "margin" or "derivative", and their one "commission" is the UK Information Commissioner, S2.
CoinMarketCap's exchange record shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 against a spot volume of about 21,055 USD, and its market pair lists hold 5 spot pairs, BTC/GBP, LTC/GBP, DOGE/GBP, ETH/GBP and BTC/EUR, and no perpetual or futures pair, S4.
CoinMarketCap's derivatives ranking with `exType=2` lists 104 venues and not Bittylicious, S4.
CoinGecko's derivatives list holds 216 venues and not Bittylicious, and its list of 1,503 exchanges has no Bittylicious row at all, S5.
The site's one script bundle names eight `/api/v1/` paths, and none of them is a market, book or derivative path, S8.

## 4. Spot tiers

None published.
The price is a broker's quote per coin, side and payment method, and the only tiering seen is that smaller orders get a worse unit price, see section 2.
Each quote carries a minimum and a maximum amount, for example about 0.00075 to 1.69861929 BTC for a UK bank transfer buy, S1.
A buy below the minimum is refused with "Please purchase a minimum of 50.00 GBP.", see [`rest.md`](./rest.md) section 5.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | none published | Not publicly specified | S1, S2 |
| token holding | no exchange token seen | Not publicly specified | S1 |
| referral | Not publicly specified | Not publicly specified | |
| market maker | the brokers are the price makers, and the terms to become one are not public | Not publicly specified | S2 |
| zero fee promotions | none seen | Not publicly specified | S1 |

## 6. Funding as a cost

Not offered.
Bittylicious lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged product, so there is no liquidation or settlement charge.
The terms say a trade "can only be cancelled if no funds, neither fiat nor cryptocurrency, have been sent by either party", S2.
A delisting charge is Not publicly specified.

## 8. CCXT

CCXT 4.5.68 has no Bittylicious class.
There is no `bittylicious.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, which holds 104 classes, and the `exchanges` map that opens at line 232 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` has no line containing "bitty".
The current CCXT source agrees, S6.
`exchanges.json` on the `master` branch, at head commit `f0aca06` of 2026-10-08, lists 103 ids and none containing "bitty".
`ts/src/bittylicious.ts` and `js/src/bittylicious.js` on `master` answer HTTP 404.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, a book feed and an anchor, and Bittylicious has no perpetual, no CCXT class, no order book and no socket.
It cannot enter the registry as a perpetual leg.
If a later design ever priced a broker quote as a spot leg, there would be no `takerPpm` to set, because the cost is inside the quote, and no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://bittylicious.com/`, reached through `/country/GB`, `/country/EU` and `/country/**` | the payment method blocks with price, limits, `fixedFee` and `enabled`, "The price shown under Total cost includes all fees", the UK and EU IP address requirement, the operator footer |
| S2 | `https://bittylicious.com/terms/GENERAL` | operator, company number and regulator, the fiat for crypto scope, the brokers, the United States exclusion, the cancellation rule |
| S3 | `https://help.bittylicious.com/index.php/Are_any_fees_taken_when_buying_virtual_currency%3F`, the help wiki front page and its search API | HTTP 500 with a missing database table, so no fee article could be read |
| S4 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bittylicious`, `.../exchange/market-pairs/latest?slug=bittylicious` with `category=spot`, `perpetual` and `futures`, and `.../exchange/listing?exType=2` | id 34, launched 2013-05-22, fee fields 0.0, the fee link of S3, spot volume about 21,055 USD, 5 spot pairs, 0 perpetual and 0 futures pairs, 104 derivatives venues without Bittylicious |
| S5 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` and `https://api.coingecko.com/api/v3/exchanges/list` | 216 derivatives venues and 1,503 exchanges, no Bittylicious in either |
| S6 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json`, the two class paths on `master`, and `https://api.github.com/repos/ccxt/ccxt/commits?per_page=1&sha=master` | 103 CCXT ids without Bittylicious, two 404s, head commit `f0aca06` of 2026-10-08 |
| S7 | `https://api.kraken.com/0/public/Ticker?pair=XBTGBP,ETHGBP` | the reference mid for the markup in section 2 |
| S8 | `https://bittylicious.com/dist/js/bundle-user.js` | the quote and quoteFiat path shapes, and the eight `/api/v1/` paths the site calls, see [`websocket.md`](./websocket.md) section 1 |
