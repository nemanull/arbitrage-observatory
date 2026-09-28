# BitxEX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-24.

**Probed:** 2026-09-24, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

BitxEX is the rebranded XEX (CoinMarketCap slug `xex`, id 10946), whose CoinMarketCap notice reads "XEX has rebranded to BitxEX.", S1.
The survey plan dates this wave 2026-09-22, but the host clock and every server `Date` header read 2026-09-24 when these files were written, so that date is used.
BitxEX publishes no API documentation that this research could find, and CCXT has no class for it, see section 8.
The numbers below come from the help center, S2 to S5, and from the futures web app's own public JSON, P1.

## 1. Scope and freshness

| item | finding | source |
|---|---|---|
| website | `https://bitxex.io/`, from the CoinMarketCap record | S1 |
| other domains | `bitxex.com` has an SOA at `hichina.com` (Alibaba Cloud DNS) and no A record. `xex.vip`, the domain in CoinMarketCap's market URLs, resolves to 8.222.88.231 and timed out after 25 s | `dig` and `curl` on 2026-09-24 |
| legal entity | none named in the help center articles read | S2 to S6 |
| who may trade | not stated. The risk disclaimer says only that some products "may not be available to specific countries, regions or types of users" | S6 |
| US persons | no exclusion found. The help center carries a guide to installing the app from the US App Store, article 45948863368857 | help center search, 2026-09-24 |
| operations | a statement dated 2026-08-03 and updated 2026-09-10 says registration, deposits, withdrawals, spot and futures trading and "API 服务" run normally | S7 |
| CoinMarketCap flags | the perpetual market pairs carry `priceExcluded: 1` and `volumeExcluded: 1` | S1 market pairs call |

Access from this host went through the Canadian VPN exit.
The website and the futures JSON answered with HTTP 200 through a Cloudflare edge in Vancouver (`cf-ray` suffix `YVR`), with no geoblock, but a reply took from 0.25 s to 50 s or timed out at 60 s, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.04 %, 400 ppm | 0.04 %, 400 ppm | S2 lists 0.04 % / 0.04 % on every listed pair. The catalog's `makerFee` and `takerFee` are `"0.0004"` on 248 of 254 symbols, P1 |
| spot | 0.1 %, 1,000 ppm | 0.1 %, 1,000 ppm | S2, not probed |

No VIP tier table was found.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 252 with `contractType` `PERPETUAL`, `state` 0 and `tradeSwitch` true | P1 |
| coin-M perpetuals | the web app calls a `/dapi` family, but its symbol list returned 0 rows | P1 |
| event contracts | 2, `btcevent_usdt` and `ethevent_usdt`, `contractType` `EVENT` | P1 |
| TradFi perpetuals | listed inside the USDT-M family, for example `sndk_usdt`, `pdd_usdt`, `arm_usdt`, `aaoi_usdt` | P1, help center launch notices of 2026-08 and 2026-09 |
| dated futures | none seen | P1 |
| options | none seen | P1 |
| spot | yes, named only | S2 |

CoinMarketCap reported 228 perpetual market pairs on 2026-09-24, S1.

## 4. Perpetual tiers

No tiered perpetual fee schedule was found.
S2 lists one maker and taker pair per symbol, 0.04 % and 0.04 %.
The catalog carries a per symbol fee, and six symbols differ from 0.0004 and 0.0004, P1.

| symbol | `makerFee` | `takerFee` |
|---|---|---|
| `btcevent_usdt`, `ethevent_usdt` | 0.0002 | 0.0006 |
| `be_usdt`, `arm_usdt` | 0.0004 | 0.00004 |
| `aaoi_usdt` | 0.0003 | 0.0003 |
| `pdd_usdt` | 0 | 0.0004 |

The 40 ppm taker on `be_usdt` and `arm_usdt` may be a typo in the venue's configuration and was not checked against a trade.
The web bundle calls `/user/v1/user/step-rate/getStepRates`, which suggests a private fee step table behind login, not probed.

## 5. Discounts that change the perpetual taker

None found.
No token holding, referral or market maker discount is described in S2.

## 6. Funding as a cost

