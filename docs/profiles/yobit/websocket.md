# YoBit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:43 to 04:07 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

YoBit lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book feed.
YoBit documents no WebSocket API, S1.
Its web app pushes market data over WAMP v2, a publish and subscribe protocol, through autobahn.js and an obfuscated script, `/js/corews.js`, S3.
[`bundle-probe.py`](../../../scripts/probes/venues/yobit/bundle-probe.py) decodes that script's strings without running it, and [`ws-probe.py`](../../../scripts/probes/venues/yobit/ws-probe.py) speaks the protocol as a subscriber.
Everything below the endpoint is therefore undocumented and Probed.

## 1. Endpoints

| URL | protocol | role | evidence |
|---|---|---|---|
| `wss://propusher24.com` | WebSocket subprotocol `wamp.2.json`, realm `restricted_realm` | every public topic of the web app | decoded strings of S3, [`bundle-probe.py`](../../../scripts/probes/venues/yobit/bundle-probe.py) |

One socket carries every pair and every topic.
The host sits behind DDoS-Guard, which answered the upgrade with `Server: ddos-guard`.
The broker is Ratchet, a PHP WAMP server: the WELCOME frame names transport type `ratchet`.
The WELCOME frame also echoes the client's request headers back, including `X-Forwarded-For` and `X-Real-IP`, so the socket shows a client its own public address.
There is no perpetual endpoint.

## 2. Channel matrix

Topic names come from the decoded script, S3, and the probed column from [`ws-probe.py`](../../../scripts/probes/venues/yobit/ws-probe.py) `session`.

| topic | payload | probed |
|---|---|---|
| `ordlst<pair_id>`, such as `ordlst10108` for BTC/USDT | one changed price level per event | 18 to 81 events on BTC/USDT and 4 to 15 on ETH/USDT per run of about 80 to 90 s, over three runs, and none on ETH/BTC |
| `trhist<pair_id>` | one trade per event: pair id, a side code, base, quote, price, amount, total and a time in seconds | one ETH/BTC trade in three runs, none on the other two pairs |
| `ticker` | one pair's ticker per event, for every pair on the venue | 1 or 2 events per run of about 80 to 90 s |
| `tickerst` | a second ticker handler of the web app | no event |
| `hb` | the web app's heartbeat handler | no event |
| `deticker`, `dehist<pool_id>` | DeFi pool ticker and history | not subscribed |
| best bid and ask only | not offered | |
| depth snapshot | not offered on the socket | the REST depth call is the snapshot, [`rest.md`](./rest.md) section 5 |
| mark, index, funding | not offered | spot venue |

`pair_id` is a number that only the trade pages publish, as `var pair_id = '10108';` on `https://yobit.net/en/trade/BTC/USDT`, S2.
Probed ids: BTC/USDT 10108, ETH/USDT 10128, ETH/BTC 40001, DOGE/USDT 10110.
The `ticker` events also carry a pair id with its base and quote, so a long-running client could learn the mapping from them.
No call was found that returns every pair id at once.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is documented, so every documented value is Not publicly specified, and the probed column is the `ordlst` topic.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one URL for every pair and topic |
| subscribe frame shape | Not publicly specified | WAMP HELLO `[1,"restricted_realm",{"roles":{"subscriber":{}}}]`, then SUBSCRIBE `[32,<request id>,{},"ordlst10108"]` |
| unknown symbol expectation | Not publicly specified | `ordlst99999999` is acknowledged with SUBSCRIBED like any topic and then stays silent |
| chunk unit and budget | Not publicly specified | ten topics on one socket worked, no limit reached |
| keepalive mechanism | Not publicly specified | WebSocket protocol ping, answered with a pong. The server sent no ping of its own. |
| connection lifetime and maintenance notice | Not publicly specified | With one subscription and no client traffic, one socket stayed open 150 s and another was dropped after 84 s with no close frame, `silence`. Sockets that pinged every 20 s were never dropped. |
| handshake and operation rate limits | Not publicly specified | Not verified |
| public market data authentication | Not publicly specified | none, an anonymous HELLO is welcomed |
| message parse and routing | Not publicly specified | WAMP EVENT `[36,<subscription id>,<publication id>,{},[<string>]]`. The subscription id from SUBSCRIBED routes the topic. The payload is a JSON string inside the array, which must be parsed a second time. |
| subscribe acknowledgement shape | Not publicly specified | SUBSCRIBED `[33,<request id>,<subscription id>]` |
| symbol identifier format | Not publicly specified | numeric `pair_id` in the topic and as the first payload field |
| number representation | Not publicly specified | price, amount and total as strings with 8 decimals, side and flag as integers |
| timestamp representation | Not publicly specified | none on book events, seconds as a string on trade events |
| size unit | Not publicly specified | base asset, matching the REST depth amount |
| sequence semantics | Not publicly specified | none: the publication id is a random 53-bit number, not a counter |
| idle repeat behaviour | Not publicly specified | none: the topic is silent while the book does not change |

## 4. The book channel in detail

