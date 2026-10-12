# Altcoin Trader Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:22 to 03:45 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Altcoin Trader lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 33 pairs, every one quoted in South African rand, see [`rest.md`](./rest.md) section 2.
The live fee page sits behind a Cloudflare challenge from this host, and the API returns the fee schedule only to a signed request.
So no first-party VIP 0 taker could be read, and the taker is recorded as unknown.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/altcoin-trader/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | AltCoinTrader, Johannesburg, South Africa, launched in 2014. The registered legal entity is Not publicly specified in any page this host was served. | Not publicly specified | S7, S8 |
| restricted locations | Not publicly specified in any page read | Not publicly specified | S1 |
| who may trade spot | An Altcoin Trader account holder with an API key created in the account. Market data needs no key. | Account-gated | S1 |
| fee page from this host | `https://www.altcointrader.co.za/trading-fees` answered HTTP 403, title "Just a moment...", `cf-mitigated: challenge`, `server: cloudflare`, edge `YVR` | Probed | `fees-probe.py page`, [`rest.md`](./rest.md) section 1 |
| archived fee page | A manual availability check named a 2025-11-13 copy, S4. Every fetch of that copy, and the availability call in both probe runs, answered HTTP 429 to this host, so it was not read. | Probed | `fees-probe.py page`, S4 |
| public API from this host | `api.altcointrader.co.za` answered every documented public call, and the socket at `/ws` upgraded | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

A fetch that does not originate from this host was also refused the fee page with HTTP 403.
No route around the challenge was tried.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, the 33 `*ZAR` pairs | unknown | unknown | Account-gated | `GET /trading/fees/tiers` returns the schedule only with a key, and answered 401 without one, see section 4 |

Two secondary sources give a flat rate, and neither is first party or current.
An ITWeb press release issued by Altcoin Trader in 2019 says "Previously charging 0.8% of all trades, the exchange will, from today, start charging 0.375%", which is 3,750 ppm, S7.
Coin360's listing shows 0.37 % maker and 0.37 % taker with no date, S8.
CoinMarketCap's exchange record carries `makerFee` 0.0 and `takerFee` 0.0, which is its placeholder for an unknown fee and not a zero fee, because it links the challenged fee page as the source, S5.
If the 2019 rate still holds, an Altcoin Trader spot taker costs about seven times Gate's 500 ppm perpetual taker, see [`../gate/fees.md`](../gate/fees.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | no futures, perpetual, mark price, index price, leverage or margin word in either OpenAPI document, S1 and S2 |
| coin-margined perpetuals | no | same |
| dated futures | no | same |
| options | no | same |
| spot order book | yes, 33 active pairs, all quoted in ZAR | [`rest.md`](./rest.md) section 2 |
| easy buy and sell | yes, `POST /easybuy` in the API and an `easy_buy` capability per currency | S1, `rest-probe.py catalog` |
| savings | yes, six `/savings/*` paths, not detailed | S1 |
| deposits and withdrawals | yes, `withdrawal_fee` per network on `GET /currencies` | `fees-probe.py api` |

Four more checks agree that Altcoin Trader has no perpetuals.
CoinMarketCap's exchange record shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 against a spot volume of about 880,000 USD, S5.
CoinMarketCap's perpetual market pair list for the venue holds 0 pairs, and its derivatives ranking with `exType=2` lists 104 venues and not Altcoin Trader, S5 and S6.
CoinGecko's derivatives list holds 216 venues and not Altcoin Trader, and its list of 1,503 exchanges has no Altcoin Trader row at all, S9.
The word "funding" appears in the documents only as "Funding service unavailable" on wallet paths, S1 and S2.

## 4. Spot tiers

Altcoin Trader publishes its tiers through two signed paths, S1:

- `GET /trading/fees/tier` returns the wallet's current tier and the ZAR volume behind it.
- `GET /trading/fees/tiers` "Returns the tier structure from the authenticated wallet's active trading-fee schedule", and negative basis points in it are rebates.

Both need the `read` permission on an API key.
Without a key both answered HTTP 401 with `{"code":"UNAUTHORIZED","message":"missing X-API-KEY header"}`, `fees-probe.py api`.
The words "active trading-fee schedule" suggest the schedule can differ between accounts.

