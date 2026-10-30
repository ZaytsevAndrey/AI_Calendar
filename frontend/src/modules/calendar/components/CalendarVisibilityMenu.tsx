import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { AppDispatch } from '../../../store';
import { Calendar, ChevronDown } from 'lucide-react';
import { PickerShell } from 'ui/PickerShell';
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
  const [calendars, setCalendars] = useState<ProviderCalendarItem[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    'idle',
  );
  const [anyConnected, setAnyConnected] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
  }, [open]);

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
    <>
      <button
        ref={buttonRef}
        type="button"
        className={
          compact
            ? 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-ide-border bg-ide-panel text-ide-text hover:bg-ide-surface'
            : 'inline-flex h-9 shrink-0 items-center gap-2 rounded-control border border-ide-border bg-ide-panel px-3 text-body-sm text-ide-text transition hover:bg-ide-surface'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('calendar.calendars')}
        onClick={() => setOpen((value) => !value)}
      >
        <Calendar className="h-4 w-4" aria-hidden />
        {compact ? null : (
          <>
            {t('calendar.calendars')}
            <ChevronDown className="h-4 w-4 text-ide-muted" aria-hidden />
          </>
        )}
      </button>
      <PickerShell
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        title={t('calendar.visibleCalendars')}
        width={320}
      >
        <div>
          {loadState === 'loading' || loadState === 'idle' ? (
            <p className="px-2 py-2 text-body-sm text-ide-muted">{t('calendar.loadingCalendars')}</p>
          ) : loadState === 'error' ? (
            <p className="px-2 py-2 text-body-sm text-ide-error">{t('calendar.loadCalendarsFailed')}</p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-2 text-body-sm text-ide-muted">{t('calendar.noCalendars')}</p>
          ) : (
            <>
              <div className="space-y-2 md:max-h-72 md:overflow-y-auto">
                {SECTION_ORDER.map((provider) => {
                  const sectionRows = rows.filter((r) => r.provider === provider);
                  if (!sectionRows.length) return null;
                  return (
                    <div key={provider}>
                      <p className="flex items-center gap-1.5 px-2 py-1 text-caption font-medium text-ide-muted">
                        <ProviderLogo provider={provider} className="h-3 w-3" />
                        {t(`calendar.providerSection.${provider}`)}
                      </p>
                      <ul className="space-y-1">
                        {sectionRows.map((row) => (
                          <li key={row.id}>
                            <label className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-body text-ide-text hover:bg-ide-surface md:min-h-9 md:text-body-sm">
                              <input
                                type="checkbox"
                                className="h-5 w-5 accent-ide-accentBlue md:h-4 md:w-4"
                                checked={row.checked}
                                disabled={row.disabled || isSaving}
                                onChange={() => void onToggle(row.id, !row.checked)}
                              />
                              <span className="min-w-0 flex-1 truncate">{row.label}</span>
                              {row.disabled ? (
                                <span className="shrink-0 text-caption text-ide-muted">
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
              <p className="px-2 pb-1 pt-2 text-caption text-ide-muted">{t('calendar.calendarsHint')}</p>
            </>
          )}
        </div>
      </PickerShell>
    </>
  );
}
