const DEFAULT_API = process.env.REACT_APP_API_URL;

export function getApiUrl(): string {
    const localOverride = localStorage.getItem('custom_api_url');

    if (process.env.NODE_ENV === 'development' && localOverride) {
        return localOverride;
    }

    return DEFAULT_API || '';
}
