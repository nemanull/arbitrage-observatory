# Kanga Global Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:52 to 05:15 UTC, from the development host near Seattle.

This profile covers spot trading on Kanga Global, because Kanga lists no perpetual, see section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees and spot tiers stand where the perpetual numbers would.
CCXT 4.5.68 has no Kanga class, and neither does the current CCXT master, see section 8.
Every number carries a source ledger row, a probe reference, or a file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/kanga/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/kanga/ws-probe.mjs).
All traffic from this host leaves through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada, and Cloudflare answered from its Seattle and Vancouver edges (`cf-ray` suffixes `SEA` and `YVR`), so every access result below is from that Canadian VPN exit.

Kanga publishes no fee page as plain HTML.
The fee page, the terms and the futures rules are rendered by the web apps at `trade.kanga.global` and `trade.kanga.global/futures`, and their text was read from the JavaScript bundles and the English string file those apps load, S3 to S6.
The fee numbers were then confirmed against the public calls that feed those pages, P1.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | 2026-09-22 local time, from the bundles and string file served that day | S3 to S6 |
| venue name on CoinGecko | "Kanga Global", country Costa Rica, established 2018, trust score 4, trust score rank 136, 24 h volume 103.77 BTC | S7 |
| operator of Kanga Global in the current terms | "3-102-93-8308 SRL registered in the Republic of Costa Rica", "(hereinafter referred to as: the Operator)" | S3, route `/legal/terms` |
| operators in the previous terms, in effect until July 1, 2026 | ALL4ONE Limited Liability Company of Gdańsk, KRS 0000668902, register of virtual currency activities RDWW-1709, for the European Economic Area, and 3-102-93-8308 SRL for every other country | S3, route `/legal/terms-v6` |
| who may trade | natural persons over 18 with full legal capacity, and other entities with legal capacity, who accept the terms | S3, `/legal/terms` §1 |
| US persons | may not trade: a user declares they "are not currently in the USA, are not US residents nor act on behalf of a business entity which has an office in the USA" | S3, `/legal/terms` §1 |
| other exclusions in the spot terms | any country where using the service "would be illegal", and persons on the UN Security Council lists named in resolutions 2253 (2015) and 1988 (2011) | S3, `/legal/terms` §1 |
| exclusions in the futures terms | "The Service is not available to Users from the United States of America, Iran, North Korea or other countries or territories for which the Operator has temporarily or permanently suspended the provision of the Service." | S5, §3 |
| Canada | not named in any exclusion read | S3, S5 |
| second brand | `kanga.exchange` is the EEA site, and `trade.kanga.exchange` answered this host with HTTP 302 to `https://kanga.exchange` on every path tried, including `/market/BTC-USDT` and `/futures` | P1, tag `trade.kanga.exchange` |

Whether the 302 on `trade.kanga.exchange` is a geographic rule or a retired host is Not verified.
The public API hosts answered this host normally, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, every market except three, base rate | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | S4 `currencyTable.tradingFees`, P1 tags `assets fees` and `fee discounts` |
| perpetuals | none listed | none listed | section 3 |

The fee page says "Trading fee is {{ rate }}% of the transaction amount, charged to both the buyer and the seller.", S4.
The page fills `rate` with `defaultTxFeeRate` times 100, S3, and the public call behind it returned `"defaultTxFeeRate":"0.002"`, P1.
The CoinMarketCap-format assets call returned `maker_fee` 0.002 and `taker_fee` 0.002 on 528 of 528 assets, P1.
Three markets carry `customMarketFeeRate` `"0"` in the web app's market list: `kPLK-oPLN`, `kERA-oEUR` and `WBTC-BTC`, P1 tag `view`.
None of the three is quoted in USD, USDC or USDT.

## 3. Coverage matrix

| product | present | detail | source |
|---|---|---|---|
| USDT-margined perpetuals | absent | no perpetual in any catalog call | P1 |
| USDC-margined perpetuals | absent | | P1 |
| coin-margined perpetuals | absent | | P1 |
| leveraged futures contracts | present, but not an exchange market | 22 markets, all quoted in USDC, priced by the operator and settled in KXT, see below | S5, P1 tag `futures list` |
| options | absent | no call, route or string names one | S1, S3 |
| spot | present, researched | 322 markets of type `NORMAL`: 145 quoted in USDC, 117 in USDT, 42 in oPLN, 5 in oEUR, 3 in oUSD, 3 in BTC, 2 in EURC and 1 each in EURQ, USDQ, COMB, ETH and UAHG | P1 tag `markets` |

