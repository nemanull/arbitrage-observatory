# Echobit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:29 to 07:09 UTC), from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers perpetual trading on Echobit, which has no CCXT class, see section 8.
Spot, deposit, withdrawal, card and earn schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/echobit/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/echobit/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 local time for every source row | | source ledger |
| legal entity | Not publicly specified. The user agreement says "the company and the website together will be referred as 'we'" and names no company. | Not publicly specified | S4 |
| registrations claimed | The homepage says "Echobit is licensed as a Money Services Business (MSB) in both the United States and Canada, regulated by FinCEN and FINTRAC respectively." A 2025 announcement claims a Czech VASP registration. Neither claim was checked against the FinCEN, FINTRAC or Czech registers. | Published, not verified | S9, S12 |
| country on CoinMarketCap | `SG` | Published | S10 |
| restricted locations | "China, Russia, the United Arab Emirates, Barbados, Bangladesh, Burkina Faso, the Democratic Republic of the Congo, Cameroon, Gibraltar, Croatia, Haiti, Indonesia, Kenya, North Korea, the Cayman Islands, Laos, Monaco, Mali, Myanmar, Mozambique, Namibia, Nepal, Panama, Palau, Sudan, Senegal, Seychelles, Tanzania, Ukraine, Uganda, Venezuela, Yemen, and South Africa", clause 3.3.4 of the user agreement updated 2026-09-21 | Published | S4 |
| who may trade the perpetuals | An account holder outside the restricted locations. The United States and Canada are not on the list, so the agreement does not exclude US or Canadian persons. No page read says whether derivatives are offered to US persons, so that is Not publicly specified. | Region-specific | S4 |
| website from this host | `www.echobit.com` answered 200 and redirected to `/en-us`. `support.echobit.com` and `echobit.gitbook.io` answered 200. | Probed | `curl` on 2026-09-22 |
| public API from this host | `uapi.echobit.com` answered every public REST call with 200, and both public sockets opened with 101 in 499 to 862 ms. No call was refused. | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 5 |

All access results were taken from the Canadian VPN exit named in the Probed line, not from a US address.
Reading public market data is not an account service, and the API served it with no key, no cookie and no challenge.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M perpetuals, crypto and TradFi | 0.02 % = 200 ppm | 0.06 % = 600 ppm | Published | S1 ("Maker (pending orders) Fee: 0.02%", "Taker (filled instantly) Fee: 0.06%", updated 2026-09-11), S2 (image table "USDT Futures 0.02% 0.06%"), S5 ("Maker: 0.02%", "Taker: 0.06%") |

CoinMarketCap lists the same pair, `makerFee` 0.02 and `takerFee` 0.06, in S10.
No page separates TradFi perpetuals from crypto perpetuals, and S5 lists both under one rate.
The engine models a taker cross at the base retail tier, so 600 ppm is the number that matters.

## 3. Coverage matrix

| product | present | count on 2026-09-23 UTC | evidence |
|---|---|---:|---|
| USDT-M perpetuals, crypto | yes | 98 visible | Probed, `GET /uapi/contract/list`, `showState` true and `baseId` 1, minus the TradFi tag |
| USDT-M perpetuals, TradFi (stocks, metals, oil) | yes | 26 visible: `AAPL AMD AMZN AVGO BZ CL COIN CRCL GOOGL HYUNDAI INTC KORU MRVL MSFT MSTR MU NVDA QCOM SAMSUNG SKHYNIX SNDK SPCX SPY TSLA XAG XAU` | Probed, tag `TradFi` from the website's `/mainapi/symbol/tag/list` |
| hidden USDT-M rows | listed, not tradable on the site | 74, delisted ones such as `CATI` and `CFX` and scheduled ones such as `ZHIPU` (2026-09-24), `HOOD` (2026-10-01), `BRKB` (2026-10-08) | Probed, `showState` false, S6 |
| simulation contracts | listed | 2, `TBTC-SWAP-TUSDT` and `TETH-SWAP-TUSDT`, `baseId` 2 `CONTRACT_SIMULATION` | Probed |
| USDC-M or coin-margined perpetuals | no | 0 | Probed, every row has quote `USDT` or `TUSDT` |
| dated futures | no | 0 | Probed, every row is `-SWAP-`, and the site navigation from `/mainapi/base/nav/config` names Markets, Spot, USDT-M Futures, Futures, Trading Bots, Copy Trading and Earn, and no delivery or options product |
| options | no | 0 | same |
| spot | yes, not detailed | 249 rows in `GET /uapi/spot/list`, 135 spot tickers | Probed |

