import axios from 'api/axios';
import { store } from 'store';

import { refreshToken } from 'modules/auth/actions/refreshToken';
import { clientLogout } from 'modules/auth/actions/logoutActions';

let refreshInFlight: Promise<void> | null = null;

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
        refreshInFlight = store
            .dispatch<any>(refreshToken())
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
                store.dispatch<any>(clientLogout(true));
                throw error;
            }
        }

        throw error;
    }
}
