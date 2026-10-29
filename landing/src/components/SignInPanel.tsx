'use client';

import { useEffect, useRef, useState } from 'react';
import { ENABLED_PROVIDERS, PROVIDERS, type ProviderId } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/site';
import ProviderMark from './ProviderMark';

export interface SignInLabels {
    /** "Continue with {provider}" */
    with: string;
    pending: string;
    waking: string;
    error: string;
    unavailable: string;
    failedRedirect: string;
}

type Phase = 'idle' | 'pending' | 'waking';

/** The free API instance sleeps when idle; a cold start can take ~1 minute. */
const WAKING_AFTER_MS = 3500;
const GIVE_UP_AFTER_MS = 75_000;

type Status = Partial<Record<ProviderId, boolean>>;
let statusPromise: Promise<Status | null> | null = null;

/**
 * One request that both wakes the API and says which providers the server has credentials for.
 * Shared by every panel on the page.
 */
function loadStatus(): Promise<Status | null> {
    statusPromise ??= fetch(`${API_BASE_URL}/auth/providers/status`, { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
        .catch(() => null);
    return statusPromise;
}

const fill = (s: string, provider: ProviderId) => s.replace('{provider}', PROVIDERS[provider].name);

export default function SignInPanel({ labels, tone = 'light' }: { labels: SignInLabels; tone?: 'light' | 'dark' }) {
    const [providers, setProviders] = useState<ProviderId[]>(ENABLED_PROVIDERS);
    const [active, setActive] = useState<ProviderId | null>(null);
    const [phase, setPhase] = useState<Phase>('idle');
    const [message, setMessage] = useState<string | null>(null);
    const wakingTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        // The app sends visitors back here with ?signin=failed when a provider round-trip fails.
        const params = new URLSearchParams(window.location.search);
        if (params.has('signin') || params.has('error')) setMessage(labels.failedRedirect);

        let alive = true;
        const run = () =>
            loadStatus().then((status) => {
                if (!alive || !status) return;
                // Hide only what the server explicitly reports as off; keep the static order.
                const visible = ENABLED_PROVIDERS.filter((id) => status[id] !== false);
                if (visible.length) setProviders(visible);
            });
        const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
        if (w.requestIdleCallback) w.requestIdleCallback(run);
        else window.setTimeout(run, 1200);
        return () => {
            alive = false;
            window.clearTimeout(wakingTimer.current);
        };
    }, [labels.failedRedirect]);

    async function start(provider: ProviderId) {
        if (phase !== 'idle') return;
        setActive(provider);
        setPhase('pending');
        setMessage(null);
        wakingTimer.current = window.setTimeout(() => setPhase('waking'), WAKING_AFTER_MS);
        const controller = new AbortController();
        const abortTimer = window.setTimeout(() => controller.abort(), GIVE_UP_AFTER_MS);
        try {
            const res = await fetch(`${API_BASE_URL}${PROVIDERS[provider].startPath}`, {
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            });
            if (res.status === 503) {
                setMessage(fill(labels.unavailable, provider));
                setProviders((list) => (list.length > 1 ? list.filter((id) => id !== provider) : list));
                setPhase('idle');
                setActive(null);
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as { url?: string };
            if (!data.url) throw new Error('Missing authorization URL');
            window.location.assign(data.url);
        } catch (err) {
            console.error(`${provider} sign-in start failed:`, err);
            setMessage(labels.error);
            setPhase('idle');
            setActive(null);
        } finally {
            window.clearTimeout(wakingTimer.current);
            window.clearTimeout(abortTimer);
        }
    }

    return (
        <div className={`signin signin-${tone}`}>
            <div className="signin-buttons">
                {providers.map((id, i) => {
                    const busy = active === id && phase !== 'idle';
                    const text = busy ? (phase === 'waking' ? labels.waking : labels.pending) : fill(labels.with, id);
                    return (
                        <button
                            key={id}
                            type="button"
                            className={i === 0 ? 'btn btn-primary' : 'btn btn-quiet'}
                            onClick={() => start(id)}
                            onPointerEnter={() => void loadStatus()}
                            onFocus={() => void loadStatus()}
                            aria-busy={busy}
                            disabled={phase !== 'idle'}
                        >
                            <ProviderMark provider={id} />
                            <span>{text}</span>
                        </button>
                    );
                })}
            </div>
            <p className="signin-msg" role="status" aria-live="polite">
                {message ?? ''}
            </p>
        </div>
    );
}
