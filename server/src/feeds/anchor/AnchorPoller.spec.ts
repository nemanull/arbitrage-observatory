import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { AnchorReading, Market, Venue } from '../../engine/cluster/types';
import { HttpStatusError, RateLimitReplyError } from '../../shared/errors';
import { AnchorPoller } from './AnchorPoller';
import type { AnchorRow, AnchorMap } from './types';

const VENUE_ID = 'testvenue';
const INTERVAL_MS = 1_000;
const T0 = 1_700_000_000_000;

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, 3),
    quote: 'USDT',
    takerPpm: 500,
    linear: true,
    contractSize: 1,
  };
}

function row(index: number, overrides: Partial<AnchorRow> = {}): AnchorRow {
  return {
    index,
    mark: index * 1.001,
    fundingRate: 0.0001,
    fundingIntervalHours: 8,
    nextFundingAt: T0 + 3_600_000,
    ...overrides,
  };
}

// The venue side of the poller is one method returning rows, so the test subclass returns whatever the test queues up.
class TestPoller extends AnchorPoller {
  rounds: AnchorMap[] = [];
  errors: Error[] = [];
  pending: Promise<AnchorMap> | null = null; // returned instead of the queue while set, for a round that must stay open
  signals: AbortSignal[] = [];

  protected fetchRound(_ts: number, signal: AbortSignal): Promise<AnchorMap> {
    this.signals.push(signal);
    if (this.pending !== null) {
      const open = this.pending;
      this.pending = null;
      return open;
    }
    const error = this.errors.shift();
    if (error !== undefined) {
      return Promise.reject(error);
    }
    return Promise.resolve(this.rounds.shift() ?? new Map<string, AnchorRow>());
  }
}

function makePoller(markets: Market[]) {
  const updateAnchor = jest
    .fn<boolean, [string, string, AnchorReading]>()
    .mockReturnValue(true);
  const venue: Venue = { id: VENUE_ID, name: 'Test Venue', markets };
  const engine = { updateAnchor } as unknown as Engine;
  const poller = new TestPoller(venue, engine);

  return { poller, updateAnchor };
}

function rows(entries: [string, AnchorRow][]): AnchorMap {
  return new Map(entries);
}