| item | probed value |
|---|---|
| snapshot on subscribe | none, the first event is the next change |
| event payload | `[pair_id, op, side, price, amount, total, flag]`, such as `[10108,"upd",1,"81826.70000000","0.00000000","0.00000000",0]` |
| `op` | `ins` or `upd`. Both set a level, and `upd` also creates levels the client has not seen. |
| `side` | 1 for bids, 2 for asks, by comparison with the REST book |
| `amount` | the new total at that price in the base asset, and `"0.00000000"` removes the level |
| `total` | price times amount |
| `flag` | 0 on every removal and on some changes that left an amount, 1 on every insert and on the other changes. Its meaning is not stated, and a book needs only price and amount. |
| delta replay | Events replayed onto a REST depth snapshot were compared with a second REST snapshot about 60 s later, top 20 levels a side. With 18 BTC/USDT events both sides matched. With 69 BTC/USDT events the asks matched and 4 of 22 bid prices differed, and with 12 ETH/USDT events 2 of 21 ask prices differed. Each mismatch came with events arriving within 3 s of the second snapshot, inside the REST call's 2 s cache, so the replay could not be proven exact. |
| per symbol sequence and gap rule | none, so a lost event cannot be detected |
| checksum | none |
| level order on the wire | one level per event, no order to keep |
| one-sided and empty books | not seen on the probed pairs |
| unknown or closed pair | acknowledged and silent, section 3 |

Events on the probed pairs came in short bursts with gaps of tens of seconds.
The one ETH/BTC trade, at 0.03024301, arrived with no `ordlst40001` event before or after it, and the ETH/BTC REST book was unchanged across that run.
That fits the venue's volume: BTC/USDT traded 0.030 BTC in the 24 hours before the probe, [`rest.md`](./rest.md) section 2.

## 5. Session

| item | probed value |
|---|---|
| handshake | about 1 to 4 s to open, through DDoS-Guard |
| compression | none: the server did not accept `permessage-deflate` |
| keepalive | the client library's protocol pings every 20 s were answered with pongs |
| silence tolerated | Not stable. One socket with no client frame lasted 150 s, and another was dropped after 84 s without a close frame. |
| forced disconnects | none on the sockets that pinged, over about 9 minutes of sockets in all |
| UNSUBSCRIBE | answered with UNSUBSCRIBED `[35,<request id>]` |
| GOODBYE | answered with `[6,{},"wamp.error.goodbye_and_out"]`, then the server closed |
| maintenance notices | none seen |
| subscription limits | not reached with ten topics |

## 6. Captured frames

From three runs of [`ws-probe.py`](../../../scripts/probes/venues/yobit/ws-probe.py) `session`, trimmed.

WELCOME, after the HELLO, with the echoed headers cut:

```json
[2,2463749485150143,{"roles":{"subscriber":{"features":{}},"broker":{"features":{"subscriber_blackwhite_listing":true,"publisher_exclusion":true,"subscriber_metaevents":true}}},"transport":{"type":"ratchet"}}]
```

SUBSCRIBED for `ordlst10108`:

```json
[33,1,8450949557099366]
```

A book event that removes the BTC/USDT bid at 81826.70:

```json
[36,8450949557099366,7947721737043383,{},["[10108,\"upd\",1,\"81826.70000000\",\"0.00000000\",\"0.00000000\",0]"]]
```

A book event that inserts an ETH/USDT ask:

```json
[36,2306820203991179,4540562554877782,{},["[10128,\"ins\",2,\"2572.45140000\",\"0.07000000\",\"180.07159800\",1]"]]
```

A trade event for ETH/BTC:

```json
[36,5277524610711766,5277075060277351,{},["[40001,1,\"ETH\",\"BTC\",\"0.03024301\",\"33.66429700\",\"1.01810967\",\"1791605009\"]"]]
```

A `ticker` event for ZEC/BTC:

```json
[36,7293386093257246,4679675799085468,{},["[766,1,\"ZEC\",\"BTC\",\"0.01470690\",\"-0.2\",\"0.01486120\",\"0.01465309\",\"57294.89062120\",\"845.81542867\",\"845.81542867\"]"]]
```

UNSUBSCRIBED and the answer to GOODBYE:

```json
[35,999]
```

```json
[6,{},"wamp.error.goodbye_and_out"]
```

No error frame was produced: an unknown topic is accepted, section 3.

## 7. Private channels

None documented.
The Trade API is REST only, at `https://yobit.net/tapi/`, S1.

## 8. Recommended feed shape

No feed is recommended, because YoBit has no perpetual for the engine to use.
If a spot leg is ever wanted, the shape would be this.

- One socket to `wss://propusher24.com` with subprotocol `wamp.2.json`, HELLO to realm `restricted_realm`, and one SUBSCRIBE per `ordlst<pair_id>`.
- Pair ids scraped from each trade page, or learned from `ticker` events, since no call lists them.
- A REST depth snapshot per pair after SUBSCRIBED, then each event sets or removes one level.
- Protocol pings every 20 s at most, since a socket without them was dropped after 84 s, and `maxSilenceMs` of several minutes at least, since a quiet pair sends nothing for long stretches.
- Because there is no sequence, a periodic REST resnapshot is the only resync rule, at no more than the 100 requests a minute the rules page allows, [`rest.md`](./rest.md) section 6.

The feed is undocumented, so it may change without notice.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [YoBit API page](https://yobit.net/en/api/), which documents REST only | 2026-10-09 |
| S2 | [YoBit trade page for BTC/USDT](https://yobit.net/en/trade/BTC/USDT), its script list and its `pair_id` variable | 2026-10-09 |
| S3 | [YoBit web socket script](https://yobit.net/js/corews.js) and [autobahn.js](https://yobit.net/js/autobahn.min.js), decoded by [`bundle-probe.py`](../../../scripts/probes/venues/yobit/bundle-probe.py) | 2026-10-09 |
| S4 | [`ws-probe.py`](../../../scripts/probes/venues/yobit/ws-probe.py), modes `session` and `silence` | 2026-10-09 |
