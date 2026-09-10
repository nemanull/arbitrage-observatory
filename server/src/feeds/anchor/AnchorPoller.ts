import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Venue } from '../../engine/types';
import type { AnchorRows } from './types';

const DEFAULT_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT_PAUSE_MS = 60_000;
const FAILURE_LOG_EVERY = 30;
const SUMMARY_EVERY_ROUNDS = 60;

const RATE_LIMITED_STATUSES = new Set([403, 418, 429]); // 403 for ByBit

export class HttpStatusError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(`${status} from ${url}`);
  }

  get rateLimited(): boolean {
    return RATE_LIMITED_STATUSES.has(this.status);
  }
}

type Window = {
  rounds: number;
  failed: number;
  skipped: number; // ticks that found the previous round still in flight
  written: number;
  missing: number; // tracked markets the reply did not carry
  rejected: number; // readings the engine refused
  sumMs: number;
  maxMs: number;
};

export abstract class AnchorPoller {
  protected readonly logger: Logger;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: AbortController | null = null;
  private running = false;
  private pausedUntil = 0;
  private failures = 0; // consecutive failed rounds
  private readonly warnedMissing = new Set<string>();
  private window: Window = emptyWindow();

  protected readonly intervalMs: number = DEFAULT_INTERVAL_MS; // no venue republishes faster than once a second, so faster polls return the same numbers
  protected readonly requestTimeoutMs: number = REQUEST_TIMEOUT_MS;
  protected readonly rateLimitPauseMs: number = RATE_LIMIT_PAUSE_MS; // when the venue sends no Retry-After

  constructor(
    protected readonly venue: Venue,
    private readonly engine: Engine,
  ) {
    this.logger = new Logger(`REST ${venue.name}`);
  }

  public start(): void {
    if (this.running) {
      return;
    }

    if (this.venue.markets.length === 0) {
      this.logger.error('start aborted: no markets to poll');
      return;
    }

    this.running = true;
    this.timer = setInterval(() => void this.round(), this.intervalMs);

    this.logger.log(
      `started: ${this.venue.markets.length} market(s) every ${this.intervalMs}ms`,
    );

    void this.round();
  }

  public stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.log(
      `stopping: ${this.inFlight === null ? 'idle' : 'one round in flight'}, ${this.failures} consecutive failure(s)`,
    );

    this.inFlight?.abort();
    this.inFlight = null;
  }

  private async round(): Promise<void> {
    if (!this.running) {
      return;
    }

    if (this.inFlight !== null) {
      this.window.skipped++;
      return;
    }

    const ts = Date.now();
    if (ts < this.pausedUntil) {
      return;
    }

    const controller = new AbortController();
    this.inFlight = controller;

    try {
      const rows = await this.fetchRound(ts, controller.signal);
      this.apply(rows, ts);
      this.succeeded(Date.now() - ts);
    } catch (e) {
      this.failed(e as Error, ts);
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = null;
      }
    }
  }

  private apply(rows: AnchorRows, ts: number): void {
    let written = 0;
    let missing = 0;
    let rejected = 0;

    for (const market of this.venue.markets) {
      const row = rows.get(market.rawMarketId);

      if (row === undefined || !(row.index > 0)) {
        missing++;
        this.warnMissing(market.rawMarketId, rows.size);
        continue;
      }

      const ok = this.engine.updateAnchor(this.venue.id, market.rawMarketId, {
        ...row,
        ts,
      });

      if (ok) {
        written++;
      } else {
        rejected++;
      }
    }

    this.window.written += written;
    this.window.missing += missing;
    this.window.rejected += rejected;

    if (written === 0) {
      throw new Error(
        `no tracked market written from ${rows.size} row(s): ${missing} missing, ${rejected} rejected`,
      );
    }
  }

  private warnMissing(rawMarketId: string, rowCount: number): void {
    if (this.warnedMissing.has(rawMarketId)) {
      return;
    }

    this.warnedMissing.add(rawMarketId);
    this.logger.warn(
      `no reading for ${rawMarketId} in a reply of ${rowCount} row(s)`,
    );
  }

  private succeeded(ms: number): void {
    if (this.failures > 0) {
      this.logger.log(`recovered after ${this.failures} failed round(s)`);
      this.failures = 0;
    }

    this.window.rounds++;
    this.window.sumMs += ms;
    this.window.maxMs = Math.max(this.window.maxMs, ms);

    if (this.window.rounds + this.window.failed >= SUMMARY_EVERY_ROUNDS) {
      this.summarize();
    }
  }

  private failed(e: Error, ts: number): void {
    if (!this.running) {
      return; // stop aborted the round
    }

    this.failures++;
    this.window.failed++;

    if (e instanceof HttpStatusError && e.rateLimited) {
      const pause = e.retryAfterMs ?? this.rateLimitPauseMs;
      this.pausedUntil = ts + pause;
      this.logger.error(`${e.message}, paused for ${pause}ms`);
    } else if (this.failures === 1 || this.failures % FAILURE_LOG_EVERY === 0) {
      this.logger.warn(
        `round failed (${this.failures} in a row): ${e.message}`,
      );
    }

    if (this.window.rounds + this.window.failed >= SUMMARY_EVERY_ROUNDS) {
      this.summarize();
    }
  }

  private summarize(): void {
    const w = this.window;

    this.logger.log({
      event: 'anchor_poll_summary',
      rounds: w.rounds,
      failed: w.failed,
      skipped: w.skipped,
      written: w.written,
      missing: w.missing,
      rejected: w.rejected,
      avgMs: w.rounds === 0 ? 0 : Math.round(w.sumMs / w.rounds),
      maxMs: Math.round(w.maxMs),
    });

    this.window = emptyWindow();
  }

  protected async getJson<T>(url: string, signal: AbortSignal): Promise<T> {
    const res = await fetch(url, {
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(this.requestTimeoutMs),
      ]),
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpStatusError(
        url,
        res.status,
        retryAfterMs(res.headers.get('retry-after')),
      );
    }

    return (await res.json()) as T;
  }

  protected abstract fetchRound(
    ts: number,
    signal: AbortSignal,
  ): Promise<AnchorRows>;
}

function emptyWindow(): Window {
  return {
    rounds: 0,
    failed: 0,
    skipped: 0,
    written: 0,
    missing: 0,
    rejected: 0,
    sumMs: 0,
    maxMs: 0,
  };
}

function retryAfterMs(header: string | null): number | null {
  if (header === null) {
    return null;
  }

  if (/^\d+$/.test(header)) {
    return Number(header) * 1_000;
  }

  const at = Date.parse(header);
  if (Number.isNaN(at)) {
    return null;
  }

  return Math.max(0, at - Date.now());
}
