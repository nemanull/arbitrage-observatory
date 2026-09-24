# Kinesis Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:51 to 05:10 UTC, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

This profile covers Kinesis Money, the Kinesis Exchange run by Kinesis Cayman.
Kinesis lists no perpetual, dated future or option, so the survey plan's spot variant applies and this file records the spot fee.
No CCXT class exists for the venue, see section 8.
Every access result below comes from the Canadian VPN exit named in the Probed line, not from a US address.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Kinesis Cayman, "an exempted company incorporated in the Cayman Islands with limited liability", clauses 1.1 and 1.2 of the Terms of Use | S2 |
| registration | "a Virtual Asset Service Provider in the Cayman Islands, by the Cayman Islands Monetary Authority (reference number 1877923)", site footer | S7 |
| related entity | Kinesis Global Pty Ltd, ACN 656 201 660, AUSTRAC registered, named in clause 6.12 only as an issuer of third party tokens | S2 |
| terms version | "Effective Date: May 28th 2026" | S2 |
| fee page version | `dateModified` 2026-06-26T11:34:39+00:00 in the page's metadata | S1 |
| product researched | spot, 162 pairs on 2026-09-23 UTC | [`rest.md`](./rest.md) section 2 |
| CoinGecko | exchange id `kinesis_money`, trust score 4, trust score rank 133 in the API reply at 04:47 UTC, 34 tickers, about 1.0 million USD of 24 h volume | S8 |

The task brief gave the CoinGecko trust rank as 129, and the API returned 133 a few hours later, so the rank moves.

### Who may trade

- Terms clause 4.1 bars anyone "located in, or a citizen or resident of any state, country, territory or other jurisdiction where" access would break local law or where Kinesis "at our sole discretion" prohibits it, S2.
  The terms publish no list of excluded countries, and none was found in the help centre.
- The site footer says the website "and any information materials within are not intended to be accessed by UK-based persons", S7.
- US persons are not excluded by any text found.
  The Kinesis card program lists "North America: United States, Mexico, St. Pierre and Miquelon" among the countries where it "may be offered to eligible users", S2, and the fee page prices ACH purchases for "USD United States", S1.
  Whether a US resident may use the exchange itself is therefore not stated outright, and this profile records it as allowed by omission, not confirmed.
- Accounts verify identity through Persona, and "access to certain platform features will be restricted" until that completes, S12.

### What this host could reach

| endpoint | result on 2026-09-23 UTC |
|---|---|
| `https://kinesis.money/about-us/fees/` | 200, 1.47 MB |
| `https://client-api.kinesis.money/v1/exchange/pairs`, `/mid-price/KAU_USD`, `/depth/KAU_USD`, the documented API, unsigned | 403 `{"message":"Forbidden resource","error":"Forbidden","statusCode":403}`, P1 |
| `https://fastapi.kinesis.money/api/exchange/fees/trade`, the web app's call | 200 `{"rate":0.0022}`, P1 |

No refusal named a region, so the 403 is the documented API's key check and not a geoblock.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, every pair, every account | 0.22 %, 2,200 ppm | 0.22 %, 2,200 ppm | S1, S2 Schedule 5 clause 5.1.1, S3, P1 |

The fee is one flat "Execution Fee" with no maker and taker split.
The fee page gives 0.22 % both for a market order ("at the quoted market price") and for a limit order on KAU and KAG, and 0.22 % for "Trade assets via the Kinesis Exchange" on every other asset, S1.
Schedule 5 clause 5.1.1 of the terms says the fee is "at a rate of 0.22% inclusive of Value Added Tax of the total transaction value, calculated and debited in the base pair being traded", S2.
The web app's public call `GET https://fastapi.kinesis.money/api/exchange/fees/trade` answered `{"rate":0.0022}` without credentials, P1.

The terms say the fee is debited in "the base pair being traded", while the catalog reply names the quote currency in its `fee` field on 162 of 162 pairs, for example `"fee":"C1USD"` on `KAU_C1USD`, see [`rest.md`](./rest.md) section 2.
Which currency is debited was not verified, since that needs a trade.

## 3. Coverage matrix

| family | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | no derivative in the 162 pair catalog, P1, and none on CoinGecko's derivatives list on 2026-09-22, S9 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | same |
| spot | present, 162 pairs | `GET /api/tradeable-symbols/public`, P1 |

The spot pairs quote in the Kinesis Currency One stablecoins (C1USD 48, C1GBP 12, C1EUR 12, C1AUD 12, C1CAD 12, C1CHF 12, C1AED 10, C1SGD 10, C1JPY 2, C1MXN 2), in KAU 10 and KAG 11, in USDT 4, USDC 4 and BTC 1, P1.
KAU is Kinesis gold, one gram per token, and KAG is Kinesis silver, one troy ounce per token, as the fee page's redemption example "$90 per KAU (1g of gold)" and "$45 per KAG (1oz of silver)" shows, S1.
Only eight pairs quote in a member of the engine's USD settlement family: `KAU_USDT`, `KAG_USDT`, `BTC_USDT`, `ETH_USDT`, `KAU_USDC`, `KAG_USDC`, `BTC_USDC` and `ETH_USDC`.

## 4. Spot tiers

No tier exists.
The fee page, the terms fee schedule and the help centre article "What are the transaction fees?" each give a single 0.22 % with no volume or balance qualification, S1, S2 and S3.
The words "maker", "taker", "VIP" and "tier" do not occur on the fee page, by a text search of the page saved on 2026-09-22.

