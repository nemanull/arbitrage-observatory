# SWFT Trade Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 03:19 to 03:26 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada (`ipinfo.io` reports AS212238 Datacamp Limited).

SWFT Trade lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template asks.
SWFT Trade is the name CoinMarketCap gives to "SWFT Octopus Trade", an order book run by SWFT Blockchain beside its cross-chain swap service, S1.
The venue publishes no fee schedule for that order book, and its only API is a partner API that refuses every market data call without an issued channel number and key, see [`rest.md`](./rest.md) section 1.
So the spot VIP 0 taker is unknown.
Every probed fact below comes from [`fees-probe.py`](../../../scripts/probes/venues/swft-trade/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py).

## 1. Scope and freshness

- CoinMarketCap lists SWFT Trade as exchange id 945, slug `swft-octopus-trade`, status `active`, launch date 2017-08-01, with empty `countries` and `fiats` fields, S1.
- Its description says SWFT Blockchain "operates SWFT Octopus Trade a centralized exchange and exchange aggregator hybrid that allows SWFT Blockchain to place buy and sell orders at competitive rates", S1.
- The website CoinMarketCap names, `https://www.swft.pro/#/`, is a marketing page for the swap aggregator, bridge, DEX and NFT market, with no order book screen, S2.
- The SWFT TRADE API documentation says it "is for partners who have applied for the channel number channelId and private key at us", and asks partners to "Provide channel name, register account", S3.
- No legal entity, terms of service or excluded region list for the order book was found on any page this host read.
- Who may trade on the order book is Not publicly specified, beyond the partner requirement above.
- CoinGecko's exchange list, 1,503 rows, has no entry whose id or name contains `swft` or `octopus`, S4.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| perpetuals | Not offered | Not offered | section 3 |
| spot, VIP 0 | Not publicly specified | Not publicly specified | no fee page, and no fee statement in the 29 documentation pages, S3 |

CoinMarketCap's record carries `makerFee` 0.0 and `takerFee` 0.0 and an empty `fee` link list, S1.
That is CoinMarketCap's field, not a statement by the venue, and a zero there often means the field was never filled.
So it is not written as the venue's fee.
The order history calls of the TRADE API return a `tradeFee` field per order, with `eg: 0.000426` in the field table and `"tradeFee":"0"` on a cancelled order in the example, S3.
That shows fees are charged per order and reported to the partner, not what rate applies.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | Not offered | CoinMarketCap's market pairs call returns `numMarketPairs` 0 for category `perpetual`, and its quote reports `perpetualVolume24h` 0, S1 |
| coin-margined perpetuals | Not offered | same |
| dated futures | Not offered | `numMarketPairs` 0 for category `futures`, `futuresVolume24h` 0, S1 |
| options | Not offered | no source names them |
| spot | present, partner API only | 11 spot pairs on CoinMarketCap, S1, and the TRADE API's `loadPair` example lists `BTC/USDT` and `ETH/USDT`, S3 |

SWFT Trade is absent from CoinMarketCap's derivatives ranking, read with `exType=2`, which has 104 rows, S1.
It sits at position 143 of the 231 to 233 rows of the default ranking, read with `exType=1`, S1.

The 11 spot pairs CoinMarketCap lists are BTC/USDT, ETH/USDT, LTC/USDT, ETC/USDT, DOGE/USDT, WOO/USDT, SWFTC/USDT, NULS/USDT, DIS(DIS)/USDT, SWFTC/BTC and ETH/BTC, S1.
Each has an empty `marketUrl`, so no trading page on the venue backs them.

## 4. Spot tiers

Not publicly specified.
No tier table, VIP program or volume rule was found in the documentation or on either web front end, S2 and S3.

## 5. Discounts that change the spot taker

None found.
The SWFTC token is the platform token of SWFT Blockchain, S1, but no source ties a fee discount on the order book to holding it.

## 6. Funding as a cost

Not offered, since the venue lists no perpetuals.

## 7. Liquidation, settlement and delisting charges

Not offered for derivatives.
No withdrawal or delisting charge for the order book was found.

## 8. CCXT

CCXT 4.5.68 has no SWFT Trade class.
The installed `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` imports `poloniex` and then `tokocrypto` at lines 137 and 138, and its `exchanges` map holds `'poloniex'` and `'tokocrypto'` at lines 326 and 327, with no class between them, S5.
The folder `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 class files and none whose name contains `swft` or `octo`, S5.
The only `swft` strings in that folder are the `swftcbtc` market in response comments of `bittrade.js` line 846 and `htx.js` line 2644, which are HTX markets for the token, S5.
The current CCXT source on GitHub has no class either: `ts/src` at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` has 110 entries and none contains `swft` or `octo`, S6.
So there is no `market.taker` to report.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | none | the venue publishes no fee, and CoinMarketCap's 0 is not a venue statement |
| `ccxtTakerPpm` | none | no CCXT class exists |

The venue should not be added to the registry.
It has no perpetuals, and even its spot book is readable only by a partner holding an issued channel number and key, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | CoinMarketCap data API, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=swft-octopus-trade`, `/exchange/listing?exType=1` and `exType=2`, and `/exchange/market-pairs/latest?slug=swft-octopus-trade&category=<spot, perpetual, futures>`, read by [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py) and [`fees-probe.py`](../../../scripts/probes/venues/swft-trade/fees-probe.py) | 2026-10-10 UTC | listing, description, fee fields, volumes, pair lists, rankings |
| S2 | `https://www.swft.pro/` and its bundle, and `https://www.swftc.info/swft-v3/swft-v3-pc/index.html` and its scripts, read by [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/swft-trade/ws-probe.py) | 2026-10-10 UTC | the front ends hold no order book screen |
| S3 | SWFT API documentation, `https://docs-swft.en.swft.pro/llms.txt` and its 29 pages, among them `trade-api/swft-trade-interface.md`, `trade-api/search-historical-orders.md` and `trade-api/get-the-support-trade-pair.md`, read by [`fees-probe.py`](../../../scripts/probes/venues/swft-trade/fees-probe.py) | 2026-10-10 UTC | partner requirement, absence of a fee schedule, the `tradeFee` field |
| S4 | `https://api.coingecko.com/api/v3/exchanges/list`, read by [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py) | 2026-10-10 UTC | no CoinGecko entry |
| S5 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` and `js/src/`, CCXT 4.5.68 | 2026-10-09 | no class |
| S6 | `https://api.github.com/repos/ccxt/ccxt/git/trees/master`, then `ts` and `ts/src`, read by [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py) | 2026-10-10 UTC | no class on master |
