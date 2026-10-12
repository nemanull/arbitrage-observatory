# LMAX Digital Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers LMAX Digital, CoinMarketCap rank 114, which has no CCXT class.
LMAX Digital itself is an institutional spot exchange.
Its parent, LMAX Group, has sold crypto perpetual futures since 2025-09-17, S8, through a sister entity, LMAX Global MU, on hosts under `lmax.com` that publish their book and funding rate without a token.
Those perpetuals are the researched product, per design decision 3, and LMAX Digital spot gets its line in the coverage matrix.
No perpetual fee is published, so the perpetual taker is unknown.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/lmax-digital/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/lmax-digital/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/lmax-digital/ws-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| spot entity | "LMAX Digital is a trading name of LMAX Digital Broker Limited, authorised and regulated by the Gibraltar Financial Services Commission (license number FSC1342B)", also a FinCEN Money Services Business, registration 31000179750856 | Published | S1, S2, `fees-probe.py` section 1 |
| spot clients | institutions admitted as Members under the LMAX Digital Rulebook, Rule 5, "financial institutions, banks, corporates, brokers and asset managers" | Published | S1, S2 |
| perpetual entity | "LMAX Global is a trading name of LMAX Broker Mauritius Limited", regulated by the Financial Services Commission of Mauritius, licence GB19025016 | Published | S3, S4, `fees-probe.py` section 2 |
| who may trade the perpetuals | "professional traders, brokerages, funds and financial institutions globally", and the site says "The information on this website is only directed at Professional clients" | Published | S3, S4 |
| account opening | by contact with the sales desk, which then grants a demo account and later production | Published | S5 introduction |
| regions excluded | Not publicly specified beyond "residents of any jurisdiction where FX trading and/or CFD trading is restricted or prohibited by local laws" | Not publicly specified | S3 |
| Canada | Not named | Not publicly specified | S3 |
| access from this host | every LMAX site, docs host and API host answered from the Canadian exit with no challenge or geoblock | Probed | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USD-quoted linear perpetuals | Not publicly specified | Not publicly specified | Account-gated, Negotiated | section 4 |
| LMAX Digital spot, non-committed, under $100m a month | 0.02 %, 200 ppm | 0.06 %, 600 ppm | Published | S1, `fees-probe.py` section 1 |

The perpetual commission is a per-client setting.
The client settings call returns `passiveCommission`, `aggressiveCommission` and, since spec 1.0.14 of 2026-09-25, `commissionOverrides` per symbol, and it needs a bearer token, S5, S6.
The spec's examples of `0.02`, `0.01` and `0.05` are placeholders and are not used here.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USD-quoted linear perpetuals | Yes, 22 open on the production market data socket, all quoted in USD with contract size 1 | [`rest.md`](./rest.md) section 2, `ws-probe.py` section 1 |
| the same, in the published instrument list | 23 rows, the 22 above plus `TONUSDPERP`, which the production socket does not list | S7, `rest-probe.py` section 4 |
| USDT-M or USDC-M perpetuals | No, every symbol is quoted in USD and settled in fiat, with "fiat currency or stablecoins" accepted as collateral | S3, S4 |
| coin-margined perpetuals | No | S3, S7 |
| gold perpetual | Yes, `XAUUSDPERP`, whose index is Pyth Pro's `Crypto.PAXG/USD`, see [`rest.md`](./rest.md) section 4 | S7, `anchor-probe.py` section 2 |
| dated futures | None in the perpetual API, its catalog or its instrument list | S5, S7 |
| options | None | S5, S7 |
| spot, LMAX Digital | Yes, 66 instruments in the published list, 27 of them USD-quoted, including fiat crosses such as deliverable FX | S9, `rest-probe.py` section 5 |
| deposit, withdrawal, custody | Out of scope, the spot client portal holds them | S2 |

## 4. Perpetual tiers

No perpetual fee schedule is published.
The perpetual page and the factsheet name no fee, and the only fee word on either is the factsheet's "tight spreads, transparent fees", `fees-probe.py` section 2.
The spec carries the fee only as fields of the authenticated client settings and of each trade's `commission`, where a positive number is a rebate and a negative one a charge, S5, `fees-probe.py` section 3.
So the perpetual taker is Account-gated and most likely Negotiated per client, and no tier table can be written.

For context only, LMAX Digital's spot schedule, as S1 and S2 print it, is below.

| spot member type | 30 day traded volume | passive | aggressive |
|---|---|---|---|
| committed makers | any | free | 3 bps |
| non-committed makers and takers | under $100m | 2 bps | 6 bps |
| non-committed makers and takers | $100m to $200m | 2 bps | 4 bps |
| non-committed makers and takers | over $200m | 2 bps | 3 bps |

"Commission of 6bps will be levied at point of trade on all aggressively matched orders", and a lower tier is "rebated monthly on a retrospective basis", S1.

