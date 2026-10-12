# EasiCoin Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time (2026-10-10 02:23 to 02:37 UTC), two runs of every probe mode, from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocates to Vancouver, Canada.

This profile covers the fees of the EasiCoin perpetual contracts, for every perpetual family the venue lists.
EasiCoin publishes no public API documentation.
Its home page tells a visitor to "contact support@Easicoin.finance to enable API access", S15, and its help center has no API section, S12.
Every number probed here therefore comes from the calls the www.easicoin.io web app makes for an anonymous visitor, which are undocumented, see [`rest.md`](./rest.md) section 2.
The web app is the same platform as YUBIT's, see [`../yubit/fees.md`](../yubit/fees.md): the same `/mapi/` paths, the same catalog fields and the same socket topics.
No CCXT class exists for EasiCoin, see section 8.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-10-09 Pacific, 2026-10-10 UTC | this profile |
| legal entity | not named. The terms say "EasiCoin" "may refer to the Platform, its holding company, or an authorized operator". The compliance page cites a FinCEN MSB registration, number 31000301099997, authorized 2025-05-23 | S8, S11 |
| country | Hong Kong, per CoinMarketCap. Launched 2023-01-17 per CoinMarketCap | S13 |
| who may trade | a person at least 18 years old with full legal capacity, after identity verification | S8 |
| excluded regions | North Korea, Iran, Cuba, Sudan, Syria, the Crimea region, Afghanistan, "Sanctioned entities in the Balkans", and any region under UN, EU, UK or OFAC sanctions | S7 |
| US and Canadian persons | not excluded by name | S7 |
| automated access | the terms forbid "Conducting unauthorized data scraping, extraction, or mining". The user agreement forbids "Using bots, high-frequency programs, or other automated tools" and "Multi-account arbitrage". The futures rules name "Using price differences in low-liquidity markets for rapid arbitrage" as a violation | S8, S9, S10 |
| what this host got | every public web app call answered 200 and the socket upgraded with 101. `GET /mapi/user/public/v1/country-code` answered country `CA`. The host `api.easicoin.io` (APISIX) answered 404 on `/` and 503 on every API path tried, and `openapi.easicoin.io` does not resolve. Details in [`rest.md`](./rest.md) section 1 | P2 |

The access results are from the Canadian VPN exit and not from a US address.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, crypto and metals, 244 contracts | 0.05 %, 500 ppm | 0.05 %, 500 ppm | S1, S2, catalog `defaultTakerFeeRateE8` `"50000"`, P1 |
| USDT-M perpetuals, stocks, 169 contracts | 0.05 % published, 0 % in the catalog | 0.05 % published, 0.04 % or 400 ppm in the catalog | S1, P1 |

The published schedule names one flat rate, "All Users" 0.05 % maker and 0.05 % taker, "with no tier levels or application required", S1.
CoinMarketCap shows the same 0.05 % and 0.05 %, S13.
The web app's catalog agrees on the 244 crypto and metal contracts and disagrees on the 169 stock contracts, which carry `defaultTakerFeeRateE8` `"40000"` and `defaultMakerFeeRateE8` `"0"`, P1.
Those fields are what an anonymous visitor is served, and the fill an account pays is Not verified.
This profile takes 500 ppm as the VIP 0 taker.

## 3. Coverage matrix

| product | present | count on 2026-10-10 UTC | source |
|---|---|---|---|
| USDT-M perpetuals (`LinearPerpetual`) | yes | 413, all `contractStatus` `Trading`: 239 crypto, 169 stock and 5 metal (`symbolCategory` `gold`) | P1 |
| USDC-M perpetuals | no | 0. `SupportedCoins` names only USDT and USDX | P1 |
| coin-M or inverse perpetuals (`InversePerpetual`) | no | 0, the key exists and is empty | P1 |
| dated futures (`InverseFutures`) | no | 0, the key exists and is empty | P1 |
| demo perpetuals (`FreeUPerpetual`) | yes, not tradable for money | 6, quoted in the demo coin USDX, such as `BTCUSDX` | P1, S12 |
| block trade perpetuals (`BlockTradePerpetual`) | yes, separate product | 4, `XAUUSD`, `XAGUSD`, `UKOUSD` and `USOUSD`, quoted in USD with contract sizes 1000, 1000, 100 and 2500 | P1 |
| stock and metal RWA families | no | `StockRwaPerpetual` and `MetalRwaPerpetual` exist and are empty | P1 |
| options | no | none in the catalog or the help center index | P1, S12 |
| spot | yes | 249 pairs, 244 USDT and 5 USDC | P1 |

