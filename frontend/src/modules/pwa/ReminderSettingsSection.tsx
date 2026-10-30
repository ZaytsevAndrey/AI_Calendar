import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import { Bell } from 'lucide-react';
import { Button } from 'ui/Button';
import { Switch } from 'ui/Switch';
import { SettingRow, SettingsGroup } from 'modules/user-settings/settings/SettingsUi';
import {
  browserHasPushSubscription,
  disableBrowserReminders,
  enableBrowserReminders,
} from './browserReminders';

export function ReminderSettingsSection({
  remindersEnabled,
  children,
}: {
  remindersEnabled: boolean;
  /** More rows in the same card (default reminder time). */
  children?: React.ReactNode;
}) {
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
    <SettingsGroup>
      <SettingRow label={t('reminders.enable')} htmlFor="reminders-enabled" hint={t('reminders.hint')}>
        <Switch
          id="reminders-enabled"
          checked={enabled}
          disabled={busy}
          onChange={(next) => (next ? void turnOn() : void turnOff())}
        />
      </SettingRow>
      {enabled && !browserReady ? (
        <SettingRow label={t('reminders.allowBrowser')}>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void turnOn()} icon={Bell}>
            {t('reminders.allowBrowser')}
          </Button>
        </SettingRow>
      ) : null}
      {children}
      {message ? <p className="px-4 py-3 text-body-sm text-ide-error md:px-5">{message}</p> : null}
    </SettingsGroup>
  );
}
