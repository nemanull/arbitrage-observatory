# XXKK WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:40 to 04:06 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public market data sockets behind XXKK's perpetual futures, USDT-M and USDC-M.
XXKK publishes no WebSocket API.
Its developer page lists "WebSocket API" as "Coming Soon" and says "Public API access is not available yet", S1.
Everything below was taken from the futures web page's own script, S2, and checked on the wire by [`ws-probe.py`](../../../scripts/probes/venues/xxkk/ws-probe.py).
Socket time across exploration, the probe runs and the second pass was about eight and a half minutes.

## 1. Endpoints

| socket | URL | role |
|---|---|---|
| quote socket | `wss://q.xkqts.com/wsquote`, with `wss://q.bmyakh.com/wsquote` as the fallback | book deltas, trades and a per-symbol ticker for perpetuals |
| stream socket | `wss://www.xxkk.com/api/stream` | a bulk mark, index and funding push for every perpetual, plus private channels after a login |

The quote hosts are not fixed in the script.
They come from the website's symbol call `GET https://www.xxkk.com/api/public/symbol/list`, whose `swap_quote_domain` was `["wss://q.xkqts.com/","wss://q.bmyakh.com/"]` and whose `spot_quote_domain` was `["wss://q.bmyakh.com/","wss://q.xkqts.com/","wss://qt.tke4ee.com/"]`.
The web client appends `/wsquote` and rotates to the next host after each close, S2.
One quote socket carries both USDT-M and USDC-M symbols.
Both hosts sit behind Cloudflare, and the handshake answered 101 with `permessage-deflate;client_max_window_bits=15` in the reply.

## 2. Channel matrix for public market data

Quote socket frames are JSON objects `{"cmid": "<id>", "data": "<string>"}`, and `data` is itself a JSON string or a comma list.

| cmid | what | sent by | probed |
|---|---|---|---|
| `3000` | heartbeat | client `{"cmid":"3000"}` | server answers `{"data":"1","cmid":"3000"}` 4 frames arrived in 20 s after a single client heartbeat |
| `3001` | market list | client `{"cmid":"3001","data":"24"}` | not probed on the socket. The web client reads the same list over HTTP, `GET https://q.xkqts.com/market?preHour=24`, 59,574 bytes, see [`rest.md`](./rest.md) section 3 |
| `4001` | per-symbol subscription | client `{"cmid":"4001","symbols":"BTC-USDT","r":1,"data":"24"}` | turns on the ticker `4001`, trades `6001` and book `7001` for that symbol together |
| `6001` | trades | server | `"1,82556.0,58.4,1791604679467,BTC-USDT"`: side, price, amount, ms time, symbol |
| `7001` | book deltas | server | section 4 |
| `8001` | candles | client | not probed |
| stream `flagprice_list` | mark, index and funding for every perpetual | client `{"method":"subscribe","params":[{"channel":"flagprice_list"}]}` on the stream socket | 140 rows every 2.0 to 2.5 s, see section 4 of [`rest.md`](./rest.md) |

There is no separate best bid and ask channel and no book depth or speed choice.
The ticker `4001` repeats every 0.5 s even when nothing changed, with 78 to 80 frames in 20 s for one symbol.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
XXKK documents none of them, so the documented column says so once per row.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none published | one quote URL for USDT-M and USDC-M, host list from the symbol call, section 1 |
| subscribe frame shape | none published | `{"cmid":"4001","symbols":"BTC-USDT","r":1,"data":"24"}`, one symbol per frame, section 5 |
| unknown symbol expectation | none published | `NOPE-USDT` got no frame at all in 6 s, and the socket stayed open |
| chunk unit and budget | none published | a frame naming three symbols, or a third symbol on one socket, made the server close the socket, section 5 |
| keepalive mechanism | none published. The web client sends `{"cmid":"3000"}` and closes itself if no reply comes within 15 s, S2 | the server answers `{"data":"1","cmid":"3000"}` |
| connection lifetime and maintenance notice | none published | a one-symbol socket stayed open for 45 s without any client heartbeat or ping. No maintenance frame seen |
| handshake and operation rate limits | none published | about 30 handshakes over 30 minutes, none refused |
| public market data authentication | none published | none |
| message parse and routing | none published | route on `cmid`, then parse `data` as JSON and route on its `s` |
| subscribe acknowledgement shape | none published | no acknowledgement frame. The first `4001` frame arrives within 0.3 to 0.7 s |
| symbol identifier format | none published | upper case `BTC-USDT`. The catalog uses lower case `btc-usdt`, and lower case gets an empty REST book |
| number representation | none published | JSON numbers inside the inner JSON string |
| timestamp representation | none published | no timestamp on `7001`. The ticker has `now` in Unix seconds and trades carry ms |
| size unit | none published | not established, section 4 |
| sequence semantics | none published | `v` of each delta equals the previous `v` plus 1, per symbol, and equals `a` |
| idle repeat behaviour | none published | the book sends nothing while unchanged. The ticker repeats every 0.5 s |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
All 7001 frames in every run had `"type":2`.
The web client seeds each book with `GET {quote host}/mkpai/depth-v2?businessType=BTC-USDT&dType=0&size=200` when it sends `4001`, and handles a `type` of 1 as a full replacement, S2.
No `type` 1 frame was seen.

