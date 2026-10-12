# Cofinex Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers Cofinex (`cofinex.io`), CoinMarketCap exchange id 12779, which has no CCXT class.
Cofinex says it offers USDT-margined futures, and CoinMarketCap lists 729 Cofinex perpetual pairs, so the researched product is its perpetuals, per design decision 3.
No public surface of Cofinex returns perpetual data or a perpetual fee, so most perpetual rows below are Not publicly specified.
The spot surface that does work is recorded where it shows how the venue is built.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/cofinex/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/cofinex/rest-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entities | "Cofinex India serves customers across India and is registered with FIU-IND as a Reporting Entity under the Virtual Asset Service Provider category, bearing registration number VA00049334." | Published | S2 footer |
| legal entities, EU | "Minos Blockchain s.r.o (No.17968127) serves customers from the European Union and European Economic Area (EEA) and is regulated by The CNB (the Czech National Bank)", authorization 145973395 | Published | S2 footer |
| prohibited jurisdictions | North Korea and Iran | Published | S2 |
| high risk and restricted regions | Sudan and South Sudan, Syria, Crimea, Cuba, Myanmar and Venezuela, where Cofinex "reserves the right to deny service" | Published | S2 |
| US persons | "Cofinex restricts services to certain individuals and entities defined as "US Persons"", which covers US citizens and US residents | Published | S3 |
| Canada | Not named in either policy | Not publicly specified | S2, S3 |
| who may trade the perpetuals | Not publicly specified. The web app has a futures account page but no futures trading page, see section 3. | Not publicly specified | S4 |
| website from this host | `cofinex.io` answered HTTP 200 through CloudFront with no challenge | Probed | [`rest.md`](./rest.md) section 1 |
| public API from this host | the documented host `dataapi.cofinex.io` answered HTTP 502 from its AWS load balancer, or an authorization error, on every market data path | Probed | [`rest.md`](./rest.md) section 1 |

`cofinex.com` is an unrelated placeholder page of the Spanish host Hostalia, so every Cofinex host in this profile is under `cofinex.io`.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals | Not publicly specified | Not publicly specified | Not publicly specified | no fee page exists, see section 4 |
| USDT-M perpetuals, API docs example | 0.02 %, 200 ppm | 0.06 %, 600 ppm | Published, as an example only | S1, `fees-probe.py` section 2 |
| spot, catalog fields | 0.1 % or 0.2 %, 1,000 or 2,000 ppm | 0.1 % or 0.2 %, 1,000 or 2,000 ppm | Probed | `fees-probe.py` section 1 |

The API docs example is two rows of a `FUTURE` catalog reply, `10000AIDOGEUSDT` and `10000LADYSUSDT`, with `makerFeeRate` `0.0002` and `takerFeeRate` `0.0006`, S1.
It is an example in a document, not a reply, because the endpoint it documents answers HTTP 502, see [`rest.md`](./rest.md) section 2.
Its numbers and its field names (`minTradeNum`, `priceEndStep`, `sizeMultiplier`) are the ones Bitget's USDT-M contracts call carries, and Bitget's VIP 0 perpetual taker is 600 ppm, see [`../bitget/fees.md`](../bitget/fees.md) section 2.
So the example most likely shows Bitget's contract fields, not a Cofinex fee schedule.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | Yes, by the venue's own words. The home page offers a "BTC USDT-M Futures position boost voucher" and a "Daily futures trade" task, and says "The platform offers Spot Trading, Futures Trading, Copy Trading, Staking, Earn products". | S4 |
| USDT-M perpetuals, CoinMarketCap | 729 perpetual pairs, 195 USDT and 5 USDC quoted on the first page of 200, every one flagged `priceExcluded` and `volumeExcluded` | S5, `rest-probe.py` section 7 |
| USDC-M perpetuals | Five USDC quoted pairs on CoinMarketCap's first page, Not verified on the venue | S5 |
| Coin-M perpetuals | Not seen anywhere | S1, S4, S5 |
| perpetuals in the web app | A futures account page at `/dashboard/assets/futureaccount` and a futures balance call, but no futures trading route, and every futures URL tried renders the not found page | S4, `rest-probe.py` section 4 |
| dated futures | Not seen anywhere | S1, S4 |
| options | Not seen anywhere | S1, S4 |
| spot | Yes, 550 pairs in the web app's catalog, 542 of them sourced from Bitget | `rest-probe.py` section 3 |
| margin | A `/market/margin/BTC-USDT` page renders | S4, read with `curl` on 2026-10-09 |
| deposit, withdrawal, card, staking and earn | Out of scope. The site links a CoPay card page and a staking page from its footer. | S4 |

