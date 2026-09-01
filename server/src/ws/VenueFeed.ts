import { Logger } from '@nestjs/common';
import WebSocket, { type RawData } from 'ws';
import type { Engine } from '../engine/Engine';
import type { Market, Venue } from '../engine/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
  NormalizedQuote,
} from './types';

const RECONNECT_BASE_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_JITTER_MS = 250;
const CLOSE_GRACE_MS = 2_000;
const MIN_SILENCE_CHECK_MS = 1_000;

export abstract class VenueFeed {
  protected readonly logger: Logger;
  private readonly connections: SingleSocketConnection[] = [];
  private readonly reconnectTimers = new Set<NodeJS.Timeout>();
  private readonly warnedUnknown = new Set<string>();
  private running = false;

  protected abstract readonly maxSilenceMs: number;

  constructor(
    protected readonly venue: Venue,
    private readonly engine: Engine,
  ) {
    this.logger = new Logger(`WS ${venue.name}`);
  }

  public start(): void {
    if (this.running) {
      return;
    }

    const plans = this.planEndpoints();
    if (!plans.length) {
      this.logger.error('start aborted: planEndpoints returned nothing');
      return;
    }

    this.running = true;
    for (let i = 0; i < plans.length; i++) {
      this.openConnection(plans[i]);
    }

    this.logger.log(`started with ${plans.length} connection(s)`);
  }

  public stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;

    this.logger.log(
      `stopping: ${this.connections.length} connection(s), ${this.reconnectTimers.size} pending reconnect(s)`,
    );

    const timers = [...this.reconnectTimers];
    for (let i = 0; i < timers.length; i++) {
      clearTimeout(timers[i]);
    }

    this.reconnectTimers.clear();

    const connections = [...this.connections];
    for (let i = 0; i < connections.length; i++) {
      this.closeConnection(connections[i]);
    }
  }

  protected openConnection(plan: EndpointPlan, attempt = 0): void {
    const socket = new WebSocket(plan.url);
    const c: SingleSocketConnection = {
      id: plan.id,
      plan,
      socket,
      accepted: new Set(plan.markets.map((m) => m.rawMarketId)),
      lastMessageAt: 0,
      attempt,
      reopenOnClose: true,
      timers: [],
    };
    this.addConnection(c);
    socket.on('open', () => this.onOpen(c));
    socket.on('message', (raw) => this.onMessage(raw, c));
    socket.on('close', () => this.onClose(c));
    socket.on('error', (e) => this.logger.error(`${c.id}: ${e.message}`));
    socket.on('ping', () => (c.lastMessageAt = Date.now()));
    socket.on('pong', () => (c.lastMessageAt = Date.now()));
  }

  private onOpen(c: SingleSocketConnection): void {
    c.lastMessageAt = Date.now();
    try {
      for (const frame of this.getSubscribeFrames(c.plan.markets)) {
        c.socket.send(JSON.stringify(frame));
      }
      this.startKeepalive(c);
    } catch (e) {
      this.logger.error(`${c.id}: open failed: ${(e as Error).message}`);
      c.socket.terminate();
      return;
    }

    this.startSilenceWatch(c);
  }

  private onMessage(raw: RawData, c: SingleSocketConnection): void {
    c.lastMessageAt = Date.now();
    c.attempt = 0;

    try {
      this.handleMessage(VenueFeed.toBuffer(raw), c);
    } catch (e) {
      this.logger.error(
        `${c.id}: handleMessage failed: ${(e as Error).message}`,
      );
    }
  }

  private onClose(c: SingleSocketConnection): void {
    this.clearTimers(c);
    this.engine.markStale(
      this.venue.id,
      c.plan.markets.map((m) => m.rawMarketId),
    );
    this.removeConnection(c);
    if (this.running && c.reopenOnClose) {
      this.scheduleReconnect(c.plan, c.attempt + 1);
    }
  }

  protected closeConnection(c: SingleSocketConnection, reopen = false): void {
    c.reopenOnClose = reopen;
    this.clearTimers(c);
    const kill = setTimeout(() => c.socket.terminate(), CLOSE_GRACE_MS);
    kill.unref();
    c.socket.once('close', () => clearTimeout(kill));
    c.socket.close();
  }

  // A socket routes only the symbols on its own plan, which is also the slice markStale covers on close.
  // A venue can deliver a symbol nobody asked for, and a rawMarketId spelled differently from the venue's own id looks identical here.
  // The first drop of each symbol is therefore logged, because that second case is otherwise completely silent.
  protected accepts(c: SingleSocketConnection, rawMarketId: string): boolean {
    if (c.accepted.has(rawMarketId)) {
      return true;
    }

    if (!this.warnedUnknown.has(rawMarketId)) {
      this.warnedUnknown.add(rawMarketId);
      this.logger.warn(`${c.id}: dropped an unsubscribed symbol ${rawMarketId}`);
    }

    return false;
  }

  protected submit(q: NormalizedQuote): void {
    this.engine.updateQuote(this.venue.id, q.rawMarketId, q);
  }

  private addConnection(c: SingleSocketConnection): void {
    this.connections.push(c);
  }

  private removeConnection(c: SingleSocketConnection): void {
    const i = this.connections.indexOf(c);
    if (i !== -1) {
      this.connections.splice(i, 1);
    }
  }

  private clearTimers(c: SingleSocketConnection): void {
    for (let i = 0; i < c.timers.length; i++) {
      clearTimeout(c.timers[i]);
    }
    c.timers.length = 0;
  }

  private startSilenceWatch(c: SingleSocketConnection): void {
    const limit = this.maxSilenceMs;
    if (limit <= 0) {
      return;
    }

    const every = Math.max(MIN_SILENCE_CHECK_MS, Math.floor(limit / 2));

    c.timers.push(
      setInterval(() => {
        const silence = Date.now() - c.lastMessageAt;
        if (silence < limit) {
          return;
        }

        this.logger.error(`${c.id}: no traffic for ${silence}ms, terminating`);
        c.socket.terminate(); // 'close' does markStale and the reconnect
      }, every),
    );
  }

  private scheduleReconnect(plan: EndpointPlan, attempt: number): void {
    const backoff = Math.min(
      RECONNECT_BASE_MS * 2 ** (attempt - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    const delay = backoff + Math.random() * RECONNECT_JITTER_MS;

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(timer);
      if (!this.running) {
        return;
      }
      this.openConnection(plan, attempt);
    }, delay);

    this.reconnectTimers.add(timer);
    this.logger.warn(
      `${plan.id}: reconnecting in ${Math.round(delay)}ms (attempt ${attempt})`,
    );
  }

  private static toBuffer(raw: RawData): Buffer {
    if (Buffer.isBuffer(raw)) {
      return raw;
    } else if (Array.isArray(raw)) {
      return Buffer.concat(raw);
    } else {
      return Buffer.from(raw);
    }
  }
  protected abstract planEndpoints(): EndpointPlan[];
  protected abstract getSubscribeFrames(markets: Market[]): object[];
  protected abstract startKeepalive(c: SingleSocketConnection): void;
  protected abstract handleMessage(
    raw: Buffer,
    c: SingleSocketConnection,
  ): void;
}
