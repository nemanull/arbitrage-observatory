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

// A venue that reports its rate limit inside an HTTP 200 body, as MEXC does with code 510, throws this so the poller pauses as it does on a 429.
export class RateLimitReplyError extends Error {
  readonly rateLimited = true;
  readonly retryAfterMs = null;

  constructor(
    readonly url: string,
    readonly code: number | string,
  ) {
    super(`rate limit code ${code} from ${url}`);
  }
}
