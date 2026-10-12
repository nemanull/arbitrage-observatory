# Bitcoin.me REST Profile

**Status:** Done.
Bitcoin.me lists no perpetuals, and its order book exchange has not traded since 2026-02-11, so the venue is profiled on its spot market as a defunct one.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:53 to 05:06 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public REST surface of Bitcoin.me, formerly Klever Exchange.
Three APIs were checked.
The documented public API at `https://api.exchange.bitcoin.me`, S3 to S6, answers 503 on every market call.
The manager API at `https://manager.exchange.klever.io`, which the `cex.bitcoin.me` web app calls, still serves the legacy catalog and candles behind a Cloudflare rule.
The DEX API at `https://api.bitcoin.me`, S9, serves the KleverChain AMM pools.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/bitcoin-me/rest-probe.py), P2, unless another probe is named.
Source ids are those of the ledger in section 9 and of [`fees.md`](./fees.md) section 10.

## 1. Host and latency from this machine

| host | role | resolved address | result |
|---|---|---|---|
| `api.exchange.bitcoin.me` | documented public API, S3 | 104.18.8.64 and 104.18.9.64, Cloudflare | 503 "Service Temporarily Unavailable" from nginx behind Cloudflare on all four market calls in both runs, 123 to 375 ms |
| `manager.exchange.klever.io` | the web app's REST base | 104.18.12.193 and 104.18.13.193, Cloudflare | 200 with the right headers, see below, catalog in 270 to 906 ms over six calls in two runs |
| `events.exchange.klever.io` | the web app's gRPC-web stream host | 104.18.12.193 and 104.18.13.193, Cloudflare | 503 on every method, see [`websocket.md`](./websocket.md) |
| `api.bitcoin.me` | DEX API, S9 | 104.18.8.64 and 104.18.9.64, Cloudflare | `/health` 200 `{"status":"OK"}` in 113 to 177 ms, `/pools` 200 in 105 to 131 ms |

The manager API sits behind a Cloudflare rule that looks at the User-Agent and the Referer, P2.
`GET /v1/networks` gave these answers from the Canadian exit:

| request headers | status | body |
|---|---|---|
| Python-urllib User-Agent, no Referer | 403 | Cloudflare "Attention Required!", "Sorry, you have been blocked" |
| Chrome User-Agent, no Referer | 403 | the same block page |
| Chrome User-Agent and `Origin: https://cex.bitcoin.me` | 403 | the same block page |
| curl User-Agent and `Referer: https://cex.bitcoin.me/` | 200 | the JSON network list |
| Python-urllib User-Agent and the same Referer | 403 | `error code: 1010`, Cloudflare's banned browser signature |

So the API refuses a request that does not look like it came from the `cex.bitcoin.me` page.
The block is not regional, since the same exit gets 200 with the web app's own headers.
Every manager figure below was read with the curl User-Agent and the Referer the web app sends, which is a fact a feed would depend on.

## 2. Catalog

### Documented call

`GET /v1/market/symbols` on `https://api.exchange.bitcoin.me/` is documented to return `symbol`, `name`, `baseCurrency`, `quoteCurrency` and `enableTrading`, with symbols spelled `KLV-USDT`, S4.
It answered 503 on both runs, P2.

### The web app's catalog

`GET https://manager.exchange.klever.io/v1/keypairs?Currency=USD` returns `{"Keypairs": [...]}`, 20,553 and 20,574 bytes in the two runs, P2.

| item | value |
|---|---|
| pairs | 28 |
| by quote | USDT 19, KLV 6, BTC 2, KFLA 1 |
| perpetuals | 0, the catalog has no contract type field at all |
| fields | `ID`, `Name`, `BaseID`, `QuoteID`, `TradingFee`, `Decimals`, `MaxMarketPercentage`, `MinAmount`, `BasePrecision`, `IsBeta`, `Featured`, `Stats`, `Base`, `Quote`, `CreatedAt`, `UpdatedAt` |
| status field | none, only `IsBeta`, which is set on 5 pairs: RDXSWP-KLV-USDT, IGG-USDT, RDXSWP-DVK-USDT, RDXSWP-KFI-USDT and KVAS-KFLA |
| `Stats` | empty on all 28 |
| newest `UpdatedAt` | 2026-02-11T13:15:38Z |
| symbol spelling | `KLV-USDT`, the same as the documented API, S4 |

The catalog has no BTC-USDT or ETH-USDT pair, so even a live CEX would share almost no pair with the engine's perpetual venues.

### Frozen state

`GET /v1/tickers` takes `KeypairID`, `TimeRange`, `Limit`, `TimeInterval.Begin` and `TimeInterval.Ends`, and returns the newest `Limit` candles inside the window, P2.
For each of the 28 pairs the probe read up to 500 candles between 2025-10-01 and the probe time.

