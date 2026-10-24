import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import type { TaskDTO } from 'api/tasks.api';
import {
  setCalendarOverlayMode,
  unscheduleExternalEvent,
} from 'api/calendarOverlays.api';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { useUpdateEventMutation } from 'api/eventTasksApi';
import { Modal } from '../../../ui/Modal';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
import { Input } from 'ui/Input';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { KindIcon, KIND_I18N_KEY } from '../kindIcons';
import { ProviderLogo, providerLabel } from './ProviderLogo';
import {
  kindIsEditable,
  schedulingKindForEvent,
  type CalendarEventOverlayDTO,
  type CalendarProviderId,
  type SchedulingKind,
} from '../schedulingKind';

export type CalendarNameById = Record<
  string,
  { summary: string; provider: CalendarProviderId }
>;

type WarnKind = 'flexible' | 'unschedule';

type Props = {
  event: GoogleCalendarEvent;
  task?: TaskDTO | null;
  overlay?: CalendarEventOverlayDTO | null;
  isHabit?: boolean;
  completed?: boolean;
  calendarNameById?: CalendarNameById;
  provider?: CalendarProviderId;
  dismissWarnFlexibleMove?: boolean;
  dismissWarnUnscheduleExternal?: boolean;
  onOverlaysChanged?: () => void;
  onUnscheduled?: () => void;
};

const EDIT_OPTIONS: SchedulingKind[] = ['fixed', 'flexible', 'unscheduled'];

