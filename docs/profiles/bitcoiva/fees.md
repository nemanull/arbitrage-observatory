# Bitcoiva Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:29 to 03:51 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers spot trading on Bitcoiva (CoinMarketCap rank 153, no CCXT id), because Bitcoiva lists no exchange perpetual, see section 3.
It follows change 1 of the template in [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), so it records the spot VIP 0 maker and taker.
Bitcoiva's fee table at `/fee` is loaded through the web app's own API, whose requests and replies are AES encrypted with a key shipped in the bundle.
That table was not read, because reading it means decrypting a private surface.
The numbers below come from the static text of the web bundle and from CoinMarketCap, both read by [`fees-probe.py`](../../../scripts/probes/venues/bitcoiva/fees-probe.py).

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| retrieval date | 2026-10-09 | | S1 to S8 |
| legal entity | not named on the site HTML or in the bundle text, and the terms page loads through the encrypted API | Not publicly specified | S1, S2 |
| who may trade | Indian users with KYC, by the site's own title "Best Crypto Exchange in India", INR deposits and the Indian TDS rules | Published | S1, S2 |
| regions excluded | none listed in the bundle text, and the P2P FAQ says P2P is "not available in other countries" except India and the UAE | Published | S2 |
| launch | 2020-06-10 by CoinMarketCap | Published | S7 |
| access from the Canadian exit | every public call answered, with no geoblock and no refusal | Probed | [`rest-probe.py`](../../../scripts/probes/venues/bitcoiva/rest-probe.py) `host`, `errors` |

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | source |
|---|---|---|---|---|
| spot, every pair | 0.20 %, 2000 ppm | 0.20 %, 2000 ppm | Published | S3 FAQ "What are the exchange trading fees?" |
| Instant Swap | under 0.20 % | under 0.20 % | Published | S3 FAQ "What is the trading fee for Instant Swap?" |

- The FAQ answer reads "Bitcoiva takes a 0.20 percent commission per trade and for buy and sell."
- The Open API documentation's order examples carry `makerFeePer: .2`, `takerFeePer: .2` and `tdsFeePer: 1`, the same 0.20 % on both sides, S4.
- The `/fee` page labels its spot columns "Buy Order Fees (%)" and "Sell Order Fees (%)", mapped to the fields `makerfee` and `takerfee`, S3.
  So the page's per pair fee is a buy fee and a sell fee, not a maker fee and a taker fee.
  Its values come from the encrypted call `fee` and were not read.
- `tdsFeePer: 1` is India's 1 % tax deducted at source on transfers of virtual digital assets, by the FAQ on Section 194S in S2.
  It is a tax withheld from an Indian seller, not an exchange fee.
- CoinMarketCap's record carries `makerFee` 0 and `takerFee` 0, which are unfilled fields rather than a published zero fee, S7.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| exchange perpetuals with a public book | no | CoinMarketCap lists 0 perpetual and 0 futures pairs and a perpetual volume of 0, S8 and S7, and the Open API documents spot calls only, S4 |
| "Futures Trade" | yes, as a cTrader account | the `/futuretrade` page opens Demo and Live cTrader trading accounts, funded by a "USDT to USD" transfer, S5 |
| dated futures | no | CoinMarketCap futures category 0 pairs, S8 |
| options | no | no route, call or text in the bundle, S2 |
| spot | yes, 221 pairs on the Open API | [`rest.md`](./rest.md) section 2 |
| copy trading | yes, for the cTrader futures accounts | the `copytrade/futures` route and `GetCopierFuturesHistory` call, S2 |
| Instant Swap, P2P and OTC | yes | routes and FAQ in S2 |

The "Futures Trade" product is a broker account on the cTrader platform, not an exchange order book.
The bundle's ten `ctrader/...` calls create a trading account, move funds into it and redirect the user to cTrader, S2.
The futures page reads `ctraderTraderLogin`, `ctradeDatas`, `usedMargin`, `moneyDigits` and `PAMMStatus` from the account, S5.
Its fee tab "Bitcoiva Futures Fee" prices pairs "(Per Lot)" or "(Per Trade Volume)", which is how a CFD broker charges, S3.
The pair list behind that tab comes from the GET call `ctrader/viewbitcoivafuturepairs`, which answers without a login but with an encrypted payload, [`rest-probe.py`](../../../scripts/probes/venues/bitcoiva/rest-probe.py) `errors`.
No public book, index, mark or funding feed exists for it, so it is not a perpetual leg in the engine's sense.

## 4. Spot tiers

No tier schedule is published in the bundle text.
The FAQ gives one flat 0.20 % for buy and sell, S3.
Whether the encrypted per pair table at `/fee` differs by pair is Not publicly specified.

## 5. Discounts that change the spot taker

No token discount, referral rebate, market maker program or zero fee promotion appears in the fee page text, S3.
Bitcoiva issues its own token BCA, by CoinMarketCap's description, S7, and no BCA fee discount is stated in the bundle text.

## 6. Funding as a cost

Not offered, because Bitcoiva lists no exchange perpetual, section 3.

## 7. Liquidation, settlement and delisting

Not offered for spot.
The bundle has a `/delistings` route, whose content loads through the encrypted API, S2.
Deposit and withdrawal fees are on the `/fee` page tabs, and the FAQ names 10 INR per deposit transaction and 10 INR per withdrawal transaction, S3.

## 8. CCXT

- CCXT 4.5.68 has no Bitcoiva class.
  `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds no `bitcoiva.js`, and a case-insensitive search for "bitcoiva" over that folder matched no file, S9.
- The current CCXT source on GitHub has none either, S10.
  The master branch was at version 4.5.85 on 2026-10-09, its `ts/src/` listing has no Bitcoiva file, and `ts/src/bitcoiva.ts` returned 404.
- So `market.taker` has no CCXT value to compare.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 2000 | the published flat spot fee of 0.20 %, S3 and S4 |
| `ccxtTakerPpm` | none | no CCXT class, section 8 |

Bitcoiva is not recommended as an engine venue.
It has no perpetual, and its public spot book is Binance's book passed through, see [`rest.md`](./rest.md) section 5.
A Bitcoiva spot leg would add no price that a Binance leg does not already carry.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | site HTML, `https://www.bitcoiva.com/` | 2026-10-09 |
| S2 | web bundle `https://www.bitcoiva.com/static/js/main.e52b4f29.js` | 2026-10-09 |
| S3 | `/fee` page chunk `https://www.bitcoiva.com/static/js/3755.da3dc272.chunk.js` | 2026-10-09 |
| S4 | `/bitcoiva-apidocs` page chunk `https://www.bitcoiva.com/static/js/3259.6a9380d5.chunk.js`, "Bitcoiva Open API v3.0 Documentation" | 2026-10-09 |
| S5 | `/futuretrade` page chunk `https://www.bitcoiva.com/static/js/6699.4dcc3fda.chunk.js` | 2026-10-09 |
| S6 | `/trade/:pair` page chunk `https://www.bitcoiva.com/static/js/8731.fe8effe6.chunk.js` | 2026-10-09 |
| S7 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bitcoiva` | 2026-10-09 |
| S8 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bitcoiva&category=spot` and the same with `perpetual` and `futures` | 2026-10-09 |
| S9 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, searched for "bitcoiva" | 2026-10-09 |
| S10 | `https://github.com/ccxt/ccxt`, master `package.json` and `ts/src/` | 2026-10-09 |