| result | pairs |
|---|---|
| newest candle on 2026-02-11 | 10, the last three being VLX-USDT at 13:10 UTC, KID-USDT at 13:13 and MOTO-USDT at 13:18 |
| newest candle from 2025-11-13 to 2026-02-10 | 14 |
| no candle since 2025-10-01 | 4: IGG-USDT, RDXSWP-DVK-USDT, RDXSWP-KFI-USDT and KVAS-KFLA |

No pair traded after 2026-02-11 13:18 UTC, which matches the newest `UpdatedAt` of the catalog.
`GET /v1/keypairs-card` with `TickersLimit=24` and `TimeRange=HOUR_1` returned all 28 pairs with no ticker rows, P2.
The home page now calls this market "CEX (legacy)", S7, and CoinMarketCap's six pairs for the venue all link to the DEX at `bitcoin.me/en/trade/`, S11.

### CCXT mapping

There is no CCXT class, see [`fees.md`](./fees.md) section 8, so there is no `market.id`, `contractSize`, `linear` or `active` to compare.

### The DEX

`GET https://api.bitcoin.me/pools` returned 48 AMM pools, every one quoted in KLV, with about USD 161,000 of pool value in total and USD 716 to 962 of 24 h volume in the two runs, the largest being KFI-KLV, P2.
A pool reply carries prices, staked amounts, volumes and APRs, and no order book, S9.
The DEX is outside the engine's shape and is not profiled further.

## 3. Anchor

Bitcoin.me publishes no index, mark or funding.
There is no perpetual, S1, and neither the documented API, S3 to S6, nor the manager API calls in the bundle, nor the DEX API, S9, has a mark, index or funding call.
The nearest reference prices are the `Price` field on each token in `v1/tokens?Currency=USD` and in the `Base` and `Quote` objects of the catalog, which are USD conversion rates for display, P2.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, for the reasons in section 3.

## 5. REST book snapshot

The documented call is `GET /v1/market/orderbook?symbol=KLV-USDT&limit=10` on `https://api.exchange.bitcoin.me/`, S5.
It is documented to return `bids` and `asks` as `[price, size]` string pairs with asks ascending and bids descending, and a `time` in seconds.
It answered 503 on both runs, P2.
The manager API has no book call in the bundle, because the web app takes its book from the `SubscribeOrderGroups` gRPC-web stream, which also answers 503, see [`websocket.md`](./websocket.md) section 4.
So no book can be read from this host.

## 6. Rate limits and error shapes

No rate limit is published in S3 to S6, and the probe met none in 44 requests per run, sent at most two per second.
The limits it did meet are the Cloudflare rule of section 1 and the 503 of the origin.

The manager API returns gRPC gateway errors, P2.
`GET /v1/tickers` without a `KeypairID` returned:

```json
{
 "code": 3,
 "message": "invalid TickersRequest.KeypairID: value must be greater than 0",
 "details": [{"@type": "type.googleapis.com/google.rpc.DebugInfo", "stackEntries": [], "detail": "internal"}]
}
```

with HTTP 400.
`code` 3 is gRPC's `INVALID_ARGUMENT`.

## 7. Server time

No time call is documented, S3.
The `Date` header on the catalog reply was 1.4 s and 1.6 s behind the host clock in the two runs, P2, at the header's one second resolution.

## 8. Recommended poller shape

None.
There is no anchor to poll, and the order book market has been frozen since 2026-02-11.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S3 | Bitcoin.me Documentation, Introduction | https://docs.bitcoin.me/docs/intro/ | 2026-10-09 | Bitcoin.me | API URL, public and private sections |
| S4 | Market, Symbol | https://docs.bitcoin.me/docs/Market/symbols/ | 2026-10-09 | Bitcoin.me | `GET /v1/market/symbols` and its fields |
| S5 | Market, Order book | https://docs.bitcoin.me/docs/Market/orderbook/ | 2026-10-09 | Bitcoin.me | `GET /v1/market/orderbook`, level order |
| S6 | Market, Tickers | https://docs.bitcoin.me/docs/Market/tickers/ | 2026-10-09 | Bitcoin.me | `GET /v1/market/tickers` |
| S7 | Bitcoin.me DeFi home page | https://bitcoin.me/ | 2026-10-09 | Bitcoin.me | "CEX (legacy)" link |
| S9 | Bitcoin.me DeFi API reference | https://docs.defi.bitcoin.me/api/ | 2026-10-09 | Bitcoin.me | DEX API host and calls |
| S11 | CoinMarketCap exchange page | https://coinmarketcap.com/exchanges/klever-exchange/ | 2026-10-09 | CoinMarketCap | pairs link to the DEX |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/bitcoin-me/rest-probe.py) | local | 2026-10-09 | probe | every probed figure here |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/bitcoin-me/ws-probe.py) | local | 2026-10-09 | probe | stream host answers |

S1 is in [`fees.md`](./fees.md) section 10.
