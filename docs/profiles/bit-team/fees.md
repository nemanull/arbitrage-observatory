# BIT.TEAM Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:00 to 04:25 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

BIT.TEAM lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 12 trading pairs out of 41 listed, quoted in RUB and USDT, see [`rest.md`](./rest.md) section 2.
The VIP 0 spot taker is 0.2 %, which is 2,000 ppm, on 10 of the 12 trading pairs, and 0.5 %, which is 5,000 ppm, on `del_rub` and `del_usdt`.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/bit-team/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | CoinMarketCap's record says BIT.TEAM was launched in 2018 with headquarters in London, and CCXT sets `countries` to `UK` | Published | S4, S3 line 22 |
| products | spot, a P2P service and an NFT marketplace, by the same record | Published | S4 |
| who may trade spot | a registered account, with an API key pair generated in the profile for API orders | Account-gated | S1 description |
| restricted locations | Not publicly specified in any page or document read | Not publicly specified | |
| fee page from this host | there is no fee page on `bit.team`, and `https://bit.team/fees` answered HTTP 404 with the site's HTML. The fee page CoinMarketCap names, `https://p2p.bit.team/pricing`, does not resolve in DNS. | Probed | `rest-probe.py errors`, `fees-probe.py coverage` |
| public API from this host | every public call reached the API through DDoS-Guard, with no challenge page, geoblock or refusal | Probed | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, 10 trading pairs | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | Published | `makerFee` and `takerFee` 200 in `/trade/api/ccxt/pairs`, `fees-probe.py pairs` |
| spot, `del_rub` and `del_usdt` | 0.5 %, 5,000 ppm | 0.5 %, 5,000 ppm | Published | `makerFee` and `takerFee` 500, same call |

The fee is a per pair field of the catalog, not a schedule page.
The web app reads it as `new BigNumber(e.takerFee).shiftedBy(-5)`, so 200 is 0.002, S2.
Maker and taker are equal on every pair.
CoinMarketCap's description says "SPOT trading ... with the fee of 0.2%", which matches the 10 pairs at 200, S4.
CoinMarketCap's own `makerFee` and `takerFee` fields are 0.0, its placeholder for an unknown fee, S4.
A BIT.TEAM spot taker at 2,000 ppm costs four times Gate's 500 ppm perpetual taker, see [`../gate/fees.md`](../gate/fees.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | no futures, perpetual, funding, mark or index path in the API document, and `/trade/api/futures/pairs`, `/trade/api/perpetual/pairs`, `/trade/api/contracts`, `/trade/api/funding`, `/trade/api/mark-price`, `/trade/api/index`, `/futures` and `/trade/futures` each answered 404, [`rest.md`](./rest.md) section 3 |
| coin-margined perpetuals | no | same |
| dated futures | no | same, and CCXT sets `swap`, `future` and `margin` false, S3 lines 29 to 32 |
| options | no | same, S3 line 33 |
| spot order book | yes, 12 pairs with `status` 1, out of 41 listed | [`rest.md`](./rest.md) section 2 |
| P2P exchange | yes, card to card, not detailed | S2, S4 |
| OTC, NFT marketplace, voting | yes, named on the home page, not detailed | S2 |
| deposits and withdrawals | yes, per currency `withdrawCommissionFixed` in `/trade/api/currencies`, not detailed | S3 lines 670 to 691 |

Three outside checks agree that BIT.TEAM has no perpetuals.
CoinMarketCap's exchange record shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 against a spot volume of about 268 thousand USD, and its pair lists hold 10 spot pairs, 0 perpetual pairs and 0 futures pairs, S4.
CoinGecko's derivatives venue list holds 216 venues and none named BIT.TEAM, S5.

## 4. Spot tiers

There are no volume tiers.
No page, document or catalog field names a volume band, and CCXT sets `tierBased` false, S3 line 221.
The fee varies by pair instead.

| pair `status` | `makerFee` and `takerFee` | fraction | ppm | pairs |
|---|---|---|---|---|
| 1, trading | 200 | 0.002 | 2,000 | `bnb_rub`, `btc_rub`, `btc_usdt`, `btt_usdt`, `eth_rub`, `eth_usdt`, `ton_rub`, `trx_rub`, `trx_usdt`, `usdt_rub` |
| 1, trading | 500 | 0.005 | 5,000 | `del_rub`, `del_usdt` |
| 0 or 2, not trading | 200 | 0.002 | 2,000 | 26 pairs |
| 2, not trading | 20 | 0.0002 | 200 | `locker_usdt`, `rev3l_usdt` |
| 2, not trading | 5000 | 0.05 | 50,000 | `trx_pzm` |