The document's example reply shows the shape, and its numbers are an example and not a published schedule:

```json
{"tiers":[
  {"tier":1,"min_volume_zar":"0.00000000","max_volume_zar":"100000.00000000","maker_bps":10,"taker_bps":20},
  {"tier":2,"min_volume_zar":"100000.00000000","max_volume_zar":null,"maker_bps":-2,"taker_bps":15}]}
```

The fee fields are basis points, so a real `taker_bps` of 20 would be 0.20 % and 2,000 ppm.
The `Market` schema of the older document on the API host lists `maker_fee` and `taker_fee` per market, S2.
The live `GET /markets` carries neither, and its fields are `base`, `min_order_value`, `price_precision`, `quantity_precision`, `quote`, `status` and `symbol`, `fees-probe.py api`.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | tiers by ZAR trade volume exist, with values only behind a key | Account-gated | section 4 |
| maker rebates | the schema allows a negative `maker_bps` | Account-gated | S1 |
| token holding | Not publicly specified | Not publicly specified | |
| referral | Not publicly specified | Not publicly specified | |
| zero fee promotions | none seen | Not publicly specified | |

## 6. Funding as a cost

Not offered.
Altcoin Trader lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged product, so there is no liquidation or settlement charge.
A delisting charge is Not publicly specified.

## 8. CCXT

CCXT 4.5.68 has no Altcoin Trader class.
There is no `altcointrader.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, which holds 104 classes, and the `exchanges` map that opens at line 232 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` has no line naming it.
The current CCXT source agrees: `exchanges.json` on the `master` branch, at commit `f0aca06` of 2026-10-08, lists 103 ids and none containing "alt", and `ts/src/altcointrader.ts` and `js/src/altcointrader.js` answer 404, S10.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and Altcoin Trader has no perpetual and no CCXT class.
It cannot enter the registry as a perpetual leg.
If a later design adds ZAR spot legs from a hand-built catalog, `takerPpm` must come from a signed `GET /trading/fees/tiers`, and there is no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://docs.altcointrader.co.za/openapi/openapi.yaml`, the OpenAPI 3.0.3 document "AltCoinTrader API" behind `https://docs.altcointrader.co.za/` | 35 paths, base URL `https://api.altcointrader.co.za`, fee tier paths and schema, key permissions, rate limit prose, the WebSocket section |
| S2 | `https://api.altcointrader.co.za/docs/openapi.yaml`, the older "External Trading API" document behind `https://api.altcointrader.co.za/docs` | 18 paths, server URL `https://api.actnewdev.co.za/`, `maker_fee` and `taker_fee` in the `Market` schema |
| S3 | `https://www.altcointrader.co.za/trading-fees` | HTTP 403 Cloudflare challenge from this host and from an outside fetch |
| S4 | `https://archive.org/wayback/available?url=altcointrader.co.za/trading-fees` | a 2025-11-13 snapshot exists, HTTP 429 to this host when fetched |
| S5 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=altcoin-trader` and `.../exchange/market-pairs/latest?slug=altcoin-trader` with `category=spot` and `category=perpetual` | id 261, launched 2014-07-01, fee fields 0.0, fee URL, spot volume, 33 spot pairs, 0 perpetual pairs |
| S6 | `https://api.coinmarketcap.com/data-api/v3/exchange/listing?exType=2` | 104 derivatives venues, no Altcoin Trader |
| S7 | `https://itweb.co.za/article/altcointrader-announces-surprise-fee-reduction/5yONP7EENd87XWrb` | the 2019 cut from 0.8 % to 0.375 %, dateline Johannesburg |
| S8 | `https://coin360.com/exchange/altcoin-trader` | 0.37 % maker and taker, South Africa, launched 2014 |
| S9 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` and `https://api.coingecko.com/api/v3/exchanges/list` | 216 derivatives venues and 1,503 exchanges, no Altcoin Trader in either |
| S10 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json` and the two class paths | 103 CCXT ids, no Altcoin Trader, two 404s |