The survey's reading of CoinMarketCap's derivatives ranking on 2026-09-23 gives 119 market pairs and about 8,474 million USD of open interest, against 124 visible USDT-M rows on the wire and the 8.30 billion USD the exchange page reported at 05:24 UTC (S10).
Spot trades at 0.20 % maker and 0.20 % taker on every pair (S2).
Deposit, withdrawal and earn schedules are looked up in the help center at `support.echobit.com`.

## 4. Perpetual tiers

No VIP tier table was found.
The fee article S1, the fee announcement S2 and the product announcement S5 each give one maker and one taker rate and no tiers.
Help center searches for "VIP", "VIP level" and "fee tier" returned no tier schedule (S13).
So the tier table and its qualification rule are Not publicly specified.

## 5. Discounts that change the perpetual taker

| discount | value | label | evidence |
|---|---|---|---|
| platform token | none found | Not publicly specified | no token discount named in S1, S2 or S8 |
| referral and agent | "Commissions are typically calculated based on the trading fees generated by users. The exact rate depends on agent level or promotional rules." | Published, no rate | S8 |
| fee discount | "Some users or campaigns may offer trading fee discounts. The discount rate is usually determined by account level, campaign participation, or platform rules." | Published, no rate | S8 |
| market maker program | none found | Not publicly specified | |
| zero fee promotion | none found for perpetuals. A spot fee cashback campaign was announced on 2026-09-22 | Published | help center search, S13 |

None of these changes the retail VIP 0 taker the engine models.

## 6. Funding as a cost

| item | documented | probed |
|---|---|---|
| formula | Funding Rate (F) = P + clamp(I − P, −0.05%, 0.05%), with I the interest rate and P the premium index, S1 | not reproduced from the wire |
| interest rate | "0.03% per day (or 0.01% per funding interval)", S1 | 30 of 124 visible rows read exactly `0.0001` on both runs |
| premium index | [Max(0, Impact Buy Price − Spot Price) − Max(0, Spot Price − Impact Sell Price)] / Spot Price, impact notional 4,000 USDT, computed every second and time weighted to the funding timestamp, S1 | not reproduced |
| interval | "every 1 hour, 2 hours, 4 hours, or 8 hours", S1 | from `nextSettleTime − settleTime`: 66 visible rows on 4 h, 57 on 8 h and 1 (`AAPL-SWAP-USDT`) on 12 h, which S1 does not list. One hidden row was on 1 h |
| cap and floor | Not publicly specified | visible rates ranged from −0.00241 to +0.00078 in one run and −0.00238 to +0.00080 in the other. 12 hidden rows, among them `SHIB`, `TON` and `STPT`, read exactly `-0.02` |
| who pays | "In a bullish market, the funding rate is positive, and long position holders pay funding fees to short position holders", S1 | |
| fee | Funding Fee = Position Notional Value × Funding Rate, with notional = Mark Price × Position Size, S1 | |
| retained by the venue | "Echobit does not charge or retain any portion of funding fee payments.", S1 | |
| who is charged | "Funding fees are exchanged directly between traders who hold positions at the funding timestamp.", S1 | |
| settlement instants | shown on the trading page only, S1 | read at 06:33 UTC: the 66 rows on 4 h last settled at 04:00 and next at 08:00 UTC. The 8 h rows run on two phases, `BTC`, `ETH`, `XRP`, `SOL` and `PI` last at 04:00 and next at 12:00 UTC, the other 52 last at 00:00 and next at 08:00 UTC. `AAPL` last at 20:00 and next at 08:00 UTC |

The published rate is a fraction per interval, not per 8 h.
The instant of a settlement itself was not captured, and no public funding history endpoint exists, so which of `fundRate` and `settleRate` is charged at the next instant is inferred from the field descriptions in [`rest.md`](./rest.md) section 4.
BTC's published `fundRate` read between `0.0000021` and `0.0000031` over the runs, far from the 0.01 % interest rate the formula gives whenever the premium stays inside ±0.05 %, while the BTC mark sat 348 to 657 ppm below the index, see [`rest.md`](./rest.md) section 4.
The documented formula and the wire therefore disagree, and the wire is what a funding cost has to use.

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation fee | Not publicly specified. The liquidation condition includes "Estimated Close Fees" with no rate | Not publicly specified | S7 |
| insurance fund and ADL | an insurance fund and an auto-deleveraging mechanism are named | Published | S7, S14 |
| delivery or settlement fee | none, perpetuals never expire | Published | S5 |
| delisting | "When the futures contract is delisted, the system will automatically liquidate and settle any open positions.", with the delisting time given in the notice | Published | S6 |

## 8. CCXT