## 5. Discounts that change the perpetual taker

None published.
The `commissionOverrides` field shows that a per-symbol rate exists for some clients, S5.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| interval | "every 8 hours", and "typically 8 hours" in the API introduction | Published | S3, S4, S5 |
| settlement instants | Not publicly specified | Not publicly specified | S3, S4, S5 |
| formula | a time-weighted average over the interval of the premium index, "the difference between the mid-market price and the external reference (index) price" | Published | S5 introduction |
| buffer and cap | "A variance buffer is applied, meaning small variations from the index price will not result in a payment, and a cap limits the maximum rate", with neither number published | Published, values Not publicly specified | S5 |
| exchange premium | "A small premium is added to the debit rate to cover exchange costs", and every production instrument carries `fundingRatePremiumPercentage` `0.003`, described as "Additional percentage to be added to calculated funding rates" | Published, Probed | S5, `ws-probe.py` section 1 |
| who pays | separate credit and debit rates: a positive credit rate credits shorts, a positive debit rate debits longs | Published | S5 |
| live rates | 0 for credit, debit and the undocumented `ratePercentage` on all 22 symbols in every frame of both runs | Probed | [`websocket.md`](./websocket.md) section 4 |

Because the debit rate carries a premium the credit rate does not, the two sides of a funding payment are not equal, and a long and a short do not see the same rate.
No settlement instant was captured, and the documentation names none.

## 7. Liquidation, settlement and delisting

Below the auto-liquidation coverage ratio, the platform locks the session, cancels all open orders and sends market orders until the target ratio is restored, S5.
No liquidation fee is published.
The product is "fiat settled", S3, S4.
Maintenance runs every two weeks on Saturday from 03:30 to 04:00 EST or EDT, when all orders are cancelled, S3, S4, S5.
No delisting charge is published.

## 8. CCXT

LMAX has no class in CCXT 4.5.68.
The 104 files of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` hold no file named for LMAX and no file whose text has the word lmax, `rest-probe.py` section 7.
The current CCXT master on GitHub, head `f0aca06eb748` committed 2026-10-08, has 103 files in `ts/src` and none for LMAX either.
So there is no `market.taker` to compare.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | none | the perpetual taker is Account-gated, and the venue is blocked, see [`rest.md`](./rest.md) section 8 |
| `ccxtTakerPpm` | none | no CCXT class |

If a negotiated rate were obtained, it would replace this row.
The spot taker of 600 ppm is not a stand-in for it, because the perpetuals are a different entity's product.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | LMAX Digital Members and Member Documents | https://www.lmaxdigital.com/members/ | 2026-10-09 | LMAX Digital Broker Limited, Gibraltar | spot fee schedule, membership, entity, sections 1, 2 and 4 |
| S2 | Become a client, LMAX Digital, FAQ | https://www.lmaxdigital.com/new-clients/ | 2026-10-09 | LMAX Digital Broker Limited | regulation, FinCEN, clients, sections 1 and 3 |
| S3 | Perpetual futures, LMAX Global MU | https://www.lmax.com/global/mu/perpetual-futures | 2026-10-09 | LMAX Broker Mauritius Limited | entity, clients, funding interval, maintenance, sections 1, 3, 6 and 7 |
| S4 | LMAX Global Perpetual Futures Factsheet, PDF | https://www.lmax.com/documents/LMAXGlobalPerpetualFuturesFactsheet.pdf | 2026-10-09 | LMAX Broker Mauritius Limited | instruments, funding interval, settlement, sections 1, 3, 4 and 6 |
| S5 | Perps API, OpenAPI 1.0.14 | https://docs.lmax.com/perps-client-api/rest/1.0.14/openapi.yaml | 2026-10-09 | LMAX Group | funding, mark and index text, commission fields, liquidation, sections 1, 2, 4 to 7 |
| S6 | Perps API change log | https://docs.lmax.com/perps-client-api/change-log.json | 2026-10-09 | LMAX Group | `commissionOverrides` added in 1.0.14, section 2 |
| S7 | LMAX Global MU perpetual futures instrument list, CSV | https://assets.lmaxstatic.com/csv/LMAXGlobal-mu-Instruments-Perpetual-Futures.csv | 2026-10-09 | LMAX Broker Mauritius Limited | 23 listed symbols, section 3 |
| S8 | LMAX Group launches perpetual futures, press release of 2025-09-17 | https://www.lmax.com/press-centre/lmax-group-launches-perpetual-futures | 2026-10-09 | LMAX Group | launch date, USD settlement |
| S9 | LMAX Digital instrument list, CSV | https://assets.lmaxstatic.com/csv/LMAXDigital-Instruments.csv | 2026-10-09 | LMAX Digital Broker Limited | 66 spot instruments, section 3 |
