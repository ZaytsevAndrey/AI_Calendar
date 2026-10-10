import { REFRESH_TOKEN_ASYNC } from './actions/actionTypes';

/** Axios instance (typed loosely — project ships mixed axios typings). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HttpClient = any;

type AuthRetryConfig = Record<string, unknown> & {
  url?: string;
  headers?: Record<string, unknown>;
  _authRetry?: boolean;
};

type AppStore = {
  dispatch: (action: unknown) => unknown;
};

let refreshInFlight: Promise<void> | null = null;
let client: HttpClient | null = null;

export function bindSessionRefreshClient(instance: HttpClient): void {
  client = instance;
}

function isAuthBootstrapRequest(url: string): boolean {
  return (
    url.includes('/auth/login') ||
    url.includes('/auth/register') ||
    url.includes('/auth/refresh') ||
    url.includes('/auth/google')
  );
}

function loadStore(): Promise<AppStore> {
  return import('store').then((mod) => mod.store as AppStore);
}

/**
 * Single-flight access-token refresh. Updates localStorage + auth slice.
 * Used by the axios 401 interceptor so every caller (apiCall and raw axios) refreshes.
 */
export async function ensureFreshSession(): Promise<void> {
  if (!client) {
    throw new Error('Auth HTTP client is not bound');
  }
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refresh_token = localStorage.getItem('refresh_token');
      if (!refresh_token) {
        throw new Error('Missing refresh token');
      }
      const store = await loadStore();
      store.dispatch({ type: REFRESH_TOKEN_ASYNC.pending });
      try {
        const response = await client!.post(
          '/auth/refresh',
          { refresh_token },
          { _authRetry: true },
        );
        const data = response.data as {
          access_token: string;
          refresh_token: string;
        };
        if (!data?.access_token || !data?.refresh_token) {
          throw new Error('No tokens in refresh response');
        }
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        store.dispatch({
          type: REFRESH_TOKEN_ASYNC.success,
          payload: {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
          },
        });
      } catch (error) {
        store.dispatch({
          type: REFRESH_TOKEN_ASYNC.failure,
          payload: 'Failed to refresh token.',
        });
        throw error;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  await refreshInFlight;
}

/** @returns retried Axios response, or null to reject the original error */
export async function retryAfterUnauthorized(error: {
  config?: AuthRetryConfig;
  response?: { status?: number; data?: { statusCode?: number } };
}): Promise<unknown | null> {
  const config = error.config;
  if (!config || !client) return null;

  const requestUrl = String(config.url ?? '');
  const status = error.response?.status ?? error.response?.data?.statusCode;
  if (status !== 401 || config._authRetry || isAuthBootstrapRequest(requestUrl)) {
    return null;
  }

  try {
    await ensureFreshSession();
  } catch {
    const store = await loadStore();
    const { clientLogout } = await import('./actions/logoutActions');
    store.dispatch(clientLogout(true));
    return null;
  }

  const nextConfig: AuthRetryConfig = {
    ...config,
    _authRetry: true,
    headers: {
      ...(config.headers || {}),
      Authorization: `Bearer ${localStorage.getItem('access_token') || ''}`,
    },
  };
  return client(nextConfig);
}
