# BTC Trade UA Fees Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific evening (04:42 to 05:06 UTC on 2026-09-23), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

BTC Trade UA lists no perpetual, no dated future, no option and no margin product, so this profile covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
The venue publishes one trade commission for every pair and both sides of a trade.
The book, the socket and the anchor question are in [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | BTC Trade UA, `btc-trade.com.ua`, a Ukrainian hryvnia spot exchange with a separate P2P market at `btc-trade.app/p2p` | S1, S5 |
| CoinGecko record | name BTC Trade UA, established 2014, country Ukraine, trust score 2, trust score rank 165, 11 coins, 11 pairs, 24 h volume 0.0139 BTC, three tickers listed (BTC/UAH, USDT/UAH marked stale, TLR/UAH). The survey's venue list gave rank 156, and this API read gave 165 | S6, read at about 04:47 UTC |
| legal entity | None named. The user agreement calls the operator "the Service" and never defines it, and the only name on any page read is the footer "Copyright © BTC TRADE UA 2014-2021" | S3, S1 |
| governing law | Ukrainian law, user agreement clauses 1.2 and 14.2 | S3 |
| who may trade | anyone who registers with a login, an e-mail address and a password and accepts the agreement as a public offer. Clause 7.4 obliges the user to pass whatever identification the system or its payment partners require | S3 |
| excluded regions and US persons | the agreement names no excluded region and says nothing about US persons, so neither is restricted by any text this research found | S3, S4 |
| funding rails | hryvnia in and out through Ukrainian bank transfer, PrivatBank cards, LiqPay and cash through LiqPay | S2 |
| access from this host | every public REST call answered 200 and every socket upgrade on `/ws/time` answered 101 through the Canadian VPN exit. The host is an nginx server in a Hetzner Falkenstein data centre with no CDN in front, and no geoblock or refusal page was seen | P1 to P6, [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, every pair | 0.1 %, 1,000 ppm | 0.1 %, 1,000 ppm | fee page "Комиссия за сделку составляет 0.1%", S2 |

The fee page gives one "commission per deal" and does not split maker from taker.
The public socket tells an anonymous session the same number, `"deal_comission":"0.1"`, which the trading page renders as "Комиссия: 0.1%", in both runs of P4 and P6.
The fee page says the schedule applies from 11.12.2014 and its footer reads 2014-2021, so the page has not been revised in years.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M, USDC-M or coin-M perpetuals | absent | no derivative word in the ticker, the trading page, the fee page, the FAQ or the agreement, P1 and S1 to S4. Not on CoinGecko's derivatives list of 214 venues, S7. The last CCXT class set `swap` and `future` to false, S8 |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| margin | absent | the agreement defines a "loan agreement" by reference to its section 7, but section 7 is about preventing unlawful use and holds no loan terms, S3. No margin control on the trading page, S1 |
| spot | present, 36 pairs: 25 quoted in UAH, 7 in BTC, 4 in USDT | `GET /api/ticker`, P1 |
| P2P | present, on `btc-trade.app/p2p` | S5 |

Of the 36 spot pairs, 11 traded in the 24 h before the probe, all of them quoted in UAH.
The four USDT pairs, `btc_usdt`, `sol_usdt`, `trx_usdt` and `eos_usdt`, had a 24 h volume of 0, see [`rest.md`](./rest.md) section 2.

## 4. Spot tiers

None are published.
The fee page gives the single 0.1 % rate above and names no volume tier, VIP level or maker rebate, S2.

## 5. Discounts that change the spot taker

| discount | terms | source |
|---|---|---|
| loyalty programme | the fee page says the commission "can easily be reduced" through "our loyalty programme", and that card withdrawal fees can be returned through it. No page read here describes its terms, levels or rates | S2 |
| exchange token | none | S1, S2 |
| referral, market maker, zero fee promotion | none published | S1 to S4 |

## 6. Funding as a cost

Not applicable.
The venue lists no perpetual, so it charges no funding.

## 7. Liquidation, settlement and delisting

No liquidation, settlement or delisting charge is published, since the venue lists no leveraged product.
Crypto deposits are free, and crypto and hryvnia withdrawal fees are on the fee page, S2.

## 8. CCXT

| item | value | source |
|---|---|---|
| class in CCXT 4.5.68 | none. `ccxt.exchanges` from `server/` lists 104 ids and none matches `btctradeua` or any name with "trade" and "ua" | P1 |
| class in CCXT master | none. `ts/ccxt.ts` on master imports 105 REST classes, none of them BTC Trade UA, and `ts/src/btctradeua.ts` answers 404 | S9 |
| history | a class with id `btctradeua` existed until CCXT 4.1.51 and is absent from 4.1.52 on | S8, S9 |
| what the last class reported | `taker` and `maker` 0.001 for every market, at `ts/src/btctradeua.ts` lines 122 to 127 of tag 4.1.51, with `rateLimit` 3000 at line 23 | S8 |
| its catalog | 17 markets hard coded in `describe()` at lines 103 to 121, with no `fetchMarkets` call to the venue | S8 |
| `market.taker` for a swap market today | not applicable: there is no class and no swap market | P1 |

## 9. Recommended registry values

None.
The engine builds every venue from a CCXT class, `createExchange` at [`../../../server/src/venues/registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) line 29, and keeps only active swap markets, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 199 to 200.
BTC Trade UA has neither a class nor a swap market.
If a spot leg were ever modelled, the taker would be 1,000 ppm, with no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTC Trade UA home and trading pages | https://btc-trade.com.ua/index.html and https://btc-trade.com.ua/stock | 2026-09-22 | BTC Trade UA, Ukraine | footer, page links, fee field on the trading page, sections 1, 3 and 5 |
| S2 | Тарифы, fee page | https://btc-trade.com.ua/page/fees | 2026-09-22 | BTC Trade UA, Ukraine | 0.1 % per deal, loyalty programme, funding rails, withdrawal fees, sections 1, 2, 4, 5 and 7 |
| S3 | Пользовательское соглашение, user agreement | https://btc-trade.com.ua/page/terms | 2026-09-22 | BTC Trade UA, Ukraine | no named entity, Ukrainian law, identification clause 7.4, dangling loan definition, sections 1 and 3 |
| S4 | FAQ | https://btc-trade.com.ua/page/faq | 2026-09-22 | BTC Trade UA, Ukraine | no region or derivative text, sections 1 and 3 |
| S5 | P2P market | https://btc-trade.app/p2p | 2026-09-22 | BTC Trade UA | answered 200 in 12.7 s with the title "BTC TRADE UA", section 1 |
| S6 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/btc_trade_ua | 2026-09-22 | CoinGecko | trust score, rank, volume, tickers, section 1 |
| S7 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | 214 venues, BTC Trade UA not among them, section 3 |
| S8 | CCXT `btctradeua.ts` at tag 4.1.51 | https://raw.githubusercontent.com/ccxt/ccxt/4.1.51/ts/src/btctradeua.ts | 2026-09-22 | CCXT | last class, fees, rate limit, hard coded markets, sections 3 and 8 |
| S9 | CCXT master `ts/ccxt.ts`, and `ts/src/btctradeua.ts` at master and at tags 4.1.51 to 4.1.59 and 4.2.1 | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts | 2026-09-22 | CCXT | no class on master, removal at 4.1.52, section 8. The GitHub contents API answered 403 rate limit to this host, so the raw files were read instead |
| P1 | `rest-probe.mjs catalog`, runs at 04:48 and 04:58 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/rest-probe.mjs) | 2026-09-23 UTC | this host | pair count, quote tally, 24 h volume, CCXT class check, access |
| P2 | `rest-probe.mjs depth`, runs at 04:48 and 04:58 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/rest-probe.mjs) | 2026-09-23 UTC | this host | access |
| P3 | `rest-probe.mjs poll`, runs at 04:49 and 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/rest-probe.mjs) | 2026-09-23 UTC | this host | access |
| P4 | `ws-probe.mjs handshake`, runs at 04:51 and 05:00 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/ws-probe.mjs) | 2026-09-23 UTC | this host | `deal_comission`, access |
| P5 | `ws-probe.mjs rpc`, runs at 04:52 and 05:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/ws-probe.mjs) | 2026-09-23 UTC | this host | access |
| P6 | `ws-probe.mjs silence`, runs at 04:54 and 05:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/ws-probe.mjs) | 2026-09-23 UTC | this host | `deal_comission`, access |
