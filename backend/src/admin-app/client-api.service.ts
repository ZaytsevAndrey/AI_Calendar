import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { clientApiUrl, parseTokenLimit } from './admin-config';

export type ClientStatus = {
  nodeEnv: string;
  node: string;
  commit: string | null;
  startedAt: string;
  uptimeSec: number;
  memoryMb: { rss: number; heapUsed: number; heapTotal: number };
  voiceDailyTokenLimit: string | null;
  integrations: Array<{ key: string; label: string; group: string; configured: boolean; detail?: string }>;
};

const TIMEOUT_MS = 8000;
const STATUS_CACHE_MS = 30_000;

/**
 * Calls the client API's /internal routes with INTERNAL_API_TOKEN.
 * The admin API never imports client modules; anything that must run in the
 * client process (Google cleanup on delete, its caches, its env) goes through here.
 */
@Injectable()
export class ClientApiService {
  private readonly logger = new Logger(ClientApiService.name);
  private statusCache: { at: number; value: ClientStatus } | null = null;

  private config(): { base: string; token: string } | null {
    const base = clientApiUrl();
    const token = (process.env.INTERNAL_API_TOKEN || '').trim();
    return base && token ? { base, token } : null;
  }

  configured(): boolean {
    return this.config() !== null;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const cfg = this.config();
    if (!cfg) throw new ServiceUnavailableException('CLIENT_API_URL and INTERNAL_API_TOKEN are not set');
    let res: Response;
    try {
      res = await fetch(`${cfg.base}${path}`, {
        method,
        headers: {
          'x-internal-token': cfg.token,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(`Client API unreachable: ${msg}`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const message =
        data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : `HTTP ${res.status}`;
      throw new BadGatewayException(`Client API: ${message}`);
    }
    return data as T;
  }

  /** Cached for 30 s; null when the client is not configured or not reachable. */
  async status(force = false): Promise<{ ok: true; value: ClientStatus; latencyMs: number } | { ok: false; error: string }> {
    if (!this.configured()) return { ok: false, error: 'CLIENT_API_URL / INTERNAL_API_TOKEN not set' };
    if (!force && this.statusCache && Date.now() - this.statusCache.at < STATUS_CACHE_MS) {
      return { ok: true, value: this.statusCache.value, latencyMs: 0 };
    }
    const started = Date.now();
    try {
      const value = await this.call<ClientStatus>('GET', '/internal/status');
      this.statusCache = { at: Date.now(), value };
      return { ok: true, value, latencyMs: Date.now() - started };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The client's VOICE_DAILY_TOKEN_LIMIT, or the shared default. */
  async voiceDailyLimit(): Promise<number> {
    const s = await this.status();
    return parseTokenLimit(s.ok ? s.value.voiceDailyTokenLimit : process.env.VOICE_DAILY_TOKEN_LIMIT);
  }

  /** Best effort: without it a block applies within the client's 30 s cache. */
  async refreshAccess(userId: string): Promise<boolean> {
    try {
      await this.call('POST', `/internal/users/${encodeURIComponent(userId)}/refresh-access`);
      return true;
    } catch (err: unknown) {
      this.logger.warn(`refresh-access failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  deleteUser(userId: string, confirmation: string): Promise<{ ok: true }> {
    return this.call('POST', `/internal/users/${encodeURIComponent(userId)}/delete`, { confirmation });
  }
}
