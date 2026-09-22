import axios from 'api/axios';

import { refreshToken } from 'modules/auth/actions/refreshToken';
import { clientLogout } from 'modules/auth/actions/logoutActions';

let refreshInFlight: Promise<void> | null = null;

type AppStore = {
    dispatch: (action: unknown) => Promise<unknown> | unknown;
};

function loadStore(): Promise<AppStore> {
    // Imported on use so API slices can register on the store without a startup cycle.
    return import('store').then((mod) => mod.store as AppStore);
}

function isAuthBootstrapRequest(url: string): boolean {
    return (
        url.includes('/auth/login') ||
        url.includes('/auth/register') ||
        url.includes('/auth/refresh') ||
        url.includes('/auth/google')
    );
}

async function ensureFreshSession(): Promise<void> {
    if (!refreshInFlight) {
        refreshInFlight = loadStore()
            .then((store) => store.dispatch(refreshToken()))
            .then(() => undefined)
            .finally(() => {
                refreshInFlight = null;
            });
    }
    await refreshInFlight;
}

export default async function apiCall(config: any) {
    try {
        return await axios(config);
    } catch (error: any) {
        const requestUrl = String(error?.config?.url ?? config?.url ?? '');
        const status = error?.response?.status ?? error?.response?.data?.statusCode;
        const alreadyRetried = Boolean(config?._authRetry);

        if (!isAuthBootstrapRequest(requestUrl) && status === 401 && !alreadyRetried) {
            try {
                await ensureFreshSession();
                const nextConfig = {
                    ...config,
                    _authRetry: true,
                    headers: {
                        ...(config.headers || {}),
                        Authorization: `Bearer ${localStorage.getItem('access_token') || ''}`,
                    },
                };
                return await axios(nextConfig);
            } catch {
                const store = await loadStore();
                store.dispatch(clientLogout(true));
                throw error;
            }
        }

        throw error;
    }
}
