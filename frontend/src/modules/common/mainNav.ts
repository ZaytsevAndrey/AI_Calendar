import {
    CalendarDays,
    Flame,
    Layers,
    ListTodo,
    Settings,
    type LucideIcon,
} from 'lucide-react';

export type MainNavItem = {
    to: string;
    label: string;
    icon: LucideIcon;
    match: (path: string) => boolean;
};

export const mainNavItems: readonly MainNavItem[] = [
    {
        to: '/',
        label: 'Calendar',
        icon: CalendarDays,
        match: (path) => path === '/' || path === '/calendar',
    },
    {
        to: '/tasks',
        label: 'Tasks',
        icon: ListTodo,
        match: (path) => path === '/tasks' || path === '/events',
    },
    {
        to: '/phases',
        label: 'Phases',
        icon: Layers,
        match: (path) => path === '/phases' || path.startsWith('/setup'),
    },
    {
        to: '/habits',
        label: 'Habits',
        icon: Flame,
        match: (path) => path === '/habits',
    },
    {
        to: '/settings',
        label: 'Settings',
        icon: Settings,
        match: (path) => path === '/settings',
    },
];

export function mainNavLabel(pathname: string): string {
    return mainNavItems.find((item) => item.match(pathname))?.label ?? 'AI Calendar';
}
