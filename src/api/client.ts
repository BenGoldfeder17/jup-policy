const BASE_URL = "https://api.jup.ag";

export interface ClientOptions {
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseRetryDelayMs?: number;
}

export class JupError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly path: string,
  ) {
    super(`${message} [${status} on ${path}]`);
    this.name = "JupError";
  }
}

export class JupClient {
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;

  constructor(opts: ClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.JUP_API_KEY ?? undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    // Keyless tier is 0.5 RPS, so 2s is the floor between calls to the same
    // endpoint. Default backoff starts there and doubles — keyed clients rarely
    // need more than one retry.
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseRetryDelayMs = opts.baseRetryDelayMs ?? (this.apiKey ? 500 : 2100);
  }

  get isKeyless(): boolean {
    return !this.apiKey;
  }

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.withRetry(() => this.fetchImpl(url, { headers: this.headers() }), path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.withRetry(
      () =>
        this.fetchImpl(url, {
          method: "POST",
          headers: { ...this.headers(), "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      path,
    );
  }

  private async withRetry<T>(send: () => Promise<Response>, path: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await send();
      if (res.status !== 429 && res.status !== 503) {
        return this.parse<T>(res, path);
      }
      // Prefer Retry-After when the API provides one; fall back to exponential
      // backoff anchored to the keyless RPS floor.
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : this.baseRetryDelayMs * Math.pow(2, attempt);
      lastErr = new JupError(
        `Jupiter API rate-limited (retrying in ${delay}ms, attempt ${attempt + 1}/${this.maxRetries + 1})`,
        res.status,
        await res.json().catch(() => null),
        path,
      );
      if (attempt === this.maxRetries) break;
      await sleep(delay);
    }
    throw lastErr;
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path, BASE_URL);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { "x-api-key": this.apiKey } : {};
  }

  private async parse<T>(res: Response, path: string): Promise<T> {
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      throw new JupError(`Jupiter API error`, res.status, body, path);
    }
    return body as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