// Lets every promise the round chained settle before the assertions run.
async function flush(): Promise<void> {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('AnchorPoller.start', () => {
  it('polls once at start and then on every interval', async () => {
    const { poller, updateAnchor } = makePoller([market('AAAUSDT')]);
    poller.rounds.push(
      rows([['AAAUSDT', row(1)]]),
      rows([['AAAUSDT', row(2)]]),
      rows([['AAAUSDT', row(3)]]),
    );

    poller.start();
    await flush();
    expect(updateAnchor).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(INTERVAL_MS);
    await flush();
    expect(updateAnchor).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(INTERVAL_MS);
    await flush();
    expect(updateAnchor).toHaveBeenCalledTimes(3);
    expect(updateAnchor.mock.calls.map((c) => c[2].index)).toEqual([1, 2, 3]);

    poller.stop();
  });

  it('refuses to start a venue with no markets', () => {
    const { poller, updateAnchor } = makePoller([]);

    poller.start();
    jest.advanceTimersByTime(INTERVAL_MS * 3);

    expect(updateAnchor).not.toHaveBeenCalled();
  });
});

describe('AnchorPoller round', () => {
  it('writes every tracked market with the same ts, the time the reply arrived', async () => {
    const { poller, updateAnchor } = makePoller([
      market('AAAUSDT'),
      market('BBBUSDT'),
    ]);
    let reply: (map: AnchorMap) => void = () => undefined;
    poller.pending = new Promise((resolve) => {
      reply = resolve;
    });

    poller.start();
    jest.setSystemTime(T0 + 700); // the venue took 700 ms to answer
    reply(
      rows([
        ['AAAUSDT', row(1)],
        ['BBBUSDT', row(2)],
        ['ZZZUSDT', row(3)],
      ]),
    );
    await flush();

    expect(updateAnchor).toHaveBeenCalledTimes(2);
    expect(updateAnchor).toHaveBeenCalledWith(VENUE_ID, 'AAAUSDT', {
      ...row(1),
      ts: T0 + 700,
    });
    expect(updateAnchor).toHaveBeenCalledWith(VENUE_ID, 'BBBUSDT', {
      ...row(2),
      ts: T0 + 700,
    });
    poller.stop();
  });

  it('warns once for a tracked market the reply never carries', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const { poller, updateAnchor } = makePoller([
      market('AAAUSDT'),
      market('GONEUSDT'),
    ]);
    poller.rounds.push(
      rows([['AAAUSDT', row(1)]]),
      rows([['AAAUSDT', row(1)]]),
    );

    poller.start();
    await flush();
    jest.advanceTimersByTime(INTERVAL_MS);
    await flush();

    expect(updateAnchor).toHaveBeenCalledTimes(2);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes('GONEUSDT')),
    ).toHaveLength(1);
    poller.stop();
  });

  it('treats a row without an index as missing instead of sending it to the engine', async () => {
    const { poller, updateAnchor } = makePoller([
      market('AAAUSDT'),
      market('NEWUSDT'),
    ]);
    poller.rounds.push(
      rows([
        ['AAAUSDT', row(1)],
        ['NEWUSDT', row(0)],
      ]),
    );

    poller.start();
    await flush();

    expect(updateAnchor).toHaveBeenCalledTimes(1);
    expect(updateAnchor.mock.calls[0]).toEqual([
      VENUE_ID,
      'AAAUSDT',
      { ...row(1), ts: T0 },
    ]);
    poller.stop();
  });

  it('skips a tick while the previous round is still in flight', async () => {
    const { poller, updateAnchor } = makePoller([market('AAAUSDT')]);
    let release: (rows: AnchorMap) => void = () => undefined;
    poller.pending = new Promise<AnchorMap>((resolve) => (release = resolve));
    poller.rounds.push(rows([['AAAUSDT', row(2)]]));

    poller.start();
    await flush();
    jest.advanceTimersByTime(INTERVAL_MS);
    await flush();
    expect(poller.signals).toHaveLength(1);
    expect(updateAnchor).not.toHaveBeenCalled();

    release(rows([['AAAUSDT', row(1)]]));
    await flush();
    expect(updateAnchor).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(INTERVAL_MS);
    await flush();
    expect(poller.signals).toHaveLength(2);
    expect(updateAnchor).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('keeps polling after a failed round and recovers on the next', async () => {
    const { poller, updateAnchor } = makePoller([market('AAAUSDT')]);
    poller.errors.push(new Error('socket hang up'));
    poller.rounds.push(rows([['AAAUSDT', row(1)]]));

    poller.start();
    await flush();
    expect(updateAnchor).not.toHaveBeenCalled();

    jest.advanceTimersByTime(INTERVAL_MS);
    await flush();
    expect(updateAnchor).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('pauses after a rate limit answer for the Retry-After the venue sent', async () => {
    const { poller, updateAnchor } = makePoller([market('AAAUSDT')]);
    poller.errors.push(new HttpStatusError('https://x', 429, 3_000));
    poller.rounds.push(
      rows([['AAAUSDT', row(1)]]),
      rows([['AAAUSDT', row(1)]]),
    );

    poller.start();
    await flush();

    jest.advanceTimersByTime(INTERVAL_MS * 2);
    await flush();
    expect(updateAnchor).not.toHaveBeenCalled();

    jest.advanceTimersByTime(INTERVAL_MS);
    await flush();
    expect(updateAnchor).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('keeps the ts a row carries and stamps the others with the arrival', async () => {
    const { poller, updateAnchor } = makePoller([
      market('AAAUSDT'),
      market('BBBUSDT'),
    ]);
    let reply: (map: AnchorMap) => void = () => undefined;
    poller.pending = new Promise((resolve) => {
      reply = resolve;
    });

    poller.start();
    jest.setSystemTime(T0 + 2_500);
    reply(
      rows([
        ['AAAUSDT', row(1, { ts: T0 + 120 })],
        ['BBBUSDT', row(2)],
      ]),
    );
    await flush();

    expect(updateAnchor).toHaveBeenCalledWith(VENUE_ID, 'AAAUSDT', {
      ...row(1),
      ts: T0 + 120,
    });
    expect(updateAnchor).toHaveBeenCalledWith(VENUE_ID, 'BBBUSDT', {
      ...row(2),
      ts: T0 + 2_500,
    });
    poller.stop();
  });

  it('pauses for the default pause on a rate limit sent inside a successful reply', async () => {
    const { poller, updateAnchor } = makePoller([market('AAAUSDT')]);
    poller.errors.push(new RateLimitReplyError('https://x', 510));
    poller.rounds.push(rows([['AAAUSDT', row(1)]]));

    poller.start();
    await flush();

    jest.advanceTimersByTime(59_000);
    await flush();
    expect(updateAnchor).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2_000);
    await flush();
    expect(updateAnchor).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('fails the round when no tracked market could be written', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const { poller, updateAnchor } = makePoller([market('AAAUSDT')]);
    updateAnchor.mockReturnValue(false);
    poller.rounds.push(rows([['AAAUSDT', row(1)]]));

    poller.start();
    await flush();

    expect(updateAnchor).toHaveBeenCalledTimes(1);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('round failed')),
    ).toBe(true);
    poller.stop();
  });
});

describe('AnchorPoller.stop', () => {
  it('aborts the round in flight and polls no more', async () => {
    const { poller, updateAnchor } = makePoller([market('AAAUSDT')]);
    poller.pending = new Promise<AnchorMap>(() => undefined);
    poller.rounds.push(rows([['AAAUSDT', row(1)]]));

    poller.start();
    await flush();
    const signal = poller.signals[0];
    expect(signal.aborted).toBe(false);

    poller.stop();
    jest.advanceTimersByTime(INTERVAL_MS * 3);
    await flush();

    expect(signal.aborted).toBe(true);
    expect(poller.signals).toHaveLength(1);
    expect(updateAnchor).not.toHaveBeenCalled();
  });

  it('is idempotent', () => {
    const { poller } = makePoller([market('AAAUSDT')]);
    poller.rounds.push(rows([['AAAUSDT', row(1)]]));

    poller.start();
    poller.stop();
    poller.stop();
    jest.advanceTimersByTime(INTERVAL_MS * 3);
  });
});

describe('AnchorPoller.getJson', () => {
  type Probe = { getJson<T>(url: string, signal: AbortSignal): Promise<T> };

  it('returns the decoded body on 200', async () => {
    const { poller } = makePoller([market('AAAUSDT')]);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
      );

    const body = await (poller as unknown as Probe).getJson<{ ok: number }>(
      'https://x/y',
      new AbortController().signal,
    );

    expect(body).toEqual({ ok: 1 });
  });

  it('throws an HttpStatusError carrying the status and Retry-After on a non 2xx', async () => {
    const { poller } = makePoller([market('AAAUSDT')]);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '7' },
      }),
    );

    const failure = (poller as unknown as Probe)
      .getJson('https://x/y', new AbortController().signal)
      .catch((e: unknown) => e);
    const e = (await failure) as HttpStatusError;

    expect(e).toBeInstanceOf(HttpStatusError);
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(7_000);
    expect(e.rateLimited).toBe(true);
  });

  it('reads a 500 as a plain failure and not a rate limit', async () => {
    const { poller } = makePoller([market('AAAUSDT')]);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('', { status: 500 }));

    const e = (await (poller as unknown as Probe)
      .getJson('https://x/y', new AbortController().signal)
      .catch((err: unknown) => err)) as HttpStatusError;

    expect(e.status).toBe(500);
    expect(e.retryAfterMs).toBeNull();
    expect(e.rateLimited).toBe(false);
  });
});
