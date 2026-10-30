'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { WaitlistLabels } from '@/lib/content';
import { API_BASE_URL, localePath, type Locale } from '@/lib/site';

type Step = 'form' | 'follow' | 'thanks' | 'listed';
type Phase = 'idle' | 'pending' | 'waking';

/** Remembers in this browser that the visitor is on the list (shows "already on the list"). */
const STORAGE_KEY = 'luefy:waitlist';
const WAKING_AFTER_MS = 3500;
const GIVE_UP_AFTER_MS = 75_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function remember() {
    try {
        localStorage.setItem(STORAGE_KEY, '1');
    } catch {
        /* storage blocked: the form just shows again next time */
    }
}

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<{ status: number; data: T | null }> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, data };
}

export default function WaitlistForm({
    labels,
    locale,
    source,
    tone = 'light',
}: {
    labels: WaitlistLabels;
    locale: Locale;
    /** Which form on the page sent it (hero, final), for our own stats. */
    source: string;
    tone?: 'light' | 'dark';
}) {
    const id = useId();
    const [step, setStep] = useState<Step>('form');
    const [phase, setPhase] = useState<Phase>('idle');
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [calendar, setCalendar] = useState<string | null>(null);
    const [pain, setPain] = useState('');
    const honeypot = useRef<HTMLInputElement>(null);
    const wakingTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        try {
            if (localStorage.getItem(STORAGE_KEY)) setStep('listed');
        } catch {
            /* ignore */
        }
        return () => window.clearTimeout(wakingTimer.current);
    }, []);

    async function run<T>(path: string, body: unknown) {
        setPhase('pending');
        setMessage(null);
        wakingTimer.current = window.setTimeout(() => setPhase('waking'), WAKING_AFTER_MS);
        const controller = new AbortController();
        const abort = window.setTimeout(() => controller.abort(), GIVE_UP_AFTER_MS);
        try {
            return await post<T>(path, body, controller.signal);
        } finally {
            window.clearTimeout(wakingTimer.current);
            window.clearTimeout(abort);
            setPhase('idle');
        }
    }

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (phase !== 'idle') return;
        const value = email.trim();
        if (!EMAIL_RE.test(value)) {
            setMessage(labels.invalid);
            return;
        }
        try {
            const res = await run<{ status?: string; token?: string }>('/waitlist', {
                email: value,
                locale,
                source,
                website: honeypot.current?.value ?? '',
            });
            if (res.status === 400) {
                setMessage(labels.invalid);
                return;
            }
            if (res.status >= 300) throw new Error(`HTTP ${res.status}`);
            remember();
            setToken(res.data?.token ?? null);
            setMessage(res.data?.status === 'exists' ? labels.exists : labels.done);
            setStep('follow');
        } catch (err) {
            console.error('Waitlist request failed:', err);
            setMessage(labels.error);
        }
    }

    async function sendDetails(e: FormEvent) {
        e.preventDefault();
        if (phase !== 'idle') return;
        if (token && (calendar || pain.trim())) {
            // Best effort: the visitor is already on the list, so a failure here is not shown.
            await run('/waitlist/details', { token, calendar, pain: pain.trim() }).catch(() => undefined);
        }
        setMessage(null);
        setStep('thanks');
    }

    const busyText = phase === 'waking' ? labels.waking : labels.pending;

    if (step === 'listed' || step === 'thanks') {
        return (
            <div className={`waitlist waitlist-${tone}`}>
                <p className="waitlist-done" role="status">
                    <CheckIcon />
                    <span>{step === 'thanks' ? labels.thanks : labels.exists}</span>
                </p>
            </div>
        );
    }

    if (step === 'follow') {
        return (
            <form className={`waitlist waitlist-${tone} waitlist-follow`} onSubmit={sendDetails}>
                <p className="waitlist-done" role="status">
                    <CheckIcon />
                    <span>{message}</span>
                </p>
                <p className="waitlist-intro">{labels.followIntro}</p>
                <fieldset className="waitlist-field">
                    <legend>{labels.calendarLabel}</legend>
                    <div className="chips">
                        {labels.calendars.map((c) => (
                            <label key={c.value} className="chip">
                                <input
                                    type="radio"
                                    name={`${id}-calendar`}
                                    value={c.value}
                                    checked={calendar === c.value}
                                    onChange={() => setCalendar(c.value)}
                                />
                                <span>{c.label}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <div className="waitlist-field">
                    <label htmlFor={`${id}-pain`}>{labels.painLabel}</label>
                    <textarea
                        id={`${id}-pain`}
                        rows={2}
                        maxLength={500}
                        placeholder={labels.painPlaceholder}
                        value={pain}
                        onChange={(e) => setPain(e.target.value)}
                    />
                </div>
                <div className="waitlist-actions">
                    <button type="submit" className="btn btn-primary" disabled={phase !== 'idle'}>
                        {phase === 'idle' ? labels.send : busyText}
                    </button>
                    <button type="button" className="link-btn" onClick={() => setStep('thanks')}>
                        {labels.skip}
                    </button>
                </div>
            </form>
        );
    }

    return (
        <form className={`waitlist waitlist-${tone}`} onSubmit={submit} noValidate>
            <label htmlFor={`${id}-email`} className="sr-only">
                {labels.emailLabel}
            </label>
            <div className="waitlist-row">
                <input
                    id={`${id}-email`}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    placeholder={labels.placeholder}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={message === labels.invalid}
                    aria-describedby={`${id}-msg`}
                />
                <button type="submit" className="btn btn-primary" disabled={phase !== 'idle'} aria-busy={phase !== 'idle'}>
                    {phase === 'idle' ? labels.submit : labels.pending}
                </button>
            </div>
            {/* Bots fill every field; people never see this one. */}
            <input
                ref={honeypot}
                className="hp"
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
            />
            <p id={`${id}-msg`} className={message ? 'waitlist-msg waitlist-error' : 'waitlist-msg'} role="status" aria-live="polite">
                {message ?? (phase === 'waking' ? labels.waking : '')}
            </p>
            <p className="waitlist-note">
                {labels.note} <a href={localePath(locale, '/privacy/')}>{labels.privacyLink}</a>
            </p>
        </form>
    );
}

function CheckIcon() {
    return (
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className="check-icon">
            <circle cx="10" cy="10" r="10" fill="currentColor" opacity="0.15" />
            <path d="M5.5 10.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
