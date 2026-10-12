# CRMClick Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 04:15 to 04:33 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers the USDT-margined perpetuals that CRMClick, which also brands itself CERRAM META and CRM Exchange, sells at `crmclick.io`.
CRMClick has no CCXT class, so the folder is the slug `crmclick`.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/crmclick/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/crmclick/rest-probe.py).

The finding that governs every section: CRMClick's perpetuals are HTX's USDT-margined swaps.
All 69 rows of its futures catalog carry `"platform":"huobi"` and HTX's own contract sizes, and its futures book is HTX's book, level for level, see [`rest.md`](./rest.md) sections 2 and 5.
Its web app opens HTX's swap socket for the perpetual page and runs no perpetual socket of its own, see [`websocket.md`](./websocket.md) section 1.
439 of its 449 spot markets also carry `"platform":"huobi"`, the one compared, BTCUSDT, showed HTX's spot book, and only 10 are matched in house.
The fee numbers below are what CRMClick publishes, and no fill can be observed without an account.

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-10-09 | this profile |
| legal entity | Not publicly specified. No page read names a company, a registration or a jurisdiction. | S1, S5 |
| CoinMarketCap record | id 28370, launched 2022-11-17, described as offering "spot trading and block trade matching", no countries and no fiat listed | S1, `fees-probe.py` section "CoinMarketCap exchange record" |
| what it sells | spot, and USDT-margined perpetuals through the web app's `/futures` route, 69 contracts on 2026-10-10 | S5, [`rest.md`](./rest.md) section 2 |
| who may trade | Not publicly specified. The web app has identity verification routes `realname`, `realname-jp` and `realname-ko`, and every account call answers `{"code":10001,"msg":"用户未登录"}` (not logged in) without a session. | S5, `fees-probe.py` section "account-gated fee calls" |
| regions excluded | Not publicly specified. No terms of service or restricted country list was found in the help center or the web app bundle. | S2, S5 |
| access from this host | every CRMClick host answered from the Canadian exit, with no geoblock and no refusal | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| family | maker | taker | evidence |
|---|---|---|---|
| USDT-margined perpetuals, all 69 | 0.02% (200 ppm) | 0.02% (200 ppm) | Published, S3, "合约交易 统一费率：0.02%" (contract trading, unified rate 0.02%) |

The fee article dated 2025-09-09 gives one rate for contracts and says fees may change with the market and with campaigns, and that the trade page is authoritative, S3.
The futures catalog carries no fee field, by `rest-probe.py` section 2, so the trade page's number could not be read without an account.
CoinMarketCap's record shows `makerFee` 0.02 and `takerFee` 0.02, which matches the contract rate in percent, S1.
HTX, whose book CRMClick shows, lists a Prime 0 taker of 0.06% on its USDT-margined perpetuals, see [`../htx/fees.md`](../htx/fees.md) section 2.

Spot is outside the researched product, but its two sources disagree and both are recorded.
The fee article says spot "Maker（挂单）：0.20% Taker（吃单）：0.45%", S3.
Every one of the 449 rows of `GET spot/market` carries `"maker_fee":0.0002,"taker_fee":0.00045`, which read as fractions are 0.02% and 0.045%, ten times lower, by `fees-probe.py` section "catalog fee fields".

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes, 69 contracts, all `"platform":"huobi"` | [`rest.md`](./rest.md) section 2 |
| USDC-margined perpetuals | no, every row has `"money":"USDT"` | `rest-probe.py` section 2 |
| coin-margined (inverse) perpetuals | no in the catalog. Help center articles copied from another venue describe coin-margined contracts, S4, but no coin-margined row exists. | S4, `rest-probe.py` section 2 |
| dated futures | no, no route, call or catalog row | S5 |
| options | no live product. The web app has an `optionBalance` wallet route and no option catalog call. | S5 |
| spot | yes, 449 USDT pairs, 439 routed to HTX and 10 matched in house, not detailed here | [`rest.md`](./rest.md) section 2 |
| copy trading, bots | yes, routes `copy`, `follow`, `expert` and a `robotWallet` | S5 |
| deposit, withdrawal | the withdrawal table lists USDT with a 10 USDT fee per withdrawal, S6. The fee article says withdrawal fees are computed per token and network, S3. | S3, S6 |

## 4. Perpetual tiers

