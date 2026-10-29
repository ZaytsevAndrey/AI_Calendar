import { redactSecrets } from './voice-file-logger';

/** One API error, cleaned for storage. Path only: no query, body or headers. */
export type ApiErrorEntry = {
  method: string;
  path: string;
  status: number;
  code: string | null;
  message: string;
  userId: string | null;
};

type Sink = (entry: ApiErrorEntry) => void | Promise<void>;

let sink: Sink | null = null;

/** main.ts wires this to the api_error_logs writer. Tests and scripts leave it unset. */
export function setApiErrorSink(next: Sink | null): void {
  sink = next;
}

/** 401 is expired-session noise and 404 is mostly probing; neither helps the owner. */
const SKIP_STATUS = new Set([401, 404]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clip(value: string, max: number): string {
  const clean = redactSecrets(value).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function messageText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

export function toApiErrorEntry(input: {
  method?: string;
  url?: string;
  status: number;
  code?: string | null;
  message: unknown;
  userId?: unknown;
}): ApiErrorEntry {
  return {
    method: String(input.method || '').slice(0, 10),
    path: clip(String(input.url || '').split('?')[0], 200),
    status: input.status,
    code: input.code ? clip(String(input.code), 80) : null,
    message: clip(messageText(input.message), 300),
    userId: typeof input.userId === 'string' && UUID_RE.test(input.userId) ? input.userId : null,
  };
}

/** Called from the global exception filter. Never throws and never waits. */
export function reportApiError(input: Parameters<typeof toApiErrorEntry>[0]): void {
  if (!sink || input.status < 400 || SKIP_STATUS.has(input.status)) return;
  try {
    void Promise.resolve(sink(toApiErrorEntry(input))).catch(() => undefined);
  } catch {
    /* a broken sink must not break the error response */
  }
}
