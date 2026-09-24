# UZX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:37 to 07:07 UTC over two passes), from the development host near Seattle, through its Surfshark WireGuard exit that geolocates to Canada.

This profile covers the perpetual swaps of UZX, which has no CCXT id.
UZX lists two perpetual families: USDT-margined swaps, which the API calls `SWAP`, and coin-margined swaps, which it calls `BASE`.
Every access result below is from that Canadian VPN exit, never from a US address.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "UZX.COM. ... is a company registered in the Cayman Islands under Cayman Islands law, and it operates the website http://www.uzx.com" | S6, law enforcement guideline text |
| other entity named | "Universal Zone Exchange Limited", company number 1403704-9, MSB 31000236749585, in the Chinese about-us text | S6 |
| terms of service | help article 307, "Terms of Service", created 2024-02-04, no revision date on the page | S3 |
| restricted areas | "the United States, Malaysia, Ontario (Canada), and any other locations that UZX Operators may designate from time to time" | S3, section 2b(e) |
| sanctions clause | users warrant they are not on UN sanctions lists, the OFAC SDN list or the US Commerce Entity List | S3, section 1d |
| who may trade the perpetuals | any registered adult outside the restricted areas, since the terms say contract trading is open after account registration "unless otherwise specified by UZX" | S3, section 3.3 |
| US persons | may not trade, the United States is a restricted area | S3 |
| fee schedule retrieved | 2026-09-23 07:07 UTC from the public VIP list call, whose seven rows were last updated on 2026-03-12 between 08:52 and 08:58 UTC | S2, P1 |

The fee schedule has no standalone page.
The VIP page at `https://www.uzx.com/vip` is a single page app that renders the public call `GET https://api.uzx.com/uc/v2/vip/list`, S2.
CoinMarketCap links a fee page at `https://uzx.com/#/TransactionRate`, S8, and neither the current web client nor the v1 app declares a route of that name, S4 and S6.
The web client also posts `/content/limit/region/judgeByIp` on load, and from this host it answered HTTP 401 `{"code":401,"msg":"The current login status has expired, please login again!"}`, so the site's own region verdict needs a login, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals (`SWAP`) | 0.04 %, 400 ppm | 0.05 %, 500 ppm | S2, level 1 `uMakerFee` `"0.00040000"`, `uTakerFee` `"0.00050000"` |
| coin-M perpetuals (`BASE`) | 0.04 %, 400 ppm | 0.05 %, 500 ppm | S2, level 1 `coinMakerFee` `"0.00040000"`, `coinTakerFee` `"0.00050000"` |

UZX names its base tier level 1, and level 1 requires 0 UZX held and 0 volume, so it is the tier a new account starts on.
The 2024 help article "BTC/USDT USDT-M Trading Rules" still says "Maker Fee Rate: 0.04%" and "Taker Fee Rate: 0.06%", S5.
That article also gives a contract size of 0.01 BTC where the live catalog says 0.001, so it is stale and the VIP list is the number of record.

## 3. Coverage matrix

| product | present | count on 2026-09-23 | source |
|---|---|---|---|
| USDT-M perpetuals | yes | 60, all `status` 1 (active) and `front_hidden` false | P1 `catalog`, `/v2/products` and `/v2/info/swap-usdt/symbols` |
| USDC-M perpetuals | no | 0, the only swap quote is USDT | P1 |
| coin-M perpetuals | yes | 6: BTCUSD, ETHUSD, DOGEUSD, XRPUSD, SOLUSD, LTCUSD, 100 USD per contract | P1 |
| TradFi perpetuals | one | `XAUUSDT` (gold) is a USDT-M swap | P1 |
| dated futures | no | the catalog has only `SPOT`, `SWAP` and `BASE` | P1, S1 `ins_type` enum |
| options | no in the API | the terms and help articles 120, 122 and 193 of 2023 and 2024 describe option and "seconds" contracts, and no such instrument is in the catalog | S3 section 3.4, P1 |
| spot | yes | 85 `SPOT` products, and the web client lists 5 tokenized stock spot pairs such as `NVDAX-USDT` | P1, `/v2/info/stockfi/symbols` |

CoinMarketCap's derivatives ranking of 2026-09-23 lists UZX at rank 37 with 38 derivatives market pairs and about 3M USD of open interest, S8.
The venue's own catalog has 66 perpetuals, so CoinMarketCap tracks only part of it.
UZX is not listed on CoinGecko, neither in `/api/v3/exchanges/list` nor in `/api/v3/derivatives/exchanges/list`, S9.

## 4. Perpetual tiers

