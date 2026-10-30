import {
    CalendarDays,
    ListTodo,
    Settings,
    type LucideIcon,
} from 'lucide-react';

export type MainNavItem = {
    to: string;
    labelKey: string;
    icon: LucideIcon;
    match: (path: string) => boolean;
};

export const mainNavItems: readonly MainNavItem[] = [
    {
        to: '/calendar',
        labelKey: 'nav.calendar',
        icon: CalendarDays,
        match: (path) => path === '/' || path === '/calendar',
    },
    {
        to: '/tasks',
        labelKey: 'nav.tasks',
        icon: ListTodo,
        match: (path) => path === '/tasks' || path === '/events',
    },
    {
        to: '/settings',
        labelKey: 'nav.settings',
        icon: Settings,
        match: (path) => path === '/settings' || path.startsWith('/settings/') || path.startsWith('/setup'),
    },
];

/** Returns a nav.* translation key for the current route. */
export function mainNavLabel(pathname: string): string {
    return mainNavItems.find((item) => item.match(pathname))?.labelKey ?? 'nav.brand';
}
