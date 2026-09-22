import React, { useEffect, useState } from 'react';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import {
  browserHasPushSubscription,
  disableBrowserReminders,
  enableBrowserReminders,
} from './browserReminders';

export function ReminderSettingsSection({ remindersEnabled }: { remindersEnabled: boolean }) {
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
      showSuccessToast({ title: 'Reminders on', detail: 'This browser will get push notifications.' });
    } catch (error) {
      setMessage(extractApiErrorMessage(error));
      showErrorToast({ title: 'Could not enable reminders', detail: extractApiErrorMessage(error) });
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
      showSuccessToast({ title: 'Reminders off', detail: 'Push notifications are stopped.' });
    } catch (error) {
      setMessage(extractApiErrorMessage(error));
      showErrorToast({ title: 'Could not turn reminders off', detail: extractApiErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-ide-border pt-10">
      <h2 className="mb-2 text-lg font-semibold text-ide-text">Reminders</h2>
      <p className="mb-4 text-sm text-ide-muted">
        One reminder during the half hour before each timed block. A habit with a set time uses that
        clock. Habits without a time share one reminder before wake. Already checked habits stay quiet.
        On iPhone, add the app to the Home Screen first.
      </p>

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
        Enable reminders
      </label>

      {enabled && !browserReady ? (
        <button
          type="button"
          className="ui-btn-secondary mt-4"
          disabled={busy}
          onClick={() => void turnOn()}
        >
          Allow on this browser
        </button>
      ) : null}

      {message ? <p className="mt-3 text-sm text-ide-error">{message}</p> : null}
    </section>
  );
}
