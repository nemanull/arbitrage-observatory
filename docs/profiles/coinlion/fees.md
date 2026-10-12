# CoinLion Fee Profile

**Status:** Done.
CoinLion lists no perpetuals, so this profile covers its spot market, where the published fee is a flat 0.15% and LION pairs trade free.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:36 to 04:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada, which geolocated to Vancouver.

This profile covers CoinLion (`coinlion.com`), CoinMarketCap exchange id 9786, which has no CCXT class, see section 8.
CoinLion lists no perpetuals, so the researched product is its spot market, per design decision 3 and change 1 of the survey plan's template.
Every number carries a source id from section 10 or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/coinlion/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/coinlion/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/coinlion/ws-probe.py).
The REST and socket details are in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

- The operator is CoinLion, LLC, a United States company, S3.
  CoinMarketCap lists the country as `US` and the launch date as 2020-07-31, S4.
- The user agreement says CoinLion "is not registered with the U.S. Securities and Exchange Commission and does not offer securities services in the United States or to U.S. persons", S3.
- The same agreement bars use "in jurisdictions that do not permit such use", and it excludes sanctioned countries and persons, S3.
  It names no other excluded country.
- The help center keeps a jurisdiction page per US state, S5.
- The sign-up country list at `frontoffice-v2/api/v2/countries` holds 51 rows, 47 of them active, and both `US` and `CA` are among them, `rest-probe.py` section 2.
- Trading is limit orders only.
  The help center says "Limit orders are available on CoinLion, but market orders are currently not available", S2.
- Nothing refused this host.
  Every page and call named here answered from the Canadian exit, except the account-gated catalog call, which answered 401 as it does for any caller without a token, see [`rest.md`](./rest.md) section 1.

| question | answer | label | evidence |
|---|---|---|---|
| website from this host | `www.coinlion.com` and `trade.coinlion.com` answered HTTP 200 | Probed | `fees-probe.py` sections 1 and 2 |
| public API from this host | `ursa.coinlion.com/marketdata/` answered HTTP 200 on its instruments, depth and history calls, and its SignalR hub accepted an anonymous socket | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |
| published API documentation | none found, the help center has no API article and the user agreement only names an "API Agreement" | Probed | `fees-probe.py` section 1b, S1 |

## 2. Quick answer

| product | maker | taker | label | source |
|---|---|---|---|---|
| spot, every non-LION pair | 0.15%, 1,500 ppm | 0.15%, 1,500 ppm | Published | S1, S2 |
| spot, every pair that involves LION | 0%, 0 ppm | 0%, 0 ppm | Published | S1 |
| perpetuals | Not offered | Not offered | Not offered | section 3 |

The help center calls 0.15% the "standard rate" for "All other trades", S1.
It does not split it into a maker and a taker rate, so both columns carry it.
The web app reads a `fee` and a `takerFee` field per pair from `frontoffice-v2/api/v2/markets/basic`, S7 and `fees-probe.py` section 2.
That call answers 401 without a login token, so per pair values are Account-gated and Not verified.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | No | no perpetual instrument in the catalog, no perpetual term in the web app bundle, and CoinMarketCap shows 0 perpetual pairs, see below |
| USDC-M perpetuals | No | same evidence |
| Coin-M perpetuals | No | same evidence |
| dated futures | No | CoinMarketCap shows 0 futures pairs, `fees-probe.py` section 3 |
| options | No | no option term on any page or in the bundle |
| margin | No | the user agreement has no hit for "margin trading" or "leverage", `fees-probe.py` section 1b |
| spot | Yes, 132 instruments in the public catalog | `rest-probe.py` section 2 |
| CopyCat auto-trader, token balancer, HODL rewards | Out of scope, these are account features on top of spot | S2, S6 |

How the absence of perpetuals was established:

- The public catalog `GET https://ursa.coinlion.com/marketdata/instruments` returns 132 ids, every one a lowercase `base_quote` spot pair, `rest-probe.py` section 2.
- The 4.5 MB web app bundle has 0 hits for "perpetual", "funding rate" and "liquidation", `fees-probe.py` section 2.
  Its one hit for "futures" is the MIME type `application/x-futuresplash`.
