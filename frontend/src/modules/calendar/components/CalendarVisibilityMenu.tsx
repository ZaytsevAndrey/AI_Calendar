import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { AppDispatch } from '../../../store';
import { ChevronDown, Eye } from 'lucide-react';
import { eventsApi } from '../../../api/eventsApi';
import {
  getAuthProvidersStatus,
  listProviderCalendars,
} from '../../../api/calendarOverlays.api';
import {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
} from '../../../api/userSettingsApi';
import { showErrorToast } from '../../../utils/toast';
import {
  calendarVisibilityRows,
  nextHiddenCalendarIds,
  type ProviderCalendarItem,
} from '../calendarVisibility';
import type { CalendarProviderId } from '../schedulingKind';
import { ProviderLogo } from './ProviderLogo';

const SECTION_ORDER: CalendarProviderId[] = ['google', 'microsoft', 'apple'];

export function CalendarVisibilityMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { data: settings } = useGetUserSettingsQuery();
  const [updateSettings, { isLoading: isSaving }] = useUpdateUserSettingsMutation();
  const dispatch = useDispatch<AppDispatch>();
  const [open, setOpen] = useState(false);
  const [pendingHidden, setPendingHidden] = useState<string[] | null>(null);
  const [panelTop, setPanelTop] = useState(0);
  const [calendars, setCalendars] = useState<ProviderCalendarItem[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    'idle',
  );
  const [anyConnected, setAnyConnected] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getAuthProvidersStatus()
      .then((s) => setAnyConnected(!!(s.google || s.microsoft || s.apple)))
      .catch(() => setAnyConnected(!!settings?.googleCalendarLinked));
  }, [settings?.googleCalendarLinked]);

  useEffect(() => {
    if (!pendingHidden || !settings) return;
    const saved = settings.hiddenGoogleCalendarIds ?? [];
    if (
      saved.length === pendingHidden.length &&
      saved.every((id, index) => id === pendingHidden[index])
    ) {
      setPendingHidden(null);
    }
  }, [settings, pendingHidden]);

  useEffect(() => {
    if (!open) return;
    setLoadState('loading');
    void listProviderCalendars()
      .then((res) => {
        setCalendars((res.calendars ?? []) as ProviderCalendarItem[]);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
    if (compact && rootRef.current) {
      setPanelTop(rootRef.current.getBoundingClientRect().bottom + 6);
    }
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, compact]);

  const linked =
    anyConnected || !!settings?.googleCalendarLinked || calendars.length > 0;
  if (!linked) return null;

  const hiddenIds = pendingHidden ?? settings?.hiddenGoogleCalendarIds ?? [];
  const rows = calendarVisibilityRows({
    items: calendars,
    hiddenIds,
    appCalendarId: settings?.appGoogleCalendarId,
    appCalendarName: settings?.appGoogleCalendarName,
  });

  const onToggle = async (calendarId: string, visible: boolean) => {
    const next = nextHiddenCalendarIds(
      hiddenIds,
      calendarId,
      visible,
      settings?.appGoogleCalendarId,
    );
    setPendingHidden(next);
    try {
      await updateSettings({ hiddenGoogleCalendarIds: next }).unwrap();
      dispatch(eventsApi.util.invalidateTags(['Event']));
    } catch {
      setPendingHidden(null);
      showErrorToast({ title: t('calendar.updateCalendarsFailed') });
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={
          compact
            ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ide-text hover:bg-white/5'
            : 'ui-btn-secondary px-4'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('calendar.calendars')}
        onClick={() => setOpen((value) => !value)}
      >
        {compact ? (
          <Eye className="h-4 w-4" aria-hidden />
        ) : (
          <>
            {t('calendar.calendars')}
            <ChevronDown className="h-4 w-4" aria-hidden />
          </>
        )}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t('calendar.visibleCalendars')}
          className={
            compact
              ? 'fixed z-[1400] w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-ide-border bg-ide-panel p-2'
              : 'absolute right-0 z-20 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-ide-border bg-ide-panel p-2'
          }
          style={compact ? { top: panelTop, left: 8 } : undefined}
        >
          {loadState === 'loading' || loadState === 'idle' ? (
            <p className="px-2 py-2 text-sm text-ide-muted">{t('calendar.loadingCalendars')}</p>
          ) : loadState === 'error' ? (
            <p className="px-2 py-2 text-sm text-ide-error">{t('calendar.loadCalendarsFailed')}</p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-2 text-sm text-ide-muted">{t('calendar.noCalendars')}</p>
          ) : (
            <>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {SECTION_ORDER.map((provider) => {
                  const sectionRows = rows.filter((r) => r.provider === provider);
                  if (!sectionRows.length) return null;
                  return (
                    <div key={provider}>
                      <p className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ide-muted">
                        <ProviderLogo provider={provider} className="h-3 w-3" />
                        {t(`calendar.providerSection.${provider}`)}
                      </p>
                      <ul className="space-y-1">
                        {sectionRows.map((row) => (
                          <li key={row.id}>
                            <label className="flex min-h-[44px] items-center gap-2 rounded px-2 text-sm text-ide-text hover:bg-ide-surface">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={row.checked}
                                disabled={row.disabled || isSaving}
                                onChange={() => void onToggle(row.id, !row.checked)}
                              />
                              <span className="min-w-0 flex-1 truncate">{row.label}</span>
                              {row.disabled ? (
                                <span className="shrink-0 text-xs text-ide-muted">
                                  {t('calendar.alwaysShown')}
                                </span>
                              ) : null}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              <p className="px-2 pb-1 pt-2 text-xs text-ide-muted">{t('calendar.calendarsHint')}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
