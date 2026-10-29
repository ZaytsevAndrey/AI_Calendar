/**
 * Sign-in providers the landing offers. Each one starts the same way on the API:
 * GET {API}{startPath} → { url } → browser goes to the provider → API callback →
 * React app /auth/{id}/callback?ticket=… (stores the JWT).
 *
 * Adding a provider: add an entry here (and its mark in ProviderMark.tsx), then list its id in
 * NEXT_PUBLIC_AUTH_PROVIDERS. At runtime the landing hides providers that
 * GET /auth/providers/status reports as not configured on the server.
 */
export const PROVIDERS = {
    google: { name: 'Google', startPath: '/auth/google' },
    microsoft: { name: 'Microsoft', startPath: '/auth/microsoft' },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

function isProviderId(value: string): value is ProviderId {
    return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

/** Providers rendered into the static HTML, in this order. The first one is the primary button. */
export const ENABLED_PROVIDERS: ProviderId[] = (() => {
    const raw = process.env.NEXT_PUBLIC_AUTH_PROVIDERS || 'google,microsoft';
    const ids = raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(isProviderId);
    return ids.length ? Array.from(new Set(ids)) : ['google'];
})();
