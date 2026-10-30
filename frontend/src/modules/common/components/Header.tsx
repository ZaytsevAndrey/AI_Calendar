import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { prefetchRoute } from 'routeChunks';
import { mainNavItems, mainNavLabel } from '../mainNav';

const linkBase =
    'whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium text-ide-text transition min-h-[44px] inline-flex items-center gap-2';

const Header: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const section = t(mainNavLabel(location.pathname));

    const active = (cond: boolean) =>
        cond ? 'bg-ide-link/15 text-ide-text' : 'hover:bg-ide-text/5';

    return (
        <header className="z-[1200] w-full shrink-0 border-b border-ide-border bg-ide-panel/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
            <div className="flex h-12 w-full items-center px-4 md:h-16 md:justify-between md:px-5 lg:px-8">
                <p className="flex min-w-0 items-center gap-2 text-base font-medium text-ide-text md:hidden" aria-hidden>
                    <img src="/icon-64.png" alt="" className="h-6 w-6 shrink-0 rounded-md" />
                    <span className="truncate leading-none">{section}</span>
                </p>
                <div className="hidden min-w-0 shrink-0 md:block">
                    <Link
                        to="/calendar"
                        className="group inline-flex items-center gap-2 no-underline hover:no-underline"
                    >
                        <img src="/icon-64.png" alt="" className="h-8 w-8 shrink-0 rounded-[9px]" />
                        <span className="text-lg font-semibold leading-none text-ide-link group-hover:text-ide-text">
                            {t('nav.brand')}
                        </span>
                    </Link>
                </div>
                <div className="ml-auto flex items-center gap-1 md:ml-0">
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
            </div>
        </header>
    );
};

export default Header;
