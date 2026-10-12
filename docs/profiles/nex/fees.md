# NEX Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:07 to 04:28 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the perpetuals of NEX Exchange, CoinMarketCap slug `nexchange`, which has no CCXT id, so the folder is the slug `nex`.
NEX is the rebranded All InX venue: its web app at `https://n-exchange.io` runs on hosts under `allinpro.com`, and its bundle links All InX press releases and the `allinx.io` app download.
NEX publishes no API documentation, no fee page and no terms page that this survey could find.
Every number below comes from the calls the web app itself makes, from CoinMarketCap and CoinGecko, or from the web bundle.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/nex/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/nex/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/nex/ws-probe.py).
The exit geolocated to Vancouver, Canada, and every NEX host answered through CloudFront, so every access result below is from that Canadian exit.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | None named on the site or in the bundle | Not publicly specified | S3 |
| country on CoinMarketCap | `MY`, Malaysia, with launch date 2024-02-29 | Published | S1 |
| restricted regions | "NEX does not serve users in certain jurisdictions, including North Korea, Cuba, Mainland China, Malaysia, and others we may designate", from a pop-up string in the web bundle | Published | S3, `fees-probe.py` section `site` |
| who may trade the perpetuals | a registered account holder outside those regions. Canada and the United States are not named. No KYC level table was found | Account-gated | S3 |
| public API documentation | none found. CoinMarketCap's description says "Professional API connectivity, including REST API and WebSocket services, enables institutional partners", but links no documentation, and `robots.txt` disallows `/api/*`, `/v2/*` and `/web/api/v1/*` | Not publicly specified | S1, S4 |
| public data from this exit | every web app call used here answered HTTP 200, and both sockets upgraded | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

CoinMarketCap gives Malaysia as the venue's country, while the bundle's own pop-up lists Malaysia as an excluded jurisdiction.
Both are written, and neither changes access from this exit.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals, VIP table | 0.04 % = 400 ppm | 0.05 % = 500 ppm | Probed | S6. `GET /futures/web/api/v1/setting/vip/configs` returns one row, `VIP0`, `maker_fee_rate` 0.0004, `taker_fee_rate` 0.0005, `trade_amount` 0. The web app's VIP page reads this call, S5 |
| USDT-M perpetuals, market list | 0.04 % = 400 ppm on all five | 0.2 % = 2,000 ppm on BTCUSDT, 0.1 % = 1,000 ppm on ETHUSDT, BNBUSDT, SOLUSDT and DOGEUSDT | Probed | `maker_fee` and `taker_fee` of `GET /futures/web/api/v1/market/list` |
| spot | unknown | unknown | Not publicly specified | no fee page exists, the spot ticker list has no fee field, and CoinMarketCap records `makerFee` 0.0 and `takerFee` 0.0 with no fee URL, S1 |