The stock perpetuals such as `TSLAUSDT`, `NVDAUSDT` and `AAPLUSDT` take their index from one source named `BinanceFuture`, see [`rest.md`](./rest.md) section 4.
CoinMarketCap showed about 2.31 billion USD of 24 h perpetual volume, about 209 million USD of 24 h spot volume and about 176 million USD of open interest at its 2026-10-10 02:14 UTC update, S13.

## 4. Perpetual tiers

None are published.
The schedule says "Fees are applied at a flat rate, with no tier levels or application required. The same rate applies to both opening and closing positions.", S1.
The About Us page mentions "Tiered fee structures tailored to different trading needs" without a table, S11.
The YUBIT tier table call `GET /mapi/desk/vipfee/config` and the fee call `GET /mapi/trade/public/v1/market/fee-rate` both answered 404 with an empty body on this host, P1.

## 5. Discounts that change the perpetual taker

| discount | finding | source |
|---|---|---|
| token holding | none. The help center index has no platform token or fee token | S12 |
| referral | an invite campaign pays PEPE rewards, and no referral discount on the trader's own taker rate is published | S12 |
| market maker | not published | S12 |
| zero fee promotion | none published. The catalog's stock contracts carry a maker fee of 0, see section 2 | S1, P1 |
| first order reward | "complete the first order and receive 10 USDT" on futures, a bonus and not a rate | S12 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate = Clamp(MA(((Best Bid + Best Ask) / 2 - Spot Index Price) / Spot Index Price - Interest), a, b)", with "Interest is currently set to 0" | S4 |
| cap and floor | `a` and `b` "vary by currency pair and are subject to change in real time", and the catalog has no cap field | S4, P1 |
| fee | "Funding Fee = Position Value x Current Funding Rate" | S4 |
| who pays | "When the funding rate is positive: Long positions pay short positions. When the funding rate is negative: Short positions pay long positions." Peer to peer, "EasiCoin does not collect any funding fees" | S4 |
| who is charged | "Funding fees are only due if a position is held at the time of collection." | S4 |
| interval | "common intervals being 8 hours and 4 hours", around 08:00, 16:00 and 24:00 HKT | S4 |
| settled instants | `BTCUSDT`, `ETHUSDT`, `SOLUSDT` and `DOGEUSDT` settled every 8 h at 00:00, 08:00 and 16:00 UTC on each of the 100 rows returned | P3 |
| settled rates seen | `BTCUSDT` +0.01 % on 59 of 100 and -0.01 % on 9, `ETHUSDT` +0.01 % on 67 and -0.01 % on 7, `SOLUSDT` +0.01 % on 36 and -0.01 % on 24, `DOGEUSDT` +0.01 % on 93 and -0.01 % on 7 | P3 |

