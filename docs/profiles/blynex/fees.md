# Blynex Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:50 to 04:10 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers spot trading on Blynex, which has no CCXT id, so the folder is the slug `blynex`.
Blynex sells a product it calls "hybrid perpetual futures", but it is a dealer-quoted contract with no order book, no funding and no published index or mark, see section 3.
So the survey plan's change 1 applies, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): the spot VIP 0 fees and the spot tiers stand where the perpetual numbers would.
Every number carries a source ledger row, a probe reference, or a file and line.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/blynex/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/blynex/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/blynex/ws-probe.py).
The exit geolocated to Vancouver, Canada, and every Blynex host answered from Cloudflare, so every access result below is from that Canadian exit.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | None named. The footer says "©2024 Blynex Group. All Rights Reserved", and the terms define "Blynex" only as "the platform" | Not publicly specified | S1, S3 |
| governing law | "the laws of the jurisdiction in which Blynex operates", which the terms never name | Not publicly specified | S3 |
| launch date | 2024-08-14 per CoinMarketCap, and the home page says "2024 Since" | Published | S1, S5 |
| restricted regions | None listed. The terms require users to be 18 and to "comply with all applicable laws in your jurisdiction", and reserve the right to refuse anyone | Not publicly specified | S3 |
| who may trade spot | a registered account holder. No KYC level table was found | Account-gated | S3 |
| public API documentation | an apidoc page at `https://api.blynex.com/`, to which `docs.blynex.com` redirects with 301. It lists eleven public GET calls in CoinMarketCap and CoinGecko aggregator shapes and no WebSocket, no futures call and no private call | Published | S4, [`rest.md`](./rest.md) section 1 |
| public data from this exit | every documented call on `api.blynex.com` and the futures pair list answered HTTP 200, and the futures Socket.IO server upgraded with 101 | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |
| spot trading page from this exit | `https://blynex.com/spot/BTC_USDT` and `/spot/ETH_USDT` answered HTTP 403 with `cf-mitigated: challenge` and the title "Just a moment...", a Cloudflare JavaScript challenge. The home, fee, terms and futures pages answered 200 | Probed | [`rest-probe.py`](../../../scripts/probes/venues/blynex/rest-probe.py) section `hosts` |
| CoinGecko | `GET /api/v3/exchanges/blynex` answered 404 "exchange not found" | Probed | `fees-probe.py` section `cmc` |

No published rule bars Canadian users.
The challenge on the spot trading page is a bot filter on the HTML page, not a geoblock, since the rest of the site and the API answered from the same exit.
It was not bypassed.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, BTC_USDT and most USDT pairs | 0.25 % = 2,500 ppm | 0.25 % = 2,500 ppm | Published and Probed | S2 lists BTC, ETH and USDT at 0.25 % maker and taker. `/v1/market` gives `makerFee` 0.25 and `takerFee` 0.25 for BTC_USDT, in percent |

The engine models a taker cross at the base retail tier, so 2,500 ppm is the number that matters for BTC_USDT.
The per pair taker is not uniform, see section 4.
CoinMarketCap's record shows `makerFee` 0.0 and `takerFee` 0.0, which contradicts the fee page that the same record links as its fee URL, S5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes, 221 pairs in `/v1/market`, every row `type` spot: 212 quoted in USDT, 7 in EUR and 2 in USDB | Probed, [`rest.md`](./rest.md) section 2 |
| tokenized stock pairs | yes, inside the spot catalog. The fee page has a "Stock Market Fees" tab, and 63 assets in `/v1/assets`, almost all with an `ON` suffix such as `NVDAON` and `PLTRON`, are not in the spot fee table | Probed, S2 |
| "hybrid perpetual futures" | present but not an order book perpetual. The user guide calls it "a hybrid perpetual futures trading platform" with "Up to 100x leverage" across crypto, forex and commodities. Positions open at a platform price plus a "predefined" spread, there is no order book, and the guide says "Blynex does not charge: Trading fees, Funding fees, Swap fees, or Overnight fees". The pair list has 20 instruments: 16 Crypto, 3 Forex and 1 Commodities. Not detailed | Published and Probed, S6, [`websocket.md`](./websocket.md) section 2 |
| USDT-M, USDC-M or coin-margined order book perpetuals | absent. No order book, depth or funding call or event exists on the futures host, and the socket carries only one last price per pair | Probed, [`ws-probe.py`](../../../scripts/probes/venues/blynex/ws-probe.py) parts A and C |
| dated futures | absent from every catalog | Probed |
| options | absent from every catalog | Probed |
| crypto loan, earn, cashback, AI bundle, convert | named on the home page only | S1 |

The futures product fails every item the engine needs from a perpetual leg.
It has no book to cross, no index, no mark and no funding, so it cannot be a perpetual leg whatever its name.
That is why this profile covers spot.

## 4. Spot tiers

No VIP table is published.
The fee page has no tier, VIP or volume wording, `fees-probe.py` section `page`.
Its spot table lists 155 assets, each with "Min. Trade Size" 5 USDT and one maker and one taker rate.

| maker and taker on the fee page | assets |
|---|---|
| 0.25 % and 0.25 % | 146 |
| 0.5 % and 0.5 % | 3, EUR, USD and POPCAT |
| 0.7 % and 0.7 % | 1, JYAI |
| 4 % and 4 % | 1, XMR |
| 5 % and 5 % | 2, XRP and SENT |
| 50 % and 50 % | 1, ESPORTS |
| 0 % and 0 % | 1, LAYER |

