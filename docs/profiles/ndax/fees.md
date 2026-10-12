# Ndax Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:29 to 04:44 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Ndax lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 90 instruments, 80 of them quoted in CAD, see [`rest.md`](./rest.md) section 2.
The spot taker is a flat 0.20 %, which is 2,000 ppm, with no tiers and no maker and taker split.
CCXT 4.5.68 reports 0.0025, which is 2,500 ppm, so its constant is stale.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/ndax/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | the page's organisation record names "Ndax Inc." with the legal name "Ndax Canada Inc", founded 2017, at 411 1st St SE, Calgary, Alberta | Published | `fees-probe.py page`, S1 |
| regulator | the page names membership of the Canadian Investment Regulatory Organization (CIRO) and registration with FINTRAC, and says fiat balances are covered by CIPF's Investment Dealer Fund | Published | `fees-probe.py page`, S1 |
| who may trade spot | "Ndax offers its services to Canadian residents only and operates under an Order Execution Only (OEO) model" | Published | `fees-probe.py page`, S1 |
| restricted locations | every place outside Canada, by the line above | Region-specific | S1 |
| fee page from this host | `https://ndax.io/fees` answered HTTP 301 to `/en/fees`, which answered HTTP 200 with 282,431 bytes of server rendered HTML through Cloudflare's Vancouver edge | Probed | `fees-probe.py page` |
| public API from this host | every public call answered through Cloudflare's `YVR` edge, with no challenge and no geoblock | Probed | [`rest.md`](./rest.md) section 1 |

The Canadian exit is inside the venue's market, so access from it says nothing about a host elsewhere.
The public market data calls take no account and no key, so the residency rule binds trading and not reading.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, all 90 instruments | 0.20 %, 2,000 ppm | 0.20 %, 2,000 ppm | Published | `fees-probe.py page`, S1 |

The page says "Ndax charges a flat 0.20% trading fee on every buy and sell order", "with no volume tiers and no maker/taker split".
It also says "You trade at the displayed order-book price, with the 0.20% commission charged on top".
CCXT 4.5.68 sets taker 0.0025 and maker 0.002 for every Ndax market, see section 8.
CoinMarketCap's record carries `makerFee` 0.0 and `takerFee` 0.0, its placeholder for an unknown fee, `fees-probe.py coverage`.
An Ndax spot taker at 2,000 ppm costs four times Gate's 500 ppm perpetual taker, see [`../gate/fees.md`](../gate/fees.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | every one of the 90 instruments has `InstrumentType` `Standard`, no product is `MarginEnabled`, and index, mark and funding paths answer 404, [`rest.md`](./rest.md) sections 2 and 3 |
| coin-margined perpetuals | no | same |
| dated futures | no | same, and CCXT sets `swap`, `future` and `margin` false, S3 lines 29 to 33 |
| options | no | same, S3 line 33 |
| spot order book | yes, 90 instruments, all `Running` | [`rest.md`](./rest.md) section 2 |
| staking and auto earn | yes, with an administration fee of 20 % of rewards, not detailed | S1 |
| deposits and withdrawals | yes, free CAD and crypto deposits and flat per network withdrawal fees, listed on the same page, not detailed | S1 |

Three outside checks agree that Ndax has no perpetuals.
CoinMarketCap's pair lists for Ndax hold 69 spot pairs, 0 perpetual pairs and 0 futures pairs, with `derivativeVolume` 0 against a spot volume of about 2.22 million USD, S4.
CoinGecko's derivatives venue list holds 216 venues and none named Ndax, S5.
CCXT's class maps every market to `type` `spot`, S3 lines 637 to 642.

The API document mentions margin in account fields such as `marginEnabled` and transaction types such as `MarginAcquisition`, S2.
Those are fields of the AlphaPoint platform Ndax runs on, and the live `GetProducts` reply has `MarginEnabled` false on all 89 products, [`rest.md`](./rest.md) section 2.
CCXT 4.5.68 also names a test host `ndaxmarginstaging.cdnhop.net`, S3 line 154, which is a staging host and not a product.

## 4. Spot tiers

None.
The page says there are "no volume tiers", S1.
An account's own fee would come from `GetOrderFee` or `GetOmsFeeTiers`, which CCXT lists as private, S3 lines 229 and 233.
Sent over HTTP without credentials, both answered HTTP 404 with the body `NOT FOUND`, `fees-probe.py private`, so the gateway does not even expose them as public paths.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | none | Published | S1 |
| maker rebates | none, maker pays the same 0.20 % | Published | S1 |
| token holding | none seen | Not publicly specified | S1 |
| referral | CCXT names a referral link, S3 line 166, and the fee page names no discount from it | Not publicly specified | S1, S3 |
| zero fee promotions | none seen | Not publicly specified | S1 |
| OTC desk | named on the site and not priced on the fee page, not detailed | Not publicly specified | S1 |

## 6. Funding as a cost

Not offered.
Ndax lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged product, so there is no liquidation or settlement charge.
No delisting charge on open orders is published.

## 8. CCXT

CCXT 4.5.68 has an `ndax` class at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/ndax.js`, S3.

- `has` sets `spot` true and `margin`, `swap`, `future` and `option` false, lines 29 to 33.
- `rateLimit` is 1000 ms, line 25.
- `fees.trading` sets `tierBased` false, `percentage` true, `maker` 0.002 and `taker` 0.0025, lines 359 to 365.
- `parseMarket` builds every market with `type` `spot`, `id` set to the numeric `InstrumentId`, and `contractSize` and `linear` undefined, lines 618 to 647.
- `active` is `SessionStatus` equal to `Running` and `IsDisable` false, line 643.
- `setMarkets` in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/base/Exchange.js` line 3716 copies `fees.trading` into every market.
- CCXT Pro has a socket class at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/ndax.js`, see [`websocket.md`](./websocket.md) section 8.

So `market.taker` is 0.0025 for every market without credentials.
`fees-probe.py ccxt` loaded the markets through the Python class of the same release and read `taker` 0.0025 and `maker` 0.002 on all 87 symbols.
The taker constant is 500 ppm above the published flat 0.20 %, and the maker constant matches it.
The 87 symbols come from 90 instruments because three pairs are listed twice, and CCXT keeps the later instrument for each symbol, see [`rest.md`](./rest.md) section 2.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and Ndax has no perpetual.
It cannot enter the registry as a perpetual leg.
If a later design adds CAD spot legs, `takerPpm` would be 2,000 from the published flat fee, and `ccxtTakerPpm` would be 2,500, citing line 364 of the CCXT class.
The two differ, so the override is needed and not cosmetic.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://ndax.io/en/fees`, reached from `https://ndax.io/fees` | the flat 0.20 % fee, no tiers and no maker and taker split, the operator record, CIRO and FINTRAC, the Canadian residents only line, the staking administration fee |
| S2 | `https://apidoc.ndax.io/`, version 3.3 of the NDAX Exchange API reference, 767,834 bytes | the message frame, `GetL2Snapshot`, `SubscribeLevel2`, `Ping`, the margin fields of the platform |
| S3 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/ndax.js` | the CCXT class, lines cited in section 8 |
| S4 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=ndax` and `.../exchange/market-pairs/latest?slug=ndax` with `category` `spot`, `perpetual` and `futures` | id 1043, fee fields 0.0, 69 spot pairs, 0 perpetual and 0 futures pairs, spot volume |
| S5 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` | 216 derivatives venues, no Ndax |