export function CalendarChipMeta({
  event,
  task,
  overlay,
  isHabit,
  completed,
  calendarNameById,
  provider = 'google',
  dismissWarnFlexibleMove,
  dismissWarnUnscheduleExternal,
  onOverlaysChanged,
  onUnscheduled,
}: Props) {
  const { t } = useTranslation();
  const [updateSettings] = useUpdateUserSettingsMutation();
  const [updateTask] = useUpdateEventMutation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [pending, setPending] = useState<SchedulingKind | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const kindBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);

  const kind = schedulingKindForEvent({ event, task, overlay, isHabit });
  const editable = kindIsEditable(kind) && !isHabit && !task?.isRecurring;
  const eventProvider = event.provider ?? provider;
  const calMeta = event.calendarId
    ? calendarNameById?.[`${eventProvider}:${event.calendarId}`] ??
      calendarNameById?.[event.calendarId]
    : undefined;
  const calProvider = calMeta?.provider ?? eventProvider;
  const calName = calMeta?.summary?.trim() || '';
  const calTitle = calName
    ? `${providerLabel(calProvider)} · ${calName}`
    : providerLabel(calProvider);

  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const el = kindBtnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menuWidth = 120;
      const left = Math.min(
        Math.max(4, rect.left),
        window.innerWidth - menuWidth - 4,
      );
      setMenuPos({ top: rect.bottom + 4, left });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (kindBtnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const needsWarn = (next: SchedulingKind): WarnKind | null => {
    if (next === 'flexible' && !dismissWarnFlexibleMove) return 'flexible';
    if (next === 'unscheduled' && !dismissWarnUnscheduleExternal)
      return 'unschedule';
    return null;
  };

  const applyKind = async (next: SchedulingKind) => {
    setBusy(true);
    try {
      if (next === 'unscheduled') {
        if (task) {
          await updateTask({
            id: task.id,
            body: {
              isUnscheduled: true,
              eventType: 'admin',
              scheduledStartTime: null,
              scheduledEndTime: null,
            },
          }).unwrap();
        } else {
          await unscheduleExternalEvent(eventProvider, event.id, {
            calendarId: event.calendarId,
            title: event.summary,
          });
        }
        showSuccessToast(t('calendar.kind.unscheduledDone'));
        onUnscheduled?.();
      } else if (next === 'fixed' || next === 'flexible') {
        if (task) {
          await updateTask({
            id: task.id,
            body: {
              eventType: next === 'fixed' ? 'fixed' : 'admin',
            },
          }).unwrap();
        } else {
          await setCalendarOverlayMode(eventProvider, event.id, {
            schedulingMode: next,
            calendarId: event.calendarId,
          });
        }
        onOverlaysChanged?.();
        showSuccessToast(t('calendar.kind.updated'));
      }
      setPending(null);
      setMenuOpen(false);
    } catch (e) {
      showErrorToast({
        title: t('calendar.kind.updateFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const requestKind = (next: SchedulingKind) => {
    if (next === kind) {
      setMenuOpen(false);
      return;
    }
    const warn = needsWarn(next);
    if (warn) {
      setPending(next);
      setDontShowAgain(false);
      setMenuOpen(false);
      return;
    }
    void applyKind(next);
  };

  const confirmPending = async () => {
    if (!pending) return;
    if (dontShowAgain) {
      const patch =
        pending === 'flexible'
          ? { dismissWarnFlexibleMove: true }
          : { dismissWarnUnscheduleExternal: true };
      try {
        await updateSettings(patch).unwrap();
      } catch {
        // Still apply the kind change
      }
    }
    await applyKind(pending);
  };

  const stopChipDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const kindMenu =
    menuOpen && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <span
            ref={menuRef}
            className="calendar-chip__kind-menu calendar-chip__kind-menu--portal"
            role="menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            onPointerDown={stopChipDrag}
          >
            {EDIT_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                role="menuitem"
                className={
                  opt === kind
                    ? 'calendar-chip__kind-option is-active'
                    : 'calendar-chip__kind-option'
                }
                title={t(KIND_I18N_KEY[opt])}
                aria-label={t(KIND_I18N_KEY[opt])}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  requestKind(opt);
                }}
              >
                <KindIcon kind={opt} />
              </button>
            ))}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        className="calendar-chip__meta"
        onPointerDown={stopChipDrag}
        onClick={stopChipDrag}
      >
        {editable ? (
          <button
            ref={kindBtnRef}
            type="button"
            className="calendar-chip__icon-btn"
            title={t(KIND_I18N_KEY[kind])}
            aria-label={t(KIND_I18N_KEY[kind])}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <KindIcon kind={kind} className="h-2.5 w-2.5" />
          </button>
        ) : (
          <span
            className="calendar-chip__icon-btn calendar-chip__icon-btn--static"
            title={t(KIND_I18N_KEY[kind])}
          >
            <KindIcon kind={kind} className="h-2.5 w-2.5" />
          </span>
        )}
        <span
          className="calendar-chip__cal"
          title={calTitle}
        >
          <ProviderLogo provider={calProvider} className="h-2.5 w-2.5" />
          {calName ? (
            <span className="calendar-chip__cal-name">{calName}</span>
          ) : (
            <span className="calendar-chip__cal-name">
              {providerLabel(calProvider)}
            </span>
          )}
        </span>
        {completed ? (
          <span className="calendar-chip__badge">{t('calendar.completedBadge')}</span>
        ) : null}
      </span>
      {kindMenu}

      <Modal
        open={!!pending}
        onClose={() => !busy && setPending(null)}
        title={
          pending === 'unscheduled'
            ? t('calendar.kind.warnUnscheduleTitle')
            : t('calendar.kind.warnFlexibleTitle')
        }
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size={dialogButtonSize}
              disabled={busy}
              onClick={() => setPending(null)}
              icon={X}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size={dialogButtonSize}
              disabled={busy}
              onClick={() => void confirmPending()}
              icon={Check}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ide-text">
          {pending === 'unscheduled'
            ? t('calendar.kind.warnUnscheduleBody')
            : t('calendar.kind.warnFlexibleBody')}
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-ide-muted">
          <Input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          {t('calendar.kind.dontShowAgain')}
        </label>
      </Modal>
    </>
  );
}
