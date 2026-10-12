# StakeCube Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:14 to 05:28 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

StakeCube lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 300 pairs on the public API, all `ACTIVE`, of which 84 traded in the last 24 hours, see [`rest.md`](./rest.md) section 2.
The official fee page sits behind a Cloudflare challenge from this host, so the fee comes from StakeCube's own exchange page: one trading fee of 0.2 %, reducible to 0.0 % with an SCC masternode registration.
So the VIP 0 spot taker is 0.2 % = 2,000 ppm.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/stakecube/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 US Pacific for every source row | | source ledger |
| operator | StakeCube LLC, 2 Ilia Chavchavadze Avenue, Tbilisi, Georgia, per the imprint. The imprint also names a German technical support entity, StakeCube Service, as "currently undergoing relocation and change of company name/owner", formerly a subsidiary of FOX'em Crowdsourcing GmbH in Cologne. | Published | S3 |
| launch | 2019-05-13 according to CoinMarketCap, whose description still calls the venue "based in Germany" | Published | S6 |
| restricted locations | the terms reserve the right to restrict service in some countries without naming any, and ask a United States citizen to limit use to services legal in the United States | Published | S4 |
| who may trade spot | a registered account holder, through the web app or the signed private API | Account-gated | S4, S7 |
| fee page from this host | `https://stakecube.net/app/system/fees` answered HTTP 403 with `cf-mitigated: challenge` and the title "Just a moment...", in plain requests, and also in one manual headless Chrome render made while researching | Probed | `fees-probe.py pages` |
| market data terms | the terms forbid using StakeCube market data for "trading services, data feeding, streaming services or any other website or application that may obtain a monetary profit unless given specific written consent by StakeCube" | Published | S4 |

The Cloudflare challenge on the app pages is a bot check, not a geoblock.
The marketing pages, the imprint, the terms and the API host all answered HTTP 200 from the Canadian exit.
The API page on the same site says the API "can be integrated from any external location without restriction", which sits uneasily beside the data clause of the terms, S8 and S4.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, every quote coin | 0.2 % = 2,000 ppm | 0.2 % = 2,000 ppm | Published | S1, the exchange page |
| spot, with an SCC masternode registration | down to 0.0 % = 0 ppm | down to 0.0 % = 0 ppm | Published | S1, S2 |

The exchange page reads "You can further reduce the 0.2% fee down to 0.0% with our unique SCC masternode registration.", S1.
Its comparison table gives StakeCube's trading fee as "0.2% - 0.00%", beside "0.1% - 0.075%" for Binance, S1.
Neither names a maker and a taker rate apart, so the one fee is written for both sides.
The binding schedule is the fee page the terms point to, S4, and it could not be read from this host, so the split between maker and taker and any steps between 0.2 % and 0.0 % stay Not publicly specified.
CoinMarketCap's record carries `makerFee` 0.0 and `takerFee` 0.0, S6, which matches the masternode floor rather than the base rate.
A third-party aggregator, Cryptowisser, lists 0.10 % for both sides, S9, and is not used.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | the API documents only spot routes under `/exchange/spot/`, S7, and neither the exchange page nor the terms uses the words futures, perpetual or leverage, `fees-probe.py pages` |
| coin-margined perpetuals | no | same |
| dated futures | no | same |
| options | no | same |
| margin trading | no, the exchange page's comparison table shows a cross for StakeCube under "Margin Trading" | S1 |
| spot order book | yes, 300 pairs quoted in BTC, SCC, USDT, DOGE, LTC, USDT-BSC and DASH | [`rest.md`](./rest.md) section 2 |
| deposits and withdrawals | yes, schedule on the fee page | section 7 |

Three outside checks agree that StakeCube has no perpetuals.
CoinMarketCap's pair lists for the venue hold 94 spot pairs, 0 perpetual pairs and 0 futures pairs, and its derivatives ranking with `exType=2` lists 104 venues and not StakeCube, S6.
CoinGecko's derivatives list holds 216 venues and not StakeCube, and its list of 1,503 exchanges has no row whose id or name contains "stake", S10.

## 4. Spot tiers

None published on a page readable from this host.
The exchange page names only the 0.2 % base and the 0.0 % floor, S1.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| SCC masternode registration | reduces the 0.2 % fee down to 0.0 % | Published | S1 |
| SCC holding | the SCC page lists "Trading-Fee reduction" among SCC's uses and "trade with zero fee on exchange" among its benefits, with "Masternode registration" as the integration type, so holding alone is not described as enough | Published | S2 |
| volume tiers | Not publicly specified | Not publicly specified | |
| referral | an "Affiliate-Rate increase" is listed as an SCC use, with no rate | Not publicly specified | S2 |
| zero fee promotion | none found | Not publicly specified | |

## 6. Funding as a cost

Not offered.
StakeCube lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement, delisting and withdrawal

Not offered for liquidation and settlement, because there is no leveraged product.
A delisting charge is Not publicly specified.
The terms say fees are those of `https://stakecube.net/app/system/fees`, that StakeCube may change them at any time, and that a change applies only to orders matched after it, S4.
Withdrawal fees are listed on that same page, which answered with a Cloudflare challenge, see section 1.

## 8. CCXT

CCXT 4.5.68 has no StakeCube class.
There is no `stakecube.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, which holds 104 classes, and the `exchanges` map that runs from line 232 to line 337 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` has no line containing "stake".
The current CCXT source agrees: `exchanges.json` on the `master` branch lists 103 ids and none containing "stake", and `ts/src/stakecube.ts` and `js/src/stakecube.js` answer 404, S11.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and StakeCube has no perpetual and no CCXT class.
It cannot enter the registry as a perpetual leg.
If a later design adds spot legs from a hand-built catalog, `takerPpm` would be 2,000 on the exchange page's base rate, there is no `ccxtTakerPpm` to declare, and the data clause of the terms in section 1 would need StakeCube's written consent first.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://stakecube.net/crypto-exchange` | the 0.2 % fee reducible to 0.0 % with an SCC masternode, the comparison table rows "Trading fee" and "Margin Trading" |
| S2 | `https://stakecube.net/scc` | SCC's uses, among them trading fee reduction, and "trade with zero fee on exchange" |
| S3 | `https://stakecube.net/imprint` | StakeCube LLC in Tbilisi, the German support entity in relocation |
| S4 | `https://stakecube.net/terms` | the fee clause naming the fee page, the United States clause, the market data clause |
| S5 | `https://stakecube.net/app/system/fees` | HTTP 403 with a Cloudflare challenge from this host, nothing readable |
| S6 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=stakecube`, `.../exchange/market-pairs/latest?slug=stakecube` with `category=spot`, `perpetual` and `futures`, and `.../exchange/listing?exType=2` | id 863, launch date, fee fields 0.0, fee URL, 94 spot pairs, 0 perpetual and 0 futures pairs, 104 derivatives venues without StakeCube |
| S7 | `https://github.com/stakecube-hub/stakecube-api-docs`, the docs repository `https://stakecube.io/` links as `stakecube/DevCube`, last pushed 2022-05-09 | the public and private REST routes, all spot |
| S8 | `https://stakecube.net/api` | "completely free to use and can be integrated from any external location without restriction" |
| S9 | `https://www.cryptowisser.com/exchange/stakecube/vs/cex-io/`, found by web search | an aggregator's 0.10 % maker and taker, not used |
| S10 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` and `https://api.coingecko.com/api/v3/exchanges/list` | 216 derivatives venues and 1,503 exchanges, no StakeCube in either |
| S11 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json` and the two class paths | 103 CCXT ids, no StakeCube, two 404s |
