import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { prefetchRoute } from 'routeChunks';
import { mainNavItems } from '../mainNav';

const BottomNav: React.FC = () => {
    const location = useLocation();

    return (
        <nav
            className="z-[1200] shrink-0 border-t border-ide-border bg-ide-panel pb-[env(safe-area-inset-bottom)] md:hidden"
            aria-label="Main"
        >
            <div className="grid h-14 grid-cols-5">
                {mainNavItems.map(({ to, label, icon: Icon, match }) => {
                    const active = match(location.pathname);
                    return (
                        <Link
                            key={to}
                            to={to}
                            aria-current={active ? 'page' : undefined}
                            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium leading-none no-underline ${
                                active
                                    ? 'bg-ide-link/15 text-ide-text'
                                    : 'text-ide-muted hover:bg-white/5 hover:text-ide-text'
                            }`}
                            onMouseEnter={() => prefetchRoute(to)}
                            onFocus={() => prefetchRoute(to)}
                        >
                            <Icon className="h-5 w-5 shrink-0" aria-hidden />
                            {label}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
};

export default BottomNav;
