import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Bell,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    Clock,
    type LucideIcon,
    Mic,
    RotateCcw,
    SlidersHorizontal,
    Sun,
    UserRound,
} from 'lucide-react';
import { useCheckRequiredSettingsQuery, useGetUserSettingsQuery } from 'api/userSettingsApi';
import { useIsPhone } from 'ui/useViewport';
import { Button } from 'ui/Button';
import { cx } from 'ui/cx';
import { GeneralSection } from 'modules/user-settings/settings/GeneralSection';
import { DaySection } from 'modules/user-settings/settings/DaySection';
import { PlanningSection } from 'modules/user-settings/settings/PlanningSection';
import { NotificationsSection } from 'modules/user-settings/settings/NotificationsSection';
import { AccountSection } from 'modules/user-settings/settings/AccountSection';
import { CalendarAccountsSection } from 'modules/user-settings/components/CalendarAccountsSection';
import { VoiceSettingsSection } from 'modules/voice/components/VoiceSettingsSection';
import { isAppLanguage } from 'i18n';
import type { UserSettingsDTO } from 'api/user-settings.api';

export const SETTINGS_SECTIONS = [
    'general',
    'day',
    'planning',
    'calendars',
    'notifications',
    'assistant',
    'account',
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

const ICONS: Record<SettingsSectionId, LucideIcon> = {
    general: SlidersHorizontal,
    day: Sun,
    planning: Clock,
    calendars: CalendarDays,
    notifications: Bell,
    assistant: Mic,
    account: UserRound,
};

const isSection = (value: string | undefined): value is SettingsSectionId =>
    !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);

function SectionBody({ id, settings }: { id: SettingsSectionId; settings: UserSettingsDTO }) {
    switch (id) {
        case 'general':
            return <GeneralSection settings={settings} />;
        case 'day':
            return <DaySection settings={settings} />;
        case 'planning':
            return <PlanningSection settings={settings} />;
        case 'calendars':
            return <CalendarAccountsSection />;
        case 'notifications':
            return <NotificationsSection settings={settings} />;
        case 'assistant':
            return (
                <VoiceSettingsSection
                    speakVoiceReplies={settings.speakVoiceReplies !== false}
                    speechLanguage={
                        isAppLanguage(settings.speechLanguage)
                            ? settings.speechLanguage
                            : isAppLanguage(settings.language)
                              ? settings.language
                              : 'uk'
                    }
                />
            );
        case 'account':
            return <AccountSection />;
    }
}

/**
 * Settings: a left list of sections on desktop, list → detail on a phone. Every field saves on change.
 * `/settings/:section`; `/settings` opens the list on a phone and «Загальні» on desktop.
 */
