import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScheduleApi } from 'api/schedule.api';

const HomePage: React.FC = () => {
    const [latestWarnings, setLatestWarnings] = useState<string[]>([]);
    const [latestErrors, setLatestErrors] = useState<string[]>([]);

    useEffect(() => {
        ScheduleApi.getLatestAlerts()
            .then((alerts) => {
                setLatestWarnings(alerts.warnings);
                setLatestErrors(alerts.errors);
            })
            .catch(() => {
                setLatestWarnings([]);
                setLatestErrors([]);
            });
    }, []);

    const links = [
        { to: '/calendar', label: 'Calendar' },
        { to: '/events', label: 'Events' },
        { to: '/schedule', label: 'Schedule' },
        { to: '/phases', label: 'Phases' },
        { to: '/settings', label: 'Settings' },
    ];

    return (
        <div className="page-shell">
            <h1 className="page-title">Home</h1>
            <p className="page-lead mb-8">Quick links to main sections.</p>
            {(latestWarnings.length > 0 || latestErrors.length > 0) && (
                <section className="mb-6 rounded-xl border border-ide-border bg-ide-panel p-4">
                    <h2 className="mb-2 text-base font-semibold text-ide-text">Scheduling alerts</h2>
                    {latestErrors.length > 0 && (
                        <ul className="mb-2 list-inside list-disc text-sm text-ide-error">
                            {latestErrors.map((msg) => (
                                <li key={msg}>{msg}</li>
                            ))}
                        </ul>
                    )}
                    {latestWarnings.length > 0 && (
                        <ul className="list-inside list-disc text-sm text-ide-warning">
                            {latestWarnings.map((msg) => (
                                <li key={msg}>{msg}</li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {links.map(({ to, label }) => (
                    <li key={to}>
                        <Link
                            to={to}
                            className="flex min-h-[52px] items-center rounded-xl border border-ide-border bg-ide-panel px-4 py-3 font-medium text-ide-text shadow-ide transition hover:border-ide-link hover:shadow-ide-md"
                        >
                            {label}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default HomePage;
