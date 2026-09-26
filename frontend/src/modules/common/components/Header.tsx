import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { prefetchRoute } from 'routeChunks';
import { mainNavItems, mainNavLabel } from '../mainNav';

const linkBase =
    'whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium text-ide-text transition min-h-[44px] inline-flex items-center gap-2';

const Header: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const section = t(mainNavLabel(location.pathname));

    const active = (cond: boolean) =>
        cond ? 'bg-ide-link/15 text-ide-text' : 'hover:bg-white/5';

    return (
        <header className="z-[1200] w-full shrink-0 border-b border-ide-border bg-ide-panel/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
            <div className="flex h-12 w-full items-center px-4 md:h-16 md:justify-between md:px-5 lg:px-8">
                <p className="min-w-0 truncate text-base font-semibold text-ide-text md:hidden" aria-hidden>
                    {section}
                </p>
                <div className="hidden min-w-0 shrink-0 text-lg font-semibold text-ide-text md:block">
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 truncate text-ide-text no-underline hover:text-ide-link"
                    >
                        <CalendarDays className="h-5 w-5 shrink-0 text-ide-link" aria-hidden />
                        {t('nav.brand')}
                    </Link>
                </div>
                <nav className="hidden gap-1 md:flex" aria-label={t('nav.main')}>
                    {mainNavItems.map(({ to, labelKey, icon: Icon, match }) => (
                        <Link
                            key={to}
                            to={to}
                            className={`${linkBase} ${active(match(location.pathname))}`}
                            onMouseEnter={() => prefetchRoute(to)}
                            onFocus={() => prefetchRoute(to)}
                        >
                            <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                            {t(labelKey)}
                        </Link>
                    ))}
                </nav>
            </div>
        </header>
    );
};

export default Header;
