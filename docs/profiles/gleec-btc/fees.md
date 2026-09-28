# Gleec BTC Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-24, for the venue survey of 2026-09-22.

**Probed:** 2026-09-24 between 06:41 and 06:49 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the USDT-margined perpetuals of Gleec BTC, the exchange at `exchange.gleec.com` run by Gleec Pay Ltd.
The venue is a broker of the HitBTC platform: its API is HitBTC API v3 on the host `api.exchange.gleec.com`, and the site's HTML carries the class `broker_gleec`.
CCXT 4.5.68 has no Gleec class, see section 8.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "GLEEC PAY LTD", registered as a Money Services Business in Canada with FINTRAC | S3 |
| stated licence scope | "Gleec's MSB registration authorizes it to provide Services only within Canada" | S3 |
| excluded regions | a Restricted Jurisdictions list that includes the United States of America and the U.S. Virgin Islands, and then "Gleec does not offer, market, or provide the Services to residents of, or persons located or established in: United Kingdom, Any member state of the European Union, Any member state of the European Economic Area (Iceland, Liechtenstein, Norway), Switzerland" | S3 |
| US persons | may not trade. The signup checkbox reads "you are not a citizen of the United States of America, or any other restricted country or region identified in the user agreement" | S3, S1 |
| Canada | not on the Restricted Jurisdictions list of S3 | S3 |
| perpetuals under the terms | the terms say "Gleec does not offer margin trading, leverage, or financing of any kind" and, in section 14.1, "Gleec does not provide financing and does not offer or support margin or leveraged trading" | S3 |
| perpetuals on the wire | 30 perpetuals with `status` `working` and `max_initial_leverage` `"50.00"`, live books and funding, and the page `https://exchange.gleec.com/futures/btc-to-usdt` answered HTTP 200 | [`rest-probe.mjs`](../../../scripts/probes/venues/gleec-btc/rest-probe.mjs) `catalog`, curl on 2026-09-24 |

The terms and the product disagree.
The terms of S3 forbid leveraged trading for every user, while the API lists 50x perpetuals that trade.
Who may open a perpetual position today is therefore Not verified, and it is the first open question for this venue.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.1 %, 1,000 ppm | 0.2 %, 2,000 ppm | `make_rate` `"0.001"` and `take_rate` `"0.002"` on 31 of 31 perpetuals in `GET /api/3/public/symbol`, [`rest-probe.mjs`](../../../scripts/probes/venues/gleec-btc/rest-probe.mjs) `catalog` |
| spot, context only | 0.25 %, 2,500 ppm | 0.25 %, 2,500 ppm | S2 and `take_rate` `"0.0025"` on 206 of 206 spot pairs |

The public fee page S2 publishes one flat "Unique Tier" of 0.25 % maker and 0.25 % taker for all volumes and does not mention perpetuals.
The perpetual rates above come only from the public symbol catalog, which is the account-free default a HitBTC broker publishes per symbol.
No published perpetual fee schedule was found, so the 2,000 ppm taker is a wire value without a document behind it.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 30 working and 1 expired (`TONUSDT_PERP`) | `GET /api/3/public/symbol`, `type` `futures`, `contract_type` `perpetual` |
| USDC-M or other stablecoin perpetuals | absent | every perpetual has `quote_currency` and `fee_currency` `USDT` |
| coin-margined perpetuals | absent | same |
| dated futures | absent | no `cash_settled` contract in `GET /api/3/public/futures/info`, although the API documents that type, S1 |
| options | absent | no option type in the catalog |
| spot | yes, 206 pairs: 100 USDT, 75 BTC, 21 USDC and 10 others | `GET /api/3/public/symbol` |

CoinMarketCap's derivatives ranking of 2026-09-23 lists Gleec BTC with 20 derivatives pairs, and the venue itself lists 30 working perpetuals.

## 4. Perpetual tiers

No tier table for perpetuals is published.
S2 shows one tier for the whole exchange, "From ≥ 0 BTC to ≥ 100,000 BTC", "Fixed Rate", 0.25 % and 0.25 %.
The per-account rate is only readable through the private `Get Futures Fees` call of S1, which this survey does not call.

## 5. Discounts that change the perpetual taker