The web app keeps only pairs with `status` 1, S2, so the last three rows are not tradable today.
An account's own rate is not on a public call.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | none | Not offered | section 4 |
| BTT token | fees paid in BTT, with a discount by BTT balance. The levels are on `/trade/api/discounts`, which answered HTTP 401 `{"ok":false,"code":401010,"message":"p2p_access_token and p2p_refresh_token are required in cookies"}` without a login. CoinMarketCap's description says "up to 50% discount on fees with BTT token". | Account-gated | `fees-probe.py private`, S1, S4 |
| cashback | the home page says "Get up to 70% of your trading fees back", with no terms on any page read | Not publicly specified | S2 |
| referral | "Invite friends and earn 25% of their exchange fees", which pays the referrer and does not lower the taker | Published | S2 |
| VIP clients | "Special conditions and support for large clients", with no numbers | Negotiated | S2 |
| zero fee promotions | the site title says "Buy bitcoin without commission", and no pair in the catalog has a zero fee | Not publicly specified | S2, section 4 |

## 6. Funding as a cost

Not offered.
BIT.TEAM lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged product, so there is no liquidation or settlement charge.
No delisting charge is published.

## 8. CCXT

CCXT 4.5.68 has a `bitteam` class at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/bitteam.js`, S3.

- `has` sets `spot` true and `margin`, `swap`, `future` and `option` false, lines 29 to 33.
- `pro` is false, line 26, `has.ws` is false, line 155, and there is no `js/src/pro/bitteam.js`, so CCXT Pro has no BIT.TEAM socket class.
- `rateLimit` is 1 with the comment "the exchange has no rate limit", line 24.
- `fees.trading` sets `tierBased` false, `percentage` true, `taker` 0.002 and `maker` 0.002, lines 218 to 225.
- `fetchMarkets` reads `/trade/api/ccxt/pairs`, line 368, and `parseMarket` returns its market through `safeMarketStructure`, line 477.
  `parseMarket` does not read `takerFee` or `makerFee`.
- `safeMarketStructure` in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/base/Exchange.js` sets `taker` and `maker` to undefined, lines 3653 and 3654.
- `setMarkets` in the same file merges `fees.trading` first and the market last, lines 3732 to 3735, and `deepExtend` in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/base/functions/generic.js` copies an undefined value over a defined one, lines 165 to 173.

So `market.taker` is undefined on every BIT.TEAM market, and only the class constant says 0.002.
`fees-probe.py ccxt` loaded the 41 markets through the Python class of the same release and read `taker` None and `maker` None on all 41, with `info.takerFee` 200 on `BTC/USDT`.
The class constant matches the live fee of 10 trading pairs and understates `del_rub` and `del_usdt` by 3,000 ppm.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and BIT.TEAM has no perpetual.
It cannot enter the registry as a perpetual leg.
If a later design adds spot legs, `takerPpm` would be read per pair from `takerFee` times 10, which is 2,000 on `btc_usdt`.
`ccxtTakerPpm` would be 2,000 from line 223 of the CCXT class, with the caveat that CCXT's `market.taker` is undefined.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://bit.team/trade/api/documentation.json`, the Swagger 2.0 document behind `https://bit.team/trade/api/documentation`, version 2.0.6 | public and private paths, Basic authentication with a key pair, the discount paths, no rate limit and no socket section |
| S2 | the Nuxt bundle `https://bit.team/_nuxt/9126db0.js` of the home page `https://bit.team/` | the `shiftedBy(-5)` fee scale, the `status` 1 filter, the BTT, cashback, referral and VIP lines, the socket URLs and the nes client |
| S3 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/bitteam.js` | the CCXT class, lines cited in section 8 |
| S4 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bit-team` and `.../exchange/market-pairs/latest?slug=bit-team` with `category` `spot`, `perpetual` and `futures` | id 1679, fee fields 0.0, the description with the 0.2 % fee and the BTT discount, spot volume, 10 spot pairs, 0 perpetual and 0 futures pairs, the fee URL |
| S5 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` | 216 derivatives venues, no BIT.TEAM |
