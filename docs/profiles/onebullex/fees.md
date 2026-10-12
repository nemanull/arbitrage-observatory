# OneBullEx Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, which was 2026-10-10 from about 02:20 to 03:10 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

This profile covers the USDT-margined perpetual futures of OneBullEx, the only perpetual family the venue lists.
OneBullEx publishes an Open API for futures at `https://futures-openapi.onebullex.com`, S1, and its catalog call carries a maker and a taker rate on every contract, P1.
The help center's fee articles give the same two numbers, S2 and S3.

## 1. Scope and freshness

- The operator is One More Issuer Limited, named in the Terms of Use, last updated 2026-09-18, S4, and in the User Agreement, last updated 2026-09-28, S5.
- The User Agreement is governed by the laws of the British Virgin Islands, S5.
- The User Agreement's Restricted Jurisdictions include the United States and its territories, Mainland China, Hong Kong, Macao, Russia, the United Arab Emirates and Egypt, among others, S5.
  The Terms of Use name "the United States, North Korea, etc." as restricted, S4.
- Canada is not named in either document, S4 and S5.
  So a Canadian resident does not appear to be excluded, but that was not checked against an account.
- The help center says a login from a geo-blocked region shows "login from restricted location", S6, and names no list.
- Every public call in this survey answered from the Canadian exit with HTTP 200 and no geoblock, P1, P2 and P3.
- The perpetual list includes 25 stock, index and metal contracts, such as `nvda_usdt`, `spy_usdt`, `xau_usdt` and `anthropic_usdt`, P1.
  The help center calls these synthetic derivatives settled in USDT, S7.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.04 %, 400 ppm | 0.06 %, 600 ppm | S2, S3, and `makerFee` and `takerFee` on all 154 contracts, P1 |

No VIP tier table for futures is published.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 154 contracts | `contractType` PERPETUAL and `underlyingType` U_BASED on all 154 rows of `GET /v2/public/symbol/list`, P1 |
| coin-margined perpetuals | no | none of the 154 rows is coin-margined, although the doc lists coin-margined as an `underlyingType` value, S1 and P1 |
| USDC-M perpetuals | no | every row has `quoteCoin` usdt, P1 |
| dated futures | no | no row has a delivery `contractType`, P1 |
| options | Not verified, none found | no API section and no help center article describes one |
| spot | yes, not detailed | the site title reads "Spot & Futures Trading Platform", and the website config names a spot API host `bullapiprod.onebullex.com`, S8 |
| stock, index and metal perpetuals | yes, 25 of the 154 | plate 8 in the catalog's `plateList`, P1, and S7 |

## 4. Perpetual tiers

None are published.
The futures fee article lists one maker rate of 0.04 % and one taker rate of 0.06 %, for opening and for closing alike, S2.
The calculation article repeats "(Maker rate: 0.04%, Taker rate: 0.06%)", S3.
The help center search for `VIP` returned two articles, a spot fee article and a futures trading test guide, and no futures tier table, S9.
The wire agrees.
All 154 contracts carry `makerFee` 0.0004 and `takerFee` 0.0006, P1.

## 5. Discounts that change the perpetual taker

- The Zero-Fee Frenzy, from 2025-12-04, waives spot fees and "only applies to ETH & BTC", S10.
  It does not apply to perpetuals.
- Futures bonus articles exist, "OneBullEx Futures Bonus Rules", S9 results, and describe a trading bonus, not a rate change.
  Their bodies were not read in full.
- No token holding discount, referral rate cut or market maker program for futures was found in the help center, S9.

## 6. Funding as a cost

- The help center says funding is "collected once every 8 hours", at 00:00, 08:00 and 16:00 UTC+8, S11, which is 16:00, 00:00 and 08:00 UTC.
- The wire disagrees for about half the list.
  A sweep of all 154 contracts found 76 due at 08:00 UTC, 74 due at 04:00 UTC and 1 due at 03:00 UTC, P2, see [`rest.md`](./rest.md) section 4.
  The history call reports the interval in seconds as `collectionInterval`, and it gave 28800 for `btc_usdt`, 14400 for `hype_usdt` and 3600 for `kaia_usdt`, P2.
  So the interval is per contract, at 8, 4 or 1 hours.
