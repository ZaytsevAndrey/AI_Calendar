export const API_BASE = (process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

const TOKEN_KEY = 'luefy.admin.token';
const EMAIL_KEY = 'luefy.admin.email';

let memoryToken: string | null = null;

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function getAdminEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function saveSession(token: string, email: string): void {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* private mode: keep it in memory for this tab */
  }
}

export function clearSession(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Listeners run when the server rejects the admin session. */
const sessionListeners = new Set<() => void>();
export function onSessionLost(fn: () => void): () => void {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(0, `Сервер ${API_BASE} не відповідає. Перевірте, що бекенд запущено.`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const raw = data && typeof data === 'object' ? (data as { message?: unknown }).message : undefined;
    const message: string = raw ? (Array.isArray(raw) ? raw.join('; ') : String(raw)) : `HTTP ${res.status}`;
    if ((res.status === 401 || res.status === 403) && path.startsWith('/admin/') && !path.startsWith('/admin/auth/')) {
      clearSession();
      sessionListeners.forEach((fn) => fn());
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/** Query string from an object, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