## 5. Discounts that change the taker

| mechanism | effect | source |
|---|---|---|
| token holding | none found, KVT holding earns a yield and not a fee discount | S1 |
| Velocity Yield | "10%** of all these fees are collected and distributed back to all eligible Kinesis users", in proportion to the user's KAU and KAG volume, paid monthly in gold or silver | S6 |
| Holder's, Referrer's and Partner's Yields | paid monthly from the fee pool, for holding, referring or running a partner network, not tied to the trader's own fee | S5 |
| market maker program | none published | |
| zero fee promotion | none published on 2026-09-23 UTC | S1 |

The Velocity Yield is a variable monthly payment from a pool and does not lower the fee charged on the fill.
It covers only KAU and KAG pairs, S6.
The payment is a share of 10 % of a pool that also holds card and widget fees, so its size per trade cannot be predicted.
The engine should model the full 2,200 ppm.

## 6. Funding as a cost

Not applicable.
Kinesis lists no perpetual, so no funding is charged.

## 7. Liquidation, settlement and delisting charges

Not applicable to spot, since there is no leverage and no settlement.
Terms Schedule 7 clause 2.6.1 says "Kinesis shall be the immediate counterparty" to each executed trade, S2.
Sending KAU or KAG costs 0.45 %, and crypto withdrawals carry per asset fees listed in the account's Fee Schedule and on the fee page, S1 and S4.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | `ccxt.exchanges` holds 104 ids and none matches `kin`, `kau` or `kms`, P1 |
| `server/node_modules/ccxt/js/src/` | no file named for Kinesis |
| CCXT master on GitHub | `ts/src` lists 105 `.ts` files at commit `1d8b674` of 2026-09-22T12:48:27Z and none matches `kin` or `kau`, and `ts/src/kinesis.ts` returns 404, S11 |

So there is no `market.taker` to read, and `ccxtTakerPpm` has no CCXT constant to cite.

## 9. Recommended registry values

None, because Kinesis should not join the engine, see [`rest.md`](./rest.md) section 8.
If a spot study ever needs a number, `takerPpm` is 2,200 from S1 and S2, and `ccxtTakerPpm` stays unset because no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Kinesis fees | https://kinesis.money/about-us/fees/ | 2026-09-22 | Kinesis Cayman, global | 0.22 % market and limit, 0.45 % sends, ACH for the United States, sections 2 to 7 |
| S2 | Kinesis Terms of Use, effective 2026-05-28 | https://kinesis.money/about-us/documents/terms-of-use/ | 2026-09-22 | Kinesis Cayman | operator, clause 4.1, card countries, Schedule 5 clause 5.1.1, Schedule 7 clauses 2.6.1, 5.1.4 and 5.1.6, sections 1 to 7 |
| S3 | What are the transaction fees?, updated 2026-09-08 | https://support.kinesis.money/hc/en-gb/articles/12356187161885-What-are-the-transaction-fees | 2026-09-22 | Kinesis, global | "Exchange Trade Fees: 0.22%", sections 2 and 4 |
| S4 | Fees on the Kinesis Exchange, updated 2026-09-15 | https://support.kinesis.money/hc/en-gb/articles/23829239498653-Fees-on-the-Kinesis-Exchange | 2026-09-22 | Kinesis, global | deposit and withdrawal fee lookup, section 7 |
| S5 | Can I earn yields on the Kinesis Exchange?, updated 2026-09-15 | https://support.kinesis.money/hc/en-gb/articles/23830128879133-Can-I-earn-yields-on-the-Kinesis-Exchange | 2026-09-22 | Kinesis, global | yield types, section 5 |
| S6 | How is my Velocity Yield calculated?, updated 2023-08-22 | https://support.kinesis.money/hc/en-gb/articles/12338932067869 | 2026-09-22 | Kinesis, global | 10 % of the fee pool, KAU and KAG only, section 5 |
| S7 | Kinesis documents page footer | https://kinesis.money/about-us/documents/ | 2026-09-22 | Kinesis Cayman | CIMA registration 1877923, UK-based persons, section 1 |
| S8 | CoinGecko API, exchange `kinesis_money` | https://api.coingecko.com/api/v3/exchanges/kinesis_money | 2026-09-22 | CoinGecko | trust rank, tickers, volume, section 1 |
| S9 | CoinGecko derivatives exchange list, as given in the task brief | https://www.coingecko.com/en/exchanges/derivatives | 2026-09-22 | CoinGecko | no Kinesis entry, section 3 |
| S10 | Kinesis API example repository, commit `5ef2259` of 2022-04-28 | https://github.com/bullioncapital/kinesis-api | 2026-09-22 | Kinesis | documented API host and key signing, section 1 |
| S11 | CCXT `ts/src` on master, commit `1d8b674` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Kinesis class, section 8 |
| S12 | Verify your identity, updated 2026-09-16 | https://support.kinesis.money/hc/en-gb/articles/12403016019869 | 2026-09-22 | Kinesis, global | Persona verification, section 1 |
| P1 | `rest-probe.mjs main` at 04:51 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | fee call, catalog, documented API refusal, CCXT check |
| P2 | `rest-probe.mjs main` rerun at 05:08 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the same fee call, catalog, refusal and CCXT results |
