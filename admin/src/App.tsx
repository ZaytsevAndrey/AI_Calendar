import React, { useEffect, useState } from 'react';
import { clearSession, getAdminLogin, getToken, onSessionLost } from './api';
import { Link, match, useRouter } from './router';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { UsersPage } from './pages/Users';
import { UserPage } from './pages/User';
import { VoicePage } from './pages/Voice';
import { TurnsPage, TurnPage } from './pages/Turns';
import { SystemPage } from './pages/System';
import { ErrorsPage } from './pages/Errors';

const NAV = [
  { to: '/', label: 'Огляд', test: (p: string) => p === '/' },
  { to: '/users', label: 'Користувачі', test: (p: string) => p.startsWith('/users') },
  { to: '/voice', label: 'Голос', test: (p: string) => p === '/voice' },
  { to: '/turns', label: 'Журнал голосу', test: (p: string) => p.startsWith('/turns') },
  { to: '/system', label: 'Система', test: (p: string) => p.startsWith('/system') },
  { to: '/errors', label: 'Помилки API', test: (p: string) => p.startsWith('/errors') },
];

export function App() {
  const { location, navigate } = useRouter();
  const [signedIn, setSignedIn] = useState(Boolean(getToken()));

  useEffect(
    () =>
      onSessionLost(() => {
        setSignedIn(false);
        navigate('/login?error=session', true);
      }),
    [navigate],
  );

  const path = location.path;
  if (path === '/login' || !signedIn) return <LoginPage onSignedIn={() => setSignedIn(true)} />;

  let page: React.ReactNode;
  let params: Record<string, string> | null;
  if (path === '/') page = <OverviewPage />;
  else if (path === '/users') page = <UsersPage />;
  else if ((params = match('/users/:id', path))) page = <UserPage id={params.id} />;
  else if (path === '/voice') page = <VoicePage />;
  else if (path === '/turns') page = <TurnsPage />;
  else if ((params = match('/turns/:id', path))) page = <TurnPage id={params.id} />;
  else if (path === '/system') page = <SystemPage />;
  else if (path === '/errors') page = <ErrorsPage />;
  else
    page = (
      <div className="py-16 text-muted">
        Такої сторінки немає. <Link to="/" className="text-accent underline">Повернутися до огляду</Link>
      </div>
    );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[13.5rem_1fr]">
      <aside className="border-b border-line bg-panel md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-4 py-4 md:px-5 md:py-6">
          <span className="phase-rail h-8 w-1.5 rounded-full" aria-hidden />
          <div className="leading-tight">
            <div className="text-[1.05rem] font-semibold">Luefy</div>
            <div className="text-xs text-muted">Адмін-консоль</div>
          </div>
        </div>
        <nav aria-label="Розділи" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
          {NAV.map((item) => {
            const active = item.test(path);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                  active ? 'bg-sunk font-semibold text-ink' : 'text-muted hover:bg-sunk/60 hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden px-5 py-6 text-xs text-muted md:absolute md:bottom-0 md:block">
          <div className="truncate" title={getAdminLogin() ?? ''}>
            {getAdminLogin()}
          </div>
          <button
            type="button"
            className="mt-1 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => {
              clearSession();
              setSignedIn(false);
              navigate('/login', true);
            }}
          >
            Вийти
          </button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-[1180px] px-4 py-6 md:px-8 md:py-8">{page}</main>
    </div>
  );
}
