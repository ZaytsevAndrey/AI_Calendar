import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import {
  browserHasPushSubscription,
  disableBrowserReminders,
  enableBrowserReminders,
} from './browserReminders';

export function ReminderSettingsSection({ remindersEnabled }: { remindersEnabled: boolean }) {
  const { t } = useTranslation();
  const [updateUserSettings] = useUpdateUserSettingsMutation();
  const [enabled, setEnabled] = useState(remindersEnabled);
  const [browserReady, setBrowserReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(remindersEnabled);
  }, [remindersEnabled]);

  useEffect(() => {
    if (!enabled) {
      setBrowserReady(false);
      return;
    }
    let cancelled = false;
    void browserHasPushSubscription().then((ready) => {
      if (!cancelled) setBrowserReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await updateUserSettings({ remindersEnabled: true }).unwrap();
      setEnabled(true);
      await enableBrowserReminders();
      setBrowserReady(true);
      showSuccessToast({
        title: t('reminders.onTitle'),
        detail: t('reminders.onDetail'),
      });
    } catch (error) {
      setMessage(extractApiErrorMessage(error));
      showErrorToast({
        title: t('reminders.enableFailed'),
        detail: extractApiErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await updateUserSettings({ remindersEnabled: false }).unwrap();
      setEnabled(false);
      setBrowserReady(false);
      await disableBrowserReminders();
      showSuccessToast({
        title: t('reminders.offTitle'),
        detail: t('reminders.offDetail'),
      });
    } catch (error) {
      setMessage(extractApiErrorMessage(error));
      showErrorToast({
        title: t('reminders.disableFailed'),
        detail: extractApiErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-ide-border pt-10">
      <h2 className="mb-2 text-lg font-semibold text-ide-text">{t('reminders.title')}</h2>
      <p className="mb-4 text-sm text-ide-muted">{t('reminders.hint')}</p>

      <label className="flex items-center gap-2 text-sm text-ide-text">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={enabled}
          disabled={busy}
          onChange={(event) => {
            if (event.target.checked) void turnOn();
            else void turnOff();
          }}
        />
        {t('reminders.enable')}
      </label>

      {enabled && !browserReady ? (
        <button
          type="button"
          className="ui-btn-secondary mt-4"
          disabled={busy}
          onClick={() => void turnOn()}
        >
          {t('reminders.allowBrowser')}
        </button>
      ) : null}

      {message ? <p className="mt-3 text-sm text-ide-error">{message}</p> : null}
    </section>
  );
}