### Delta semantics

Each delta lists changed levels as `[price, amount]` pairs, and an amount of 0 removes the level.
A side with no change is left out, so `bids` or `asks` can be missing from a frame.
In run 4, 3 of 6 BTC-USDT deltas had no `bids` key.
A delta named up to 349 levels in one run, which looks like a large slice of the book being rewritten at once.

### Sequence and gap rule

`v` is per symbol and rises by exactly 1 per delta.
Run 4 section A saw 12 steps of 1 in 13 BTC-USDT deltas.
The REST seed carries the same counter.
After a seed at `v` = 1193279 for BTC-USDT, deltas older than the seed were dropped and the next 6 deltas were each the previous `v` plus 1, with no gap.
The rule a feed would use is: drop deltas at or below the seed's `v`, require `v` = last plus 1, and reseed on any other value.
No gap was ever seen, in 5 symbols and about 80 deltas across runs, but no socket stayed open long enough with several symbols to test it well, see section 5.

### Checksum

None.

### Level order on the wire

Deltas are not ordered.
In run 4, 5 of 8 deltas had bid prices out of descending order, and an exploration capture had bids `[82543.7,9964],[82523,12241],[82537.5,1000]` in that order.
The REST seed is ordered: asks ascending and bids descending at every size tried.

### Size unit against the catalog `contractFactor`

Not established.
BTC-USDT book amounts are whole numbers such as 1000, 7576 and 9181, and the catalog gives `"contractFactor":0.001` for `btc-usdt`, so contracts of 0.001 BTC is the reading that fits, at 1 to 10 BTC per level.
The spot book `BTC_USDT` on the same host has fractional amounts such as 8.76561346.
No documentation confirms the unit, and trade amounts on `6001` such as 58.4 are not whole, so the unit needs a check against a known order before any use.

### One-sided and empty books

An unknown symbol returns an empty REST book `{"asks":[],"bids":[],"v":0}` with code 0, and no socket frames.
No one-sided live book was seen.

### Idle repeats

The book channel does not repeat.
The ticker `4001` repeats every 0.5 s.

### Unknown, closed and wrong-parameter symbols

`NOPE-USDT` got nothing on the socket and `v` 0 from REST.
Lower case `btc-usdt` also returns `v` 0 from REST, so the catalog id must be upper-cased.

## 5. Session

The quote socket closes when it carries more than one or two symbols.
Every probe run gave the same result.

| test | result in run 4 | earlier runs |
|---|---|---|
| one symbol, one heartbeat at the start, 20 s | stayed open | stayed open in 3 runs |
| one symbol, no heartbeat and no ping, 45 s | stayed open | stayed open for 60 s in run 3 |
| one `4001` naming three symbols | server close 1000 with an empty reason after 4.7 s | 3.0, 3.3, 4.1, 4.4, 4.9 and 5.3 s with 3 to 5 symbols |
| one `4001` per symbol, a new one every 8 s | open with 1 and 2 symbols, server close 1000 at 19.6 s, 3.6 s after the third | 19.5 s in the book-only run |
| two symbols, one `4001` each, heartbeat every 5 s, 90 s planned | server close 1000 after about 18 s, judged by 36 BTC-USDT ticker frames at 2 per second | about 18 s in the book-only run. A two-symbol socket stayed open for 15 s in one exploration |

