import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { clientLogout } from 'modules/auth/actions/logoutActions';

const linkBase =
    'whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium text-ide-text transition min-h-[44px] inline-flex items-center';

const Header: React.FC = () => {
    const dispatch = useDispatch();
    const location = useLocation();

    const active = (cond: boolean) =>
        cond ? 'bg-ide-link/15 text-ide-text' : 'hover:bg-white/5';

    const handleLogout = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dispatch(clientLogout(true) as any);
    };

    return (
        <header className="fixed top-0 z-[1200] w-full border-b border-ide-border bg-ide-panel/95 backdrop-blur-sm">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 lg:px-8">
                <div className="min-w-0 shrink-0 text-base font-semibold text-ide-text sm:text-lg">
                    <Link to="/" className="truncate text-ide-text no-underline hover:text-ide-link">
                        AI Calendar
                    </Link>
                </div>
                <nav
                    className="-mx-1 flex gap-1 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:pb-0"
                    aria-label="Main"
                >
                    <Link
                        to="/calendar"
                        className={`${linkBase} ${active(
                            location.pathname === '/calendar' &&
                                !location.search.includes('tab=events')
                        )}`}
                    >
                        Calendar
                    </Link>
                    <Link
                        to="/events"
                        className={`${linkBase} ${active(location.pathname === '/events')}`}
                    >
                        Events
                    </Link>
                    <Link
                        to="/phases"
                        className={`${linkBase} ${active(location.pathname === '/phases')}`}
                    >
                        Phases
                    </Link>
                    <Link
                        to="/settings"
                        className={`${linkBase} ${active(location.pathname === '/settings')}`}
                    >
                        Settings
                    </Link>
                    <button
                        type="button"
                        onClick={handleLogout}
                        className={`${linkBase} text-ide-muted hover:text-ide-text`}
                    >
                        Logout
                    </button>
                </nav>
            </div>
        </header>
    );
};

export default Header;
