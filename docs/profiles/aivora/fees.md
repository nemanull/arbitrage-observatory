# Aivora Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in Pacific time, which is 2026-09-23 04:14 to 04:50 UTC, from the development host near Seattle.
All traffic left through the laptop's Surfshark WireGuard tunnel, whose exit geolocates to Canada (Cloudflare trace `loc=CA`, `colo=YVR`), so every access result below is what a Canadian address saw.

This profile covers the USDT-M and USDC-M perpetuals of Aivora Exchange, which CCXT 4.5.68 does not list.
The fee numbers come from the data call behind the site's own fee page, S2, because the fee page renders its table in the browser and the static HTML carries no numbers.
The `fees` mode of [`rest-probe.mjs`](../../../scripts/probes/venues/aivora/rest-probe.mjs) repeats that call and printed the same tables.
The protocol side is in [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "Aivora Ltd." is the party named in the User Agreement's termination clause, and the agreement is governed by the laws of Hong Kong | S3 sections 8 and 18.1 |
| registration shown | "Aivora Ltd is registered as a Money Services Business (MSB) with the Financial Crimes Enforcement Network (FinCEN)", with the note that "Aivora" is a brand used by different group entities that operate independently | S5 |
| country on CoinGecko | United Arab Emirates, established 2023 | S7 |
| futures excluded regions | "customers from the following countries or regions are not supported for futures trading: the United States, Iraq, Hong Kong (China), Cuba, Iran, North Korea, Sudan, Syria, American Samoa, Puerto Rico, Guam, Bangladesh, Ecuador, China, Kyrgyzstan, Northern Mariana Islands, United Kingdom, Canada, Macau (China), Taiwan (China)." | S4 |
| platform prohibited regions | Canada (Alberta), Crimea, Donetsk, Luhansk, Cuba, Hong Kong, Iran, North Korea, Singapore, Sudan, Syria, the United States and its territories, Iraq, Libya, Yemen, Afghanistan, Central African Republic, Democratic Republic of Congo, Guinea-Bissau, Haiti, Lebanon, Somalia, the Netherlands and South Sudan | S3 definition "Prohibited countries / regions" |
| US persons | may not trade the perpetuals: the United States heads the futures exclusion list, and "American" is defined to include any US citizen or resident | S3, S4 |
| Canadian persons | may not trade the perpetuals under S4, although S3 names only Alberta for the platform as a whole | S3, S4 |
| public data from this host | the fee data call, the site, the open API and the public sockets all answered from the Canadian exit with no refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | P1, P3 |

The two restriction lists disagree on Canada, and the stricter one is the futures list.
No page names a contracting entity per region.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, 72 tradable | 0.02 %, 200 ppm | 0.05 %, 500 ppm | S2 `type` 2, level "Regular User": `"maker":2.0E-4`, `"taker":5.0E-4` |
| USDC-M perpetuals, 5 tradable | 0.02 %, 200 ppm | 0.05 %, 500 ppm | S2 publishes one futures table with no margin-currency split |
| spot, for the coverage matrix only | 0.08 %, 800 ppm | 0.1 %, 1,000 ppm | S2 `type` 1, level "Regular User" |

The futures table has no separate row for the 24 TradFi perpetuals, so they are read as the same 500 ppm taker.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 72 tradable of 236 listed | `GET /futures/open/fapi/v1/contracts`, 164 of the 241 rows have `status` 0, see [`rest.md`](./rest.md) section 2 |
| of which TradFi perpetuals | 24 tradable: 4 metals, 3 energy, 17 equities and ETFs | `E-XAU-USDT`, `E-XAG-USDT`, `E-XPT-USDT`, `E-XPD-USDT`, `E-CL-USDT`, `E-BZ-USDT`, `E-NATGAS-USDT`, `E-SPY-USDT`, `E-QQQ-USDT`, `E-AAPL-USDT` and others, P1 `catalog` |
| USDC-M linear perpetuals | yes, 5: BTC, ETH, SOL, XRP, DOGE | P1 `catalog`, each also listed as a USDT-M pair |
| coin-M inverse perpetuals | absent | every row has `side` 1, "正向" (linear), and the web list has `contractSide` 1 on all 77 |
| dated futures | absent | every row has `type` `E`, "永续合约" (perpetual), and the web list has `deliveryKind` `"0"` on all 77 |
| options | absent | no options product on the site or in the API documentation, S1 |
| spot | present | CoinGecko counts 42 pairs and 16,491 BTC of 24 h volume, S7, and the spot socket `wss://ws.aivora.com/spot` upgrades, see [`websocket.md`](./websocket.md) section 1 |
| margin | present | S1 page "杠杆交易" (margin trading) |

CoinGecko's derivatives id list returned `aivora-exchange-futures` on 2026-09-23 UTC, but its detail call answered 404 `{"error":"market not found"}`, and the ranked derivatives list of 113 venues did not include it, S7.
So CoinGecko knows the futures venue and publishes no data for it.

## 4. Perpetual tiers

One futures table covers every perpetual, S2 `type` 2.
The `condition` block reads `firstKey` `futures_trade` and `secondKey` `total_asset`.

| level | 30-day futures volume | or total assets | maker | taker | taker ppm |
|---|---:|---:|---:|---:|---:|
| Regular User | below 1,000,000 | below 1,000 | 0.02 % | 0.05 % | 500 |
| VIP1 | 1,000,000 | 1,000 | 0.018 % | 0.05 % | 500 |
| VIP2 | 5,000,000 | 10,000 | 0.016 % | 0.05 % | 500 |
| VIP3 | 8,000,000 | 50,000 | 0.014 % | 0.04 % | 400 |
| VIP4 | 20,000,000 | 200,000 | 0.012 % | 0.0375 % | 375 |
| VIP5 | 50,000,000 | 1,000,000 | 0.01 % | 0.035 % | 350 |
| VIP6 | 100,000,000 | 2,000,000 | 0.008 % | 0.0315 % | 315 |
| VIP7 | 200,000,000 | 3,000,000 | 0.006 % | 0.03 % | 300 |

The volume and asset thresholds are the `firstValue` and `secondValue` strings of S2, with `compareRule` `lt` on the first row and `ge` on the rest.
The table carries no currency, and the fee page labels the columns "30-Day Trading Volume ({0})" and "Assets ({0})", with assets "convert[ed] to USD", S2.

### Qualification

The fee page says "Meet any of the following requirements to level up", so volume or assets is enough, S2.
It also says "Meeting VIP criteria in any trading type automatically qualifies for the same VIP level across all types", with the example that spot VIP 1 gives futures VIP 1, S2.
Volumes are computed "in the past 30 days at 1:00{0} the next day", assets are snapshotted at the same hour, and levels update "each day at 2:00 {0}", where `{0}` is a time zone the page fills in at run time, S2.

## 5. Discounts that change the perpetual taker

| discount | state on 2026-09-23 UTC | source |
|---|---|---|
| platform token | the futures `condition` carries `"platformSymbol":"token"`, `"platformRate":0.4` and `"platformOpen":0`, which reads as a token discount that is switched off. Whether 0.4 means 40 % off or paying 40 % is Not publicly specified | S2 |
| referral | the fee page has a "30-Day Total Referrals" condition string, but no futures row uses it | S2 |
| market maker or VIP by application | the VIP page holds only "Become an Aivora VIP, Share the Success" and a link to `m.aivora.com/en_US/promotional/apply-aivora-vip`, with no published rates | S9 |
| futures trial fund, vouchers | margin bonuses, not fee changes | site pages "Futures Trial Fund" and "Apply Voucher" |
| zero fee promotions | none found | |

## 6. Funding as a cost

Funding is documented in the futures help center that the site links as its contract guide, `contractProInfo` `https://futuresdoc.gitbook.io/help-center/v/en/` in S10.
That help center is written for a white-label futures platform and names no exchange, so every number from it is marked S6 and was checked against the wire where the wire allows.

| item | documented | observed |
|---|---|---|
| interval | "Every 8 hours is a period ... namely 00:00, 08:00, 16:00 (GMT+8)", which is 16:00, 00:00 and 08:00 UTC, S6 | `capitalFrequency` 8 on all 77 tradable contracts, and `nextCapitalSettTime` 1790150400000, 2026-09-23 08:00 UTC, on 76 of them, S10 via P1 `catalog` |
| offset contract | not documented | `E-XAG-USDT` has `capitalStartTime` 4 and `nextCapitalSettTime` 1790164800000, 12:00 UTC, so it settles four hours off the others |
| who pays | "When the funding rate is positive, the long position will pay the funding fee, and the short position will charge the funding fee", S6 | not observed |
| amount | "Funding fee = position value * funding rate", "Position value = size * contract size * mark price", taken from position margin in the margin currency, S6 | not observed |
| formula | "Funding rate = clamp (average premium index + clamp (composite rate – average premium index, ...), funding rate upper limit, funding rate lower limit)", with a composite rate of 0.01 % and a premium index sampled every 5 s on depth weighted prices at 8,000 USDT, S6 | the socket ticker says `"admin_fund_rate_source":"\"third\""`, so the rate is taken from a third party that is Not publicly specified, see [`rest.md`](./rest.md) section 4 |
| cap and floor | the formula names upper and lower limits but publishes no numbers, S6 | the open API returns no cap field |

The settlement instant was not captured, since this survey does not wait for one.
The open API documents no funding history call, and a guessed `/fundingRate` path answers `-1002`, the same answer as any unknown path, see [`rest.md`](./rest.md) section 6.
So whether `currentFundRate` is the rate charged at the next settlement is inferred from its documented name only, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

- Liquidation fee: the site says a position is closed "When margin ratio <= maintenance margin rate + liquidation taker fee", but no rate is published, S4.
- The liquidation engine takes the position at the bankruptcy price, and any better fill goes to an insurance fund shared by all contracts of one margin currency, S6.
- ADL follows when the insurance fund is short, S6.
- Delisting: the site posted "Aivora to Delist TONUSDT USDT-M Perpetual Contract" on 06-24, and `E-TON-USDT` is one of the 164 rows with `status` 0, S4 and P1.
  No delisting settlement charge is published.
- Deposit and withdrawal fees are listed per coin by the site's `get_coin_withdraw_fee_list` call behind the fee page, S2.

## 8. CCXT

CCXT 4.5.68 has no Aivora class.
`node -e "console.log(require('ccxt').exchanges)"` from `server/` printed 104 ids, none matching `aiv` or `vora`, and `server/node_modules/ccxt/js/src` has no such file, P1 `catalog`.
The current CCXT master on GitHub, `ts/src` at commit `1d8b674434fde39ef282988b066812adf8d19b9e` on 2026-09-23 UTC, has 105 files and none named after Aivora, and its README does not mention it, S8.
So there is no `market.taker` to report.

Aivora runs the open API of a white-label platform, with `X-CH-APIKEY` headers and `/sapi/v1` and `/fapi/v1` paths, S1.
CCXT has no generic class for that platform either, so no other class can be pointed at it.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 500 | VIP 0 futures taker "Regular User" `"taker":5.0E-4` in S2, and the same for USDT-M and USDC-M |
| `ccxtTakerPpm` | none | CCXT 4.5.68 has no class, so there is no constant to declare, and the catalog would come from a loader outside CCXT |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Aivora API documentation, pages 更新日志, 基本信息, 合约交易, Websocket推送, 错误码, 常见问题 | https://kaisensei34.gitbook.io/aivora-docs/ | 2026-09-22 | Aivora, global | API host migration to `openapi.aivora.com` from 2026-03-20, auth headers, futures endpoints, margin product, sections 3 and 8 |
| S2 | Aivora Fee Rate page, and its data call `POST https://api.aivora.com/spot/api/membership/get_level_fee_config_list` with `{"type":"1"}` for spot and `{"type":"2"}` for futures | https://www.aivora.com/en-us/myRate | 2026-09-22 | Aivora, global | VIP tables, qualification text, token discount flag, sections 2, 4 and 5 |
| S3 | Aivora User Agreement | https://www.aivora.com/en-us/cms/agreement | 2026-09-22 | Aivora Ltd., Hong Kong law | operator name, prohibited regions, definition of American, section 1 |
| S4 | Aivora home page, futures restriction and margin strings, announcements | https://www.aivora.com/en-us | 2026-09-22 | Aivora, global | futures excluded regions, liquidation taker fee wording, TON delisting, sections 1 and 7 |
| S5 | Aivora Licenses page | https://www.aivora.com/en-us/licenses | 2026-09-22 | Aivora Ltd, United States FinCEN | MSB registration statement, section 1 |
| S6 | Futures help center: Funding Rate, Mark Price, Index Price, Insurance fund | https://futuresdoc.gitbook.io/help-center/perpetual/overview/funding-rate.md | 2026-09-22 | white-label platform, no exchange named | funding interval, formula, payer, insurance fund, sections 6 and 7 |
| S7 | CoinGecko API `exchanges/aivora-exchange`, `derivatives/exchanges/list`, `derivatives/exchanges` and `derivatives/exchanges/aivora-exchange-futures` | https://api.coingecko.com/api/v3/exchanges/aivora-exchange | 2026-09-23 UTC | CoinGecko | country, spot pairs and volume, futures id without data, sections 1 and 3 |
| S8 | CCXT master `ts/src` listing and README | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 UTC | CCXT | no Aivora class, section 8 |
| S9 | Aivora VIP page | https://www.aivora.com/en-us/cms/VIP | 2026-09-22 | Aivora, global | VIP application link, section 5 |
| S10 | Aivora web futures list, called with `POST` and body `{}` | https://api.aivora.com/futures/api/common/public_info_v2 | 2026-09-23 UTC | Aivora, global | funding interval, next settlement, help center link, sections 3 and 6 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/aivora/rest-probe.mjs) `catalog`, `anchor`, `errors`, `fees` | [`rest-probe.mjs`](../../../scripts/probes/venues/aivora/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | counts, CCXT check, error shapes, the fee tables again, sections 1 to 4, 6 and 8 |
| P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs) `book` and `deflate` | [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | socket access, section 1 |