The two perpetual sources disagree on the taker, and no trade could settle which one an order pays without an account.
A conservative model uses the market list's 2,000 ppm on BTCUSDT and 1,000 ppm elsewhere.
The question is moot today, since every perpetual book is empty, see section 3.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | listed but dormant. Five markets, BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT and DOGEUSDT, all `type` 1 and `available` true, with leverage up to 100 on BTC and ETH and 50 on the rest. All ten REST books read had zero bids and zero asks, the socket sent no depth frame, 24 h volume is 0 on all five, and the newest trade on each was 2026-09-05 06:53 UTC, 34.9 days before the probe | Probed, [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | absent. Every market has `money` USDT | Probed |
| coin-margined perpetuals | absent | Probed |
| dated futures | absent from every catalog and from the bundle's routes | Probed, S3 |
| options | absent | Probed, S3 |
| spot | yes, 38 pairs all quoted in USDT in the web app's ticker list. CoinMarketCap counts 29 pairs and 72.6 to 72.9 million USD of 24 h spot volume. Not detailed | Probed, S1, S2 |
| prediction market ("guess"), grid bot, RWA launchpad | named in the bundle's routes and strings only | S3 |

CoinMarketCap lists NEX in its spot ranking of 231 to 232 venues and not in its derivatives ranking of 104, and it reports 0 perpetual pairs and 0 perpetual volume.
CoinGecko's exchange list of 1,503 has no NEX entry, only the related DEX `allinxswap-opbnb`, and its derivatives list of 216 has none.
Both come from `fees-probe.py` sections `cmc` and `coingecko`, against S2, S7 and S8.

## 4. Perpetual tiers

| tier | 30-day volume (USD) | maker | taker | label | evidence |
|---|---|---|---|---|---|
| VIP0 | 0 | 0.04 % = 400 ppm | 0.05 % = 500 ppm | Probed | `fees-probe.py` section `vip` |

The VIP call returns this single row, so no higher tier is published.
The per market fields of section 2 are a second, conflicting source.

## 5. Discounts that change the perpetual taker

| discount | status | label |
|---|---|---|
| token holding | none found. The bundle names an ASC token and a staking qualification, but no fee discount | Not publicly specified |
| referral | a `/referral` route exists, and no rebate rate was found | Not publicly specified |
| market maker | none published | Not publicly specified |
| zero fee promotions | none found | Not publicly specified |

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula | not published. The bundle says only "If the funding rate is positive, longs pay shorts. If negative, shorts pay longs." | Not publicly specified | S3 |
| interval | 8 h, inferred. `next_funding_time` was 1791619200, 2026-10-10 08:00 UTC, which is 0 modulo 28,800 s, and `funding_time` counts the minutes to it | Probed | `rest-probe.py` section `futures` |
| current rate | -0.00375 = -3,750 ppm for `funding_rate_last`, `funding_rate_next` and `funding_rate_predict` on all five markets, unchanged over 30 one-second polls | Probed | `rest-probe.py` sections `futures` and `poll` |
| cap and floor | not published. The rate sits at -0.375 % on every market while the mark is 3 % to 28 % below the index, which suggests -0.375 % is a floor | Not publicly specified | [`rest.md`](./rest.md) section 4 |
| charged to | open positions at the settlement instant, from the bundle's balance formula "Total Net Funding Fee" | Not publicly specified | S3 |

The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting charges

| item | value | label | evidence |
|---|---|---|---|
| maintenance margin | each market's `limits` rows pair a position size threshold with a maximum leverage and a rate, undocumented. BTCUSDT runs from 20.0001 BTC, 100x and 0.005 to 2,500.0001 BTC, 3x and 0.036 | Probed | `rest-probe.py` capture `rest-futures-list.json` |
| liquidation fee | not published | Not publicly specified | |
| insurance fund | `insurance` 166,166.98784476 on every market of the state call | Probed | [`rest.md`](./rest.md) section 3 |
| settlement and delisting | none published | Not publicly specified | |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, 104 files |
| class for NEX | none. No file name there starts with `nex`, `allin` or `n-exchange` | `fees-probe.py` section `ccxt` |
| current CCXT source | none. The `ts/src` listing of ccxt/ccxt master at commit `f0aca06` of 2026-10-08 has 103 classes and none for NEX, All InX or allinpro | S9 |
| `market.taker` | not applicable | |

## 9. Recommended registry values

No registry entry is recommended, because the venue has no live perpetual book and no published API, see [`rest.md`](./rest.md) section 8.
If the perpetuals ever trade again, the entry would be:

```ts
nex: {
  takerPpm: 2000,
  // No CCXT class. The market list says taker_fee 0.002 on BTCUSDT and 0.001 on the other four, against 0.0005 on the VIP table, so the larger number is the safe model.
}
```

`ccxtTakerPpm` stays unset because there is no CCXT class.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | CoinMarketCap exchange record, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=nexchange`, and the page `https://coinmarketcap.com/exchanges/nexchange/` | 2026-10-09 |
| S2 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=nexchange&category=spot` and `category=perpetual` | 2026-10-09 |
| S3 | `https://n-exchange.io/` and its bundle `https://n-exchange.io/assets/index-D4ICEk_G.js`, about 2.8 MB, holding the hosts, the routes, the restricted regions and the funding strings | 2026-10-09 |
| S4 | `https://n-exchange.io/robots.txt` | 2026-10-09 |
| S5 | the VIP page chunk `https://n-exchange.io/assets/VipTier-C656RI6i.js`, which calls `setting/vip/configs` through `futures-CKtxs7-I.js` | 2026-10-09 |
| S6 | `https://api.allinpro.com/futures/web/api/v1/setting/vip/configs` and `https://api.allinpro.com/futures/web/api/v1/market/list` | 2026-10-09 |
| S7 | CoinGecko `https://api.coingecko.com/api/v3/exchanges/list` and `https://api.coingecko.com/api/v3/derivatives/exchanges/list` | 2026-10-09 |
| S8 | CoinMarketCap rankings `https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=1` and `exType=2` | 2026-10-09 |
| S9 | `https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master` and `https://api.github.com/repos/ccxt/ccxt/commits/master` | 2026-10-09 |
