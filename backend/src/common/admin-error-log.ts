import { redactSecrets } from './voice-file-logger';

/** One API error as the admin console sees it. Path only: no query, body or headers. */
export type AdminErrorEntry = {
  at: string;
  method: string;
  path: string;
  status: number;
  code: string | null;
  message: string;
  userId: string | null;
};

const CAPACITY = 500;
const entries: AdminErrorEntry[] = [];
const startedAt = new Date().toISOString();

function clip(value: string, max: number): string {
  const clean = redactSecrets(value).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
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

/** Keep the latest errors since this process started. In memory, lost on restart. */
export function recordAdminError(input: {
  method?: string;
  url?: string;
  status: number;
  code?: string | null;
  message: unknown;
  userId?: unknown;
  at?: Date;
}): void {
  entries.push({
    at: (input.at ?? new Date()).toISOString(),
    method: String(input.method || '').slice(0, 10),
    path: clip(String(input.url || '').split('?')[0], 200),
    status: input.status,
    code: input.code ? clip(String(input.code), 80) : null,
    message: clip(messageText(input.message), 300),
    userId: typeof input.userId === 'string' ? input.userId : null,
  });
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY);
}

/** Newest first. */
export function listAdminErrors(filter: { minStatus?: number; limit?: number } = {}): {
  since: string;
  capacity: number;
  items: AdminErrorEntry[];
} {
  const minStatus = filter.minStatus ?? 0;
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), CAPACITY);
  const items: AdminErrorEntry[] = [];
  for (let i = entries.length - 1; i >= 0 && items.length < limit; i -= 1) {
    if (entries[i].status >= minStatus) items.push(entries[i]);
  }
  return { since: startedAt, capacity: CAPACITY, items };
}

/** Counts by status class in the last `windowMs`. */
export function countAdminErrors(windowMs: number, now = Date.now()): {
  server: number;
  client: number;
} {
  let server = 0;
  let client = 0;
  for (const e of entries) {
    if (now - Date.parse(e.at) > windowMs) continue;
    if (e.status >= 500) server += 1;
    else if (e.status >= 400) client += 1;
  }
  return { server, client };
}

/** Tests only. */
export function clearAdminErrors(): void {
  entries.length = 0;
}