None published.
S2 says the flat model applies "regardless of whether their monthly volume is 0 BTC or reaches as high as 100,000 BTC".
The site mentions "Become a Market Maker!" with no rates, S2.
Third-party summaries of older schedules quote tiers down to a 0.02 % taker, and those are not on the current page.

## 6. Funding as a cost

| item | value | evidence |
|---|---|---|
| interval | 8 hours, at 00:00, 08:00 and 16:00 UTC | `GET /api/3/public/futures/history/funding/BTCUSDT_PERP?limit=6` rows at 2026-09-22T08:00 to 2026-09-24T00:00, each 8 h apart |
| formula | `funding_rate = avg_premium_index + clamp(interest_rate − avg_premium_index, −0.0005, +0.0005)` | derived, and it reproduced `funding_rate` exactly on 30 of 30 working perpetuals, see [`rest.md`](./rest.md) section 4 |
| interest rate | 0.0001 per period on every perpetual | `interest_rate` in `futures/info` |
| cap and floor | no cap on the rate itself was found, only the ±0.05 % clamp on the interest term. The widest rate on 2026-09-24 was `-0.001355` | `futures/info` |
| who pays | the rate is a "Percent of the contract's mark value". Long pays short when positive is the usual convention, and it is Not verified here | S1 |
| instant | the settlement instant itself was not captured. The history rows are stamped 2 to 4 ms after the hour | funding history |

## 7. Liquidation, settlement and delisting charges

Not publicly specified on any page read.
The expired `TONUSDT_PERP` shows how a delisted perpetual looks: `status` `expired`, `next_funding_time` frozen at 2026-06-15T16:00:00Z, open interest `"0.0"`, and an empty book, see [`rest.md`](./rest.md) section 2.

## 8. CCXT

`node -e "console.log(require('ccxt').exchanges)"` from `server/` lists 104 ids on 4.5.68, and none names Gleec.
The GitHub listing of `ts/src` on master (version 4.5.83 on 2026-09-24) has 111 entries and no Gleec file.
The only hit for "gleec" in `hitbtc.ts` on master is a commented currency code at line 601.

The `hitbtc` class parses the Gleec catalog when its URLs are overridden, because the API is the same.
`new ccxt.hitbtc({ urls: { api: { public: 'https://api.exchange.gleec.com/api/3', private: '…' } } })` loaded 237 markets and 31 swaps, in [`rest-probe.mjs`](../../../scripts/probes/venues/gleec-btc/rest-probe.mjs) `catalog`.
Through that override, `market.taker` is `0.002` and `market.maker` is `0.001` on every swap, read from `take_rate` and `make_rate` at `server/node_modules/ccxt/js/src/hitbtc.js` lines 877 and 878.
The class default `'taker': this.parseNumber('0.0009')` at line 269 is not used for markets.

## 9. Recommended registry values

The engine has no Gleec connector, so any registry entry needs a `hitbtc` instance with the Gleec URLs first, see [`rest.md`](./rest.md) section 8.
If that is built, `takerPpm` 2,000 and `ccxtTakerPpm` 2,000, because the catalog rate and the CCXT market value agree.
The value would be revisited if Gleec publishes a perpetual fee schedule.

## 10. Source ledger

| id | source | read |
|---|---|---|
| S1 | API documentation, `https://api.exchange.gleec.com/` (the page `https://exchange.gleec.com/api` redirects there) | 2026-09-24, curl, HTTP 200, 1.23 MB |
| S2 | Trading Fees Matrix, `https://exchange.gleec.com/trading-fees` | 2026-09-24, curl, HTTP 200 |
| S3 | Terms of Service, `https://exchange.gleec.com/terms-of-use` | 2026-09-24, curl, HTTP 200 |
| S4 | [`rest-probe.mjs`](../../../scripts/probes/venues/gleec-btc/rest-probe.mjs) | 2026-09-24 |
| S5 | `server/node_modules/ccxt/js/src/hitbtc.js`, CCXT 4.5.68 | 2026-09-24 |
| S6 | `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/hitbtc.ts` | 2026-09-24 |

The pages `https://exchange.gleec.com/fees-and-limits` and `https://exchange.gleec.com/terms` redirect to the BTC to USDT terminal, and `https://exchange.gleec.com/fee-tier` answers HTTP 404.
