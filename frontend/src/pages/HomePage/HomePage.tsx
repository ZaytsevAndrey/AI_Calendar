import React from 'react';
import { Link } from 'react-router-dom';

const HomePage: React.FC = () => {
    const links = [
        { to: '/calendar', label: 'Calendar' },
        { to: '/events', label: 'Events' },
        { to: '/tasks', label: 'Tasks' },
        { to: '/schedule', label: 'Schedule' },
        { to: '/phases', label: 'Phases' },
        { to: '/settings', label: 'Settings' },
    ];

    return (
        <div className="page-shell">
            <h1 className="page-title">Home</h1>
            <p className="page-lead mb-8">Quick links to main sections.</p>
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
