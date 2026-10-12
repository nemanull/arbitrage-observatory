# FreiExchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:01 to 05:15 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

FreiExchange lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 170 pairs on the public ticker, 118 quoted in BTC on freiexchange.com and 52 quoted in LTC on the sister site FreiXLite, see [`rest.md`](./rest.md) section 2.
The fee page says there are no trading fees, so the VIP 0 spot taker is 0 ppm.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/freiexchange/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 US Pacific for every source row | | source ledger |
| operator | FreiExchange, launched on 2016-12-20 according to CoinMarketCap. No legal entity, address or country is named on the about page. | Not publicly specified | S3, S5 |
| restricted locations | Not publicly specified in any page read | Not publicly specified | S1, S3 |
| who may trade spot | a registered account holder. The public API has no private or trading section, so orders go through the web site only. | Account-gated | S4, [`rest.md`](./rest.md) section 1 |
| fee page from this host | `https://freiexchange.com/pages/fees` answered HTTP 200 | Probed | `fees-probe.py page` |
| sister site | FreiXLite at `https://freixlite.com` carries the LTC quoted pairs, and its fee page carries the same headline | Probed | `fees-probe.py page`, S2 |

No refusal or geoblock was met from the Canadian exit.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, BTC quoted pairs on freiexchange.com | 0 % = 0 ppm | 0 % = 0 ppm | Published | S1, the fee page headline |
| spot, LTC quoted pairs on freixlite.com | 0 % = 0 ppm | 0 % = 0 ppm | Published | S2, the same headline |

The fee page headline reads "Withdrawal fees and real-time status for all listed coins. No trading or deposit fees.", S1.
FreiXLite's fee page carries the same two sentences, S2.
The LTC_BTC market page agrees: its order form computes the total as `truncate8(amount * price)` with no fee term, and the only fee word on the page is the footer link "Fees & Coin Status", S6.
CoinMarketCap's exchange record carries `makerFee` 0.0 and `takerFee` 0.0 and links the same fee page, S5.
A zero trading fee is unusual, and no page states since when it applies or whether it is a promotion.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | the API page names only a ticker and an order book and has no futures, perpetual or funding word, and the ticker holds only BTC and LTC quoted spot pairs, S4 and [`rest.md`](./rest.md) section 2 |
| coin-margined perpetuals | no | same |
| dated futures | no | same |
| options | no | same |
| spot order book, BTC quoted | yes, 118 pairs on the ticker and 117 rows on the web market list | [`rest.md`](./rest.md) section 2 |
| spot order book, LTC quoted (FreiXLite) | yes, 52 pairs on the ticker | [`rest.md`](./rest.md) section 2 |
| deposits and withdrawals | yes, with a withdrawal fee per coin | section 7 |

Four outside checks agree that FreiExchange has no perpetuals.
CoinMarketCap's exchange record shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 against a spot volume of about 4,640 USD over 24 hours in both runs, S5.
CoinMarketCap's perpetual market pair list for the venue holds 0 pairs, against 46 spot pairs, and its derivatives ranking with `exType=2` lists 104 venues and not FreiExchange, S5 and S7.
CoinGecko's derivatives list holds 216 venues and not FreiExchange, and its list of 1,503 exchanges has no FreiExchange row at all, S8.

## 4. Spot tiers

None published.
The fee page names no tier, no volume schedule and no VIP level, S1.
Every account trades at the 0 ppm of section 2.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | none, the taker is already 0 ppm | Not offered | S1 |
| token holding | Not publicly specified | Not publicly specified | |
| referral | Not publicly specified | Not publicly specified | |
| zero fee promotion | the zero fee carries no end date and is not called a promotion | Published | S1 |

## 6. Funding as a cost

Not offered.
FreiExchange lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement, delisting and withdrawal

Not offered for liquidation and settlement, because there is no leveraged product.
A delisting charge is Not publicly specified.
Withdrawals carry a per coin fee shown as a percent, and the official lookup is the table behind the fee page, `GET /pages/fees_data`, S1.

## 8. CCXT

CCXT 4.5.68 has no FreiExchange class.
There is no `freiexchange.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, which holds 104 classes, and the `exchanges` map that runs from line 232 to line 337 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` has no line naming it.
The current CCXT source agrees: `exchanges.json` on the `master` branch lists 103 ids and none containing "frei", and `ts/src/freiexchange.ts` and `js/src/freiexchange.js` answer 404, S9.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and FreiExchange has no perpetual and no CCXT class.
It cannot enter the registry as a perpetual leg.
If a later design adds spot legs from a hand-built catalog, `takerPpm` would be 0 on the published headline, and there is no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://freiexchange.com/pages/fees` and the `https://freiexchange.com/pages/fees_data` table it loads | the headline "No trading or deposit fees.", 160 coins with a withdrawal fee in percent |
| S2 | `https://freixlite.com/pages/fees` | the same headline on the LTC quoted sister site |
| S3 | `https://freiexchange.com/pages/about` | a description of the platform with no legal entity, a helpdesk and a Telegram channel |
| S4 | `https://api.freiexchange.com/`, the page "FreiExchange / FreiXLite Api Documentation" | two public calls, a ticker and an order book, the rate limit, no private section |
| S5 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=freiexchange` and `.../exchange/market-pairs/latest?slug=freiexchange` with `category=spot` and `category=perpetual` | id 223, launched 2016-12-20, fee fields 0.0, fee URL, spot volume, 46 spot pairs, 0 perpetual pairs |
| S6 | `https://freiexchange.com/market/LTC/BTC` | the order form total formula with no fee term |
| S7 | `https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=2` | 104 derivatives venues, no FreiExchange |
| S8 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` and `https://api.coingecko.com/api/v3/exchanges/list` | 216 derivatives venues and 1,503 exchanges, no FreiExchange in either |
| S9 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json` and the two class paths | 103 CCXT ids, no FreiExchange, two 404s |
