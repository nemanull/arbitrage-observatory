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














