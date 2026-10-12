# Remitano Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:58 to 03:22 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Remitano lists no perpetuals, so this profile covers its spot limit order market, as change 1 of the survey plan's template says.
That market is the 25 `*_USDT` pairs Remitano reports to CoinGecko and CoinMarketCap, see [`rest.md`](./rest.md) section 2.
P2P fiat trading, the swap form, deposit and withdrawal fees are named once in the coverage matrix.
Every number carries a source ledger row or a probe reference.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/remitano/fees-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | Not publicly specified in any page this host was served. The policy pages render in the browser from the web app, and the fee page is behind a challenge. | Not publicly specified | S4, S7 |
| restricted locations | Not publicly specified in any page read | Not publicly specified | S4 |
| who may trade spot | A Remitano account holder. The API terms are linked from the OpenAPI document, and API keys are created in the account settings. | Account-gated | S1, S3 |
| fee page from this host | `https://remitano.com/global/fees` answered HTTP 403 with the Cloudflare page titled "Just a moment..." and `cf-mitigated: challenge` | Probed | [`rest-probe.py`](../../../scripts/probes/venues/remitano/rest-probe.py), [`rest.md`](./rest.md) section 1 |
| public API from this host | `api.remitano.com/api/v1/...`, `socket.remitano.com` and `cablesocket.remitano.com` answered every public call | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The fee page was also refused to a fetch that does not originate from this host, which got HTTP 403.
No route around the challenge was tried.
The fee numbers below therefore come from the wire, from a call the web app itself reads.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot limit order book, the 25 public `*_USDT` pairs, both directions | 0.25 % = 2,500 ppm | 0.25 % = 2,500 ppm | Probed | `GET /api/v1/order_books`, field `maker_fee_percentage` and `taker_fee_percentage`, see section 4 |
| spot limit order book, VND and NGN quoted pairs | 0.5 % = 5,000 ppm on 30 of the 35 directed pairs ending in `_vnd` | 1.0 % = 10,000 ppm on the same 30 | Probed | section 4 |
| P2P, taking an existing advert | Not publicly specified for the advertiser | zero | Published | S6, "Takers who buy and sell cryptocurrencies from existing adverts on Remitano P2P platform pay zero fees." |

The engine models a taker cross at the base retail tier, so 2,500 ppm is the number that matters for a Remitano spot leg.
That is five times Gate's 500 ppm perpetual taker, see [`../gate/fees.md`](../gate/fees.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | no futures, perpetual, funding, mark price, premium, index price, leverage or margin path in either OpenAPI document, S1 and S2 |
| coin-margined perpetuals | no | same |
| dated futures | no | same |
| options | no | same |
| spot limit order book | yes, 25 public `*_USDT` pairs, and 1,196 directed pairs in the fee map | [`rest.md`](./rest.md) section 2, section 4 below |
| P2P fiat adverts | yes, the main product | S3, S6 |
| swap form and AMM pools | yes, named in the web app, not detailed | S5 |
| deposits and withdrawals | yes, looked up per coin through `GET /api/v1/currencies/info` | S1 |

Four more checks agree that Remitano has no perpetuals.
CoinMarketCap's derivatives ranking, read through its data API with `exType=2`, lists 104 venues and not Remitano.
CoinGecko's derivatives list holds 216 venues and not Remitano, and CoinGecko's `exchanges/remitano` answers 404 "exchange not found".
The web app's English strings mention perpetuals once, in a promotion that sends users elsewhere: "Kine exchange offers perpetual futures up to 100x, with unlimited liquidity and super low slippage".
A second promotion reads "Delta Exchange offers Futures and Options up to 100x leverage."
The bundles contain no `funding_rate`, `mark_price` or `index_price` string.

## 4. Spot tiers

Remitano publishes no tier table that this host could read, see section 1.
The only fee data on the wire is the web app's per pair map at `GET https://api.remitano.com/api/v1/order_books`.
It is not in the OpenAPI document, S1, and the web app fetches it, S5.
Despite the name it holds fees, keyed by directed pair in lower case:

```json
{"usdt_vnd":{"maker_fee_percentage":0.375,"taker_fee_percentage":0.75},
 "usdt_btc":{"maker_fee_percentage":0.25,"taker_fee_percentage":0.25},
 "vnd_btc":{"maker_fee_percentage":0.5,"taker_fee_percentage":1.0}}
```