The settlement instant itself was not captured, so whether the settled rate equals the last published one is Not verified.
The published rate and its units are in [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

- Liquidation triggers on the mark price, S5.
- "Liquidation occurs when the mark price reaches the liquidation price. At this point, the exchange will close the position at the bankruptcy price", S6.
- No separate liquidation fee is published, S6.
- "if a contract is taken offline before settlement, no funding fee is due for that period.", S4.
- The catalog's `OfflineSymbols` lists one closed contract, `MKRUSDT` with `contractStatus` `Closed`, P1.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 class | none. The exchange map in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` lines 232 to 337 runs `'dydx'` on line 286 to `'exmo'` on line 287 with no EasiCoin id, and `js/src/` has no file matching `easi` | this host |
| CCXT master | none. `ts/src` on master at commit `f0aca06` (2026-10-08) has no file matching `easi`, and `ts/ccxt.ts` has no match either | S14 |
| `market.taker` | none, since no class exists | |

## 9. Recommended registry values

EasiCoin should not be added to the registry today, see [`rest.md`](./rest.md) section 8.
If a documented API is ever granted and the venue is added, the values are these.

| field | value | reason |
|---|---|---|
| `takerPpm` | 500 | the flat published taker in S1 and S2, and the catalog value on the 244 crypto and metal contracts |
| `ccxtTakerPpm` | unset | no CCXT class exists |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | EasiCoin Futures Trading Fee Schedule | https://docs.easicoin.io/english/future-trading/easicoin-futures-trading-fee-schedule | 2026-10-09 | EasiCoin, global | flat 0.05 % maker and taker, no tiers, sections 2 and 4 |
| S2 | Contract Trading Fees | https://docs.easicoin.io/english/future-trading/transaction-fee | 2026-10-09 | EasiCoin, global | 0.05 % and 0.05 %, fee formula, section 2 |
| S3 | EasiCoin Spot Trading Fee Explanation | https://docs.easicoin.io/english/spot-trading/easicoin-spot-trading-fee-explanation | 2026-10-09 | EasiCoin, global | spot 0.10 % maker and taker, named for completeness |
| S4 | What is Funding Fee? | https://docs.easicoin.io/english/other-help/frequently-faq/futures-faq/what-is-funding-fee | 2026-10-09 | EasiCoin, global | funding formula, interval, payer, sections 6 and 7 |
| S5 | Latest Price and Mark Price Explanation | https://docs.easicoin.io/english/other-help/frequently-faq/futures-faq/latest-price-and-mark-price-explanation | 2026-10-09 | EasiCoin, global | liquidation on mark, section 7 |
| S6 | Liquidation Price Calculation (USDT Contract) | https://docs.easicoin.io/english/other-help/frequently-faq/futures-faq/liquidation-price-calculation-usdt-contract | 2026-10-09 | EasiCoin, global | bankruptcy price close, section 7 |
| S7 | EasiCoin Service Jurisdiction Disclaimer | https://docs.easicoin.io/english/other-help/easicoin-service-jurisdiction-disclaimer | 2026-10-09 | EasiCoin, global | restricted jurisdictions, section 1 |
| S8 | Terms of Service | https://docs.easicoin.io/english/other-help/terms-of-service | 2026-10-09 | EasiCoin, global | eligibility, scraping clause, operator wording, section 1 |
| S9 | User Agreement | https://docs.easicoin.io/english/other-help/user-agreement | 2026-10-09 | EasiCoin, global | bots and arbitrage clause, section 1 |
| S10 | Derivatives Trading Rules | https://docs.easicoin.io/english/future-trading/derivations-trading-rules | 2026-10-09 | EasiCoin, global | arbitrage clauses, section 1 |
| S11 | About Us and Compliance and Licensing | https://docs.easicoin.io/english/other-help/about-us and https://docs.easicoin.io/english/other-help/licensed-and-compliant | 2026-10-09 | EasiCoin, United States FinCEN registration | MSB registration, tier wording, sections 1 and 4 |
| S12 | Help center index | https://docs.easicoin.io/llms.txt and https://docs.easicoin.io/english/sitemap-pages.xml | 2026-10-09 | EasiCoin, global | no API section, products, campaigns, sections 3 and 5 |
| S13 | CoinMarketCap exchange page, data updated 2026-10-10 02:14 UTC | https://coinmarketcap.com/exchanges/easicoin/ | 2026-10-09 | CoinMarketCap | country, launch date, 0.05 % and 0.05 %, volume and open interest, sections 1 to 3 |
| S14 | CCXT master `ts/src` listing and `ts/ccxt.ts` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-10-09 | CCXT | no EasiCoin class, section 8 |
| S15 | EasiCoin home page, API card text | https://www.easicoin.io/en-US | 2026-10-09 | EasiCoin, global | API access enabled by support on request, intro |
| P1 | `rest-probe.py catalog` | [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | catalog, fee fields, families, sections 2 to 4 and 7 |
| P2 | `rest-probe.py access` | [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | status codes and region answers, section 1 |
| P3 | `rest-probe.py anchor` | [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | funding history, section 6 |
