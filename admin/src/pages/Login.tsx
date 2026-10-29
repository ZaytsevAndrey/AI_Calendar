import React, { useEffect, useRef, useState } from 'react';
import { API_BASE, api, saveSession } from '../api';
import { useRouter } from '../router';
import { Button } from '../ui';

const ERRORS: Record<string, string> = {
  not_admin: 'Цей Google-акаунт не має доступу до адмінки. Додайте його email у ADMIN_EMAILS на бекенді.',
  no_account: 'У Luefy немає акаунта з цим email. Спершу увійдіть у сам застосунок.',
  session: 'Сесія адмінки закінчилась або доступ відкликано. Увійдіть ще раз.',
  access_denied: 'Вхід через Google скасовано.',
};

type Session = { access_token: string; email: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="phase-rail h-10 w-1.5 rounded-full" aria-hidden />
          <div className="leading-tight">
            <div className="text-xl font-semibold">Luefy</div>
            <div className="text-sm text-muted">Адмін-консоль</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { location } = useRouter();
  const errorKey = location.search.get('error');
  const [devLogin, setDevLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(errorKey ? ERRORS[errorKey] ?? errorKey : null);

  useEffect(() => {
    api<{ devLogin: boolean }>('/admin/auth/options')
      .then((o) => setDevLogin(o.devLogin))
      .catch(() => undefined);
  }, []);

  async function google() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/auth/google?target=admin');
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function dev(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api<Session>('/admin/auth/dev', { method: 'POST', json: { email } });
      saveSession(s.access_token, s.email);
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold">Вхід для власника</h1>
      <p className="mt-1 text-sm text-muted">Пустить лише акаунти з ADMIN_EMAILS. Ваша сесія в самому Luefy не зміниться.</p>
      {error ? <p className="mt-4 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p> : null}
      <Button tone="primary" className="mt-5 w-full py-2" onClick={google} disabled={busy}>
        Увійти через Google
      </Button>
      {devLogin ? (
        <form onSubmit={dev} className="mt-6 border-t border-line pt-5">
          <label htmlFor="dev-email" className="text-sm font-medium">
            Локальний вхід без Google
          </label>
          <p className="mb-2 text-xs text-muted">Працює лише з ADMIN_DEV_LOGIN=1 і не в продакшні.</p>
          <div className="flex gap-2">
            <input
              id="dev-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@example.com"
              className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-1.5 text-sm"
            />
            <Button type="submit" disabled={busy}>
              Увійти
            </Button>
          </div>
        </form>
      ) : null}
      <p className="mt-8 text-xs text-muted">API: {API_BASE}</p>
    </Shell>
  );
}

export function AuthCallbackPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { location, navigate } = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; a ticket works once.
    started.current = true;
    const ticket = location.search.get('ticket');
    if (!ticket) {
      setError('У посиланні немає квитка входу.');
      return;
    }
    api<Session>('/admin/auth/session', { method: 'POST', json: { ticket } })
      .then((s) => {
        saveSession(s.access_token, s.email);
        onSignedIn();
        navigate('/', true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [location.search, navigate, onSignedIn]);

  return (
    <Shell>
      {error ? (
        <>
          <p className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p>
          <Button className="mt-4" onClick={() => navigate('/login', true)}>
            На сторінку входу
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted">Завершуємо вхід…</p>
      )}
    </Shell>
  );
}
