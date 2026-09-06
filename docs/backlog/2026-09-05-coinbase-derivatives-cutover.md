# Coinbase derivatives cutover on 2026-09-09

Status: Not started.
Recorded: 2026-09-05.
Indexed in [BACKLOG.md](../BACKLOG.md).

Coinbase International derivatives move to a Deribit powered gateway on 2026-09-09.
This is a merger rather than a withdrawal.
Coinbase International Exchange and Deribit combine into one platform, trading continues through the API, and Coinbase states that the existing CDP API key authenticates to the new gateway with no new credentials to create.
The account side therefore needs nothing from this project, which places no orders and only reads prices.
The feed in [`coinbase.ts`](../../server/src/venues/coinbase/coinbase.ts), shipped on 2026-09-05, reads those instruments through Coinbase Advanced.
It therefore has a known expiry date four days after it was written.

## Finding

Coinbase publishes the cutover as a hard switch with no parallel running window.
Open orders are cancelled, and positions settle and are recreated on the new platform.
Accounts were already provisioned on the combined platform on 2026-08-02.
The protocol moves from REST to JSON-RPC 2.0 over HTTP or WebSocket, and the venue gains 125 or more perpetual contracts, WebSocket order entry, and cancel on disconnect.
Perpetual product ids change from `{BASE}-PERP-INTX` to `{BASE}_USDC-PERPETUAL`, so `BTC-PERP-INTX` becomes `BTC_USDC-PERPETUAL`.
The identifier change is the only part of this that touches the observatory, because the observatory reads market data and never trades.
The same instrument is spelled three different ways across the three platforms today, which is why the design pins `rawMarketId` to CCXT discovery rather than to a literal.

What Coinbase does not publish is whether `wss://advanced-trade-ws.coinbase.com` keeps serving the perpetuals under the new ids or stops serving them entirely.
The overview says only that old endpoints stop serving international derivatives, and the technical migration guide does not name the Advanced Trade socket in its deprecation list.
Both readings are consistent with the published wording.

## Two outcomes

If the Advanced Trade socket keeps the perpetuals under renamed ids, nothing needs doing.
`rawMarketId` comes from `loadMarkets()` on every boot, so a pure rename flows through once CCXT catches up.
The risk in that branch is CCXT lag rather than Coinbase.
The acknowledgement diff in [`coinbase.ts`](../../server/src/venues/coinbase/coinbase.ts) is what makes that lag visible instead of silent.

If the Advanced Trade socket drops the perpetuals, the feed goes dead rather than wrong.
The silence watchdog terminates and reconnects forever with backoff, `markStale` zeroes the venue's slots, and its clusters stop producing opportunities.
That branch needs a second feed class against the replacement host.

## What the replacement host looks like

Probed live on 2026-09-05, four days before cutover, with no credentials.

The streaming host is `wss://streams.drb.coinbase.com/ws/api/v2`.
That hostname appears in no Coinbase document.
The migration guide calls it only "the public streams host", and the request and response host `wss://drb.coinbase.com/ws/api/v2` rejects `public/subscribe` with `-32601 method not in allowlist`.

The protocol is JSON-RPC 2.0.
Subscribing to `quote.BTC_USDC-PERPETUAL` returns best bid and best ask as JSON numbers rather than strings.

```text
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"quote.BTC_USDC-PERPETUAL","data":{"timestamp":1788645577021,"instrument_name":"BTC_USDC-PERPETUAL","best_ask_price":79912.3,"best_bid_price":79912.2,"best_ask_amount":0.0136,"best_bid_amount":0.0407}}}
```

Three details differ from every feed the observatory runs today.

1. The routing key is `params.data.instrument_name`.
2. Keepalive is application level.
   Send `public/set_heartbeat` once, then answer every incoming `{"method":"heartbeat","params":{"type":"test_request"}}` with a `public/test` frame, or the server drops the connection.
   Both are JSON, so the base class needs no change.
3. The subscribe result silently trims the accepted channel list.
   38 channels were requested and 32 were returned, so the result array must be diffed the same way the Advanced Trade acknowledgement already is.

## Why it was not built on 2026-09-05

`BTC_USDC-PERPETUAL` is not the Coinbase perpetual book today.
It is Deribit's own pre-existing USDC perpetual, with roughly 135 BTC of 24 hour volume against `BTC-PERP-INTX` at roughly 14,200 BTC.
The two books merge at cutover.

A feed written against it now could not be validated, because the market it reads is not the market it is meant to represent.
Letting it into opportunity discovery before cutover would compare the wrong venue's liquidity.

## What finishing this means

Re-probe both hosts on the morning of 2026-09-09 and take the branch the evidence supports.
Where the Advanced Trade socket survives, confirm CCXT reports the new ids and that the acknowledgement diff is quiet.
Where it does not, add the second feed class and switch the `coinbase` registration to it.
Either way, remove this entry once the observatory has streamed Coinbase perpetual quotes across the cutover.
