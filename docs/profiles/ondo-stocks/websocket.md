# Ondo Stocks WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:22, 03:26 and 03:28 UTC, from the development host near Seattle.

Ondo Stocks publishes no WebSocket.
Its streaming surface is gRPC at `grpc.gm.ondo.finance:443`, and every call on it needs an API key that Ondo issues after onboarding, S1 and S2.
The venue lists no perpetuals, so this profile covers the streaming surface of the spot product, per template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), see [`fees.md`](./fees.md) section 3.
Every probed value below was captured by [`stream-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/stream-probe.mjs), which sends no key.
Without a key the load balancer refused every gRPC call, including the one the schema says needs no authentication, so nothing below the refusal could be probed.

## 1. Endpoints

| surface | documented endpoint | probed |
|---|---|---|
| WebSocket | none documented | `wss://api.gm.ondo.finance/` and `/v1/ws` answered the upgrade with HTTP 403 `{"message":"Forbidden"}`, `x-amzn-errortype` `MissingAuthenticationTokenException` and `ForbiddenException`. `wss://grpc.gm.ondo.finance/` answered HTTP 464 from `awselb/2.0` |
| gRPC streaming | `grpc.gm.ondo.finance:443`, service `ondo.gm.backend.v1.BackendService`, S2 | HTTP/2 over TLS with ALPN `h2`, connected in 245, 219 and 229 ms. Every call answered HTTP 403 with an empty body, section 5 |
| REST | `https://api.gm.ondo.finance`, S3 | every path answered 403 without a key, see [`rest.md`](./rest.md) section 1 |

`grpc.gm.ondo.finance` is a CNAME of an AWS load balancer in `us-east-1`, `k8s-gmbacken-traefika-83782a153c-1276893679.us-east-1.elb.amazonaws.com`, which resolved to three addresses, see [`rest.md`](./rest.md) section 1.
HTTP 464 is the code an AWS Application Load Balancer returns when the request's protocol does not match the target group's, and S6 names an HTTP/1.1 request, or an HTTP/2 request that is not a POST, sent to a gRPC target group.
A plain HTTP/2 `GET /` on the gRPC host also answered 464 with an empty body, in a `curl` check at 03:22 UTC and in the probe at 03:28 UTC.

## 2. Channel matrix for public market data

The channels are gRPC server-streaming calls, from S2, S4 and S5.
None is public.

| call | request | payload | cadence | probed without a key |
|---|---|---|---|---|
| `StreamSoftQuoteDepth` | `symbols`, empty for every asset | per asset, `bids` and `asks` of `{price, quantity}` decimal strings, `session_type`, `error`, `timestamp` in ns | at most one flush per about 250 ms per stream, latest book per symbol only | HTTP 403 |
| `StreamPriceUpdates` | `symbols`, empty for every asset | `ticker`, `symbol`, `stock_price`, `token_price`, `timestamp` in ns | on each price update, batched | HTTP 403, with an empty list, `TSLAon` and `NOPE` |
| `StreamOHLC` | `symbols` | minute buckets updated per tick | per tick | HTTP 403 |
| `HealthCheck` | empty | `status` string | unary | HTTP 403, although the schema says "Does not require authentication", S4 |
| server reflection, `grpc.reflection.v1` and `v1alpha` | `list_services` | service names | unary per request | HTTP 403 |

No trades channel, no best bid and offer channel, and no mark, index or funding channel exist.
The depth stream is synthetic: S5 calls it "a synthetic, indicative market-depth view" derived from the soft-quote price ladder, with `asks` as the mint side and `bids` as the redeem side.
Each level's `quantity` is the incremental size at that level's marginal price, S5.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is for the gRPC surface, because no WebSocket exists.
The probed column is empty wherever the 403 stopped the probe.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one gRPC host for every asset, S2 | one host, every call refused with 403 |
| subscribe frame shape | one server-streaming call per stream type, with a `symbols` list, S4 | not reached |
| unknown symbol expectation | the stream ends with gRPC `NotFound`, reason `ASSET_NOT_FOUND`, and a malformed symbol with `InvalidArgument`, `INVALID_SYMBOL`, S5 | `NOPE` got the same HTTP 403 as a real symbol |
| chunk unit and budget | Not publicly specified. `ResourceExhausted`, `RATE_LIMITED`, when "per-account stream rate limits" are exceeded, S5 | not reached |
| keepalive mechanism | Not publicly specified | not reached |
| connection lifetime and maintenance notice | Not publicly specified | not reached |
| handshake and operation rate limits | per account, values Not publicly specified, S5 | not reached |
| public market data authentication | `x-api-key` metadata on every call, S2 | required: 403 on every call without it |
| message parse and routing | protobuf, routed on `symbol` inside each `updates` entry, S4 | not reached |
| subscribe acknowledgement shape | none documented, and the first message is the snapshot of each symbol that has a fresh book, S5 | not reached |
| symbol identifier format | Ondo symbol ending in `on`, such as `TSLAon`, with the stock ticker beside it, S4 | not reached |
| number representation | decimal strings in human units, up to 18 decimals, S4 and S5 | not reached |
| timestamp representation | `uint64` Unix nanoseconds, S4 | not reached |
| size unit | token quantity, S5 | not reached |
| sequence semantics | none: each depth entry is the whole ladder for its symbol, and a newer one supersedes an older one in the same 250 ms window, S5 | not reached |
| idle repeat behaviour | "Depth is recomputed and pushed as the underlying ladder changes", S5 | not reached |

## 4. The book channel in detail

`StreamSoftQuoteDepth` is the only book-shaped stream, and everything here is documented, not probed.

| item | documented | source |
|---|---|---|
| snapshot on subscribe | "On connect, you receive the current depth for each subscribed symbol (when a fresh book is available)" | S5 |
| delta semantics | none, each `SoftQuoteDepth` entry is a full replacement ladder for one symbol | S5 |
| sequence and gap rule | `SoftQuoteDepth` has fields `symbol`, `ticker`, `session_type`, `error`, `timestamp`, `bids` and `asks` and no sequence, so there is nothing to gap-check | S4 |
| levels per side | Not publicly specified, and the S5 example shows two | S5 |
| checksum | none | S4 |
| level order | `asks` best, lowest, first, and `bids` best, highest, first | S5 |
| size unit | token quantity at the marginal price, in human units | S5 |
| one-sided and empty books | an asset that is paused, closed or stale carries `error` with empty `bids` and `asks`, and the stream stays open | S5 |
| idle repeats | not documented | |
| unknown or closed symbol | unknown ends the stream with `NotFound`, and a closed market arrives inline as `"error": "market closed"` | S5 |

The ladder is the platform's own indicative quote, not resting orders of other users.
A binding price needs a separate attestation call, see [`rest.md`](./rest.md) section 5.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | not reached |
| silence the server tolerates | Not publicly specified | not reached |
| forced disconnect | Not publicly specified | not reached |
| maintenance notice | status page `status.ondo.finance`, S7, and the REST `/v1/status/market` and `/v1/status/assets` calls, S3 | the status page answered 200 and the REST status calls answered 403, see [`rest.md`](./rest.md) section 1 |
| compression | Not publicly specified | requests went uncompressed, flag byte 0, and nothing came back to inspect |
| handshake | TLS and HTTP/2 | ALPN `h2`, connected in 245 ms at 03:22 UTC, 219 ms at 03:26 UTC and 229 ms at 03:28 UTC |
| authentication | `x-api-key` metadata, gRPC `Unauthenticated` with `MISSING_API_KEY` when absent, S5 | HTTP 403 from `awselb/2.0` with an empty body, no `grpc-status` and no trailers, on all nine calls in all three runs, 69 to 89 ms each at 03:22 UTC and 65 to 80 ms at 03:26 and 03:28 UTC |
| subscription limits | per account, values Not publicly specified, S5 | not reached |

The documented refusal and the wire disagree.
S5 says a missing key ends the stream with gRPC status `Unauthenticated`, but the reply was HTTP 403 from the load balancer, `awselb/2.0`, with no gRPC status at all.
The same 403 came back for `HealthCheck`, which S4 says needs no key, and for a method that does not exist.
AWS documents a 403 generated by an Application Load Balancer as a request blocked by an AWS WAF web ACL, S6.
So the refusal is most likely a WAF rule in front of the service.
Whether that rule checks for the key header, the caller's address or the caller's country is Not verified, since the probe sends no key and uses no other route.

## 6. Captured frames

From the probe run at 03:22 UTC, and the reruns at 03:26 and 03:28 UTC returned the same statuses.
Each line is the probe's JSON summary of one call.

gRPC call without a key.

```json
{"tag":"grpc_call","path":"/ondo.gm.backend.v1.BackendService/StreamPriceUpdates","headers":{":status":403,"server":"awselb/2.0","date":"Wed, 23 Sep 2026 03:22:28 GMT"},"trailers":null,"messages":[],"bytes":0,"messageCount":0,"ms":82,"end":"end"}
```

The unauthenticated health check.

```json
{"tag":"grpc_call","path":"/ondo.gm.backend.v1.BackendService/HealthCheck","headers":{":status":403,"server":"awselb/2.0","date":"Wed, 23 Sep 2026 03:22:28 GMT"},"trailers":null,"messages":[],"bytes":0,"messageCount":0,"ms":89,"end":"end"}
```

WebSocket upgrades.

```json
{"tag":"ws_upgrade","url":"wss://api.gm.ondo.finance/v1/ws","ms":295,"opened":false,"status":403,"errorType":"ForbiddenException","body":"{\"message\":\"Forbidden\"}"}
```

```json
{"tag":"ws_upgrade","url":"wss://grpc.gm.ondo.finance/","ms":278,"opened":false,"status":464,"body":""}
```

The documented depth message, from S5, trimmed, for comparison.

```json
{"updates": [{"symbol": "AAPLon", "ticker": "AAPL", "sessionType": "regular", "timestamp": "1773350214476688119", "bids": [{"price": "256.700000000000000000", "quantity": "100.000000000000000000"}], "asks": [{"price": "256.900000000000000000", "quantity": "100.000000000000000000"}]}, {"symbol": "GOOGLon", "ticker": "GOOGL", "sessionType": "regular", "error": "market closed", "timestamp": "1773350214478735649", "bids": [], "asks": []}]}
```

## 7. Private channels

None are streamed.
Minting and redeeming run through the REST attestation calls and the issuer's smart contracts on Ethereum, BNB Chain and Solana, S1 and S3.

## 8. Recommended feed shape

None.
The venue has no WebSocket, its gRPC stream needs a key issued after KYC onboarding that the operator of this host cannot pass, see [`fees.md`](./fees.md) section 1, and its only depth is a synthetic quote ladder with no sequence.
A feed for it would not be a `VenueFeed` subclass, since [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) opens WebSocket sockets at line 81.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | API Overview | https://docs.ondo.finance/api-reference/overview.md | 2026-09-22 | Ondo, global | REST and gRPC surfaces, access by onboarding, sections 1 and 7 |
| S2 | Price Streaming | https://docs.ondo.finance/api-reference/price-streaming.md | 2026-09-22 | Ondo, global | gRPC host, `x-api-key` metadata, price stream fields, sections 1 to 3 |
| S3 | OpenAPI spec | https://docs.ondo.finance/openapi.json | 2026-09-22 | Ondo, global | REST host and `apiKey` on every path, sections 1 and 7 |
| S4 | Protobuf Schema and Code Generation, `grpcapi.proto` | https://docs.ondo.finance/api-reference/protobuf-schema.md | 2026-09-22 | Ondo, global | service and message definitions, `HealthCheck` needs no key, sections 2 to 4 |
| S5 | Soft Quote Depth Streaming | https://docs.ondo.finance/api-reference/soft-quote-depth-streaming.md | 2026-09-22 | Ondo, global | depth semantics, 250 ms batching, snapshot on connect, errors, sections 2 to 5 |
| S6 | AWS Application Load Balancer troubleshooting, HTTP 403 and HTTP 464 | https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-troubleshooting.html | 2026-09-22 | AWS | 403 is a WAF block, 464 is a protocol mismatch such as HTTP/1.1 or a non-POST HTTP/2 request to a gRPC target group, sections 1 and 5 |
| S7 | Market Hours and Trading Availability | https://docs.ondo.finance/ondo-stocks/market-hours-and-trading-availability.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | status page, section 5 |
| P1 | [`stream-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/stream-probe.mjs) at 03:22, 03:26 and 03:28 UTC | [`stream-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/stream-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 3, 5 and 6 |
