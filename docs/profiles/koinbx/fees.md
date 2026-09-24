# KoinBX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:40 to 05:40 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare `loc=CA`, colo `YVR` and `SEA`).

This profile covers KoinBX perpetual futures, which went live on 2026-08-15, with spot named only in the coverage matrix.
KoinBX has no CCXT class, and its documented public API covers spot REST only.
Every futures number below comes from the futures web app's own backend, `https://futures-api.koinbx.com`, and its public pages, read by [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs).
Access results are from the Canadian VPN exit and may differ from a direct connection.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| legal entity | Kooz Advisors and Technologies Private Limited, trading as KoinBX, registered with FIU-IND as a Virtual Digital Asset Service Provider, REID `VA00048773` | S4, S3 |
| product launch | 2026-08-15, which the Futures Referral Campaign terms define as the date on which KoinBX Futures trading goes live for all eligible users | S4 |
| who may trade today | "Open to Indian residents holding a KYC-verified KoinBX (India) account in good standing." | S2, `termIndiaResident` |
| outside India | "KoinBX Global futures trading is launching soon", and when it opens it is for "eligible participants outside India holding a KYC-verified KoinBX Global account, excluding residents of restricted, embargoed or sanctioned jurisdictions." | S2, `termGlobalLaunch` and `termGlobalResident` |
| restricted list | Not publicly specified. The page says "KoinBX Futures isn't offered to people there" without naming places. | S2 |
| US persons | cannot trade today, since only Indian residents can, and no US policy is published for KoinBX Global | S2 |
| margin asset on the wire | INR on all 558 contracts, including the 329 quoted in USDT (`marginAssetsSupported: ["INR"]`) | P1 |

The terms of use call KoinBX "an Indian Cryptocurrency Exchange", and they define the linked bank account as one "owned by an Indian user, held with a Scheduled Commercial Bank", S4.
The futures page this host received is the Global variant, and its trust, verification and risk sections are still placeholder copy that says it awaits legal approval and is not for release, S2.
It also says "Everything in USDT" and gives USDT as the margin asset, while the catalog margins every contract in INR, P1.
The wire is what the India product runs today.

Access from this host: every public page, `https://api.koinbx.com`, `https://futures-api.koinbx.com` and the Socket.IO hub answered without refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 5.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| INR-margined perpetuals quoted in USDT, 329 contracts | 0.02 % = 200 ppm | 0.05 % = 500 ppm | P1, `makerFee: 0.02`, `takerFee: 0.05` on 558 of 558 contracts, and S2 "Standard fees are 2 bps maker and 5 bps taker" |
| INR-margined perpetuals quoted in INR, 229 contracts | 0.02 % = 200 ppm | 0.05 % = 500 ppm | same |

The catalog fields are in percent, which the page's "2 bps maker / 5 bps taker" confirms.
The same two numbers appear in `GET /api/v1/market/markets`, P1.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | source |
|---|---|---|---|
| perpetuals quoted in USDT, `contractType` `PERPETUAL`, margined in INR | yes | 300 | P1 |
| TradFi perpetuals quoted in USDT, `contractType` `TRADIFI_PERPETUAL`, margined in INR | yes | 29: stocks such as `NVDAUSDT` and `TSLAUSDT`, metals such as `XAUUSDT`, energy such as `CLUSDT` and `NATGASUSDT` | P1 |
| perpetuals quoted in INR, margined in INR | yes | 200 | P1 |
| TradFi perpetuals quoted in INR | yes | 29 | P1 |
| USDT-margined perpetuals | no on the wire, announced for KoinBX Global | 0 | P1, S2 |
| coin-margined perpetuals | no | 0 | P1 |
| dated futures | no | 0 | P1 |
| options | no | 0 | P1 |
| spot | yes, documented public REST API | 277 pairs: 134 INR, 130 USDT, 7 BTC, 6 ETH | S1, P1 |

Every one of the 229 INR bases also has a USDT-quoted contract, and all 329 USDT-quoted symbols exist on Binance USD-M, P1.
CoinGecko lists KoinBX as spot only, under the id `koinbazar`, with trust score 3 and trust score rank 146 on 2026-09-22, S7.
Its derivatives exchange list of 214 entries has no KoinBX entry, S7.

## 4. Perpetual tiers

No volume tier table is published.
The page says "no VIP ladder to climb", S2.
Every contract carries the same `makerFee` and `takerFee`, P1.
The only schedule that changes the rate is the Futures Pass in section 5.

## 5. Discounts that change the perpetual taker

The Global page sells a Futures Pass per 30-day cycle, priced in USDT, S2.

| pass | price per cycle | fee-free volume per cycle | rate after the allowance |
|---|---|---|---|
| none | 0 | 0 | 2 bps maker, 5 bps taker |
| Trader | $25 | $100K | 4.5 bps taker, derived from the page's own table: $205 at $500K volume is $25 plus 4.5 bps on $400K |
| Pro | $125 | $500K | 4 bps taker, derived the same way: $325 at $1M volume is $125 plus 4 bps on $500K |
| Elite | $250 | $1M | "as low as 1.5 / 3.5 bps on Elite", maker and taker |
| top-up | $30 | another $100K | expires with the cycle |

Volume counts both legs: "opening and closing a position uses twice its size", S2.
The India variant of the same page names Gold and Platinum passes and adds "18% GST applies to Pass purchases", S2 and S4.
Gold and Platinum prices were not published on any page this host received.
The membership page says the pass price "is debited from your spot wallet", S3.