The futures product is not a perpetual in the sense the engine needs.
The futures terms define it as "a leveraged futures contract offered as part of the Service", S5 §2.
The contract has a maturity date: a position stays open until, among other things, "the Futures Contract expires after its maturity date", S5 §8.
An optional rollover moves open positions to "a new period of a Futures Contract after its expiry date", and "The current available maturities for Futures Contracts are published in the Fees Table.", S5 §5 and §10.
The counterparty is the operator: "The settlement rate for Long Positions and Short Positions is determined based on the rate published on the Platform at the time of closing the position.", S5 §9.
Settlement "takes place exclusively in KXT", a unit of account that "does not have a contract on the blockchain network" and is used only inside the futures service, S5 §2 and §7.
The public market list carries one `price` per market and no bid, ask, book, index, mark, funding rate or expiry field, P1 tag `futures list`.
The futures web app polls that price and the market list every 5 s over REST and opens no socket, S5.
The superseded futures terms, in effect until July 1, 2026, set the same rules and name "the current Non-EEA Operator of the Exchange" as the provider, S6.
So there is no order book to cross and no index or mark to anchor, and the product is named here and not profiled further.

Deposit and withdrawal fees are listed on the web app's "Supported cryptocurrencies and operating fees" page at `https://trade.kanga.global/currencies`, S4.

## 4. Spot tiers

There is one base rate, 0.2 % for maker and taker, section 2.
No volume tier exists in the fee page code, the string file or any public fee call, S3, S4, P1.

The only reduced rate is a preferential maker rate for KNG Earn participants, S4 `currencyTable`.
The public call `POST https://trade.kanga.global/api/pos/transaction/fee/discounts/get` returned the levels, P1 tag `fee discounts`.

| level | maker | taker | minimum KNG Earn subscription | accumulated Autotransfer bonus |
|---|---|---|---|---|
| base | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | none | none |
| Level 1 | 0.16 %, 1,600 ppm | 0.2 %, 2,000 ppm | 200 KNG | at least 10 % |
| Level 2 | 0.09 %, 900 ppm | 0.2 %, 2,000 ppm | 1,000 KNG | at least 10 % |
| Level 3 | 0.03 %, 300 ppm | 0.2 %, 2,000 ppm | 10,000 KNG | at least 10 % |

### Qualification

The string file says "To qualify for a preferential fee rate ("maker" only), you need to:" meet the minimum subscription and "have active Autotransfer with an accumulated bonus of at least {{ value }}%", S4.
The page fills `value` with `minFactorCriteria` times 100 minus 100, S3, and `minFactorCriteria` was `"1.10"` on all three levels, so the bonus threshold is 10 %, P1.
The maker figure on each level is `discountRate` times 100, S3, and `discountRate` was `"0.0016"`, `"0.0009"` and `"0.0003"`, P1.
The taker column stays at the base rate because the text limits the discount to "maker" only.

## 5. Discounts that change the taker

None was found.
The KNG Earn levels change only the maker, section 4.
The affiliate programme pays the referrer "up to 20% commission on each transaction made by a referred user", and no string names a discount for the referred user, S4.
No zero-fee promotion with an end date appears in the fee page code or strings, S3, S4.
The string file adds that "All fees charged in cryptocurrency or fiat currency are immediately converted to KNG (by purchasing tokens from holders at market price).", S4.

## 6. Funding as a cost

Spot has no funding.

For completeness, the leveraged futures of section 3 charge a flat Funding Fee that is a cost to both sides, not a payment between longs and shorts.
The FAQ gives the formula `A * L * FF`, where A is the margin, L the leverage and FF the Funding Fee rate, charged "at settlement times, the frequency of which is specified in the Table", S5.
"If a position is closed before the first settlement time, the Funding Fee will not be charged.", and accrued fees are collected when the position closes, S5.
The market list gave `fundingLong` and `fundingShort` of `"0.0002"` on all 22 markets, P1.
The settlement frequency sits in a Fee Table that no public call returned, so the interval is Not verified.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge in any source read, S3, S4.
The spot terms say fees "are determined in the fee price list" and "The Operator may change the fees at any moment", S3 `/legal/terms`.
No delisting charge was found.

The futures market list carries `orderOpen`, `orderClose` and `liquidation` rates per market, P1 tag `futures list`.

