# Withdrawn side

A market where one side of the book empties, so there is a sell side and no buy side, or the reverse.
Every feed drops that message without telling the engine.
The last two sided quote stays in memory and keeps trading against the other venue, for up to five minutes, against a price that nobody is offering any more.

## It really happens

Three books read on 2026-09-06, from section 1a of [`../research/2026-09-06-venue-depth-endpoints-probe.md`](../research/2026-09-06-venue-depth-endpoints-probe.md).

| venue | instrument | bids returned | asks returned |
|---|---|---:|---:|
| krakenfutures | `PF_LAYERUSD` | 21 | 9 |
| coinbase | `S-PERP-INTX` | 19 | 9 |
| bybit | `LAYERUSDT` | 0 | 0 |

None of these is an error.
The first two are thin instruments where one side has more resting orders than the other, and the count keeps falling as makers step away.
The third is an instrument that closed.

Bybit answers a closed instrument with a success code and an empty book.

```json
{"s":"LAYERUSDT","b":[],"a":[],"ts":0,"u":0,"seq":0,"cts":0}
```

`retCode` is 0, which means the request succeeded.
A `ts` of zero is the only sign that the instrument does not exist any more.
An unknown symbol is different and answers `retCode` 10001 with `params error: symbol invalid`.

So a book with nothing in it, a book with one side, and a book that is simply thin all arrive through the same door.

## What the code does today

Two rules, in opposite directions, and both are deliberate.

**A feed drops a one sided quote.**
Every venue feed refuses to pass it to the engine.
Kraken's spec states it plainly in [`../../server/src/venues/krakenfutures/krakenfutures.spec.ts`](../../server/src/venues/krakenfutures/krakenfutures.spec.ts).

```ts
it('ignores a zero sided and a one sided book', () => {
  feed.handleMessage(ticker('PF_XBTUSD', 0, 0), c);
  feed.handleMessage(ticker('PF_XBTUSD', 79874, undefined), c);
  feed.handleMessage(ticker('PF_XBTUSD', undefined, 79875), c);

  expect(updateQuote).not.toHaveBeenCalled();
});
```

The same test exists for bybit in [`../../server/src/venues/bybit/bybit.spec.ts`](../../server/src/venues/bybit/bybit.spec.ts) and for okx in [`../../server/src/venues/okx/okx.spec.ts`](../../server/src/venues/okx/okx.spec.ts).

**The depth block accepts an empty side.**
Decision 5 of [`../implemented/2026-09-06-depth-block-design.md`](../implemented/2026-09-06-depth-block-design.md) says an empty side is accepted, because a one sided book is a fact worth holding.
`Engine.spec.ts` covers it with a case named "accepts a one-sided book".

The difference is intent.
A quote with one side is not a quote, because there is nothing to compare.
A book with one side is information, because it tells you nobody is bidding, and that is exactly what you want to know before believing an edge.

## The bug

The feed drops the message silently.
The engine is never told anything happened.

So the last good two sided quote stays sitting in `bid[v]` and `ask[v]`, with a `recvTs[v]` that looks perfectly alive, and the engine keeps comparing it against other venues.

```
  t=0    venue sends   bid 100 / ask 101      the engine stores it, an episode may open
  t=5    venue sends   bid 100 / ask none     the feed drops the whole message
  t=10   venue sends   bid  99 / ask none     the feed drops it again
  t=15   venue sends   bid  98 / ask none     the feed drops it again

         the engine still believes ask = 101, which nobody is offering
```

The buy side has genuinely left the market.
The engine keeps quoting a price that no longer exists, and the episode runs until `MAX_OPPORTUNITY_AGE_MS`, which is five minutes, in [`../../server/src/engine/OpportunityManager.ts`](../../server/src/engine/OpportunityManager.ts).

This is a third way to hold a dead price, alongside the trade driven channel in [`stale-quote.md`](./stale-quote.md) and the throttled channel it mentions.
It is worse than both in one respect.
In those two cases the venue is silent.
Here the venue is talking, saying something that matters, and the feed throws it away before anyone can hear it.

## Why it is easy to miss

The drop is correct in isolation.
A quote needs two sides to be a quote, so a feed that forwards a half quote would be forwarding a value the engine cannot use.

The mistake is treating "I cannot use this message" as "this message contains no information".
The message contains a fact, and the fact is that this market has no buy side right now.
That fact is more important than most of the quotes that do get forwarded.

There is also no log line, so nothing in the run shows it happening.
The behaviour is only visible by reading the feed code or its specs.

## How to detect it

The repair is in the feed, not in the depth work.

A feed that receives a one sided or empty book should tell the engine the quote is withdrawn rather than saying nothing.
The proposal recorded in the close reasons follow-ups is a call that sets `recvTs[v]` to zero and closes any route on that leg with a new reason, `quote_withdrawn`.
Setting `recvTs` to zero is what `Engine.markStale` already does when a socket goes down, so the mechanism exists and only the trigger is missing.

Nothing about this needs a book fetch.
It needs the feed to stop being silent.

Depth then adds the second half.
Once a book is fetched at the open, a side with a level count of zero is recorded as exactly that, because the block stores `bidLevelCount` and `askLevelCount` per venue slot and zero is a legitimate value.
A row can then say the buy side was empty, rather than leaving it to be inferred from a spread that looks impossible.

## Status

Not started.
The finding was reported on 2026-09-06 during the review of the close reasons change and was not applied, because that turn was for explanation only.
It is not yet a line in [`../ROADMAP.md`](../ROADMAP.md).

## Related

- [`stale-quote.md`](./stale-quote.md) is the same outcome reached through silence instead of a dropped message.
- [`thin-book.md`](./thin-book.md) is the state a book passes through on the way to this one.

## Evidence

- The three books and the closed instrument envelope: sections 1a and 1c of [`../research/2026-09-06-venue-depth-endpoints-probe.md`](../research/2026-09-06-venue-depth-endpoints-probe.md).
- The feed behaviour: the three specs linked above.
- The block rule that accepts an empty side: decision 5 of [`../implemented/2026-09-06-depth-block-design.md`](../implemented/2026-09-06-depth-block-design.md).
- The liveness rule the drop breaks: decision 1 of [`../implemented/2026-09-06-close-reasons-design.md`](../implemented/2026-09-06-close-reasons-design.md).