No token holding discount, referral rebate on the taker, or market maker program was found on any page read.
The engine models the base tier, so 500 ppm is the number that matters.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval, documented | "Perpetuals swap a small funding payment between longs and shorts every 8 hours." | S2 |
| interval, on the wire | `fundingFeeInterval` 8 h on 156 contracts, 4 h on 400, 1 h on 2 (`GUSDT`, `GINR`) | P1 |
| next settlement | `T` on the mark stream was `1790150400000`, 2026-09-23 08:00 UTC, on every frame of every contract probed, and it equalled Binance's `nextFundingTime` on every frame | P3 |
| formula, cap and floor | Not publicly specified | S2, S4 |
| the rate | KoinBX's own. `upcomingFundingRate` and the stream's `r` differ from Binance's rate on BTC and ETH, and they equal it only where both read `0.00005`, `0` or `0.0001` | P2, P3 |
| to whom | "Funding payments and any charges if a position is liquidated are separate and still apply, whether or not you have a Pass." | S2 |

`BTCUSDT` read `0.000036666`, then `0.000029403` from a change between 05:09 and 05:10 UTC, then `0.000023265` by 05:26 UTC, while Binance's `lastFundingRate` for the same contract read `0.00003775`, `0.00003599`, `0.00003425`, `0.00002395`, `0.00002277`, `0.00002217` and `0.00002061` across the same samples, P2.
Not one of 558 contracts changed its rate across the 9 polls that completed in a 132 s run, and none of the five followed contracts changed it across 54 polls in 4.5 min, P2.
`BTCINR` carries its own rate, `0.000035937` against `0.000029403` on `BTCUSDT` at the same instant, P3.
The funding history is not public on the futures host, whose `/api/v1/market/fundingRate` answered 404, P1.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

- Every contract carries `liquidationFee` `"0.02"`, P1, and the unit is Not publicly specified.
- The Futures Trading Policy says liquidation is "the process initiated by KoinBX to close a user's position when the applicable margin requirements are no longer met", and that KoinBX may suspend a contract or cancel orders "in the event of extraordinary market conditions, technology failures, incorrect pricing", S4.
- No delisting or settlement charge is published.
- Maintenance margin is a step function of leverage on each contract, for example `BTCUSDT` 5 % at 1x to 5x up to 30 % at 101x to 150x, P1.
- Deposit, withdrawal and spot wallet schedules are on `https://koinbx.com/fees`, which renders client side, S5.

## 8. CCXT

KoinBX has no class in CCXT 4.5.68.
`require('ccxt').exchanges` run from `server/` lists 104 ids and none matches `koin` or `kbx`, P1.
The current master of `github.com/ccxt/ccxt` at commit `1d8b674`, 2026-09-22 12:48 UTC, has 105 `.ts` files under `ts/src` and none for KoinBX, and `ts/src/pro` has none either, S6.
CCXT issue #23686, "New Exchange: KoinBX CEX", has been open since 2024-09-11, S6.
So `market.taker` cannot be read, and there is no source line to cite.

## 9. Recommended registry values

Do not register KoinBX.
If it were ever registered, `takerPpm` would be 500, from `takerFee: 0.05` percent on every contract and the page's 5 bps, and `ccxtTakerPpm` would have no value, since no CCXT class exists.
The reasons it should not be registered are in [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8: the book and the anchor are Binance's, and only Indian residents may trade.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | KoinBX Public API Documentation | https://koinbx.com/publicapi | 2026-09-22 | KoinBX, India | spot REST only, base URL `https://api.koinbx.com`, sections 3 and 8 |
| S2 | KoinBX Futures, Global variant as served to this host | https://koinbx.com/futures | 2026-09-22 | KoinBX India and KoinBX Global | fees, passes, funding interval, eligibility terms, placeholder legal copy, sections 1 to 6 |
| S3 | KoinBX Futures Pass membership page | https://koinbx.com/futures/membership | 2026-09-22 | KoinBX India | FIU-IND registration, pass billing, sections 1 and 5 |
| S4 | KoinBX Legal: Terms of Use, Futures Trading Policy, Futures Referral Campaign | https://koinbx.com/legal?tab=terms-and-use, content in the page's script chunk `322eb1981dc3656b.js` | 2026-09-22 | Kooz Advisors and Technologies Private Limited, India | operator, launch date, India-only campaign, mark price definition, liquidation and suspension, sections 1, 5 and 7 |
| S5 | KoinBX fees page | https://koinbx.com/fees | 2026-09-22 | KoinBX, India | deposit and withdrawal lookup, section 7 |
| S6 | CCXT master `ts/src` listing and issue #23686 | https://github.com/ccxt/ccxt/tree/master/ts/src and https://github.com/ccxt/ccxt/issues/23686 | 2026-09-22 | CCXT | no KoinBX class, section 8 |
| S7 | CoinGecko exchange `koinbazar` and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/koinbazar and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | trust rank, spot only listing, section 3 |
| P1 | `rest-probe.mjs catalog` and `errors`, two runs at 04:58 and 05:19 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | catalog counts, fees, intervals, margin asset, CCXT, sections 1 to 8 |
| P2 | `rest-probe.mjs anchor`, runs at 05:02, 05:26 and 05:36 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | funding rate cadence against Binance, section 6 |
| P3 | `ws-probe.mjs book`, runs at 05:09, 05:14 and 05:16 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs) | 2026-09-22 | this host, Canadian exit | `r` and `T` on the mark stream against Binance, section 6 |