Echobit has no CCXT class.
`node -e "console.log(require('ccxt').exchanges)"` run from `server/` printed 104 ids for CCXT 4.5.68 and none of them matches `echo` or `echobit`.
The GitHub listing of `ts/src` on the `master` branch at commit `1c996ee07ed6f5c03c7097b2d46d8a8c0eeb5adb` on 2026-09-23 UTC held 105 `.ts` files and none is named after Echobit, and `ts/src/echobit.ts` and `ts/src/pro/echobit.ts` answered 404 on `raw.githubusercontent.com`.
The GitHub issue and pull request search for `echobit` in `ccxt/ccxt` returned 0 results.
So `market.taker` cannot be read, and there is no CCXT source line to cite.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 USDT-M perpetual taker in S1, S2 and S5 |
| `ccxtTakerPpm` | not applicable | there is no CCXT class to declare a constant for |
| `createExchange` | needs a named change | the registry type requires `createExchange: () => ccxt.Exchange` at [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) line 29, and the catalog comes from `loadMarkets` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68, so Echobit needs a hand written catalog built from `GET /uapi/contract/list`, see [`rest.md`](./rest.md) section 2 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Echobit Futures Trading, Perpetual Futures Trading Fees and Funding Rates, updated 2026-09-11 | https://support.echobit.com/hc/en-us/articles/59364466361881 | 2026-09-22 | Echobit, global | sections 2 and 6 |
| S2 | Echobit Spot Trading, Echobit Trading Fees, updated 2026-07-16, with the futures table image `42332170368281` and the spot table image `42332064246809` | https://support.echobit.com/hc/en-us/articles/42331490554777 | 2026-09-22 | Echobit, global | sections 2 and 3 |
| S3 | Echobit Futures Trading, Mark Price and Index Price, updated 2026-07-18 | https://support.echobit.com/hc/en-us/articles/59408528604953 | 2026-09-22 | Echobit, global | [`rest.md`](./rest.md) section 4 |
| S4 | Echobit User Agreement, updated 2026-09-21 | https://support.echobit.com/hc/en-us/articles/59360797210777 | 2026-09-22 | Echobit, global | section 1 |
| S5 | Echobit Futures Trading and Product Elements Announcement, updated 2026-07-18 | https://support.echobit.com/hc/en-us/articles/59364211534745 | 2026-09-22 | Echobit, global | sections 2 and 7, multipliers in [`rest.md`](./rest.md) section 2 |
| S6 | Echobit Delisting Announcement, futures pairs `CATIUSDT`, `CETUSUSDT`, `CFXUSDT`, `DEGENUSDT`, 2026-03-16 | https://support.echobit.com/hc/en-us/articles/56056476632601 | 2026-09-22 | Echobit, global | sections 3 and 7 |
| S7 | Echobit Futures Trading, Liquidation (Forced Liquidation) FAQ, updated 2026-07-18 | https://support.echobit.com/hc/en-us/articles/59408693621401 | 2026-09-22 | Echobit, global | section 7 |
| S8 | Agent Commission, Rebate and Fee Discount FAQ, updated 2026-07-18 | https://support.echobit.com/hc/en-us/articles/59361376221977 | 2026-09-22 | Echobit, global | section 5 |
| S9 | Echobit homepage, compliance block | https://www.echobit.com/en-us | 2026-09-22 | Echobit | section 1 |
| S10 | CoinMarketCap exchange page, `countries` `SG`, fees, `perpetualVolume24h` 30.17 billion USD and open interest 8.30 billion USD at 05:24 UTC on 2026-09-23 | https://coinmarketcap.com/exchanges/echobit/ | 2026-09-22 | CoinMarketCap | sections 1 to 3 |
| S11 | Echobit API docs on GitBook, index at `llms.txt` | https://echobit.gitbook.io/echobit-user-docs/llms.txt | 2026-09-22 | Echobit | [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md) |
| S12 | Echobit Secures Czech VASP License and Partners with Coinone | https://support.echobit.com/hc/en-us/articles/50437801367193 | 2026-09-22 | Czech Republic | section 1 |
| S13 | Help center article search API, queries "VIP", "VIP level", "fee tier", "zero fee", "market maker", "restricted", "United States" | `https://support.echobit.com/api/v2/help_center/articles/search.json` | 2026-09-22 | Echobit | sections 4 and 5 |
| S14 | Echobit Futures Trading, Echobit Auto-Deleveraging (ADL) Mechanism | https://support.echobit.com/hc/en-us/articles/59361244478361 | 2026-09-22 | Echobit, global | section 7 |
| S15 | CoinGecko `/api/v3/exchanges/list` and `/api/v3/derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/list | 2026-09-22 | CoinGecko | Echobit is not listed on either, only `EchoDEX` matches "echo" |
| C1 | CCXT 4.5.68 exchange list and CCXT `master` `ts/src` at `1c996ee` | `server/node_modules/ccxt`, https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs catalog` and `book` twice, `anchor` three times with the first at a two second round, between 06:32 and 06:53 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/echobit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 3 and 6 |