- The user agreement has 0 hits for "futures", "perpetual", "derivative", "leverage", "margin trading" and "funding rate", `fees-probe.py` section 1b.
- CoinMarketCap's market pairs call returns `numMarketPairs` 0 for the `perpetual` and `futures` categories and 45 for `spot`, with `derivativeVolume` 0, `fees-probe.py` section 3.

## 4. Spot tiers

There is no volume tier table.
The published schedule is the flat 0.15% of section 2 and the token discounts of section 5, S1, S2.

## 5. Discounts

The discount page lists three steps off the 0.15% standard fee, S2.

| condition | discount | effective fee | label |
|---|---|---|---|
| the CoinLion Token Balancer (CLTB) is used | 20% | 0.12%, 1,200 ppm | Published |
| CLTB used, and a 12-month HODL Program holds at least 60% of the user's CoinLion balance | 40% | 0.09%, 900 ppm | Published |
| CLTB used, and a 12-month HODL Program holds at least 80% of the user's CoinLion balance | 60% | 0.06%, 600 ppm | Published |

The trading fees page says "You can get up to an 80% discount on trading fees by utilizing CoinLion Rewards", S1.
The discount page it links to tops out at 60%, S2.
Both are written here, and the 80% step is Not publicly specified beyond that sentence.
The effective fees are computed from the published percentages.
The page adds "These guidelines are subject to change at any time", S2.
No referral fee discount, market maker program or dated zero fee promotion was found.

## 6. Funding as a cost

Not offered.
CoinLion lists no perpetuals, so there is no funding rate, see section 3.

## 7. Liquidation, settlement and delisting charges

Not offered for liquidation and settlement, since there are no derivatives.
A delisting charge is Not publicly specified.

## 8. CCXT

CCXT 4.5.68 has no CoinLion class.
`node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds no file whose name contains `lion`, `fees-probe.py` section 8.
The current CCXT source on GitHub has none either.
`exchanges.json` on `master` lists 103 ids and does not mention CoinLion, and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/coinlion.ts` answered 404, both read at `master` head `f0aca06eb748` of 2026-10-08, `fees-probe.py` section 8.
So `market.taker` has no value to report.

CoinMarketCap's exchange record holds `makerFee` 0 and `takerFee` 0, S4.
That contradicts the published 0.15% and reads as an unset field.

## 9. Recommended registry values

No perpetual registry entry is recommended, because CoinLion lists no perpetuals, see [`rest.md`](./rest.md) section 8.

For a future spot leg, `takerPpm` would be 1,500 for every non-LION pair, from S1 and S2.
`ccxtTakerPpm` does not apply without a CCXT class.
A spot leg would also need visible liquidity, which the venue does not show today, see [`websocket.md`](./websocket.md) section 4.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [CoinLion help, Trading Fees](https://help.coinlion.com/trading-fees) | 2026-10-09 |
| S2 | [CoinLion help, Discounted Trading Fees](https://help.coinlion.com/discounted-trading-fees) and [Limit and Market Orders](https://help.coinlion.com/limit-and-market-orders) | 2026-10-09 |
| S3 | [CoinLion user agreement](https://www.coinlion.com/user-agreement/) | 2026-10-09 |
| S4 | [CoinMarketCap exchange detail](https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinlion) and [market pairs](https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinlion&category=spot&start=1&limit=100), with `category` also set to `perpetual` and `futures` | 2026-10-09 |
| S5 | [CoinLion help, Disclosures](https://help.coinlion.com/disclosures) | 2026-10-09 |
| S6 | [CoinLion help, CoinLion Rewards](https://help.coinlion.com/coinlion-rewards) | 2026-10-09 |
| S7 | The web app at [`trade.coinlion.com`](https://trade.coinlion.com/), its `config.js` and its bundle `/assets/index-B6TAsugn.js` | 2026-10-09 |