CoinMarketCap's market URLs for the perpetuals have the form `https://cofinex.io/trade/UMCBL/ETH-USDT`, S5.
`UMCBL` is Bitget's former product type code for USDT-margined perpetuals.
That URL renders the site's not found page with HTTP 200, `rest-probe.py` section 4.
CoinMarketCap's ETH/USDT row reported 1.04 to 1.09 billion USD of volume and 1.93 billion USD of open interest across three reads, which is the order of Bitget's own ETHUSDT perpetual rather than of a venue whose BTC/USDT spot pair traded 1.67 million USD that day, `rest-probe.py` sections 3 and 7.

## 4. Perpetual tiers

Not publicly specified.
CoinMarketCap's fee link for Cofinex is `https://cofinex.io/fee-details-trade`, S6.
It and five other likely fee paths render the not found page, `fees-probe.py` section 3.
The announcement blog returned no post for the searches `fee`, `perpetual` and `funding` other than an unrelated sponsorship post, S7.
CoinMarketCap holds `makerFee` 0 and `takerFee` 0 for Cofinex, which reads as an unset field, S6.

## 5. Discounts

Not publicly specified.
The home page names a "BTC USDT-M Futures position boost voucher" and a "Spot trading fee voucher" in its rewards hub, S4.
Neither has a published amount or end date in the pages read.

## 6. Funding as a cost

Not publicly specified.
No Cofinex page or call returns a funding rate, an interval or a cap.
CoinMarketCap shows a `fundingRate` of 0.0001 on its ETH/USDT and SOL/USDT rows, S5, but it does not say where it reads it.

## 7. Liquidation, settlement and delisting charges

Not publicly specified.

## 8. CCXT

CCXT 4.5.68 has no Cofinex class.
`node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds no file named for Cofinex, and no file there contains the string `cofinex`.
The current CCXT source on GitHub has none either: `ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08 lists no Cofinex file, and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/cofinex.ts` answered 404.
So `market.taker` has no value to report.

## 9. Recommended registry values

No registry entry is recommended, because the venue has no public perpetual surface, see [`rest.md`](./rest.md) section 8.
If one were ever made, `takerPpm` has no published value to take, and `ccxtTakerPpm` does not apply without a CCXT class.

### Spot, for the record

Every spot row of the web app's catalog carries a `takerFeeRate` and a `makerFeeRate`, `fees-probe.py` section 1.

| rows | maker | taker |
|---|---|---|
| 490 sourced from Bitget | 1,000 ppm | 1,000 ppm |
| 52 sourced from Bitget, among them BTCUSDT, ETHUSDT, SOLUSDT and XRPUSDT | 2,000 ppm | 2,000 ppm |
| 3 Cofinex listings, among them CNXUSDT | 1,000 ppm | 1,000 ppm |
| 5 Cofinex listings | 2,000 ppm | 2,000 ppm |

All 542 Bitget sourced rows carry exactly the fee fields of Bitget's own `/api/v2/spot/public/symbols` reply, `fees-probe.py` section 1.
So these fields are copied from Bitget's catalog and do not show what Cofinex charges its own users.
The spot fee Cofinex charges is Not publicly specified.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [Cofinex API docs](https://apidocs.cofinex.io/), a Swagger UI over [`openapi.json`](https://apidocs.cofinex.io/openapi.json), version 1.0.0 | 2026-10-09 |
| S2 | [Restricted Jurisdiction Policy](https://cofinex.io/en/content/restricted-jurisdiction-policy), with the entity lines in its footer | 2026-10-09 |
| S3 | [US Person Definition](https://cofinex.io/en/content/us-person-definiton) | 2026-10-09 |
| S4 | [Cofinex home page](https://cofinex.io/en) and its Next.js chunks under `https://www.cofinex.io/_next/static/chunks/`, among them `2s0qf920uu4lv.js` for the futures account link and `40jcj_2q29__k.js` for the API hosts | 2026-10-09 |
| S5 | [CoinMarketCap market pairs, perpetual](https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=cofinex&category=perpetual&start=1&limit=200) | 2026-10-09 |
| S6 | [CoinMarketCap exchange detail](https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=cofinex) | 2026-10-09 |
| S7 | [Cofinex announcements search](https://announcement.cofinex.io/wp-json/wp/v2/search?search=fee), and the same call for `futures`, `perpetual` and `funding` | 2026-10-09 |
