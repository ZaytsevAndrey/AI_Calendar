import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    CalendarDays,
    CalendarClock,
    ListTodo,
    Layers,
    Settings,
} from 'lucide-react';
import { ScheduleApi } from 'api/schedule.api';

const linkBase =
    'whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium text-ide-text transition min-h-[44px] inline-flex items-center gap-2';

const navItems = [
    { to: '/calendar', label: 'Calendar', icon: CalendarDays, match: (path: string) => path === '/calendar' },
    { to: '/events', label: 'Events', icon: ListTodo, match: (path: string) => path === '/events' },
    { to: '/schedule', label: 'Schedule', icon: CalendarClock, match: (path: string) => path === '/schedule' },
    { to: '/phases', label: 'Phases', icon: Layers, match: (path: string) => path === '/phases' },
    { to: '/settings', label: 'Settings', icon: Settings, match: (path: string) => path === '/settings' },
] as const;

const Header: React.FC = () => {
    const location = useLocation();
    const [issueCount, setIssueCount] = useState(0);

    const active = (cond: boolean) =>
        cond ? 'bg-ide-link/15 text-ide-text' : 'hover:bg-white/5';

    useEffect(() => {
        ScheduleApi.getLatestAlerts()
            .then((alerts) => setIssueCount(alerts.issueCount))
            .catch(() => setIssueCount(0));
    }, [location.pathname]);

    return (
        <header className="fixed top-0 z-[1200] w-full border-b border-ide-border bg-ide-panel/95 backdrop-blur-sm">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 lg:px-8">
                <div className="min-w-0 shrink-0 text-base font-semibold text-ide-text sm:text-lg">
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 truncate text-ide-text no-underline hover:text-ide-link"
                    >
                        <CalendarDays className="h-5 w-5 shrink-0 text-ide-link" aria-hidden />
                        AI Calendar
                    </Link>
                </div>
                <nav
                    className="-mx-1 flex gap-1 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:pb-0"
                    aria-label="Main"
                >
                    {navItems.map(({ to, label, icon: Icon, match }) => (
                        <Link
                            key={to}
                            to={to}
                            className={`${linkBase} ${active(match(location.pathname))}`}
                        >
                            <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                            {label}
                            {to === '/schedule' && issueCount > 0 ? (
                                <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-ide-error px-1.5 text-xs text-white">
                                    {issueCount > 99 ? '99+' : issueCount}
                                </span>
                            ) : null}
                        </Link>
                    ))}
                </nav>
            </div>
        </header>
    );
};

export default Header;