| item | documented | probed |
|---|---|---|
| formula | a premium index sampled every minute and averaged over the 8 h period, applied at the next settlement, S3 | Not verified |
| interval | every 8 h at 08:00, 16:00 and 24:00 UTC+8, which is 00:00, 08:00 and 16:00 UTC, S4. S5 adds that some symbols settle every 4 h | `funding-rate` for `btc_usdt` returned `fundingRate`, `collectionInterval` and `nextCollectionTime` all `null`, and `funding-rate-record` returned an empty list, P2 |
| cap and floor | Not publicly specified | Not verified |
| who pays | longs pay shorts on a positive rate, only positions held at the settlement instant, S4 | Not verified |

The settlement instant itself was not captured.
The web API published no funding rate for `btc_usdt` on 2026-09-24, so whether funding is charged at all today is an open question.

## 7. Liquidation, settlement and delisting

The catalog field `liquidationFee` is `"0"` on `btc_usdt` and `"0.0001"` on five symbols, P1.
S2 publishes a maintenance margin table from 0.25 % at 200x to 100 % at 1x.
Its second row, 0.80 % at 125x, is above the third row, 0.50 % at 100x, as published.
No settlement or delisting charge was found.

## 8. CCXT

CCXT 4.5.68 has no BitxEX class.
`require('ccxt').exchanges` has 104 ids and none matches `bitx` or `xex`, P1.
The current CCXT master on GitHub, `ts/src`, lists 111 entries and none is BitxEX, only `xt.ts`, S8.
The futures web API has the path layout of XT.com's futures API (`/market/v1/public/q/agg-tickers`, `contractSize`, `underlyingType` `U_BASED`), but the host differs and CCXT's `xt` class cannot be pointed at it without an override, see [`rest.md`](./rest.md) section 2.
So `market.taker` from CCXT does not exist for this venue.

## 9. Recommended registry values

None today, because the venue cannot join the engine in its current shape, see [`rest.md`](./rest.md) section 8.
If it ever does, `takerPpm` would be 400 from S2 and the catalog, and `ccxtTakerPpm` has no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap exchange detail and perpetual market pairs, slug `xex` | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=xex and https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=xex&category=perpetual | 2026-09-24 | CoinMarketCap | rebrand, website, 228 perpetual pairs, excluded price and volume, sections 1 and 3 |
| S2 | BitxEX费率说明 (fee description), updated 2026-02-12 | https://bitxex2019.zendesk.com/hc/zh-sg/articles/45004083402393 | 2026-09-24 | BitxEX | spot and perpetual fees, maintenance margin, sections 2, 4 and 7 |
| S3 | 合约交易术语 (contract terms), updated 2025-04-23 | https://bitxex2019.zendesk.com/hc/zh-sg/articles/45108124541209 | 2026-09-24 | BitxEX | funding formula, mark and index definitions, section 6 |
| S4 | 永续合约基础知识 (perpetual basics), updated 2026-09-12 | https://bitxex2019.zendesk.com/hc/zh-sg/articles/45028002451993 | 2026-09-24 | BitxEX | settlement times, who pays, section 6 |
| S5 | 合约交易规则 (contract trading rules), updated 2026-09-12 | https://bitxex2019.zendesk.com/hc/zh-sg/articles/45027931186969 | 2026-09-24 | BitxEX | 4 h settlement on some symbols, section 6 |
| S6 | 风险提示及免责声明 (risk and disclaimer), updated 2026-09-11 | https://bitxex2019.zendesk.com/hc/zh-sg/articles/61383224831897 | 2026-09-24 | BitxEX | regional availability wording, section 1 |
| S7 | 官方声明 (operations statement), updated 2026-09-10 | https://bitxex2019.zendesk.com/hc/zh-sg/articles/60723955806873 | 2026-09-24 | BitxEX | services running, section 1 |
| S8 | CCXT master `ts/src` listing | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-24 | CCXT | no BitxEX class, section 8 |
| P1 | `rest-probe.mjs catalog` at 06:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitxex/rest-probe.mjs) | 2026-09-24 | this host | catalog counts and fee pairs, CCXT ids, sections 2 to 4, 7 and 8 |
| P2 | `rest-probe.mjs anchor` at 06:51 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitxex/rest-probe.mjs) | 2026-09-24 | this host | funding replies, section 6 |
