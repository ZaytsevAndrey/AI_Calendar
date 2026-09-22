import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type PageModule = { default: ComponentType };

export type RouteChunk = {
    id: string;
    chunkName: string;
    load: () => Promise<PageModule>;
    Component: LazyExoticComponent<ComponentType>;
};

function defineRouteChunk(
    id: string,
    chunkName: string,
    load: () => Promise<PageModule>,
): RouteChunk {
    return {
        id,
        chunkName,
        load,
        Component: lazy(load),
    };
}

/** Each `chunkName` must match the `webpackChunkName` on its `import()`. */
export const routeChunks = {
    calendar: defineRouteChunk(
        'calendar',
        'page-calendar',
        () => import(/* webpackChunkName: "page-calendar" */ 'pages/CalendarPage'),
    ),
    tasks: defineRouteChunk(
        'tasks',
        'page-tasks',
        () => import(/* webpackChunkName: "page-tasks" */ 'pages/EventsPage'),
    ),
    phases: defineRouteChunk(
        'phases',
        'page-phases',
        () => import(/* webpackChunkName: "page-phases" */ 'pages/PhasesPage/PhasesPage'),
    ),
    habits: defineRouteChunk(
        'habits',
        'page-habits',
        () => import(/* webpackChunkName: "page-habits" */ 'pages/HabitsPage'),
    ),
    settings: defineRouteChunk(
        'settings',
        'page-settings',
        () => import(/* webpackChunkName: "page-settings" */ 'pages/SettingsPage'),
    ),
    phaseSetup: defineRouteChunk(
        'phaseSetup',
        'page-phase-setup',
        () => import(/* webpackChunkName: "page-phase-setup" */ 'pages/PhaseSetupPage/PhaseSetupPage'),
    ),
    login: defineRouteChunk(
        'login',
        'page-login',
        () => import(/* webpackChunkName: "page-login" */ 'pages/LoginPage'),
    ),
    googleCallback: defineRouteChunk(
        'googleCallback',
        'page-google-callback',
        () => import(/* webpackChunkName: "page-google-callback" */ 'modules/auth/pages/GoogleCallbackPage'),
    ),
} as const;

const chunksByPath: Record<string, RouteChunk> = {
    '/': routeChunks.calendar,
    '/tasks': routeChunks.tasks,
    '/phases': routeChunks.phases,
    '/habits': routeChunks.habits,
    '/settings': routeChunks.settings,
};

export function prefetchRoute(pathname: string): void {
    const chunk = chunksByPath[pathname];
    if (!chunk) {
        return;
    }
    void chunk.load();
}
