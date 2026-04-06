export function getApiBaseUrl(): string {
    const envBaseUrl = process.env.API_BASE_URL;

    if (process.env.NODE_ENV === 'development') {
        const stored = localStorage.getItem('API_BASE_URL');
        if (stored) return stored;
    }

    return envBaseUrl || '';
}