The values are percent, so 0.25 is 0.25 % and 2,500 ppm.
Over the whole map of 1,196 directed pairs the probe counted:

| maker % | taker % | directed pairs |
|---:|---:|---:|
| 0.25 | 0.25 | 847 |
| 0.5 | 1.0 | 311 |
| 0.375 | 0.75 | 32 |
| 0.375 | 0.375 | 5 |
| 0.5 | 0.5 | 1 |

Every one of the 25 public `*_USDT` pairs reads 0.25 % maker and 0.25 % taker in both directions, `btc_usdt` and `usdt_btc` alike.
`usdt_vnd` and `vnd_usdt` read 0.375 % and 0.75 %, and `vnd_btc` and `btc_vnd` read 0.5 % and 1.0 %.
The reply is the same for every caller and carries no account, so it is the base rate.
Whether a volume tier or a VIP level lowers it is Not publicly specified.
The reply is cached, `cache-control: public, max-age=1800`.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | Not publicly specified | Not publicly specified | section 4 |
| token holding | Not publicly specified. Remitano issues RENEC, and no string read ties it to a fee discount. | Not publicly specified | S6 |
| referral | The referrer earns "a total of 40% commission from trading fees", with an "Option to select commission rate for your friends". The referred user's own rate is not stated. | Published | S6 |
| Remitano Wholesale | "reserved for trade of {minTradeAmount} or more, with trading fee fixed at {tradingFeePercent}%". The two values are filled at run time and were not captured. | Published | S6 |
| fee vouchers | A sign up string promises a "trading fee voucher" after KYC, with the amount filled at run time | Published | S6 |
| zero fee promotions | none seen | Not publicly specified | |

## 6. Funding as a cost

Not offered.
Remitano lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged product, so there is no liquidation or settlement charge.
A delisting charge is Not publicly specified.

## 8. CCXT

CCXT 4.5.68 has no Remitano class.
There is no `remitano.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, which holds 104 classes, and the `exchanges` map that opens at line 232 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` has no line naming it.
The current CCXT source agrees: `exchanges.json` on the `master` branch, at commit `f0aca06` of 2026-10-08, lists 103 ids and not Remitano, and `ts/src/remitano.ts` and `js/src/remitano.js` answer 404, S10.
So there is no `market.taker` to read.

Remitano's own OpenAPI document has two paths under a `Ccxt` tag, `GET /ccxt/trades` and `GET /ccxt/orders`, described as "Get list of offers for CCXT Standard", S1.
They return a user's own trades and orders, so they serve a private integration and not a CCXT class.

## 9. Recommended registry values

None.
The engine builds its catalog from CCXT markets filtered to active swaps, and the Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog.
Remitano has no CCXT class and no perpetual, so it cannot enter the registry as a perpetual leg.
If a later design adds spot legs from a hand-built catalog, the taker is `takerPpm` 2,500, and there is no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.remitano.com/api/v1/doc`, the OpenAPI 2.0 document the API explorer at `https://developers.remitano.com/api-explorer/` loads | every public path, the `Ccxt` tag, no derivatives path |
| S2 | `https://api.remitano.com/api/v2/doc` | the v2 paths, no derivatives path |
| S3 | `https://developers.remitano.com/docs/getting-started/getting-started/` | base URL `https://api.remitano.com`, P2P fiat list, API key guide |
| S4 | `https://remitano.com/policy/api_terms_of_service`, served to this host as the web app HTML | `window.WEBSOCKET_HOST`, `window.CABLESOCKET_HOST`, bundle names, no rendered terms text |
| S5 | `https://cdn.remitano.com/assets/chunks/react-35b6ed4f.js`, the web app bundle | `/api/v1/order_books`, `/api/v1/order_book_price_levels`, socket rooms |
| S6 | `https://cdn.remitano.com/assets/chunks/en-a724d410.js`, the English strings | P2P taker fee, referral, Wholesale, voucher and futures promotion strings |
| S7 | `https://remitano.com/global/fees` | HTTP 403 Cloudflare challenge from this host and from an outside fetch |
| S8 | `https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=2` | 104 derivatives venues, no Remitano |
| S9 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` and `https://api.coingecko.com/api/v3/exchanges/remitano` | 216 derivatives venues, no Remitano, and 404 |
| S10 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json` | 103 CCXT ids, no Remitano |
