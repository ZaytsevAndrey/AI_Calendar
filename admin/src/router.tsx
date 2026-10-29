import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/** A small history router: the admin app has a handful of flat routes. */
type Location = { path: string; search: URLSearchParams };

const RouterContext = createContext<{ location: Location; navigate: (to: string, replace?: boolean) => void }>({
  location: { path: '/', search: new URLSearchParams() },
  navigate: () => undefined,
});

function read(): Location {
  return { path: window.location.pathname || '/', search: new URLSearchParams(window.location.search) };
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<Location>(read);
  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, replace = false) => {
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLocation(read());
    window.scrollTo(0, 0);
  }, []);
  return <RouterContext.Provider value={{ location, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  return useContext(RouterContext);
}

/** Match `/users/:id` style patterns. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

export function Link({
  to,
  className,
  children,
  ...rest
}: { to: string; className?: string; children: React.ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