| futures markets | open | close | liquidation |
|---|---|---|---|
| `BTC-USDC`, `ETH-USDC`, `SOL-USDC`, `BNB-USDC`, `XRP-USDC`, `DOGE-USDC`, `LTC-USDC`, `SUI-USDC`, `XLM-USDC`, `WLD-USDC`, `PAXG-USDC`, `ZEC-USDC` | 0.05 % | 0.06 % | 0.1 % |
| `ADA-USDC`, `TAO-USDC` | 0.05 % | 0.08 % | 0.1 % |
| `LINK-USDC`, `NEAR-USDC` | 0.07 % | 0.1 % | 0.1 % |
| `ENA-USDC`, `PUMP-USDC` | 0.08 % | 0.12 % | 0.1 % |
| `ASTER-USDC` | 0.1 % | 0.12 % | 0.1 % |
| `XPL-USDC` | 0.1 % | 0.14 % | 0.1 % |
| `AVAX-USDC` | 0.1 % | 0.15 % | 0.1 % |
| `PEPE-USDC` | 0.35 % | 0.35 % | 0.1 % |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| CCXT 4.5.68 class | none: `ccxt.exchanges` has 104 ids and none matches `kanga` | P1 tag `ccxt`, and `grep -ril kanga server/node_modules/ccxt/js/src` found no file |
| current CCXT master | none: `ts/ccxt.ts` at version 4.5.82 imports 105 exchange modules, none named Kanga, and `ts/src/kanga.ts` answered HTTP 404 | S8 |
| `market.taker` | not applicable | no class |

The GitHub contents API refused this host with 403 "API rate limit exceeded" on 2026-09-22, so the master check read the raw `ts/ccxt.ts` file instead, S8.

## 9. Recommended registry values

No registry entry is recommended.
The engine builds its catalog from CCXT swaps at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68 and 200 to 201, and Kanga has neither a CCXT class nor a swap.

If Kanga spot were ever wired in through a custom catalog, the taker to model is 2,000 ppm, section 2.

```ts
kanga: {
  takerPpm: 2_000,
  // Hypothetical: spot only, no CCXT class, fee page and assets call both give 0.002 for maker and taker.
}
```

`ccxtTakerPpm` would stay unset because there is no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Kanga Global API documentation, OpenAPI 3.0.3 file `api.json`, `last-modified` 2026-06-30 | https://apidoc.kanga.global/assets/api.json | 2026-09-22 | Kanga Global | public calls, no options, no rate limit text, sections 3 and 8 of [`rest.md`](./rest.md) |
| S2 | Public kanga.exchange API, OpenAPI 3.0.3 file `openapi.yaml` in CoinGecko and CoinMarketCap format, `last-modified` 2026-07-20 | https://public.kanga.exchange/openapi.yaml | 2026-09-22 | Kanga | the `/api/v2/market/assets` fee fields |
| S3 | Kanga Global web app bundle, with the current terms at route `/legal/terms`, the superseded terms at `/legal/terms-v6`, and the fee page code | https://trade.kanga.global/main.300e4a41cf127ad1a85e.bundle.js | 2026-09-22 | 3-102-93-8308 SRL, and ALL4ONE for the EEA until 2026-07-01 | sections 1, 2, 4, 5 and 7 |
| S4 | Kanga Global web app English strings | https://trade.kanga.global/static/i18n/en.80dd6aca537b321d8102.yml | 2026-09-22 | Kanga Global | fee page text, KNG Earn levels, affiliate, deposit and withdrawal page name, sections 2 to 5 |
| S5 | Kanga Futures web app bundle, with the current futures terms, the FAQ and the REST calls it makes | https://trade.kanga.global/futures/assets/index-DYh-NeI9.js | 2026-09-22 | Kanga Global operator | futures product, exclusions, funding formula, sections 1, 3, 6 and 7 |
| S6 | Superseded futures terms, route `/legal/futures-v2`, "Version in effect until July 1, 2026", inside S3 | https://trade.kanga.global/main.300e4a41cf127ad1a85e.bundle.js | 2026-09-22 | the "Non-EEA Operator" | the same product rules under the earlier operator wording, section 3 |
| S7 | CoinGecko API, exchange `kanga` | https://api.coingecko.com/api/v3/exchanges/kanga | 2026-09-22 | CoinGecko | name, country, trust score and rank, 24 h volume, section 1 |
| S8 | CCXT master `ts/ccxt.ts`, version 4.5.82, and `ts/src/kanga.ts` | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts | 2026-09-22 | CCXT | no Kanga class, section 8 |
| P1 | `rest-probe.mjs main`, runs at 04:52 and 05:14 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/kanga/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | catalog, fee calls, futures list, access, sections 1 to 8 |
