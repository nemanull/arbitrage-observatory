# CZR Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:51 to 03:09 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

This profile covers perpetual trading on CZR Exchange, which has no CCXT class, see section 8.
CZR is a ChainUp white label, and its USDT margined perpetuals are the researched product.
Every number carries a source ledger row or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/czr/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py).
Source ids are shared with [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | The Terms of Service name three service providers by residence: CZR Swiss AG for Switzerland, C-Zero S.A.S. for Colombia and CZR Panama Inc. for every other country where the services are available. All are affiliates of CZR Holdings Ltd, registered in the Cayman Islands. | Published | S3 |
| restricted locations | A table of 50 jurisdictions whose residents get no "ordinary customer onboarding and financial-service access", among them Canada, the United States of America, the United Kingdom, Australia, Singapore, South Korea, India, the People's Republic of China and most of the European Union. | Published | S2, P1 |
| United States | "USERS WHO ARE RESIDENTS OF THE UNITED STATES MAY NOT ACCESS THE PLATFORM", and some may use a separate site at `www.czrex.us` | Published | S3 |
| product eligibility | "Spot trading, futures, copy trading, Earn, token purchases and other services may have separate eligibility requirements" | Published | S4 |
| KYC | "Approved identity verification (KYC) and jurisdiction eligibility are required for deposits and withdrawals" | Published | S4 |
| who may trade the perpetuals | A verified account holder resident outside the 50 jurisdictions. | Region-specific | S2, S3, S4 |
| website from this host | `www.czrex.com` answered 200 behind Cloudflare's Vancouver edge, and every page and call used here answered without a challenge. | Probed | P2, see [`rest.md`](./rest.md) section 1 |
| public API from this host | `futuresopenapi.czrex.com`, `openapi.czrex.com` and both futures socket hosts answered every public call. | Probed | P2 to P10 |

The development host's traffic exits in Canada, and Canada is on the restricted list, so trading from this exit is not allowed under S2.
Reading public market data is not an account service, and no host refused it.
CoinMarketCap lists the venue as active with about 3,500 USD of spot and 53,000 to 55,000 USD of perpetual volume over 24 hours in two reads, S1 and P1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | source |
|---|---|---|---|---|
| USDT margined perpetuals, 50 contracts | 0.02 %, 200 ppm | 0.05 %, 500 ppm | Published | S5 |
| the same, per contract on the open API | `openMakerFee` 0.0002 on all 50 | `openTakerFee` 0.0005 on all 50 | Probed | P1, P3 |
| the same, per contract on the web list | `openMakerFeeRate` 0.0002 on all 50 | `openTakerFeeRate` 0.0005 on all 50 | Probed | P1 |

The fee page and both catalog calls agree on 500 ppm for the taker.
`closeTakerFee` and `closeMakerFee` equal the open rates on every live contract, P1.
The spot schedule, for context, is 0.06 % maker and 0.10 % taker, S5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT margined linear perpetuals | yes, 50 trading, all quoted in USDT | P3, see [`rest.md`](./rest.md) section 2 |
| `S-BTC-USDT`, a simulated contract margined in `EXUSD` | listed, `contractShowType` "模拟合约", which reads as simulated contract | P3 |
| coin margined or USDC margined perpetuals | absent, the web list's `marginCoinList` is `EXUSD` and `USDT` | P3 |
| dated futures | absent from every catalog call, `deliveryKind` 0 on all 51 web list rows, although CoinMarketCap's description speaks of "perpetual and dated contracts" | P3, S1 |
| options | absent | P3, S1 |
| spot | present, 52 symbols on `openapi.czrex.com`, not detailed here | P3 |
| margin, earn, copy trading, card | named on the site, not detailed here | S2, S4 |

## 4. Perpetual tiers

No tier table is published.
The fee page says "If you trade at higher volumes and would like an improved rate, reach out to us through our official support channel", S5.
So any rate below VIP 0 is Negotiated.

## 5. Discounts

| discount | effect on the perpetual taker | source |
|---|---|---|
| volume | by request to support, Negotiated | S5 |
| token holding | none found, CZR lists no platform token | S5 |
| referral | an Affiliate page exists, and its effect on the futures fee is Not publicly specified | S6 |
| market maker | Not publicly specified | |
| zero fee promotion | none found | S5 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | Not publicly specified, CZR publishes no funding page that this research found | S5, S6 |
| interval on the wire | `capitalFrequency` 8 h on 29 contracts, 4 h on 17, 2 h on 2 and 1 h on 2 | P3 |
| next settlement on the wire | `nextCapitalSettTime` on every contract, equal to the socket's `nextSettlementTime` on 50 of 50 and 48 of 50 in two runs, the two being 1 h contracts read just after a settlement | P3, P8 |
| interest rate | `capitalRate` 0.0001 on every contract, read as the usual 0.01 % per period interest term, which is an inference | P3 |
| cap and floor on the wire | `capitalIntervalMax` and `capitalIntervalMin`, plus and minus 0.02 % on 32 contracts, and between 0.001 % and 2 % on the others | P3 |
| premium clamp on the wire | `capitalPremiumMax` 0.0005 and `capitalPremiumMin` minus 0.0005 on every contract config row | P3 |
| who pays | Not publicly specified, the usual rule that longs pay shorts when the rate is positive is assumed by the engine | |

The published rate is `currentFundRate`, and `nextFundRate` is the same number cut to six decimals, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting charges

| item | value | source |
|---|---|---|
| liquidation | `liquidationRate` 0.001 on all 50 web list perpetuals, whose meaning is Not publicly specified | P3 |
| settlement | none, the perpetuals do not expire | P3 |
| delisting | Not publicly specified, `USDT1858-LAB-USDT` sits in the open API catalog at `status` 0 and in no other list | P3 |

## 8. CCXT

CCXT 4.5.68 has no CZR class.
The installed source folder, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, holds 104 `.js` files, no file name contains "czr", and no file contains the string "czr" or "czrex", P1.
So there is no file and line to cite.
The current CCXT source on GitHub, `ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, lists 110 entries, and none contains "czr", S7 and P1.
So CCXT reports no `market.taker` for this venue.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 500 | the published 0.05 % futures taker, S5, which `openTakerFee` repeats on every live contract, P1 |
| `ccxtTakerPpm` | none | no CCXT class |

The engine's ChainUp family adapter carries the taker in its `Profile`, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 35, and reads the per contract `openTakerFee` first, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 123 to 129.
A CZR profile would set `taker_ppm: 500`.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap exchange detail | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=czr-exchange | 2026-10-09 | CoinMarketCap, id 32491 | status, URLs, description, volumes |
| S2 | Jurisdictions, cms page `area` | https://www.czrex.com/fe-ex-api/cms/info with body `{"fileName":"area"}`, shown at https://www.czrex.com/en_US/cms/area | 2026-10-09 | CZR, created 2026-10-02 | the 50 restricted jurisdictions, section 1 |
| S3 | Terms of Service, cms page `terms` | https://www.czrex.com/fe-ex-api/cms/info with body `{"fileName":"terms"}` | 2026-10-09 | CZR Holdings Ltd and its service providers, last updated 2026-02-05 | entities and the United States rule, section 1 |
| S4 | Compliance, cms page `compliance` | https://www.czrex.com/fe-ex-api/cms/info with body `{"fileName":"compliance"}` | 2026-10-09 | CZR, last updated 2026-10-01 | KYC and product eligibility, section 1 |
| S5 | Fees, cms page `fee` | https://www.czrex.com/fe-ex-api/cms/info with body `{"fileName":"fee"}`, shown at https://www.czrex.com/en_US/cms/fee | 2026-10-09 | CZR, created 2026-08-31 | spot and futures maker and taker, the volume rule, sections 2, 4 and 5 |
| S6 | Footer cms list | https://www.czrex.com/fe-ex-api/cms/footer/list/newPc | 2026-10-09 | CZR | the 14 cms pages, none on funding, sections 5 and 6 |
| S7 | CCXT `ts/src` listing | https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src | 2026-10-09 | CCXT | no CZR class, section 8 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/czr/fees-probe.py) | `uv run scripts/probes/venues/czr/fees-probe.py` | 2026-10-09 | this host, Canadian exit | the cms pages, the per contract fee fields, CoinMarketCap and the CCXT checks |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) mode `host` | | 2026-10-09 | this host | access, section 1 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/czr/rest-probe.py) mode `catalog` | | 2026-10-09 | this host | catalog, web list and contract config, sections 3, 6 and 7 |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/czr/ws-probe.py) mode `all` | | 2026-10-09 | this host | socket next settlement, section 6 |