All seven tiers from S2 as read by P1, fees as a fraction of notional.
The USDT-M and coin-M columns are identical on every tier.

| level | UZX held | spot 30 d volume, USDT | futures 30 d volume | USDT-M and coin-M maker | USDT-M and coin-M taker | spot maker | spot taker |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 | 0.00040 | 0.00050 | 0.0040 | 0.0050 |
| 2 | 1,000 | 200,000 | 2,000,000 | 0.00035 | 0.00045 | 0.0025 | 0.0045 |
| 3 | 5,000 | 500,000 | 5,000,000 | 0.00030 | 0.00040 | 0.0020 | 0.0040 |
| 4 | 10,000 | 1,000,000 | 10,000,000 | 0.00025 | 0.00035 | 0.0015 | 0.0035 |
| 5 | 50,000 | 5,000,000 | 50,000,000 | 0.00020 | 0.00030 | 0.0010 | 0.0030 |
| 6 | 100,000 | 10,000,000 | 100,000,000 | 0.00015 | 0.00025 | 0.0005 | 0.0025 |
| 7 | 300,000 | 50,000,000 | 500,000,000 | 0.00010 | 0.00020 | 0.0005 | 0.0020 |

### Qualification

"Upgrade requirements: meet the UZX holdings requirement, plus the 30-day trading volume requirement for either spot or futures.", S4 string `vip.upgradeRule`.
So a tier needs the UZX balance and one of the two volumes.
The page labels the holding column "Account UZX balance" and the futures volume column "Futures trading volume (30 days)" with no unit, S4.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | source |
|---|---|---|
| UZX token holding | part of the tier rule, no separate percentage discount | S2, S4 |
| fee payment in UZX | none found in the fee data or the web client strings | S2, S4 |
| referral | "When users you invite trade, you earn a rebate from their trading fees.", so the rebate goes to the inviter and the invitee's taker is unchanged | S4 string `earnHighRebateDesc` |
| market maker programme | the API docs section "Market Maker Application" says only "Stay tuned" | S1 |
| zero fee promotion | none found | S2, S4 |

The per contract `taker_fee` and `maker_fee` fields in `/v2/info/swap-usdt/symbols` are empty strings on all 66 perpetuals, P1.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "New Formula: Funding Rate = Clamp [Average Premium Index + Clamp (Interest Rate – Average Premium Index, 0.05%, –0.05%), Upper Limit, Lower Limit]" | S4 string `tradeMore.newFormula87LowerLimit` |
| previous formula | "Old Formula: Funding Rate = Clamp [MA(Premium Index – Interest Rate), Upper Limit, Lower Limit]" | S4 |
| recalculation | "Funding rate is calculated once per minute." | S4 |
| interval | 8 h on 58 perpetuals and 4 h on 8 (`ENAUSDT`, `0GUSDT`, `AVNTUSDT`, `PENGUUSDT`, `XPLUSDT`, `HYPEUSDT`, `ASTERUSDT`, `KAITOUSDT`), from the `cycle` field of the newest settlement, in both passes | P3 `funding` |
| settlement instants | 00:00, 08:00 and 16:00 UTC for 8 h contracts, and every 4 h from 00:00 UTC for 4 h contracts | P3, settlement hours seen in the last three rows of every contract |
| cap and floor | the page has a "Funding rate cap/floor" label and publishes no value | S4 |
| largest absolute settled rate seen | -0.01086412 on `ARKUSDT` at 2026-09-13 08:00 UTC, over the last 100 settlements of every perpetual | P3 |
| BTCUSDT over 100 settlements | from 2026-08-21 to 2026-09-23, min -0.00000182, max 0.0001, exactly 0.0001 on 26 of 100 | P3 |
| who pays whom | Not publicly specified in any source read | |

The published rate matches Binance USD-M.
On one read of both venues, the UZX `funding_rate` equalled Binance's `lastFundingRate` on 57 of 58 shared perpetuals, including all 7 whose rate was not 0.0001, 0.00005 or 0, P4 `compare`.
Two later reads matched on 56 of 58, and the one non-trivial miss both times was `XAUUSDT`, 0.0000698 against 0.00007018 and 0.00006773 against 0.00006761, P4.
UZX recalculates once a minute, so a lag of up to a minute behind Binance is expected, S4.
So the live number follows Binance's rate, not a premium computed from UZX's own book.
On 12 contracts, 22 of 33 and 24 of 36 settlement instants that both venues share carried the identical settled rate, P4.
Of two samples of 10 contracts that Binance runs at 4 h, UZX runs 9 and 8 at 8 h, P4.
If UZX takes a 4 h rate and charges it every 8 h, the carry per hour is half of Binance's, which is an inference that the settlement instant itself would confirm.
The settlement instant was not captured in this survey.