const SettingsPage: React.FC = () => {
    const { t } = useTranslation();
    const { section } = useParams<{ section?: string }>();
    const phone = useIsPhone();
    const { data: settings, isLoading, error, refetch } = useGetUserSettingsQuery(undefined, {
        refetchOnMountOrArgChange: true,
    });
    const { data: required } = useCheckRequiredSettingsQuery();
    const needsCalendar = required ? !required.requiredFilled : false;

    if (section && !isSection(section)) return <Navigate to="/settings" replace />;
    if (!section && !phone) return <Navigate to={needsCalendar ? '/settings/calendars' : '/settings/general'} replace />;

    if (isLoading) {
        return (
            <div className="page-shell-fill">
                <div className="flex flex-1 items-center justify-center">
                    <div className="text-center">
                        <h2 className="mb-1 text-heading font-semibold text-ide-text">{t('settings.loadingTitle')}</h2>
                        <p className="text-body-sm text-ide-muted">{t('common.pleaseWait')}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !settings) {
        return (
            <div className="page-shell-fill">
                <div className="flex flex-1 items-center justify-center">
                    <div className="max-w-sm rounded-control border border-ide-error/40 bg-ide-panel p-6 text-center">
                        <h2 className="mb-1 text-heading font-semibold text-ide-error">{t('settings.loadErrorTitle')}</h2>
                        <p className="mb-4 text-body-sm text-ide-muted">{t('settings.loadErrorHint')}</p>
                        <Button variant="secondary" icon={RotateCcw} onClick={() => void refetch()}>
                            {t('common.retry')}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const current = isSection(section) ? section : null;
    const nav = (
        <nav aria-label={t('settings.title')}>
            <ul className={cx('flex flex-col', phone ? 'gap-1' : 'gap-0.5')}>
                {SETTINGS_SECTIONS.map((id) => {
                    const Icon = ICONS[id];
                    const active = id === current;
                    return (
                        <li key={id}>
                            <Link
                                to={`/settings/${id}`}
                                aria-current={active ? 'page' : undefined}
                                className={cx(
                                    'flex items-center gap-3 rounded-control no-underline transition',
                                    phone
                                        ? 'min-h-[60px] border border-ide-border bg-ide-panel px-3 active:bg-ide-surface'
                                        : 'h-10 px-3 text-body-sm',
                                    !phone && (active ? 'bg-ide-surface font-medium text-ide-text' : 'text-ide-muted hover:bg-ide-surface hover:text-ide-text'),
                                )}
                            >
                                <Icon className={cx('shrink-0', phone ? 'h-5 w-5 text-ide-muted' : 'h-4 w-4')} aria-hidden />
                                <span className="min-w-0 flex-1">
                                    <span className={cx('block', phone && 'text-body font-medium text-ide-text')}>
                                        {t(`settings.sections.${id}`)}
                                    </span>
                                    {phone ? (
                                        <span className="block truncate text-body-sm text-ide-muted">
                                            {t(`settings.sectionHints.${id}`)}
                                        </span>
                                    ) : null}
                                </span>
                                {id === 'calendars' && needsCalendar ? (
                                    <span className="h-2 w-2 shrink-0 rounded-full bg-ide-warn" aria-hidden />
                                ) : null}
                                {phone ? <ChevronRight className="h-4 w-4 shrink-0 text-ide-muted" aria-hidden /> : null}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );

    if (phone && !current) {
        return (
            <div className="page-shell-fill max-md:px-3">
                <header className="mb-3 shrink-0">
                    <h1 className="page-title">{t('settings.title')}</h1>
                </header>
                <div className="page-scroll pb-4">{nav}</div>
            </div>
        );
    }

    const body = current ? (
        <>
            {needsCalendar && current === 'calendars' ? (
                <p className="mb-4 rounded-control border border-ide-warn/40 bg-ide-warnTint px-4 py-3 text-body-sm text-ide-text" role="status">
                    {t('settings.needsCalendar')}
                </p>
            ) : null}
            <SectionBody id={current} settings={settings} />
        </>
    ) : null;

    if (phone) {
        return (
            <div className="page-shell-fill max-md:px-3">
                <header className="mb-3 shrink-0">
                    <Link
                        to="/settings"
                        className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-body text-ide-link no-underline"
                    >
                        <ChevronLeft className="h-5 w-5" aria-hidden />
                        {t('settings.backToList')}
                    </Link>
                    <h1 className="sr-only">{t('settings.title')}</h1>
                    <h2 className="text-title font-semibold text-ide-text">{t(`settings.sections.${current}`)}</h2>
                </header>
                <div className="page-scroll pb-6">{body}</div>
            </div>
        );
    }

    return (
        <div className="page-shell-fill">
            <header className="page-head shrink-0">
                <h1 className="page-title">{t('settings.title')}</h1>
            </header>
            <div className="flex min-h-0 flex-1 gap-6 lg:gap-8">
                <aside className="w-52 shrink-0">{nav}</aside>
                <div className="page-scroll min-w-0 flex-1 pb-8">
                    <h2 className="mb-4 text-title font-semibold text-ide-text">{t(`settings.sections.${current}`)}</h2>
                    <div className={cx(current === 'day' ? 'max-w-6xl' : 'max-w-3xl')}>{body}</div>
                </div>
            </div>
        </div>
    );
};

export default SettingsPage;