The cause is not known.
It is not the missing heartbeat, since a one-symbol socket without one stayed open, and the two-symbol socket that closed was sending one every 5 s.
The web client unsubscribes the previous symbol before each `4001`, and reconnects after a delay of 1 s times the number of closes so far, S2.
A feed for 140 perpetuals would need about 140 sockets, and one per symbol has only been seen to survive for 60 s.

Compression: `permessage-deflate` is offered.
The stream socket answers `{"method":"heart"}` with `{"code":"0","data":{"uid":"","time":1791604793540},"event":"heart"}`, and the web client sends that every 5 s after each reply, S2.

## 6. Captured frames

A `7001` delta, run 4, with no `bids` key:

```json
{"data":"{\"s\":\"BTC-USDT\",\"p\":82556,\"v\":1193255,\"a\":1193255,\"asks\":[[82630.2,13677],[82556.1,0]],\"type\":2}","cmid":"7001"}
```

`p` is the last price, `v` and `a` are the sequence, and `[82556.1,0]` removes a level.

A heartbeat answer:

```json
{"data":"1","cmid":"3000"}
```

A ticker, trimmed:

```json
{"data":"{\"symbol\":\"BTC-USDT\",\"r\":\"1\",\"s\":\"ok\",\"now\":1791604679,\"c\":82556.1,\"price\":82556.1,\"volume\":3407052.0}","cmid":"4001"}
```

A trade:

```json
{"data":"1,82556.0,58.4,1791604679467,BTC-USDT","cmid":"6001"}
```

The stream socket's subscribe acknowledgement and one `flagprice_list` row:

```json
{"event":"subscribe","params":{"channel":"flagprice_list","time":1791604793540}}
```

```json
{"p":82599.3,"r":1.635e-05,"s":"BTC-USDT","c":82556.1}
```

No error frame exists to show, since an unknown symbol gets silence and an overloaded socket gets a bare close 1000.

## 7. Private channels

On the stream socket the web client sends `{"method":"login","params":[{"token":…,"timestamp":…,"language":…}]}` with the site's session token, then subscribes `position` and `pet`, S2.
There is no API key scheme, since there is no API.

## 8. Recommended feed shape

None is recommended, because XXKK has no public API and the quote socket drops connections that carry more than one symbol.
If XXKK publishes its announced API, this profile should be redone against it.
If the website's socket had to be used anyway, the shape would be:

- one socket per contract to `wss://q.xkqts.com/wsquote`, with `wss://q.bmyakh.com/wsquote` as the fallback, both read from `swap_quote_domain`,
- `{"cmid":"4001","symbols":"<UPPER-CASE ID>","r":1,"data":"24"}` as the only subscribe,
- a REST seed from `/mkpai/depth-v2?businessType=<ID>&dType=0&size=200`, then the `v` rule of section 4,
- `{"cmid":"3000"}` every 5 s, and `maxSilenceMs` of about 10,000, since a quiet book may send no `7001` for several seconds while `4001` still arrives every 0.5 s,
- sorting of every delta's levels before use,
- the size unit confirmed first.

The Rust adapters in [`../../../server/src/venues/`](../../../server/src/venues/) put many markets on one socket, 150 per connection for Gate in [`gate.rs`](../../../server/src/venues/gate.rs) line 30, so one socket per contract would be a change to the feed shape as well.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://www.xxkk.com/en/developers` | 2026-10-09 |
| S2 | `https://www.xxkk.com/_next/static/chunks/pages/_app-adf470e5459135fc.js`, the site's main script, which holds the quote socket client (`getWsUrl` returns the quote host plus `/wsquote`), the order book seed (`/mkpai/depth-v2`) and the stream socket client (`wss://` plus the host plus `/api/stream`) | 2026-10-09 |
| S3 | `GET https://www.xxkk.com/api/public/symbol/list`, probed by [`rest-probe.py`](../../../scripts/probes/venues/xxkk/rest-probe.py) | 2026-10-09 |
| S4 | [`ws-probe.py`](../../../scripts/probes/venues/xxkk/ws-probe.py), run 4 at 03:57:58 UTC on 2026-10-10, and the second pass | 2026-10-09 |
