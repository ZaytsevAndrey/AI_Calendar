import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';
import { prefetchRoute } from 'routeChunks';
import { cx } from 'ui/cx';
import { useOpenVoice } from 'modules/voice/voiceLauncher';
import { mainNavItems } from '../mainNav';

const itemClass = (active: boolean) =>
    cx(
        'flex min-h-[52px] flex-col items-center justify-center gap-1 px-1 text-caption font-medium leading-none no-underline transition',
        active ? 'text-ide-link' : 'text-ide-muted active:bg-ide-surface',
    );

/** Phone tab bar, full width: Календар · Задачі · Помічник · Налаштування. */
const BottomNav: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const openVoice = useOpenVoice();
    const [calendar, tasks, ...rest] = mainNavItems;

    const link = ({ to, labelKey, icon: Icon, match }: (typeof mainNavItems)[number]) => {
        const active = match(location.pathname);
        return (
            <Link
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={itemClass(active)}
                onMouseEnter={() => prefetchRoute(to)}
                onFocus={() => prefetchRoute(to)}
            >
                <span
                    className={cx(
                        'inline-flex h-7 w-12 items-center justify-center rounded-full transition',
                        active && 'bg-ide-link/15',
                    )}
                >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden />
                </span>
                {t(labelKey)}
            </Link>
        );
    };

    return (
        <nav
            className="z-[1200] shrink-0 border-t border-ide-border bg-ide-panel pb-[env(safe-area-inset-bottom)] md:hidden"
            aria-label={t('nav.main')}
        >
            <div className="grid grid-cols-4">
                {link(calendar)}
                {link(tasks)}
                <button type="button" className={itemClass(false)} onClick={openVoice} aria-label={t('voice.addByVoice')}>
                    <span className="inline-flex h-7 w-12 items-center justify-center rounded-full">
                        <Mic className="h-5 w-5 shrink-0" aria-hidden />
                    </span>
                    {t('nav.assistant')}
                </button>
                {rest.map(link)}
            </div>
        </nav>
    );
};

export default BottomNav;