None published.
The fee article gives a single unified contract rate and no tier table, S3.
No public call returns a tier, and the leverage and account calls need a login, by `fees-probe.py` section "account-gated fee calls".

## 5. Discounts

| discount | value | evidence |
|---|---|---|
| token holding | Not offered. No fee token is named. | S3 |
| referral | Not publicly specified. The web app has `invite`, `referral`, `agency` and `kickback` routes and calls. | S5 |
| market maker | Not publicly specified | S1, S3 |
| zero fee promotion | Not offered on 2026-10-09. A 100% fee rebate for App trades ran until 2025-04-17 23:59 UTC+8 and has ended. | S7 |

## 6. Funding as a cost

CRMClick's article "资金费用机制" (funding fee mechanism) says perpetuals settle funding every 8 hours, at 00:00, 08:00 and 16:00, S4.
A second article puts those instants in GMT+8, which is 16:00, 00:00 and 08:00 UTC, S4.
Its formula is funding fee = net position in contracts times contract face value divided by settlement price times funding rate, and the rate is an interest component of 0.01% per period plus a premium index sampled every 5 s, S4.
Both articles describe coin-margined contracts, which CRMClick does not list, so they do not speak for its USDT-margined contracts.
The trade page reads `funding_rate` and `funding_time` from `GET futures/huobiMarketPatch`, which needs a login, see [`rest.md`](./rest.md) section 3.
So the rate CRMClick charges is Not publicly specified, and the only public funding numbers for these contracts are HTX's own, see [`../htx/rest.md`](../htx/rest.md).
No cap or floor is published, and no settlement instant was captured.

## 7. Liquidation, settlement and delisting charges

Not publicly specified.
The perpetual help articles describe forced liquidation, an insurance fund and auto-deleveraging in general terms and give no fee, S4.
The rules article says trading pauses per asset during each funding settlement, S4.
The 2025-03 rebate terms warn that wash trading or abuse of the rebate leads to cancelled rebates and possible account limits or bans, S7.

## 8. CCXT

CRMClick has no class in CCXT 4.5.68.
The installed source directory, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, holds 104 `.js` files, and none contains the string "crmclick" or "cerram", by `fees-probe.py` section "CCXT".
CCXT master at commit f0aca06 of 2026-10-08 has no `ts/src/crmclick.ts` (HTTP 404), and `ts/ccxt.ts` there does not mention it.
So there is no `market.taker` to read and no `ccxtTakerPpm`.
The source venue has a class, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/htx.js`, and the HTX profile covers it.

## 9. Recommended registry values

None.
The venue is blocked as a perpetual leg because its perpetuals are HTX's, see [`websocket.md`](./websocket.md) section 8.
If it were ever added, `takerPpm` would be 200 from the fee article, and `ccxtTakerPpm` would not apply because there is no CCXT class.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=crmclick` | id 28370, launch date, description, fee URL, fee placeholders, zero derivative volume |
| S2 | `https://crmclickcs.zendesk.com/api/v2/help_center/zh-cn/articles.json`, 363 articles, and its search for API, 合约, 资金费率, 永续 and 条款 | the article list, no terms or region page |
| S3 | `https://crmclickcs.zendesk.com/hc/zh-cn/articles/50541961952281`, "CRMClick 手续费", updated 2025-09-09, the fee URL CoinMarketCap lists | spot 0.20% and 0.45%, contracts 0.02% |
| S4 | articles 38712658869529 "资金费用机制" and 33696063772825 "币本位永续合约交易规则", updated 2024-10-11, and 30410161135001 "永续合约常见问题" | funding schedule and formula, leverage, settlement pauses |
| S5 | `https://crmclick.io/assets/index.b5aeda38.js`, the web app entry bundle, and `index.5a4f90d9.js`, the perpetual trade page chunk | routes, API base `https://api.crmclick.io/`, sockets, `huobiMarketPatch` funding call |
| S6 | article 50542239094425 "提币限额&提币手续费", 2025-09-09 | USDT withdrawal fee 10 |
| S7 | article 44326732549913, App Store launch rebate, updated 2025-03-20 | 100% rebate until 2025-04-17, abuse clause |
| S8 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` and `https://github.com/ccxt/ccxt` at f0aca06 | no CRMClick class |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/crmclick/fees-probe.py) | every probed fee number |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/crmclick/rest-probe.py) | catalog fields, account-gated calls |