`/v1/assets` agrees with the page on all 153 assets that both list, and two page rows, ODS and FTE, are missing from the call, `fees-probe.py` section `api`.

The API's per pair fees follow one rule on all 221 pairs: the pair's `takerFee` is the base asset's taker, and its `makerFee` is the quote asset's maker, `fees-probe.py` section `api` key `pair_rules`.

| pair taker in `/v1/market` | pairs |
|---|---|
| 0.25 % | 154 |
| 0.5 % | 59, mostly tokenized stock pairs |
| 0.7 % | 2 |
| 4 % | 1 |
| 5 % | 3 |
| 50 % | 1 |
| 0 % | 1 |

EUR-quoted pairs carry `makerFee` 0.5, because EUR's own rate is 0.5 %.
XRP_USDT costs 5 % to take, twenty times BTC_USDT, so a per pair taker matters on this venue.

## 5. Discounts that change the taker

| discount | value | label | evidence |
|---|---|---|---|
| token holding | the home page describes BX, "the first native meme token", and names no fee discount for holding it | Not publicly specified | S1 |
| referral | "Refer friends to earn 30% commission", paid to the referrer, not a discount on the taker | Published | S1 |
| cashback | "Blynex Cashback Line: Trade and earn cashback". No rate was found | Not publicly specified | S1 |
| market maker program | none found | Not publicly specified | |
| zero fee promotion | LAYER is listed at 0 % maker and taker with no end date | Published | S2 |

## 6. Funding as a cost

Not offered on spot.
The futures product states that no funding is charged: "Q: Can positions be held indefinitely? A: Yes. No funding or overnight fees apply", S6.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge.
No delisting charge was found.
For the futures product the guide describes a "Dynamic liquidation system" with no published rate, S6.
Two futures pairs carry fee fields that contradict the guide's zero fee claim: BTCUSDT and ADAUSDT have `openFee` 0.25 and `closeFee` 10, with no unit stated, `fees-probe.py` section `futures`.
The other 18 pairs have no fee field.

Deposit and withdrawal fees are named only.
`/v1/assets` carries `withdrawFees` per asset, for example 0.0008 BTC.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| CCXT 4.5.68 class | none. No `blynex.js` exists under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no file in that folder contains the string `blynex` | `fees-probe.py` section `ccxt` |
| current CCXT master | none. `ts/src/blynex.ts` answered 404 at master commit `f0aca06` of 2026-10-08, and `exchanges.json` at that commit does not name Blynex | `fees-probe.py` section `ccxt`, S7 |
| `market.taker` | not applicable | no class |

Since no class exists, no file and line can be cited for a CCXT taker.
The documented API has the CoinMarketCap aggregator shape, which no CCXT class wraps.

## 9. Recommended registry values

No registry entry is recommended.
The engine's catalog loads perpetual swaps only, as the Gate adapter's catalog does at [`markets.rs`](../../../server/src/venues/gate/markets.rs) lines 47 and 48, and Blynex has no order book perpetual.

If Blynex spot were ever wired in through a hand-written catalog, the taker to model is 2,500 ppm for BTC_USDT, and a per pair value from `/v1/market` `takerFee` for the rest, section 4.

```ts
blynex: {
  takerPpm: 2_500,
  // Hypothetical: spot only, no CCXT class.
  // Fee page and /v1/market give 0.25 % maker and taker on BTC_USDT, but the per pair taker ranges from 0 % to 50 %.
}
```

`ccxtTakerPpm` would stay unset because there is no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Blynex home page | https://blynex.com/ | 2026-10-09 | Blynex Group | products, BX token, referral, cashback, footer, sections 1, 3 and 5 |
| S2 | Blynex Trading Fee Schedule, tab "Spot Trading Fees" | https://blynex.com/trade-fees/ | 2026-10-09 | Blynex | spot maker and taker per asset, minimum trade size, sections 2 and 4 |
| S3 | Blynex Terms and Conditions | https://blynex.com/terms-and-conditions/ | 2026-10-09 | Blynex | eligibility, governing law, no entity named, section 1 |
| S4 | Blynex API documentation, apidoc 1.0.0 page and its bundle | https://api.blynex.com/ | 2026-10-09 | Blynex | the eleven public calls, section 1 and [`rest.md`](./rest.md) |
| S5 | CoinMarketCap data API, exchange `blynex`, id 11124 | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=blynex | 2026-10-09 | CoinMarketCap | launch date, fee fields 0.0, tags "Order book Exchange" and "Auto Order Book Exchange", sections 1 and 2 |
| S6 | "BLYNEX FUTURES Official User Guide & Product Specification, Version 1.2 (Professional Edition)" | https://blynex.com/blynex-hybrid-forex-crypto-future/ | 2026-10-09 | Blynex | futures product, zero fee claim, spread model, leverage, sections 3, 6 and 7 |
| S7 | CCXT master `ts/src/blynex.ts` and `exchanges.json` at commit `f0aca06` | https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c | 2026-10-09 | CCXT | no Blynex class, section 8 |
| P1 | `fees-probe.py`, sections `page`, `api`, `futures`, `cmc` and `ccxt` | [`fees-probe.py`](../../../scripts/probes/venues/blynex/fees-probe.py) | 2026-10-09 | this host, Canadian exit | sections 2 to 8 |
| P2 | `rest-probe.py`, sections `hosts` and `catalog` | [`rest-probe.py`](../../../scripts/probes/venues/blynex/rest-probe.py) | 2026-10-09 | this host, Canadian exit | access, catalog counts, sections 1 and 3 |
