# Revolut X Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Vancouver, Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers Revolut X, CoinMarketCap rank 162, the crypto exchange of Revolut.
Revolut X lists no perpetuals, no dated futures and no options, so its spot market is the researched product, per design decision 3.
It has no class in CCXT 4.5.68, and CCXT master on GitHub has had a spot-only `revolutx` class since 2026-09-01.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/revolut-x/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/revolut-x/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/revolut-x/ws-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| UK entity | "In the UK, crypto services are provided by Revolut Ltd", a registered cryptoasset firm, FRN 900562 | Published | S6, `fees-probe.py` section repo |
| EEA entity | Not named in any source this host could read | Not publicly specified | S6, section 10 |
| who may trade | Revolut customers in two regions, UK and EEA, which are the only values of the API's `region` parameter | Published, Region-specific | S1, S2, S3 |
| Canada | Not named | Not publicly specified | S1 |
| regions excluded | Not publicly specified beyond the two regions above | Not publicly specified | S1 |
| public market data API from this host | every `/public/` call answered 200 with no challenge | Probed | [`rest.md`](./rest.md) section 1 |
| fee, trading rules and product pages from this host | HTTP 403 "Just a quick security check", a Cloudflare challenge, on `www.revolut.com` and `exchange.revolut.com` | Probed | `fees-probe.py` section pages |

The fee schedule page itself, S7, could not be read from this host.
The challenge was recorded and not worked around, per design decision 5.
The fee numbers below therefore come from Revolut's own GitHub repository for the Revolut X API, S4 and S5, and from CCXT master, S8.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, every pair | 0 %, 0 ppm | 0.09 %, 900 ppm | Published | S4, S5, S8, `fees-probe.py` sections repo and ccxt |

S4 is the fee article that Revolut ships inside its own MCP server, and it reads "Revolut X trading fees are based on a maker-taker fee model".
Its table has one row, "0%" maker and "0.09%" taker.
The official TypeScript SDK sets `MAKER_FEE_RATE = "0"` and `TAKER_FEE_RATE = "0.0009"`, S5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | No | no derivative endpoint in the API reference, S1, and CCXT master sets `'swap': false` at line 30 of S8 |
| dated futures | No | S1, and `'future': false` at line 31 of S8 |
| options | No | S1 |
| spot | Yes, 455 active pairs across the two regions, 393 in UK and 384 in EEA | [`rest.md`](./rest.md) section 2, `rest-probe.py` section catalog |
| margin or leverage | No margin endpoint or field in the API reference | S1 |
| deposit, withdrawal | Out of scope, S4 names a 1 GBP or 3 GBP service fee plus the network fee for crypto withdrawals | S4 |

Every pair in the public configuration is a spot pair with a base and a quote, and none carries a contract size, an expiry or a settlement asset, `rest-probe.py` section catalog.

## 4. Spot tiers

No tier table could be read.
S4 and S5 publish one flat rate, and CCXT master marks the fee `'tierBased': false` at line 115 of S8.
A web search summary of S7, read on 2026-10-09, describes a volume tier table and a zero fee period for new users.
This host could not open S7 to check either claim, so neither is written as a number here.
The registry value in section 9 uses the flat published rate.

## 5. Discounts that change the taker

None that could be verified.
The new user zero fee period in the search summary of S7 is Not verified, for the reason in section 4.
No token discount, referral discount or market maker programme appears in S1, S4 or S5.

## 6. Funding as a cost

Not offered.
Revolut X has no perpetuals, so there is no funding rate, S1, S8.

## 7. Liquidation, settlement and delisting

Not offered for liquidation, since there is no leverage, S1.
No delisting charge is published in S1, S4 or S5.

## 8. CCXT

Revolut X has no class in CCXT 4.5.68.
The 104 files of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` hold no file named for Revolut and no file whose text contains the word revolut, `fees-probe.py` section ccxt.
CCXT master on GitHub, head `f0aca06eb748` committed 2026-10-08, has `ts/src/revolutx.ts`, added in commit `3577aee15e04` on 2026-09-01, S8.
That class sets `'spot': true` at line 28, `'swap': false` at line 30 and `'future': false` at line 31.
Its exchange-wide fees are `'taker': this.parseNumber ('0.0009')` at line 117 and `'maker': this.parseNumber ('0')` at line 118.
`parseMarket` writes the same numbers onto every market at lines 320 and 321.
So a later CCXT release with this class would report `market.taker` 0.0009 for a spot market without credentials, which is 900 ppm.
CCXT master has no `ts/src/pro/revolutx.ts`, so no WebSocket class, `ws-probe.py` section ccxt.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 900 | the published flat spot taker, S4, S5 |
| `ccxtTakerPpm` | none | no class in CCXT 4.5.68, and CCXT master would give 900 |

These values matter only to a future spot leg.
The venue has no perpetuals, so it cannot join the engine as a perpetual leg.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Revolut X Crypto Exchange REST API reference | https://developer.revolut.com/docs/api/revolut-x-crypto-exchange | 2026-10-09 | Revolut | endpoints, regions, no derivatives, sections 1, 3 and 5 |
| S2 | Get order book, operation page | https://developer.revolut.com/docs/api/revolut-x-crypto-exchange/operations/get-order-book-public.md | 2026-10-09 | Revolut | `region` values UK and EEA, section 1 |
| S3 | Get tickers, operation page | https://developer.revolut.com/docs/api/revolut-x-crypto-exchange/operations/get-tickers-public.md | 2026-10-09 | Revolut | `region` values, section 1 |
| S4 | Revolut X Fees, article in the official API repository | https://github.com/revolut-engineering/revolut-x-api/blob/master/mcp/src/data/articles/revolut-x-fees.md | 2026-10-09 | Revolut | 0 % maker, 0.09 % taker, withdrawal fees, sections 2 to 5 |
| S5 | SDK fee constants | https://github.com/revolut-engineering/revolut-x-api/blob/master/api/src/config/fees.ts | 2026-10-09 | Revolut | `MAKER_FEE_RATE`, `TAKER_FEE_RATE`, section 2 |
| S6 | Who Provides Revolut's Crypto Services, article in the official API repository | https://github.com/revolut-engineering/revolut-x-api/blob/master/mcp/src/data/articles/revolut-x-crypto-services-provider.md | 2026-10-09 | Revolut Ltd, UK | UK entity, section 1 |
| S7 | Crypto Exchange Fees | https://www.revolut.com/legal/crypto-exchange-fees/ | 2026-10-09, HTTP 403 challenge from this host | Revolut | not read, sections 1, 4 and 5 |
| S8 | CCXT master `revolutx` class at `f0aca06eb748` | https://github.com/ccxt/ccxt/blob/master/ts/src/revolutx.ts | 2026-10-09 | | type flags and fees, sections 3, 4 and 8 |
