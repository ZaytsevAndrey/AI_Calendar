/** Admin API settings. Separate from the client API's env on purpose. */

export const ADMIN_SECRET_MIN_LENGTH = 32;
export const ADMIN_TOKEN_TTL = '12h';

/** Signing key for admin tokens. Must differ from the client JWT_SECRET. */
export function adminJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = (env.ADMIN_JWT_SECRET || '').trim();
  if (secret.length < ADMIN_SECRET_MIN_LENGTH) {
    throw new Error(`ADMIN_JWT_SECRET must be set and at least ${ADMIN_SECRET_MIN_LENGTH} characters`);
  }
  if (secret === (env.JWT_SECRET || '').trim()) {
    throw new Error('ADMIN_JWT_SECRET must not equal the client JWT_SECRET');
  }
  return secret;
}

/** The admin web app origin, the only origin CORS lets in. */
export function adminAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.ADMIN_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  return env.NODE_ENV === 'production' ? '' : 'http://localhost:3002';
}

/** Base URL of the client API, for /internal calls. */
export function clientApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.CLIENT_API_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  return env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';
}

export function adminApiPort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.ADMIN_API_PORT || env.PORT || 3005);
}

/** Same default as the client's VoiceQuotaService, used when the client cannot be asked. */
export const DEFAULT_VOICE_DAILY_TOKEN_LIMIT = 100_000;

export function parseTokenLimit(raw: unknown): number {
  if (raw === null || raw === undefined || String(raw).trim() === '') return DEFAULT_VOICE_DAILY_TOKEN_LIMIT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_VOICE_DAILY_TOKEN_LIMIT;
  return Math.floor(value);
}
