import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { ChevronDown, Eye } from 'lucide-react';
import { eventsApi, useLazyGetCalendarsQuery } from '../../../api/eventsApi';
import {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
} from '../../../api/userSettingsApi';
import { showErrorToast } from '../../../utils/toast';
import {
  calendarVisibilityRows,
  nextHiddenCalendarIds,
} from '../calendarVisibility';

export function CalendarVisibilityMenu({ compact = false }: { compact?: boolean }) {
  const { data: settings } = useGetUserSettingsQuery();
  const [updateSettings, { isLoading: isSaving }] = useUpdateUserSettingsMutation();
  const [loadCalendars, calendarsQuery] = useLazyGetCalendarsQuery();
  const dispatch = useDispatch<AppDispatch>();
  const [open, setOpen] = useState(false);
  const [pendingHidden, setPendingHidden] = useState<string[] | null>(null);
  const [panelTop, setPanelTop] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

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
    void loadCalendars();
    if (compact && rootRef.current) {
      setPanelTop(rootRef.current.getBoundingClientRect().bottom + 6);
    }
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, loadCalendars, compact]);

  if (!settings?.googleCalendarLinked) return null;

  const hiddenIds = pendingHidden ?? settings.hiddenGoogleCalendarIds ?? [];
  const rows = calendarVisibilityRows({
    items: calendarsQuery.data ?? [],
    hiddenIds,
    appCalendarId: settings.appGoogleCalendarId,
    appCalendarName: settings.appGoogleCalendarName,
  });

  const onToggle = async (calendarId: string, visible: boolean) => {
    const next = nextHiddenCalendarIds(
      hiddenIds,
      calendarId,
      visible,
      settings.appGoogleCalendarId,
    );
    setPendingHidden(next);
    try {
      await updateSettings({ hiddenGoogleCalendarIds: next }).unwrap();
      dispatch(eventsApi.util.invalidateTags(['Event']));
    } catch {
      setPendingHidden(null);
      showErrorToast({ title: 'Could not update calendars' });
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
        aria-label="Calendars"
        onClick={() => setOpen((value) => !value)}
      >
        {compact ? (
          <Eye className="h-4 w-4" aria-hidden />
        ) : (
          <>
            Calendars
            <ChevronDown className="h-4 w-4" aria-hidden />
          </>
        )}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Visible calendars"
          className={
            compact
              ? 'fixed z-[1400] w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-ide-border bg-ide-panel p-2'
              : 'absolute right-0 z-20 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-ide-border bg-ide-panel p-2'
          }
          style={compact ? { top: panelTop, left: 8 } : undefined}
        >
          {calendarsQuery.isLoading || calendarsQuery.isUninitialized ? (
            <p className="px-2 py-2 text-sm text-ide-muted">Loading calendars…</p>
          ) : calendarsQuery.isError ? (
            <p className="px-2 py-2 text-sm text-ide-error">Could not load calendars.</p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-2 text-sm text-ide-muted">No calendars to show.</p>
          ) : (
            <>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {rows.map((row) => (
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
                      <span className="shrink-0 text-xs text-ide-muted">Always shown</span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
            <p className="px-2 pb-1 pt-2 text-xs text-ide-muted">
              Hides events on this page. Generate still treats Primary and the app calendar as busy.
            </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
