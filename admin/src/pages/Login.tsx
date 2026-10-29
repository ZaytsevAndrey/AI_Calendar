import React, { useState } from 'react';
import { API_BASE, api, saveSession } from '../api';
import { useRouter } from '../router';
import { Button } from '../ui';

const NOTICES: Record<string, string> = {
  session: 'Сесія адмінки закінчилась або акаунт вимкнено. Увійдіть ще раз.',
};

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { location, navigate } = useRouter();
  const notice = location.search.get('error');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ? NOTICES[notice] ?? null : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ access_token: string; login: string }>('/admin/auth/login', {
        method: 'POST',
        json: { login, password },
      });
      saveSession(s.access_token, s.login);
      setPassword('');
      onSignedIn();
      navigate('/', true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

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
        <form onSubmit={submit} className="space-y-4">
          <h1 className="text-lg font-semibold">Вхід</h1>
          {error ? <p className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p> : null}
          <div>
            <label htmlFor="login" className="mb-1 block text-sm font-medium">
              Логін
            </label>
            <input
              id="login"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" tone="primary" className="w-full py-2" disabled={busy}>
            {busy ? 'Входимо…' : 'Увійти'}
          </Button>
        </form>
        <p className="mt-8 text-xs text-muted">Admin API: {API_BASE}</p>
      </div>
    </div>
  );
}