- Who pays: "When the funding rate is positive, long position holders need to pay the funding fee to short position holders", and the reverse when negative, S11.
- The platform does not take a share, since S2 says the fee is "Paid between long and short positions" and that the "platform does not charge".
- Fee: "Funding Fee = Position Value × Funding Rate", S2.
- No funding formula, cap or floor is published, S1, S2 and S11.
  The last sweep's rates ranged from -0.0995 % to +0.0997 % per interval, P2.
- The settlement instant itself was not captured.
  Settled rates come from `GET /v2/public/q/funding-rate-record`, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

- A forced liquidation charges a liquidation fee, and "the funds are credited to the insurance fund account", S2.
  The article gives no rate.
- The catalog's `liquidationFee` is 0.0005 on 153 contracts and 0.0002 on 1, P1.
- No settlement or delisting charge is published.
  Delisted contracts stay in the bulk ticker replies with frozen prices, see [`rest.md`](./rest.md) section 2.

## 8. CCXT

CCXT 4.5.68 has no OneBullEx class.
The probe listed the 104 class files in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` and found only `bullish` and `onetrading` near the name, both other venues, P1.
The current CCXT master, listed through `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` on 2026-10-09, has 103 TypeScript files and none for OneBullEx, only `bullish.ts` and `onetrading.ts` near the name.
So there is no `market.taker` to report.

## 9. Recommended registry values

`takerPpm` 600, from the catalog's `takerFee` of 0.0006 on every contract, P1, which matches S2 and S3.
`ccxtTakerPpm` stays unset, because no CCXT class exists.
The venue is blocked as a leg, for the reasons in [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8, so these values are for a later adapter.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | OneBullEx Open API Documentation, version 2.1.1 dated 2026-04-20, `https://doc.onebullex.com/`, read through its source `https://doc.onebullex.com/onebullex-openapi-en-v2.md` | 2026-10-09 |
| S2 | "Futures Fees", `https://support.onebullex.com/hc/en-us/articles/5246219701150-Futures-Fees`, updated 2026-07-16, read through the Zendesk API `https://onebullex.zendesk.com/api/v2/help_center/en-us/articles/5246219701150.json` | 2026-10-09 |
| S3 | "How to calculate the contract trading fee?", article 5033321049502, updated 2026-07-03 | 2026-10-09 |
| S4 | Terms of Use, `https://www.onebullex.com/terms-of-use`, last updated 2026-09-18 | 2026-10-09 |
| S5 | User Agreement, `https://www.onebullex.com/user-agreement`, last updated 2026-09-28 | 2026-10-09 |
| S6 | "My account says 'login from restricted location' - what does that mean?", article 5032598986526, updated 2026-03-27 | 2026-10-09 |
| S7 | "[OneBullEx Tradfi Future Launch]: ANTHROPIC Stock Perpetual Future Goes Live on 8.29!", article 5616876972446, updated 2026-09-07 | 2026-10-09 |
| S8 | Website `https://www.onebullex.com/` and its bundle `_next/static/chunks/8516-3717ebce12deb4d6.js`, which holds the host config | 2026-10-09 |
| S9 | Help center search, `https://onebullex.zendesk.com/api/v2/help_center/articles/search.json?query=<q>&locale=en-us`, queries `fee`, `VIP`, `restricted`, `terms of use`, `mark price`, `index price` and `API` | 2026-10-09 |
| S10 | "Zero-Fee Frenzy: Trade Freely and Maximize Every Opportunity on OneBullEx", article 5070006967070, updated 2026-03-12 | 2026-10-09 |
| S11 | "What is the funding rate and how does it affect me?", article 5033321247902, updated 2026-07-16 | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/onebullex/rest-probe.py) | 2026-10-09 |
| P2 | [`anchor-probe.py`](../../../scripts/probes/venues/onebullex/anchor-probe.py) | 2026-10-09 |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/onebullex/ws-probe.py) | 2026-10-09 |