## 7. Liquidation, settlement and delisting

- No liquidation fee, settlement fee or delisting charge is published in S1 to S5.
- Liquidation gains and losses flow into a risk fund, whose statement types are "Risk fund injection from liquidation gains" and "Risk fund deduction for liquidation loss", S4, and the bulk ticker carries a `risk_fund` field, which read `"0"` on BTCUSDT, P2.
- The terms reserve "forced liquidation and automatic reduction" under platform rules that were not found as public text, S3 section 3.3.
- Eight delisted swaps still appear in the bulk ticker with a zero last price and no next funding time: `XPINUSDT`, `LISTAUSDT`, `UMAUSDT`, `COAIUSDT`, `POWRUSDT`, `PEOPLEUSDT`, `SANDUSDT`, `MYXUSDT`, P1.
  How their positions were closed is Not publicly specified.

## 8. CCXT

CCXT 4.5.68, installed in `server/node_modules`, has no UZX class.
`require('ccxt').exchanges` lists 104 ids and none matches `uzx`, and `server/node_modules/ccxt/js/src` has no file with that name, P1.
The CCXT master branch has none either: the GitHub listing of `ts/src` at commit `1c996ee` of 2026-09-23 05:45 UTC holds 112 entries and none matches, S7.
Issue #27085, "new exchange: uzx", is open since 2025-10-20 with the label "new exchange" and no comment, S7.
So `market.taker` cannot be read for any UZX market.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 500 | level 1 `uTakerFee` of 0.0005 in S2, the tier a new account starts on |
| `ccxtTakerPpm` | not set | no CCXT class exists, so no CCXT constant can be expected or cited |

A registry entry needs a catalog loader outside CCXT first, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | UZX API documentation, English, `last-modified` 2026-06-15 | https://www.uzx.com/v2/api/docs/en/index.html | 2026-09-23 | UZX, global | families, market maker note, sections 2 and 5 |
| S2 | VIP list call behind the VIP page | https://api.uzx.com/uc/v2/vip/list and https://www.uzx.com/vip | 2026-09-23 | UZX, global | every fee and tier number, sections 2 and 4 |
| S3 | Terms of Service, help article 307 | `POST https://api.uzx.com/content/ancillary/more/help/detail` with form body `id=307`, the call the site's `/terms` page makes | 2026-09-23 | UZX Operators, global | restricted areas, sanctions, contract trading, section 1 |
| S4 | UZX web client bundle, English strings `vip.*` and `tradeMore.*` | https://www.uzx.com/assets/js/index-Fr-xn0lT.js | 2026-09-23 | UZX, global | tier rule, funding formula, risk fund, sections 4 to 7 |
| S5 | Help article 135, "BTC/USDT USDT-M Trading Rules", created 2024-01-22 | same call as S3 with `id=135` | 2026-09-23 | UZX, global | stale fees and contract size, section 2 |
| S6 | UZX v1 web app bundle | https://www.uzx.com/v1/static/js/app.3724cf7a.js | 2026-09-23 | UZX.COM, Cayman Islands | operator and entity names, section 1 |
| S7 | CCXT master `ts/src` listing and issue #27085 | https://github.com/ccxt/ccxt/tree/master/ts/src and https://github.com/ccxt/ccxt/issues/27085 | 2026-09-23 | CCXT | section 8 |
| S8 | CoinMarketCap UZX page and derivatives ranking | https://coinmarketcap.com/exchanges/uzx/ and https://coinmarketcap.com/rankings/exchanges/derivatives/ | 2026-09-23 | CoinMarketCap | rank, pair count, open interest, fee link, sections 1 and 3 |
| S9 | CoinGecko exchange lists | https://api.coingecko.com/api/v3/exchanges/list and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 | CoinGecko | UZX not listed, section 3 |
| P1 | `rest-probe.mjs catalog`, three runs | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:37, 07:00 and 07:07 UTC | this host, Canadian VPN exit | catalog counts, VIP list, CCXT check, sections 1 to 5, 7, 8 |
| P2 | `rest-probe.mjs anchor` | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:39 and 07:01 UTC | this host | `risk_fund`, section 7 |
| P3 | `rest-probe.mjs funding`, two passes | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:40 and 07:02 UTC | this host | intervals, settlement hours, largest rates, section 6 |
| P4 | `rest-probe.mjs compare`, three runs | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:42, 06:43 and 07:03 UTC | this host | funding copied from Binance, section 6 |
